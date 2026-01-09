// Auction Room JavaScript - Live Bidding

// =============================================
// GLOBAL STATE
// =============================================

let socket = null;
let provider = null;
let signer = null;
let contract = null;
let userWalletAddress = null;
let auctionId = null;
let contractAddress = null;
let auctionEnded = false;
let auctionFrozen = false;
let minBid = 0.0001;
let currentHighestBid = 0;
let currentHighestBidder = null;
let itemData = null;
let isAdminViewer = false;
let isSellerViewer = false;

// Penalty constants
const PENALTY_RATE = 0.015; // 1.5%
const MIN_PENALTY = 0.0001; // 0.0001 ETH

// Contract ABI
const CONTRACT_ABI = [
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "total", "type": "uint256" }], "name": "BidPlaced", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "total", "type": "uint256" }], "name": "NewHighBid", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "grossAmount", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "penalty", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "netAmount", "type": "uint256" }], "name": "Withdrawn", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "winner", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "AuctionEnded", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "admin", "type": "address" }, { "indexed": false, "internalType": "string", "name": "reason", "type": "string" }], "name": "AuctionFrozen", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "admin", "type": "address" }], "name": "AuctionUnfrozen", "type": "event" },
    { "inputs": [], "name": "auctionEndTime", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "highestBid", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "highestBidder", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "bids", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "bid", "outputs": [], "stateMutability": "payable", "type": "function" },
    { "inputs": [], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "frozen", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "sellerBond", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "ended", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "uint256", "name": "bidAmount", "type": "uint256" }], "name": "calculatePenalty", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "pure", "type": "function" }
];

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    auctionId = urlParams.get('id');

    if (!auctionId) {
        showToast('error', 'Error', 'No auction ID provided');
        setTimeout(() => window.location.href = '/buyer/dashboard.html', 2000);
        return;
    }

    const token = localStorage.getItem('auction_token');
    if (!token) {
        window.location.href = '/signin.html';
        return;
    }

    // Check if user is admin (view-only mode)
    try {
        const res = await fetch('/api/role/current', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.ok && data.isAdmin) {
            isAdminViewer = true;
            // Hide wallet status for admin
            const navbarWalletStatus = document.getElementById('navbarWalletStatus');
            if (navbarWalletStatus) navbarWalletStatus.style.display = 'none';
            
            // Load auction details and show view-only panel
            await loadAuctionDetails();
            initSocket();
            showAdminViewOnlyPanel();
            return;
        }
    } catch (err) {
        console.error('Failed to check admin status:', err);
    }

    // Check if wallet is connected - user must connect from dashboard first
    if (!window.ethereum) {
        showToast('error', 'MetaMask Required', 'Please install MetaMask to participate in auctions');
        setTimeout(() => window.location.href = '/buyer/dashboard.html', 2000);
        return;
    }

    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length === 0) {
        showToast('error', 'Wallet Not Connected', 'Please connect your wallet from the Dashboard first');
        setTimeout(() => window.location.href = '/buyer/dashboard.html', 2000);
        return;
    }

    // Wallet is connected, initialize
    userWalletAddress = accounts[0];
    
    await loadAuctionDetails();
    
    // Check if user is the seller of this auction (view-only mode)
    if (itemData && itemData.sellerWallet && 
        userWalletAddress.toLowerCase() === itemData.sellerWallet.toLowerCase()) {
        isSellerViewer = true;
        await initWalletAndContract();
        initSocket();
        updateNavbarWallet(userWalletAddress);
        showSellerViewOnlyPanel();
        return;
    }
    
    await initWalletAndContract();
    initSocket();
    updateNavbarWallet(userWalletAddress);
    showBidderPanel();

    // Listen for account changes
    window.ethereum.on('accountsChanged', handleAccountChange);
});

// =============================================
// LOAD AUCTION DETAILS
// =============================================

