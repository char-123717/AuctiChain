const db = require('../config/db');
const { ethers } = require('ethers');

/**
 * Auction Monitor Service
 * 
 * Monitors active auctions and updates database status when auction time expires.
 * Does NOT call endAuction() on contract - auction ends automatically based on time.
 * Seller calls claimProceeds() to get their funds.
 */

class AuctionMonitor {
    constructor() {
        this.isRunning = false;
        this.checkInterval = 30 * 1000; // Check every 30 seconds
        this.intervalId = null;
        this.processedAuctions = new Set(); // Track auctions we've already processed
    }

    /**
     * Start the auction monitor
     */
    start() {
        if (this.isRunning) {
            console.log('Auction monitor already running');
            return;
        }

        this.isRunning = true;
        console.log('🔍 Auction Monitor started - checking every', this.checkInterval / 1000, 'seconds');

        // Run immediately on start
        this.checkEndedAuctions();

        // Then run periodically
        this.intervalId = setInterval(() => {
            this.checkEndedAuctions();
        }, this.checkInterval);
    }

    /**
     * Stop the auction monitor
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('Auction Monitor stopped');
    }

    /**
     * Check for ended auctions and call endAuction on them
     */
    async checkEndedAuctions() {
        try {
            const now = Math.floor(Date.now() / 1000);
            
            // Get all LIVE items (auctions that have been started by seller)
            const items = await db.getItemsByStatus('LIVE');
            
            for (const item of items) {
                // Skip if no contract address (auctionId) or auction end time
                const contractAddress = item.auctionId || item.contractAddress;
                if (!contractAddress || !item.auctionEndTime) {
                    continue;
                }

                // Skip if already processed
                if (this.processedAuctions.has(contractAddress)) {
                    continue;
                }

                // Check if auction has ended
                if (item.auctionEndTime <= now) {
                    // Re-fetch item to check if it's still LIVE (might have been frozen)
                    const currentItem = await db.getItemById(item.id);
                    if (!currentItem || currentItem.status !== 'LIVE') {
                        console.log(`   Item ${item.name} is no longer LIVE (status: ${currentItem?.status || 'deleted'}), skipping`);
                        continue;
                    }
                    
                    console.log(`\n⏰ Auction ended for item: ${item.name}`);
                    console.log(`   Contract: ${contractAddress}`);
                    
                    await this.finalizeAuction(item, contractAddress);
                }
            }
        } catch (error) {
            console.error('Error checking ended auctions:', error.message);
        }
    }

    /**
     * Finalize an auction by reading blockchain state and updating database
     * Does NOT call endAuction() - auction ends automatically based on time
     */
    async finalizeAuction(item, contractAddress = null) {
        try {
            // Use provided contractAddress or fallback to item.auctionId
            const auctionContract = contractAddress || item.auctionId || item.contractAddress;
            
            // Re-fetch item from database to check current status
            // This prevents race condition where admin freezes auction while we're processing
            const currentItem = await db.getItemById(item.id);
            if (!currentItem) {
                console.log(`   Item ${item.id} no longer exists, skipping`);
                return;
            }
            
            // Skip if item is no longer LIVE (e.g., was frozen by admin)
            if (currentItem.status !== 'LIVE') {
                console.log(`   Item status is ${currentItem.status}, not LIVE - skipping finalization`);
                return;
            }
            
            // Mark as processed to avoid duplicate calls
            this.processedAuctions.add(auctionContract);

            // Read auction state from blockchain
            const rpcUrl = process.env.SEPOLIA_RPC_URL;
            if (!rpcUrl) {
                console.log(`   ✗ No RPC URL configured`);
                this.processedAuctions.delete(auctionContract);
                return;
            }

            const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            const AUCTION_ABI = [
                { "inputs": [], "name": "highestBid", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
                { "inputs": [], "name": "highestBidder", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
                { "inputs": [], "name": "ended", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" }
            ];
            
            const contract = new ethers.Contract(auctionContract, AUCTION_ABI, provider);
            
            const [highestBidBn, highestBidder] = await Promise.all([
                contract.highestBid(),
                contract.highestBidder()
            ]);
            
            const highestBidValue = ethers.utils.formatEther(highestBidBn);
            const hasBidder = highestBidder !== ethers.constants.AddressZero;
            
            if (!hasBidder || parseFloat(highestBidValue) === 0) {
                console.log(`   ✓ Auction ended with no bidders`);
                
                // Update item status in database to UNSOLD (no winner)
                await db.updateItem(item.id, {
                    status: 'UNSOLD',
                    auctionFinalized: true,
                    winner: null,
                    winningBid: '0',
                    finalizedAt: new Date(),
                    noBidder: true
                });
                
                // Broadcast status update via callback if set
                if (this.onAuctionFinalized) {
                    this.onAuctionFinalized({
                        auctionId: auctionContract,
                        itemId: item.id,
                        status: 'UNSOLD',
                        winner: null,
                        winningBid: '0'
                    });
                }
            } else {
                console.log(`   ✓ Auction finalized successfully!`);
                console.log(`   Winner: ${highestBidder}`);
                console.log(`   Winning Bid: ${highestBidValue} ETH`);

                // Update item status in database to SOLD
                await db.updateItem(item.id, {
                    status: 'SOLD',
                    auctionFinalized: true,
                    winner: highestBidder,
                    winningBid: highestBidValue,
                    finalizedAt: new Date()
                });
                
                // Broadcast status update via callback if set
                if (this.onAuctionFinalized) {
                    this.onAuctionFinalized({
                        auctionId: auctionContract,
                        itemId: item.id,
                        status: 'SOLD',
                        winner: highestBidder,
                        winningBid: highestBidValue
                    });
                }
            }
        } catch (error) {
            console.error(`   ✗ Error finalizing auction:`, error.message);
            // Remove from processed so we can retry later
            const auctionContract = contractAddress || item.auctionId || item.contractAddress;
            this.processedAuctions.delete(auctionContract);
        }
    }
    
    /**
     * Set callback for when auction is finalized (for socket.io broadcast)
     */
    setOnAuctionFinalized(callback) {
        this.onAuctionFinalized = callback;
    }
}

// Create singleton instance
const auctionMonitor = new AuctionMonitor();

module.exports = auctionMonitor;
