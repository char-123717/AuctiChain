const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();
const { router: authRouter, verifyToken, db } = require('./routes/authRoutes');
const roleRoutes = require('./routes/roleRoutes');
const sellerRoutes = require('./routes/sellerRoutes');
const buyerRoutes = require('./routes/buyerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const auctionMonitor = require('./services/auctionMonitor');

// Client assets path
const CLIENT_PATH = '../client/assets';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

// ====================== CONFIG ======================
const PORT = process.env.PORT || 3000;
const RPC = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/7cdaf86234974d4c899f71faa758d7de';
const WS = process.env.SEPOLIA_WS_URL || 'wss://sepolia.infura.io/ws/v3/7cdaf86234974d4c899f71faa758d7de';

// ====================== CONTRACT ABI ======================
const CONTRACT_ABI = [
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "total", "type": "uint256" }], "name": "BidPlaced", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "total", "type": "uint256" }], "name": "NewHighBid", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "bidder", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "Withdrawn", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "winner", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "AuctionEnded", "type": "event" },
  { "inputs": [], "name": "auctionEndTime", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "highestBid", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "highestBidder", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "bids", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "bid", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
];

// ====================== APP SETUP ======================
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from client/assets (CSS, JS, images)
app.use('/css', express.static(path.join(__dirname, CLIENT_PATH, 'css')));
app.use('/js', express.static(path.join(__dirname, CLIENT_PATH, 'js')));
app.use('/images', express.static(path.join(__dirname, CLIENT_PATH, 'images')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use('/api/auth', authRouter);
app.use('/api/role', roleRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/buyer', buyerRoutes);
app.use('/api/admin', adminRoutes);

// Pass socket.io instance to adminRoutes for real-time events
adminRoutes.setSocketIO(io);

// Store app reference for later use by auction cache functions
app.set('adminRoutes', adminRoutes);

// ====================== BLOCKCHAIN SETUP ======================
const provider = new ethers.providers.JsonRpcProvider(RPC);
let wsProvider = null;

try {
  wsProvider = new ethers.providers.WebSocketProvider(WS);
} catch (e) {
  console.warn('WebSocket gagal, pakai polling saja');
}

// ====================== SOCKET.IO ======================

// Track active dynamic auctions (contract addresses) - must be declared before use
const activeDynamicAuctions = new Map(); // contractAddress -> { endTime, highestBid, highestBidder, frozen, remainingTimeWhenFrozen }

// Function to update auction frozen status in cache
function setAuctionFrozen(contractAddress, frozen, biddingTime = null) {
  if (activeDynamicAuctions.has(contractAddress)) {
    const auctionData = activeDynamicAuctions.get(contractAddress);
    auctionData.frozen = frozen;
    if (frozen && biddingTime !== null) {
      auctionData.biddingTime = biddingTime;
    } else if (!frozen) {
      auctionData.biddingTime = null;
    }
    console.log(`[Auction Cache] ${contractAddress} frozen=${frozen}, biddingTime=${biddingTime}`);
  }
}

// Function to update auction end time in cache (used when unfreezing)
function updateAuctionEndTime(contractAddress, newEndTime) {
  if (activeDynamicAuctions.has(contractAddress)) {
    const auctionData = activeDynamicAuctions.get(contractAddress);
    auctionData.endTime = newEndTime;
    auctionData.frozen = false;
    auctionData.remainingTimeWhenFrozen = null;
    console.log(`[Auction Cache] ${contractAddress} endTime updated to ${newEndTime}`);
  }
}

// Export functions for use in routes
module.exports.setAuctionFrozen = setAuctionFrozen;
module.exports.updateAuctionEndTime = updateAuctionEndTime;

// Pass auction cache functions to adminRoutes
const adminRoutesRef = app.get('adminRoutes');
if (adminRoutesRef && adminRoutesRef.setAuctionCacheFunctions) {
  adminRoutesRef.setAuctionCacheFunctions(setAuctionFrozen, updateAuctionEndTime);
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    if (socket.handshake.query.id === 'lobby') return next();
    return next(new Error('Authentication required'));
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = decoded;
    next();
  });
});