async function loadAuctionDetails() {
    try {
        const res = await fetch(`/api/auction-details?id=${auctionId}`);
        const data = await res.json();

        if (!data.ok) {
            showToast('error', 'Error', data.error || 'Auction not found');
            setTimeout(() => window.location.href = '/buyer/dashboard.html', 2000);
            return;
        }

        contractAddress = data.contractAddress;
        minBid = data.minBid || 0.0001;
        // Round to 4 decimals to avoid floating point precision issues
        currentHighestBid = data.highestBid ? Math.round(data.highestBid * 10000) / 10000 : 0;
        // Don't set bidder to '-' (server uses '-' for no bidder)
        currentHighestBidder = (data.highestBidder && data.highestBidder !== '-') ? data.highestBidder : null;
        // Use ended status from server (based on biddingTime/database, not blockchain)
        auctionEnded = data.ended || false;
        auctionFrozen = data.frozen || false;
        itemData = data.item;

        if (itemData) {
            document.getElementById('auctionTitle').innerHTML = `<i class="fas fa-gavel"></i> ${escapeHtml(itemData.name)}`;
            document.getElementById('itemDescription').textContent = itemData.description;
            document.getElementById('itemImage').src = getImageUrl(itemData.imageCID);
            
            // Check if item is frozen from database status
            if (itemData.status === 'FROZEN' || itemData.status === 'SLASHED') {
                auctionFrozen = true;
                // FROZEN items are NEVER ended - their timer is paused
                auctionEnded = false;
            }
        }

        document.getElementById('startingPrice').textContent = `${minBid} ETH`;
        
        // Update bid display based on state
        updateBidDisplay();

        // Show frozen banner and disable bidding if auction is frozen
        if (auctionFrozen) {
            showFrozenBanner(itemData?.freezeReason || 'This auction has been frozen by admin');
            updateBidderPanelForFrozen();
            // Update timer to show paused state with biddingTime
            const pausedTime = data.biddingTime || data.timeLeft || 0;
            updateTimer(pausedTime, false);
        } else if (!auctionEnded) {
            // For LIVE auctions, show initial timer from server's timeLeft
            const initialTimeLeft = data.timeLeft || 0;
            updateTimer(initialTimeLeft, initialTimeLeft <= 0);
        }

        if (auctionEnded || data.sold) {
            showAuctionEnded(data);
        }
    } catch (err) {
        console.error('Failed to load auction details:', err);
        showToast('error', 'Error', 'Failed to load auction details');
    }
}

function updateBidDisplay() {
    const bidLabelEl = document.getElementById('currentBidLabel');
    const bidValueEl = document.getElementById('currentHighestBid');
    const bidderSectionEl = document.getElementById('highestBidderRow');
    const bidderAddressEl = document.getElementById('highestBidderAddress');

    if (auctionEnded) {
        // Change label to "Final Bid" when auction ended
        if (bidLabelEl) {
            bidLabelEl.innerHTML = '<i class="fas fa-flag-checkered"></i> Final Bid';
        }
        if (bidValueEl) {
            bidValueEl.textContent = currentHighestBid > 0 ? `${currentHighestBid} ETH` : '0 ETH';
            bidValueEl.classList.add('final');
            bidValueEl.classList.remove('no-bids');
        }
    } else if (currentHighestBid > 0) {
        // Show current highest bid - ensure proper classes for animation
        if (bidLabelEl) {
            bidLabelEl.innerHTML = '<i class="fas fa-fire"></i> Current Highest Bid';
        }
        if (bidValueEl) {
            bidValueEl.textContent = `${currentHighestBid} ETH`;
            // Remove classes that might interfere with animation
            bidValueEl.classList.remove('final', 'no-bids');
            // Ensure the element has the correct classes for blinking animation
            bidValueEl.classList.add('price-value', 'highest');
        }
    } else {
        // No bids yet - hide the bid section or show "No bids yet"
        if (bidLabelEl) {
            bidLabelEl.innerHTML = '<i class="fas fa-hourglass-start"></i> Status';
        }
        if (bidValueEl) {
            bidValueEl.textContent = 'No bids yet';
            bidValueEl.classList.add('no-bids');
            bidValueEl.classList.remove('final', 'highest');
        }
    }

    // Update highest bidder display (separate section)
    if (bidderSectionEl && bidderAddressEl) {
        // Show bidder section only if we have a valid bidder address (not null, not '-', not empty)
        if (currentHighestBidder && currentHighestBidder !== '-' && currentHighestBid > 0) {
            bidderSectionEl.style.display = 'flex';
            bidderAddressEl.textContent = currentHighestBidder; // Full address
        } else {
            bidderSectionEl.style.display = 'none';
        }
    }
}

