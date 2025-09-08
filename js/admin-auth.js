/* ======================
   ADMIN AUTHENTICATION JAVASCRIPT
   js/admin-auth.js
   ====================== */

// API Configuration - Dynamic URL based on environment
const API_BASE_URL = (() => {
    const hostname = window.location.hostname;
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3000';
    } else {
        // Production API URL - we'll update this with your Railway URL
        return 'https://RAILWAY_URL_PLACEHOLDER';
    }
})();

   // Admin Authentication System
class AdminLogin {
    constructor() {
        this.form = document.getElementById('loginForm');
        this.emailInput = document.getElementById('email');
        this.passwordInput = document.getElementById('password');
        this.passwordToggle = document.getElementById('passwordToggle');
        this.rememberMe = document.getElementById('rememberMe');
        this.loginButton = document.getElementById('loginButton');
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.buttonText = document.getElementById('buttonText');
        this.alertContainer = document.getElementById('alertContainer');
        
        this.initializeEventListeners();
        this.checkRememberedCredentials();
    }

    initializeEventListeners() {
        // Form submission
        this.form.addEventListener('submit', (e) => this.handleLogin(e));
        
        // Password toggle
        this.passwordToggle.addEventListener('click', () => this.togglePassword());
        
        // Real-time validation
        this.emailInput.addEventListener('blur', () => this.validateEmail());
        this.passwordInput.addEventListener('blur', () => this.validatePassword());
        this.emailInput.addEventListener('input', () => this.clearFieldError('email'));
        this.passwordInput.addEventListener('input', () => this.clearFieldError('password'));
        
        // Forgot password
        document.getElementById('forgotPasswordLink').addEventListener('click', (e) => {
            e.preventDefault();
            this.handleForgotPassword();
        });
    }

    checkRememberedCredentials() {
        const rememberedEmail = localStorage.getItem('adminEmail');
        if (rememberedEmail) {
            this.emailInput.value = rememberedEmail;
            this.rememberMe.checked = true;
        }
    }

    togglePassword() {
        if (this.passwordInput.type === 'password') {
            this.passwordInput.type = 'text';
            this.passwordToggle.textContent = 'Hide';
        } else {
            this.passwordInput.type = 'password';
            this.passwordToggle.textContent = 'Show';
        }
    }

    validateEmail() {
        const email = this.emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!email) {
            this.showFieldError('email', 'Email address is required');
            return false;
        } else if (!emailRegex.test(email)) {
            this.showFieldError('email', 'Please enter a valid email address');
            return false;
        } else {
            this.showFieldSuccess('email');
            return true;
        }
    }

    validatePassword() {
        const password = this.passwordInput.value;
        
        if (!password) {
            this.showFieldError('password', 'Password is required');
            return false;
        } else if (password.length < 6) {
            this.showFieldError('password', 'Password must be at least 6 characters');
            return false;
        } else {
            this.showFieldSuccess('password');
            return true;
        }
    }

    showFieldError(field, message) {
        const input = document.getElementById(field);
        const errorElement = document.getElementById(`${field}Error`);
        
        input.classList.remove('success');
        input.classList.add('error');
        errorElement.textContent = message;
        errorElement.classList.add('show');
    }

    showFieldSuccess(field) {
        const input = document.getElementById(field);
        const errorElement = document.getElementById(`${field}Error`);
        
        input.classList.remove('error');
        input.classList.add('success');
        errorElement.classList.remove('show');
    }

    clearFieldError(field) {
        const input = document.getElementById(field);
        const errorElement = document.getElementById(`${field}Error`);
        
        input.classList.remove('error');
        errorElement.classList.remove('show');
    }

    showAlert(message, type = 'error') {
        const alertHtml = `
            <div class="alert alert-${type} show">
                ${message}
            </div>
        `;
        this.alertContainer.innerHTML = alertHtml;
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => {
                const alert = this.alertContainer.querySelector('.alert');
                if (alert) alert.remove();
            }, 5000);
        }
    }

    setLoading(isLoading) {
        if (isLoading) {
            this.loginButton.disabled = true;
            this.loadingSpinner.style.display = 'inline-block';
            this.buttonText.textContent = 'Signing In...';
        } else {
            this.loginButton.disabled = false;
            this.loadingSpinner.style.display = 'none';
            this.buttonText.textContent = 'Sign In';
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        
        // Clear previous alerts
        this.alertContainer.innerHTML = '';
        
        // Validate form
        const isEmailValid = this.validateEmail();
        const isPasswordValid = this.validatePassword();
        
        if (!isEmailValid || !isPasswordValid) {
            this.showAlert('Please correct the errors above', 'error');
            return;
        }
        
        const formData = {
            email: this.emailInput.value.trim(),
            password: this.passwordInput.value,
            rememberMe: this.rememberMe.checked
        };
        
        this.setLoading(true);
        
        try {
            // Make API call to your authentication endpoint
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                // Store token
                localStorage.setItem('adminToken', data.data.token);
                
                // Handle remember me
                if (formData.rememberMe) {
                    localStorage.setItem('adminEmail', formData.email);
                } else {
                    localStorage.removeItem('adminEmail');
                }
                
                this.showAlert('Login successful! Redirecting to admin dashboard...', 'success');
                
                // Redirect to admin dashboard
                setTimeout(() => {
                    window.location.href = 'admin-dashboard.html';
                }, 1500);
                
            } else {
                throw new Error(data.message || 'Login failed');
            }
            
        } catch (error) {
            console.error('Login error:', error);
            this.showAlert(error.message || 'Login failed. Please check your credentials and try again.', 'error');
        } finally {
            this.setLoading(false);
        }
    }

    handleForgotPassword() {
        const email = this.emailInput.value.trim();
        
        if (!email) {
            this.showAlert('Please enter your email address first', 'info');
            this.emailInput.focus();
            return;
        }
        
        if (!this.validateEmail()) {
            this.showAlert('Please enter a valid email address', 'error');
            return;
        }
        
        // For now, show info message. Later this will trigger password reset
        this.showAlert('Password reset functionality will be implemented in the next phase. Please contact support for password reset assistance.', 'info');
    }
}

// Utility functions for token management
const AuthUtils = {
    // Check if user is logged in
    isLoggedIn() {
        const token = localStorage.getItem('adminToken');
        return !!token;
    },

    // Get stored token
    getToken() {
        return localStorage.getItem('adminToken');
    },

    // Remove token (logout)
    logout() {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminEmail');
        window.location.href = 'admin-login.html';
    },

    // Verify token with server
    async verifyToken() {
        const token = this.getToken();
        if (!token) return false;

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            return response.ok && data.success;
        } catch (error) {
            console.error('Token verification failed:', error);
            return false;
        }
    },

    // Make authenticated API requests
    async apiRequest(url, options = {}) {
        const token = this.getToken();
        
        return fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : '',
                ...options.headers
            }
        });
    }
};

// Initialize the login system when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if we're on the login page
    if (document.getElementById('loginForm')) {
        new AdminLogin();
    }
});

// Handle browser back button and existing login check
window.addEventListener('load', () => {
    if (document.getElementById('loginForm')) {
        const token = localStorage.getItem('adminToken');
        if (token) {
            // User is already logged in, show message
            const alertContainer = document.getElementById('alertContainer');
            if (alertContainer) {
                alertContainer.innerHTML = `
                    <div class="alert alert-info show">
                        You are already logged in. <a href="admin-dashboard.html" style="color: var(--info-blue); text-decoration: underline;">Go to Dashboard</a>
                    </div>
                `;
            }
        }
    }
});

// Export for use in other files
window.AuthUtils = AuthUtils;