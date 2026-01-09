/**
 * Admin Configuration
 * 
 * This file contains the list of admin emails.
 * Users with these emails will be automatically recognized as admins
 * and will bypass role selection, going directly to admin dashboard.
 */

// Hardcoded admin email list
// Add admin emails here
const ADMIN_EMAILS = [
  'carlslie543@gmail.com',
];

/**
 * Check if an email belongs to an admin
 * @param {string} email - Email to check
 * @returns {boolean} - True if email is in admin list
 */
function isAdmin(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

/**
 * Get all admin emails
 * @returns {string[]} - Array of admin emails
 */
function getAdminEmails() {
  return [...ADMIN_EMAILS];
}

module.exports = {
  ADMIN_EMAILS,
  isAdmin,
  getAdminEmails
};
