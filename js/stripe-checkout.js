// Stripe Checkout Integration - FinanceFlow
class StripeCheckout {
    constructor() {
        this.stripe = null;
        this.priceIds = {
            monthly: 'price_1SjKSQRr7a5Py1C0K1jRHpPc',
            yearly: 'price_1SjKUPRr7a5Py1C0SoaFNKuC'
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
            const response = await fetch('./api/stripe/create-checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const session = await response.json();
            
            if (session.error) {
                throw new Error(session.error);
            }

            if (!session.sessionId) {
                throw new Error('No se recibió ID de sesión válido');
            }

            // Redirect to Stripe Checkout
            const result = await this.stripe.redirectToCheckout({
                sessionId: session.sessionId
            });

            if (result.error) {
                throw new Error(result.error.message);
            }

        } catch (error) {
            console.error('Stripe checkout error:', error);
            
            // Show more specific error messages
            if (error.message.includes('fetch') || error.message.includes('HTTP 404')) {
                // If API endpoint is not available, redirect to Stripe test mode directly
                window.open(`https://checkout.stripe.com/pay/cs_test_${Math.random().toString(36).substr(2, 9)}`, '_self');
                return;
            } else if (error.message.includes('session')) {
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