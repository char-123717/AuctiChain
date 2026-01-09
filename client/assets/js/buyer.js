// Buyer Dashboard JavaScript

let allItems = [];
let endedItems = [];
let slashedItems = [];
let currentTab = 'available';
let sidebarOpen = false;
let socket = null;
let userWalletAddress = null;
let walletConnected = false;
let isAdminViewer = false;

// Contract ABI for withdraw functionality and frozen check
const CONTRACT_ABI = [
    { "inputs": [], "name": "highestBidder", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "bids", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "withdrawSlashed", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "ended", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "frozen", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "sellerBond", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "sellerBondSlashed", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "uint256", "name": "bidAmount", "type": "uint256" }], "name": "calculatePenalty", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "pure", "type": "function" }
];

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    initTabs();
    initSidebar();
    initSearch();
    loadItems();
    initSocket();
    // Note: initWalletConnection is called after checkAuth completes
});

// =============================================
// AUTHENTICATION
// =============================================

async function checkAuth() {
    const token = localStorage.getItem('auction_token');
    const user = JSON.parse(localStorage.getItem('auction_user') || 'null');

    if (!token || !user) {
        window.location.href = '/signin.html';
        return;
    }

    try {
        const res = await fetch('/api/role/current', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.ok) {
            window.location.href = '/signin.html';
            return;
        }

        // Admin can view buyer dashboard (view-only mode)
        if (data.isAdmin) {
            isAdminViewer = true;
            document.getElementById('adminBanner').style.display = 'flex';
            document.getElementById('dashboardTitle').textContent = 'Buyer Dashboard (View Only)';
            
            // Hide wallet button for admin
            const connectWalletBtn = document.getElementById('connectWalletBtn');
            if (connectWalletBtn) connectWalletBtn.style.display = 'none';
        }

        // Check if user has buyer role (or is admin)
        if (data.role !== 'buyer' && !data.isAdmin) {
            window.location.href = '/role-select.html';
            return;
        }

        document.getElementById('userName').textContent = user.name || user.email;
        
        // Initialize wallet connection after auth check (only for non-admin)
        initWalletConnection();
    } catch (err) {
        console.error('Auth check failed:', err);
        window.location.href = '/signin.html';
    }

    // Back button handler - redirect based on role
    document.getElementById('backBtn').addEventListener('click', async () => {
        if (isAdminViewer) {
            window.location.href = '/admin/dashboard.html';
        } else {
            // Disconnect wallet before going back to role-select
            if (window.ethereum && walletConnected) {
                try {
                    // Revoke wallet permissions to force disconnect
                    await window.ethereum.request({
                        method: 'wallet_revokePermissions',
                        params: [{ eth_accounts: {} }]
                    });
                } catch (err) {
                    // Some wallets don't support revokePermissions, just reset local state
                    console.log('Wallet disconnect:', err.message);
                }
                userWalletAddress = null;
                walletConnected = false;
            }
            window.location.href = '/role-select.html';
        }
    });
}

// =============================================
// TAB NAVIGATION
// =============================================

function initTabs() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tabName) {
    currentTab = tabName;

    // Update menu items
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    if (tabName === 'available') {
        document.getElementById('availableTab').classList.add('active');
    } else if (tabName === 'ended') {
        document.getElementById('endedTab').classList.add('active');
    } else if (tabName === 'slashed') {
        document.getElementById('slashedTab').classList.add('active');
    }

    renderItems();
}

// =============================================
// SEARCH & FILTER
// =============================================

function initSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchInputEnded = document.getElementById('searchInputEnded');
    const searchInputSlashed = document.getElementById('searchInputSlashed');
    const sortBy = document.getElementById('sortBy');
    let debounceTimer;

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(renderItems, 300);
        });
    }

    if (searchInputEnded) {
        searchInputEnded.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(renderItems, 300);
        });
    }

    if (searchInputSlashed) {
        searchInputSlashed.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(renderItems, 300);
        });
    }

    if (sortBy) {
        sortBy.addEventListener('change', renderItems);
    }
}

// =============================================
// SOCKET.IO FOR REAL-TIME UPDATES
// =============================================