// Sync dynamic auction from blockchain (for database-stored auctions)
async function syncDynamicAuction(contractAddress, socket) {
  try {
    const tempContract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);

    const [endBn, hbBn, hAddr] = await Promise.all([
      tempContract.auctionEndTime(),
      tempContract.highestBid(),
      tempContract.highestBidder()
    ]);

    const blockchainEndTime = Number(endBn);
    const highestBidValue = parseFloat(ethers.utils.formatEther(hbBn));
    const highestBidderAddr = hAddr === ethers.constants.AddressZero ? '-' : hAddr;
    
    // Check if item is FROZEN from database
    const item = await db.getItemByAuctionId(contractAddress);
    const isFrozen = item && item.status === 'FROZEN';
    // For frozen items, use biddingTime (remaining seconds)
    const biddingTime = item?.biddingTime || 0;
    
    const now = Math.floor(Date.now() / 1000);
    
    // Determine endTime and timeLeft based on status
    let endTime, timeLeft;
    
    if (isFrozen) {
      // FROZEN: use biddingTime as remaining seconds, timer is paused
      timeLeft = biddingTime;
      endTime = blockchainEndTime; // Keep original for reference
    } else if (item && item.status === 'LIVE' && item.auctionEndTime) {
      // LIVE: use database auctionEndTime (may have been updated after unfreeze)
      const dbEndTime = typeof item.auctionEndTime === 'number' 
        ? item.auctionEndTime 
        : parseInt(item.auctionEndTime, 10);
      
      if (dbEndTime > now) {
        endTime = dbEndTime;
        timeLeft = endTime - now;
        console.log(`[Dynamic Sync] Using database auctionEndTime for ${contractAddress}: ${endTime}`);
      } else {
        endTime = blockchainEndTime;
        timeLeft = Math.max(0, endTime - now);
      }
    } else {
      // Default: use blockchain endTime
      endTime = blockchainEndTime;
      timeLeft = Math.max(0, endTime - now);
    }
    
    // Frozen items are NOT ended - their timer is paused
    const isEnded = isFrozen ? false : (timeLeft <= 0);
    const phase = isEnded ? 'ENDED' : (isFrozen ? 'FROZEN' : (highestBidValue > 0 ? 'LIVE' : 'INIT'));

    // Update highestBid in database if there's a bid
    if (highestBidValue > 0) {
      await db.updateItemHighestBid(contractAddress, highestBidValue, highestBidderAddr);
    }

    // Add to active dynamic auctions for timer updates with frozen state
    activeDynamicAuctions.set(contractAddress, {
      endTime,
      highestBid: highestBidValue,
      highestBidder: highestBidderAddr,
      frozen: isFrozen,
      biddingTime: isFrozen ? biddingTime : null
    });

    console.log(`[Dynamic Sync] ${contractAddress}: highestBid: ${highestBidValue}, frozen: ${isFrozen}, timeLeft: ${timeLeft}`);

    // Send to the connected socket
    socket.emit('highestBidUpdate', { auctionId: contractAddress, amount: highestBidValue, bidderName: highestBidderAddr });
    socket.emit('timerUpdate', {
      id: contractAddress,
      seconds: timeLeft,
      ended: isEnded,
      frozen: isFrozen
    });

    // Also broadcast to the room
    io.to(contractAddress).emit('highestBidUpdate', { auctionId: contractAddress, amount: highestBidValue, bidderName: highestBidderAddr });

    // Broadcast to lobby for dashboard update with frozen state
    io.to('lobby').emit('auctionStateUpdate', {
      auctionId: contractAddress,
      highestBid: highestBidValue,
      phase: phase,
      ended: isEnded,
      timeLeft: timeLeft,
      frozen: isFrozen,
      biddingTime: isFrozen ? biddingTime : null
    });

    return { highestBid: highestBidValue, endTime, isEnded, frozen: isFrozen };
  } catch (e) {
    console.error(`syncDynamicAuction error (${contractAddress}):`, e.message);
    return null;
  }
}

