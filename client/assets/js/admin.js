// Admin Dashboard JavaScript

let allItems = [];
let currentFilter = 'all';
let selectedItem = null;
let sidebarOpen = false;
let submenuOpen = false;

document.addEventListener('DOMContentLoaded', () => {
    checkAdminAuth();
    initTabs();
    initSidebar();
    initSearch();
    initRejectForm();
    loadItems();
    
    // Set initial title to "All Items" since currentFilter defaults to 'all'
    document.getElementById('sectionTitle').textContent = 'All Items';
});

async function checkAdminAuth() {
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
            // Token invalid, clear and redirect to signin
            localStorage.removeItem('auction_token');
            localStorage.removeItem('auction_user');
            window.location.href = '/signin.html';
            return;
        }

        if (!data.isAdmin) {
            // Not an admin - show toast and redirect to signin
            showToast('error', 'Access Denied', 'Admin privileges required.');
            setTimeout(() => {
                window.location.href = '/signin.html';
            }, 1500);
            return;
        }

        document.getElementById('userName').textContent = user.name || 'Admin';
    } catch (err) {
        localStorage.removeItem('auction_token');
        localStorage.removeItem('auction_user');
        window.location.href = '/signin.html';
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('auction_token');
        localStorage.removeItem('auction_user');
        window.location.href = '/signin.html';
    });
}

