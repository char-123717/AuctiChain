const express = require('express');
const multer = require('multer');
const { verifyToken } = require('./authRoutes');
const db = require('../config/db');
const { uploadToIPFS } = require('../services/ipfs');
const { sendNewItemNotification, sendResubmitNotification } = require('../services/emailService');

const router = express.Router();

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

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Middleware to check seller role
const requireSeller = (req, res, next) => {
    if (req.user.isAdmin) {
        return res.status(403).json({ error: 'Admin cannot access seller routes' });
    }
    if (req.user.role !== 'seller') {
        return res.status(403).json({ error: 'Seller role required' });
    }
    next();
};

/**
 * GET /api/seller/items
 * Get all items for the current seller
 */
router.get('/items', verifyToken, requireSeller, async (req, res) => {
    try {
        const { status } = req.query;
        let items;

        if (status && ['PENDING', 'APPROVED', 'REJECTED', 'SOLD', 'ENDED'].includes(status)) {
            // Get items by status for this seller
            const allItems = await db.getItemsBySellerId(req.user.id);
            items = allItems.filter(item => item.status === status);
        } else {
            items = await db.getItemsBySellerId(req.user.id);
        }

        res.json({ ok: true, items });
    } catch (error) {
        console.error('Get seller items error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/seller/items/:id
 * Get a specific item (must belong to seller)
 */
router.get('/items/:id', verifyToken, requireSeller, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Check ownership
        if (item.sellerId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ ok: true, item });
    } catch (error) {
        console.error('Get item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/seller/items
 * Create a new item
 */
router.post('/items', verifyToken, requireSeller, upload.single('image'), async (req, res) => {
    try {
        const { name, description, startingPrice, sellerWallet, depositAmount, bondTxHash, bondTimestamp } = req.body;

        // Validation
        if (!name || !description || !startingPrice) {
            return res.status(400).json({ error: 'Name, description, and starting price are required' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Image is required' });
        }

        const price = parseFloat(startingPrice);
        if (isNaN(price) || price < MIN_STARTING_PRICE) {
            return res.status(400).json({ error: `Starting price must be at least ${MIN_STARTING_PRICE} ETH` });
        }

        // Validate decimal places (max 3)
        if (!validateDecimalPlaces(startingPrice)) {
            return res.status(400).json({ error: `Starting price must have maximum ${MAX_DECIMAL_PLACES} decimal places (e.g., 0.001)` });
        }

        // Validate seller wallet (required for bond deposit)
        if (!sellerWallet || !/^0x[a-fA-F0-9]{40}$/.test(sellerWallet)) {
            return res.status(400).json({ error: 'Valid seller wallet address is required' });
        }

        // Validate deposit amount (required for bond)
        const deposit = parseFloat(depositAmount);
        if (isNaN(deposit) || deposit < 0.01) {
            return res.status(400).json({ error: 'Bond deposit must be at least 0.01 ETH' });
        }

        // Validate bond transaction hash (required - seller deposits bond directly to Auction contract)
        if (!bondTxHash || !/^0x[a-fA-F0-9]{64}$/.test(bondTxHash)) {
            return res.status(400).json({ error: 'Valid bond transaction hash is required. Please deposit bond first.' });
        }

        // Validate bond timestamp
        if (!bondTimestamp) {
            return res.status(400).json({ error: 'Bond timestamp is required' });
        }

        // Upload image to IPFS
        let imageCID;
        try {
            imageCID = await uploadToIPFS(req.file.buffer, req.file.originalname);
        } catch (ipfsError) {
            console.error('IPFS upload error:', ipfsError);
            return res.status(500).json({ error: 'Failed to upload image' });
        }

        // Create item in database with bond data
        const item = await db.createItem({
            sellerId: req.user.id,
            sellerWallet: sellerWallet.trim(),
            depositAmount: deposit,
            bondTxHash: bondTxHash.trim(),
            bondTimestamp: parseInt(bondTimestamp),
            bondStatus: 'DEPOSITED', // Bond deposited directly to Auction contract
            name: name.trim(),
            description: description.trim(),
            startingPrice: price,
            imageCID,
            status: 'PENDING'
        });

        // Send notification to admins
        const user = await db.getUserById(req.user.id);
        sendNewItemNotification(item, user?.name || req.user.email).catch(console.error);

        res.status(201).json({ ok: true, item });
    } catch (error) {
        console.error('Create item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/seller/items/:id/resubmit
 * Resubmit a REJECTED item WITHOUT deploying contract
 * Flow: Seller updates item data → Status: PENDING → Admin reviews again
 * After admin approval, seller clicks "Start" to deploy
 * NOTE: Wallet connection NOT required for resubmit - only for "Start" button
 */
router.put('/items/:id/resubmit', verifyToken, requireSeller, upload.single('image'), async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ ok: false, error: 'Item not found' });
        }

        // Check ownership
        if (item.sellerId !== req.user.id) {
            return res.status(403).json({ ok: false, error: 'Access denied' });
        }

        // Only REJECTED items can be resubmitted
        if (item.status !== 'REJECTED') {
            return res.status(400).json({ ok: false, error: 'Only rejected items can be resubmitted' });
        }

        const { 
            name, description, startingPrice, 
            depositAmount,
            biddingTime
        } = req.body;

        // ============================================
        // VALIDATION (wallet NOT required for resubmit)
        // ============================================

        // Validate deposit amount
        const deposit = parseFloat(depositAmount);
        if (isNaN(deposit) || deposit < 0.01) {
            return res.status(400).json({ ok: false, error: 'Bond deposit must be at least 0.01 ETH' });
        }

        // Validate name, description, starting price
        if (!name || !name.trim()) {
            return res.status(400).json({ ok: false, error: 'Item name is required' });
        }

        if (!description || !description.trim()) {
            return res.status(400).json({ ok: false, error: 'Item description is required' });
        }

        const price = parseFloat(startingPrice);
        if (isNaN(price) || price < MIN_STARTING_PRICE) {
            return res.status(400).json({ ok: false, error: `Starting price must be at least ${MIN_STARTING_PRICE} ETH` });
        }

        // Validate decimal places (max 3)
        if (!validateDecimalPlaces(startingPrice)) {
            return res.status(400).json({ ok: false, error: `Starting price must have maximum ${MAX_DECIMAL_PLACES} decimal places (e.g., 0.001)` });
        }

        // Validate bidding time
        const biddingTimeSeconds = parseInt(biddingTime);
        if (isNaN(biddingTimeSeconds) || biddingTimeSeconds < 60) {
            return res.status(400).json({ ok: false, error: 'Bidding time must be at least 60 seconds' });
        }

        // ============================================
        // Upload new image if provided
        // ============================================
        let imageCID = item.imageCID;
        if (req.file) {
            try {
                imageCID = await uploadToIPFS(req.file.buffer, req.file.originalname);
            } catch (ipfsError) {
                console.error('IPFS upload error:', ipfsError);
                return res.status(500).json({ ok: false, error: 'Failed to upload image' });
            }
        }

        // ============================================
        // Update item - NO contract deployment
        // Contract will be deployed when seller clicks "Start" after approval
        // sellerWallet will be captured when seller clicks "Start"
        // ============================================
        const updates = {
            sellerWallet: null, // Will be set when seller clicks "Start"
            depositAmount: deposit,
            bondStatus: 'PENDING', // Bond not deposited yet
            name: name.trim(),
            description: description.trim(),
            startingPrice: price,
            imageCID,
            status: 'PENDING', // Back to PENDING for admin review
            rejectReason: null, // Clear old reject reason
            biddingTime: biddingTimeSeconds,
            // Clear old contract info (will be set when seller clicks "Start")
            contractAddress: null,
            auctionId: null,
            auctionEndTime: null,
            deployedAt: null,
            deployTxHash: null,
            bondTxHash: null,
            refundTxHash: null,
            // Clear approval fields
            approvedAt: null,
            startAuctionTxHash: null
        };

        const updatedItem = await db.updateItem(req.params.id, updates);

        // Send notification to admins
        const user = await db.getUserById(req.user.id);
        sendResubmitNotification(updatedItem, user?.name || req.user.email).catch(console.error);

        res.json({ 
            ok: true, 
            item: updatedItem,
            message: 'Item resubmitted! Waiting for admin approval.'
        });
    } catch (error) {
        console.error('Resubmit item error:', error);
        res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

/**
 * PUT /api/seller/items/:id
 * Update an item (only PENDING or REJECTED items can be updated)
 */
router.put('/items/:id', verifyToken, requireSeller, upload.single('image'), async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Check ownership
        if (item.sellerId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Only PENDING or REJECTED items can be updated
        if (item.status === 'APPROVED') {
            return res.status(400).json({ error: 'Approved items cannot be edited' });
        }

        const { name, description, startingPrice, sellerWallet, depositAmount } = req.body;
        const updates = {};

        if (name) updates.name = name.trim();
        if (description) updates.description = description.trim();
        if (startingPrice) {
            const price = parseFloat(startingPrice);
            if (isNaN(price) || price < MIN_STARTING_PRICE) {
                return res.status(400).json({ error: `Starting price must be at least ${MIN_STARTING_PRICE} ETH` });
            }
            // Validate decimal places (max 3)
            if (!validateDecimalPlaces(startingPrice)) {
                return res.status(400).json({ error: `Starting price must have maximum ${MAX_DECIMAL_PLACES} decimal places (e.g., 0.001)` });
            }
            updates.startingPrice = price;
        }

        // Update seller wallet if provided
        if (sellerWallet) {
            if (!/^0x[a-fA-F0-9]{40}$/.test(sellerWallet)) {
                return res.status(400).json({ error: 'Invalid seller wallet address format' });
            }
            updates.sellerWallet = sellerWallet.trim();
        }

        // Update deposit amount if provided
        if (depositAmount) {
            const deposit = parseFloat(depositAmount);
            if (isNaN(deposit) || deposit < 0.01) {
                return res.status(400).json({ error: 'Bond deposit must be at least 0.01 ETH' });
            }
            updates.depositAmount = deposit;
        }

        // Upload new image if provided
        if (req.file) {
            try {
                updates.imageCID = await uploadToIPFS(req.file.buffer, req.file.originalname);
            } catch (ipfsError) {
                console.error('IPFS upload error:', ipfsError);
                return res.status(500).json({ error: 'Failed to upload image' });
            }
        }

        // If item was rejected, resubmit it (set status back to PENDING)
        if (item.status === 'REJECTED') {
            const updatedItem = await db.resubmitItem(req.params.id, updates);
            
            // Send notification to admins
            const user = await db.getUserById(req.user.id);
            sendResubmitNotification(updatedItem, user?.name || req.user.email).catch(console.error);
            
            return res.json({ ok: true, item: updatedItem, resubmitted: true });
        }

        // Regular update for PENDING items
        const updatedItem = await db.updateItem(req.params.id, updates);
        res.json({ ok: true, item: updatedItem });
    } catch (error) {
        console.error('Update item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/seller/items/:id
 * Delete an item (only PENDING or REJECTED items can be deleted)
 */
router.delete('/items/:id', verifyToken, requireSeller, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Check ownership
        if (item.sellerId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Only PENDING or REJECTED items can be deleted
        if (item.status === 'APPROVED') {
            return res.status(400).json({ error: 'Approved items cannot be deleted' });
        }

        await db.deleteItem(req.params.id);
        res.json({ ok: true, message: 'Item deleted' });
    } catch (error) {
        console.error('Delete item error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/seller/items/submit-deploy
 * Submit item WITHOUT deploying (new flow)
 * Flow: Seller submits item data → Status: PENDING → Admin reviews
 * After admin approval, seller clicks "Start" to deploy + bond + start auction
 * NOTE: Wallet connection NOT required for submit - only for "Start" button
 */
router.post('/items/submit-deploy', verifyToken, requireSeller, upload.single('image'), async (req, res) => {
    try {
        const { 
            name, description, startingPrice, 
            depositAmount,
            biddingTime
        } = req.body;

        // ============================================
        // VALIDATION - All inputs (wallet NOT required for submit)
        // ============================================

        // Validate deposit amount (required for bond, minimum 0.01 ETH)
        const deposit = parseFloat(depositAmount);
        if (isNaN(deposit) || deposit < 0.01) {
            return res.status(400).json({ 
                ok: false, 
                error: 'Bond deposit must be at least 0.01 ETH',
                field: 'depositAmount'
            });
        }

        // Validate name, description, starting price
        if (!name || !name.trim()) {
            return res.status(400).json({ 
                ok: false, 
                error: 'Item name is required',
                field: 'name'
            });
        }

        if (!description || !description.trim()) {
            return res.status(400).json({ 
                ok: false, 
                error: 'Item description is required',
                field: 'description'
            });
        }

        const price = parseFloat(startingPrice);
        if (isNaN(price) || price < MIN_STARTING_PRICE) {
            return res.status(400).json({ 
                ok: false, 
                error: `Starting price must be at least ${MIN_STARTING_PRICE} ETH`,
                field: 'startingPrice'
            });
        }

        // Validate decimal places (max 3)
        if (!validateDecimalPlaces(startingPrice)) {
            return res.status(400).json({ 
                ok: false, 
                error: `Starting price must have maximum ${MAX_DECIMAL_PLACES} decimal places (e.g., 0.001)`,
                field: 'startingPrice'
            });
        }

        // Validate image
        if (!req.file) {
            return res.status(400).json({ 
                ok: false, 
                error: 'Image is required',
                field: 'image'
            });
        }

        // Validate bidding time (minimum 60 seconds)
        const biddingTimeSeconds = parseInt(biddingTime);
        if (isNaN(biddingTimeSeconds) || biddingTimeSeconds < 60) {
            return res.status(400).json({ 
                ok: false, 
                error: 'Bidding time must be at least 60 seconds',
                field: 'biddingTime'
            });
        }

        // ============================================
        // STEP 1: Upload image to IPFS
        // ============================================
        let imageCID;
        try {
            imageCID = await uploadToIPFS(req.file.buffer, req.file.originalname);
        } catch (ipfsError) {
            console.error('IPFS upload error:', ipfsError);
            return res.status(500).json({ 
                ok: false, 
                error: 'Failed to upload image',
                step: 'upload'
            });
        }

        // ============================================
        // STEP 2: Create item record with status PENDING
        // NO contract deployment yet - seller will deploy after admin approval
        // sellerWallet will be captured when seller clicks "Start"
        // ============================================
        const item = await db.createItem({
            sellerId: req.user.id,
            sellerWallet: null, // Will be set when seller clicks "Start"
            depositAmount: deposit,
            bondStatus: 'PENDING', // Bond not deposited yet
            name: name.trim(),
            description: description.trim(),
            startingPrice: price,
            imageCID,
            status: 'PENDING', // Waiting for admin approval
            contractAddress: null, // Will be set when seller clicks "Start"
            auctionId: null,
            auctionEndTime: null,
            biddingTime: biddingTimeSeconds
        });

        // Send notification to admins
        const user = await db.getUserById(req.user.id);
        sendNewItemNotification(item, user?.name || req.user.email).catch(console.error);

        res.status(201).json({ 
            ok: true, 
            item,
            message: 'Item submitted! Waiting for admin approval.'
        });
    } catch (error) {
        console.error('Submit error:', error);
        res.status(500).json({ 
            ok: false, 
            error: 'Internal server error' 
        });
    }
});

/**
 * POST /api/seller/items/:id/claimed
 * Mark item as claimed after seller claims proceeds from smart contract
 * Called after successful claimProceeds() transaction
 */
router.post('/items/:id/claimed', verifyToken, requireSeller, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ ok: false, error: 'Item not found' });
        }

        // Check ownership
        if (item.sellerId !== req.user.id) {
            return res.status(403).json({ ok: false, error: 'Access denied' });
        }

        // Only SOLD or UNSOLD items can be claimed
        if (!['SOLD', 'UNSOLD'].includes(item.status)) {
            return res.status(400).json({ ok: false, error: 'Only sold or unsold items can be claimed' });
        }

        // Check if already claimed
        if (item.proceedsClaimed) {
            return res.status(400).json({ ok: false, error: 'Proceeds already claimed' });
        }

        const { claimTxHash, claimedAmount } = req.body;

        // Validate claim transaction hash
        if (!claimTxHash || !/^0x[a-fA-F0-9]{64}$/.test(claimTxHash)) {
            return res.status(400).json({ ok: false, error: 'Valid claim transaction hash is required' });
        }

        // Update item with claim info
        const updatedItem = await db.updateItem(req.params.id, {
            proceedsClaimed: true,
            claimTxHash: claimTxHash.trim(),
            claimedAmount: parseFloat(claimedAmount) || 0,
            claimedAt: new Date().toISOString()
        });

        res.json({ 
            ok: true, 
            item: updatedItem,
            message: 'Proceeds claimed successfully!'
        });
    } catch (error) {
        console.error('Claim proceeds error:', error);
        res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/seller/items/:id/start
 * Start auction for an APPROVED item (deploy + bond + start in one transaction)
 * Called after seller deploys contract via MetaMask
 * Updates item with contract info and changes status to LIVE
 * Also captures sellerWallet address (from MetaMask) at this point
 */
router.post('/items/:id/start', verifyToken, requireSeller, async (req, res) => {
    try {
        const item = await db.getItemById(req.params.id);

        if (!item) {
            return res.status(404).json({ ok: false, error: 'Item not found' });
        }

        // Check ownership
        if (item.sellerId !== req.user.id) {
            return res.status(403).json({ ok: false, error: 'Access denied' });
        }

        // Only APPROVED items can be started
        if (item.status !== 'APPROVED') {
            return res.status(400).json({ ok: false, error: 'Only approved items can be started' });
        }

        const { contractAddress, deployTxHash, auctionEndTime, sellerWallet } = req.body;

        // Validate seller wallet (required at start time)
        if (!sellerWallet || !/^0x[a-fA-F0-9]{40}$/.test(sellerWallet)) {
            return res.status(400).json({ ok: false, error: 'Valid seller wallet address is required' });
        }

        // Validate contract address
        if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
            return res.status(400).json({ ok: false, error: 'Valid contract address is required' });
        }

        // Validate deploy transaction hash
        if (!deployTxHash || !/^0x[a-fA-F0-9]{64}$/.test(deployTxHash)) {
            return res.status(400).json({ ok: false, error: 'Valid deploy transaction hash is required' });
        }

        // Validate auction end time (Unix timestamp)
        const endTime = parseInt(auctionEndTime);
        if (isNaN(endTime) || endTime <= Math.floor(Date.now() / 1000)) {
            return res.status(400).json({ ok: false, error: 'Valid auction end time is required' });
        }

        // Update item with contract info, seller wallet, and change status to LIVE
        const updatedItem = await db.updateItem(req.params.id, {
            status: 'LIVE', // Auction is now live
            sellerWallet: sellerWallet.trim(), // Capture wallet at start time
            contractAddress: contractAddress.trim(),
            auctionId: contractAddress.trim(),
            deployTxHash: deployTxHash.trim(),
            auctionEndTime: endTime,
            bondStatus: 'DEPOSITED',
            bondTxHash: deployTxHash.trim(), // Same tx as deploy
            deployedAt: new Date().toISOString()
        });

        res.json({ 
            ok: true, 
            item: updatedItem,
            contractAddress: contractAddress.trim(),
            auctionEndTime: endTime,
            message: 'Auction started! Item is now live for bidding.'
        });
    } catch (error) {
        console.error('Start auction error:', error);
        res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

module.exports = router;
