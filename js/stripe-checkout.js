// Stripe Checkout Integration - FinanceFlow
class StripeCheckout {
    constructor() {
        this.stripe = null;
        this.priceIds = {
            monthly: 'price_1SjKSQRr7a5Py1C0K1jRHpPc',
            yearly: 'price_1TaNmTRr7a5Py1C04bl5J8DC'
        };
        this.init();
    }

    init() {
        if (typeof Stripe !== 'undefined') {
            const publishableKey = window.STRIPE_PUBLISHABLE_KEY;
            if (!publishableKey) {
                console.error('[Stripe] No se ha inyectado STRIPE_PUBLISHABLE_KEY');
                return;
            }
            this.stripe = Stripe(publishableKey);
        } else {
            console.warn('Stripe not loaded');
        }
    }

    async redirectToCheckout(planType = 'monthly') {
        try {
            // Refuerzo in-app: en los webviews de Instagram/Facebook/TikTok el checkout
            // de Stripe falla. Detección PROPIA inline (no depende de que el banner haya
            // cargado); window.FFInApp se usa solo como comodidad si ya existe.
            let inApp = /Instagram|FBAN|FBAV|BytedanceWebview/i.test(navigator.userAgent || '');
            if (window.FFInApp && typeof window.FFInApp.isInApp === 'function') {
                inApp = inApp || window.FFInApp.isInApp();
            }
            if (inApp) {
                alert('El pago no funciona dentro de Instagram. Abre la app en tu navegador para completar la suscripción.');
                return;
            }

            if (!this.stripe) {
                throw new Error('Stripe no está inicializado correctamente');
            }
            
            const priceId = this.priceIds[planType];
            if (!priceId) {
                throw new Error('Invalid plan type');
            }

            const userId = this.getCurrentUserId();
            
            // Si no hay usuario autenticado, crear sesión temporal
            const requestBody = {
                priceId: priceId,
                planType: planType
            };
            
            if (userId) {
                requestBody.userId = userId;
            } else {
                // Usuario no autenticado - se creará tras el pago
                requestBody.createUser = true;
            }

            // Create checkout session via API call
            const apiBase = window.API_URL || './api';
            const response = await fetch(`${apiBase}/stripe/create-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('financeflow_token') || ''}`
                },
                credentials: 'include',
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const session = await response.json();
            
            if (session.error) {
                throw new Error(session.error);
            }

            // El Worker devuelve checkout_url directamente: redirigir ahí
            if (session.checkout_url) {
                window.location.href = session.checkout_url;
                return;
            }

            // Fallback: si solo viene session_id, usar redirectToCheckout de Stripe.js
            const sid = session.session_id || session.sessionId;
            if (!sid) {
                throw new Error('No se recibió una sesión de pago válida');
            }
            const result = await this.stripe.redirectToCheckout({ sessionId: sid });
            if (result.error) {
                throw new Error(result.error.message);
            }

        } catch (error) {
            console.error('Stripe checkout error:', error);
            if (error.message && error.message.includes('session')) {
                this.showError('Error al crear la sesión de pago. Inténtalo de nuevo.');
            } else {
                this.showError('Error al procesar el pago. Contacta soporte si persiste.');
            }
        }
    }

    getCurrentUserId() {
        try {
            const user = JSON.parse(localStorage.getItem('currentUser'));
            return user ? user.id : null;
        } catch {
            return null;
        }
    }

    showError(message) {
        // Create simple toast notification
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 5000);
    }
}

// Global instance
window.stripeCheckout = new StripeCheckout();
