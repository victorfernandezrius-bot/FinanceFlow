// Sistema de Validación de Límites REALES
// FinanceFlow SaaS - Limitaciones funcionales efectivas

import Auth from './auth.js';

class PlanLimitsManager {
    constructor() {
        this.limits = {
            free: {
                max_activo_accounts: 1,     // Solo 1 cuenta bancaria/activo
                max_income_accounts: 2,     // Máximo 2 cuentas de ingresos
                max_expense_accounts: 8,    // Máximo 8 cuentas de gastos  
                max_pasivo_accounts: 2,     // Máximo 2 pasivos
                max_patrimonio_accounts: 1, // Máximo 1 patrimonio
                features: [
                    'manual_entry', 
                    'basic_dashboard', 
                    'daily_ledger', 
                    'monthly_ledger'
                ],
                blocked_features: [
                    'bank_connection', 
                    'automation', 
                    'autocontrol', 
                    'annual_ledger', 
                    'notifications', 
                    'export'
                ]
            },
            premium: {
                max_activo_accounts: 10,    // Hasta 10 cuentas bancarias
                max_income_accounts: 8,     // Hasta 8 ingresos
                max_expense_accounts: 15,   // Hasta 15 gastos
                max_pasivo_accounts: 10,    // Hasta 10 pasivos
                max_patrimonio_accounts: 3, // Hasta 3 patrimonio
                features: [
                    'manual_entry', 
                    'basic_dashboard', 
                    'daily_ledger', 
                    'monthly_ledger',
                    'bank_connection', 
                    'automation', 
                    'autocontrol', 
                    'annual_ledger', 
                    'notifications', 
                    'export'
                ],
                blocked_features: []
            }
        };

        this.accountTypeMapping = {
            'activo': 'max_activo_accounts',
            'ingreso': 'max_income_accounts', 
            'gasto': 'max_expense_accounts',
            'pasivo': 'max_pasivo_accounts',
            'patrimonio': 'max_patrimonio_accounts'
        };
    }

    // ===== VALIDACIONES DE LÍMITES =====

    validateAccountCreation(accountType) {
        const currentPlan = Auth.getUserPlan();
        const planLimits = this.limits[currentPlan];
        
        if (!planLimits) {
            return { success: false, error: 'Plan no válido' };
        }

        const limitKey = this.accountTypeMapping[accountType];
        if (!limitKey) {
            return { success: false, error: 'Tipo de cuenta no válido' };
        }

        const currentCount = this.getCurrentAccountCount(accountType);
        const maxAllowed = planLimits[limitKey];

        if (currentCount >= maxAllowed) {
            return {
                success: false,
                error: `Has alcanzado el límite de ${maxAllowed} cuenta(s) de tipo ${accountType} en el plan ${currentPlan.toUpperCase()}`,
                accountType,
                currentCount,
                maxAllowed,
                plan: currentPlan
            };
        }

        return { success: true };
    }

    validateFeatureAccess(feature) {
        const currentPlan = Auth.getUserPlan();
        const planLimits = this.limits[currentPlan];
        
        if (!planLimits) {
            return { success: false, error: 'Plan no válido' };
        }

        if (planLimits.blocked_features.includes(feature)) {
            return {
                success: false,
                error: `La función '${feature}' no está disponible en el plan ${currentPlan.toUpperCase()}`,
                feature,
                plan: currentPlan,
                requiresPremium: true
            };
        }

        return { success: true };
    }

    getCurrentAccountCount(accountType) {
        const currentUser = Auth.getCurrentUser();
        if (!currentUser) return 0;

        const storageKey = `user_accounts_${currentUser.id}`;
        const accounts = JSON.parse(localStorage.getItem(storageKey) || '[]');
        
        return accounts.filter(acc => acc.tipo === accountType).length;
    }

    // ===== INTERFAZ DE USUARIO PARA LÍMITES =====

