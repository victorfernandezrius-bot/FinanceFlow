// data-client.js — capa única de acceso a datos
// Hoy: localStorage. Mañana (Fase 2): fetch al Worker de Cloudflare.
//
// API CANÓNICA (única): list / save / delete por entidad.
// Keys de localStorage unificadas (legacy `user_*` para no perder datos previos).

const MODE = window.DATA_MODE || 'local'; // 'local' | 'remote'

// Claves canónicas de localStorage (NO cambiar: usuarios existentes dependen de ellas)
const KEYS = {
    users:        'registered_users',
    token:        'financeflow_token',
    currentUser:  'currentUser',
    accounts:     (u) => `user_accounts_${u}`,
    movements:    (u) => `user_movements_${u}`,
    rules:        (u) => `categorize_rules_${u}`,
    autoPlan:     (u) => `autocontrol_plan_${u}`,
    autoAssoc:    (u) => `autocontrol_associations_${u}`,
    scenarios:    (u) => `user_scenarios_${u}`,
    bankConns:    (u) => `bank_connections_${u}`,
    premiumTrial: (u) => `premium_trial_${u}`,
    importInfo:   (u, b) => `import_info_${u}_${b}`,
    notifications:(u) => `notifications_${u}`,
};

// Helpers localStorage
const lsGet  = (k, def = null) => {
    const v = localStorage.getItem(k);
    if (v === null) return def;
    try { return JSON.parse(v); } catch { return v; }
};
const lsSet  = (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
const lsDel  = (k) => localStorage.removeItem(k);

// Token JWT en memoria + localStorage (se setea en login/register)
let _authToken = (typeof localStorage !== 'undefined' && localStorage.getItem('financeflow_token')) || null;
function setAuthToken(t) {
    _authToken = t;
    if (typeof localStorage !== 'undefined') {
        if (t) localStorage.setItem('financeflow_token', t);
        else localStorage.removeItem('financeflow_token');
    }
}
// fetch con Authorization automático
async function authFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    // Si no hay token en memoria, intentar recuperarlo de localStorage (a prueba de fallos)
    let token = _authToken;
    if (!token && typeof localStorage !== 'undefined') {
        token = localStorage.getItem('financeflow_token');
        if (token) _authToken = token;
    }
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...options, headers, credentials: 'include' });
}