function initSocket() {
    const token = localStorage.getItem('auction_token');
    
    socket = io({
        query: { id: 'lobby' },
        auth: { token }
    });

    socket.on('connect', () => {
        console.log('Connected to auction lobby');
    });

    socket.on('auctionStateUpdate', (data) => {
        updateAuctionState(data);
    });

    // Listen for auction frozen event
    socket.on('auctionFrozen', (data) => {
        const item = allItems.find(i => 
            i.auctionId === data.auctionId || 
            i.contractAddress === data.auctionId
        );
        if (item) {
            item.status = 'FROZEN';
            item.freezeReason = data.reason;
            // Save biddingTime (remaining seconds) when frozen
            if (data.biddingTime !== undefined) {
                item.biddingTime = data.biddingTime;
                item.timeLeft = data.biddingTime; // Keep timeLeft at frozen value
            } else if (data.remainingTime !== undefined) {
                item.biddingTime = data.remainingTime;
                item.timeLeft = data.remainingTime;
            }
            renderItems();
            showToast('warning', 'Auction Frozen', `"${item.name}" has been frozen by admin`);
        }
    });

    // Listen for auction unfrozen event
    socket.on('auctionUnfrozen', (data) => {
        console.log('auctionUnfrozen event received:', data);
        
        // Try to find item by contractAddress or itemId in allItems
        let item = allItems.find(i => 
            i.contractAddress === data.auctionId ||
            i.auctionId === data.auctionId ||
            i.id === data.itemId
        );
        
        // Also check in endedItems (item might have been moved there)
        if (!item) {
            item = endedItems.find(i => 
                i.contractAddress === data.auctionId ||
                i.auctionId === data.auctionId ||
                i.id === data.itemId
            );
            
            if (item) {
                console.log('Found item in endedItems, moving to allItems');
                // Remove from endedItems
                endedItems = endedItems.filter(i => i.id !== item.id);
                // Add to allItems
                allItems.push(item);
            }
        }
        
        if (item) {
            console.log('Found item:', item.name);
            item.status = 'LIVE';
            item.freezeReason = null;
            item.ended = false; // Reset ended flag
            // Update auctionEndTime with new value from server
            if (data.newAuctionEndTime) {
                item.auctionEndTime = data.newAuctionEndTime;
                console.log('Updated auctionEndTime to:', data.newAuctionEndTime);
            }
            // Update timeLeft based on biddingTime from server
            if (data.biddingTime !== undefined) {
                item.timeLeft = data.biddingTime;
                item.biddingTime = data.biddingTime;
                console.log('Updated timeLeft to:', data.biddingTime);
            } else if (data.newAuctionEndTime) {
                // Calculate timeLeft from new auctionEndTime
                const now = Math.floor(Date.now() / 1000);
                item.timeLeft = data.newAuctionEndTime - now;
                console.log('Calculated timeLeft:', item.timeLeft);
            }
            renderItems();
            renderEndedItems();
            showToast('success', 'Auction Resumed', `"${item.name}" has been unfrozen`);
        } else {
            // Item not found anywhere, reload from server
            console.log('Item not found, reloading from server...');
            loadItems();
        }
    });

    // Listen for auction slashed event
    socket.on('auctionSlashed', (data) => {
        console.log('auctionSlashed event received:', data);
        
        // Try to find item in allItems or endedItems
        let item = allItems.find(i => 
            i.contractAddress === data.auctionId ||
            i.auctionId === data.auctionId ||
            i.id === data.itemId
        );
        
        let fromAllItems = !!item;
        
        if (!item) {
            item = endedItems.find(i => 
                i.contractAddress === data.auctionId ||
                i.auctionId === data.auctionId ||
                i.id === data.itemId
            );
        }
        
        if (item) {
            console.log('Found item:', item.name);
            item.status = 'SLASHED';
            item.slashReason = data.reason;
            
            // Remove from current array
            if (fromAllItems) {
                allItems = allItems.filter(i => i.id !== item.id);
            } else {
                endedItems = endedItems.filter(i => i.id !== item.id);
            }
            
            // Add to slashedItems
            if (!slashedItems.find(i => i.id === item.id)) {
                slashedItems.unshift(item);
            }
            
            renderItems();
            updateSidebarCounts();
            showToast('warning', 'Auction Slashed', `"${item.name}" has been slashed - you can withdraw your bid`);
        } else {
            // Item not found, reload from server
            console.log('Item not found, reloading from server...');
            loadItems();
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from lobby');
    });
}

function updateAuctionState(data) {
    // Update item in allItems array
    let item = allItems.find(i => 
        i.auctionId === data.auctionId || 
        i.contractAddress === data.auctionId
    );
    
    // Also check in endedItems (for items that just ended)
    if (!item) {
        item = endedItems.find(i => 
            i.auctionId === data.auctionId || 
            i.contractAddress === data.auctionId
        );
    }

    if (item) {
        if (data.highestBid !== undefined) {
            // Round to 4 decimals to avoid floating point precision issues
            item.currentBid = Math.round(data.highestBid * 10000) / 10000;
            item.highestBid = item.currentBid;
        }
        if (data.highestBidder !== undefined) {
            item.highestBidder = data.highestBidder;
        }
        
        // Handle frozen state from server
        if (data.frozen !== undefined && data.frozen === true) {
            if (item.status !== 'FROZEN') {
                item.status = 'FROZEN';
            }
            // For frozen items, use biddingTime (remaining seconds)
            if (data.biddingTime !== undefined) {
                item.biddingTime = data.biddingTime;
                item.timeLeft = data.biddingTime;
            } else if (data.timeLeft !== undefined) {
                item.biddingTime = data.timeLeft;
                item.timeLeft = data.timeLeft;
            }
            // FROZEN items should NEVER be marked as ended - their timer is paused
            item.ended = false;
            renderItems();
            return;
        }
        
        // Sync timeLeft from server - convert to auctionEndTime for consistency
        // Only update timeLeft if item is not frozen
        if (data.timeLeft !== undefined && item.status !== 'FROZEN') {
            item.timeLeft = data.timeLeft;
            // Update auctionEndTime based on server's timeLeft to keep in sync
            item.auctionEndTime = Math.floor(Date.now() / 1000) + data.timeLeft;
        }
        if (data.ended !== undefined) {
            // IMPORTANT: Skip setting ended=true if item is FROZEN
            // FROZEN items should stay in available tab with paused timer
            if (item.status !== 'FROZEN') {
                item.ended = data.ended;
            }
        }
        
        // Handle auction finalized (SOLD or UNSOLD)
        // IMPORTANT: Skip moving to ended if item is FROZEN
        if ((data.status === 'SOLD' || data.status === 'UNSOLD' || data.ended === true) && item.status !== 'FROZEN') {
            item.status = data.status || (item.currentBid > 0 ? 'SOLD' : 'UNSOLD');
            item.winner = data.winner || item.highestBidder;
            item.winningBid = data.winningBid || item.currentBid || item.highestBid;
            item.ended = true;
            
            // Check if item is still in allItems (not yet moved to ended)
            const inAllItems = allItems.find(i => 
                i.auctionId === data.auctionId || 
                i.contractAddress === data.auctionId
            );
            
            if (inAllItems) {
                // Move item from allItems to endedItems
                moveItemToEnded(item);
            } else {
                // Item already in endedItems, just re-render to update display
                renderItems();
            }
            return;
        }

        // Update timer display immediately without full re-render
        updateSingleItemTimer(item);
    }
}

// Move item from Available to Ended when auction finishes
function moveItemToEnded(item) {
    // Remove from allItems
    const index = allItems.findIndex(i => 
        i.auctionId === item.auctionId || 
        i.contractAddress === item.auctionId ||
        i.id === item.id
    );
    
    if (index !== -1) {
        allItems.splice(index, 1);
    }
    
    // Add to endedItems if not already there
    const existsInEnded = endedItems.find(i => 
        i.auctionId === item.auctionId || 
        i.contractAddress === item.auctionId ||
        i.id === item.id
    );
    
    if (!existsInEnded) {
        endedItems.unshift(item); // Add to beginning
    }
    
    // Show toast notification
    const statusText = item.status === 'SOLD' ? 'sold' : 'ended without bids';
    showToast('info', 'Auction Ended', `"${item.name}" has ${statusText}`);
    
    // Re-render items and update counts
    renderItems();
    updateSidebarCounts();
}

// =============================================
// LOAD ITEMS
// =============================================

async function loadItems() {
    const token = localStorage.getItem('auction_token');
    const loading = document.getElementById('loading');

    try {
        const res = await fetch('/api/buyer/items', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.ok) {
            const now = Math.floor(Date.now() / 1000);
            
            // Separate slashed items first
            slashedItems = data.items.filter(item => item.status === 'SLASHED');
            
            // Separate available and ended items (excluding SLASHED)
            // For LIVE and FROZEN items, check if auction has ended based on time
            allItems = data.items.filter(item => {
                // Exclude SLASHED items
                if (item.status === 'SLASHED') return false;
                // Include LIVE and FROZEN items in available tab
                if (item.status !== 'LIVE' && item.status !== 'FROZEN') return false;
                
                // FROZEN items should always be in available tab (timer is paused)
                // Use biddingTime (remaining seconds) for display
                if (item.status === 'FROZEN') {
                    if (item.biddingTime !== undefined) {
                        item.timeLeft = item.biddingTime;
                    }
                    return true;
                }
                
                // Ensure auctionEndTime is a number (Unix timestamp)
                const endTime = typeof item.auctionEndTime === 'number' 
                    ? item.auctionEndTime 
                    : parseInt(item.auctionEndTime, 10);
                
                // For LIVE items, check if auctionEndTime has passed
                if (endTime && endTime <= now) return false;
                // Calculate initial timeLeft from auctionEndTime
                if (endTime) {
                    item.timeLeft = endTime - now;
                    item.auctionEndTime = endTime; // Ensure it's stored as number
                }
                return true;
            });
            
            // Ended items: SOLD, UNSOLD, ENDED status, or LIVE with expired time (excluding SLASHED and FROZEN)
            endedItems = data.items.filter(item => {
                // Exclude SLASHED items
                if (item.status === 'SLASHED') return false;
                // Exclude FROZEN items - they should be in available tab
                if (item.status === 'FROZEN') return false;
                
                if (item.status === 'SOLD' || item.status === 'UNSOLD' || item.status === 'ENDED') {
                    return true;
                }
                
                // Ensure auctionEndTime is a number (Unix timestamp)
                const endTime = typeof item.auctionEndTime === 'number' 
                    ? item.auctionEndTime 
                    : parseInt(item.auctionEndTime, 10);
                
                // LIVE but time has expired (not FROZEN)
                if (item.status === 'LIVE' && endTime && endTime <= now) {
                    // Mark as ended and determine status based on highestBid from database
                    item.ended = true;
                    if (item.highestBid && item.highestBid > 0) {
                        item.status = 'SOLD';
                        item.winner = item.winner || item.highestBidder;
                        item.winningBid = item.winningBid || item.highestBid;
                    } else {
                        item.status = 'UNSOLD';
                    }
                    return true;
                }
                return false;
            });

            renderItems();
            updateSidebarCounts();
        }
    } catch (err) {
        console.error('Failed to load items:', err);
    } finally {
        if (loading) {
            loading.style.display = 'none';
        }
    }
}

// Update sidebar count badges
function updateSidebarCounts() {
    const countAvailable = document.getElementById('countAvailable');
    const countEnded = document.getElementById('countEnded');
    const countSlashed = document.getElementById('countSlashed');
    
    if (countAvailable) {
        if (allItems.length > 0) {
            countAvailable.textContent = allItems.length;
            countAvailable.style.display = 'inline-flex';
        } else {
            countAvailable.style.display = 'none';
        }
    }
    
    if (countEnded) {
        if (endedItems.length > 0) {
            countEnded.textContent = endedItems.length;
            countEnded.style.display = 'inline-flex';
        } else {
            countEnded.style.display = 'none';
        }
    }
    
    if (countSlashed) {
        if (slashedItems.length > 0) {
            countSlashed.textContent = slashedItems.length;
            countSlashed.style.display = 'inline-flex';
        } else {
            countSlashed.style.display = 'none';
        }
    }
}

// =============================================
// RENDER ITEMS
// =============================================

function renderItems() {
    if (currentTab === 'available') {
        renderAvailableItems();
    } else if (currentTab === 'ended') {
        renderEndedItems();
    } else if (currentTab === 'slashed') {
        renderSlashedItems();
    }
}

function renderAvailableItems() {
    const container = document.getElementById('itemsGrid');
    const noItems = document.getElementById('noItems');
    const searchQuery = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const sortBy = document.getElementById('sortBy')?.value || 'newest';

    let filtered = [...allItems];

    // Filter by search
    if (searchQuery) {
        filtered = filtered.filter(item =>
            item.name.toLowerCase().includes(searchQuery) ||
            item.description.toLowerCase().includes(searchQuery)
        );
    }

    // Sort items
    filtered = sortItems(filtered, sortBy);

    if (filtered.length === 0) {
        container.innerHTML = '';
        noItems.style.display = 'block';
        return;
    }

    noItems.style.display = 'none';
    container.innerHTML = filtered.map(item => renderItemCard(item)).join('');

    // Add click handlers
    container.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => {
            const itemId = card.dataset.id;
            const contractAddress = card.dataset.contract;
            joinAuction(itemId, contractAddress);
        });
    });
}

