// Seller Dashboard JavaScript

let currentItems = [];
let selectedItemForResubmit = null;
let isResubmitMode = false;
let resubmitItemId = null;
let sidebarOpen = false;

// MetaMask wallet state
let sellerWalletAddress = null;
const SEPOLIA_CHAIN_ID = '0xaa36a7'; // Sepolia testnet

// =============================================
// VALIDATION CONSTANTS
// =============================================
const MIN_STARTING_PRICE = 0.001; // Minimum starting price in ETH
const MAX_DECIMAL_PLACES = 3; // Maximum decimal places allowed

/**
 * Validate that a value has at most maxDecimals decimal places
 * @param {string|number} value - The value to validate
 * @param {number} maxDecimals - Maximum allowed decimal places (default: 3)
 * @returns {boolean} - True if valid, false if too many decimals
 */
function validateDecimalPlaces(value, maxDecimals = MAX_DECIMAL_PLACES) {
    const strValue = value.toString();
    if (!strValue.includes('.')) return true; // Whole numbers are valid
    const decimals = strValue.split('.')[1];
    return !decimals || decimals.length <= maxDecimals;
}

// =============================================
// LOADING OVERLAY
// =============================================

/**
 * Show loading overlay with custom message
 * @param {string} text - Main loading text
 * @param {string} subtext - Subtext description
 */
function showLoadingOverlay(text = 'Processing Transaction...', subtext = 'Please confirm in MetaMask and wait for confirmation') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const loadingSubtext = document.getElementById('loadingSubtext');
    
    if (overlay) {
        if (loadingText) loadingText.textContent = text;
        if (loadingSubtext) loadingSubtext.textContent = subtext;
        overlay.classList.add('active');
    }
}

/**
 * Hide loading overlay
 */
function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

/**
 * Update loading overlay text
 * @param {string} text - Main loading text
 * @param {string} subtext - Subtext description (optional)
 */
function updateLoadingText(text, subtext = null) {
    const loadingText = document.getElementById('loadingText');
    const loadingSubtext = document.getElementById('loadingSubtext');
    
    if (loadingText) loadingText.textContent = text;
    if (subtext && loadingSubtext) loadingSubtext.textContent = subtext;
}

// =============================================
// TOAST NOTIFICATION SYSTEM
// =============================================

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (default 4000)
 */
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info} toast-icon"></i>
        <span class="toast-message">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    container.appendChild(toast);

    // Auto remove after duration
    setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// =============================================
// CUSTOM CONFIRMATION MODAL
// =============================================

/**
 * Show custom confirmation modal (replaces browser confirm())
 * @param {string} title - Modal title
 * @param {string} message - Confirmation message
 * @param {string} confirmText - Text for confirm button (default: 'Confirm')
 * @param {string} type - 'warning', 'danger', 'info' (default: 'warning')
 * @returns {Promise<boolean>} - Resolves true if confirmed, false if cancelled
 */
