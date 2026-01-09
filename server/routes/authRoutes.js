const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const { isAdmin } = require('../config/admin');
const router = express.Router();

// Import nodemailer dengan error handling
let nodemailer;
let transporter;

try {
    nodemailer = require('nodemailer');

    // Email transporter configuration
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER || 'your-email@gmail.com',
            pass: process.env.SMTP_PASS || 'your-app-password'
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    // Verify transporter
    transporter.verify(function (error, success) {
        if (error) {
            console.error('❌ Email transporter error:', error.message);
        } else {
            console.log('✅ Email server ready');
        }
    });
} catch (error) {
    console.warn('⚠️  Nodemailer not configured. Email features disabled.');
    console.warn('   Please install: npm install nodemailer');
    console.warn('   And configure SMTP settings in .env file');
}

// Users now stored in Supabase database via db.js

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const JWT_EXPIRY = '7d';

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '' });
        }
        req.user = user;
        next();
    });
};

// Generate temporary password
function generateTempPassword() {
    return crypto.randomBytes(6).toString('hex').toUpperCase();
}

// Send email helper
async function sendEmail(to, subject, html) {
    if (!transporter) {
        console.error('Email transporter not configured');
        return false;
    }

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"Auction Platform" <noreply@auction.com>',
            to,
            subject,
            html
        });
        console.log('✅ Email sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('❌ Email send error:', error.message);
        return false;
    }
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (name.length < 2) {
            return res.status(400).json({ error: 'Name must be at least 2 characters' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Check if user already exists
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate verification code
        const verificationCode = crypto.randomBytes(32).toString('hex');

        // Create user in database
        const user = await db.createUser({
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'bidder',
            verified: false,
            requires_password_reset: false,
            provider: 'local'
        });

        // Store verification code in database
        await db.createVerificationCode({
            code: verificationCode,
            email: email.toLowerCase(),
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

        // Send verification email
        const verificationLink = `${req.protocol}://${req.get('host')}/api/auth/verify-email?code=${verificationCode}`;
        const emailSent = await sendEmail(
            email,
            'Verify Your Email - Auction Platform',
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a2332;">Welcome to Auction Platform! 🎉</h2>
                <p>Hi ${name},</p>
                <p>Thank you for signing up. Please verify your email address by clicking the button below:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${verificationLink}" 
                       style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                              color: white;
                              padding: 12px 30px;
                              text-decoration: none;
                              border-radius: 25px;
                              font-weight: 600;
                              display: inline-block;">
                        Verify Email
                    </a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">
                    Or copy this link to your browser:<br>
                    <a href="${verificationLink}" style="color: #3b82f6;">${verificationLink}</a>
                </p>
                <p style="color: #6b7280; font-size: 14px;">
                    This link will expire in 24 hours.
                </p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                <p style="color: #9ca3af; font-size: 12px;">
                    If you didn't create this account, please ignore this email.
                </p>
            </div>
            `
        );

        if (!emailSent) {
            console.warn('⚠️  Verification email failed to send, but user was created');
        }

        res.status(201).json({
            ok: true,
            message: 'Account created successfully. Please check your email to verify your account.',
            emailSent
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/auth/verify-email
router.get('/verify-email', async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.status(400).send('<h1>Invalid verification link</h1>');
        }

        const verification = await db.getVerificationCode(code);

        if (!verification) {
            return res.status(400).send('<h1>Invalid or expired verification link</h1>');
        }

        if (new Date() > new Date(verification.expires_at)) {
            await db.deleteVerificationCode(code);
            return res.status(400).send('<h1>Verification link has expired</h1>');
        }

        const user = await db.getUserByEmail(verification.email);

        if (!user) {
            return res.status(404).send('<h1>User not found</h1>');
        }

        await db.updateUser(verification.email, { verified: true });
        await db.deleteVerificationCode(code);

        res.send(`
            <html>
                <head>
                    <title>Email Verified</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            min-height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .container {
                            background: white;
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            text-align: center;
                            max-width: 500px;
                        }
                        h1 { color: #10b981; margin-bottom: 20px; }
                        p { color: #6b7280; margin-bottom: 30px; }
                        a {
                            display: inline-block;
                            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                            color: white;
                            padding: 12px 30px;
                            text-decoration: none;
                            border-radius: 25px;
                            font-weight: 600;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>✅ Email Verified Successfully!</h1>
                        <p>Your email has been verified. You can now sign in to your account.</p>
                        <a href="/signin.html">Go to Sign In</a>
                    </div>
                </body>
            </html>
        `);

    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).send('<h1>Internal server error</h1>');
    }
});

// POST /api/auth/signin
router.post('/signin', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await db.getUserByEmail(email);

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (!user.verified && user.provider === 'local') {
            return res.status(403).json({ error: 'Please verify your email before signing in' });
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Check if user is admin
        const userIsAdmin = isAdmin(user.email);

        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                isAdmin: userIsAdmin
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );

        const { password: _, ...userWithoutPassword } = user;

        res.json({
            ok: true,
            token,
            user: {
                ...userWithoutPassword,
                isAdmin: userIsAdmin
            },
            isAdmin: userIsAdmin,
            requires_password_reset: user.requires_password_reset || false
        });

    } catch (error) {
        console.error('Signin error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Generate secure reset token
function generateResetToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Normalize email (lowercase, trim)
        const normalizedEmail = email.toLowerCase().trim();

        const user = await db.getUserByEmail(normalizedEmail);

        // Check if email is registered
        if (!user) {
            return res.status(404).json({ error: 'Email is not registered' });
        }

        // Generate reset token (NOT temporary password)
        const resetToken = generateResetToken();
        const resetTokenHash = await bcrypt.hash(resetToken, 10);
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour expiry

        // Store reset token WITHOUT changing password
        await db.updateUser(normalizedEmail, {
            resetTokenHash: resetTokenHash,
            resetTokenExpiry: resetTokenExpiry
        });

        // Create reset link
        const resetLink = `${req.protocol}://${req.get('host')}/reset.html?token=${resetToken}&email=${encodeURIComponent(normalizedEmail)}`;

        const emailSent = await sendEmail(
            normalizedEmail,
            'Password Reset Request - Auction Platform',
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a2332;">Password Reset Request 🔐</h2>
                <p>Hi ${user.name},</p>
                <p>We received a request to reset your password. Click the button below to set a new password:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetLink}" 
                       style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                              color: white;
                              padding: 12px 30px;
                              text-decoration: none;
                              border-radius: 25px;
                              font-weight: 600;
                              display: inline-block;">
                        Reset Password
                    </a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">
                    Or copy and paste this link in your browser:<br>
                    <a href="${resetLink}" style="color: #00d4ff; word-break: break-all;">${resetLink}</a>
                </p>
                <p style="color: #ef4444; font-weight: 600;">
                    ⚠️ This link will expire in 1 hour.
                </p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                <p style="color: #9ca3af; font-size: 12px;">
                    If you didn't request this, please ignore this email. Your password will remain unchanged.
                </p>
            </div>
            `
        );

        if (!emailSent) {
            return res.status(500).json({ error: 'Failed to send email' });
        }

        res.json({ ok: true, message: 'Password reset link sent to your email' });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/reset-password-with-token (for forgot password flow)
router.post('/reset-password-with-token', async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;

        if (!email || !token || !newPassword) {
            return res.status(400).json({ error: 'Email, token, and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const user = await db.getUserByEmail(normalizedEmail);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if reset token exists and is valid
        if (!user.resetTokenHash || !user.resetTokenExpiry) {
            return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
        }

        // Check if token is expired
        if (new Date() > new Date(user.resetTokenExpiry)) {
            return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
        }

        // Verify reset token
        const isValidToken = await bcrypt.compare(token, user.resetTokenHash);
        if (!isValidToken) {
            return res.status(400).json({ error: 'Invalid reset link. Please request a new one.' });
        }

        // Check if new password is same as current password
        const isSameAsOld = await bcrypt.compare(newPassword, user.password);
        if (isSameAsOld) {
            return res.status(400).json({ error: 'New password must be different from your previous password' });
        }

        // Hash new password and update
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.updateUser(normalizedEmail, {
            password: hashedPassword,
            resetTokenHash: null,
            resetTokenExpiry: null,
            requires_password_reset: false
        });

        res.json({ ok: true, message: 'Password updated successfully' });

    } catch (error) {
        console.error('Reset password with token error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/reset-password (for logged-in user changing password)
router.post('/reset-password', verifyToken, async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword) {
            return res.status(400).json({ error: 'New password is required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const user = await db.getUserByEmail(req.user.email);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if new password is same as old password
        const isSameAsOld = await bcrypt.compare(newPassword, user.password);
        if (isSameAsOld) {
            return res.status(400).json({ error: 'New password must be different from your previous password' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.updateUser(req.user.email, {
            password: hashedPassword,
            requires_password_reset: false
        });

        res.json({ ok: true, message: 'Password updated successfully' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/auth/verify
router.get('/verify', verifyToken, async (req, res) => {
    try {
        const user = await db.getUserByEmail(req.user.email);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if user is admin
        const userIsAdmin = isAdmin(user.email);

        const { password: _, ...userWithoutPassword } = user;

        res.json({ 
            ok: true, 
            user: {
                ...userWithoutPassword,
                isAdmin: userIsAdmin,
                currentRole: req.user.role || null
            }
        });
    } catch (error) {
        console.error('Verify token error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Google OAuth routes
router.get('/google', (req, res) => {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=email profile`;
    res.redirect(googleAuthUrl);
});

router.get('/google/callback', async (req, res) => {
    try {
        res.redirect('/');
    } catch (error) {
        console.error('Google OAuth error:', error);
        res.redirect('/signin.html?error=google_auth_failed');
    }
});

module.exports = { router, verifyToken, db };