function renderEndedItems() {
    const container = document.getElementById('endedItemsGrid');
    const noItems = document.getElementById('noEndedItems');
    const searchQuery = document.getElementById('searchInputEnded')?.value.toLowerCase() || '';

    let filtered = [...endedItems];

    // Filter by search
    if (searchQuery) {
        filtered = filtered.filter(item =>
            item.name.toLowerCase().includes(searchQuery) ||
            item.description.toLowerCase().includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = '';
        noItems.style.display = 'block';
        return;
    }

    noItems.style.display = 'none';
    container.innerHTML = filtered.map(item => renderEndedItemCard(item)).join('');
}

function renderSlashedItems() {
    const container = document.getElementById('slashedItemsGrid');
    const noItems = document.getElementById('noSlashedItems');
    const searchQuery = document.getElementById('searchInputSlashed')?.value.toLowerCase() || '';

    let filtered = [...slashedItems];

    // Filter by search
    if (searchQuery) {
        filtered = filtered.filter(item =>
            item.name.toLowerCase().includes(searchQuery) ||
            item.description.toLowerCase().includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = '';
        noItems.style.display = 'block';
        return;
    }

    noItems.style.display = 'none';
    container.innerHTML = filtered.map(item => renderSlashedItemCard(item)).join('');
}

function renderItemCard(item) {
    // Use timeLeft directly if available (synced from server), otherwise calculate from auctionEndTime
    const timeLeft = item.timeLeft !== undefined 
        ? formatTimeLeftFromSeconds(item.timeLeft) 
        : formatTimeLeft(item.auctionEndTime);
    // Round to 4 decimals to avoid floating point precision issues
    const rawBid = item.currentBid || item.highestBid || 0;
    const currentBid = rawBid > 0 ? Math.round(rawBid * 10000) / 10000 : 0;
    const hasBids = currentBid > 0;
    const highestBidder = item.highestBidder && item.highestBidder !== '-' ? item.highestBidder : null;
    const isFrozen = item.status === 'FROZEN' || item.status === 'SLASHED';

    // Conditional rendering: hide "Current Highest Bid" if no bids yet
    let bidSection = '';
    if (hasBids) {
        bidSection = `
            <div class="item-price-row highlight">
                <span class="price-label"><i class="fas fa-fire"></i> Current Highest Bid</span>
                <span class="price-value highest has-bids">${currentBid} ETH</span>
            </div>
        `;
        // Add bidder section if there's a highest bidder
        if (highestBidder) {
            bidSection += `
                <div class="item-bidder-section">
                    <span class="bidder-label"><i class="fas fa-user"></i> Current Highest Bidder</span>
                    <span class="bidder-address-value">${highestBidder}</span>
                </div>
            `;
        }
    } else {
        bidSection = `
            <div class="item-price-row no-bids-row">
                <span class="price-label"><i class="fas fa-hourglass-start"></i> Status</span>
                <span class="price-value no-bids">No bids yet</span>
            </div>
        `;
    }

    // Status badge with timer - show FROZEN/PAUSED if frozen, otherwise LIVE with countdown
    const statusBadge = isFrozen 
        ? `<div class="item-status-row">
            <div class="item-status-badge frozen"><i class="fas fa-snowflake"></i> FROZEN</div>
            <div class="item-timer-badge frozen"><i class="fas fa-pause-circle"></i> Paused</div>
           </div>`
        : `<div class="item-status-row">
            <div class="item-status-badge live"><span class="live-dot"></span> LIVE</div>
            <div class="item-timer-badge"><i class="fas fa-clock"></i> ${timeLeft.text}</div>
           </div>`;

    return `
        <div class="item-card ${isFrozen ? 'frozen' : ''}" data-id="${item.id}" data-contract="${item.auctionId || ''}" data-frozen="${isFrozen}">
            <div class="item-image-container">
                <img src="${getImageUrl(item.imageCID)}" alt="${escapeHtml(item.name)}" 
                     class="item-image">
            </div>
            <div class="item-info">
                ${statusBadge}
                <h3 class="item-name">${escapeHtml(item.name)}</h3>
                <div class="item-price-section">
                    <div class="item-price-row">
                        <span class="price-label"><i class="fas fa-tag"></i> Starting Price</span>
                        <span class="price-value starting yellow-price">${item.startingPrice} ETH</span>
                    </div>
                    ${bidSection}
                </div>
                <div class="click-hint">
                    <i class="fas fa-hand-pointer"></i> Click on Item Card to join bid
                </div>
            </div>
        </div>
    `;
}

function renderEndedItemCard(item) {
    const winnerAddress = item.winner || item.highestBidder || null;
    // Use winningBid, or fallback to currentBid/highestBid
    const rawBid = item.winningBid || item.currentBid || item.highestBid || 0;
    const finalBid = rawBid > 0 ? Math.round(rawBid * 10000) / 10000 : 0;
    const hasBids = finalBid > 0 && winnerAddress && winnerAddress !== '-' && winnerAddress !== ethers.constants?.AddressZero;
    const isSold = (item.status === 'SOLD' || hasBids);
    const contractAddress = item.auctionId || '';

    // Show withdraw section for SOLD items (not for admin viewers)
    // Button will be enabled/disabled based on wallet connection
    const showWithdrawSection = isSold && !isAdminViewer;

    return `
        <div class="item-card ended" data-id="${item.id}" data-contract="${contractAddress}">
            <div class="item-image-container">
                <img src="${getImageUrl(item.imageCID)}" alt="${escapeHtml(item.name)}" 
                     class="item-image">
            </div>
            <div class="item-info">
                <div class="item-status-badge ${isSold ? 'sold' : 'unsold'}">
                    <i class="fas ${isSold ? 'fa-trophy' : 'fa-times-circle'}"></i>
                    ${isSold ? 'SOLD' : 'UNSOLD'}
                </div>
                <h3 class="item-name">${escapeHtml(item.name)}</h3>
                ${isSold ? `
                    <div class="ended-info">
                        <div class="ended-row">
                            <span class="ended-label"><i class="fas fa-trophy"></i> Winner</span>
                            <span class="ended-winner-address">${winnerAddress}</span>
                        </div>
                        <div class="ended-row">
                            <span class="ended-label"><i class="fas fa-coins"></i> Final Bid</span>
                            <span class="ended-final-bid">${finalBid} ETH</span>
                        </div>
                        ${showWithdrawSection ? `
                            <div class="ended-withdraw-section">
                                <button class="btn-withdraw-ended" data-contract="${contractAddress}" onclick="event.stopPropagation(); withdrawFromEndedAuction('${contractAddress}')">
                                    <i class="fas fa-undo"></i> Withdraw
                                </button>
                                <span class="withdraw-note">For participants who have not withdrawn in the room</span>
                            </div>
                        ` : ''}
                    </div>
                ` : `
                    <div class="ended-info unsold">
                        <div class="ended-row">
                            <span class="ended-no-bids"><i class="fas fa-times-circle"></i> No bids received</span>
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;
}

function renderSlashedItemCard(item) {
    const contractAddress = item.auctionId || '';
    const slashReason = item.slashReason || item.freezeReason || 'Seller violated auction rules';

    // Show withdraw section for all bidders (not for admin viewers)
    const showWithdrawSection = !isAdminViewer;

    return `
        <div class="item-card slashed" data-id="${item.id}" data-contract="${contractAddress}">
            <div class="item-image-container">
                <img src="${getImageUrl(item.imageCID)}" alt="${escapeHtml(item.name)}" 
                     class="item-image">
            </div>
            <div class="item-info">
                <div class="item-status-badge slashed">
                    <i class="fas fa-gavel"></i> SLASHED
                </div>
                <h3 class="item-name">${escapeHtml(item.name)}</h3>
                ${showWithdrawSection ? `
                    <div class="slashed-withdraw-section">
                        <button class="btn-withdraw-slashed" data-contract="${contractAddress}" onclick="event.stopPropagation(); withdrawFromSlashedAuction('${contractAddress}')">
                            <i class="fas fa-undo"></i> Withdraw My Bid
                        </button>
                        <span class="withdraw-note-slashed">All bidders can withdraw their full bid amount</span>
                    </div>
                ` : ''}
                <div class="slashed-info">
                    <div class="slashed-reason">
                        <span class="slashed-reason-label"><i class="fas fa-exclamation-triangle"></i> Reason</span>
                        <span class="slashed-reason-text">${escapeHtml(slashReason)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// =============================================
// WALLET CONNECTION (Dashboard)
// =============================================

async function initWalletConnection() {
    // Skip wallet connection for admin viewers
    if (isAdminViewer) {
        return;
    }

    if (window.ethereum) {
        // Listen for account changes
        window.ethereum.on('accountsChanged', handleDashboardAccountChange);
        
        // Auto-detect if wallet is already connected (e.g., coming back from auction room)
        try {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                userWalletAddress = accounts[0];
                walletConnected = true;
                updateDashboardWalletUI();
            }
        } catch (err) {
            console.log('Could not auto-detect wallet:', err.message);
        }
    }
}

function handleDashboardAccountChange(accounts) {
    if (accounts.length === 0) {
        userWalletAddress = null;
        walletConnected = false;
    } else {
        userWalletAddress = accounts[0];
        walletConnected = true;
    }
    updateDashboardWalletUI();
    renderItems();
}

function updateDashboardWalletUI() {
    // Admin viewers should not see wallet button
    if (isAdminViewer) {
        const connectWalletBtn = document.getElementById('connectWalletBtn');
        if (connectWalletBtn) connectWalletBtn.style.display = 'none';
        return;
    }

    const walletStatusEl = document.getElementById('walletStatus');
    const walletAddressEl = document.getElementById('walletAddress');
    const connectWalletBtn = document.getElementById('connectWalletBtn');

    if (walletConnected && userWalletAddress) {
        if (walletStatusEl) {
            walletStatusEl.classList.add('connected');
            walletStatusEl.classList.remove('disconnected');
        }
        if (walletAddressEl) {
            walletAddressEl.textContent = shortAddress(userWalletAddress);
        }
        if (connectWalletBtn) {
            connectWalletBtn.innerHTML = `<i class="fas fa-wallet"></i> ${shortAddress(userWalletAddress)}`;
            connectWalletBtn.classList.add('connected');
        }
    } else {
        if (walletStatusEl) {
            walletStatusEl.classList.remove('connected');
            walletStatusEl.classList.add('disconnected');
        }
        if (walletAddressEl) {
            walletAddressEl.textContent = 'Not Connected';
        }
        if (connectWalletBtn) {
            connectWalletBtn.innerHTML = `<i class="fab fa-ethereum"></i> Connect Wallet`;
            connectWalletBtn.classList.remove('connected');
        }
    }
}

async function connectDashboardWallet() {
    if (!window.ethereum) {
        showToast('error', 'MetaMask Required', 'Please install MetaMask to participate in auctions');
        return;
    }

    try {
        // Request account access with permission popup
        await window.ethereum.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }]
        });

        const accounts = await window.ethereum.request({ method: 'eth_accounts' });

        if (accounts.length === 0) {
            showToast('error', 'Connection Failed', 'No accounts selected');
            return;
        }

        userWalletAddress = accounts[0];
        walletConnected = true;

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

        updateDashboardWalletUI();
        renderItems();
        showToast('success', 'Wallet Connected', `Connected: ${shortAddress(userWalletAddress)}`);

    } catch (err) {
        console.error('Wallet connection error:', err);
        if (err.code !== 4001) {
            showToast('error', 'Connection Failed', err.message || 'Failed to connect wallet');
        }
    }
}

function promptConnectWallet() {
    showToast('info', 'Connect Wallet', 'Please connect your MetaMask wallet first to join auctions');
    connectDashboardWallet();
}

function shortAddress(address) {
    if (!address) return '--';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// =============================================
// LOADING OVERLAY
// =============================================

function showLoading(text = 'Processing...') {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        // Create loading overlay if it doesn't exist
        overlay = document.createElement('div');
        overlay.id = 'loadingOverlay';
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <div class="loading-text" id="loadingText">${text}</div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    const loadingText = document.getElementById('loadingText');
    if (loadingText) loadingText.textContent = text;
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

// Toast notification function with optional link support
function showToast(type, title, message, options = {}) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? 'fa-check-circle' :
        type === 'error' ? 'fa-exclamation-circle' :
        type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';

    // Build link HTML if provided
    let linkHtml = '';
    if (options.link && options.linkText) {
        linkHtml = `<a href="${options.link}" target="_blank" class="toast-link"><i class="fas fa-external-link-alt"></i> ${options.linkText}</a>`;
    }

    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icon}"></i></div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
            ${linkHtml}
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);

    // Custom duration, or longer timeout if there's a link (8 seconds), default 5 seconds
    const timeout = options.duration || (options.link ? 8000 : 5000);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, timeout);
}

function sortItems(items, sortBy) {
    switch (sortBy) {
        case 'price-low':
            return items.sort((a, b) => (a.startingPrice || 0) - (b.startingPrice || 0));
        case 'price-high':
            return items.sort((a, b) => (b.startingPrice || 0) - (a.startingPrice || 0));
        case 'ending':
            return items.sort((a, b) => (a.auctionEndTime || 0) - (b.auctionEndTime || 0));
        case 'newest':
        default:
            return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
}

// =============================================
// JOIN AUCTION
// =============================================

async function joinAuction(itemId, contractAddress) {
    if (!contractAddress) {
        showToast('error', 'Not Available', 'This auction is not yet available');
        return;
    }

    // Admin viewers can enter auction room in view-only mode
    if (isAdminViewer) {
        window.location.href = `/auction.html?id=${contractAddress}`;
        return;
    }

    // Check if wallet is connected before allowing to join
    if (!walletConnected) {
        showToast('warning', 'Wallet Required', 'Please connect your wallet first using the button in the navbar');
        return;
    }

    // Navigate to auction room
    // Note: Frozen auctions are allowed - buyers can still enter to withdraw their funds
    // Bidding will be disabled inside the auction room if frozen
    window.location.href = `/auction.html?id=${contractAddress}`;
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

function getImageUrl(imageCID) {
    if (!imageCID) return '';
    if (imageCID.startsWith('http')) return imageCID;
    return `https://gateway.pinata.cloud/ipfs/${imageCID}`;
}

function formatTimeLeft(endTime) {
    if (!endTime) return { text: 'N/A', urgent: false };

    const now = Math.floor(Date.now() / 1000);
    const timeLeft = endTime - now;

    if (timeLeft <= 0) {
        return { text: 'Ended', urgent: true };
    }

    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;

    if (hours > 0) {
        return { text: `${hours}h ${minutes}m`, urgent: hours < 1 };
    } else if (minutes > 0) {
        return { text: `${minutes}m ${seconds}s`, urgent: minutes < 5 };
    } else {
        return { text: `${seconds}s`, urgent: true };
    }
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =============================================
// SIDEBAR FUNCTIONS
// =============================================

function initSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const dashboardContent = document.querySelector('.dashboard-content');
    const sidebar = document.getElementById('sidebar');
    const navbar = document.querySelector('.navbar');

    // Toggle sidebar with hamburger button
    if (toggle) {
        toggle.addEventListener('click', toggleSidebar);
    }

    // Close sidebar when clicking on navbar (except interactive elements)
    if (navbar) {
        navbar.addEventListener('click', (e) => {
            if (!sidebarOpen) return;

            const interactiveSelectors = [
                '.sidebar-toggle',
                '.btn-back',
                'button',
                'a'
            ];

            const isInteractive = interactiveSelectors.some(selector =>
                e.target.closest(selector)
            );

            if (!isInteractive) {
                closeSidebar();
            }
        });
    }

    // Close sidebar when clicking on empty area inside sidebar
    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            if (!sidebarOpen) return;

            const interactiveSelectors = [
                '.menu-item',
                '.sidebar-header',
                'a',
                'button'
            ];

            const isInteractive = interactiveSelectors.some(selector =>
                e.target.closest(selector)
            );

            if (!isInteractive) {
                closeSidebar();
            }
        });
    }

    // Close sidebar when clicking on dashboard background
    if (dashboardContent) {
        dashboardContent.addEventListener('click', (e) => {
            if (!sidebarOpen) return;

            const interactiveSelectors = [
                '.sidebar-toggle',
                '.item-card',
                '.menu-item',
                '.btn-back',
                '.search-box',
                '.navbar',
                'input',
                'select',
                'button',
                'a'
            ];

            const isInteractive = interactiveSelectors.some(selector =>
                e.target.closest(selector)
            );

            if (!isInteractive) {
                closeSidebar();
            }
        });
    }

    // Close sidebar on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebarOpen) {
            closeSidebar();
        }
    });
}

