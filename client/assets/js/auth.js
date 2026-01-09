// auth.js - Client-side Authentication Handler
// Supports combined signin/signup/forgot in single page

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    
    // Skip jika bukan halaman auth
    if (!path.includes('signin') && !path.includes('reset')) return;

    // Cek token validity (tanpa redirect)
    checkTokenValidityOnly();

    // Inisialisasi semua form yang ada di halaman
    initSigninForm();
    initSignupForm();
    initForgotPasswordForm();
    initResetPasswordForm();

    // Inisialisasi panel navigation
    initPanelNavigation();

    // Google OAuth handler
    initGoogleOAuth();

    // Jika ada parameter sukses dari Google OAuth
    if (window.location.search.includes('google=success')) {
        window.location.href = '/';
    }
});

// ==================== PANEL NAVIGATION ====================
function initPanelNavigation() {
    const wrapper = document.querySelector('.auth-wrapper');
    if (!wrapper) return;

    // Register trigger - go to signup
    document.querySelectorAll('.register-trigger').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            wrapper.classList.remove('forgot-mode');
            wrapper.classList.add('toggled');
        });
    });

    // Login trigger - back to signin
    document.querySelectorAll('.login-trigger').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            wrapper.classList.remove('toggled');
            wrapper.classList.remove('forgot-mode');
        });
    });

    // Forgot trigger - go to forgot password
    document.querySelectorAll('.forgot-trigger').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            wrapper.classList.remove('toggled');
            wrapper.classList.add('forgot-mode');
        });
    });

    // Handle autofill detection for floating labels
    handleAutofillDetection();
    
    // Handle password toggle
    initPasswordToggle();
}

// Password show/hide toggle
function initPasswordToggle() {
    const toggles = document.querySelectorAll('.password-toggle');
    
    toggles.forEach(toggle => {
        const targetId = toggle.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        // Toggle click handler
        toggle.addEventListener('click', () => {
            if (input.type === 'password') {
                input.type = 'text';
                toggle.classList.remove('fa-eye');
                toggle.classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                toggle.classList.remove('fa-eye-slash');
                toggle.classList.add('fa-eye');
            }
        });

        // Update icon color based on state
        const updateIconColor = () => {
            const isFilled = input.value.length > 0;
            const isFocused = document.activeElement === input;
            
            if (isFilled || isFocused) {
                toggle.classList.add('icon-active');
            } else {
                toggle.classList.remove('icon-active');
            }
        };

        // Hover state
        const fieldWrapper = input.closest('.field-wrapper');
        if (fieldWrapper) {
            fieldWrapper.addEventListener('mouseenter', () => {
                toggle.classList.add('icon-hover');
            });
            fieldWrapper.addEventListener('mouseleave', () => {
                toggle.classList.remove('icon-hover');
                updateIconColor();
            });
        }

        // Input events
        input.addEventListener('input', updateIconColor);
        input.addEventListener('focus', updateIconColor);
        input.addEventListener('blur', updateIconColor);

        // Initial state
        updateIconColor();
    });
}

// Detect browser autofill and add class for styling
function handleAutofillDetection() {
    const inputs = document.querySelectorAll('.field-wrapper input');
    
    inputs.forEach(input => {
        // Function to update label state
        const updateLabelState = () => {
            const isFilled = input.value.length > 0;
            const isFocused = document.activeElement === input;
            
            if (isFilled || isFocused) {
                input.classList.add('label-float');
            } else {
                input.classList.remove('label-float');
            }
        };

        // Check on animation start (Chrome autofill triggers this)
        input.addEventListener('animationstart', (e) => {
            if (e.animationName === 'onAutoFillStart') {
                input.classList.add('label-float');
            }
        });

        // Update on input change
        input.addEventListener('input', updateLabelState);

        // Update on focus
        input.addEventListener('focus', updateLabelState);

        // Update on blur - CRITICAL: label must drop if empty
        input.addEventListener('blur', updateLabelState);

        // Initial check after page load (for autofill)
        setTimeout(updateLabelState, 100);
        setTimeout(updateLabelState, 500);
        setTimeout(updateLabelState, 1000);
    });
}

// Hanya validasi token (tidak redirect!)
async function checkTokenValidityOnly() {
    const token = localStorage.getItem('auction_token');
    if (!token) return;

    try {
        const response = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            localStorage.removeItem('auction_token');
            localStorage.removeItem('auction_user');
        }
    } catch (err) {
        console.warn('Token verification failed:', err);
    }
}