const DataClient = {
    setAuthToken,
    getAuthToken() { return _authToken; },

    // ===== USERS =====
    async getUser(userId) {
        if (MODE === 'local') {
            const users = lsGet(KEYS.users, []);
            return users.find(u => u.id === userId) || null;
        }
        const r = await authFetch(`${window.API_URL}/users/${userId}`);
        return r.ok ? r.json() : null;
    },

    async saveUser(user) {
        if (MODE === 'local') {
            const users = lsGet(KEYS.users, []);
            const i = users.findIndex(u => u.id === user.id);
            if (i >= 0) users[i] = user; else users.push(user);
            lsSet(KEYS.users, users);
            return user;
        }
        const r = await authFetch(`${window.API_URL}/users/${user.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        return r.ok ? r.json() : null;
    },

    async deleteUser(userId) {
        if (MODE === 'local') {
            const users = lsGet(KEYS.users, []).filter(u => u.id !== userId);
            lsSet(KEYS.users, users);
            return true;
        }
        const r = await authFetch(`${window.API_URL}/users/${userId}`, {
            method: 'DELETE'
        });
        return r.ok;
    },

    async listUsers() {
        if (MODE === 'local') return lsGet(KEYS.users, []);
        const r = await authFetch(`${window.API_URL}/users`);
        return r.ok ? r.json() : [];
    },

    // Alias retrocompatible (auth.js antiguo llamaba a getAllUsers)
    async getAllUsers() {
        return this.listUsers();
    },

    // ===== SESSION =====
    async getSession() {
        // La sesión vive en localStorage en ambos modos (el token se envía
        // al Worker en cada petición vía authFetch).
        return {
            token: lsGet(KEYS.token),
            currentUser: lsGet(KEYS.currentUser)
        };
    },

    async saveSession(session) {
        // En AMBOS modos guardamos la sesión en localStorage, porque el
        // frontend (dashboard, etc.) la lee de ahí para mantener al usuario logueado.
        const user = session.currentUser || session.user || null;
        if (session.token) {
            lsSet(KEYS.token, session.token);
            setAuthToken(session.token);
        }
        if (user) lsSet(KEYS.currentUser, user);
        return session;
    },

    async clearSession() {
        // Borrar siempre la sesión local
        lsDel(KEYS.token);
        lsDel(KEYS.currentUser);
        setAuthToken(null);
        // En remoto, además notificar al Worker (sin bloquear si falla)
        if (MODE === 'remote') {
            try { await authFetch(`${window.API_URL}/auth/logout`, { method: 'POST' }); } catch (e) {}
        }
        return true;
    },

    // ===== ACCOUNTS =====
    async listAccounts(userId) {
        if (MODE === 'local') return lsGet(KEYS.accounts(userId), []);
        const r = await authFetch(`${window.API_URL}/accounts?userId=${userId}`);
        return r.ok ? r.json() : [];
    },

    async saveAccount(userId, account) {
        if (MODE === 'local') {
            const accounts = lsGet(KEYS.accounts(userId), []);
            const i = accounts.findIndex(a => a.id === account.id);
            if (i >= 0) accounts[i] = account; else accounts.push(account);
            lsSet(KEYS.accounts(userId), accounts);
            return account;
        }
        const r = await authFetch(`${window.API_URL}/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...account, userId })
        });
        return r.ok ? r.json() : null;
    },

    async deleteAccount(userId, accountId) {
        if (MODE === 'local') {
            const accounts = lsGet(KEYS.accounts(userId), []).filter(a => a.id !== accountId);
            lsSet(KEYS.accounts(userId), accounts);
            return true;
        }
        const r = await authFetch(`${window.API_URL}/accounts/${accountId}?userId=${userId}`, {
            method: 'DELETE'
        });
        return r.ok;
    },

    // ===== MOVEMENTS =====
    async listMovements(userId, filters = {}) {
        if (MODE === 'local') {
            let movements = lsGet(KEYS.movements(userId), []);
            if (filters.dateFrom) movements = movements.filter(m => new Date(m.fecha) >= new Date(filters.dateFrom));
            if (filters.dateTo)   movements = movements.filter(m => new Date(m.fecha) <= new Date(filters.dateTo));
            if (filters.accountId) movements = movements.filter(m =>
                m.cuenta_id === filters.accountId || m.cuenta_destino_id === filters.accountId);
            return movements;
        }
        const params = new URLSearchParams({ userId, ...filters });
        const r = await authFetch(`${window.API_URL}/movements?${params}`);
        return r.ok ? r.json() : [];
    },

    async saveMovement(userId, movement) {
        if (MODE === 'local') {
            const movements = lsGet(KEYS.movements(userId), []);
            const i = movements.findIndex(m => m.id === movement.id);
            if (i >= 0) movements[i] = movement; else movements.push(movement);
            lsSet(KEYS.movements(userId), movements);
            return movement;
        }
        const r = await authFetch(`${window.API_URL}/movements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...movement, userId })
        });
        return r.ok ? r.json() : null;
    },

    async deleteMovement(userId, movementId) {
        if (MODE === 'local') {
            const movements = lsGet(KEYS.movements(userId), []).filter(m => m.id !== movementId);
            lsSet(KEYS.movements(userId), movements);
            return true;
        }
        const r = await authFetch(`${window.API_URL}/movements/${movementId}?userId=${userId}`, {
            method: 'DELETE'
        });
        return r.ok;
    },

    // ===== CATEGORIZATION RULES =====
    async listRules(userId) {
        if (MODE === 'local') return lsGet(KEYS.rules(userId), []);
        const r = await authFetch(`${window.API_URL}/rules?userId=${userId}`);
        return r.ok ? r.json() : [];
    },

    async saveRule(userId, rule) {
        if (MODE === 'local') {
            const rules = lsGet(KEYS.rules(userId), []);
            const i = rules.findIndex(r => r.id === rule.id);
            if (i >= 0) rules[i] = rule; else rules.push(rule);
            lsSet(KEYS.rules(userId), rules);
            return rule;
        }
        const r = await authFetch(`${window.API_URL}/rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...rule, userId })
        });
        return r.ok ? r.json() : null;
    },

    // Guardado masivo de reglas (el AccountingManager guarda el set completo)
    async saveRules(userId, rules) {
        if (MODE === 'local') {
            lsSet(KEYS.rules(userId), rules);
            return rules;
        }
        const r = await authFetch(`${window.API_URL}/rules/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rules, userId })
        });
        return r.ok ? r.json() : null;
    },

    async deleteRule(userId, ruleId) {
        if (MODE === 'local') {
            const rules = lsGet(KEYS.rules(userId), []).filter(r => r.id !== ruleId);
            lsSet(KEYS.rules(userId), rules);
            return true;
        }
        const r = await authFetch(`${window.API_URL}/rules/${ruleId}?userId=${userId}`, {
            method: 'DELETE'
        });
        return r.ok;
    },

    // ===== AUTOCONTROL PLAN =====
    async getAutocontrolPlan(userId) {
        if (MODE === 'local') return lsGet(KEYS.autoPlan(userId));
        const r = await authFetch(`${window.API_URL}/autocontrol-plan?userId=${userId}`);
        return r.ok ? r.json() : null;
    },

    async saveAutocontrolPlan(userId, plan) {
        if (MODE === 'local') { lsSet(KEYS.autoPlan(userId), plan); return plan; }
        const r = await authFetch(`${window.API_URL}/autocontrol-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...plan, userId })
        });
        return r.ok ? r.json() : null;
    },

    // ===== AUTOCONTROL ASSOCIATIONS =====
    async getAutocontrolAssociations(userId) {
        if (MODE === 'local') return lsGet(KEYS.autoAssoc(userId));
        const r = await authFetch(`${window.API_URL}/autocontrol-associations?userId=${userId}`);
        return r.ok ? r.json() : null;
    },

    async saveAutocontrolAssociations(userId, associations) {
        if (MODE === 'local') { lsSet(KEYS.autoAssoc(userId), associations); return associations; }
        const r = await authFetch(`${window.API_URL}/autocontrol-associations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...associations, userId })
        });
        return r.ok ? r.json() : null;
    },

    // ===== SCENARIOS =====
    async getScenarios(userId) {
        if (MODE === 'local') return lsGet(KEYS.scenarios(userId), []);
        const r = await authFetch(`${window.API_URL}/scenarios?userId=${userId}`);
        return r.ok ? r.json() : [];
    },

    async saveScenarios(userId, scenarios) {
        if (MODE === 'local') { lsSet(KEYS.scenarios(userId), scenarios); return scenarios; }
        const r = await authFetch(`${window.API_URL}/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarios, userId })
        });
        return r.ok ? r.json() : null;
    },

    // ===== BANK CONNECTIONS (preparado para GoCardless) =====
    async listBankConnections(userId) {
        if (MODE === 'local') return lsGet(KEYS.bankConns(userId), []);
        const r = await authFetch(`${window.API_URL}/bank-connections?userId=${userId}`);
        return r.ok ? r.json() : [];
    },

    async saveBankConnection(userId, connection) {
        if (MODE === 'local') {
            const conns = lsGet(KEYS.bankConns(userId), []);
            const i = conns.findIndex(c => c.id === connection.id);
            if (i >= 0) conns[i] = connection; else conns.push(connection);
            lsSet(KEYS.bankConns(userId), conns);
            return connection;
        }
        const r = await authFetch(`${window.API_URL}/bank-connections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...connection, userId })
        });
        return r.ok ? r.json() : null;
    },

    async deleteBankConnection(userId, connectionId) {
        if (MODE === 'local') {
            const conns = lsGet(KEYS.bankConns(userId), []).filter(c => c.id !== connectionId);
            lsSet(KEYS.bankConns(userId), conns);
            return true;
        }
        const r = await authFetch(`${window.API_URL}/bank-connections/${connectionId}?userId=${userId}`, {
            method: 'DELETE'
        });
        return r.ok;
    },

    // ===== PREMIUM TRIAL =====
    async getPremiumTrial(userId) {
        if (MODE === 'local') return lsGet(KEYS.premiumTrial(userId));
        const r = await authFetch(`${window.API_URL}/premium-trial?userId=${userId}`);
        return r.ok ? (await r.json())?.expiry ?? null : null;
    },

    async savePremiumTrial(userId, expiry) {
        if (MODE === 'local') { lsSet(KEYS.premiumTrial(userId), expiry); return true; }
        const r = await authFetch(`${window.API_URL}/premium-trial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, expiry })
        });
        return r.ok;
    },

    // ===== IMPORT INFO (simulador bancario / GoCardless) =====
    async getImportInfo(userId, bankCode) {
        if (MODE === 'local') return lsGet(KEYS.importInfo(userId, bankCode));
        const r = await authFetch(`${window.API_URL}/import-info?userId=${userId}&bankCode=${bankCode}`);
        return r.ok ? r.json() : null;
    },

    async saveImportInfo(userId, bankCode, importInfo) {
        if (MODE === 'local') { lsSet(KEYS.importInfo(userId, bankCode), importInfo); return true; }
        const r = await authFetch(`${window.API_URL}/import-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, bankCode, importInfo })
        });
        return r.ok;
    },

    // ===== NOTIFICATIONS =====
    async getNotifications(userId) {
        if (MODE === 'local') return lsGet(KEYS.notifications(userId), []);
        const r = await authFetch(`${window.API_URL}/notifications?userId=${userId}`);
        return r.ok ? r.json() : [];
    },

    async saveNotifications(userId, notifications) {
        if (MODE === 'local') { lsSet(KEYS.notifications(userId), notifications); return true; }
        const r = await authFetch(`${window.API_URL}/notifications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, notifications })
        });
        return r.ok;
    }
};

export default DataClient;