function showConfirmModal(title, message, confirmText = 'Confirm', type = 'warning') {
    return new Promise((resolve) => {
        // Remove existing modal if any
        const existingModal = document.getElementById('confirmModal');
        if (existingModal) existingModal.remove();

        const iconMap = {
            warning: 'fa-exclamation-triangle',
            danger: 'fa-exclamation-circle',
            info: 'fa-info-circle',
            success: 'fa-check-circle'
        };

        const colorMap = {
            warning: '#f59e0b',
            danger: '#ef4444',
            info: '#3b82f6',
            success: '#10b981'
        };

        const modal = document.createElement('div');
        modal.id = 'confirmModal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 10000;';
        modal.innerHTML = `
            <div class="confirm-modal" style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98)); border-radius: 16px; padding: 2rem; max-width: 400px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
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

        // Handle confirm
        document.getElementById('confirmModalConfirm').addEventListener('click', () => {
            modal.remove();
            resolve(true);
        });

        // Handle cancel
        document.getElementById('confirmModalCancel').addEventListener('click', () => {
            modal.remove();
            resolve(false);
        });

        // Handle click outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        });

        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', handleEscape);
                resolve(false);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

// Socket.io connection for real-time updates
let socket = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    initTabs();
    initSidebar();
    initUploadForm();
    initEditForm();
    initImageUpload();
    initWalletConnection();
    loadItems();
    initSocket();
});

// Initialize Socket.io connection
function initSocket() {
    if (typeof io === 'undefined') {
        console.warn('Socket.io not loaded, using polling fallback');
        // Fallback: refresh items every 30 seconds
        setInterval(() => {
            loadItems();
        }, 30000);
        return;
    }
    
    socket = io();
    
    // Listen for auction finalized events
    socket.on('auctionFinalized', (data) => {
        console.log('Auction finalized:', data);
        // Reload items to get updated status
        loadItems();
        
        // Show toast notification
        if (data.status === 'SOLD') {
            showToast(`Item sold for ${data.winningBid} ETH!`, 'success', 5000);
        } else if (data.status === 'UNSOLD') {
            showToast('Auction ended with no bids', 'info', 5000);
        }
    });
    
    // Listen for auction frozen events
    socket.on('auctionFrozen', (data) => {
        console.log('Auction frozen:', data);
        loadItems();
        showToast('An auction has been frozen by admin', 'warning', 5000);
    });
    
    // Listen for auction unfrozen events
    socket.on('auctionUnfrozen', (data) => {
        console.log('Auction unfrozen:', data);
        loadItems();
        showToast('An auction has been unfrozen', 'info', 5000);
    });
    
    // Also refresh items periodically as backup (every 60 seconds)
    setInterval(() => {
        loadItems();
    }, 60000);
}

// Check authentication and role
async function checkAuth() {
    const token = localStorage.getItem('auction_token');
    const user = JSON.parse(localStorage.getItem('auction_user') || 'null');

    if (!token || !user) {
        window.location.href = '/signin.html';
        return;
    }

    // Verify token and check role
    try {
        const res = await fetch('/api/role/current', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.ok) {
            window.location.href = '/signin.html';
            return;
        }

        // Admin should not access seller dashboard
        if (data.isAdmin) {
            window.location.href = '/admin/dashboard.html';
            return;
        }

        // Check if user has seller role
        if (data.role !== 'seller') {
            window.location.href = '/role-select.html';
            return;
        }

        document.getElementById('userName').textContent = user.name || user.email;
    } catch (err) {
        console.error('Auth check failed:', err);
        window.location.href = '/signin.html';
    }

    // Back button handler - return to role selection with wallet disconnect
    document.getElementById('backBtn').addEventListener('click', async () => {
        // Disconnect wallet before going back to role-select
        if (window.ethereum && sellerWalletAddress) {
            try {
                await window.ethereum.request({
                    method: 'wallet_revokePermissions',
                    params: [{ eth_accounts: {} }]
                });
            } catch (err) {
                console.log('Wallet disconnect:', err.message);
            }
            sellerWalletAddress = null;
        }
        window.location.href = '/role-select.html';
    });
}

// Tab navigation
let submenuOpen = false; // Track submenu state

function initTabs() {
    // Main menu items (My Items parent and Upload)
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;

            if (tab === 'items' && item.classList.contains('has-submenu')) {
                // Toggle submenu open/close
                toggleSubmenu();
            } else if (tab === 'upload') {
                switchTab(tab);
            }
        });
    });

    // Submenu items (Pending, Approved, Rejected)
    document.querySelectorAll('.submenu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const status = item.dataset.status;
            switchToItemsTab(status);
        });
    });
}

function toggleSubmenu() {
    const menuGroup = document.querySelector('.menu-group');
    const menuItem = document.querySelector('.menu-item.has-submenu');

    submenuOpen = !submenuOpen;

    if (submenuOpen) {
        menuGroup.classList.add('submenu-open');
        menuItem.classList.add('expanded');
    } else {
        menuGroup.classList.remove('submenu-open');
        menuItem.classList.remove('expanded');
    }
}

function switchToItemsTab(status) {
    // Update status filter
    document.getElementById('statusFilter').value = status;

    // Update tab title
    const titleMap = {
        'all': 'My Items',
        'PENDING': 'Pending Items',
        'APPROVED': 'Approved Items',
        'LIVE': 'Live Auctions',
        'REJECTED': 'Rejected Items',
        'SOLD': 'Sold Items',
        'UNSOLD': 'Unsold Items',
        'SLASHED': 'Slashed Items'
    };
    document.getElementById('itemsTabTitle').textContent = titleMap[status] || 'My Items';

    // Update active states
    document.querySelectorAll('.menu-item').forEach(item => {
        if (item.dataset.tab === 'items') {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    document.querySelectorAll('.submenu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.status === status);
    });

    // Show items tab
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById('itemsTab').classList.add('active');

    // Reset resubmit mode if active
    if (isResubmitMode) {
        resetResubmitMode();
    }

    // Load items with filter
    loadItems();
}

function switchTab(tabName) {
    // If switching away from upload tab, reset resubmit mode
    if (tabName !== 'upload' && isResubmitMode) {
        resetResubmitMode();
    }

    // Update menu items
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });

    // Clear submenu active states when switching to upload
    if (tabName === 'upload') {
        document.querySelectorAll('.submenu-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');
}

// Load seller's items
async function loadItems() {
    const token = localStorage.getItem('auction_token');
    const statusFilter = document.getElementById('statusFilter').value;

    try {
        // Always fetch all items to update counts
        const res = await fetch('/api/seller/items', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.ok) {
            const allItems = data.items;

            // Update status counts in sidebar
            updateStatusCounts(allItems);

            // Filter items based on selected status
            let filteredItems = allItems;
            if (statusFilter !== 'all') {
                filteredItems = allItems.filter(item => item.status === statusFilter);
            }

            currentItems = allItems; // Keep all items for modal lookups
            renderItems(filteredItems);
        }
    } catch (err) {
        console.error('Failed to load items:', err);
    }
}

// Update status counts in sidebar
function updateStatusCounts(items) {
    const counts = {
        PENDING: 0,
        APPROVED: 0,
        LIVE: 0,
        REJECTED: 0,
        SOLD: 0,
        UNSOLD: 0,
        FROZEN: 0,
        SLASHED: 0
    };

    items.forEach(item => {
        if (counts.hasOwnProperty(item.status)) {
            counts[item.status]++;
        }
    });

    // Update counts and hide if 0
    const pendingEl = document.getElementById('pendingCount');
    const approvedEl = document.getElementById('approvedCount');
    const liveEl = document.getElementById('liveCount');
    const rejectedEl = document.getElementById('rejectedCount');
    const soldEl = document.getElementById('soldCount');

    pendingEl.textContent = counts.PENDING;
    pendingEl.style.display = counts.PENDING > 0 ? 'inline-block' : 'none';

    approvedEl.textContent = counts.APPROVED;
    approvedEl.style.display = counts.APPROVED > 0 ? 'inline-block' : 'none';

    liveEl.textContent = counts.LIVE;
    liveEl.style.display = counts.LIVE > 0 ? 'inline-block' : 'none';

    rejectedEl.textContent = counts.REJECTED;
    rejectedEl.style.display = counts.REJECTED > 0 ? 'inline-block' : 'none';

    soldEl.textContent = counts.SOLD;
    soldEl.style.display = counts.SOLD > 0 ? 'inline-block' : 'none';

    const unsoldEl = document.getElementById('unsoldCount');
    unsoldEl.textContent = counts.UNSOLD;
    unsoldEl.style.display = counts.UNSOLD > 0 ? 'inline-block' : 'none';

    const frozenEl = document.getElementById('frozenCount');
    if (frozenEl) {
        frozenEl.textContent = counts.FROZEN;
        frozenEl.style.display = counts.FROZEN > 0 ? 'inline-block' : 'none';
    }

    const slashedEl = document.getElementById('slashedCount');
    if (slashedEl) {
        slashedEl.textContent = counts.SLASHED;
        slashedEl.style.display = counts.SLASHED > 0 ? 'inline-block' : 'none';
    }
}

// Render items grid
function renderItems(items) {
    const container = document.getElementById('itemsList');
    const noItems = document.getElementById('noItems');
    const statusFilter = document.getElementById('statusFilter').value;

    if (!items || items.length === 0) {
        container.innerHTML = '';
        
        // Show different message based on current filter
        const statusMessages = {
            'all': 'No items yet. Start by uploading your first item!',
            'PENDING': 'No pending items',
            'APPROVED': 'No approved items',
            'LIVE': 'No live auctions',
            'REJECTED': 'No rejected items',
            'SOLD': 'No sold items',
            'UNSOLD': 'No unsold items',
            'SLASHED': 'No slashed items'
        };
        
        const message = statusMessages[statusFilter] || 'No items found';
        const showUploadButton = statusFilter === 'all';
        
        noItems.innerHTML = `
            <i class="fas fa-box-open"></i>
            <p>${message}</p>
            ${showUploadButton ? `<button class="btn-primary" onclick="switchTab('upload')">
                <i class="fas fa-plus"></i> Upload Item
            </button>` : ''}
        `;
        noItems.style.display = 'block';
        return;
    }

    noItems.style.display = 'none';
    container.innerHTML = items.map(item => {
        const isSold = item.status === 'SOLD';
        const isFrozen = item.status === 'FROZEN';
        const isSlashed = item.status === 'SLASHED';
        const isLive = item.status === 'LIVE';
        
        return `
        <div class="item-card ${isSold ? 'sold-card' : ''} ${isFrozen ? 'frozen-card' : ''} ${isSlashed ? 'slashed-card' : ''} ${isLive ? 'live-card' : ''}" data-id="${item.id}">
            <img src="${getImageUrl(item.imageCID)}" alt="${item.name}" class="item-image">
            <div class="item-details">
                <span class="item-status status-${item.status.toLowerCase()}">
                    <i class="fas ${getStatusIcon(item.status)}"></i>
                    ${item.status}
                </span>
                <h3 class="item-name">${escapeHtml(item.name)}</h3>
                <div class="click-hint-box">
                    <i class="fas fa-mouse-pointer"></i>
                    Click on item card for more details
                </div>
                ${renderItemActions(item)}
            </div>
        </div>
    `;
    }).join('');

    // Add event listeners
    container.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(btn.dataset.id);
        });
    });
    container.querySelectorAll('.btn-view-reason').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openRejectionModal(btn.dataset.id);
        });
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteItem(btn.dataset.id);
        });
    });
    
    // Add event listener for "Start Auction" button
    container.querySelectorAll('.btn-start-auction').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            startAuctionForItem(btn.dataset.id);
        });
    });
    
    // Add event listener for "Claim" button
    container.querySelectorAll('.btn-claim').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            claimProceeds(btn.dataset.id, btn.dataset.contract);
        });
    });

    // Add click handler for item cards to view details
    container.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => openItemDetailModal(card.dataset.id));
        card.style.cursor = 'pointer';
    });
}

// Render sold info section - now just returns empty string as info is in modal
function renderSoldInfo(item) {
    // Sold info is now only shown in the detail modal
    return '';
}

function renderItemActions(item) {
    // APPROVED items: Show "Start" button to deploy + bond + start auction
    if (item.status === 'APPROVED' && !item.contractAddress) {
        return `
            <div class="item-actions approved-actions">
                <button class="btn-start-auction" data-id="${item.id}">
                    <i class="fas fa-rocket"></i> Start Auction
                </button>
            </div>
        `;
    }
    
    // SOLD or UNSOLD items: Show "Claim" button if not yet claimed, or "Claimed" badge
    if ((item.status === 'SOLD' || item.status === 'UNSOLD') && item.contractAddress) {
        if (item.proceedsClaimed) {
            // Already claimed - show badge
            return `
                <div class="item-actions claim-actions">
                    <div class="claimed-badge">
                        <i class="fas fa-check-circle"></i> Claimed
                    </div>
                </div>
            `;
        } else {
            // Not claimed yet - show claim button
            const claimAmount = item.status === 'SOLD' 
                ? `${(parseFloat(item.highestBid || 0) + parseFloat(item.depositAmount || 0)).toFixed(4)} ETH`
                : `${item.depositAmount || 0} ETH (Bond)`;
            return `
                <div class="item-actions claim-actions">
                    <button class="btn-claim" data-id="${item.id}" data-contract="${item.contractAddress}">
                        <i class="fas fa-hand-holding-usd"></i> Claim ${claimAmount}
                    </button>
                </div>
            `;
        }
    }
    
    // REJECTED items: Show edit/resubmit and delete buttons
    if (item.status === 'REJECTED') {
        return `
            <div class="item-actions rejected-actions">
                <button class="btn-view-reason" data-id="${item.id}">
                    <i class="fas fa-exclamation-circle"></i> View Reason & Edit
                </button>
                <button class="btn-delete" data-id="${item.id}">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        `;
    }
    return '';
}

function getStatusIcon(status) {
    switch (status) {
        case 'PENDING': return 'fa-clock';
        case 'APPROVED': return 'fa-check-circle';
        case 'LIVE': return 'fa-broadcast-tower';
        case 'REJECTED': return 'fa-times-circle';
        case 'SOLD': return 'fa-trophy';
        case 'UNSOLD': return 'fa-times-circle';
        case 'FROZEN': return 'fa-snowflake';
        case 'SLASHED': return 'fa-ban';
        default: return 'fa-question-circle';
    }
}

function getImageUrl(imageCID) {
    if (!imageCID) return '';
    if (imageCID.startsWith('http')) return imageCID;
    return `https://gateway.pinata.cloud/ipfs/${imageCID}`;
}

// Filter is now handled by sidebar submenu

// Upload form
function initUploadForm() {
    const form = document.getElementById('uploadForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('submitBtn');

        const depositAmount = parseFloat(document.getElementById('depositAmount').value);
        const name = document.getElementById('itemName').value.trim();
        const description = document.getElementById('itemDescription').value.trim();
        const startingPriceInput = document.getElementById('startingPrice').value;
        const startingPrice = parseFloat(startingPriceInput);
        const biddingTimeMinutes = parseInt(document.getElementById('biddingTime').value);
        const imageFile = document.getElementById('itemImage').files[0];

        // Validation - Deposit amount
        if (!depositAmount || depositAmount < 0.01) {
            showToast('Bond deposit must be at least 0.01 ETH', 'error');
            return;
        }

        // Validation - Other fields
        if (!name || !description || !startingPrice) {
            showToast('Please fill in all required fields', 'error');
            return;
        }

        // Validation - Bidding time (minimum 1 minute = 60 seconds)
        if (!biddingTimeMinutes || biddingTimeMinutes < 1) {
            showToast('Auction duration must be at least 1 minute', 'error');
            return;
        }

        // Image required only for new items, optional for resubmit
        if (!isResubmitMode && !imageFile) {
            showToast('Please select an image', 'error');
            return;
        }

        // Validation - Starting price minimum
        if (startingPrice < MIN_STARTING_PRICE) {
            showToast(`Starting price must be at least ${MIN_STARTING_PRICE} ETH`, 'error');
            return;
        }

        // Validation - Starting price decimal places (max 3)
        if (!validateDecimalPlaces(startingPriceInput)) {
            showToast(`Maximum ${MAX_DECIMAL_PLACES} decimal places allowed (e.g., 0.001)`, 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
        
        // Show loading overlay
        showLoadingOverlay('Submitting Item...', 'Uploading data to server');

        try {
            // NEW FLOW: Submit WITHOUT deploying contract
            // Contract will be deployed when seller clicks "Start" after admin approval
            // Wallet connection NOT required for submit - only for "Start" button
            const biddingTimeSeconds = biddingTimeMinutes * 60;

            // Submit item data to backend (NO contract deployment yet)
            const token = localStorage.getItem('auction_token');
            const formData = new FormData();
            formData.append('depositAmount', depositAmount);
            formData.append('name', name);
            formData.append('description', description);
            formData.append('startingPrice', startingPrice);
            formData.append('biddingTime', biddingTimeSeconds);
            if (imageFile) formData.append('image', imageFile);

            let url = '/api/seller/items/submit-deploy';
            let method = 'POST';

            // If resubmitting, use resubmit endpoint
            if (isResubmitMode && resubmitItemId) {
                url = `/api/seller/items/${resubmitItemId}/resubmit`;
                method = 'PUT';
            }

            const res = await fetch(url, {
                method,
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const data = await res.json();

            if (data.ok) {
                if (isResubmitMode) {
                    showToast('Item resubmitted for review!', 'success');
                } else {
                    showToast('Item submitted! Waiting for admin approval.', 'success');
                }

                form.reset();
                document.getElementById('imagePreview').style.display = 'none';
                document.getElementById('uploadPlaceholder').style.display = 'block';

                // Reset resubmit mode
                resetResubmitMode();

                setTimeout(() => {
                    switchTab('items');
                    loadItems();
                }, 1500);
            } else {
                showToast(data.error || 'Failed to submit item', 'error');
            }
        } catch (err) {
            console.error('Submit error:', err);
            showToast('Connection error. Please try again.', 'error');
        } finally {
            hideLoadingOverlay();
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> ' + (isResubmitMode ? 'Resubmit' : 'Submit for Review');
        }
    });
}

/**
 * Deploy Auction contract via MetaMask (seller deploys directly)
 * NEW FLOW: Contract auto-starts on deployment (deploy + bond + start in ONE tx)
 * Recipient is the seller wallet (same address that deploys the contract)
 * @param {string} sellerWallet - Seller's wallet address (also used as recipient)
 * @param {number} biddingTimeSeconds - Auction duration in seconds
 * @param {number} startingPrice - Starting price in ETH
 * @param {number} expectedBond - Expected bond amount in ETH
 * @returns {object|null} Deploy result with contractAddress, txHash, auctionEndTime or null if failed
 */
async function deployAuctionContract(sellerWallet, biddingTimeSeconds, startingPrice, expectedBond) {
    if (!window.ethereum) {
        showToast('MetaMask is not installed.', 'error');
        return null;
    }

    // Check if AUCTION_ABI and AUCTION_BYTECODE are loaded
    if (typeof AUCTION_ABI === 'undefined' || !AUCTION_ABI.length) {
        showToast('Auction contract ABI not loaded. Please contact admin.', 'error');
        return null;
    }
    if (typeof AUCTION_BYTECODE === 'undefined' || !AUCTION_BYTECODE) {
        showToast('Auction contract bytecode not loaded. Please contact admin.', 'error');
        return null;
    }

    try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        
        // Convert values to Wei
        const startingPriceWei = ethers.parseEther(startingPrice.toString());
        const expectedBondWei = ethers.parseEther(expectedBond.toString());
        
        // Create contract factory
        const factory = new ethers.ContractFactory(AUCTION_ABI, AUCTION_BYTECODE, signer);
        
        // NEW FLOW: Auction AUTO-STARTS on deployment
        // Calculate auction end time (will be set in constructor)
        const deployTimestamp = Math.floor(Date.now() / 1000);
        const auctionEndTime = deployTimestamp + biddingTimeSeconds;
        
        showToast('Deploying contract... Please confirm in MetaMask.', 'info');
        
        // Deploy contract with constructor arguments AND send bond ETH in same transaction:
        // (biddingTime, recipient, startingPrice, admin, seller, expectedBond)
        // recipient = sellerWallet (seller claims to their own wallet)
        // { value: expectedBondWei } sends ETH to constructor
        // Auction AUTO-STARTS in constructor
        const contract = await factory.deploy(
            biddingTimeSeconds,
            sellerWallet,         // Recipient = seller wallet (claims go to seller)
            startingPriceWei,
            ADMIN_WALLET_ADDRESS, // Platform admin for arbitration
            sellerWallet,         // Seller address
            expectedBondWei,
            { value: expectedBondWei } // Send bond ETH with deployment
        );
        
        showToast('Transaction submitted. Waiting for confirmation...', 'info');
        
        // Wait for deployment
        await contract.waitForDeployment();
        const contractAddress = await contract.getAddress();
        const deployTx = contract.deploymentTransaction();
        
        console.log('Contract deployed at:', contractAddress);
        console.log('Bond deposited:', expectedBond, 'ETH');
        console.log('Auction AUTO-STARTED, ends at:', new Date(auctionEndTime * 1000).toLocaleString());
        
        return {
            contractAddress: contractAddress,
            transactionHash: deployTx.hash,
            biddingTime: biddingTimeSeconds,
            auctionEndTime: auctionEndTime, // Unix timestamp in seconds
            bondDeposited: true
        };
        
    } catch (err) {
        console.error('Contract deployment error:', err);
        
        if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
            showToast('Deployment rejected. Please approve the transaction in MetaMask.', 'warning');
        } else if (err.message?.includes('insufficient funds')) {
            showToast('Insufficient funds for contract deployment and bond.', 'error');
        } else {
            showToast('Failed to deploy contract: ' + (err.reason || err.message || 'Unknown error'), 'error');
        }
        
        return null;
    }
}

/**
 * Deposit bond directly to Auction contract via MetaMask
 * Calls depositSellerBond() on the deployed Auction contract
 * @param {string} auctionContractAddress - Deployed auction contract address
 * @param {number} depositAmount - Bond amount in ETH
 * @returns {string|null} Transaction hash or null if failed
 */
async function depositBondToAuction(auctionContractAddress, depositAmount) {
    if (!window.ethereum) {
        showToast('MetaMask is not installed.', 'error');
        return null;
    }

    try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        
        // Create contract instance
        const auctionContract = new ethers.Contract(auctionContractAddress, AUCTION_ABI, signer);
        
        // Convert ETH to Wei
        const bondWei = ethers.parseEther(depositAmount.toString());
        
        showToast('Depositing bond... Please confirm in MetaMask.', 'info');
        
        // Call depositSellerBond with value (payable function)
        const tx = await auctionContract.depositSellerBond({ value: bondWei });
        
        showToast('Transaction submitted. Waiting for confirmation...', 'info');
        
        // Wait for transaction confirmation
        const receipt = await tx.wait();
        
        console.log('Bond deposited to auction:', receipt.hash);
        
        return receipt.hash;
        
    } catch (err) {
        console.error('Bond deposit to auction error:', err);
        
        if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
            showToast('Transaction rejected. Please approve the transaction in MetaMask.', 'warning');
        } else if (err.message?.includes('insufficient funds')) {
            showToast('Insufficient funds for bond deposit.', 'error');
        } else if (err.message?.includes('Bond already deposited')) {
            showToast('Bond already deposited to this auction.', 'error');
        } else {
            showToast('Failed to deposit bond: ' + (err.reason || err.message || 'Unknown error'), 'error');
        }
        
        return null;
    }
}

// Image upload handling
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

function initImageUpload() {
    const uploadArea = document.getElementById('imageUploadArea');
    const fileInput = document.getElementById('itemImage');
    const preview = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');

    if (!uploadArea) return;

    uploadArea.addEventListener('click', () => fileInput.click());

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            if (file.size > MAX_IMAGE_SIZE) {
                showToast('Image size must be less than 5MB', 'error');
                return;
            }
            fileInput.files = e.dataTransfer.files;
            showImagePreview(file);
        }
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
            if (file.size > MAX_IMAGE_SIZE) {
                showToast('Image size must be less than 5MB', 'error');
                fileInput.value = '';
                return;
            }
            showImagePreview(file);
        }
    });

    function showImagePreview(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.src = e.target.result;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
}