function toggleSidebar() {
    if (sidebarOpen) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebarOpen = true;
    sidebar.classList.add('open');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebarOpen = false;
    sidebar.classList.remove('open');
}

// Update timer every second - only update timer text, not re-render entire cards
setInterval(() => {
    if (currentTab === 'available') {
        // Decrement timeLeft locally for smoother countdown
        // Skip FROZEN items - their timer should be paused
        allItems.forEach(item => {
            if (item.status === 'FROZEN') {
                // Don't decrement timer for frozen items
                return;
            }
            if (item.timeLeft !== undefined && item.timeLeft > 0) {
                item.timeLeft--;
            }
        });
        updateTimersOnly();
        checkEndedAuctions();
    }
}, 1000);

// Update single item timer without full re-render
function updateSingleItemTimer(item) {
    const contractAddress = item.auctionId || item.contractAddress;
    const card = document.querySelector(`.item-card[data-contract="${contractAddress}"]`);
    if (!card) return;
    
    const timerEl = card.querySelector('.item-timer-badge:not(.frozen)');
    if (timerEl) {
        // Use timeLeft directly if available (synced from server), otherwise calculate from auctionEndTime
        let timeLeft;
        if (item.timeLeft !== undefined) {
            timeLeft = formatTimeLeftFromSeconds(item.timeLeft);
        } else if (item.auctionEndTime) {
            timeLeft = formatTimeLeft(item.auctionEndTime);
        } else {
            return;
        }
        timerEl.innerHTML = `<i class="fas fa-clock"></i> ${timeLeft.text}`;
    }
    
    // Also update bid display if needed
    const bidValueEl = card.querySelector('.price-value.highest');
    if (bidValueEl && item.currentBid > 0) {
        bidValueEl.textContent = `${item.currentBid} ETH`;
    }
}

