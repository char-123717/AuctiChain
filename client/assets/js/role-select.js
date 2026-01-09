// role-select.js - Role Selection Handler

// Toast notification function
function showToast(message, type = 'info', duration = 4000) {
  // Remove existing toast
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.innerHTML = `
    <i class="fas ${type === 'error' ? 'fa-times-circle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i>
    <span>${message}</span>
  `;
  
  // Add styles inline for this page
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    z-index: 9999;
    animation: slideIn 0.3s ease;
    background: ${type === 'error' ? 'rgba(239, 68, 68, 0.95)' : type === 'success' ? 'rgba(16, 185, 129, 0.95)' : 'rgba(59, 130, 246, 0.95)'};
    color: white;
    font-weight: 500;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Check authentication
  const token = localStorage.getItem('auction_token');
  const user = JSON.parse(localStorage.getItem('auction_user') || 'null');

  if (!token || !user) {
    window.location.href = '/signin.html';
    return;
  }

  // Verify token and check if admin
  try {
    const response = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      localStorage.removeItem('auction_token');
      localStorage.removeItem('auction_user');
      window.location.href = '/signin.html';
      return;
    }

    const data = await response.json();
    
    // If admin, redirect to admin dashboard
    if (data.user?.isAdmin) {
      window.location.href = '/admin/dashboard.html';
      return;
    }

    // Display user name
    const userNameEl = document.getElementById('userName');
    if (userNameEl && data.user?.name) {
      userNameEl.textContent = data.user.name;
    }

  } catch (error) {
    console.error('Auth verification failed:', error);
    window.location.href = '/signin.html';
    return;
  }

  // Role card click handlers
  const sellerCard = document.getElementById('sellerCard');
  const buyerCard = document.getElementById('buyerCard');

  sellerCard.addEventListener('click', () => selectRole('seller'));
  buyerCard.addEventListener('click', () => selectRole('buyer'));

  // Button click handlers (prevent double trigger)
  sellerCard.querySelector('.role-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    selectRole('seller');
  });

  buyerCard.querySelector('.role-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    selectRole('buyer');
  });
});

async function selectRole(role) {
  const token = localStorage.getItem('auction_token');
  const card = document.getElementById(role === 'seller' ? 'sellerCard' : 'buyerCard');
  
  // Add loading state
  card.classList.add('loading');
  const btn = card.querySelector('.role-btn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
  btn.disabled = true;

  try {
    const response = await fetch('/api/role/select', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ role })
    });

    const data = await response.json();

    if (data.ok) {
      // Update token if new one provided
      if (data.token) {
        localStorage.setItem('auction_token', data.token);
      }

      // Update user data with role
      const user = JSON.parse(localStorage.getItem('auction_user') || '{}');
      user.currentRole = role;
      localStorage.setItem('auction_user', JSON.stringify(user));

      // Redirect to appropriate dashboard
      if (role === 'seller') {
        window.location.href = '/seller/dashboard.html';
      } else {
        window.location.href = '/buyer/dashboard.html';
      }
    } else {
      showToast(data.error || 'Failed to select role', 'error');
      card.classList.remove('loading');
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  } catch (error) {
    console.error('Role selection error:', error);
    showToast('Connection error. Please try again.', 'error');
    card.classList.remove('loading');
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// Logout function
function logout() {
  localStorage.removeItem('auction_token');
  localStorage.removeItem('auction_user');
  window.location.href = '/signin.html';
}