// =============================================
// SOCKET.IO
// =============================================

function initSocket() {
    const token = localStorage.getItem('auction_token');
    const user = JSON.parse(localStorage.getItem('auction_user') || '{}');

    socket = io({
        query: {
            id: auctionId,
            name: user.name || user.email || 'Anonymous',
            walletAddress: userWalletAddress || ''
        },
        auth: { token }
    });

    socket.on('connect', () => {
        console.log('Connected to auction room:', auctionId);
    });

    socket.on('highestBidUpdate', (data) => {
        if (data.auctionId === auctionId || data.auctionId === contractAddress) {
            // Round to 4 decimals to avoid floating point precision issues
            currentHighestBid = data.amount ? Math.round(data.amount * 10000) / 10000 : 0;
            // Server sends 'bidderName' field, not 'bidder'
            // Only update if we have a valid bidder value (not '-' or empty)
            const newBidder = data.bidderName || data.bidder;
            if (newBidder && newBidder !== '-') {
                currentHighestBidder = newBidder;
            }
            updateBidDisplay();
        }
    });

    socket.on('timerUpdate', (data) => {
        if (data.id === auctionId || data.id === contractAddress) {
            // Handle frozen state from server
            if (data.frozen) {
                auctionFrozen = true;
                auctionEnded = false; // FROZEN items are NEVER ended
            }
            updateTimer(data.seconds, data.ended);
        }
    });

    socket.on('auctionFinalized', (data) => {
        if (data.auctionId === auctionId || data.auctionId === contractAddress) {
            // Show auction ended UI
            showAuctionEnded(data);
            
            // Auto redirect to dashboard after showing the result
            if (!redirectPending) {
                redirectPending = true;
                showToast('info', 'Auction Finalized', 'Redirecting to dashboard...');
                setTimeout(() => {
                    window.location.href = '/buyer/dashboard.html';
                }, 5000); // Give user 5 seconds to see the result
            }
        }
    });

    // Listen for auction frozen event
    socket.on('auctionFrozen', (data) => {
        if (data.auctionId === auctionId || data.auctionId === contractAddress) {
            auctionFrozen = true;
            auctionEnded = false; // FROZEN items are NEVER ended
            showFrozenBanner(data.reason || 'This auction has been frozen by admin');
            showToast('warning', 'Auction Frozen', 'This auction has been frozen. Bidding is disabled. Timer paused.');
            updateBidderPanelForFrozen();
            // Update timer to show paused state with biddingTime
            const pausedTime = data.biddingTime || data.remainingTime || 0;
            updateTimer(pausedTime, false);
        }
    });

    // Listen for auction unfrozen event
    socket.on('auctionUnfrozen', (data) => {
        if (data.auctionId === auctionId || data.auctionId === contractAddress) {
            auctionFrozen = false;
            auctionEnded = false; // Reset ended flag when unfrozen
            hideFrozenBanner();
            
            // Calculate remaining time from biddingTime
            const remainingSeconds = data.biddingTime || 0;
            const remainingMin = remainingSeconds > 0 ? Math.ceil(remainingSeconds / 60) : 0;
            const remainingMsg = remainingMin > 0 ? ` (${remainingMin} minutes remaining)` : '';
            showToast('success', 'Auction Resumed', `This auction has been unfrozen. Bidding is enabled.${remainingMsg}`);
            
            // Update timer with biddingTime from server
            updateTimer(remainingSeconds, false);
            
            showBidderPanel(); // Re-enable bidding
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from auction room');
    });
}


// =============================================
// WALLET CONNECTION
// =============================================

async function initWalletAndContract() {
    try {
        // Check network
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId !== '0xaa36a7') {
            showToast('warning', 'Wrong Network', 'Please switch to Sepolia testnet');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0xaa36a7' }]
                });
            } catch (switchError) {
                console.error('Failed to switch network:', switchError);
            }
        }

        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();
        contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
    } catch (err) {
        console.error('Failed to initialize wallet:', err);
        showToast('error', 'Error', 'Failed to initialize wallet connection');
    }
}