function initTabs() {
    // Main menu item (All Items with submenu)
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;

            if (item.classList.contains('has-submenu')) {
                // Toggle submenu open/close
                toggleSubmenu();
            } else {
                switchTab(tab);
            }
        });
    });

    // Submenu items (Pending, Approved, Rejected)
    document.querySelectorAll('.submenu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tab = item.dataset.tab;
            switchToFilteredTab(tab);
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

function switchToFilteredTab(tabName) {
    currentFilter = tabName;

    // Update tab title
    const titles = {
        pending: 'Pending Items',
        approved: 'Approved Items',
        live: 'Live Auctions',
        rejected: 'Rejected Items',
        sold: 'Sold Items',
        unsold: 'Unsold Items',
        frozen: 'Frozen Items',
        slashed: 'Slashed Items',
        all: 'All Items'
    };
    document.getElementById('sectionTitle').textContent = titles[tabName];

    // Update active states
    document.querySelectorAll('.menu-item').forEach(item => {
        if (item.dataset.tab === 'all') {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    document.querySelectorAll('.submenu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });

    renderItems();
}

function switchTab(tabName) {
    currentFilter = tabName;

    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });

    // Clear submenu active states when clicking main menu
    document.querySelectorAll('.submenu-item').forEach(item => {
        item.classList.remove('active');
    });

    const titles = {
        pending: 'Pending Items',
        approved: 'Approved Items',
        live: 'Live Auctions',
        rejected: 'Rejected Items',
        sold: 'Sold Items',
        unsold: 'Unsold Items',
        frozen: 'Frozen Items',
        slashed: 'Slashed Items',
        all: 'All Items'
    };
    document.getElementById('sectionTitle').textContent = titles[tabName];

    renderItems();
}

function initSearch() {
    const searchInput = document.getElementById('searchInput');
    let debounceTimer;

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(renderItems, 300);
    });
}

async function loadItems() {
    const token = localStorage.getItem('auction_token');

    try {
        const res = await fetch('/api/admin/items', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.ok) {
            allItems = data.items;
            updateStatusCounts();
            renderItems();
        }
    } catch (err) {
        console.error('Failed to load items:', err);
    }
}

function updateStatusCounts() {
    const counts = {
        pending: 0,
        approved: 0,
        live: 0,
        rejected: 0,
        sold: 0,
        unsold: 0,
        frozen: 0,
        slashed: 0
    };

    allItems.forEach(item => {
        if (item.status === 'PENDING') counts.pending++;
        else if (item.status === 'APPROVED') counts.approved++;
        else if (item.status === 'LIVE') counts.live++;
        else if (item.status === 'REJECTED') counts.rejected++;
        else if (item.status === 'SOLD') counts.sold++;
        else if (item.status === 'UNSOLD' || item.status === 'ENDED') counts.unsold++;
        else if (item.status === 'FROZEN') counts.frozen++;
        else if (item.status === 'SLASHED') counts.slashed++;
    });

    // Update counts and hide if 0
    const pendingEl = document.getElementById('pendingCount');
    const approvedEl = document.getElementById('approvedCount');
    const liveEl = document.getElementById('liveCount');
    const rejectedEl = document.getElementById('rejectedCount');
    const soldEl = document.getElementById('soldCount');
    const unsoldEl = document.getElementById('unsoldCount');
    const frozenEl = document.getElementById('frozenCount');

    pendingEl.textContent = counts.pending;
    pendingEl.style.display = counts.pending > 0 ? 'inline-block' : 'none';

    approvedEl.textContent = counts.approved;
    approvedEl.style.display = counts.approved > 0 ? 'inline-block' : 'none';

    if (liveEl) {
        liveEl.textContent = counts.live;
        liveEl.style.display = counts.live > 0 ? 'inline-block' : 'none';
    }

    rejectedEl.textContent = counts.rejected;
    rejectedEl.style.display = counts.rejected > 0 ? 'inline-block' : 'none';

    soldEl.textContent = counts.sold;
    soldEl.style.display = counts.sold > 0 ? 'inline-block' : 'none';

    unsoldEl.textContent = counts.unsold;
    unsoldEl.style.display = counts.unsold > 0 ? 'inline-block' : 'none';

    if (frozenEl) {
        frozenEl.textContent = counts.frozen;
        frozenEl.style.display = counts.frozen > 0 ? 'inline-block' : 'none';
    }

    const slashedEl = document.getElementById('slashedCount');
    if (slashedEl) {
        slashedEl.textContent = counts.slashed;
        slashedEl.style.display = counts.slashed > 0 ? 'inline-block' : 'none';
    }
}

function renderItems() {
    const container = document.getElementById('itemsList');
    const noItems = document.getElementById('noItems');
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();

    let filtered = allItems;

    // Filter by status
    if (currentFilter !== 'all') {
        if (currentFilter === 'unsold') {
            filtered = filtered.filter(i => i.status === 'UNSOLD' || i.status === 'ENDED');
        } else if (currentFilter === 'frozen') {
            filtered = filtered.filter(i => i.status === 'FROZEN');
        } else if (currentFilter === 'slashed') {
            filtered = filtered.filter(i => i.status === 'SLASHED');
        } else if (currentFilter === 'live') {
            filtered = filtered.filter(i => i.status === 'LIVE');
        } else {
            filtered = filtered.filter(i => i.status === currentFilter.toUpperCase());
        }
    }

    // Filter by search (include seller name and email)
    if (searchQuery) {
        filtered = filtered.filter(i =>
            i.name.toLowerCase().includes(searchQuery) ||
            i.description.toLowerCase().includes(searchQuery) ||
            (i.sellerName && i.sellerName.toLowerCase().includes(searchQuery)) ||
            (i.sellerEmail && i.sellerEmail.toLowerCase().includes(searchQuery))
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = '';
        noItems.style.display = 'block';
        return;
    }

    noItems.style.display = 'none';
    container.innerHTML = filtered.map(item => {
        return `
        <div class="item-row ${item.status === 'FROZEN' || item.status === 'SLASHED' ? 'frozen-row' : ''}" onclick="openItemModal('${item.id}')">
            <img src="${getImageUrl(item.imageCID)}" alt="${item.name}" class="item-thumb">
            <div class="item-info">
                <h3 class="item-name">${escapeHtml(item.name)}</h3>
                <p class="item-seller">
                    <i class="fas fa-user"></i> ${escapeHtml(item.sellerName || 'Unknown')}
                </p>
            </div>
            <span class="item-status status-${item.status.toLowerCase()}">${item.status}</span>
            ${item.status === 'PENDING' ? `
                <div class="item-actions" onclick="event.stopPropagation()">
                    <button class="btn-approve" onclick="approveItem('${item.id}')">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button class="btn-reject" onclick="openRejectModal('${item.id}')">
                        <i class="fas fa-times"></i> Reject
                    </button>
                </div>
            ` : ''}
            ${item.status === 'LIVE' ? `
                <div class="item-actions" onclick="event.stopPropagation()">
                    <button class="btn-freeze" onclick="openFreezeModal('${item.id}')">
                        <i class="fas fa-snowflake"></i> Freeze
                    </button>
                </div>
            ` : ''}
            ${item.status === 'FROZEN' ? `
                <div class="item-actions" onclick="event.stopPropagation()">
                    <button class="btn-unfreeze" onclick="unfreezeItem('${item.id}')">
                        <i class="fas fa-fire"></i> Unfreeze
                    </button>
                    <button class="btn-slash" onclick="slashBond('${item.id}')">
                        <i class="fas fa-gavel"></i> Slash Bond
                    </button>
                </div>
            ` : ''}
        </div>
    `;
    }).join('');
}

function getImageUrl(cid) {
    if (!cid) return '';
    if (cid.startsWith('http')) return cid;
    if (cid.startsWith('mock-cid-')) return '';
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
}

function openItemModal(itemId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;

    selectedItem = item;

    // Set item info
    document.getElementById('modalItemName').textContent = item.name;
    document.getElementById('modalItemImage').src = getImageUrl(item.imageCID);
    document.getElementById('modalItemDescription').textContent = item.description;
    document.getElementById('modalItemPrice').textContent = `${item.startingPrice} ETH`;

    // Set auction duration
    const durationRow = document.getElementById('modalDurationRow');
    if (durationRow) {
        if (item.biddingTime) {
            durationRow.style.display = 'block';
            const durationMinutes = Math.floor(item.biddingTime / 60);
            const durationDisplay = durationMinutes >= 60 
                ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m` 
                : `${durationMinutes} minutes`;
            document.getElementById('modalDuration').textContent = durationDisplay;
        } else {
            durationRow.style.display = 'none';
        }
    }

    // Set bond deposit
    const bondRow = document.getElementById('modalBondRow');
    if (bondRow) {
        if (item.depositAmount) {
            bondRow.style.display = 'block';
            document.getElementById('modalBondAmount').textContent = `${item.depositAmount} ETH`;
        } else {
            bondRow.style.display = 'none';
        }
    }

    // Set seller info
    document.getElementById('modalSellerName').textContent = item.sellerName || 'Unknown';
    document.getElementById('modalSellerEmail').textContent = item.sellerEmail || 'Unknown';

    // Set status
    const statusEl = document.getElementById('modalItemStatus');
    statusEl.textContent = item.status;
    statusEl.className = `status-badge status-${item.status.toLowerCase()}`;

    // Show reject reason if rejected
    const rejectRow = document.getElementById('rejectReasonRow');
    if (item.status === 'REJECTED' && item.rejectReason) {
        rejectRow.style.display = 'block';
        document.getElementById('modalRejectReason').textContent = item.rejectReason;
    } else {
        rejectRow.style.display = 'none';
    }

    // Show freeze reason if frozen
    const freezeReasonRow = document.getElementById('freezeReasonRow');
    if (item.status === 'FROZEN' && item.freezeReason) {
        freezeReasonRow.style.display = 'block';
        document.getElementById('modalFreezeReason').textContent = item.freezeReason;
    } else {
        freezeReasonRow.style.display = 'none';
    }

    // Show slash reason if slashed
    const slashReasonRow = document.getElementById('slashReasonRow');
    if (item.status === 'SLASHED' && item.freezeReason) {
        slashReasonRow.style.display = 'block';
        document.getElementById('modalSlashReason').textContent = item.freezeReason;
    } else {
        slashReasonRow.style.display = 'none';
    }

    // Show contract address and auction times if item has contract
    // This includes: APPROVED, SOLD, DEPLOYED, PENDING with contract (submit-deploy flow), and REJECTED
    const contractRow = document.getElementById('contractAddressRow');
    const auctionStartRow = document.getElementById('auctionStartTimeRow');
    const auctionEndRow = document.getElementById('auctionEndTimeRow');

    // Show contract info for items with contract (including REJECTED for Etherscan proof)
    const hasContract = item.contractAddress;

    if (hasContract) {
        contractRow.style.display = 'block';
        const contractLink = document.getElementById('modalContractAddress');
        contractLink.textContent = item.contractAddress; // Full address, no shortcut
        contractLink.href = `https://sepolia.etherscan.io/address/${item.contractAddress}`;

        // For REJECTED items, don't show auction start/end times
        if (item.status === 'REJECTED') {
            auctionStartRow.style.display = 'none';
            auctionEndRow.style.display = 'none';
        } else {
            // Auction Starts on = deployedAt (when seller clicks Start)
            // For LIVE items, use deployedAt; for APPROVED items waiting to start, hide
            const auctionStartTime = item.deployedAt;
            if (auctionStartTime) {
                auctionStartRow.style.display = 'block';
                const startDate = new Date(auctionStartTime);
                document.getElementById('modalAuctionStartTime').textContent = startDate.toLocaleString();

                // Auction Ends on = auctionEndTime (Unix timestamp from contract)
                if (item.auctionEndTime) {
                    auctionEndRow.style.display = 'block';
                    // auctionEndTime is Unix timestamp in seconds
                    const endDate = new Date(item.auctionEndTime * 1000);
                    document.getElementById('modalAuctionEndTime').textContent = endDate.toLocaleString();
                } else if (item.biddingTime) {
                    // Fallback: calculate from start + biddingTime
                    auctionEndRow.style.display = 'block';
                    const endDate = new Date(startDate.getTime() + (item.biddingTime * 1000));
                    document.getElementById('modalAuctionEndTime').textContent = endDate.toLocaleString();
                } else {
                    auctionEndRow.style.display = 'none';
                }
            } else {
                // APPROVED items: waiting for seller to start auction
                auctionStartRow.style.display = 'none';
                auctionEndRow.style.display = 'none';
            }
        }
    } else {
        contractRow.style.display = 'none';
        auctionStartRow.style.display = 'none';
        auctionEndRow.style.display = 'none';
    }

    // Show/hide Sale Information for SOLD items
    const saleInfoCard = document.getElementById('saleInfoCard');
    if (saleInfoCard) {
        if (item.status === 'SOLD') {
            saleInfoCard.style.display = 'block';
            const winnerEl = document.getElementById('modalWinner');
            const winningBidEl = document.getElementById('modalWinningBid');
            const txHashEl = document.getElementById('modalTxHash');

            if (winnerEl) {
                winnerEl.textContent = item.winner || 'N/A';
            }
            if (winningBidEl) {
                winningBidEl.textContent = `${item.winningBid || '0'} ETH`;
            }
            if (txHashEl) {
                if (item.claimTxHash) {
                    txHashEl.href = `https://sepolia.etherscan.io/tx/${item.claimTxHash}`;
                    txHashEl.textContent = item.claimTxHash;
                    txHashEl.parentElement.style.display = 'flex';
                } else {
                    txHashEl.parentElement.style.display = 'none';
                }
            }
        } else {
            saleInfoCard.style.display = 'none';
        }
    }

    // Show/hide arbitration card for frozen items only
    const arbitrationCard = document.getElementById('arbitrationCard');
    const arbitrationContent = document.getElementById('arbitrationContent');
    const arbitrationReason = document.getElementById('arbitrationReason');
    const btnArbUnfreeze = document.getElementById('btnArbUnfreeze');
    const btnArbSlash = document.getElementById('btnArbSlash');
    
    if (arbitrationCard) {
        if (item.status === 'FROZEN') {
            arbitrationCard.style.display = 'block';
            
            // Set placeholder - simple text only
            if (arbitrationReason) {
                arbitrationReason.value = '';
                arbitrationReason.placeholder = 'Enter reason for action...';
            }
            
            // Setup button handlers
            if (btnArbUnfreeze) {
                btnArbUnfreeze.onclick = () => {
                    closeItemModal();
                    unfreezeItem(item.id);
                };
            }
            if (btnArbSlash) {
                btnArbSlash.onclick = () => {
                    closeItemModal();
                    slashBond(item.id);
                };
            }
        } else if (item.status === 'SLASHED') {
            arbitrationCard.style.display = 'block';
            arbitrationContent.innerHTML = `
                <div class="slashed-display">
                    <div class="slashed-badge"><i class="fas fa-gavel"></i> Bond Slashed</div>
                    <p>The seller's bond has been slashed.</p>
                    ${item.freezeReason ? `<p class="freeze-reason-text">Reason: ${escapeHtml(item.freezeReason)}</p>` : ''}
                </div>
            `;
        } else {
            arbitrationCard.style.display = 'none';
        }
    }

    // Render actions
    const actionsEl = document.getElementById('modalActions');
    // All PENDING items can be approved or rejected (seller already deployed contract)
    if (item.status === 'PENDING') {
        actionsEl.innerHTML = `
            <button class="btn-secondary" onclick="closeItemModal()">Close</button>
            <button class="btn-danger" onclick="closeItemModal(); openRejectModal('${item.id}')">
                <i class="fas fa-times"></i> Reject
            </button>
            <button class="btn-success" onclick="approveItem('${item.id}')" id="approveBtn">
                <i class="fas fa-check"></i> Approve
            </button>
        `;
    } else {
        actionsEl.innerHTML = `<button class="btn-secondary" onclick="closeItemModal()">Close</button>`;
    }

    document.getElementById('itemModal').style.display = 'flex';
}

function closeItemModal() {
    document.getElementById('itemModal').style.display = 'none';
    selectedItem = null;
}

function openRejectModal(itemId) {
    document.getElementById('rejectItemId').value = itemId;
    document.getElementById('rejectReason').value = '';
    document.getElementById('rejectError').style.display = 'none';
    document.getElementById('rejectModal').style.display = 'flex';
}

function closeRejectModal() {
    document.getElementById('rejectModal').style.display = 'none';
}

function initRejectForm() {
    document.getElementById('rejectForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const itemId = document.getElementById('rejectItemId').value;
        const reason = document.getElementById('rejectReason').value.trim();
        const errorEl = document.getElementById('rejectError');
        const submitBtn = document.getElementById('rejectSubmitBtn');

        if (!reason) {
            errorEl.textContent = 'Please provide a rejection reason';
            errorEl.style.display = 'block';
            return;
        }

        // Close modals and show loading overlay
        closeRejectModal();
        closeItemModal();
        showTransactionOverlay('Rejecting Item...');

        try {
            const token = localStorage.getItem('auction_token');
            const res = await fetch(`/api/admin/items/${itemId}/reject`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ reason })
            });

            const data = await res.json();
            hideTransactionOverlay();

            if (data.ok) {
                // NEW FLOW: No bond refund needed - seller hasn't deposited yet
                // Just show simple success toast
                showToast('success', 'Item Rejected', data.message || 'Item has been rejected', 3000);
                
                loadItems();
            } else {
                showToast('error', 'Rejection Failed', data.error || 'Failed to reject item');
            }
        } catch (err) {
            hideTransactionOverlay();
            showToast('error', 'Connection Error', 'Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-times"></i> Reject Item';
        }
    });
}