// Edit form
function initEditForm() {
    const form = document.getElementById('editForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('editSubmitBtn');
        const itemId = document.getElementById('editItemId').value;

        const name = document.getElementById('editItemName').value.trim();
        const description = document.getElementById('editItemDescription').value.trim();
        const startingPrice = parseFloat(document.getElementById('editStartingPrice').value);
        const imageFile = document.getElementById('editItemImage').files[0];

        if (!name || !description || !startingPrice) {
            showToast('Please fill in all required fields', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        try {
            const token = localStorage.getItem('auction_token');
            const formData = new FormData();
            formData.append('name', name);
            formData.append('description', description);
            formData.append('startingPrice', startingPrice);
            if (imageFile) formData.append('image', imageFile);

            const res = await fetch(`/api/seller/items/${itemId}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const data = await res.json();

            if (data.ok) {
                closeEditModal();
                // Show success message if resubmitted
                if (data.resubmitted) {
                    showToast('Item resubmitted for review successfully!', 'success');
                } else {
                    showToast('Item updated successfully!', 'success');
                }
                loadItems();
            } else {
                showToast(data.error || 'Failed to update item', 'error');
            }
        } catch (err) {
            showToast('Connection error. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Changes';
        }
    });
}

// Modal functions
function openEditModal(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('editItemId').value = item.id;
    document.getElementById('editItemName').value = item.name;
    document.getElementById('editItemDescription').value = item.description;
    document.getElementById('editStartingPrice').value = item.startingPrice;
    document.getElementById('editCurrentImage').src = getImageUrl(item.imageCID);
    document.getElementById('editItemImage').value = '';

    // Update modal title based on item status
    const modalTitle = document.querySelector('#editModal .modal-header h3');
    const submitBtn = document.getElementById('editSubmitBtn');

    if (item.status === 'REJECTED') {
        modalTitle.textContent = 'Edit & Resubmit Item';
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Resubmit for Review';
    } else {
        modalTitle.textContent = 'Edit Item';
        submitBtn.innerHTML = 'Save Changes';
    }

    document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

function openRejectionModal(itemId) {
    // Directly open resubmit mode instead of showing modal
    openResubmitMode(itemId);
}

function closeRejectionModal() {
    document.getElementById('rejectionModal').style.display = 'none';
    selectedItemForResubmit = null;
}

async function resubmitItem() {
    if (!selectedItemForResubmit) return;

    const itemId = selectedItemForResubmit.id;
    closeRejectionModal();
    openResubmitMode(itemId);
}

// Open resubmit mode - prefill form with item data
function openResubmitMode(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;

    isResubmitMode = true;
    resubmitItemId = itemId;

    // Prefill form
    document.getElementById('itemName').value = item.name;
    document.getElementById('itemDescription').value = item.description;
    document.getElementById('startingPrice').value = item.startingPrice;
    document.getElementById('imagePreview').src = getImageUrl(item.imageCID);
    document.getElementById('imagePreview').style.display = 'block';
    document.getElementById('uploadPlaceholder').style.display = 'none';
    document.getElementById('resubmitItemId').value = itemId;

    // Show resubmit UI
    document.getElementById('uploadTabTitle').textContent = 'Edit & Resubmit Item';
    document.getElementById('resubmitBanner').style.display = 'block';
    document.getElementById('resubmitReason').textContent = item.rejectReason || 'No reason provided';
    document.getElementById('cancelResubmit').style.display = 'inline-flex';
    document.getElementById('imageNote').style.display = 'block';
    document.getElementById('submitBtn').innerHTML = '<i class="fas fa-paper-plane"></i> Resubmit';

    // Switch to upload tab
    switchTab('upload');
}

// Reset resubmit mode to normal upload mode
function resetResubmitMode() {
    isResubmitMode = false;
    resubmitItemId = null;
    document.getElementById('resubmitItemId').value = '';
    document.getElementById('uploadTabTitle').textContent = 'Upload New Item';
    document.getElementById('resubmitBanner').style.display = 'none';
    document.getElementById('cancelResubmit').style.display = 'none';
    document.getElementById('imageNote').style.display = 'none';
    document.getElementById('submitBtn').innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Review';
}

// Cancel resubmit and go back to items
function cancelResubmitMode() {
    resetResubmitMode();
    document.getElementById('uploadForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('uploadPlaceholder').style.display = 'block';
    switchTab('items');
}

// Utility functions
function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
}

function showSuccess(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
}

function hideMessage(el) {
    if (el) el.style.display = 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Delete item
async function deleteItem(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;

    const confirmed = await showConfirmModal(
        'Delete Item?',
        `Are you sure you want to delete "${item.name}"?\n\nThis action cannot be undone.`,
        'Delete',
        'danger'
    );
    if (!confirmed) return;

    try {
        const token = localStorage.getItem('auction_token');
        const res = await fetch(`/api/seller/items/${itemId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();

        if (data.ok) {
            showToast('Item deleted successfully', 'success');
            loadItems();
        } else {
            showToast(data.error || 'Failed to delete item', 'error');
        }
    } catch (err) {
        console.error('Delete item error:', err);
        showToast('Connection error. Please try again.', 'error');
    }
}

// =============================================
// DEPLOY AUCTION FUNCTIONS
// =============================================

let deployItemId = null;

/**
 * Open deploy modal for a pending item
 * @deprecated Use submit-deploy flow instead. This function is kept for backward compatibility with old PENDING items.
 */
function openDeployModal(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;

    deployItemId = itemId;
    
    // Set item info in modal
    document.getElementById('deployItemName').textContent = item.name;
    document.getElementById('deployItemPrice').textContent = `${item.startingPrice} ETH`;
    document.getElementById('deployBondAmount').textContent = `${item.depositAmount} ETH`;
    
    // Reset bidding time input
    document.getElementById('deployBiddingTime').value = '';
    
    // Show modal
    document.getElementById('deployModal').style.display = 'flex';
}

/**
 * Close deploy modal
 */
function closeDeployModal() {
    document.getElementById('deployModal').style.display = 'none';
    deployItemId = null;
}

/**
 * Deploy auction contract for the selected item
 */
async function deployAuction() {
    if (!deployItemId) return;

    const biddingTimeMinutes = parseInt(document.getElementById('deployBiddingTime').value);
    
    if (!biddingTimeMinutes || biddingTimeMinutes < 1) {
        showToast('Please enter a valid bidding time (at least 1 minute)', 'error');
        return;
    }

    const biddingTimeSeconds = biddingTimeMinutes * 60;
    
    const deployBtn = document.getElementById('deployConfirmBtn');
    deployBtn.disabled = true;
    deployBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deploying...';

    try {
        const token = localStorage.getItem('auction_token');
        const res = await fetch(`/api/seller/items/${deployItemId}/deploy`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ biddingTime: biddingTimeSeconds })
        });

        const data = await res.json();

        if (data.ok) {
            closeDeployModal();
            showToast('Auction deployed successfully! Waiting for admin approval.', 'success');
            loadItems();
        } else {
            showToast(data.error || 'Failed to deploy auction', 'error');
        }
    } catch (err) {
        console.error('Deploy auction error:', err);
        showToast('Connection error. Please try again.', 'error');
    } finally {
        deployBtn.disabled = false;
        deployBtn.innerHTML = '<i class="fas fa-rocket"></i> Deploy';
    }
}

// Make deploy functions globally available
window.closeDeployModal = closeDeployModal;
window.deployAuction = deployAuction;

/**
 * Start auction for an approved item
 * Deploys contract + deposits bond + auto-starts auction in ONE transaction
 * @param {string} itemId - Item ID to start auction for
 */
async function startAuctionForItem(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) {
        showToast('Item not found', 'error');
        return;
    }

    // Check wallet connection
    if (!sellerWalletAddress) {
        showToast('Please connect your MetaMask wallet first', 'error');
        return;
    }

    // Confirm with user
    const confirmed = await showConfirmModal(
        'Start Auction?',
        `You are about to start the auction for "${item.name}".\n\nThis will:\n• Deploy the auction contract\n• Deposit ${item.depositAmount} ETH as bond\n• Start the auction immediately\n\nYou will pay ONE gas fee for all operations.`,
        'Start Auction',
        'info'
    );

    if (!confirmed) return;

    // Show loading overlay
    showLoadingOverlay('Starting Auction...', 'Please confirm the transaction in MetaMask');

    try {
        // Deploy contract with bond and auto-start
        // Recipient = sellerWallet (seller claims to their own wallet)
        const deployResult = await deployAuctionContract(
            sellerWalletAddress,
            item.biddingTime,
            item.startingPrice,
            item.depositAmount
        );

        if (!deployResult) {
            hideLoadingOverlay();
            return;
        }

        updateLoadingText('Updating Item...', 'Saving contract info to server');

        // Update item with contract info via API
        const token = localStorage.getItem('auction_token');
        const res = await fetch(`/api/seller/items/${itemId}/start`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contractAddress: deployResult.contractAddress,
                deployTxHash: deployResult.transactionHash,
                auctionEndTime: deployResult.auctionEndTime,
                sellerWallet: sellerWalletAddress // Capture wallet at start time
            })
        });

        const data = await res.json();

        if (data.ok) {
            showToast(`Auction started! Contract: ${deployResult.contractAddress.slice(0, 10)}...`, 'success', 6000);
            loadItems();
        } else {
            showToast(data.error || 'Failed to update item', 'error');
        }
    } catch (err) {
        console.error('Start auction error:', err);
        showToast('Failed to start auction. Please try again.', 'error');
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Claim proceeds (winning bid + bond) for a sold/unsold auction
 * @param {string} itemId - Item ID
 * @param {string} contractAddress - Contract address
 */
async function claimProceeds(itemId, contractAddress) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) {
        showToast('Item not found', 'error');
        return;
    }

    // Check wallet connection
    if (!sellerWalletAddress) {
        showToast('Please connect your MetaMask wallet first', 'error');
        return;
    }

    // Verify that connected wallet matches the seller wallet that deployed the contract
    if (sellerWalletAddress.toLowerCase() !== item.sellerWallet.toLowerCase()) {
        showToast(`Wrong wallet connected. Please connect with the wallet that deployed this auction: ${item.sellerWallet.slice(0, 6)}...${item.sellerWallet.slice(-4)}`, 'error');
        return;
    }

    // Calculate amounts
    const winningBid = item.status === 'SOLD' ? parseFloat(item.highestBid || 0) : 0;
    const bond = parseFloat(item.depositAmount || 0);
    const totalAmount = winningBid + bond;

    // Confirm with user
    const message = item.status === 'SOLD'
        ? `Claim your proceeds:\n\n• Winning Bid: ${winningBid.toFixed(4)} ETH\n• Bond Return: ${bond.toFixed(4)} ETH\n• Total: ${totalAmount.toFixed(4)} ETH\n\nYou will pay ONE gas fee.`
        : `Claim your bond:\n\n• Bond Return: ${bond.toFixed(4)} ETH\n\nYou will pay ONE gas fee.`;

    const confirmed = await showConfirmModal(
        'Claim Proceeds?',
        message,
        'Claim Now',
        'success'
    );

    if (!confirmed) return;

    // Show loading overlay
    showLoadingOverlay('Claiming Proceeds...', 'Please confirm the transaction in MetaMask');

    try {
        // Call claimProceeds on the contract
        const CLAIM_ABI = [
            {
                "inputs": [],
                "name": "claimProceeds",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            }
        ];

        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const contract = new ethers.Contract(contractAddress, CLAIM_ABI, signer);

        const tx = await contract.claimProceeds();
        
        updateLoadingText('Processing...', 'Waiting for transaction confirmation');
        
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            // Update database
            const token = localStorage.getItem('auction_token');
            await fetch(`/api/seller/items/${itemId}/claimed`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    claimTxHash: receipt.hash,
                    claimedAmount: totalAmount
                })
            });

            showToast(`Successfully claimed ${totalAmount.toFixed(4)} ETH!`, 'success', 6000);
            loadItems();
        } else {
            showToast('Transaction failed', 'error');
        }
    } catch (err) {
        console.error('Claim error:', err);
        if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
            showToast('Transaction cancelled', 'warning');
        } else if (err.message?.includes('Only seller')) {
            showToast('Only the seller can claim proceeds', 'error');
        } else if (err.message?.includes('Nothing to claim')) {
            showToast('Nothing to claim - already claimed or no funds', 'error');
        } else {
            showToast('Failed to claim. Please try again.', 'error');
        }
    } finally {
        hideLoadingOverlay();
    }
}