// Update only timer elements without re-rendering cards
function updateTimersOnly() {
    const timerElements = document.querySelectorAll('.item-timer-badge:not(.frozen)');
    timerElements.forEach(timerEl => {
        const card = timerEl.closest('.item-card');
        if (!card) return;
        
        const contractAddress = card.dataset.contract;
        const item = allItems.find(i => i.auctionId === contractAddress || i.contractAddress === contractAddress);
        
        if (item) {
            // Use timeLeft directly if available (synced from server), otherwise calculate from auctionEndTime
            let timeLeft;
            if (item.timeLeft !== undefined) {
                timeLeft = formatTimeLeftFromSeconds(item.timeLeft);
            } else if (item.auctionEndTime) {
                timeLeft = formatTimeLeft(item.auctionEndTime);
            } else {
                return;
            }
            timerEl.innerHTML = `<i class="fas fa-clock"></i> ${timeLeft.text}`;
        }
    });
}

// Format time from seconds directly (used for server-synced timeLeft)
function formatTimeLeftFromSeconds(seconds) {
    if (seconds <= 0) {
        return { text: 'Ended', urgent: true };
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return { text: `${hours}h ${minutes}m`, urgent: hours < 1 };
    } else if (minutes > 0) {
        return { text: `${minutes}m ${secs}s`, urgent: minutes < 5 };
    } else {
        return { text: `${secs}s`, urgent: true };
    }
}