// Transaction loading overlay
let isProcessingTransaction = false;

function showTransactionOverlay(message = 'Processing transaction...') {
    if (document.getElementById('transactionOverlay')) return;
    
    isProcessingTransaction = true;
    const overlay = document.createElement('div');
    overlay.id = 'transactionOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(8px);';
    overlay.innerHTML = `
        <div style="text-align:center;color:#fff;">
            <div style="width:80px;height:80px;border:4px solid rgba(168,85,247,0.3);border-top-color:#a855f7;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 24px;"></div>
            <h3 style="font-size:1.5rem;margin-bottom:12px;font-weight:600;">${message}</h3>
            <p style="color:#94a3b8;font-size:0.95rem;">Please wait while the blockchain transaction is being processed...</p>
            <p style="color:#64748b;font-size:0.85rem;margin-top:8px;">This may take 15-30 seconds</p>
        </div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(overlay);
}

function hideTransactionOverlay() {
    isProcessingTransaction = false;
    const overlay = document.getElementById('transactionOverlay');
    if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s ease';
        setTimeout(() => overlay.remove(), 300);
    }
}

async function approveItem(itemId) {
    // Prevent double-click
    if (isProcessingTransaction) return;
    
    // All PENDING items can be approved (seller already deployed contract via MetaMask)
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;

    if (item.status !== 'PENDING') {
        showToast('error', 'Cannot Approve', 'Only pending items can be approved');
        return;
    }

    // Show loading overlay
    showTransactionOverlay('Starting Auction...');
    closeItemModal();

    const token = localStorage.getItem('auction_token');

    try {
        const res = await fetch(`/api/admin/items/${itemId}/approve`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await res.json();
        hideTransactionOverlay();

        if (data.ok) {
            showToast('success', 'Item Approved', 'Item has been approved successfully');
            loadItems();
        } else {
            showToast('error', 'Approval Failed', data.error || 'Failed to approve item');
        }
    } catch (err) {
        hideTransactionOverlay();
        console.error('Approve error:', err);
        showToast('error', 'Connection Error', 'Please try again.');
    }
}

// Show deployment success modal with contract address and transaction hash
function showDeploymentSuccessModal(contractAddress, transactionHash) {
    // Remove existing modal if any
    const existingModal = document.getElementById('deploymentSuccessModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'deploymentSuccessModal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content modal-small deployment-success-modal">
            <div class="modal-header success-header">
                <h3><i class="fas fa-check-circle"></i> Deployment Successful!</h3>
            </div>
            <div class="modal-body">
                <div class="deployment-info">
                    <div class="info-item">
                        <label><i class="fas fa-file-contract"></i> Contract Address:</label>
                        <code class="address-code">${contractAddress}</code>
                    </div>
                    <div class="info-item">
                        <label><i class="fas fa-receipt"></i> Transaction Hash:</label>
                        <code class="address-code">${transactionHash}</code>
                    </div>
                </div>
            </div>
            <div class="modal-actions deployment-actions">
                <button class="btn-secondary" onclick="closeDeploymentModal()">
                    <i class="fas fa-check"></i> OK
                </button>
                <a href="https://sepolia.etherscan.io/tx/${transactionHash}" target="_blank" class="btn-primary">
                    <i class="fas fa-external-link-alt"></i> View on Etherscan
                </a>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function closeDeploymentModal() {
    const modal = document.getElementById('deploymentSuccessModal');
    if (modal) modal.remove();
}

window.closeDeploymentModal = closeDeploymentModal;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.openItemModal = openItemModal;
window.closeItemModal = closeItemModal;
window.openRejectModal = openRejectModal;
window.closeRejectModal = closeRejectModal;
window.approveItem = approveItem;

// =============================================
// FREEZE/UNFREEZE/SLASH FUNCTIONS
// =============================================

function openFreezeModal(itemId) {
    document.getElementById('freezeItemId').value = itemId;
    document.getElementById('freezeReason').value = '';
    document.getElementById('freezeError').style.display = 'none';
    document.getElementById('freezeModal').style.display = 'flex';
}

function closeFreezeModal() {
    document.getElementById('freezeModal').style.display = 'none';
}

// Initialize freeze form
document.addEventListener('DOMContentLoaded', () => {
    const freezeForm = document.getElementById('freezeForm');
    if (freezeForm) {
        freezeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const itemId = document.getElementById('freezeItemId').value;
            const reason = document.getElementById('freezeReason').value.trim();
            const errorEl = document.getElementById('freezeError');
            const submitBtn = document.getElementById('freezeSubmitBtn');
            
            if (!reason) {
                errorEl.textContent = 'Please provide a freeze reason';
                errorEl.style.display = 'block';
                return;
            }
            
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Freezing...';
            
            try {
                const token = localStorage.getItem('auction_token');
                const res = await fetch(`/api/admin/items/${itemId}/freeze`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ reason })
                });
                
                const data = await res.json();
                
                if (data.ok) {
                    closeFreezeModal();
                    closeItemModal();
                    showToast('success', 'Auction Frozen', 'The auction has been frozen. Bidding is now disabled.');
                    loadItems();
                } else {
                    errorEl.textContent = data.error || 'Failed to freeze auction';
                    errorEl.style.display = 'block';
                }
            } catch (err) {
                errorEl.textContent = 'Connection error';
                errorEl.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-snowflake"></i> Freeze Auction';
            }
        });
    }
});

async function unfreezeItem(itemId) {
    console.log('unfreezeItem called:', itemId);
    
    try {
        const confirmed = await showConfirmModal(
            'Unfreeze Auction?',
            'Are you sure you want to unfreeze this auction? Bidding will resume.',
            'Unfreeze',
            'warning'
        );
        
        console.log('Confirm result:', confirmed);
        if (!confirmed) return;
        
        showTransactionOverlay('Unfreezing Auction...');
    
        const token = localStorage.getItem('auction_token');
        const res = await fetch(`/api/admin/items/${itemId}/unfreeze`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        hideTransactionOverlay();
        
        if (data.ok) {
            showToast('success', 'Auction Unfrozen', 'The auction has been unfrozen. Bidding is now enabled.');
            loadItems();
        } else {
            showToast('error', 'Unfreeze Failed', data.error || 'Failed to unfreeze auction');
        }
    } catch (err) {
        console.error('Unfreeze error:', err);
        hideTransactionOverlay();
        showToast('error', 'Error', 'Connection error. Please try again.');
    }
}

async function slashBond(itemId) {
    console.log('slashBond called:', itemId);
    
    try {
        const item = allItems.find(i => i.id === itemId);
        if (!item) {
            console.log('Item not found');
            return;
        }
        
        const confirmed = await showConfirmModal(
            'Slash Seller Bond?',
            `Are you sure you want to slash the seller bond for "${item.name}"?\n\nThis action cannot be undone. The seller will lose their collateral.`,
            'Slash Bond',
            'danger'
        );
        
        console.log('Confirm result:', confirmed);
        if (!confirmed) return;
        
        showTransactionOverlay('Slashing Bond...');
        
        const token = localStorage.getItem('auction_token');
        const res = await fetch(`/api/admin/items/${itemId}/slash`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        hideTransactionOverlay();
        
        if (data.ok) {
            showToast('success', 'Bond Slashed', 'The seller bond has been slashed. The item is now marked as SLASHED.');
            loadItems();
        } else {
            showToast('error', 'Slash Failed', data.error || 'Failed to slash bond');
        }
    } catch (err) {
        console.error('Slash bond error:', err);
        hideTransactionOverlay();
        showToast('error', 'Error', 'Connection error. Please try again.');
    }
}

window.openFreezeModal = openFreezeModal;
window.closeFreezeModal = closeFreezeModal;
window.unfreezeItem = unfreezeItem;
window.slashBond = slashBond;

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
        modal.className = 'modal';
        // Use same style as other modals - display:flex shows it immediately, z-index 9999 to be on top
        modal.style.cssText = 'display:flex;z-index:9999;';
        modal.innerHTML = `
            <div class="confirm-modal" style="background:linear-gradient(145deg,#1e293b,#0f172a);border-radius:16px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);transform:scale(1);transition:transform 0.3s ease;">
                <div class="confirm-modal-icon" style="font-size:48px;margin-bottom:20px;color:${colorMap[type]}">
                    <i class="fas ${iconMap[type]}"></i>
                </div>
                <h3 class="confirm-modal-title" style="color:#f8fafc;font-size:1.5rem;margin-bottom:12px;font-weight:600;">${title}</h3>
                <p class="confirm-modal-message" style="color:#94a3b8;font-size:0.95rem;line-height:1.6;margin-bottom:28px;">${message.replace(/\n/g, '<br>')}</p>
                <div class="confirm-modal-actions" style="display:flex;gap:12px;justify-content:center;">
                    <button class="btn-secondary" id="confirmModalCancel" style="padding:12px 24px;border-radius:8px;font-weight:500;cursor:pointer;background:#334155;color:#f8fafc;border:none;transition:all 0.2s;">Cancel</button>
                    <button class="btn-${type === 'danger' ? 'danger' : 'primary'}" id="confirmModalConfirm" style="padding:12px 24px;border-radius:8px;font-weight:500;cursor:pointer;background:${type === 'danger' ? '#dc2626' : '#3b82f6'};color:#fff;border:none;transition:all 0.2s;">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Handle confirm
        document.getElementById('confirmModalConfirm').addEventListener('click', () => {
            modal.style.display = 'none';
            setTimeout(() => modal.remove(), 100);
            resolve(true);
        });

        // Handle cancel
        document.getElementById('confirmModalCancel').addEventListener('click', () => {
            modal.style.display = 'none';
            setTimeout(() => modal.remove(), 100);
            resolve(false);
        });

        // Handle click outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                setTimeout(() => modal.remove(), 100);
                resolve(false);
            }
        });

        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                setTimeout(() => modal.remove(), 100);
                document.removeEventListener('keydown', handleEscape);
                resolve(false);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

// Toast notification system
function showToast(type, title, message, duration = 5000) {
    // Create toast container if not exists
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? 'fa-check-circle' :
        type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';

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

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto-dismiss after duration
    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.remove('show');
                toast.classList.add('hide');
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    }
}

function closeToast(btn) {
    const toast = btn.parentElement;
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
}

window.closeToast = closeToast;

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
                '.btn-nav',
                '.btn-logout',
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
                '.item-row',
                '.menu-item',
                '.btn-primary',
                '.btn-secondary',
                '.btn-approve',
                '.btn-reject',
                '.btn-nav',
                '.btn-logout',
                '.search-box',
                '.modal',
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