function handleAccountChange(accounts) {
    if (accounts.length === 0) {
        // Wallet disconnected, redirect to dashboard
        showToast('warning', 'Wallet Disconnected', 'Redirecting to dashboard...');
        setTimeout(() => window.location.href = '/buyer/dashboard.html', 2000);
    } else {
        userWalletAddress = accounts[0];
        updateNavbarWallet(userWalletAddress);
        // Reinitialize contract with new signer
        initWalletAndContract();
    }
}

function updateNavbarWallet(address) {
    const navbarWalletAddress = document.getElementById('navbarWalletAddress');
    const navbarWalletStatus = document.getElementById('navbarWalletStatus');

    if (address) {
        navbarWalletAddress.textContent = shortAddress(address);
        navbarWalletStatus.classList.add('connected');
        navbarWalletStatus.classList.remove('disconnected');
    } else {
        navbarWalletAddress.textContent = 'Not Connected';
        navbarWalletStatus.classList.remove('connected');
        navbarWalletStatus.classList.add('disconnected');
    }
}


// =============================================
// BIDDER PANEL
// =============================================

function showBidderPanel() {
    if (auctionEnded) return;
    if (isAdminViewer) return; // Admin cannot bid

    const bidActionBox = document.getElementById('bidActionBox');
    const template = document.getElementById('bidder-panel-template');
    bidActionBox.innerHTML = template.innerHTML;

    const bidButton = document.getElementById('bidButton');
    if (bidButton) {
        bidButton.addEventListener('click', placeBid);
    }

    const withdrawButton = document.getElementById('withdrawButton');
    if (withdrawButton) {
        withdrawButton.addEventListener('click', withdrawBid);
    }

    const bidInput = document.getElementById('bidAmount');
    if (bidInput) {
        bidInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') placeBid();
        });
    }

    // If auction is frozen, update panel to show frozen state
    if (auctionFrozen) {
        updateBidderPanelForFrozen();
    }
}

function updateBidderPanelForFrozen() {
    const bidButton = document.getElementById('bidButton');
    const bidInput = document.getElementById('bidAmount');
    
    if (bidButton) {
        bidButton.disabled = true;
        bidButton.innerHTML = '<i class="fas fa-ban"></i> Bidding Disabled';
        bidButton.classList.add('disabled');
    }
    
    if (bidInput) {
        bidInput.disabled = true;
        bidInput.placeholder = 'Auction frozen';
    }
    
    // Withdraw button also disabled for frozen auctions
    const withdrawButton = document.getElementById('withdrawButton');
    if (withdrawButton) {
        withdrawButton.disabled = true;
        withdrawButton.innerHTML = '<i class="fas fa-ban"></i> Withdraw Disabled';
        withdrawButton.classList.add('disabled');
        withdrawButton.style.background = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
        withdrawButton.style.boxShadow = 'none';
        withdrawButton.style.cursor = 'not-allowed';
    }
}

function showFrozenBanner(reason) {
    // Remove existing banner if any
    hideFrozenBanner();
    
    const banner = document.createElement('div');
    banner.id = 'frozenBanner';
    banner.className = 'frozen-banner';
    banner.innerHTML = `
        <div class="frozen-banner-content">
            <i class="fas fa-snowflake"></i>
            <div class="frozen-banner-text">
                <strong>Auction Frozen</strong>
                <span>${escapeHtml(reason)}</span>
            </div>
        </div>
    `;
    
    // Insert after auction header
    const auctionHeader = document.querySelector('.auction-header');
    if (auctionHeader) {
        auctionHeader.insertAdjacentElement('afterend', banner);
    } else {
        document.body.insertBefore(banner, document.body.firstChild);
    }
    
    // Update status badge
    const statusEl = document.getElementById('auctionStatus');
    if (statusEl) {
        statusEl.textContent = 'Frozen';
        statusEl.classList.add('frozen');
    }
}

function hideFrozenBanner() {
    const banner = document.getElementById('frozenBanner');
    if (banner) {
        banner.remove();
    }
    
    // Reset status badge
    const statusEl = document.getElementById('auctionStatus');
    if (statusEl) {
        statusEl.textContent = 'Live';
        statusEl.classList.remove('frozen');
    }
}

