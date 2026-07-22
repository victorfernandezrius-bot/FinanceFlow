// Sistema de Autenticación Real - FinanceFlow SaaS
// Solo usuarios registrados con planes FREE y PREMIUM

import DataClient from '../src/services/data-client.js';

class AuthSystem {
    constructor() {
        this.currentUser = null;
        this.token = null;
        this._premiumTrialExpiry = null;
        this._accountsCache = [];
        this.init();
    }

    get isRemote() {
        return (typeof window !== 'undefined') && window.DATA_MODE === 'remote';
    }

    async _apiPost(path, body) {
        const r = await fetch(`${window.API_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body)
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Error de servidor');
        return data;
    }

    async init() {
        // Inicializar cuenta demo garantizada
        this._ensureDemoAccount();

        // Verificar si hay sesión válida
        const session = await DataClient.getSession();
        if (session.token) {
            this.token = session.token;
            this.currentUser = session.currentUser;
            if (this.isRemote && typeof DataClient.setAuthToken === 'function') {
                DataClient.setAuthToken(session.token);
            }
            await this.validateSession();
            await this.refreshPremiumTrial();
        }
    }

    async _ensureDemoAccount() {
        if (window.APP_ENV === 'production') return;
        
        const DEMO_EMAIL = 'demo@financeflow.com';
        const DEMO_PASSWORD = 'demo1234';

        const existingUsers = await DataClient.listUsers();
        const idx = existingUsers.findIndex(u => u.email === DEMO_EMAIL);

        if (idx === -1) {
            // No existe: crearla
            const demoUser = {
                id: 'demo-user-financeflow',
                email: DEMO_EMAIL,
                name: 'Usuario Demo',
                plan: 'premium',
                plan_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                created_at: new Date().toISOString(),
                password_hash: btoa(DEMO_PASSWORD)
            };
            await DataClient.saveUser(demoUser);
        } else {
            // Existe pero puede tener el hash mal: corregirlo sin tocar los datos del usuario
            existingUsers[idx].password_hash = btoa(DEMO_PASSWORD);
            existingUsers[idx].plan = 'premium';
            if (!existingUsers[idx].plan_expires_at ||
                new Date(existingUsers[idx].plan_expires_at) < new Date()) {
                existingUsers[idx].plan_expires_at =
                    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
            }
            await DataClient.saveUser(existingUsers[idx]);
        }
    }

    // ===== REGISTRO REAL =====

    async register(userData) {
        try {
            const { email, password, name, plan = 'free' } = userData;

            // Validaciones
            if (!this.validateEmail(email)) {
                throw new Error('Email inválido');
            }

            // --- MODO REMOTO: registrar contra el Worker ---
            if (this.isRemote) {
                const data = await this._apiPost('/auth/register', { email, password, name, plan });
                this.currentUser = data.currentUser;
                this.token = data.token;
                DataClient.setAuthToken(data.token);
                await DataClient.saveSession({ token: data.token, currentUser: data.currentUser });
                await this.refreshPremiumTrial();
                return { success: true, user: this.currentUser, message: 'Registro exitoso' };
            }
            
            if (password.length < 8) {
                throw new Error('La contraseña debe tener al menos 8 caracteres');
            }

            if (!name || name.trim().length === 0) {
                throw new Error('El nombre es requerido');
            }

            // Verificar si el email ya existe
            const existingUsers = await DataClient.listUsers();
            if (existingUsers.find(user => user.email.toLowerCase() === email.toLowerCase())) {
                throw new Error('Este email ya está registrado');
            }

            // Crear nuevo usuario
            const newUser = {
                id: crypto.randomUUID(),
                email: email.toLowerCase().trim(),
                name: name.trim(),
                plan: plan, // 'free' o 'premium'
                plan_expires_at: plan === 'premium' ? 
                    new Date(Date.now() + 30*24*60*60*1000).toISOString() : null,
                created_at: new Date().toISOString(),
                password_hash: btoa(password) // Simulación básica
            };

            // Guardar usuario
            await DataClient.saveUser(newUser);

            // Crear sesión
            this.currentUser = newUser;
            this.token = 'token_' + newUser.id;
            
            await DataClient.saveSession({
                token: this.token,
                currentUser: newUser
            });

            return {
                success: true,
                user: this.currentUser,
                message: 'Registro exitoso'
            };

        } catch (error) {
            console.error('Error en registro:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async loginWithGoogle(googleCredential) {
        try {
            // --- MODO REMOTO: verificación del id_token en el Worker (find-or-create) ---
            if (this.isRemote) {
                const data = await this._apiPost('/auth/google', { credential: googleCredential });
                this.currentUser = data.currentUser;
                this.token = data.token;
                DataClient.setAuthToken(data.token);
                await DataClient.saveSession({ token: data.token, currentUser: data.currentUser });
                try { await this.refreshPremiumTrial(); } catch (e) { /* no bloquear el acceso */ }
                return { success: true, user: this.currentUser, message: 'Acceso con Google exitoso' };
            }

            const payload = JSON.parse(atob(googleCredential.split('.')[1]));
            const googleEmail = payload.email?.toLowerCase().trim();
            const googleName  = payload.name  || googleEmail.split('@')[0];
            const googleSub   = payload.sub;
            const googlePic   = payload.picture || null;

            if (!googleEmail || !googleSub) {
                throw new Error('No se pudo obtener el perfil de Google. Inténtalo de nuevo.');
            }

            const existingUsers = await DataClient.listUsers();

            let user = existingUsers.find(u => u.google_sub === googleSub)
                    || existingUsers.find(u => u.email === googleEmail);

            if (user) {
                user.google_sub    = googleSub;
                user.auth_provider = user.auth_provider || 'google';
                if (googlePic) user.picture = googlePic;
                user.name = user.name || googleName;
                await DataClient.saveUser(user);
            } else {
                user = {
                    id:              crypto.randomUUID(),
                    email:           googleEmail,
                    name:            googleName,
                    picture:         googlePic,
                    plan:            'free',
                    plan_expires_at: null,
                    auth_provider:   'google',
                    google_sub:      googleSub,
                    created_at:      new Date().toISOString()
                };
                await DataClient.saveUser(user);
            }

            this.currentUser = user;
            this.token = 'token_' + user.id;
            await DataClient.saveSession({ userId: user.id, token: this.token, user: user });

            return { success: true, user: this.currentUser, message: 'Acceso con Google exitoso' };

        } catch (error) {
            console.error('Error en login con Google:', error);
            return { success: false, error: error.message || 'Error al iniciar sesión con Google' };
        }
    }

    async registerWithGoogle(googleCredential) {
        try {
            // --- MODO REMOTO: mismo endpoint find-or-create que el login con Google ---
            if (this.isRemote) {
                const data = await this._apiPost('/auth/google', { credential: googleCredential });
                this.currentUser = data.currentUser;
                this.token = data.token;
                DataClient.setAuthToken(data.token);
                await DataClient.saveSession({ token: data.token, currentUser: data.currentUser });
                try { await this.refreshPremiumTrial(); } catch (e) { /* no bloquear el registro */ }
                return { success: true, user: this.currentUser, message: 'Registro con Google exitoso' };
            }

            const payload = JSON.parse(atob(googleCredential.split('.')[1]));
            const googleEmail = payload.email;
            const googleName = payload.name;
            const googlePic = payload.picture;
            const googleSub = payload.sub;

            const existingUsers = await DataClient.listUsers();
            
            // Verificar si ya existe
            let user = existingUsers.find(u => u.email === googleEmail);
            if (user) {
                return { success: false, error: 'Ya existe una cuenta con este email' };
            }

            // Crear nuevo usuario
            user = {
                id:              crypto.randomUUID(),
                email:           googleEmail,
                name:            googleName,
                picture:         googlePic,
                plan:            'free',
                plan_expires_at: null,
                auth_provider:   'google',
                google_sub:      googleSub,
                created_at:      new Date().toISOString()
            };
            await DataClient.saveUser(user);

            this.currentUser = user;
            this.token = 'token_' + user.id;
            await DataClient.saveSession({ userId: user.id, token: this.token, user: user });

            return { success: true, user: this.currentUser, message: 'Registro con Google exitoso' };

        } catch (error) {
            console.error('Error en registro con Google:', error);
            return { success: false, error: error.message || 'Error al registrarse con Google' };
        }
    }

    async login(email, password) {
        try {
            if (!email || !password) {
                throw new Error('Email y contraseña son requeridos');
            }

            // --- MODO REMOTO: login contra el Worker ---
            if (this.isRemote) {
                const data = await this._apiPost('/auth/login', { email, password });
                this.currentUser = data.currentUser;
                this.token = data.token;
                DataClient.setAuthToken(data.token);
                await DataClient.saveSession({ token: data.token, currentUser: data.currentUser });
                await this.refreshPremiumTrial();
                return { success: true, user: this.currentUser, message: 'Login exitoso' };
            }

            // Buscar usuario registrado
            const existingUsers = await DataClient.listUsers();
            const user = existingUsers.find(u => 
                u.email.toLowerCase() === email.toLowerCase() && 
                u.password_hash === btoa(password)
            );

            if (!user) {
                throw new Error('Credenciales inválidas');
            }

            // Crear sesión
            this.currentUser = user;
            this.token = 'token_' + user.id;

            await DataClient.saveSession({
                token: this.token,
                currentUser: this.currentUser
            });

            return {
                success: true,
                user: this.currentUser,
                message: 'Login exitoso'
            };

        } catch (error) {
            console.error('Error en login:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async validateSession() {
        try {
            // Verificar usuario actual
            const storedSession = await DataClient.getSession();
            if (storedSession.currentUser && this.token) {
                this.currentUser = storedSession.currentUser;
                
                // Verificar expiración de plan premium
                if (this.currentUser.plan === 'premium' && this.currentUser.plan_expires_at) {
                    const expiry = new Date(this.currentUser.plan_expires_at);
                    if (expiry < new Date()) {
                        // Plan expirado, downgrade a FREE
                        this.currentUser.plan = 'free';
                        this.currentUser.plan_expires_at = null;
                        await DataClient.saveSession({ userId: this.currentUser.id, token: this.token, user: this.currentUser });
                    }
                }
                
                return { success: true, user: this.currentUser };
            }

            return { success: false, error: 'No hay sesión válida' };

        } catch (error) {
            console.error('Error validando sesión:', error);
            return { success: false, error: error.message };
        }
    }

    async logout() {
        this.token = null;
        this.currentUser = null;
        if (typeof DataClient.setAuthToken === 'function') DataClient.setAuthToken(null);
        await DataClient.clearSession();
        return { success: true };
    }

    // ===== PLAN UPGRADE =====

    async upgradeToPremium() {
        if (!this.currentUser) {
            throw new Error('No hay usuario autenticado');
        }

        try {
            // Actualizar plan local (en producción sería a través de Stripe)
            this.currentUser.plan = 'premium';
            this.currentUser.plan_expires_at = new Date(Date.now() + 30*24*60*60*1000).toISOString();
            
            // Actualizar en localStorage
            await DataClient.saveSession({ userId: this.currentUser.id, token: this.token, user: this.currentUser });
            
            // Actualizar en registro de usuarios (DataClient ya hace upsert)
            await DataClient.saveUser(this.currentUser);

            return {
                success: true,
                user: this.currentUser,
                message: 'Upgrade a Premium exitoso'
            };

        } catch (error) {
            console.error('Error en upgrade:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ===== UTILIDADES =====

    isAuthenticated() {
        return !!(this.currentUser);
    }

    getCurrentUser() {
        return this.currentUser;
    }

    getUserPlan() {
        // Verificar si tiene prueba premium activa
        if (this.hasPremiumTrial()) {
            return 'premium';
        }
        return this.currentUser?.plan || 'free';
    }

    isPremium() {
        return this.getUserPlan() === 'premium';
    }

    // ===== PRUEBA PREMIUM =====

    async startPremiumTrial() {
        // Las pruebas premium gratuitas ya no están disponibles (se retiró el flujo de trial).
        return { success: false, error: 'Las pruebas gratuitas ya no están disponibles' };
    }

    // Refresca la caché del trial premium (llamar tras login / init)
    async refreshPremiumTrial() {
        if (!this.currentUser) { this._premiumTrialExpiry = null; return; }
        try {
            this._premiumTrialExpiry = await DataClient.getPremiumTrial(this.currentUser.id);
        } catch (e) {
            console.error('Error obteniendo premium trial (no crítico):', e);
            this._premiumTrialExpiry = null;
        }
    }

    hasPremiumTrial() {
        if (!this.currentUser || !this._premiumTrialExpiry) return false;
        return new Date(this._premiumTrialExpiry) > new Date();
    }

    getPremiumTrialInfo() {
        if (!this.hasPremiumTrial()) return null;
        const expiryDate = new Date(this._premiumTrialExpiry);
        const now = new Date();
        const daysLeft = Math.ceil((expiryDate - now) / (1000*60*60*24));
        return {
            expires_at: this._premiumTrialExpiry,
            days_left: daysLeft
        };
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    requireAuth() {
        if (!this.isAuthenticated()) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    }

    showUpgradePrompt() {
        // Solo mostrar upgrade a premium para usuarios registrados
        if (this.isAuthenticated() && !this.isPremium()) {
            window.location.href = '/pricing.html';
        } else if (!this.isAuthenticated()) {
            window.location.href = '/register.html';
        }
    }

    // ===== LÍMITES DEL PLAN =====

    getPlanLimits() {
        const plan = this.getUserPlan();
        
        if (plan === 'premium') {
            return {
                max_activo_accounts: 10,
                max_income_accounts: 8,
                max_expense_accounts: 15,
                max_pasivo_accounts: 10,
                max_patrimonio_accounts: 3,
                features: [
                    'manual_entry', 'basic_dashboard', 'daily_ledger', 'monthly_ledger',
                    'bank_connection', 'automation', 'autocontrol', 'annual_ledger', 
                    'notifications', 'export'
                ]
            };
        } else {
            // Plan FREE
            return {
                max_activo_accounts: 1,
                max_income_accounts: 2,
                max_expense_accounts: 8,
                max_pasivo_accounts: 2,
                max_patrimonio_accounts: 1,
                features: ['manual_entry', 'basic_dashboard', 'daily_ledger', 'monthly_ledger']
            };
        }
    }

    // El AccountingManager mantiene esta caché actualizada vía setAccountsCache()
    setAccountsCache(accounts) {
        this._accountsCache = Array.isArray(accounts) ? accounts : [];
    }

    canCreateAccount(accountType) {
        const limits = this.getPlanLimits();
        const accounts = this._accountsCache || [];

        // Mapear tipos a límites (debe coincidir con plan-limits.js)
        const typeMap = {
            'activo': 'max_activo_accounts',
            'ingreso': 'max_income_accounts', 
            'gasto': 'max_expense_accounts',
            'pasivo': 'max_pasivo_accounts',
            'patrimonio': 'max_patrimonio_accounts'
        };
        
        const limitKey = typeMap[accountType];
        if (!limitKey) return false;
        
        const currentCount = accounts.filter(acc => acc.tipo === accountType).length;
        return currentCount < limits[limitKey];
    }

    hasFeature(feature) {
        const limits = this.getPlanLimits();
        return limits.features.includes(feature);
    }
}

// Instancia global
const Auth = new AuthSystem();

export default Auth;