// Make functions globally available
window.switchTab = switchTab;
window.closeEditModal = closeEditModal;
window.closeRejectionModal = closeRejectionModal;
window.resubmitItem = resubmitItem;
window.cancelResubmitMode = cancelResubmitMode;
window.closeItemDetailModal = closeItemDetailModal;

// Item Detail Modal
function openItemDetailModal(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;

    // Set item info
    document.getElementById('detailItemImage').src = getImageUrl(item.imageCID);
    document.getElementById('detailItemName').textContent = item.name;
    document.getElementById('detailItemDescription').textContent = item.description;
    document.getElementById('detailItemPrice').textContent = `${item.startingPrice} ETH`;

    // Set auction duration in Auction Info Card
    const durationEl = document.getElementById('detailDuration');
    if (durationEl) {
        if (item.biddingTime) {
            const durationMinutes = Math.floor(item.biddingTime / 60);
            const durationDisplay = durationMinutes >= 60 
                ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m` 
                : `${durationMinutes} min`;
            durationEl.textContent = durationDisplay;
        } else {
            durationEl.textContent = '-';
        }
    }

    // Set bond deposit in Auction Info Card
    const bondEl = document.getElementById('detailBondAmount');
    if (bondEl) {
        if (item.depositAmount) {
            bondEl.textContent = `${item.depositAmount} ETH`;
        } else {
            bondEl.textContent = '-';
        }
    }

    // Set status
    const statusEl = document.getElementById('detailItemStatus');
    statusEl.textContent = item.status;
    statusEl.className = `status-badge status-${item.status.toLowerCase()}`;

    // Show/hide reject reason
    const rejectRow = document.getElementById('detailRejectReasonRow');
    if (item.status === 'REJECTED' && item.rejectReason) {
        rejectRow.style.display = 'block';
        document.getElementById('detailRejectReason').textContent = item.rejectReason;
    } else {
        rejectRow.style.display = 'none';
    }

    // Show/hide freeze reason
    const freezeReasonRow = document.getElementById('detailFreezeReasonRow');
    if (item.status === 'FROZEN' && item.freezeReason) {
        freezeReasonRow.style.display = 'block';
        document.getElementById('detailFreezeReason').textContent = item.freezeReason;
    } else {
        freezeReasonRow.style.display = 'none';
    }

    // Show/hide slash reason
    const slashReasonRow = document.getElementById('detailSlashReasonRow');
    if (item.status === 'SLASHED' && item.freezeReason) {
        slashReasonRow.style.display = 'block';
        document.getElementById('detailSlashReason').textContent = item.freezeReason;
    } else {
        slashReasonRow.style.display = 'none';
    }

    // Show/hide contract address in Auction Info Card
    const contractRow = document.getElementById('detailContractRow');
    const auctionStartRow = document.getElementById('detailAuctionStartRow');
    const auctionEndRow = document.getElementById('detailAuctionEndRow');

    // Check for contract address (from submit-deploy flow)
    const contractAddress = item.contractAddress || item.auctionId;
    
    // Show contract address for all statuses that have it (including REJECTED)
    if (contractAddress) {
        if (contractRow) {
            contractRow.style.display = 'block';
            const contractLink = document.getElementById('detailContractAddress');
            contractLink.textContent = contractAddress;
            contractLink.href = `https://sepolia.etherscan.io/address/${contractAddress}`;
        }

        // For REJECTED items, hide auction times (no contract deployed yet in new flow)
        if (item.status === 'REJECTED') {
            if (auctionStartRow) auctionStartRow.style.display = 'none';
            if (auctionEndRow) auctionEndRow.style.display = 'none';
        } else {
            // Auction Starts on = deployedAt (auction starts when seller clicks Start)
            // For LIVE items, use deployedAt; for APPROVED items waiting to start, hide
            const auctionStartTime = item.deployedAt;
            if (auctionStartTime && auctionStartRow) {
                auctionStartRow.style.display = 'block';
                const startDate = new Date(auctionStartTime);
                document.getElementById('detailAuctionStartTime').textContent = startDate.toLocaleString();

                // Auction Ends on = auctionEndTime (Unix timestamp from contract)
                if (item.auctionEndTime && auctionEndRow) {
                    auctionEndRow.style.display = 'block';
                    // auctionEndTime is Unix timestamp in seconds
                    const endDate = new Date(item.auctionEndTime * 1000);
                    document.getElementById('detailAuctionEndTime').textContent = endDate.toLocaleString();
                } else if (item.biddingTime && auctionEndRow) {
                    // Fallback: calculate from start + biddingTime
                    auctionEndRow.style.display = 'block';
                    const endDate = new Date(startDate.getTime() + (item.biddingTime * 1000));
                    document.getElementById('detailAuctionEndTime').textContent = endDate.toLocaleString();
                } else if (auctionEndRow) {
                    auctionEndRow.style.display = 'none';
                }
            } else {
                // APPROVED items: waiting for seller to start auction
                if (auctionStartRow) auctionStartRow.style.display = 'none';
                if (auctionEndRow) auctionEndRow.style.display = 'none';
            }
        }
    } else {
        if (contractRow) contractRow.style.display = 'none';
        if (auctionStartRow) auctionStartRow.style.display = 'none';
        if (auctionEndRow) auctionEndRow.style.display = 'none';
    }

    // Show/hide sold info for SOLD items
    const soldInfoRow = document.getElementById('detailSoldInfoRow');
    if (soldInfoRow) {
        const winnerEl = document.getElementById('detailWinner');
        const winningBidEl = document.getElementById('detailWinningBid');
        const txHashEl = document.getElementById('detailTxHash');
        
        if (item.status === 'SOLD') {
            soldInfoRow.style.display = 'block';

            // Show winner and winning bid for SOLD
            if (winnerEl) {
                winnerEl.textContent = item.winner || 'N/A';
                if (winnerEl.parentElement) winnerEl.parentElement.style.display = 'block';
            }
            if (winningBidEl) {
                winningBidEl.textContent = `${item.highestBid || item.winningBid || '0'} ETH`;
                if (winningBidEl.parentElement) winningBidEl.parentElement.style.display = 'block';
            }
            // Show claim tx hash (from seller claim proceeds)
            if (txHashEl) {
                if (item.claimTxHash) {
                    txHashEl.href = `https://sepolia.etherscan.io/tx/${item.claimTxHash}`;
                    txHashEl.textContent = item.claimTxHash;
                    txHashEl.parentElement.style.display = 'block';
                } else {
                    // Hide tx hash row if not claimed yet
                    txHashEl.parentElement.style.display = 'none';
                }
            }
        } else if (item.status === 'UNSOLD' && item.claimTxHash) {
            // Show claim tx hash for UNSOLD items (bond refund)
            soldInfoRow.style.display = 'block';
            
            // Hide winner and winning bid for UNSOLD
            if (winnerEl && winnerEl.parentElement) {
                winnerEl.parentElement.style.display = 'none';
            }
            if (winningBidEl && winningBidEl.parentElement) {
                winningBidEl.parentElement.style.display = 'none';
            }
            
            // Show claim tx hash (bond refund)
            if (txHashEl) {
                txHashEl.href = `https://sepolia.etherscan.io/tx/${item.claimTxHash}`;
                txHashEl.textContent = item.claimTxHash;
                txHashEl.parentElement.style.display = 'block';
            }
        } else {
            soldInfoRow.style.display = 'none';
        }
    }

    document.getElementById('itemDetailModal').style.display = 'flex';
}