function showAdminViewOnlyPanel() {
    const bidActionBox = document.getElementById('bidActionBox');
    bidActionBox.innerHTML = `
        <div class="admin-view-only-panel">
            <div class="view-only-badge">
                <i class="fas fa-eye"></i>
                <span>View Only Mode</span>
            </div>
            <p>You are viewing as Admin<br> Bidding is not allowed</p>
            <a href="/admin/dashboard.html" class="btn btn-back-admin">
                <i class="fas fa-arrow-left"></i> Back to Admin Dashboard
            </a>
        </div>
    `;
}

function showSellerViewOnlyPanel() {
    const bidActionBox = document.getElementById('bidActionBox');
    bidActionBox.innerHTML = `
        <div class="seller-view-only-panel">
            <div class="view-only-badge seller">
                <i class="fas fa-store"></i>
                <span>Seller View Mode</span>
            </div>
            <p>This is your auction<br>You cannot bid on your own items</p>
            <a href="/seller/dashboard.html" class="btn btn-back-seller">
                <i class="fas fa-arrow-left"></i> Back to Seller Dashboard
            </a>
        </div>
    `;
}

// =============================================
// BIDDING FUNCTIONS
// =============================================

async function placeBid() {
    if (!contract || !signer) {
        showToast('error', 'Error', 'Wallet not connected');
        return;
    }

    // Check if auction is frozen
    try {
        const frozen = await contract.frozen();
        if (frozen) {
            showToast('error', 'Auction Frozen', 'This auction has been frozen by admin. Bidding is disabled.');
            return;
        }
    } catch (e) {
        console.log('Could not check frozen status:', e.message);
    }

    const bidInput = document.getElementById('bidAmount');
    const bidValue = bidInput.value;
    const bidAmount = parseFloat(bidValue);

    if (!bidAmount || bidAmount <= 0) {
        showToast('error', 'Invalid Bid', 'Please enter a valid bid amount');
        return;
    }

    // Validate maximum 3 decimal places
    if (bidValue.includes('.')) {
        const decimals = bidValue.split('.')[1];
        if (decimals && decimals.length > 3) {
            showToast('error', 'Too Many Decimals', 'Maximum 3 decimal places allowed (e.g., 0.001)');
            return;
        }
    }

    const minRequired = currentHighestBid > 0 ? currentHighestBid : minBid;

    let userCurrentBid = 0;
    try {
        const userBidBn = await contract.bids(userWalletAddress);
        userCurrentBid = parseFloat(ethers.utils.formatEther(userBidBn));
    } catch (e) {
        console.error('Error getting user bid:', e);
    }

    const newTotal = userCurrentBid + bidAmount;

    const highestBidder = await contract.highestBidder();
    if (highestBidder.toLowerCase() !== userWalletAddress.toLowerCase() && newTotal <= minRequired) {
        showToast('error', 'Bid Too Low', `Your total bid must exceed ${minRequired} ETH`);
        return;
    }

    showLoading('Placing bid...');

    try {
        const tx = await contract.bid({
            value: ethers.utils.parseEther(bidAmount.toString())
        });

        showLoading('Confirming transaction...');
        await tx.wait();

        // Fetch actual data from blockchain to avoid floating point issues
        showLoading('Syncing data...');
        
        const [hbBn, hAddr] = await Promise.all([
            contract.highestBid(),
            contract.highestBidder()
        ]);
        
        // Use proper formatting to avoid floating point precision issues
        const actualHighestBid = parseFloat(ethers.utils.formatEther(hbBn));
        currentHighestBid = Math.round(actualHighestBid * 10000) / 10000; // Round to 4 decimals
        currentHighestBidder = hAddr;
        
        updateBidDisplay();

        hideLoading();
        showToast('success', 'Bid Placed!', `You bid ${bidAmount} ETH (Total: ${currentHighestBid} ETH)`);
        bidInput.value = '';

        // Emit event to server to sync with other clients and database
        if (socket) {
            socket.emit('bidPlaced', {
                auctionId: contractAddress,
                amount: currentHighestBid,
                bidder: currentHighestBidder
            });
        }

    } catch (err) {
        hideLoading();
        console.error('Bid error:', err);

        if (err.code === 4001) {
            showToast('warning', 'Cancelled', 'Transaction was cancelled');
        } else if (err.message.includes('Bid too low')) {
            showToast('error', 'Bid Too Low', 'Your bid must exceed the current highest bid');
        } else if (err.message.includes('Auction ended')) {
            showToast('error', 'Auction Ended', 'This auction has already ended');
            showAuctionEnded({});
        } else {
            showToast('error', 'Bid Failed', err.reason || err.message || 'Transaction failed');
        }
    }
}

