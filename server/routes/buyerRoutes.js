const express = require('express');
const { verifyToken } = require('./authRoutes');
const { isAdmin } = require('../config/admin');
const db = require('../config/db');

const router = express.Router();

// Middleware to check buyer role or admin (view-only)
const requireBuyerOrAdmin = (req, res, next) => {
    const userIsAdmin = isAdmin(req.user.email);
    
    if (userIsAdmin) {
        req.isAdminViewOnly = true;
        return next();
    }
    
    if (req.user.role !== 'buyer') {
        return res.status(403).json({ error: 'Buyer role required' });
    }
    
    next();
};

/**
 * GET /api/buyer/items
 * Get all approved items (for buyers and admin view-only)
 * Includes live auctions, recently ended/sold auctions, and slashed auctions
 */
router.get('/items', verifyToken, requireBuyerOrAdmin, async (req, res) => {
    try {
        // Get approved items (live and recently ended)
        const approvedItems = await db.getApprovedItems();
        
        // Also get recently sold items (within last 24 hours) for display
        const now = Math.floor(Date.now() / 1000);
        const twentyFourHoursAgo = now - (24 * 60 * 60);
        
        // Get sold items
        const allSoldItems = await db.getSoldItems();
        const recentSoldItems = allSoldItems.filter(item => 
            item.finalizedAt && new Date(item.finalizedAt).getTime() / 1000 > twentyFourHoursAgo
        );
        
        // Get unsold/ended items (within last 24 hours)
        const allEndedItems = await db.getEndedItems();
        const recentEndedItems = allEndedItems.filter(item =>
            item.finalizedAt && new Date(item.finalizedAt).getTime() / 1000 > twentyFourHoursAgo
        );
        
        // Get slashed items (all, so buyers can withdraw their bids)
        const slashedItems = await db.getSlashedItems();
        
        // Combine and deduplicate
        const allItems = [...approvedItems, ...recentSoldItems, ...recentEndedItems, ...slashedItems];
        
        // Remove sensitive fields from items for buyers
        // Keep highestBid and highestBidder for display
        const sanitizedItems = allItems.map(item => {
            // No sensitive fields to remove currently
            return item;
        });
        
        res.json({ 
            ok: true, 
            items: sanitizedItems,
            viewOnly: req.isAdminViewOnly || false
        });
    } catch (error) {
        console.error('Get buyer items error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/buyer/items/:id
 * Get a specific approved/sold item with auction details
 */
router.get('/items/:id', verifyToken, requireBuyerOrAdmin, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Show live, frozen, sold, or ended items to buyers
        const allowedStatuses = ['LIVE', 'FROZEN', 'SOLD', 'ENDED'];
        if (!allowedStatuses.includes(item.status)) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Remove sensitive fields for buyers
        // No sensitive fields to remove currently

        res.json({ 
            ok: true, 
            item: item,
            viewOnly: req.isAdminViewOnly || false
        });
    } catch (error) {
        console.error('Get item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