// Check if any auctions have ended and move them to ended tab
// Note: This only handles UI update, actual status (SOLD/UNSOLD) comes from server
function checkEndedAuctions() {
    const now = Math.floor(Date.now() / 1000);
    
    allItems.forEach(item => {
        // Skip FROZEN items - they should not be marked as ended
        // Their timer is paused and will resume when unfrozen
        if (item.status === 'FROZEN') {
            return;
        }
        
        // Check using timeLeft (server-synced) or auctionEndTime
        const hasEnded = (item.timeLeft !== undefined && item.timeLeft <= 0) ||
                        (item.auctionEndTime && item.auctionEndTime <= now);
        
        if (hasEnded && !item.ended) {
            // Mark as ended locally
            item.ended = true;
            
            // Determine status based on whether there are bids
            // Use currentBid (from socket) or highestBid (from database)
            const hasBids = (item.currentBid && item.currentBid > 0) || 
                           (item.highestBid && item.highestBid > 0);
            
            if (hasBids) {
                item.status = 'SOLD';
                // Set winner and winningBid from current data (prefer socket data)
                item.winner = item.winner || item.highestBidder;
                item.winningBid = item.winningBid || item.currentBid || item.highestBid;
            } else {
                item.status = 'UNSOLD';
            }
            
            // Move to ended
            moveItemToEnded(item);
        }
    });
}