async function withdrawBid() {
    if (!contract || !signer) {
        showToast('error', 'Error', 'Wallet not connected');
        return;
    }

    let userBid = 0;
    try {
        const userBidBn = await contract.bids(userWalletAddress);
        userBid = parseFloat(ethers.utils.formatEther(userBidBn));
    } catch (e) {
        console.error('Error getting user bid:', e);
    }

    if (userBid <= 0) {
        showToast('warning', 'No Bids', 'You have no bids to withdraw');
        return;
    }

    const highestBidder = await contract.highestBidder();
    if (highestBidder.toLowerCase() === userWalletAddress.toLowerCase()) {
        showToast('error', 'Cannot Withdraw', 'Highest bidder cannot withdraw');
        return;
    }

    // Calculate penalty (1.5% with 0.0001 ETH minimum)
    let calculatedPenalty = userBid * PENALTY_RATE;
    const penalty = Math.max(calculatedPenalty, MIN_PENALTY);
    const netAmount = userBid - penalty;

    // Show confirmation with penalty info
    const confirmed = await showConfirmModal(
        'Withdraw Bid?',
        `Withdraw ${userBid.toFixed(4)} ETH?\n\nPenalty (1.5%): ${penalty.toFixed(4)} ETH\nYou receive: ${netAmount.toFixed(4)} ETH`,
        'Withdraw',
        'warning'
    );
    if (!confirmed) return;

    showLoading('Withdrawing bid...');

    try {
        const tx = await contract.withdraw();

        showLoading('Confirming withdrawal...');
        await tx.wait();

        hideLoading();
        showToast('success', 'Withdrawn!', `Gross: ${userBid.toFixed(4)} ETH | Penalty: ${penalty.toFixed(4)} ETH | Net: ${netAmount.toFixed(4)} ETH`);

    } catch (err) {
        hideLoading();
        console.error('Withdraw error:', err);

        if (err.code === 4001) {
            showToast('warning', 'Cancelled', 'Transaction was cancelled');
        } else if (err.message.includes('Highest bidder')) {
            showToast('error', 'Cannot Withdraw', 'Highest bidder cannot withdraw');
        } else {
            showToast('error', 'Withdraw Failed', err.reason || err.message || 'Transaction failed');
        }
    }
}

// =============================================
// TIMER
// =============================================

let redirectPending = false; // Flag to prevent multiple redirects

function updateTimer(seconds, ended) {
    const timerEl = document.getElementById('timer');
    const statusEl = document.getElementById('auctionStatus');

    // If auction is frozen, show paused state with remaining time
    if (auctionFrozen) {
        // Show remaining time when paused (format: HH:MM:SS PAUSED)
        if (seconds > 0) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            timerEl.innerHTML = `<i class="fas fa-pause-circle"></i> ${timeStr} PAUSED`;
        } else {
            timerEl.innerHTML = '<i class="fas fa-pause-circle"></i> PAUSED';
        }
        timerEl.classList.add('frozen');
        timerEl.classList.remove('ended', 'urgent');
        statusEl.textContent = 'Frozen';
        statusEl.classList.add('frozen');
        statusEl.classList.remove('ended');
        return;
    }

    if (ended || seconds <= 0) {
        timerEl.innerHTML = '<i class="fas fa-flag-checkered"></i> ENDED';
        timerEl.classList.add('ended');
        timerEl.classList.remove('frozen');
        statusEl.textContent = 'Auction Ended';
        statusEl.classList.add('ended');
        statusEl.classList.remove('frozen');
        
        // Only trigger redirect if auction just ended (not already ended on load)
        if (!auctionEnded && !redirectPending) {
            auctionEnded = true;
            redirectPending = true;
            
            // Show notification and redirect to dashboard
            showToast('info', 'Auction Ended', 'This auction has ended. Redirecting to dashboard...');
            
            // Redirect after 3 seconds to let user see the message
            setTimeout(() => {
                window.location.href = '/buyer/dashboard.html';
            }, 3000);
        }
        
        auctionEnded = true;
        return;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    timerEl.innerHTML = `<i class="fas fa-clock"></i> ${timeStr}`;
    timerEl.classList.remove('frozen', 'ended');

    if (seconds < 300) {
        timerEl.classList.add('urgent');
    } else {
        timerEl.classList.remove('urgent');
    }

    statusEl.textContent = 'Live';
    statusEl.classList.remove('ended', 'frozen');
}