io.on('connection', socket => {
  const q = socket.handshake.query || {};
  const auctionId = q.id;

  if (auctionId === 'lobby') {
    socket.join('lobby');
    
    // Send dynamic auction states (from activeDynamicAuctions) with frozen state
    activeDynamicAuctions.forEach((auctionData, contractAddress) => {
      const now = Math.floor(Date.now() / 1000);
      // For frozen items, use biddingTime; for live items, calculate from endTime
      const timeLeft = auctionData.frozen 
        ? (auctionData.biddingTime || 0)
        : Math.max(0, auctionData.endTime - now);
      // Frozen items are NOT ended - their timer is paused
      const isEnded = auctionData.frozen ? false : (timeLeft <= 0);
      
      socket.emit('auctionStateUpdate', {
        auctionId: contractAddress,
        highestBid: auctionData.highestBid,
        highestBidder: auctionData.highestBidder,
        ended: isEnded,
        timeLeft: timeLeft,
        frozen: auctionData.frozen || false,
        biddingTime: auctionData.frozen ? auctionData.biddingTime : null
      });
    });
    
    // Also sync all approved items from database to ensure we have all dynamic auctions
    syncAllDynamicAuctionsForLobby();
  } else if (auctionId && auctionId.startsWith('0x')) {
    // Dynamic auction (contract address) - sync from blockchain
    if (!socket.user) return socket.disconnect();
    socket.join(auctionId);
    console.log(`[Socket] Dynamic auction connected: ${auctionId}`);
    syncDynamicAuction(auctionId, socket);
  }

  // Handle bid placed event from client
  socket.on('bidPlaced', async (data) => {
    console.log(`[BidPlaced] Received from client:`, data);
    
    if (data.auctionId && data.auctionId.startsWith('0x')) {
      // Sync from blockchain to get accurate data
      try {
        const tempContract = new ethers.Contract(data.auctionId, CONTRACT_ABI, provider);
        const [hbBn, hAddr] = await Promise.all([
          tempContract.highestBid(),
          tempContract.highestBidder()
        ]);
        
        const highestBidValue = parseFloat(ethers.utils.formatEther(hbBn));
        const roundedBid = Math.round(highestBidValue * 10000) / 10000;
        const highestBidderAddr = hAddr === ethers.constants.AddressZero ? '-' : hAddr;
        
        // Update database
        if (roundedBid > 0) {
          await db.updateItemHighestBid(data.auctionId, roundedBid, highestBidderAddr);
        }
        
        // Update activeDynamicAuctions cache
        if (activeDynamicAuctions.has(data.auctionId)) {
          const auctionData = activeDynamicAuctions.get(data.auctionId);
          auctionData.highestBid = roundedBid;
          auctionData.highestBidder = highestBidderAddr;
        }
        
        console.log(`[BidPlaced] Synced: ${data.auctionId} - ${roundedBid} ETH by ${highestBidderAddr}`);
        
        // Broadcast to auction room
        io.to(data.auctionId).emit('highestBidUpdate', { 
          auctionId: data.auctionId, 
          amount: roundedBid, 
          bidderName: highestBidderAddr 
        });
        
        // Broadcast to lobby (buyer dashboard) with timeLeft
        const auctionData = activeDynamicAuctions.get(data.auctionId);
        const timeLeft = auctionData ? Math.max(0, auctionData.endTime - Math.floor(Date.now() / 1000)) : 0;
        
        io.to('lobby').emit('auctionStateUpdate', {
          auctionId: data.auctionId,
          highestBid: roundedBid,
          highestBidder: highestBidderAddr,
          phase: 'LIVE',
          timeLeft: timeLeft
        });
      } catch (e) {
        console.error(`[BidPlaced] Error syncing:`, e.message);
      }
    }
  });
});

// ====================== TIMER & PERIODIC SYNC ======================