// =============================================
// WITHDRAW FROM ENDED AUCTION
// =============================================

async function withdrawFromEndedAuction(contractAddress) {
    console.log('[Withdraw] Starting withdraw for contract:', contractAddress);
    
    if (!walletConnected || !userWalletAddress) {
        showToast('error', 'Wallet Required', 'Please connect your wallet first');
        return;
    }

    if (!window.ethereum) {
        showToast('error', 'MetaMask Required', 'Please install MetaMask');
        return;
    }

    try {
        // Request accounts to ensure wallet is connected and active
        console.log('[Withdraw] Requesting accounts...');
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts.length === 0) {
            showToast('error', 'Wallet Not Connected', 'Please connect your wallet');
            return;
        }
        
        // Update userWalletAddress in case it changed
        userWalletAddress = accounts[0];
        console.log('[Withdraw] Using wallet:', userWalletAddress);

        // Check network
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        console.log('[Withdraw] Chain ID:', chainId);
        
        if (chainId !== '0xaa36a7') {
            showToast('warning', 'Wrong Network', 'Please switch to Sepolia testnet');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0xaa36a7' }]
                });
            } catch (switchError) {
                console.error('Failed to switch network:', switchError);
                return;
            }
        }

        console.log('[Withdraw] Creating provider and contract...');
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

        showToast('info', 'Checking', 'Checking your eligibility...');

        // Check if user is the highest bidder FIRST (winner cannot withdraw)
        console.log('[Withdraw] Checking highest bidder...');
        const highestBidder = await contract.highestBidder();
        console.log('[Withdraw] Highest bidder:', highestBidder);
        
        if (highestBidder.toLowerCase() === userWalletAddress.toLowerCase()) {
            showToast('error', 'Cannot Withdraw', 'Winner cannot withdraw their winning bid');
            return;
        }

        // Then check user's bid balance
        console.log('[Withdraw] Checking bid balance...');
        const userBidBn = await contract.bids(userWalletAddress);
        const userBid = parseFloat(ethers.utils.formatEther(userBidBn));
        console.log('[Withdraw] User bid balance:', userBid);

        if (userBid <= 0) {
            showToast('info', 'No Balance', 'You have no bids to withdraw from this auction');
            return;
        }

        // Calculate penalty (1.5% with 0.0001 ETH minimum)
        const penaltyRate = 0.015; // 1.5%
        const minPenalty = 0.0001;
        let calculatedPenalty = userBid * penaltyRate;
        const penalty = Math.max(calculatedPenalty, minPenalty);
        const netAmount = userBid - penalty;

        showToast('info', 'Confirm Transaction', 
            `Withdrawing ${userBid.toFixed(4)} ETH\nPenalty: ${penalty.toFixed(4)} ETH (1.5%)\nYou receive: ${netAmount.toFixed(4)} ETH\n\nPlease confirm in MetaMask...`,
            { duration: 6000 });

        // Execute withdraw - this will trigger MetaMask popup
        console.log('[Withdraw] Calling contract.withdraw()...');
        const tx = await contract.withdraw();
        console.log('[Withdraw] Transaction submitted:', tx.hash);
        
        // Show loading overlay while waiting for confirmation
        showLoading('Confirming transaction...');
        showToast('info', 'Confirming', 'Transaction submitted. Waiting for confirmation...');
        await tx.wait();
        hideLoading();
        console.log('[Withdraw] Transaction confirmed!');

        // Show success toast with Etherscan link
        const etherscanUrl = `https://sepolia.etherscan.io/tx/${tx.hash}`;
        showToast('success', 'Withdrawn!', `${netAmount.toFixed(4)} ETH returned (${penalty.toFixed(4)} ETH penalty deducted)`, {
            link: etherscanUrl,
            linkText: 'View on Etherscan',
            duration: 10000
        });

    } catch (err) {
        hideLoading();
        console.error('[Withdraw] Error:', err);

        if (err.code === 4001) {
            showToast('warning', 'Cancelled', 'Transaction was cancelled');
        } else if (err.code === -32002) {
            showToast('warning', 'Pending', 'Please check MetaMask - a request is already pending');
        } else if (err.message && err.message.includes('Highest bidder')) {
            showToast('error', 'Cannot Withdraw', 'Winner cannot withdraw');
        } else {
            showToast('error', 'Withdraw Failed', err.reason || err.message || 'Transaction failed');
        }
    }
}