    showLimitReachedModal(limitInfo) {
        if (typeof limitInfo === 'string') {
            // Si es solo el tipo de cuenta, crear info básica
            const accountType = limitInfo;
            const validation = this.validateAccountCreation(accountType);
            if (validation.success) return; // No mostrar modal si no hay límite
            limitInfo = validation;
        }

        const modal = this.createLimitModal(limitInfo);
        document.body.appendChild(modal);
        
        // Mostrar modal con animación
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            modal.classList.add('opacity-100');
        });
    }

    createLimitModal(limitInfo) {
        const { accountType, currentCount, maxAllowed, plan } = limitInfo;
        
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 opacity-0 transition-opacity duration-300';
        modal.id = 'limit-modal';
        
        const accountTypeNames = {
            'activo': 'cuentas bancarias',
            'ingreso': 'cuentas de ingreso',
            'gasto': 'cuentas de gasto',
            'pasivo': 'cuentas de pasivo',
            'patrimonio': 'cuentas de patrimonio'
        };

        modal.innerHTML = `
            <div class="flex items-center justify-center min-h-screen p-4">
                <div class="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
                    <div class="text-center">
                        <div class="bg-yellow-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                            <i class="fas fa-lock text-yellow-600 text-2xl"></i>
                        </div>
                        
                        <h3 class="text-xl font-semibold text-gray-900 mb-2">
                            Límite Alcanzado
                        </h3>
                        
                        <p class="text-gray-600 mb-4">
                            Has alcanzado el límite de <strong>${maxAllowed}</strong> 
                            ${accountTypeNames[accountType]} en tu plan <strong>${plan.toUpperCase()}</strong>.
                        </p>
                        
                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                            <h4 class="font-semibold text-blue-900 mb-2">
                                <i class="fas fa-crown mr-2"></i>
                                Actualiza a Premium
                            </h4>
                            <ul class="text-sm text-blue-800 space-y-1 mb-3">
                                <li>• Hasta 5 cuentas bancarias</li>
                                <li>• Hasta 8 cuentas de ingreso</li>
                                <li>• Hasta 15 cuentas de gasto</li>
                                <li>• Registro automático de movimientos (CSV/Excel)</li>
                                <li>• Automatización con IA</li>
                                <li>• Exportar datos</li>
                            </ul>
                            <p class="text-sm text-blue-600 font-semibold">
                                Solo €2/mes - Cancela cuando quieras
                            </p>
                        </div>
                        
                        <div class="flex space-x-3">
                            <button id="close-limit-modal" class="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-400 transition-colors">
                                Continuar con FREE
                            </button>
                            <button id="upgrade-to-premium" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors">
                                <i class="fas fa-crown mr-2"></i>
                                Actualizar Ahora
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Event listeners
        modal.querySelector('#close-limit-modal').addEventListener('click', () => {
            this.closeLimitModal();
        });

        modal.querySelector('#upgrade-to-premium').addEventListener('click', () => {
            window.location.href = '/pricing.html';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeLimitModal();
            }
        });

        return modal;
    }

    closeLimitModal() {
        const modal = document.getElementById('limit-modal');
        if (modal) {
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
            }, 300);
        }
    }

    showFeatureLockedModal(feature) {
        const validation = this.validateFeatureAccess(feature);
        if (validation.success) return;

        const modal = this.createFeatureLockedModal(validation);
        document.body.appendChild(modal);
        
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            modal.classList.add('opacity-100');
        });
    }

    createFeatureLockedModal(validationInfo) {
        const { feature, plan } = validationInfo;
        
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 opacity-0 transition-opacity duration-300';
        modal.id = 'feature-locked-modal';
        
        const featureNames = {
            'bank_connection': 'Registro Automático de Movimientos',
            'automation': 'Automatización con IA', 
            'autocontrol': 'Plan de Autocontrol',
            'annual_ledger': 'Libro Mayor Anual',
            'notifications': 'Notificaciones Push',
            'export': 'Exportar Datos'
        };

        modal.innerHTML = `
            <div class="flex items-center justify-center min-h-screen p-4">
                <div class="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
                    <div class="text-center">
                        <div class="rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4" style="background:rgba(245,179,1,.15);">
                            <i class="fas fa-crown text-2xl" style="color:#F5B301;"></i>
                        </div>

                        <h3 class="text-xl font-semibold text-gray-900 mb-2">
                            Función Premium
                        </h3>

                        <p class="text-gray-600 mb-4">
                            <strong>${featureNames[feature] || feature}</strong>
                            está disponible solo en el plan Premium.
                        </p>

                        <div class="rounded-lg p-4 mb-6" style="background:rgba(11,42,85,.06);border:1px solid rgba(11,42,85,.18);">
                            <h4 class="font-semibold text-gray-900 mb-2">
                                <i class="fas fa-crown mr-2" style="color:#F5B301;"></i>
                                ¿Por qué Premium?
                            </h4>
                            <ul class="text-sm text-gray-700 space-y-1 text-left">
                                <li>• <strong>Automatización completa</strong> de tus finanzas</li>
                                <li>• <strong>Registro automático</strong> de movimientos desde tus extractos (CSV/Excel)</li>
                                <li>• <strong>Análisis inteligente</strong> con IA</li>
                                <li>• <strong>Exportación</strong> a Excel/PDF</li>
                                <li>• <strong>Notificaciones</strong> personalizadas</li>
                            </ul>
                        </div>
                        
                        <div class="flex space-x-3">
                            <button id="close-feature-modal" class="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-400 transition-colors">
                                Ahora No
                            </button>
                            <button id="unlock-premium" class="flex-1 text-white px-4 py-2 rounded-lg font-medium transition-all" style="background:#0B2A55;" onmouseover="this.style.background='#123A6F'" onmouseout="this.style.background='#0B2A55'">
                                <i class="fas fa-unlock mr-2"></i>
                                Desbloquear (€2/mes)
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Event listeners
        modal.querySelector('#close-feature-modal').addEventListener('click', () => {
            this.closeFeatureModal();
        });

        modal.querySelector('#unlock-premium').addEventListener('click', () => {
            window.location.href = '/pricing.html';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeFeatureModal();
            }
        });

        return modal;
    }

    closeFeatureModal() {
        const modal = document.getElementById('feature-locked-modal');
        if (modal) {
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
            }, 300);
        }
    }

    // ===== UTILIDADES =====

    getPlanLimits(plan = null) {
        const targetPlan = plan || Auth.getUserPlan();
        return this.limits[targetPlan] || this.limits.free;
    }

    getCurrentUsage() {
        const usage = {};
        
        Object.keys(this.accountTypeMapping).forEach(accountType => {
            usage[accountType] = this.getCurrentAccountCount(accountType);
        });

        return usage;
    }

    getUpgradeRecommendation() {
        const currentPlan = Auth.getUserPlan();
        if (currentPlan === 'premium') return null;

        const usage = this.getCurrentUsage();
        const limits = this.getPlanLimits('free');
        
        const nearLimit = Object.keys(usage).filter(accountType => {
            const limitKey = this.accountTypeMapping[accountType];
            const currentCount = usage[accountType];
            const maxAllowed = limits[limitKey];
            
            return currentCount >= maxAllowed * 0.8; // 80% del límite
        });

        if (nearLimit.length > 0) {
            return {
                shouldRecommend: true,
                reason: 'near_limits',
                accountTypes: nearLimit,
                message: 'Te acercas a los límites de tu plan FREE'
            };
        }

        return null;
    }

    showSuccessMessage(message) {
        // Implementar sistema de notificaciones
        console.log('SUCCESS:', message);
        
        // Crear toast temporal
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 opacity-0 transition-opacity duration-300';
        toast.innerHTML = `
            <div class="flex items-center">
                <i class="fas fa-check-circle mr-3"></i>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.classList.remove('opacity-0');
            toast.classList.add('opacity-100');
        });
        
        setTimeout(() => {
            toast.classList.add('opacity-0');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    showErrorMessage(message) {
        // Implementar sistema de notificaciones de error
        console.error('ERROR:', message);
        
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 opacity-0 transition-opacity duration-300';
        toast.innerHTML = `
            <div class="flex items-center">
                <i class="fas fa-exclamation-circle mr-3"></i>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.classList.remove('opacity-0');
            toast.classList.add('opacity-100');
        });
        
        setTimeout(() => {
            toast.classList.add('opacity-0');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
}

// Instancia global
const PlanLimits = new PlanLimitsManager();

export default PlanLimits;