// Sync all dynamic auctions from database for lobby
async function syncAllDynamicAuctionsForLobby() {
  try {
    const items = await db.getApprovedItems();
    
    for (const item of items) {
      const contractAddress = item.auctionId || item.contractAddress;
      if (!contractAddress || !contractAddress.startsWith('0x')) continue;
      
      try {
        // Check if item is FROZEN from database
        const isFrozen = item.status === 'FROZEN';
        // For frozen items, use biddingTime (remaining seconds)
        const biddingTime = item.biddingTime || 0;
        
        const tempContract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);
        const [endBn, hbBn, hAddr] = await Promise.all([
          tempContract.auctionEndTime(),
          tempContract.highestBid(),
          tempContract.highestBidder()
        ]);
        
        const blockchainEndTime = Number(endBn);
        const highestBidValue = parseFloat(ethers.utils.formatEther(hbBn));
        const highestBidderAddr = hAddr === ethers.constants.AddressZero ? '-' : hAddr;
        const now = Math.floor(Date.now() / 1000);
        
        // Determine endTime and timeLeft based on status
        let endTime, timeLeft;
        
        if (isFrozen) {
          // FROZEN: use biddingTime as remaining seconds, timer is paused
          timeLeft = biddingTime;
          endTime = blockchainEndTime; // Keep original for reference
        } else if (item.status === 'LIVE' && item.auctionEndTime) {
          // LIVE: use database auctionEndTime (may have been updated after unfreeze)
          const dbEndTime = typeof item.auctionEndTime === 'number' 
            ? item.auctionEndTime 
            : parseInt(item.auctionEndTime, 10);
          
          if (dbEndTime > now) {
            endTime = dbEndTime;
            timeLeft = endTime - now;
            console.log(`[Sync] Using database auctionEndTime for ${contractAddress}: ${endTime}`);
          } else {
            endTime = blockchainEndTime;
            timeLeft = Math.max(0, endTime - now);
          }
        } else {
          // Default: use blockchain endTime
          endTime = blockchainEndTime;
          timeLeft = Math.max(0, endTime - now);
        }
        
        // Frozen items are NOT ended - their timer is paused
        const isEnded = isFrozen ? false : (timeLeft <= 0);
        
        // Add/update in active dynamic auctions with frozen state
        activeDynamicAuctions.set(contractAddress, {
          endTime,
          highestBid: highestBidValue,
          highestBidder: highestBidderAddr,
          frozen: isFrozen,
          biddingTime: isFrozen ? biddingTime : null
        });
        
        // Update database with latest bid info
        if (highestBidValue > 0) {
          await db.updateItemHighestBid(contractAddress, highestBidValue, highestBidderAddr);
        }
        
        // Broadcast to lobby with frozen state
        io.to('lobby').emit('auctionStateUpdate', {
          auctionId: contractAddress,
          highestBid: highestBidValue,
          highestBidder: highestBidderAddr,
          ended: isEnded,
          timeLeft: timeLeft,
          frozen: isFrozen,
          biddingTime: isFrozen ? biddingTime : null
        });
      } catch (e) {
        console.error(`Error syncing dynamic auction ${contractAddress}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Error syncing all dynamic auctions:', e.message);
  }
}

setInterval(() => {
  // Handle dynamic auctions (contract addresses)
  activeDynamicAuctions.forEach((auctionData, contractAddress) => {
    // Skip frozen auctions - their timer is paused
    if (auctionData.frozen) {
      // Send frozen state to auction room (timer paused at biddingTime)
      io.to(contractAddress).emit('timerUpdate', { 
        id: contractAddress, 
        seconds: auctionData.biddingTime || 0, 
        ended: false,
        frozen: true
      });
      
      // Send frozen state to lobby
      io.to('lobby').emit('auctionStateUpdate', {
        auctionId: contractAddress,
        highestBid: auctionData.highestBid,
        ended: false,
        timeLeft: auctionData.biddingTime || 0,
        frozen: true,
        biddingTime: auctionData.biddingTime || 0
      });
      return;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const timeLeft = Math.max(0, auctionData.endTime - now);
    const ended = timeLeft <= 0;
    
    // Send timer update to auction room
    io.to(contractAddress).emit('timerUpdate', { 
      id: contractAddress, 
      seconds: timeLeft, 
      ended 
    });
    
    // Send state update to lobby
    io.to('lobby').emit('auctionStateUpdate', {
      auctionId: contractAddress,
      highestBid: auctionData.highestBid,
      ended,
      timeLeft
    });
  });
}, 1000);

// Periodic sync for dynamic auctions
setInterval(async () => {
  // Sync dynamic auctions
  for (const [contractAddress, auctionData] of activeDynamicAuctions) {
    try {
      // Skip frozen auctions - don't update their endTime
      if (auctionData.frozen) {
        continue;
      }
      
      const tempContract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);
      const [endBn, hbBn, hAddr] = await Promise.all([
        tempContract.auctionEndTime(),
        tempContract.highestBid(),
        tempContract.highestBidder()
      ]);
      
      const blockchainEndTime = Number(endBn);
      const highestBidValue = parseFloat(ethers.utils.formatEther(hbBn));
      const highestBidderAddr = hAddr === ethers.constants.AddressZero ? '-' : hAddr;
      
      // Check database for updated auctionEndTime (after unfreeze)
      const item = await db.getItemByAuctionId(contractAddress);
      const now = Math.floor(Date.now() / 1000);
      
      // Use database auctionEndTime if available and item is LIVE
      let endTime = blockchainEndTime;
      if (item && item.status === 'LIVE' && item.auctionEndTime) {
        const dbEndTime = typeof item.auctionEndTime === 'number' 
          ? item.auctionEndTime 
          : parseInt(item.auctionEndTime, 10);
        
        if (dbEndTime > now) {
          endTime = dbEndTime;
        }
      }
      
      // Update cached data - preserve endTime from database if applicable
      auctionData.endTime = endTime;
      auctionData.highestBid = highestBidValue;
      auctionData.highestBidder = highestBidderAddr;
      
      // Update database
      if (highestBidValue > 0) {
        await db.updateItemHighestBid(contractAddress, highestBidValue, highestBidderAddr);
      }
    } catch (e) {
      console.error(`Periodic sync error for ${contractAddress}:`, e.message);
    }
  }
}, 30000);

// ====================== API ENDPOINTS ======================
app.get('/api/auction-details', async (req, res) => {
  const id = req.query.id;

  if (!id) {
    return res.status(400).json({ ok: false, error: 'Auction ID required' });
  }

  // Try to find item by auctionId (contract address)
  try {
    const item = await db.getItemByAuctionId(id);
    if (item && item.auctionId) {
      // Check if item is frozen from database
      const isFrozen = item.status === 'FROZEN' || item.status === 'SLASHED';
      
      // If item is already SOLD, return stored data
      if (item.status === 'SOLD') {
        return res.json({
          ok: true,
          auctionId: item.id,
          contractAddress: item.auctionId,
          minBid: parseFloat(item.startingPrice) || 0.0001,
          highestBid: parseFloat(item.winningBid) || 0,
          highestBidder: item.winner || null,
          auctionEndTime: item.auctionEndTime,
          biddingTime: 0,
          timeLeft: 0,
          ended: true,
          sold: true,
          frozen: false,
          txHash: item.txHash,
          item: {
            id: item.id,
            name: item.name,
            description: item.description,
            imageCID: item.imageCID,
            startingPrice: item.startingPrice,
            status: item.status,
            sellerWallet: item.sellerWallet
          }
        });
      }

      // Create a temporary contract to fetch data
      const tempContract = new ethers.Contract(item.auctionId, CONTRACT_ABI, provider);

      const [endBn, hbBn, hAddr] = await Promise.all([
        tempContract.auctionEndTime(),
        tempContract.highestBid(),
        tempContract.highestBidder()
      ]);

      const blockchainEndTime = Number(endBn);
      const highestBidValue = parseFloat(ethers.utils.formatEther(hbBn));
      const highestBidderAddr = hAddr === ethers.constants.AddressZero ? null : hAddr;
      const now = Math.floor(Date.now() / 1000);
      
      // Determine timeLeft and ended status based on item status
      let timeLeft, isEnded, effectiveEndTime;
      
      if (isFrozen) {
        // FROZEN: use biddingTime (remaining seconds), timer is paused, NOT ended
        timeLeft = item.biddingTime || 0;
        isEnded = false; // FROZEN items are NEVER ended
        effectiveEndTime = blockchainEndTime; // Keep for reference
      } else if (item.status === 'LIVE' && item.auctionEndTime) {
        // LIVE: use database auctionEndTime (may have been updated after unfreeze)
        const dbEndTime = typeof item.auctionEndTime === 'number' 
          ? item.auctionEndTime 
          : parseInt(item.auctionEndTime, 10);
        
        if (dbEndTime > now) {
          effectiveEndTime = dbEndTime;
          timeLeft = dbEndTime - now;
          isEnded = false;
        } else {
          effectiveEndTime = dbEndTime;
          timeLeft = 0;
          isEnded = true;
        }
      } else {
        // Default: use blockchain endTime
        effectiveEndTime = blockchainEndTime;
        timeLeft = Math.max(0, blockchainEndTime - now);
        isEnded = timeLeft <= 0;
      }

      return res.json({
        ok: true,
        auctionId: item.id,
        contractAddress: item.auctionId,
        minBid: parseFloat(item.startingPrice) || 0.0001,
        highestBid: highestBidValue,
        highestBidder: highestBidderAddr,
        auctionEndTime: effectiveEndTime,
        biddingTime: isFrozen ? (item.biddingTime || 0) : timeLeft,
        timeLeft: timeLeft,
        ended: isEnded,
        frozen: isFrozen,
        item: {
          id: item.id,
          name: item.name,
          description: item.description,
          imageCID: item.imageCID,
          startingPrice: item.startingPrice,
          status: item.status,
          freezeReason: item.freezeReason,
          sellerWallet: item.sellerWallet
        }
      });
    }
  } catch (e) {
    console.error('Error fetching auction:', e.message);
  }

  return res.status(404).json({ ok: false, error: 'Auction not found' });
});

app.post('/api/withdrawn', async (req, res) => {
  try {
    const { walletAddress, auctionId } = req.body;
    if (!walletAddress || !auctionId) return res.status(400).json({ ok: false });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====================== HTML ROUTES ======================

// ROOT — Serve landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/index.html'));
});

app.get('/signin.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/signin.html')));
app.get('/signup.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/signin.html')));
app.get('/forgot.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/signin.html')));

// Protected pages - serve HTML, auth check done client-side
app.get('/role-select.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/role-select.html')));

// Dashboard routes - serve HTML, auth check done client-side
app.get('/seller/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/seller/dashboard.html')));
app.get('/buyer/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/buyer/dashboard.html')));
app.get('/admin/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/admin/dashboard.html')));

app.get('/reset.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/reset.html')));

app.get('/auction.html', (req, res) => res.sendFile(path.join(__dirname, CLIENT_PATH, 'html/auction.html')));

// ====================== START SERVER ======================
server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);

  // Set callback for auction monitor to broadcast status updates
  auctionMonitor.setOnAuctionFinalized((data) => {
    console.log(`Broadcasting auction finalized: ${data.auctionId} - ${data.status}`);

    // Broadcast to auction room
    io.to(data.auctionId).emit('auctionFinalized', {
      auctionId: data.auctionId,
      status: data.status,
      winner: data.winner,
      winningBid: data.winningBid,
      txHash: data.txHash
    });

    // Broadcast to lobby (buyer dashboard)
    io.to('lobby').emit('auctionStateUpdate', {
      auctionId: data.auctionId,
      status: data.status,
      ended: true,
      sold: data.status === 'SOLD',
      winner: data.winner,
      winningBid: data.winningBid,
      highestBid: parseFloat(data.winningBid) || 0,
      highestBidder: data.winner,
      txHash: data.txHash
    });
    
    // Broadcast to ALL clients (for seller dashboard)
    io.emit('auctionFinalized', {
      auctionId: data.auctionId,
      itemId: data.itemId,
      status: data.status,
      winner: data.winner,
      winningBid: data.winningBid,
      txHash: data.txHash
    });
  });

  // Start auction monitor to auto-finalize ended auctions
  auctionMonitor.start();
  
  // Sync all dynamic auctions on startup
  syncAllDynamicAuctionsForLobby();
});

// ====================== SCHEDULED CLEANUP ======================
// Clean up expired auctions every hour
setInterval(async () => {
  try {
    const deletedCount = await db.cleanupExpiredAuctions();
    if (deletedCount > 0) {
      console.log(`[Cleanup] Deleted ${deletedCount} expired auction(s)`);
    }
  } catch (error) {
    console.error('[Cleanup] Error:', error.message);
  }
}, 60 * 60 * 1000); // Run every hour

// Also run cleanup on server start
setTimeout(async () => {
  try {
    const deletedCount = await db.cleanupExpiredAuctions();
    if (deletedCount > 0) {
      console.log(`[Startup Cleanup] Deleted ${deletedCount} expired auction(s)`);
    }
  } catch (error) {
    console.error('[Startup Cleanup] Error:', error.message);
  }
}, 5000); // Run 5 seconds after server start