// Make function globally accessible
window.withdrawFromEndedAuction = withdrawFromEndedAuction;

// =============================================
// WITHDRAW FROM SLASHED AUCTION (Full refund, no penalty, all bidders can withdraw)
// =============================================

async function withdrawFromSlashedAuction(contractAddress) {
    console.log('[WithdrawSlashed] Starting withdraw for contract:', contractAddress);
    
    if (!walletConnected || !userWalletAddress) {
        showToast('error', 'Wallet Required', 'Please connect your wallet first');
        return;
    }

    if (!window.ethereum) {
        showToast('error', 'MetaMask Required', 'Please install MetaMask');
        return;
    }

    try {
        // Request accounts to ensure wallet is connected and active
        console.log('[WithdrawSlashed] Requesting accounts...');
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts.length === 0) {
            showToast('error', 'Wallet Not Connected', 'Please connect your wallet');
            return;
        }
        
        // Update userWalletAddress in case it changed
        userWalletAddress = accounts[0];
        console.log('[WithdrawSlashed] Using wallet:', userWalletAddress);

        // Check network
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        console.log('[WithdrawSlashed] Chain ID:', chainId);
        
        if (chainId !== '0xaa36a7') {
            showToast('warning', 'Wrong Network', 'Please switch to Sepolia testnet');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0xaa36a7' }]
                });
            } catch (switchError) {
                console.error('Failed to switch network:', switchError);
                return;
            }
        }

        console.log('[WithdrawSlashed] Creating provider and contract...');
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

        showToast('info', 'Checking', 'Checking your eligibility...');

        // First check if the auction is actually slashed on the contract
        console.log('[WithdrawSlashed] Checking sellerBondSlashed state...');
        const isSlashed = await contract.sellerBondSlashed();
        console.log('[WithdrawSlashed] sellerBondSlashed:', isSlashed);
        
        if (!isSlashed) {
            showToast('error', 'Not Slashed on Contract', 
                'This auction is marked as slashed in the database but not on the blockchain. Please contact admin to re-slash this auction.');
            return;
        }

        // Check user's bid balance
        console.log('[WithdrawSlashed] Checking bid balance...');
        const userBidBn = await contract.bids(userWalletAddress);
        const userBid = parseFloat(ethers.utils.formatEther(userBidBn));
        console.log('[WithdrawSlashed] User bid balance:', userBid);

        if (userBid <= 0) {
            showToast('info', 'No Balance', 'You have no bids to withdraw from this auction');
            return;
        }

        // For slashed auctions, full refund (no penalty) - all bidders can withdraw including highest bidder
        showToast('info', 'Confirm Transaction', 
            `Withdrawing ${userBid.toFixed(4)} ETH\nFull refund (auction was slashed)\n\nPlease confirm in MetaMask...`,
            { duration: 6000 });

        // Execute withdrawSlashed - this allows ALL bidders to withdraw (including highest bidder)
        console.log('[WithdrawSlashed] Calling contract.withdrawSlashed()...');
        const tx = await contract.withdrawSlashed();
        console.log('[WithdrawSlashed] Transaction submitted:', tx.hash);
        
        // Show loading overlay while waiting for confirmation
        showLoading('Confirming transaction...');
        showToast('info', 'Confirming', 'Transaction submitted. Waiting for confirmation...');
        await tx.wait();
        hideLoading();
        console.log('[WithdrawSlashed] Transaction confirmed!');

        // Show success toast with Etherscan link
        const etherscanUrl = `https://sepolia.etherscan.io/tx/${tx.hash}`;
        showToast('success', 'Withdrawn!', `${userBid.toFixed(4)} ETH returned (full refund)`, {
            link: etherscanUrl,
            linkText: 'View on Etherscan',
            duration: 10000
        });

    } catch (err) {
        hideLoading();
        console.error('[WithdrawSlashed] Error:', err);

        if (err.code === 4001) {
            showToast('warning', 'Cancelled', 'Transaction was cancelled');
        } else if (err.code === -32002) {
            showToast('warning', 'Pending', 'Please check MetaMask - a request is already pending');
        } else {
            showToast('error', 'Withdraw Failed', err.reason || err.message || 'Transaction failed');
        }
    }
}

// Make function globally accessible
window.withdrawFromSlashedAuction = withdrawFromSlashedAuction;