function closeItemDetailModal() {
    document.getElementById('itemDetailModal').style.display = 'none';
}

// =============================================
// SIDEBAR FUNCTIONS
// =============================================

/**
 * Initialize sidebar event listeners
 */
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

            // List of interactive elements inside sidebar
            const interactiveSelectors = [
                '.menu-item',
                '.submenu-item',
                '.sidebar-header',
                'a',
                'button'
            ];

            const isInteractive = interactiveSelectors.some(selector =>
                e.target.closest(selector)
            );

            // Close if clicking on empty sidebar area
            if (!isInteractive) {
                closeSidebar();
            }
        });
    }

    // Close sidebar when clicking on dashboard background (not interactive elements)
    if (dashboardContent) {
        dashboardContent.addEventListener('click', (e) => {
            if (!sidebarOpen) return;

            // List of interactive elements that should NOT close the sidebar
            const interactiveSelectors = [
                '.sidebar-toggle',
                '.item-card',
                '.menu-item',
                '.btn-primary',
                '.btn-secondary',
                '.btn-back',
                '.upload-form',
                '.filter-group',
                '.navbar',
                'input',
                'select',
                'textarea',
                'button',
                'a'
            ];

            // Check if click target is an interactive element
            const isInteractive = interactiveSelectors.some(selector =>
                e.target.closest(selector)
            );

            // Only close if clicking on background (not interactive elements)
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

/**
 * Toggle sidebar open/close
 */
function toggleSidebar() {
    if (sidebarOpen) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

/**
 * Open the sidebar with animation (push layout)
 */
function openSidebar() {
    const sidebar = document.getElementById('sidebar');

    sidebarOpen = true;
    sidebar.classList.add('open');
}

/**
 * Close the sidebar with animation (push layout)
 */
function closeSidebar() {
    const sidebar = document.getElementById('sidebar');

    sidebarOpen = false;
    sidebar.classList.remove('open');
}

// =============================================
// METAMASK WALLET CONNECTION
// =============================================

/**
 * Initialize wallet connection event listeners
 */
function initWalletConnection() {
    const connectBtn = document.getElementById('connectWalletBtn');
    const walletAddressBtn = document.getElementById('walletAddressBtn');

    if (connectBtn) {
        connectBtn.addEventListener('click', connectSellerWallet);
    }

    // Click on wallet address to switch account
    if (walletAddressBtn) {
        walletAddressBtn.addEventListener('click', switchWalletAccount);
    }

    // Note: Removed beforeunload disconnect - wallet stays connected when navigating
    // Wallet will only disconnect when user clicks "Back" button to role-select

    // Listen for account changes
    if (window.ethereum) {
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);
    }
    
    // No auto-connect - user must manually connect each time
}

/**
 * Connect seller's MetaMask wallet - always request account selection
 */
async function connectSellerWallet() {
    // Check if MetaMask is installed
    if (!window.ethereum) {
        showToast('MetaMask is not installed. Please install MetaMask to continue.', 'error');
        return;
    }

    try {
        // Force account selection popup using wallet_requestPermissions
        await window.ethereum.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }]
        });

        // Get selected account
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        
        if (accounts.length === 0) {
            showToast('No accounts found. Please unlock MetaMask.', 'warning');
            return;
        }

        // Verify network (Sepolia)
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        
        if (chainId !== SEPOLIA_CHAIN_ID) {
            // Try to switch to Sepolia
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: SEPOLIA_CHAIN_ID }]
                });
            } catch (switchError) {
                // If Sepolia is not added, add it
                if (switchError.code === 4902) {
                    try {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: SEPOLIA_CHAIN_ID,
                                chainName: 'Sepolia Testnet',
                                nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
                                rpcUrls: ['https://sepolia.infura.io/v3/'],
                                blockExplorerUrls: ['https://sepolia.etherscan.io']
                            }]
                        });
                    } catch (addError) {
                        showToast('Failed to add Sepolia network. Please add it manually.', 'error');
                        return;
                    }
                } else {
                    showToast('Please switch to Sepolia testnet in MetaMask.', 'warning');
                    return;
                }
            }
        }

        await handleWalletConnected(accounts[0]);
        showToast('Wallet connected successfully!', 'success');

    } catch (err) {
        console.error('Wallet connection error:', err);
        if (err.code === 4001) {
            showToast('Connection rejected. Please approve the connection in MetaMask.', 'warning');
        } else {
            showToast('Failed to connect wallet. Please try again.', 'error');
        }
    }
}

