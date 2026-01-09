/**
 * Email Service - Send notifications for auction events
 */

const nodemailer = require('nodemailer');
const { ADMIN_EMAILS } = require('../config/admin');

let transporter = null;

// Initialize transporter
try {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
        tls: {
            rejectUnauthorized: false
        }
    });
} catch (error) {
    console.warn('⚠️  Email service not configured');
}

const FROM_EMAIL = process.env.SMTP_FROM || '"Auction Platform" <noreply@auction.com>';

/**
 * Send email helper
 */
async function sendEmail(to, subject, html) {
    if (!transporter) {
        console.warn('⚠️  Email transporter not configured, skipping email');
        return false;
    }

    try {
        await transporter.sendMail({ from: FROM_EMAIL, to, subject, html });
        console.log(`✅ Email sent to ${to}`);
        return true;
    } catch (error) {
        console.error(`❌ Email error: ${error.message}`);
        return false;
    }
}

/**
 * Notify admins when a new item is submitted
 */
async function sendNewItemNotification(item, sellerName) {
    const subject = '🆕 New Item Submitted for Review';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a2332;">New Item Submitted</h2>
            <p>A new item has been submitted for review:</p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <p><strong>Item Name:</strong> ${item.name}</p>
                <p><strong>Description:</strong> ${item.description}</p>
                <p><strong>Starting Price:</strong> ${item.startingPrice} ETH</p>
                <p><strong>Seller:</strong> ${sellerName}</p>
            </div>
            <p>Please review this item in the admin dashboard.</p>
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/admin/dashboard.html" 
               style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                      color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 10px;">
                Go to Admin Dashboard
            </a>
        </div>
    `;

    for (const email of ADMIN_EMAILS) {
        await sendEmail(email, subject, html);
    }
}

/**
 * Notify seller when item is approved
 */
async function sendApprovalNotification(item, sellerEmail, sellerName) {
    const subject = '✅ Your Item Has Been Approved!';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #22c55e;">Item Approved! 🎉</h2>
            <p>Hi ${sellerName},</p>
            <p>Great news! Your item has been approved and is now live for auction.</p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <p><strong>Item Name:</strong> ${item.name}</p>
                <p><strong>Starting Price:</strong> ${item.startingPrice} ETH</p>
            </div>
            <p>Buyers can now see your item and place bids.</p>
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/seller/dashboard.html" 
               style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                      color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 10px;">
                View Your Dashboard
            </a>
        </div>
    `;

    return sendEmail(sellerEmail, subject, html);
}

/**
 * Notify seller when item is rejected
 */
async function sendRejectionNotification(item, sellerEmail, sellerName, reason) {
    const subject = '❌ Your Item Has Been Rejected';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ef4444;">Item Rejected</h2>
            <p>Hi ${sellerName},</p>
            <p>Unfortunately, your item has been rejected by our admin team.</p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <p><strong>Item Name:</strong> ${item.name}</p>
                <p><strong>Starting Price:</strong> ${item.startingPrice} ETH</p>
            </div>
            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Reason for rejection:</strong></p>
                <p style="margin: 10px 0 0 0;">${reason}</p>
            </div>
            <p>You can edit your item and resubmit it for review.</p>
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/seller/dashboard.html" 
               style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                      color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 10px;">
                Edit & Resubmit
            </a>
        </div>
    `;

    return sendEmail(sellerEmail, subject, html);
}

/**
 * Notify admins when item is resubmitted
 */
async function sendResubmitNotification(item, sellerName) {
    const subject = '🔄 Item Resubmitted for Review';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a2332;">Item Resubmitted</h2>
            <p>A previously rejected item has been resubmitted for review:</p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <p><strong>Item Name:</strong> ${item.name}</p>
                <p><strong>Description:</strong> ${item.description}</p>
                <p><strong>Starting Price:</strong> ${item.startingPrice} ETH</p>
                <p><strong>Seller:</strong> ${sellerName}</p>
            </div>
            <p>Please review this item in the admin dashboard.</p>
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/admin/dashboard.html" 
               style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                      color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 10px;">
                Go to Admin Dashboard
            </a>
        </div>
    `;

    for (const email of ADMIN_EMAILS) {
        await sendEmail(email, subject, html);
    }
}

module.exports = {
    sendEmail,
    sendNewItemNotification,
    sendApprovalNotification,
    sendRejectionNotification,
    sendResubmitNotification
};
