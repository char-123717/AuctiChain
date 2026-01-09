const { MongoClient, ObjectId } = require('mongodb');

// MongoDB connection URI from environment
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('MongoDB credentials missing in .env file');
  console.error('Please set MONGODB_URI environment variable');
  console.error('Example: MONGODB_URI=mongodb://localhost:27017/auction_platform');
  process.exit(1);
}

// Create MongoDB client
const client = new MongoClient(mongoUri);
let mongoDb;
let usersCollection;
let verificationCodesCollection;
let itemsCollection;

// Transform MongoDB document to match previous Supabase format
function transformDocument(doc) {
  if (!doc) return null;
  const { _id, sellerId, ...rest } = doc;
  return {
    id: _id.toString(),
    // Convert sellerId ObjectId to string if exists
    ...(sellerId && { sellerId: sellerId.toString() }),
    ...rest
  };
}

// Initialize database connection and indexes
async function initializeDatabase() {
  try {
    await client.connect();
    mongoDb = client.db();
    usersCollection = mongoDb.collection('users');
    verificationCodesCollection = mongoDb.collection('verification_codes');
    itemsCollection = mongoDb.collection('items');

    // Create indexes for users
    await usersCollection.createIndex({ email: 1 }, { unique: true });

    // Create indexes for verification codes
    await verificationCodesCollection.createIndex({ code: 1 }, { unique: true });
    await verificationCodesCollection.createIndex(
      { expires_at: 1 },
      { expireAfterSeconds: 0 }
    );

    // Create indexes for items
    await itemsCollection.createIndex({ sellerId: 1 });
    await itemsCollection.createIndex({ status: 1 });
    await itemsCollection.createIndex({ sellerId: 1, status: 1 });
    await itemsCollection.createIndex({ status: 1, auctionEndTime: 1 }); // For cleanup queries

    console.log('MongoDB connected successfully:', mongoDb.databaseName);
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
}


class Database {
  async createUser(userData) {
    const now = new Date();
    const userDoc = {
      ...userData,
      email: userData.email.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    const result = await usersCollection.insertOne(userDoc);
    const insertedDoc = await usersCollection.findOne({ _id: result.insertedId });
    return transformDocument(insertedDoc);
  }

  async getUserByEmail(email) {
    const doc = await usersCollection.findOne({
      email: email.toLowerCase()
    });
    return transformDocument(doc);
  }

  async getUserById(id) {
    try {
      const objectId = new ObjectId(id);
      const doc = await usersCollection.findOne({ _id: objectId });
      return transformDocument(doc);
    } catch (error) {
      // Invalid ObjectId format, return null
      return null;
    }
  }

  async updateUser(email, updates) {
    const updateDoc = {
      ...updates,
      updated_at: new Date()
    };

    const result = await usersCollection.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error('User not found');
    }

    return transformDocument(result);
  }

  async createVerificationCode(codeData) {
    const now = new Date();
    const codeDoc = {
      ...codeData,
      expires_at: new Date(codeData.expires_at),
      created_at: now
    };

    const result = await verificationCodesCollection.insertOne(codeDoc);
    const insertedDoc = await verificationCodesCollection.findOne({
      _id: result.insertedId
    });
    return transformDocument(insertedDoc);
  }

  async getVerificationCode(code) {
    const doc = await verificationCodesCollection.findOne({ code });
    return transformDocument(doc);
  }

  async deleteVerificationCode(code) {
    await verificationCodesCollection.deleteOne({ code });
  }

  async cleanExpiredVerificationCodes() {
    try {
      await verificationCodesCollection.deleteMany({
        expires_at: { $lt: new Date() }
      });
    } catch (error) {
      console.error('Failed to clean expired codes:', error);
    }
  }

  // ==================== ITEM METHODS ====================

  async createItem(itemData) {
    const now = new Date();
    const itemDoc = {
      sellerId: new ObjectId(itemData.sellerId),
      sellerWallet: itemData.sellerWallet || null,
      depositAmount: itemData.depositAmount || null,
      bondTxHash: itemData.bondTxHash || null,
      bondTimestamp: itemData.bondTimestamp || null,
      bondStatus: itemData.bondStatus || 'PENDING', // PENDING, DEPOSITED, RETURNED, SLASHED
      name: itemData.name,
      description: itemData.description,
      startingPrice: itemData.startingPrice,
      imageCID: itemData.imageCID,
      status: itemData.status || 'PENDING',
      rejectReason: null,
      freezeReason: null,
      // Contract deployment fields (from submit-deploy flow)
      contractAddress: itemData.contractAddress || null,
      auctionId: itemData.auctionId || itemData.contractAddress || null,
      biddingTime: itemData.biddingTime || null,
      auctionEndTime: itemData.auctionEndTime || null,
      deployedAt: itemData.deployedAt || null,
      deployTxHash: itemData.deployTxHash || null,
      // Claim proceeds fields
      proceedsClaimed: false,
      claimTxHash: null,
      claimedAmount: null,
      claimedAt: null,
      created_at: now,
      updated_at: now
    };

    const result = await itemsCollection.insertOne(itemDoc);
    const insertedDoc = await itemsCollection.findOne({ _id: result.insertedId });
    return transformDocument(insertedDoc);
  }

  async getItemById(id) {
    try {
      const objectId = new ObjectId(id);
      const doc = await itemsCollection.findOne({ _id: objectId });
      return transformDocument(doc);
    } catch (error) {
      return null;
    }
  }

  async getItemByAuctionId(auctionId) {
    try {
      const doc = await itemsCollection.findOne({ auctionId: auctionId });
      return transformDocument(doc);
    } catch (error) {
      return null;
    }
  }

  async getItemsBySellerId(sellerId) {
    try {
      const objectId = new ObjectId(sellerId);
      const docs = await itemsCollection.find({ sellerId: objectId }).sort({ created_at: -1 }).toArray();
      return docs.map(transformDocument);
    } catch (error) {
      return [];
    }
  }

  async getItemsByStatus(status) {
    if (!itemsCollection) {
      console.warn('Database not initialized yet, skipping getItemsByStatus');
      return [];
    }
    const docs = await itemsCollection.find({ status }).sort({ created_at: -1 }).toArray();
    return docs.map(transformDocument);
  }

  async getAllItems() {
    if (!itemsCollection) {
      console.warn('Database not initialized yet, skipping getAllItems');
      return [];
    }
    const docs = await itemsCollection.find({}).sort({ created_at: -1 }).toArray();
    return docs.map(transformDocument);
  }

  async getApprovedItems() {
    const now = Math.floor(Date.now() / 1000); // Current time in Unix timestamp (seconds)
    const twentyFourHoursAgoTimestamp = now - (24 * 60 * 60); // 24 hours ago in seconds
    const twentyFourHoursAgoISO = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();

    // Get LIVE and FROZEN items (auction started by seller) that are either:
    // 1. Still running (auctionEndTime > now) - supports both Unix timestamp and ISO string
    // 2. Ended within last 24 hours
    // Note: SOLD items are excluded - they have their own status
    // Note: APPROVED items without contract are waiting for seller to start
    // Note: FROZEN items should still be visible to buyers (with frozen indicator)
    const docs = await itemsCollection.find({
      status: { $in: ['LIVE', 'FROZEN'] }, // LIVE and FROZEN items are visible to buyers
      $or: [
        // Unix timestamp format (number)
        { auctionEndTime: { $type: 'number', $gt: twentyFourHoursAgoTimestamp } },
        // ISO string format (string) - for legacy items
        { auctionEndTime: { $type: 'string', $gt: twentyFourHoursAgoISO } }
      ]
    }).sort({ auctionEndTime: 1, created_at: -1 }).toArray();
    return docs.map(transformDocument);
  }

  async getSoldItems(sellerId = null) {
    const query = { status: 'SOLD' };
    if (sellerId) {
      query.sellerId = new ObjectId(sellerId);
    }
    const docs = await itemsCollection.find(query).sort({ finalizedAt: -1, created_at: -1 }).toArray();
    return docs.map(transformDocument);
  }

  async getEndedItems(sellerId = null) {
    const query = { status: 'ENDED' };
    if (sellerId) {
      query.sellerId = new ObjectId(sellerId);
    }
    const docs = await itemsCollection.find(query).sort({ finalizedAt: -1, created_at: -1 }).toArray();
    return docs.map(transformDocument);
  }

  async getSlashedItems(sellerId = null) {
    const query = { status: 'SLASHED' };
    if (sellerId) {
      query.sellerId = new ObjectId(sellerId);
    }
    const docs = await itemsCollection.find(query).sort({ slashedAt: -1, created_at: -1 }).toArray();
    return docs.map(transformDocument);
  }

  async updateItem(id, updates) {
    try {
      const objectId = new ObjectId(id);
      const updateDoc = {
        ...updates,
        updated_at: new Date()
      };

      const result = await itemsCollection.findOneAndUpdate(
        { _id: objectId },
        { $set: updateDoc },
        { returnDocument: 'after' }
      );

      if (!result) {
        throw new Error('Item not found');
      }

      return transformDocument(result);
    } catch (error) {
      throw error;
    }
  }

  async approveItem(id, auctionId, auctionEndTime) {
    return this.updateItem(id, {
      status: 'APPROVED',
      auctionId: auctionId,
      auctionEndTime: auctionEndTime,
      rejectReason: null
    });
  }

  async rejectItem(id, reason) {
    return this.updateItem(id, {
      status: 'REJECTED',
      rejectReason: reason,
      auctionId: null,
      auctionEndTime: null
    });
  }

  /**
   * Update highest bid for an item by auctionId (contract address)
   * Called when a new bid is placed on the blockchain
   */
  async updateItemHighestBid(auctionId, highestBid, highestBidder) {
    try {
      const result = await itemsCollection.findOneAndUpdate(
        { auctionId: auctionId },
        {
          $set: {
            highestBid: highestBid,
            highestBidder: highestBidder,
            updated_at: new Date()
          }
        },
        { returnDocument: 'after' }
      );

      if (result) {
        return transformDocument(result);
      }
      return null;
    } catch (error) {
      console.error('Failed to update highest bid:', error);
      return null;
    }
  }

  async resubmitItem(id, updates) {
    return this.updateItem(id, {
      ...updates,
      status: 'PENDING',
      rejectReason: null
    });
  }

  async deleteItem(id) {
    try {
      const objectId = new ObjectId(id);
      await itemsCollection.deleteOne({ _id: objectId });
    } catch (error) {
      throw error;
    }
  }

  // ==================== AUCTION CLEANUP METHODS ====================

  /**
   * Get LIVE items that are still active (auction not ended or ended within 24 hours)
   */
  async getActiveAuctions() {
    const now = Math.floor(Date.now() / 1000);
    const docs = await itemsCollection.find({
      status: 'LIVE',
      $or: [
        { auctionEndTime: { $gt: now } }, // Auction still running
        { auctionEndTime: null } // No end time set (legacy items)
      ]
    }).sort({ created_at: -1 }).toArray();
    return docs.map(transformDocument);
  }

  /**
   * Get expired auctions (ended more than 24 hours ago)
   */
  async getExpiredAuctions() {
    const now = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgoTimestamp = now - (24 * 60 * 60);

    const docs = await itemsCollection.find({
      status: 'LIVE',
      auctionEndTime: {
        $ne: null,
        $lt: twentyFourHoursAgoTimestamp
      }
    }).toArray();
    return docs.map(transformDocument);
  }

  /**
   * Delete expired auctions (ended more than 24 hours ago)
   * Returns count of deleted items
   */
  async cleanupExpiredAuctions() {
    try {
      const now = Math.floor(Date.now() / 1000);
      const twentyFourHoursAgoTimestamp = now - (24 * 60 * 60);

      const result = await itemsCollection.deleteMany({
        status: 'LIVE',
        auctionEndTime: {
          $ne: null,
          $lt: twentyFourHoursAgoTimestamp
        }
      });

      if (result.deletedCount > 0) {
        console.log(`Cleaned up ${result.deletedCount} expired auction(s)`);
      }

      return result.deletedCount;
    } catch (error) {
      console.error('Failed to cleanup expired auctions:', error);
      return 0;
    }
  }
}

// Initialize database connection
initializeDatabase();

const db = new Database();

// Periodic cleanup of expired verification codes
setInterval(() => {
  db.cleanExpiredVerificationCodes();
}, 60 * 60 * 1000);

module.exports = db;
