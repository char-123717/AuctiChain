// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title Auction (Anti-Manipulation Edition)
/// @notice
/// - Supports cumulative bidding per address
/// - Seller Bond: Seller must deposit collateral, returned after clean auction
/// - Losing Bid Penalty: 1.5% penalty on withdraw to discourage fake bidding
/// - Admin Arbitration: Admin can freeze auction and slash seller bond
/// - Design Principle: Make cheating economically unprofitable
contract Auction is ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                            CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Penalty rate for losing bidders (1.5% = 150 basis points)
    uint256 public constant PENALTY_RATE_BPS = 150;
    
    /// @notice Minimum penalty floor (0.0001 ETH) to prevent dust attacks
    uint256 public constant MIN_PENALTY = 0.0001 ether;
    
    /// @notice Basis points denominator (100% = 10000)
    uint256 public constant BPS_DENOMINATOR = 10000;

    /*//////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    address public owner;       // Contract deployer (platform)
    address public admin;       // Admin for arbitration
    address public seller;      // Seller who deposited bond
    address public recipient;   // Where winning bid goes

    uint256 public biddingTime;     // Duration in seconds (set at deploy)
    uint256 public auctionEndTime;  // Calculated when auction starts
    uint256 public startingPrice;

    address public highestBidder;
    uint256 public highestBid;
    bool public ended;
    
    /// @notice Auction started by admin
    bool public started;
    
    /// @notice Auction frozen by admin (no bids, no entry)
    bool public frozen;
    
    /// @notice Seller's bond amount (collateral)
    uint256 public sellerBond;
    
    /// @notice Expected bond amount (set at deploy, deposited from escrow)
    uint256 public expectedBondAmount;
    
    /// @notice Whether seller bond has been returned
    bool public sellerBondReturned;
    
    /// @notice Whether seller bond has been slashed
    bool public sellerBondSlashed;
    
    /// @notice Total penalties collected (goes to platform)
    uint256 public totalPenaltiesCollected;

    mapping(address => uint256) public bids;

    // Private tracking for bidder count
    address[] private bidders;
    mapping(address => bool) private hasBidder;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event BidPlaced(
        address indexed bidder,
        uint256 amount,
        uint256 total
    );

    event NewHighBid(
        address indexed bidder,
        uint256 total
    );

    event Withdrawn(
        address indexed bidder,
        uint256 grossAmount,
        uint256 penalty,
        uint256 netAmount
    );

    event AuctionStarted(
        address indexed admin,
        uint256 endTime
    );

    event AuctionEnded(
        address winner,
        uint256 amount,
        address recipient
    );
    
    event AuctionFrozen(
        address indexed admin,
        string reason
    );
    
    event AuctionUnfrozen(
        address indexed admin
    );
    
    event SellerBondDeposited(
        address indexed seller,
        uint256 amount
    );
    
    event SellerBondReturned(
        address indexed seller,
        uint256 amount
    );
    
    event SellerBondSlashed(
        address indexed admin,
        address indexed seller,
        uint256 amount
    );
    
    event ProceedsClaimed(
        address indexed seller,
        uint256 winningBid,
        uint256 bond,
        uint256 totalAmount
    );

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    modifier onlyAdminOrOwner() {
        require(msg.sender == admin || msg.sender == owner, "Only admin or owner");
        _;
    }
    
    modifier notFrozen() {
        require(!frozen, "Auction is frozen");
        _;
    }
    
    modifier onlyStarted() {
        require(started, "Auction not started");
        _;
    }
    
    modifier notStarted() {
        require(!started, "Auction already started");
        _;
    }

    modifier onlyBeforeEnd() {
        require(block.timestamp < auctionEndTime, "Auction ended");
        _;
    }

    modifier onlyAfterEnd() {
        require(block.timestamp >= auctionEndTime, "Auction not ended");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Deploy auction with bond deposit AND auto-start in single transaction
    /// @dev This is the new flow: Seller deploys after admin approval, auction starts immediately
    /// @param _biddingTime Duration in seconds
    /// @param _recipient Where winning bid goes (usually seller wallet)
    /// @param _startingPrice Minimum first bid
    /// @param _admin Admin address for arbitration
    /// @param _seller Seller address (for bond tracking)
    /// @param _expectedBond Expected bond amount (must match msg.value)
    constructor(
        uint256 _biddingTime,
        address _recipient,
        uint256 _startingPrice,
        address _admin,
        address _seller,
        uint256 _expectedBond
    ) payable {
        require(_recipient != address(0), "Invalid recipient");
        require(_startingPrice > 0, "Invalid starting price");
        require(_admin != address(0), "Invalid admin");
        require(_seller != address(0), "Invalid seller");
        require(_expectedBond > 0, "Expected bond required");
        require(_biddingTime > 0, "Invalid bidding time");
        require(msg.value == _expectedBond, "Bond amount mismatch");

        owner = msg.sender;
        admin = _admin;
        seller = _seller;
        recipient = _recipient;
        startingPrice = _startingPrice;
        biddingTime = _biddingTime;

        // Bond deposited with deployment
        sellerBond = msg.value;
        expectedBondAmount = _expectedBond;
        sellerBondReturned = false;
        sellerBondSlashed = false;

        highestBid = 0;
        highestBidder = address(0);
        ended = false;
        frozen = false;
        
        // AUTO-START: Auction starts immediately on deployment
        // This enables single transaction: deploy + bond + start
        started = true;
        auctionEndTime = block.timestamp + _biddingTime;
        
        emit AuctionStarted(msg.sender, auctionEndTime);
    }
    
    /*//////////////////////////////////////////////////////////////
                        START AUCTION (ADMIN ONLY)
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Start the auction - only admin can call this
    /// @dev This is called when admin approves the item
    /// @dev Auction end time is calculated from this moment
    function startAuction() external onlyAdminOrOwner notStarted {
        require(sellerBond > 0, "Bond not deposited");
        require(!frozen, "Auction is frozen");
        
        started = true;
        auctionEndTime = block.timestamp + biddingTime;
        
        emit AuctionStarted(msg.sender, auctionEndTime);
    }
    
    /// @notice Check if auction has been started
    function isStarted() external view returns (bool) {
        return started;
    }
    
    /*//////////////////////////////////////////////////////////////
                        DEPOSIT SELLER BOND
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Deposit seller bond to auction contract
    /// @dev Only callable once, must match expected amount
    function depositSellerBond() external payable {
        require(sellerBond == 0, "Bond already deposited");
        require(msg.value > 0, "Bond amount required");
        require(msg.value >= expectedBondAmount, "Bond amount too low");
        
        sellerBond = msg.value;
        
        emit SellerBondDeposited(seller, msg.value);
    }
    
    /// @notice Check if bond has been deposited
    function isBondDeposited() external view returns (bool) {
        return sellerBond > 0;
    }

    /*//////////////////////////////////////////////////////////////
                            BID LOGIC
    //////////////////////////////////////////////////////////////*/

    /// @notice Place a bid (cumulative)
    /// @dev Bids accumulate per address
    /// @dev Seller cannot bid on their own auction
    function bid() external payable onlyStarted onlyBeforeEnd notFrozen nonReentrant {
        require(!ended, "Auction ended");
        require(msg.value > 0, "Zero bid");
        require(msg.sender != seller, "Seller cannot bid on own auction");

        uint256 newTotal = bids[msg.sender] + msg.value;

        uint256 minRequired = highestBid == 0
            ? startingPrice
            : highestBid;

        if (msg.sender != highestBidder) {
            require(newTotal > minRequired, "Bid too low");
        }

        if (!hasBidder[msg.sender]) {
            hasBidder[msg.sender] = true;
            bidders.push(msg.sender);
        }

        bids[msg.sender] = newTotal;

        emit BidPlaced(msg.sender, msg.value, newTotal);

        if (newTotal > highestBid) {
            highestBid = newTotal;
            highestBidder = msg.sender;
            emit NewHighBid(msg.sender, newTotal);
        }
    }

    /*//////////////////////////////////////////////////////////////
                        WITHDRAW WITH PENALTY
    //////////////////////////////////////////////////////////////*/

    /// @notice Withdraw bid with penalty for losing bidders
    /// @dev Winner cannot withdraw. Losers pay 1.5% penalty (min 0.0001 ETH)
    /// @dev Penalty makes fake bidding economically unprofitable
    function withdraw() external nonReentrant {
        require(msg.sender != highestBidder, "Highest bidder cannot withdraw");

        uint256 grossAmount = bids[msg.sender];
        require(grossAmount > 0, "No balance");

        // Calculate penalty: max(1.5% of bid, MIN_PENALTY)
        // This makes fake bidding costly - every fake bid loses 1.5%
        uint256 calculatedPenalty = (grossAmount * PENALTY_RATE_BPS) / BPS_DENOMINATOR;
        uint256 penalty = calculatedPenalty > MIN_PENALTY ? calculatedPenalty : MIN_PENALTY;
        
        // Ensure penalty doesn't exceed balance (edge case for tiny bids)
        if (penalty > grossAmount) {
            penalty = grossAmount;
        }
        
        uint256 netAmount = grossAmount - penalty;

        // Clear balance before transfer (CEI pattern)
        bids[msg.sender] = 0;
        
        // Track penalties for platform
        totalPenaltiesCollected += penalty;

        // Transfer net amount to bidder
        if (netAmount > 0) {
            (bool ok, ) = payable(msg.sender).call{value: netAmount}("");
            require(ok, "Withdraw failed");
        }

        emit Withdrawn(msg.sender, grossAmount, penalty, netAmount);
    }

    /*//////////////////////////////////////////////////////////////
                            END AUCTION
    //////////////////////////////////////////////////////////////*/

    /// @notice End auction (marks as ended, does NOT transfer funds)
    /// @dev Anyone can call this to mark auction as ended
    /// @dev Seller must call claimProceeds() to get winning bid + bond
    function endAuction() external onlyAfterEnd nonReentrant {
        require(!ended, "Already ended");
        require(!frozen, "Auction is frozen");

        ended = true;

        emit AuctionEnded(highestBidder, highestBid, recipient);
    }
    
    /// @notice Seller claims winning bid + bond in single transaction
    /// @dev Only seller can call. Transfers winning bid + bond to recipient
    /// @dev This is the gas-efficient way - seller pays 1 gas fee for both
    function claimProceeds() external onlyAfterEnd nonReentrant {
        require(msg.sender == seller, "Only seller");
        require(!frozen, "Auction is frozen");
        require(!sellerBondSlashed, "Bond was slashed");
        
        // Mark as ended if not already
        if (!ended) {
            ended = true;
            emit AuctionEnded(highestBidder, highestBid, recipient);
        }
        
        uint256 totalAmount = 0;
        
        // Add winning bid if exists
        if (highestBid > 0 && highestBidder != address(0)) {
            uint256 bidAmount = bids[highestBidder];
            if (bidAmount > 0) {
                bids[highestBidder] = 0;
                totalAmount += bidAmount;
            }
        }
        
        // Add seller bond if not returned
        if (sellerBond > 0 && !sellerBondReturned) {
            sellerBondReturned = true;
            totalAmount += sellerBond;
            emit SellerBondReturned(seller, sellerBond);
        }
        
        require(totalAmount > 0, "Nothing to claim");
        
        // Emit event before transfer
        uint256 claimedBid = (highestBid > 0 && highestBidder != address(0)) ? highestBid : 0;
        uint256 claimedBond = sellerBondReturned ? sellerBond : 0;
        emit ProceedsClaimed(seller, claimedBid, claimedBond, totalAmount);
        
        // Transfer everything to recipient in single transfer
        (bool ok, ) = payable(recipient).call{value: totalAmount}("");
        require(ok, "Transfer failed");
    }
    
    /*//////////////////////////////////////////////////////////////
                        SELLER BOND MANAGEMENT
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Allow seller to claim bond only (backup method)
    /// @dev Use claimProceeds() instead for winning bid + bond
    function claimSellerBond() external nonReentrant {
        require(msg.sender == seller, "Only seller");
        require(ended, "Auction not ended");
        require(!frozen, "Auction is frozen");
        require(!sellerBondSlashed, "Bond was slashed");
        require(!sellerBondReturned, "Bond already returned");
        require(sellerBond > 0, "No bond to claim");
        
        sellerBondReturned = true;
        uint256 bondAmount = sellerBond;
        
        (bool ok, ) = payable(seller).call{value: bondAmount}("");
        require(ok, "Bond claim failed");
        
        emit SellerBondReturned(seller, bondAmount);
    }
    
    /// @notice Admin refund bond to seller (for rejected items)
    /// @dev Can only be called by admin/owner before auction has any bids
    /// @dev Used when admin rejects an item - bond is returned to seller
    function refundBond() external onlyAdminOrOwner nonReentrant {
        require(!sellerBondSlashed, "Bond was slashed");
        require(!sellerBondReturned, "Bond already returned");
        require(sellerBond > 0, "No bond to refund");
        require(highestBid == 0, "Cannot refund after bids placed");
        
        sellerBondReturned = true;
        uint256 bondAmount = sellerBond;
        
        (bool ok, ) = payable(seller).call{value: bondAmount}("");
        require(ok, "Bond refund failed");
        
        emit SellerBondReturned(seller, bondAmount);
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN ARBITRATION
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Freeze auction - stops all bidding and entry
    /// @param reason Reason for freezing (for logs)
    function freezeAuction(string calldata reason) external onlyAdminOrOwner {
        require(!frozen, "Already frozen");
        frozen = true;
        emit AuctionFrozen(msg.sender, reason);
    }
    
    /// @notice Unfreeze auction - resume normal operation
    function unfreezeAuction() external onlyAdminOrOwner {
        require(frozen, "Not frozen");
        frozen = false;
        emit AuctionUnfrozen(msg.sender);
    }
    
    /// @notice Slash seller bond due to manipulation
    /// @dev Bond goes to platform (owner), not admin wallet
    /// @dev Can only be called when auction is frozen
    function slashSellerBond() external onlyAdminOrOwner nonReentrant {
        require(frozen, "Must freeze first");
        require(!sellerBondSlashed, "Already slashed");
        require(!sellerBondReturned, "Bond already returned");
        require(sellerBond > 0, "No bond to slash");
        
        sellerBondSlashed = true;
        uint256 bondAmount = sellerBond;
        
        // Bond goes to platform (owner), NOT admin wallet
        // This prevents admin abuse
        (bool ok, ) = payable(owner).call{value: bondAmount}("");
        require(ok, "Slash transfer failed");
        
        emit SellerBondSlashed(msg.sender, seller, bondAmount);
    }
    
    /// @notice Withdraw for slashed auctions - ALL bidders can withdraw (including highest bidder)
    /// @dev No penalty applied - full refund for all bidders when auction is slashed
    /// @dev This protects honest bidders when seller is caught manipulating
    function withdrawSlashed() external nonReentrant {
        require(sellerBondSlashed, "Auction not slashed");
        
        uint256 amount = bids[msg.sender];
        require(amount > 0, "No balance");
        
        // Clear balance before transfer (CEI pattern)
        bids[msg.sender] = 0;
        
        // Full refund - no penalty for slashed auctions
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdraw failed");
        
        // Emit with 0 penalty to indicate full refund
        emit Withdrawn(msg.sender, amount, 0, amount);
    }
    
    /// @notice Withdraw collected penalties to platform
    /// @dev Only owner can withdraw penalties
    function withdrawPenalties() external onlyOwner nonReentrant {
        require(totalPenaltiesCollected > 0, "No penalties");
        
        uint256 amount = totalPenaltiesCollected;
        totalPenaltiesCollected = 0;
        
        (bool ok, ) = payable(owner).call{value: amount}("");
        require(ok, "Penalty withdraw failed");
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    function biddersCount() external view returns (uint256) {
        return bidders.length;
    }

    function bidderTotal(address bidder) external view returns (uint256) {
        return bids[bidder];
    }

    function hasAnyBid() external view returns (bool) {
        return highestBid > 0;
    }
    
    /// @notice Check if auction is active (started, not ended, not frozen)
    function isActive() external view returns (bool) {
        return started && !ended && !frozen && block.timestamp < auctionEndTime;
    }
    
    /// @notice Get auction status
    function getStatus() external view returns (
        bool _started,
        bool _ended,
        bool _frozen,
        bool _bondReturned,
        bool _bondSlashed,
        uint256 _sellerBond,
        uint256 _timeLeft
    ) {
        uint256 timeLeft = 0;
        if (started && block.timestamp < auctionEndTime) {
            timeLeft = auctionEndTime - block.timestamp;
        }
            
        return (
            started,
            ended,
            frozen,
            sellerBondReturned,
            sellerBondSlashed,
            sellerBond,
            timeLeft
        );
    }
    
    /// @notice Calculate penalty for a given bid amount
    function calculatePenalty(uint256 bidAmount) external pure returns (uint256) {
        uint256 calculatedPenalty = (bidAmount * PENALTY_RATE_BPS) / BPS_DENOMINATOR;
        return calculatedPenalty > MIN_PENALTY ? calculatedPenalty : MIN_PENALTY;
    }
}
