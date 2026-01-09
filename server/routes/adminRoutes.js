const express = require('express');
const { verifyToken } = require('./authRoutes');
const { isAdmin } = require('../config/admin');
const db = require('../config/db');
const { sendApprovalNotification, sendRejectionNotification } = require('../services/emailService');

const router = express.Router();

// Socket.io instance (set from server.js)
let io = null;

// Auction cache functions (set from server.js)
let setAuctionFrozen = null;
let updateAuctionEndTime = null;

// Set socket.io instance
router.setSocketIO = (socketIO) => {
    io = socketIO;
};

// Set auction cache functions
router.setAuctionCacheFunctions = (freezeFn, updateEndTimeFn) => {
    setAuctionFrozen = freezeFn;
    updateAuctionEndTime = updateEndTimeFn;
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (!isAdmin(req.user.email)) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

/**
 * GET /api/admin/items
 * Get all items with seller info (admin only)
 */
router.get('/items', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let items;

        if (status && ['PENDING', 'DEPLOYED', 'APPROVED', 'REJECTED'].includes(status)) {
            items = await db.getItemsByStatus(status);
        } else {
            items = await db.getAllItems();
        }

        // Enrich items with seller info
        const enrichedItems = await Promise.all(items.map(async (item) => {
            const seller = await db.getUserById(item.sellerId);
            return {
                ...item,
                sellerName: seller?.name || 'Unknown',
                sellerEmail: seller?.email || 'Unknown'
            };
        }));

        res.json({ ok: true, items: enrichedItems });
    } catch (error) {
        console.error('Get admin items error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/admin/items/:id
 * Get a specific item with seller info (admin only)
 */
router.get('/items/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Get seller info
        const seller = await db.getUserById(item.sellerId);
        const enrichedItem = {
            ...item,
            sellerName: seller?.name || 'Unknown',
            sellerEmail: seller?.email || 'Unknown'
        };

        res.json({ ok: true, item: enrichedItem });
    } catch (error) {
        console.error('Get item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/items/:id/approve
 * Approve a PENDING item (admin only)
 * New flow (no gas fee for admin): 
 * 1. Seller submits item WITHOUT deploying contract
 * 2. Admin approves → only updates database status to APPROVED
 * 3. Item goes back to seller with "Start" button
 * 4. Seller clicks "Start" → deploys contract + deposits bond + auto-starts auction (1 gas fee)
 * 5. Item becomes visible to buyers
 */
router.post('/items/:id/approve', verifyToken, requireAdmin, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Only PENDING items can be approved
        if (item.status !== 'PENDING') {
            return res.status(400).json({ error: 'Only pending items can be approved.' });
        }

        // NEW FLOW: Admin approval only updates database
        // No blockchain transaction needed - seller will deploy when clicking "Start"
        console.log('Approving item (database only):', item.id);

        // Approve the item - update status and set approvedAt
        // NOTE: contractAddress and auctionEndTime will be set when seller deploys
        const updatedItem = await db.updateItem(req.params.id, {
            status: 'APPROVED',
            approvedAt: new Date().toISOString(),
            rejectReason: null
            // contractAddress, auctionEndTime will be set when seller clicks "Start"
        });

        // Send email notification to seller
        const seller = await db.getUserById(item.sellerId);
        if (seller) {
            sendApprovalNotification(updatedItem, seller.email, seller.name).catch(console.error);
        }

        res.json({ 
            ok: true, 
            item: updatedItem,
            message: 'Item approved! Seller can now start the auction.'
        });
    } catch (error) {
        console.error('Approve item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/items/:id/reject
 * Reject an item with reason (admin only)
 * NEW FLOW: PENDING items don't have contracts yet (contract deployed after approval + seller clicks Start)
 * So rejection is simple - just update database status, no bond refund needed
 */
router.post('/items/:id/reject', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { reason } = req.body;

        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({ error: 'Rejection reason is required' });
        }

        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Can only reject PENDING items
        if (item.status !== 'PENDING') {
            return res.status(400).json({ error: 'Only pending items can be rejected' });
        }

        // NEW FLOW: PENDING items don't have contracts yet
        // Contract is only deployed after admin approval + seller clicks "Start"
        // So no bond refund is needed - seller hasn't deposited anything yet

        // Reject the item
        const updatedItem = await db.rejectItem(req.params.id, reason.trim());

        // Send email notification to seller with reason
        const seller = await db.getUserById(item.sellerId);
        if (seller) {
            sendRejectionNotification(updatedItem, seller.email, seller.name, reason.trim()).catch(console.error);
        }

        res.json({ 
            ok: true, 
            item: updatedItem,
            message: 'Item rejected. Seller can edit and resubmit.'
        });
    } catch (error) {
        console.error('Reject item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/admin/stats
 * Get dashboard statistics (admin only)
 */
router.get('/stats', verifyToken, requireAdmin, async (req, res) => {
    try {
        const allItems = await db.getAllItems();
        
        const stats = {
            total: allItems.length,
            pending: allItems.filter(i => i.status === 'PENDING').length,
            approved: allItems.filter(i => i.status === 'APPROVED').length,
            rejected: allItems.filter(i => i.status === 'REJECTED').length,
            sold: allItems.filter(i => i.status === 'SOLD').length,
            unsold: allItems.filter(i => i.status === 'UNSOLD').length
        };

        res.json({ ok: true, stats });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/items/:id/freeze
 * Freeze an auction (admin only)
 * Only LIVE items (started by seller) can be frozen
 * Calls freezeAuction on the smart contract AND updates database
 * Pauses auction timer by saving remaining time
 */
router.post('/items/:id/freeze', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { reason } = req.body;
        
        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({ error: 'Freeze reason is required' });
        }

        const item = await db.getItemById(req.params.id);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Only LIVE items can be frozen (seller has started the auction)
        if (item.status !== 'LIVE') {
            return res.status(400).json({ error: 'Only live auctions can be frozen' });
        }

        if (!item.contractAddress) {
            return res.status(400).json({ error: 'Item does not have a contract address' });
        }

        // Call freezeAuction on the smart contract
        const contractDeployer = require('../services/contractDeployer');
        const freezeResult = await contractDeployer.freezeAuction(item.contractAddress, reason.trim());
        
        if (!freezeResult.success && !freezeResult.alreadyFrozen) {
            return res.status(500).json({ 
                error: 'Failed to freeze auction on contract', 
                details: freezeResult.error 
            });
        }

        // Calculate remaining time before freeze (in seconds)
        const now = Math.floor(Date.now() / 1000);
        const auctionEndTime = typeof item.auctionEndTime === 'number' 
            ? item.auctionEndTime 
            : parseInt(item.auctionEndTime, 10);
        const remainingTime = auctionEndTime ? Math.max(0, auctionEndTime - now) : 0;

        console.log('Freeze item:', item.id);
        console.log('Current time (Unix):', now);
        console.log('Auction end time:', auctionEndTime);
        console.log('Remaining time (seconds):', remainingTime);

        // Update item status to FROZEN in database
        // Update biddingTime to remaining time (this is the key change!)
        const updatedItem = await db.updateItem(req.params.id, {
            status: 'FROZEN',
            freezeReason: reason.trim(),
            frozenAt: now,
            biddingTime: remainingTime, // Update biddingTime to remaining seconds
            freezeTxHash: freezeResult.transactionHash || null
        });

        console.log('Updated biddingTime to:', remainingTime);

        // Update auction cache to stop timer updates
        if (setAuctionFrozen) {
            setAuctionFrozen(item.contractAddress, true, remainingTime);
        }

        // Emit socket event to notify all clients
        if (io) {
            io.emit('auctionFrozen', {
                auctionId: item.contractAddress,
                itemId: item.id,
                reason: reason.trim(),
                remainingTime: remainingTime,
                biddingTime: remainingTime
            });
        }

        res.json({ 
            ok: true, 
            item: updatedItem,
            contractAddress: item.contractAddress,
            remainingTime: remainingTime,
            biddingTime: remainingTime,
            transactionHash: freezeResult.transactionHash,
            message: 'Auction frozen successfully on blockchain and database.'
        });
    } catch (error) {
        console.error('Freeze item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/items/:id/unfreeze
 * Unfreeze an auction (admin only)
 * Returns item to LIVE status
 * Calls unfreezeAuction on the smart contract AND updates database
 * Uses biddingTime (remaining seconds) to calculate new end time
 */
router.post('/items/:id/unfreeze', verifyToken, requireAdmin, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        if (item.status !== 'FROZEN') {
            return res.status(400).json({ error: 'Only frozen items can be unfrozen' });
        }

        // Call unfreezeAuction on the smart contract
        const contractDeployer = require('../services/contractDeployer');
        const unfreezeResult = await contractDeployer.unfreezeAuction(item.contractAddress);
        
        if (!unfreezeResult.success && !unfreezeResult.notFrozen) {
            return res.status(500).json({ 
                error: 'Failed to unfreeze auction on contract', 
                details: unfreezeResult.error 
            });
        }

        // Use biddingTime (remaining seconds saved when frozen)
        const now = Math.floor(Date.now() / 1000);
        let biddingTime = item.biddingTime || 0;
        
        // Ensure minimum 60 seconds remaining after unfreeze
        if (biddingTime < 60) {
            biddingTime = 60;
            console.log('biddingTime was less than 60s, setting to 60s');
        }
        
        // Calculate new auction end time: now + biddingTime
        const newAuctionEndTime = now + biddingTime;

        console.log('Unfreeze item:', item.id);
        console.log('Current time (Unix):', now);
        console.log('biddingTime (seconds):', biddingTime);
        console.log('New auction end time:', newAuctionEndTime);

        // Update item status back to LIVE with new auction end time
        // biddingTime stays the same (it's the remaining duration)
        const updatedItem = await db.updateItem(req.params.id, {
            status: 'LIVE',
            freezeReason: null,
            frozenAt: null,
            auctionEndTime: newAuctionEndTime,
            unfreezeTxHash: unfreezeResult.transactionHash || null
        });

        console.log('Updated item auctionEndTime:', updatedItem.auctionEndTime);

        // Update auction cache with new end time
        if (updateAuctionEndTime) {
            updateAuctionEndTime(item.contractAddress, newAuctionEndTime);
        }

        // Emit socket event to notify all clients
        if (io) {
            io.emit('auctionUnfrozen', {
                auctionId: item.contractAddress,
                itemId: item.id,
                newAuctionEndTime: newAuctionEndTime,
                biddingTime: biddingTime
            });
        }

        res.json({ 
            ok: true, 
            item: updatedItem,
            contractAddress: item.contractAddress,
            newAuctionEndTime: newAuctionEndTime,
            biddingTime: biddingTime,
            transactionHash: unfreezeResult.transactionHash,
            message: 'Auction unfrozen successfully on blockchain and database.'
        });
    } catch (error) {
        console.error('Unfreeze item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/items/:id/slash
 * Slash seller bond (admin only)
 * Must be frozen first
 */
router.post('/items/:id/slash', verifyToken, requireAdmin, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        if (item.status !== 'FROZEN') {
            return res.status(400).json({ error: 'Item must be frozen before slashing bond' });
        }

        if (!item.contractAddress) {
            return res.status(400).json({ error: 'No contract address found' });
        }

        // Call slashSellerBond on the smart contract
        const contractDeployer = require('../services/contractDeployer');
        const slashResult = await contractDeployer.slashSellerBond(item.contractAddress);
        
        if (!slashResult.success && !slashResult.alreadySlashed) {
            return res.status(500).json({ 
                error: 'Failed to slash bond on contract', 
                details: slashResult.error 
            });
        }

        // Update item status to SLASHED in database
        const updatedItem = await db.updateItem(req.params.id, {
            status: 'SLASHED',
            bondSlashed: true,
            slashedAt: new Date(),
            slashTxHash: slashResult.transactionHash || null,
            slashReason: req.body.reason || 'Seller violated auction rules'
        });

        // Emit socket event for real-time update
        const io = req.app.get('io');
        if (io) {
            io.emit('auctionSlashed', {
                auctionId: item.contractAddress,
                itemId: item.id,
                reason: req.body.reason || 'Seller violated auction rules'
            });
        }

        res.json({ 
            ok: true, 
            item: updatedItem,
            contractAddress: item.contractAddress,
            transactionHash: slashResult.transactionHash,
            slashedAmount: slashResult.slashedAmount,
            message: 'Bond slashed successfully. Bidders can now withdraw their full bids.'
        });
    } catch (error) {
        console.error('Slash bond error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
