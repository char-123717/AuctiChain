const { ethers } = require('ethers');

/**
 * Simple Auction Contract Deployer
 * 
 * This deploys a simplified auction contract to Sepolia testnet.
 * The contract accepts bids and tracks the highest bidder.
 */

// Auction ABI (Anti-Manipulation Edition)
// Constructor: (biddingTime, recipient, startingPrice, admin, seller, expectedBond) - non-payable
// Bond is deposited separately by seller via depositSellerBond() function
// New features: seller bond, losing bid penalty (1.5%), admin arbitration (freeze/slash)
const AUCTION_ABI = [
	{
		"inputs": [
			{
				"internalType": "uint256",
				"name": "_biddingTime",
				"type": "uint256"
			},
			{
				"internalType": "address",
				"name": "_recipient",
				"type": "address"
			},
			{
				"internalType": "uint256",
				"name": "_startingPrice",
				"type": "uint256"
			},
			{
				"internalType": "address",
				"name": "_admin",
				"type": "address"
			},
			{
				"internalType": "address",
				"name": "_seller",
				"type": "address"
			},
			{
				"internalType": "uint256",
				"name": "_expectedBond",
				"type": "uint256"
			}
		],
		"stateMutability": "payable",
		"type": "constructor"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": false,
				"internalType": "address",
				"name": "winner",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "address",
				"name": "recipient",
				"type": "address"
			}
		],
		"name": "AuctionEnded",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "admin",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "string",
				"name": "reason",
				"type": "string"
			}
		],
		"name": "AuctionFrozen",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "admin",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "endTime",
				"type": "uint256"
			}
		],
		"name": "AuctionStarted",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "admin",
				"type": "address"
			}
		],
		"name": "AuctionUnfrozen",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "bidder",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "total",
				"type": "uint256"
			}
		],
		"name": "BidPlaced",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "bidder",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "total",
				"type": "uint256"
			}
		],
		"name": "NewHighBid",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "seller",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "winningBid",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "bond",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "totalAmount",
				"type": "uint256"
			}
		],
		"name": "ProceedsClaimed",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "seller",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			}
		],
		"name": "SellerBondDeposited",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "seller",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			}
		],
		"name": "SellerBondReturned",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "admin",
				"type": "address"
			},
			{
				"indexed": true,
				"internalType": "address",
				"name": "seller",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			}
		],
		"name": "SellerBondSlashed",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "bidder",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "grossAmount",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "penalty",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "netAmount",
				"type": "uint256"
			}
		],
		"name": "Withdrawn",
		"type": "event"
	},
	{
		"inputs": [],
		"name": "BPS_DENOMINATOR",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "MIN_PENALTY",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "PENALTY_RATE_BPS",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "admin",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "auctionEndTime",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "bid",
		"outputs": [],
		"stateMutability": "payable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "bidder",
				"type": "address"
			}
		],
		"name": "bidderTotal",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "biddersCount",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "biddingTime",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"name": "bids",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "uint256",
				"name": "bidAmount",
				"type": "uint256"
			}
		],
		"name": "calculatePenalty",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "pure",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "claimProceeds",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "claimSellerBond",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "depositSellerBond",
		"outputs": [],
		"stateMutability": "payable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "endAuction",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "ended",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "expectedBondAmount",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "string",
				"name": "reason",
				"type": "string"
			}
		],
		"name": "freezeAuction",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "frozen",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "getStatus",
		"outputs": [
			{
				"internalType": "bool",
				"name": "_started",
				"type": "bool"
			},
			{
				"internalType": "bool",
				"name": "_ended",
				"type": "bool"
			},
			{
				"internalType": "bool",
				"name": "_frozen",
				"type": "bool"
			},
			{
				"internalType": "bool",
				"name": "_bondReturned",
				"type": "bool"
			},
			{
				"internalType": "bool",
				"name": "_bondSlashed",
				"type": "bool"
			},
			{
				"internalType": "uint256",
				"name": "_sellerBond",
				"type": "uint256"
			},
			{
				"internalType": "uint256",
				"name": "_timeLeft",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "hasAnyBid",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "highestBid",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "highestBidder",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "isActive",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "isBondDeposited",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "isStarted",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "owner",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "recipient",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "refundBond",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "seller",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "sellerBond",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "sellerBondReturned",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "sellerBondSlashed",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "slashSellerBond",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "startAuction",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "started",
		"outputs": [
			{
				"internalType": "bool",
				"name": "",
				"type": "bool"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "startingPrice",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "totalPenaltiesCollected",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "unfreezeAuction",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "withdraw",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "withdrawPenalties",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "withdrawSlashed",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	}
];

class ContractDeployer {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.initialized = false;
        this.mockMode = false;
    }

    async initialize() {
        if (this.initialized) return;

        const rpcUrl = process.env.SEPOLIA_RPC_URL;
        const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

        if (!rpcUrl) {
            console.warn('SEPOLIA_RPC_URL not configured - using mock mode');
            this.mockMode = true;
            this.initialized = true;
            return;
        }

        if (!privateKey || privateKey === 'your-deployer-private-key-here') {
            console.warn('DEPLOYER_PRIVATE_KEY not configured - using mock mode');
            this.mockMode = true;
            this.initialized = true;
            return;
        }

        try {
            this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            this.initialized = true;
            
            // Test connection
            const balance = await this.wallet.getBalance();
            console.log('Contract deployer initialized.');
            console.log('  Deployer address:', this.wallet.address);
            console.log('  Balance:', ethers.utils.formatEther(balance), 'ETH');
        } catch (error) {
            console.warn('Failed to initialize deployer:', error.message);
            this.mockMode = true;
            this.initialized = true;
        }
    }

    async getBalance() {
        await this.initialize();
        if (this.mockMode) return '0';
        const balance = await this.wallet.getBalance();
        return ethers.utils.formatEther(balance);
    }

    /**
     * Freeze an auction (admin only)
     * @param {string} contractAddress - The auction contract address
     * @param {string} reason - Reason for freezing
     * @returns {Promise<object>} Transaction result
     */
    async freezeAuction(contractAddress, reason) {
        await this.initialize();

        if (this.mockMode) {
            console.log('MOCK MODE: Simulating freezeAuction call');
            console.log('  Contract:', contractAddress);
            console.log('  Reason:', reason);
            return {
                success: true,
                transactionHash: '0x' + Array(64).fill(0).map(() => 
                    Math.floor(Math.random() * 16).toString(16)
                ).join(''),
                mockMode: true
            };
        }
        
        console.log('Calling freezeAuction on contract:', contractAddress);
        console.log('  Reason:', reason);

        try {
            const contract = new ethers.Contract(contractAddress, AUCTION_ABI, this.wallet);
            
            // Check if already frozen
            const frozen = await contract.frozen();
            if (frozen) {
                console.log('  Auction already frozen');
                return { success: true, alreadyFrozen: true };
            }

            // Get gas price
            const gasPrice = await this.provider.getGasPrice();
            
            // Call freezeAuction
            console.log('  Sending freezeAuction transaction...');
            const tx = await contract.freezeAuction(reason, {
                gasLimit: 200000,
                gasPrice: gasPrice.mul(120).div(100)
            });

            console.log('  Transaction hash:', tx.hash);
            console.log('  Waiting for confirmation...');

            const receipt = await tx.wait();
            console.log('  freezeAuction completed successfully');

            return {
                success: true,
                transactionHash: receipt.transactionHash,
                mockMode: false
            };
        } catch (error) {
            console.error('freezeAuction failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Unfreeze an auction (admin only)
     * @param {string} contractAddress - The auction contract address
     * @returns {Promise<object>} Transaction result
     */
    async unfreezeAuction(contractAddress) {
        await this.initialize();

        if (this.mockMode) {
            console.log('MOCK MODE: Simulating unfreezeAuction call');
            console.log('  Contract:', contractAddress);
            return {
                success: true,
                transactionHash: '0x' + Array(64).fill(0).map(() => 
                    Math.floor(Math.random() * 16).toString(16)
                ).join(''),
                mockMode: true
            };
        }
        
        console.log('Calling unfreezeAuction on contract:', contractAddress);

        try {
            const contract = new ethers.Contract(contractAddress, AUCTION_ABI, this.wallet);
            
            // Check if frozen
            const frozen = await contract.frozen();
            if (!frozen) {
                console.log('  Auction not frozen');
                return { success: true, notFrozen: true };
            }

            // Get gas price
            const gasPrice = await this.provider.getGasPrice();
            
            // Call unfreezeAuction
            console.log('  Sending unfreezeAuction transaction...');
            const tx = await contract.unfreezeAuction({
                gasLimit: 200000,
                gasPrice: gasPrice.mul(120).div(100)
            });

            console.log('  Transaction hash:', tx.hash);
            console.log('  Waiting for confirmation...');

            const receipt = await tx.wait();
            console.log('  unfreezeAuction completed successfully');

            return {
                success: true,
                transactionHash: receipt.transactionHash,
                mockMode: false
            };
        } catch (error) {
            console.error('unfreezeAuction failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Slash seller bond (admin only, must be frozen first)
     * @param {string} contractAddress - The auction contract address
     * @returns {Promise<object>} Transaction result
     */
    async slashSellerBond(contractAddress) {
        await this.initialize();

        if (this.mockMode) {
            console.log('MOCK MODE: Simulating slashSellerBond call');
            console.log('  Contract:', contractAddress);
            return {
                success: true,
                transactionHash: '0x' + Array(64).fill(0).map(() => 
                    Math.floor(Math.random() * 16).toString(16)
                ).join(''),
                mockMode: true
            };
        }
        
        console.log('Calling slashSellerBond on contract:', contractAddress);

        try {
            const contract = new ethers.Contract(contractAddress, AUCTION_ABI, this.wallet);
            
            // Check if frozen (must be frozen to slash)
            const frozen = await contract.frozen();
            if (!frozen) {
                console.log('  Auction must be frozen first');
                return { success: false, error: 'Auction must be frozen first' };
            }

            // Check if already slashed
            const slashed = await contract.sellerBondSlashed();
            if (slashed) {
                console.log('  Bond already slashed');
                return { success: true, alreadySlashed: true };
            }

            // Get seller bond amount
            const sellerBond = await contract.sellerBond();
            console.log('  Seller bond:', ethers.utils.formatEther(sellerBond), 'ETH');

            // Get gas price
            const gasPrice = await this.provider.getGasPrice();
            
            // Call slashSellerBond
            console.log('  Sending slashSellerBond transaction...');
            const tx = await contract.slashSellerBond({
                gasLimit: 200000,
                gasPrice: gasPrice.mul(120).div(100)
            });

            console.log('  Transaction hash:', tx.hash);
            console.log('  Waiting for confirmation...');

            const receipt = await tx.wait();
            console.log('  slashSellerBond completed successfully');

            return {
                success: true,
                transactionHash: receipt.transactionHash,
                slashedAmount: ethers.utils.formatEther(sellerBond),
                mockMode: false
            };
        } catch (error) {
            console.error('slashSellerBond failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Refund seller bond (admin only, for rejected items)
     * @param {string} contractAddress - The auction contract address
     * @returns {Promise<object>} Transaction result
     */
    async refundBond(contractAddress) {
        await this.initialize();

        if (this.mockMode) {
            console.log('MOCK MODE: Simulating refundBond call');
            console.log('  Contract:', contractAddress);
            return {
                success: true,
                transactionHash: '0x' + Array(64).fill(0).map(() => 
                    Math.floor(Math.random() * 16).toString(16)
                ).join(''),
                mockMode: true
            };
        }
        
        console.log('Calling refundBond on contract:', contractAddress);
        console.log('  Caller (deployer wallet):', this.wallet.address);

        try {
            const contract = new ethers.Contract(contractAddress, AUCTION_ABI, this.wallet);
            
            // Check admin and owner addresses
            const contractAdmin = await contract.admin();
            const contractOwner = await contract.owner();
            console.log('  Contract admin:', contractAdmin);
            console.log('  Contract owner:', contractOwner);
            console.log('  Caller matches admin:', contractAdmin.toLowerCase() === this.wallet.address.toLowerCase());
            console.log('  Caller matches owner:', contractOwner.toLowerCase() === this.wallet.address.toLowerCase());
            
            // Check if bond already returned
            const bondReturned = await contract.sellerBondReturned();
            console.log('  Bond returned:', bondReturned);
            if (bondReturned) {
                console.log('  Bond already returned');
                return { success: true, alreadyReturned: true };
            }

            // Check if bond was slashed
            const bondSlashed = await contract.sellerBondSlashed();
            console.log('  Bond slashed:', bondSlashed);
            if (bondSlashed) {
                console.log('  Bond was slashed, cannot refund');
                return { success: false, error: 'Bond was slashed' };
            }

            // Check if there are any bids
            const highestBid = await contract.highestBid();
            console.log('  Highest bid:', ethers.utils.formatEther(highestBid), 'ETH');
            if (highestBid.gt(0)) {
                console.log('  Cannot refund after bids placed');
                return { success: false, error: 'Cannot refund after bids placed' };
            }

            // Get seller bond amount
            const sellerBond = await contract.sellerBond();
            console.log('  Seller bond:', ethers.utils.formatEther(sellerBond), 'ETH');

            if (sellerBond.eq(0)) {
                console.log('  No bond to refund - bond was never deposited');
                return { success: false, error: 'No bond to refund - bond was never deposited to contract' };
            }
            
            // Check if caller is authorized
            const isAdmin = contractAdmin.toLowerCase() === this.wallet.address.toLowerCase();
            const isOwner = contractOwner.toLowerCase() === this.wallet.address.toLowerCase();
            if (!isAdmin && !isOwner) {
                console.log('  ERROR: Caller is not admin or owner!');
                return { success: false, error: 'Caller is not authorized (not admin or owner)' };
            }

            // Get gas price
            const gasPrice = await this.provider.getGasPrice();
            
            // Call refundBond
            console.log('  Sending refundBond transaction...');
            const tx = await contract.refundBond({
                gasLimit: 200000,
                gasPrice: gasPrice.mul(120).div(100)
            });

            console.log('  Transaction hash:', tx.hash);
            console.log('  Waiting for confirmation...');

            const receipt = await tx.wait();
            console.log('  refundBond completed successfully');

            return {
                success: true,
                transactionHash: receipt.transactionHash,
                refundedAmount: ethers.utils.formatEther(sellerBond),
                mockMode: false
            };
        } catch (error) {
            console.error('refundBond failed:', error.message);
            
            // Try to extract transaction hash from error if available
            let txHash = null;
            if (error.transactionHash) {
                txHash = error.transactionHash;
            } else if (error.receipt && error.receipt.transactionHash) {
                txHash = error.receipt.transactionHash;
            }
            
            return { 
                success: false, 
                error: error.message,
                transactionHash: txHash
            };
        }
    }
}

const deployer = new ContractDeployer();

module.exports = deployer;