// =============================================
// AUCTION ENDED
// =============================================

function showAuctionEnded(data) {
    auctionEnded = true;
    
    const timerEl = document.getElementById('timer');
    timerEl.innerHTML = '<i class="fas fa-flag-checkered"></i> ENDED';
    timerEl.classList.add('ended');

    // Update bid display to show "Final Bid"
    updateBidDisplay();

    // Redirect to dashboard
    if (!redirectPending) {
        redirectPending = true;
        showToast('info', 'Auction Ended', 'Redirecting to dashboard...');
        setTimeout(() => {
            window.location.href = '/buyer/dashboard.html';
        }, 3000);
    }
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

function shortAddress(address) {
    if (!address) return '--';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getImageUrl(imageCID) {
    if (!imageCID) return '';
    if (imageCID.startsWith('http')) return imageCID;
    return `https://gateway.pinata.cloud/ipfs/${imageCID}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =============================================
// LOADING OVERLAY
// =============================================

function showLoading(text = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    if (loadingText) loadingText.textContent = text;
    if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================

function showToast(type, title, message) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? 'fa-check-circle' :
        type === 'error' ? 'fa-exclamation-circle' :
        type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';

    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas ${icon}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="closeToast(this)">&times;</button>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function closeToast(btn) {
    const toast = btn.parentElement;
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
}

window.closeToast = closeToast;

// =============================================
// CUSTOM CONFIRMATION MODAL
// =============================================

/**
 * Show custom confirmation modal (replaces browser confirm())
 */
function showConfirmModal(title, message, confirmText = 'Confirm', type = 'warning') {
    return new Promise((resolve) => {
        const existingModal = document.getElementById('confirmModal');
        if (existingModal) existingModal.remove();

        const colorMap = {
            warning: '#f59e0b',
            danger: '#ef4444',
            info: '#3b82f6',
            success: '#10b981'
        };

        const iconMap = {
            warning: 'fa-exclamation-triangle',
            danger: 'fa-exclamation-circle',
            info: 'fa-info-circle',
            success: 'fa-check-circle'
        };

        const modal = document.createElement('div');
        modal.id = 'confirmModal';
        modal.style.cssText = 'display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 10000;';
        modal.innerHTML = `
            <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98)); border-radius: 16px; padding: 2rem; max-width: 400px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 3rem; margin-bottom: 1rem; color: ${colorMap[type]}">
                    <i class="fas ${iconMap[type]}"></i>
                </div>
                <h3 style="font-size: 1.25rem; font-weight: 600; color: #f1f5f9; margin-bottom: 0.75rem;">${title}</h3>
                <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin-bottom: 1.5rem;">${message.replace(/\n/g, '<br>')}</p>
                <div style="display: flex; gap: 0.75rem; justify-content: center;">
                    <button id="confirmModalCancel" style="background: rgba(100, 116, 139, 0.3); border: 1px solid rgba(100, 116, 139, 0.5); color: #cbd5e1; padding: 0.625rem 1.25rem; border-radius: 8px; cursor: pointer; font-weight: 500;">Cancel</button>
                    <button id="confirmModalConfirm" style="background: ${type === 'danger' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #a855f7, #ec4899)'}; border: none; color: white; padding: 0.625rem 1.25rem; border-radius: 8px; cursor: pointer; font-weight: 500;">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('confirmModalConfirm').addEventListener('click', () => {
            modal.remove();
            resolve(true);
        });

        document.getElementById('confirmModalCancel').addEventListener('click', () => {
            modal.remove();
            resolve(false);
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        });
    });
}
