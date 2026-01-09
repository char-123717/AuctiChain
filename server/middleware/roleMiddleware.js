/**
 * Role-Based Access Control Middleware
 */

const { isAdmin } = require('../config/admin');

/**
 * Check if user has one of the allowed roles
 * @param {string[]} allowedRoles - Array of allowed roles
 * @param {Object} options - Options for the middleware
 * @param {boolean} options.allowAdminViewOnly - Allow admin to access in view-only mode
 */
function checkRole(allowedRoles, options = {}) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const userIsAdmin = isAdmin(req.user.email);

        // Admin handling
        if (userIsAdmin) {
            if (allowedRoles.includes('admin')) {
                return next();
            }
            
            // Allow admin view-only access if option is set
            if (options.allowAdminViewOnly) {
                req.isAdminViewOnly = true;
                return next();
            }

            return res.status(403).json({ error: 'Admin cannot access this resource' });
        }

        // Check user role
        const userRole = req.user.role;

        if (!userRole) {
            return res.status(403).json({ error: 'Role not selected. Please select a role first.' });
        }

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ 
                error: `Access denied. Required role: ${allowedRoles.join(' or ')}` 
            });
        }

        next();
    };
}

/**
 * Require admin access
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (!isAdmin(req.user.email)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    next();
}

/**
 * Require seller role
 */
function requireSeller(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (isAdmin(req.user.email)) {
        return res.status(403).json({ error: 'Admin cannot access seller routes' });
    }

    if (req.user.role !== 'seller') {
        return res.status(403).json({ error: 'Seller role required' });
    }

    next();
}

/**
 * Require buyer role (or admin view-only)
 */
function requireBuyer(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // Allow admin view-only access
    if (isAdmin(req.user.email)) {
        req.isAdminViewOnly = true;
        return next();
    }

    if (req.user.role !== 'buyer') {
        return res.status(403).json({ error: 'Buyer role required' });
    }

    next();
}

module.exports = {
    checkRole,
    requireAdmin,
    requireSeller,
    requireBuyer
};