// ==================== SIGN IN ====================
function initSigninForm() {
    const form = document.getElementById('signinForm');
    if (!form) return;

    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(errorMsg);
        hideMessage(successMsg);

        const email = document.getElementById('email')?.value.trim();
        const password = document.getElementById('password')?.value;

        if (!email || !password) {
            showError(errorMsg, 'Please fill in all fields');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        try {
            const res = await fetch('/api/auth/signin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();

            if (data.ok) {
                localStorage.setItem('auction_token', data.token);
                localStorage.setItem('auction_user', JSON.stringify(data.user));
                showSuccess(successMsg, 'Login successful! Redirecting...');

                setTimeout(() => {
                    if (data.requires_password_reset) {
                        window.location.href = '/reset.html';
                    } else if (data.isAdmin) {
                        // Admin langsung ke admin dashboard
                        window.location.href = '/admin/dashboard.html';
                    } else if (data.user.role) {
                        // User sudah punya role, redirect ke dashboard sesuai role
                        window.location.href = data.user.role === 'seller' 
                            ? '/seller/dashboard.html' 
                            : '/buyer/dashboard.html';
                    } else {
                        // User belum pilih role, ke halaman role selection
                        window.location.href = '/role-select.html';
                    }
                }, 800);
            } else {
                showError(errorMsg, data.error || 'Login failed');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Login';
            }
        } catch (err) {
            showError(errorMsg, 'Connection error. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Login';
        }
    });
}

// ==================== SIGN UP ====================
function initSignupForm() {
    const form = document.getElementById('signupForm');
    if (!form) return;

    const errorMsg = document.getElementById('errorMsgSignup');
    const successMsg = document.getElementById('successMsgSignup');
    const submitBtn = document.getElementById('submitBtnSignup');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(errorMsg);
        hideMessage(successMsg);

        const name = document.getElementById('name')?.value.trim();
        const email = document.getElementById('emailSignup')?.value.trim();
        const password = document.getElementById('passwordSignup')?.value;
        const confirmPassword = document.getElementById('confirmPassword')?.value;

        // Validasi frontend
        if (!name || name.length < 2) {
            showError(errorMsg, 'Name must be at least 2 characters');
            return;
        }
        if (!email || !password || !confirmPassword) {
            showError(errorMsg, 'All fields are required');
            return;
        }
        if (password.length < 8) {
            showError(errorMsg, 'Password must be at least 8 characters');
            return;
        }
        if (password !== confirmPassword) {
            showError(errorMsg, 'Passwords do not match');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account...';

        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });

            const data = await res.json();

            if (data.ok) {
                showSuccess(successMsg, 'Account created! Please check your email to verify.');
                // Slide back to signin after 2 seconds
                setTimeout(() => {
                    const wrapper = document.querySelector('.auth-wrapper');
                    wrapper?.classList.remove('toggled');
                    wrapper?.classList.remove('forgot-mode');
                    // Reset form
                    form.reset();
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Register';
                    hideMessage(successMsg);
                }, 2500);
            } else {
                showError(errorMsg, data.error || 'Signup failed');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Register';
            }
        } catch (err) {
            showError(errorMsg, 'Connection error. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Register';
        }
    });
}

// ==================== FORGOT PASSWORD ====================
function initForgotPasswordForm() {
    const form = document.getElementById('forgotForm');
    if (!form) return;

    const errorMsg = document.getElementById('errorMsgForgot');
    const successMsg = document.getElementById('successMsgForgot');
    const submitBtn = document.getElementById('submitBtnForgot');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(errorMsg);
        hideMessage(successMsg);

        const email = document.getElementById('emailForgot')?.value.trim();
        if (!email) {
            showError(errorMsg, 'Please enter your email');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await res.json();

            if (data.ok) {
                showSuccess(successMsg, 'Password reset link sent to your email!');
                submitBtn.textContent = 'Sent!';
                // Slide back to signin after 2 seconds
                setTimeout(() => {
                    const wrapper = document.querySelector('.auth-wrapper');
                    wrapper?.classList.remove('toggled');
                    wrapper?.classList.remove('forgot-mode');
                    // Reset form
                    form.reset();
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Send Temporary Password';
                    hideMessage(successMsg);
                }, 2500);
            } else {
                showError(errorMsg, data.error || 'Failed to send email');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Temporary Password';
            }
        } catch (err) {
            showError(errorMsg, 'Connection error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Temporary Password';
        }
    });
}

// ==================== RESET PASSWORD ====================
function initResetPasswordForm() {
    const form = document.getElementById('resetForm');
    if (!form) return;

    // Skip if reset.html has its own handler (token-based reset)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('token')) return;

    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(errorMsg);
        hideMessage(successMsg);

        const newPassword = document.getElementById('newPassword')?.value;
        const confirmPassword = document.getElementById('confirmPassword')?.value;

        if (newPassword !== confirmPassword) {
            showError(errorMsg, 'Passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            showError(errorMsg, 'Password must be at least 8 characters');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating...';

        const token = localStorage.getItem('auction_token');

        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ newPassword })
            });

            const data = await res.json();

            if (data.ok) {
                showSuccess(successMsg, 'Password updated! Redirecting...');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
            } else {
                showError(errorMsg, data.error || 'Failed to update password');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Update Password';
            }
        } catch (err) {
            showError(errorMsg, 'Connection error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Update Password';
        }
    });
}

// ==================== GOOGLE OAUTH ====================
function initGoogleOAuth() {
    const googleBtn = document.getElementById('googleSignin');
    if (!googleBtn) return;

    googleBtn.addEventListener('click', () => {
        window.location.href = '/api/auth/google';
    });
}

// ==================== UTILITY FUNCTIONS ====================
function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.style.display = 'block';
    element.style.color = '#ff8080';
    
    // Auto hide after 2 seconds
    setTimeout(() => {
        hideMessage(element);
    }, 2000);
}

function showSuccess(element, message) {
    if (!element) return;
    element.textContent = message;
    element.style.display = 'block';
    element.style.color = '#10b981';
    
    // Auto hide after 2 seconds
    setTimeout(() => {
        hideMessage(element);
    }, 2000);
}

function hideMessage(element) {
    if (element) element.style.display = 'none';
}

// Logout function (bisa dipanggil dari mana saja)
window.logout = function () {
    localStorage.removeItem('auction_token');
    localStorage.removeItem('auction_user');
    window.location.href = '/signin.html';
};

// Export untuk script lain
window.getAuthToken = () => localStorage.getItem('auction_token');
window.getAuthUser = () => JSON.parse(localStorage.getItem('auction_user') || 'null');