/**
 * Switch wallet account - opens MetaMask account selection
 */
async function switchWalletAccount() {
    if (!window.ethereum) {
        showToast('MetaMask is not installed.', 'error');
        return;
    }

    try {
        // Force account selection popup
        await window.ethereum.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }]
        });

        // Get newly selected account
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        
        if (accounts.length > 0) {
            await handleWalletConnected(accounts[0]);
            showToast('Account switched successfully!', 'success');
        }
    } catch (err) {
        console.error('Switch account error:', err);
        if (err.code !== 4001) {
            showToast('Failed to switch account. Please try again.', 'error');
        }
    }
}

/**
 * Handle successful wallet connection
 */
async function handleWalletConnected(address) {
    sellerWalletAddress = address;
    
    // Update UI - show only address
    document.getElementById('walletNotConnected').style.display = 'none';
    document.getElementById('walletConnected').style.display = 'flex';
    document.getElementById('connectedWalletAddress').textContent = formatAddress(address);
    document.getElementById('sellerWallet').value = address;
}

/**
 * Disconnect wallet
 */
function disconnectWallet() {
    sellerWalletAddress = null;
    
    // Update UI
    document.getElementById('walletNotConnected').style.display = 'flex';
    document.getElementById('walletConnected').style.display = 'none';
    document.getElementById('connectedWalletAddress').textContent = '';
    document.getElementById('sellerWallet').value = '';
}

/**
 * Handle account changes from MetaMask
 */
function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        disconnectWallet();
    } else if (accounts[0] !== sellerWalletAddress) {
        handleWalletConnected(accounts[0]);
    }
}

/**
 * Handle chain/network changes from MetaMask
 */
async function handleChainChanged(chainId) {
    if (chainId !== SEPOLIA_CHAIN_ID && sellerWalletAddress) {
        showToast('Please switch to Sepolia testnet for this auction platform.', 'warning');
    }
}

/**
 * Format wallet address for display
 */
function formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
