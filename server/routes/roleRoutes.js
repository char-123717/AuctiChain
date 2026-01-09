const express = require('express');
const jwt = require('jsonwebtoken');
const { verifyToken } = require('./authRoutes');
const { isAdmin } = require('../config/admin');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const JWT_EXPIRY = '7d';

// Valid roles
const VALID_ROLES = ['seller', 'buyer'];

/**
 * POST /api/role/select
 * Select a role (seller or buyer) and get new token with role
 */
router.post('/select', verifyToken, async (req, res) => {
  try {
    const { role } = req.body;

    // Validate role
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role. Must be "seller" or "buyer"' 
      });
    }

    // Check if user is admin (admins don't need role selection)
    if (isAdmin(req.user.email)) {
      return res.status(400).json({ 
        error: 'Admin users do not need role selection' 
      });
    }

    // Generate new token with role included
    const newToken = jwt.sign(
      { 
        id: req.user.id, 
        email: req.user.email, 
        role: role,
        isAdmin: false
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    res.json({
      ok: true,
      token: newToken,
      role: role,
      message: `Role set to ${role}`
    });

  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/role/current
 * Get current role from token
 */
router.get('/current', verifyToken, (req, res) => {
  try {
    const role = req.user.role || null;
    const userIsAdmin = isAdmin(req.user.email);

    res.json({
      ok: true,
      role: userIsAdmin ? 'admin' : role,
      isAdmin: userIsAdmin
    });

  } catch (error) {
    console.error('Get role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
