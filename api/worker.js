// ============================================================
// FinanceFlow / Contabilidad Personal — Cloudflare Worker API
// ------------------------------------------------------------
// Endpoints:
//   Auth:      POST /api/auth/register, /api/auth/login, /api/auth/logout
//              GET  /api/auth/session
//   Users:     GET/PUT/DELETE /api/users/:id, GET /api/users
//   Accounts:  GET/POST /api/accounts, DELETE /api/accounts/:id
//   Movements: GET/POST /api/movements, DELETE /api/movements/:id
//   Rules:     GET/POST /api/rules, POST /api/rules/bulk, DELETE /api/rules/:id
//   Autocontrol, scenarios, notifications, bank-connections, import-info
//   Stripe:    POST /api/stripe/create-checkout, POST /api/stripe/webhook,
//              POST /api/stripe/verify-session, POST /api/stripe/customer-portal
//   GoCardless:POST /api/banking/institutions, /api/banking/requisition,
//              GET /api/banking/accounts, POST /api/banking/sync
//
// Bindings (wrangler.toml): DB (D1), CACHE (KV)
// Secrets: JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//          GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY
// ============================================================

import { buildPushPayload } from '@block65/webcrypto-web-push';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} from '@simplewebauthn/server';

// Cabeceras de seguridad de todas las respuestas JSON de la API. no-store: son
// datos personales y financieros, que no deben quedarse en cachés intermedias.
const API_SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
};

const json = (data, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...API_SECURITY_HEADERS, ...extraHeaders }
    });

function corsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.APP_URL || '').replace(/\/$/, '');
    const allowOrigin = origin && (origin === allowed || origin.endsWith('.contabilidadpersonal.com'))
        ? origin : allowed;
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        // El cliente necesita leer el token renovado (ver issueToken / authenticate)
        'Access-Control-Expose-Headers': 'X-Refresh-Token'
    };
}

// ---------- JWT mínimo (HS256) ----------
async function signJWT(payload, secret) {
    const enc = new TextEncoder();
    const header = { alg: 'HS256', typ: 'JWT' };
    const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const data = `${b64(header)}.${b64(payload)}`;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, '-').replace(/\//g, '_');
    return `${data}.${b64sig}`;
}

async function verifyJWT(token, secret) {
    try {
        const enc = new TextEncoder();
        const [h, p, s] = token.split('.');
        const data = `${h}.${p}`;
        const key = await crypto.subtle.importKey('raw', enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const sigBytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
        if (!ok) return null;
        const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && Date.now() / 1000 > payload.exp) return null;
        return payload;
    } catch { return null; }
}

// ---------- Hash de contraseña (PBKDF2) ----------
async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    salt = salt || crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password),
        { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial, 256);
    const hashArr = new Uint8Array(bits);
    const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
    const hashHex = [...hashArr].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${saltHex}:${hashHex}`;
}

// Comparación en tiempo constante (evita timing attacks). Para cadenas de la
// misma longitud fija (hashes hex, firmas HMAC hex); la longitud no es secreta.
function timingSafeEqual(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function verifyPassword(password, stored) {
    const [saltHex] = stored.split(':');
    const salt = Uint8Array.from(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const recomputed = await hashPassword(password, salt);
    return timingSafeEqual(recomputed, stored);
}

// ---------- WebAuthn / Passkeys (Face ID / Touch ID) ----------
// base64url <-> bytes para guardar/leer la clave pública de la credencial.
function bufToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlToBuf(s) {
    const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
// rpID = dominio de APP_URL sin protocolo; expectedOrigin = APP_URL sin barra final.
function webauthnConfig(env) {
    let rpID = 'localhost';
    try { rpID = new URL(env.APP_URL).hostname; } catch (_) {}
    return { rpName: 'FinanceFlow', rpID, expectedOrigin: (env.APP_URL || '').replace(/\/$/, '') };
}

// ---------- Respuestas con columnas explícitas ----------
// Nunca SELECT * hacia el cliente: así una columna nueva (o interna) no se expone
// por accidente. Las listas son las columnas que escribe este Worker.
const PUBLIC_USER_FIELDS = ['id', 'email', 'name', 'picture', 'auth_provider', 'plan', 'plan_expires_at',
    'currency', 'created_at', 'updated_at'];
function publicUser(u) {
    const out = {};
    for (const k of PUBLIC_USER_FIELDS) if (u && u[k] !== undefined) out[k] = u[k];
    return out;
}
const ACCOUNT_COLUMNS = 'id, user_id, nombre, tipo, descripcion, saldo_inicial, saldo_actual, is_fixed_cost, ' +
    'fixed_monthly_amount, fixed_due_day, is_bank_account, auto_created_by_rule, created_at, updated_at';
const MOVEMENT_COLUMNS = 'id, user_id, tipo, cantidad, descripcion, fecha, cuenta_id, cuenta_destino_id, categoria, ' +
    'origen, auto_categorized, applied_rule, rule_name, manually_categorized, bank_reference, created_at, updated_at';
const NOTIFICATION_COLUMNS = 'id, user_id, type, title, message, data, read, created_at';
const BANK_CONNECTION_COLUMNS = 'id, user_id, bank_code, bank_name, institution_id, requisition_id, ' +
    'gocardless_account_id, linked_account_id, status, is_active, last_sync_at, created_at';
const IMPORT_INFO_COLUMNS = 'user_id, bank_code, last_import_at, last_import_count, total_imported';

// ---------- Sesiones ----------
// JWT HS256 con jti, iat y caducidad de 7 días que se renueva sola mientras se usa:
// si el token tiene más de un día, la respuesta lleva uno nuevo en X-Refresh-Token y
// authFetch (data-client.js) lo guarda. Los tokens antiguos (30 días, sin jti) siguen
// valiendo hasta su caducidad y la renovación nunca acorta la vida de un token.
const SESSION_TTL = 7 * 86400;
const SESSION_REFRESH_AFTER = 86400;
async function issueToken(env, user, minExp = 0) {
    const now = Math.floor(Date.now() / 1000);
    return signJWT({ sub: user.id, iat: now, jti: crypto.randomUUID(), tv: Number(user.token_version) || 0,
        exp: Math.max(now + SESSION_TTL, minExp) }, env.JWT_SECRET);
}
const needsRefresh = (payload) =>
    !payload.jti || !payload.iat || Date.now() / 1000 - payload.iat > SESSION_REFRESH_AFTER;

// Revocación (logout): KV `revoked:<id>` hasta la caducidad del token. El id es el jti
// o, en los tokens antiguos sin jti, el SHA-256 del token. Fail-open si KV falla.
async function revocationId(payload, token) {
    if (payload.jti) return payload.jti;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function isRevoked(env, payload, token) {
    try { return !!(await env.CACHE.get('revoked:' + await revocationId(payload, token))); }
    catch (e) { console.error('isRevoked:', e); return false; }
}
async function revokeToken(env, payload, token) {
    const ttl = Math.max(60, Math.ceil((payload.exp || 0) - Date.now() / 1000));
    await env.CACHE.put('revoked:' + await revocationId(payload, token), '1', { expirationTtl: ttl });
}

// Devuelve { user, payload, token } si el Bearer token es válido y no está revocado, o null.
async function authenticate(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return null;
    if (await isRevoked(env, payload, token)) return null;
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first();
    if (!user) return null;
    // Cambio/restablecimiento de contraseña: los tokens con tv anterior ya no valen.
    // Sin la columna (migración 0001 sin aplicar) no se comprueba.
    if (typeof user.token_version === 'number' && (Number(payload.tv) || 0) < user.token_version) return null;
    return { user, payload, token };
}

// Invalida todas las sesiones del usuario (incrementa token_version). Si la migración
// 0001 no está aplicada, no hace nada (solo lo registra) para no romper el cambio de clave.
async function bumpTokenVersion(env, userId) {
    try {
        await env.DB.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id=?')
            .bind(userId).run();
    } catch (e) {
        console.error('bumpTokenVersion (¿migración 0001 aplicada?):', e && e.message);
    }
}

async function getAuthUser(request, env) {
    const auth = await authenticate(request, env);
    return auth ? auth.user : null;
}

// IP del cliente para las claves de rate limit. IPv6 se agrupa por /64: un cliente suele
// tener un /64 entero y, contando cada dirección por separado, tendría intentos casi
// ilimitados. IPv4 (y IPv6 con IPv4 incrustada) se usa tal cual.
function rateLimitIp(request) {
    const ip = (request.headers.get('CF-Connecting-IP') || 'unknown').toLowerCase();
    if (!ip.includes(':')) return ip;
    if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
    const [head, tail] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
    return groups.slice(0, 4).map(g => parseInt(g || '0', 16).toString(16)).join(':') + '::/64';
}

// Rate limit sencillo con KV (env.CACHE). Devuelve true si se SUPERA el límite.
// Ventana deslizante (el TTL se renueva en cada intento). No es transaccional
// (posible sub-conteo con alta concurrencia), suficiente para frenar abuso.
async function rateLimited(env, key, max, ttlSeconds) {
    try {
        const current = parseInt(await env.CACHE.get(key), 10) || 0;
        if (current >= max) return true;
        await env.CACHE.put(key, String(current + 1), { expirationTtl: ttlSeconds });
        return false;
    } catch (e) {
        // Si el KV falla, no bloqueamos el servicio (fail-open en disponibilidad)
        console.error('rateLimited:', e);
        return false;
    }
}

// ---------- Validación de entrada ----------
// Comprobaciones de tipo, longitud, enum y rango para todo lo que escribe el cliente.
// Los importes aceptan número o string numérico (como hasta ahora los guardaba D1).
const MAX_BODY_BYTES = 1000000;
const MAX_AMOUNT = 1e12;
const ACCOUNT_TYPES = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'];
const MOVEMENT_TYPES = ['ingreso', 'gasto', 'transferencia'];
const isNil = (x) => x === undefined || x === null;
const V = {
    str: (x, max, min = 0) => typeof x === 'string' && x.length >= min && x.length <= max,
    optStr: (x, max) => isNil(x) || (typeof x === 'string' && x.length <= max),
    amount: (x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '')) &&
        Number.isFinite(Number(x)) && Math.abs(Number(x)) <= MAX_AMOUNT,
    optAmount: (x) => isNil(x) || V.amount(x),
    id: (x) => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(x),
    optId: (x) => isNil(x) || V.id(x),
    // YYYY-MM-DD, opcionalmente con hora ISO (2026-10-20T21:07:34.694Z): nada más detrás
    date: (x) => typeof x === 'string' && x.length <= 40 &&
        /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(x),
    optDate: (x) => isNil(x) || V.date(x),
    email: (x) => typeof x === 'string' && x.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x),
    obj: (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
    // JSON libre (plan de autocontrol, escenarios…): objeto y tamaño acotado
    blob: (x, max) => V.obj(x) && JSON.stringify(x).length <= max,
    dueDay: (x) => isNil(x) || (Number.isInteger(Number(x)) && Number(x) >= 1 && Number(x) <= 31),
};
const invalid = (campo, cors) => json({ error: `Datos inválidos: ${campo}` }, 400, cors);

// ---------- Plan Premium y límites (fuente de verdad: D1) ----------
// Igual que Auth.isPremium() en el cliente (js/auth.js): plan de pago o prueba antigua aún vigente.
const isPremiumUser = (u) => !!u && (u.plan === 'premium' ||
    (!!u.premium_trial_expires_at && new Date(u.premium_trial_expires_at) > new Date()));
const premiumRequired = (que, cors) => json({ error: `${que} requiere el plan Premium` }, 403, cors);
// Cuentas por tipo y plan: los mismos números que getPlanLimits() en js/auth.js (si cambian
// allí, cambiarlos aquí). Solo se aplican al crear una cuenta nueva, no al editarla: quien ya
// los supera (p. ej. al dejar Premium) conserva sus cuentas.
const ACCOUNT_LIMITS = {
    free:    { activo: 1,  ingreso: 2, gasto: 8,  pasivo: 2,  patrimonio: 1 },
    premium: { activo: 10, ingreso: 8, gasto: 25, pasivo: 10, patrimonio: 3 }
};
// Endpoint de Web Push: https y nombre de host (los servicios reales son FCM, Mozilla,
// Apple y WNS); se rechazan IPs literales y localhost para no usar el Worker como proxy.
function isPushEndpoint(u) {
    if (!V.str(u, 2048)) return false;
    try {
        const { protocol, hostname } = new URL(u);
        return protocol === 'https:' && hostname.includes('.') && !/^[\d.]+$/.test(hostname) &&
            !hostname.startsWith('[') && hostname !== 'localhost' && !hostname.endsWith('.localhost');
    } catch { return false; }
}
const validRule = (r) => V.obj(r) && V.id(r.id) && V.str(r.name, 120) &&
    (isNil(r.keywords) || (Array.isArray(r.keywords) && r.keywords.length <= 100 && r.keywords.every(k => V.str(k, 100)))) &&
    (isNil(r.accountType) || ACCOUNT_TYPES.includes(r.accountType)) &&
    V.optId(r.accountId) && V.optStr(r.accountName, 120) && V.optDate(r.createdAt);

// ---------- Registro de auditoría (eventos sensibles) ----------
// Tabla audit_log (migración 0002). Nunca bloquea ni rompe la petición: si la tabla
// no existe o falla la escritura, solo queda en el log del Worker.
async function audit(env, request, event, userId, detail) {
    try {
        await env.DB.prepare(
            'INSERT INTO audit_log (id, user_id, event, ip, user_agent, detail, created_at) VALUES (?,?,?,?,?,?,?)')
            .bind(crypto.randomUUID(), userId || null, event,
                request ? (request.headers.get('CF-Connecting-IP') || null) : null,
                request ? ((request.headers.get('User-Agent') || '').slice(0, 200) || null) : null,
                detail ? JSON.stringify(detail).slice(0, 1000) : null, new Date().toISOString()).run();
    } catch (e) {
        console.error('audit (¿migración 0002 aplicada?):', event, e && e.message);
    }
}

// ---------- Cloudflare Turnstile (anti-bots) ----------
// Solo se exige si existe el secreto TURNSTILE_SECRET_KEY (wrangler secret put):
// sin él no cambia nada, para poder desplegar antes de crear el widget.
async function turnstileOk(env, token, ip) {
    if (!env.TURNSTILE_SECRET_KEY) return true;
    if (typeof token !== 'string' || !token || token.length > 2048) return false;
    try {
        const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
        if (ip) body.append('remoteip', ip);
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
        const data = await r.json();
        if (data.success !== true) console.error('Turnstile rechazado:', JSON.stringify(data['error-codes'] || []));
        return data.success === true;
    } catch (e) {
        // Caída del servicio de verificación: no bloquear el acceso (fail-open, como el rate limit)
        console.error('Turnstile siteverify:', e);
        return true;
    }
}
const TURNSTILE_ERROR = { error: 'Completa la verificación anti-bots e inténtalo de nuevo.' };

// Fallos de login por email, además del límite por IP. Dos contadores en KV:
//  - email+IP: desde el 5.º fallo, bloqueo con backoff exponencial (1, 2, 4… min,
//    máx. 60). Solo afecta a esa IP: no sirve para dejar fuera al dueño de la cuenta.
//  - email (cualquier IP): tope de 50 fallos por hora contra ataques distribuidos.
//    No se aplica a las IPs de confianza de ese email (lok:<email>:<ip>, 90 días): las
//    IPs desde las que ya entró con su contraseña o restableció la contraseña. Así un
//    ataque repartido entre muchas IPs no deja fuera al dueño desde su red habitual.
// Un login correcto borra el contador email+IP; un reset de contraseña borra los dos.
// Las IPs son las de rateLimitIp (IPv6 agrupada por /64). Fail-open si KV falla.
const LOGIN_FAILS_BEFORE_BACKOFF = 5;
const LOGIN_EMAIL_MAX_FAILS_PER_HOUR = 50;
const LOGIN_TRUSTED_IP_TTL = 90 * 86400;
async function loginLockState(env, email, ip) {
    try {
        const [pairRaw, totalRaw, trusted] = await Promise.all([
            env.CACHE.get(`lf:${email}:${ip}`), env.CACHE.get(`lf:${email}`), env.CACHE.get(`lok:${email}:${ip}`)]);
        const pair = pairRaw ? JSON.parse(pairRaw) : { n: 0 };
        const total = parseInt(totalRaw, 10) || 0;
        let wait = 0;
        if (pair.until && pair.until > Date.now()) wait = Math.ceil((pair.until - Date.now()) / 1000);
        else if (total >= LOGIN_EMAIL_MAX_FAILS_PER_HOUR && !trusted) wait = 3600;
        return { wait, pair, total, trusted: !!trusted };
    } catch (e) {
        console.error('loginLockState:', e);
        return { wait: 0, pair: { n: 0 }, total: 0, trusted: false };
    }
}
async function trustLoginIp(env, email, ip) {
    try { await env.CACHE.put(`lok:${email}:${ip}`, '1', { expirationTtl: LOGIN_TRUSTED_IP_TTL }); }
    catch (e) { console.error('trustLoginIp:', e); }
}
async function loginFailed(env, email, ip, state) {
    try {
        const pair = { n: (state.pair.n || 0) + 1 };
        if (pair.n >= LOGIN_FAILS_BEFORE_BACKOFF)
            pair.until = Date.now() + Math.min(60, 2 ** (pair.n - LOGIN_FAILS_BEFORE_BACKOFF)) * 60000;
        await env.CACHE.put(`lf:${email}:${ip}`, JSON.stringify(pair), { expirationTtl: 86400 });
        await env.CACHE.put(`lf:${email}`, String(state.total + 1), { expirationTtl: 3600 });
    } catch (e) { console.error('loginFailed:', e); }
}
async function loginSucceeded(env, email, ip, state) {
    if (!state.trusted) await trustLoginIp(env, email, ip);
    if (!state.pair.n) return;
    try { await env.CACHE.delete(`lf:${email}:${ip}`); } catch (e) { console.error('loginSucceeded:', e); }
}
// Restablecer la contraseña demuestra que controla el email: se levanta el bloqueo por
// fallos (también el global) y esa IP pasa a ser de confianza.
async function clearLoginLock(env, email, ip) {
    try {
        await Promise.all([env.CACHE.delete(`lf:${email}`), env.CACHE.delete(`lf:${email}:${ip}`)]);
    } catch (e) { console.error('clearLoginLock:', e); }
    await trustLoginIp(env, email, ip);
}

// ---------- Web Push (VAPID + RFC 8291 vía @block65/webcrypto-web-push) ----------
// subscription: fila de push_subscriptions ({endpoint, p256dh, auth}).
// payload: { title, body, url, tag }. Si la suscripción está muerta (404/410), se borra.
async function sendPush(env, subscription, payload) {
    let host = subscription.endpoint;
    try { host = new URL(subscription.endpoint).host; } catch (_) {}
    try {
        const vapid = {
            subject: 'mailto:no-reply@contabilidadpersonal.com',
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY
        };
        const sub = {
            endpoint: subscription.endpoint,
            expirationTime: null,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        };
        const message = { data: JSON.stringify(payload), options: { ttl: 86400 } };
        const init = await buildPushPayload(message, sub, vapid);
        const res = await fetch(subscription.endpoint, init);
        // Visibilidad del error real: registrar host, status y cuerpo cuando falla.
        let body = '';
        if (!res.ok) {
            body = await res.text().catch(() => '');
            console.error('sendPush FAIL:', host, res.status, body);
        }
        if (res.status === 404 || res.status === 410) {
            // Suscripción muerta: eliminarla
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?')
                .bind(subscription.endpoint).run();
            return { ok: false, status: res.status, host, error: body || 'gone', deleted: true };
        }
        return { ok: res.ok, status: res.status, host, error: res.ok ? null : (body || null) };
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        console.error('sendPush EXCEPTION:', host, msg);
        return { ok: false, status: 0, host, error: msg };
    }
}

// ---------- Cálculos del cron de avisos (fórmulas portadas del frontend) ----------
const fmtEur = (v) => v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Réplica de calculateMonthStats (solo los totales que necesita el cron)
function cronMonthStats(movs, monthStr) {
    const m = movs.filter(x => x.fecha && x.fecha.startsWith(monthStr));
    const ingresos = m.filter(x => x.tipo === 'ingreso').reduce((s, x) => s + x.cantidad, 0);
    const gastos = m.filter(x => x.tipo === 'gasto').reduce((s, x) => s + x.cantidad, 0);
    return { ingresos_total: ingresos, gastos_total: gastos, resultado: ingresos - gastos, num_movimientos: m.length };
}

// Réplica del gasto/aportación por grupo de autocontrol (_getMonthlyGroupSpend del frontend)
function cronGroupSpend(movs, associations, monthStr) {
    const spend = { savings: 0, investment: 0, needs: 0, leisure: 0 };
    Object.keys(spend).forEach(group => {
        (associations[group] || []).forEach(accountId => {
            if (group === 'savings' || group === 'investment') {
                spend[group] += movs
                    .filter(m => m.cuenta_destino_id === accountId &&
                                 (m.fecha || '').substring(0, 7) === monthStr &&
                                 (m.tipo === 'transferencia' || m.tipo === 'ingreso'))
                    .reduce((s, m) => s + m.cantidad, 0);
            } else {
                spend[group] += movs
                    .filter(m => m.cuenta_destino_id === accountId &&
                                 m.tipo === 'gasto' &&
                                 (m.fecha || '').substring(0, 7) === monthStr)
                    .reduce((s, m) => s + m.cantidad, 0);
            }
        });
    });
    return spend;
}

// Réplica fiel de calculateFinancialHealth del dashboard (Índice Flow)
function cronFlowIndex(movs, accounts, now) {
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const meses = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ms = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        meses.push(cronMonthStats(movs, ms));
    }
    const conDatos = meses.filter(m => m.num_movimientos > 0);
    const mesesConDatos = conDatos.length;

    const tasas = conDatos.filter(m => m.ingresos_total > 0)
        .map(m => (m.ingresos_total - m.gastos_total) / m.ingresos_total);
    const ahorro = tasas.length === 0 ? null
        : clamp((tasas.reduce((s, t) => s + t, 0) / tasas.length) / 0.40 * 100, 0, 100);

    const saldoActivos = accounts.filter(a => a.tipo === 'activo').reduce((s, a) => s + a.saldo_actual, 0);
    const gastoMedio = mesesConDatos === 0 ? 0
        : conDatos.reduce((s, m) => s + m.gastos_total, 0) / mesesConDatos;
    let liquidez;
    if (gastoMedio === 0) liquidez = saldoActivos > 0 ? 100 : 0;
    else liquidez = clamp((saldoActivos / gastoMedio) / 6 * 100, 0, 100);

    const acumulados = [];
    let acc = 0;
    meses.forEach(m => { acc += m.resultado; acumulados.push(acc); });
    const mediaA = (acumulados[0] + acumulados[1] + acumulados[2]) / 3;
    const mediaB = (acumulados[3] + acumulados[4] + acumulados[5]) / 3;
    let patrimonio;
    if (mediaA === 0) patrimonio = mediaB > 0 ? 100 : (mediaB < 0 ? 0 : 50);
    else patrimonio = clamp(50 + (((mediaB - mediaA) / Math.abs(mediaA)) / 0.10) * 50, 0, 100);

    const saldoPasivos = Math.abs(accounts.filter(a => a.tipo === 'pasivo').reduce((s, a) => s + a.saldo_actual, 0));
    let endeudamiento;
    if (saldoActivos <= 0 && saldoPasivos === 0) endeudamiento = 100;
    else if (saldoActivos <= 0) endeudamiento = 0;
    else endeudamiento = clamp((1 - saldoPasivos / saldoActivos) * 100, 0, 100);

    let estabilidad = null;
    if (mesesConDatos >= 3) {
        const gastos = conDatos.map(m => m.gastos_total);
        const media = gastos.reduce((s, g) => s + g, 0) / gastos.length;
        if (media === 0) estabilidad = 100;
        else {
            const varianza = gastos.reduce((s, g) => s + Math.pow(g - media, 2), 0) / gastos.length;
            estabilidad = clamp((1 - Math.sqrt(varianza) / media) * 100, 0, 100);
        }
    }

    const pesos = { ahorro: 0.25, liquidez: 0.20, patrimonio: 0.20, endeudamiento: 0.20, estabilidad: 0.15 };
    const valores = { ahorro, liquidez, patrimonio, endeudamiento, estabilidad };
    let suma = 0, pesoTotal = 0;
    for (const [k, v] of Object.entries(valores)) {
        if (v !== null) { suma += v * pesos[k]; pesoTotal += pesos[k]; }
    }
    const flow = pesoTotal > 0 ? Math.round(suma / pesoTotal) : 0;
    return { flow, mesesConDatos };
}

// Calcula los avisos del día para un usuario, ya ordenados por prioridad:
// superado > 80 % > coste fijo > resumen > inactividad. Mismos notifKey que la app.
function computeDailyAlerts(now, movs, accounts, plan, associations) {
    const monthStr = now.toISOString().substring(0, 7);
    const superados = [], al80 = [], costesFijos = [], resumen = [], inactividad = [];

    // Presupuestos de autocontrol (grupos de gasto: Necesidades y Resto)
    if (plan && plan.percentages && associations) {
        const monthlyIncome = movs
            .filter(m => m.tipo === 'ingreso' && (m.fecha || '').substring(0, 7) === monthStr)
            .reduce((s, m) => s + m.cantidad, 0);
        if (monthlyIncome > 0) {
            const spend = cronGroupSpend(movs, associations, monthStr);
            for (const g of [{ key: 'needs', nombre: 'Necesidades' }, { key: 'leisure', nombre: 'Resto' }]) {
                const presupuesto = (monthlyIncome * (plan.percentages[g.key] || 0)) / 100;
                if (presupuesto <= 0) continue;
                const gastado = spend[g.key];
                const pct = Math.round((gastado / presupuesto) * 100);
                if (gastado > presupuesto) {
                    const exceso = gastado - presupuesto;
                    superados.push({
                        type: 'presupuesto_superado',
                        notifKey: `presupuesto_superado:${g.nombre}:${monthStr}`,
                        title: `⚠️ Presupuesto de ${g.nombre} superado`,
                        body: `Has superado tu presupuesto de ${g.nombre} en ${fmtEur(exceso)} € este mes (${fmtEur(gastado)} € de ${fmtEur(presupuesto)} €).`
                    });
                } else if (pct >= 80) {
                    al80.push({
                        type: 'presupuesto_80',
                        notifKey: `presupuesto_80:${g.nombre}:${monthStr}`,
                        title: `📊 Presupuesto de ${g.nombre} al ${pct} %`,
                        body: `Llevas gastado el ${pct} % de tu presupuesto de ${g.nombre} este mes (${fmtEur(gastado)} € de ${fmtEur(presupuesto)} €).`
                    });
                }
            }
        }
    }

    // Costes fijos con vencimiento en <=3 días
    const hoy = now.getDate();
    accounts
        .filter(a => (a.is_fixed_cost === 1 || a.is_fixed_cost === true) && a.fixed_due_day)
        .forEach(a => {
            const dias = a.fixed_due_day - hoy;
            if (dias >= 0 && dias <= 3) {
                costesFijos.push({
                    type: 'coste_fijo_proximo',
                    notifKey: `coste_fijo:${a.id}:${monthStr}`,
                    title: `📅 Próximo vencimiento: ${a.nombre}`,
                    body: `El día ${a.fixed_due_day} vence ${a.nombre}: ${fmtEur(a.fixed_monthly_amount || 0)} €.`
                });
            }
        });

    // Resumen mensual (solo el día 1, sobre el mes cerrado)
    if (now.getDate() === 1) {
        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        const prev = cronMonthStats(movs, prevStr);
        if (prev.num_movimientos > 0) {
            const nombresMes = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
            const mesNombre = nombresMes[prevDate.getMonth()];
            const tasa = prev.ingresos_total > 0
                ? ((prev.ingresos_total - prev.gastos_total) / prev.ingresos_total * 100) : 0;
            const tasaFmt = tasa.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            const { flow } = cronFlowIndex(movs, accounts, now);
            resumen.push({
                type: 'resumen_mensual',
                notifKey: `resumen:${prevStr}`,
                title: `📈 Tu resumen de ${mesNombre}`,
                body: `Balance de ${mesNombre}: ${fmtEur(prev.resultado)} € · Tasa de ahorro: ${tasaFmt} % · Índice Flow: ${flow}.`
            });
        }
    }

    // Sin actividad (>=7 días sin movimientos)
    if (movs.length > 0) {
        const ultimaFecha = movs.reduce((max, m) => (m.fecha > max ? m.fecha : max), movs[0].fecha);
        const dias = Math.floor((now - new Date(ultimaFecha + 'T00:00:00')) / 86400000);
        if (dias >= 7) {
            const week = Math.ceil(((now - new Date(now.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
            inactividad.push({
                type: 'sin_actividad',
                notifKey: `sin_actividad:${now.getFullYear()}-W${week}`,
                title: '👋 Te echamos de menos',
                body: `Llevas ${dias} días sin registrar movimientos. Mantén tus finanzas al día.`
            });
        }
    }

    return [...superados, ...al80, ...costesFijos, ...resumen, ...inactividad];
}

// ============================================================
// ROUTER
// ============================================================
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;
        const cors = corsHeaders(request, env);
        // Id de petición: se devuelve en los 500 y se registra, para cruzar un error
        // de un usuario con los logs (wrangler tail) sin exponerle detalles internos.
        const requestId = crypto.randomUUID();

        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

        // Ningún endpoint legítimo necesita más de 1 MB de body
        if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES)
            return json({ error: 'Petición demasiado grande' }, 413, cors);

        try {
            // ---------- HEALTH ----------
            if (path === '/api/health') return json({ ok: true, ts: Date.now() }, 200, cors);

            // ---------- AUTH ----------
            if (path === '/api/auth/register' && method === 'POST') {
                // Máx. 10 altas por IP y hora (anti creación masiva de cuentas y de emails)
                const regIp = rateLimitIp(request);
                if (await rateLimited(env, `rl:register:${regIp}`, 10, 3600))
                    return json({ error: 'Demasiados registros desde esta conexión. Inténtalo más tarde.' }, 429, cors);
                const { email, password, name, turnstileToken } = await request.json();
                if (!(await turnstileOk(env, turnstileToken, request.headers.get('CF-Connecting-IP')))) return json(TURNSTILE_ERROR, 400, cors);
                if (!email || !password || !name) return json({ error: 'Faltan campos' }, 400, cors);
                if (password.length < 8) return json({ error: 'Contraseña mínima 8 caracteres' }, 400, cors);
                if (!V.email(email) || !V.str(password, 256) || !V.str(name, 100))
                    return invalid('email válido, contraseña de hasta 256 caracteres y nombre de hasta 100', cors);

                const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
                    .bind(email.toLowerCase()).first();
                if (exists) return json({ error: 'Email ya registrado' }, 409, cors);

                const id = crypto.randomUUID();
                const now = new Date().toISOString();
                const pwHash = await hashPassword(password);
                // Seguridad: el registro SIEMPRE crea plan 'free'. El premium solo lo
                // activa el flujo de pago (Stripe webhook / verify-session), nunca el cliente.
                const plan = 'free';
                const planExp = null;

                await env.DB.prepare(
                    `INSERT INTO users (id,email,name,password_hash,plan,plan_expires_at,created_at)
                     VALUES (?,?,?,?,?,?,?)`)
                    .bind(id, email.toLowerCase(), name, pwHash, plan, planExp, now).run();

                const token = await issueToken(env, { id });
        const user = { id, email: email.toLowerCase(), name, plan, plan_expires_at: planExp, currency: 'EUR', created_at: now };
        // Enviar email de bienvenida (sin bloquear la respuesta)
        ctx.waitUntil(sendEmail(env, {
          to: email.toLowerCase(),
          subject: '¡Bienvenido a Finance Flow!',
          html: welcomeEmailHTML()
        }));
        return json({ success: true, token, currentUser: user }, 201, cors);
            }

            if (path === '/api/auth/login' && method === 'POST') {
                // B4: máx. 10 intentos por IP cada 15 min (anti fuerza bruta)
                const loginIp = rateLimitIp(request);
                if (await rateLimited(env, `rl:login:${loginIp}`, 10, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);
                const { email, password, turnstileToken } = await request.json();
                if (!V.str(email, 254) || !V.str(password, 1024)) return invalid('email o contraseña', cors);
                if (!(await turnstileOk(env, turnstileToken, request.headers.get('CF-Connecting-IP')))) return json(TURNSTILE_ERROR, 400, cors);
                const loginEmail = (email || '').toLowerCase();
                const lock = await loginLockState(env, loginEmail, loginIp);
                if (lock.wait > 0)
                    return json({ error: 'Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos.' }, 429,
                        { ...cors, 'Retry-After': String(lock.wait) });
                const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
                    .bind(loginEmail).first();
                if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
                    await loginFailed(env, loginEmail, loginIp, lock);
                    if (user) ctx.waitUntil(audit(env, request, 'login_failed', user.id, { method: 'password' }));
                    return json({ error: 'Credenciales inválidas' }, 401, cors);
                }
                await loginSucceeded(env, loginEmail, loginIp, lock);
                ctx.waitUntil(audit(env, request, 'login', user.id, { method: 'password' }));

                const token = await issueToken(env, user);
                return json({ success: true, token, currentUser: publicUser(user) }, 200, cors);
            }

            // ---------- WebAuthn: LOGIN (sin sesión previa) ----------
            // Flujo "usernameless"/discoverable: sin allowCredentials, el dispositivo
            // elige entre las passkeys guardadas. El reto se cachea por un id temporal.
            if (path === '/api/auth/webauthn/login-options' && method === 'POST') {
                // Cada llamada escribe un reto en KV: máx. 30 por IP cada 15 min
                const optIp = rateLimitIp(request);
                if (await rateLimited(env, `rl:wa-opt:${optIp}`, 30, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);
                const { rpID } = webauthnConfig(env);
                const options = await generateAuthenticationOptions({
                    rpID,
                    userVerification: 'required'
                });
                const loginId = crypto.randomUUID();
                await env.CACHE.put(`webauthn_login:${loginId}`, options.challenge, { expirationTtl: 300 });
                return json({ options, loginId }, 200, cors);
            }

            if (path === '/api/auth/webauthn/login-verify' && method === 'POST') {
                // Mismo rate limit por IP que /api/auth/login (anti fuerza bruta)
                const loginIp = rateLimitIp(request);
                if (await rateLimited(env, `rl:login:${loginIp}`, 10, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);

                const { loginId, response } = await request.json();
                if (!loginId || !response || !response.id)
                    return json({ error: 'Solicitud inválida' }, 400, cors);
                if (!V.str(loginId, 64) || !V.obj(response) || !V.str(response.id, 1024))
                    return json({ error: 'Solicitud inválida' }, 400, cors);

                const expectedChallenge = await env.CACHE.get(`webauthn_login:${loginId}`);
                if (!expectedChallenge)
                    return json({ error: 'La sesión de login ha expirado, vuelve a intentarlo.' }, 400, cors);

                // response.id = credential_id (base64url) que el dispositivo eligió
                const cred = await env.DB.prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?')
                    .bind(response.id).first();
                if (!cred)
                    return json({ error: 'No hay credenciales registradas en este dispositivo.' }, 401, cors);

                const { rpID, expectedOrigin } = webauthnConfig(env);
                let verification;
                try {
                    verification = await verifyAuthenticationResponse({
                        response,
                        expectedChallenge,
                        expectedOrigin,
                        expectedRPID: rpID,
                        requireUserVerification: true,
                        credential: {
                            id: cred.credential_id,
                            publicKey: b64urlToBuf(cred.public_key),
                            counter: cred.counter
                        }
                    });
                } catch (e) {
                    return json({ error: 'No se pudo verificar la credencial.' }, 401, cors);
                }
                if (!verification.verified)
                    return json({ error: 'No se pudo verificar la credencial.' }, 401, cors);

                // Actualizar counter (detección de clonado) y last_used_at
                const now = new Date().toISOString();
                await env.DB.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?')
                    .bind(verification.authenticationInfo.newCounter, now, cred.id).run();
                await env.CACHE.delete(`webauthn_login:${loginId}`);

                const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(cred.user_id).first();
                if (!user) return json({ error: 'Usuario no encontrado' }, 404, cors);

                // Mismo JWT y mismo shape de respuesta que /api/auth/login
                ctx.waitUntil(audit(env, request, 'login', user.id, { method: 'passkey' }));
                const token = await issueToken(env, user);
                return json({ success: true, token, currentUser: publicUser(user) }, 200, cors);
            }

            if (path === '/api/auth/google' && method === 'POST') {
                // Cada llamada consulta a Google: máx. 20 por IP cada 15 min
                const gIp = rateLimitIp(request);
                if (await rateLimited(env, `rl:google:${gIp}`, 20, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);
                const { credential } = await request.json();
                if (!credential) return json({ error: 'Falta credential' }, 400, cors);
                if (!V.str(credential, 4096)) return json({ error: 'Token de Google inválido' }, 400, cors);

                // Verificación del id_token en servidor (obligatoria): nunca confiar
                // en un JWT de Google decodificado solo en el navegador.
                const tokRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
                if (!tokRes.ok) return json({ error: 'Token de Google inválido' }, 401, cors);
                const payload = await tokRes.json();

                // tokeninfo devuelve los campos como strings
                if (payload.aud !== env.GOOGLE_CLIENT_ID)
                    return json({ error: 'Token de Google inválido' }, 401, cors);
                if (!(payload.email_verified === 'true' || payload.email_verified === true))
                    return json({ error: 'Token de Google inválido' }, 401, cors);
                if (!payload.email || !payload.sub)
                    return json({ error: 'Token de Google inválido' }, 401, cors);

                const gEmail = payload.email.toLowerCase();
                const now = new Date().toISOString();

                // Buscar por google_sub y, si no, vincular por email
                let user = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?')
                    .bind(payload.sub).first();
                let isNew = false;
                let passwordRemoved = false;
                if (!user) {
                    user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
                        .bind(gEmail).first();
                    if (user) {
                        // Cuenta existente por email: vincular con Google. El alta con contraseña
                        // no verifica el email, así que esa cuenta pudo crearla otra persona con
                        // el email de este usuario. Google acaba de demostrar quién controla el
                        // email: todo acceso creado antes deja de valer (contraseña, sesiones,
                        // passkeys y suscripciones push). Todo en un batch: o se aplica entero o nada.
                        // El dueño legítimo puede crear otra contraseña con "¿Olvidaste tu contraseña?".
                        passwordRemoved = !!user.password_hash;
                        const linkStmts = [
                            env.DB.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').bind(user.id),
                            env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=?').bind(user.id),
                            env.DB.prepare(
                                `UPDATE users SET google_sub=?, auth_provider=COALESCE(auth_provider,'google'),
                                    picture=COALESCE(?, picture), password_hash=NULL, updated_at=? WHERE id=?`)
                                .bind(payload.sub, payload.picture ?? null, now, user.id)
                        ];
                        // Sin la migración 0001 no hay token_version (y authenticate no lo comprueba)
                        const hasTokenVersion = typeof user.token_version === 'number';
                        if (hasTokenVersion)
                            linkStmts.push(env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id=?')
                                .bind(user.id));
                        await env.DB.batch(linkStmts);
                        if (hasTokenVersion) user.token_version += 1;
                        user.password_hash = null;
                        user.google_sub = payload.sub;
                        user.auth_provider = user.auth_provider || 'google';
                        user.picture = payload.picture ?? user.picture;
                        ctx.waitUntil(audit(env, request, 'google_linked', user.id, { password_removed: passwordRemoved }));
                    } else {
                        // Usuario nuevo
                        isNew = true;
                        const gName = payload.name || gEmail.split('@')[0];
                        user = {
                            id: crypto.randomUUID(),
                            email: gEmail,
                            name: gName,
                            password_hash: null,
                            auth_provider: 'google',
                            google_sub: payload.sub,
                            picture: payload.picture || null,
                            plan: 'free',
                            plan_expires_at: null,
                            created_at: now
                        };
                        await env.DB.prepare(
                            `INSERT INTO users (id,email,name,password_hash,auth_provider,google_sub,picture,plan,plan_expires_at,created_at)
                             VALUES (?,?,?,?,?,?,?,?,?,?)`)
                            .bind(user.id, user.email, user.name, null, 'google', user.google_sub,
                                  user.picture, 'free', null, now).run();
                        // Email de bienvenida SOLO para usuarios nuevos (mismo patrón que /api/auth/register)
                        ctx.waitUntil(sendEmail(env, {
                            to: gEmail,
                            subject: '¡Bienvenido a Finance Flow!',
                            html: welcomeEmailHTML()
                        }));
                    }
                }

                ctx.waitUntil(audit(env, request, 'login', user.id, { method: 'google', nuevo: isNew }));
                const gToken = await issueToken(env, user);
                return json({ success: true, token: gToken, currentUser: publicUser(user), passwordRemoved },
                    isNew ? 201 : 200, cors);
            }

            if (path === '/api/auth/session' && method === 'GET') {
                const user = await getAuthUser(request, env);
                if (!user) return json({ token: null, currentUser: null }, 200, cors);
                return json({ token: 'valid', currentUser: publicUser(user) }, 200, cors);
            }

            if (path === '/api/auth/logout' && method === 'POST') {
                // Invalida en servidor el token con el que se llama (hasta su caducidad)
                const auth = await authenticate(request, env);
                if (auth) await revokeToken(env, auth.payload, auth.token);
                return json({ success: true }, 200, cors);
            }
            if (path === "/api/auth/forgot-password" && method === "POST") {
        const fp = await request.json();
        // Email con tipo/longitud no válidos: misma respuesta que siempre (no revela nada)
        if (!V.str(fp.email, 254)) return json({ success: true }, 200, cors);
        const fpEmail = (fp.email || "").toLowerCase();
        // B4: máx. 3 solicitudes por email/hora y 10 por IP/hora (anti bombardeo de emails).
        // Se responde igual que el flujo normal para no revelar el límite ni si el email existe.
        const fpIp = rateLimitIp(request);
        if (await rateLimited(env, `rl:reset:${fpEmail}`, 3, 3600) ||
            await rateLimited(env, `rl:reset-ip:${fpIp}`, 10, 3600)) {
          return json({ success: true }, 200, cors);
        }
        if (!(await turnstileOk(env, fp.turnstileToken, request.headers.get('CF-Connecting-IP')))) return json(TURNSTILE_ERROR, 400, cors);
        const fpUser = await env.DB.prepare("SELECT id, name, email FROM users WHERE email=?")
          .bind(fpEmail).first();
        if (fpUser) {
          const resetToken = crypto.randomUUID();
          await env.CACHE.put("reset:" + resetToken, fpUser.id, { expirationTtl: 3600 });
          const link = env.APP_URL + "/reset-password.html?token=" + resetToken;
          ctx.waitUntil(sendEmail(env, {
            to: fpUser.email,
            subject: "Recupera tu contraseña - Finance Flow",
            html: resetPasswordEmailHTML(link)
          }));
        }
        return json({ success: true }, 200, cors);
      }
      if (path === "/api/auth/reset-password" && method === "POST") {
        // Máx. 10 intentos por IP cada 15 min (el token es aleatorio de 122 bits; esto evita abuso)
        const rpIp = rateLimitIp(request);
        if (await rateLimited(env, `rl:reset-pw:${rpIp}`, 10, 900))
          return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);
        const rp = await request.json();
        if (!rp.token || !rp.password || rp.password.length < 8)
          return json({ error: "Datos inválidos (contraseña mínima 8 caracteres)" }, 400, cors);
        if (!V.str(rp.token, 100) || !V.str(rp.password, 256))
          return json({ error: "Datos inválidos (contraseña de 8 a 256 caracteres)" }, 400, cors);
        const rpUserId = await env.CACHE.get("reset:" + rp.token);
        if (!rpUserId) return json({ error: "El enlace no es válido o ha caducado" }, 400, cors);
        const rpHash = await hashPassword(rp.password);
        // Restablecer es la vía para recuperar una cuenta robada: además de las sesiones
        // (bumpTokenVersion), se revocan las passkeys y las suscripciones push, que no
        // dependen de la contraseña. Los dispositivos legítimos vuelven a suscribirse solos
        // al abrir el dashboard (reconcilePushSubscription).
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?")
            .bind(rpHash, new Date().toISOString(), rpUserId),
          env.DB.prepare("DELETE FROM webauthn_credentials WHERE user_id=?").bind(rpUserId),
          env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id=?").bind(rpUserId)
        ]);
        await bumpTokenVersion(env, rpUserId);   // cierra las sesiones abiertas (p. ej. de quien robó la cuenta)
        const rpUser = await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(rpUserId).first();
        if (rpUser) ctx.waitUntil(clearLoginLock(env, rpUser.email, rpIp));
        ctx.waitUntil(audit(env, request, 'password_reset', rpUserId));
        await env.CACHE.delete("reset:" + rp.token);
        return json({ success: true }, 200, cors);
      }
            // A partir de aquí, todo requiere autenticación
            const auth = await authenticate(request, env);
            const authUser = auth ? auth.user : null;
            const uid = authUser?.id;
            // Renovación deslizante de la sesión (ver issueToken): todas las respuestas
            // de esta petición llevan el token nuevo.
            if (auth && needsRefresh(auth.payload))
                cors['X-Refresh-Token'] = await issueToken(env, authUser, auth.payload.exp);

            // ---------- CAMBIO DE CONTRASEÑA (requiere sesión y la contraseña actual) ----------
            if (path === '/api/auth/change-password' && method === 'POST') {
                if (!authUser) return json({ error: 'No autorizado' }, 401, cors);
                if (await rateLimited(env, `rl:chpw:${authUser.id}`, 5, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);
                const { currentPassword, newPassword } = await request.json();
                if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' ||
                    newPassword.length < 8 || newPassword.length > 256)
                    return json({ error: 'Datos inválidos (contraseña nueva de 8 a 256 caracteres)' }, 400, cors);
                if (!authUser.password_hash)
                    return json({ error: 'Tu cuenta no tiene contraseña (entras con Google). Usa "¿Olvidaste tu contraseña?" para crear una.' }, 400, cors);
                if (!(await verifyPassword(currentPassword, authUser.password_hash)))
                    return json({ error: 'La contraseña actual no es correcta' }, 403, cors);
                const newHash = await hashPassword(newPassword);
                await env.DB.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?')
                    .bind(newHash, new Date().toISOString(), authUser.id).run();
                await bumpTokenVersion(env, authUser.id);   // cierra las sesiones abiertas
                ctx.waitUntil(audit(env, request, 'password_changed', authUser.id));
                return json({ success: true }, 200, cors);
            }

            // ---------- WebAuthn: REGISTRO de credencial (requiere sesión activa) ----------
            if (path === '/api/auth/webauthn/register-options' && method === 'POST') {
                if (!authUser) return json({ error: 'No autorizado' }, 401, cors);
                const { rpName, rpID } = webauthnConfig(env);
                // Excluir las passkeys que este usuario ya tenga registradas
                const existing = await env.DB.prepare('SELECT credential_id FROM webauthn_credentials WHERE user_id = ?')
                    .bind(authUser.id).all();
                const options = await generateRegistrationOptions({
                    rpName,
                    rpID,
                    userID: new TextEncoder().encode(authUser.id),
                    userName: authUser.email,
                    userDisplayName: authUser.name || authUser.email,
                    attestationType: 'none',
                    authenticatorSelection: {
                        authenticatorAttachment: 'platform',
                        userVerification: 'required',
                        residentKey: 'preferred'
                    },
                    excludeCredentials: (existing.results || []).map(r => ({ id: r.credential_id }))
                });
                await env.CACHE.put(`webauthn_challenge:${authUser.id}`, options.challenge, { expirationTtl: 300 });
                return json(options, 200, cors);
            }

            if (path === '/api/auth/webauthn/register-verify' && method === 'POST') {
                if (!authUser) return json({ error: 'No autorizado' }, 401, cors);
                if (await rateLimited(env, `rl:wa-reg:${authUser.id}`, 10, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);

                const body = await request.json();
                const expectedChallenge = await env.CACHE.get(`webauthn_challenge:${authUser.id}`);
                if (!expectedChallenge)
                    return json({ error: 'El reto ha expirado, vuelve a intentarlo.' }, 400, cors);

                const { rpID, expectedOrigin } = webauthnConfig(env);
                let verification;
                try {
                    verification = await verifyRegistrationResponse({
                        response: body,
                        expectedChallenge,
                        expectedOrigin,
                        expectedRPID: rpID,
                        requireUserVerification: true
                    });
                } catch (e) {
                    console.error('webauthn register-verify:', e && e.message);
                    return json({ error: 'No se pudo verificar la credencial.' }, 400, cors);
                }
                if (!verification.verified || !verification.registrationInfo)
                    return json({ error: 'No se pudo verificar la credencial.' }, 400, cors);

                const { credential } = verification.registrationInfo;
                const now = new Date().toISOString();
                await env.DB.prepare(
                    `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter, device_name, created_at)
                     VALUES (?,?,?,?,?,?,?)`)
                    .bind(
                        crypto.randomUUID(),
                        authUser.id,
                        credential.id,
                        bufToB64url(credential.publicKey),
                        credential.counter || 0,
                        (request.headers.get('User-Agent') || '').slice(0, 120),
                        now
                    ).run();
                await env.CACHE.delete(`webauthn_challenge:${authUser.id}`);
                return json({ success: true }, 200, cors);
            }

            // ---------- WebAuthn: passkeys del usuario (listar / quitar) ----------
            // Sin credential_id ni clave pública: solo lo que el usuario necesita para
            // reconocer sus dispositivos y quitar los que no son suyos.
            if (path === '/api/auth/webauthn/credentials' && method === 'GET') {
                if (!authUser) return json({ error: 'No autorizado' }, 401, cors);
                const { results } = await env.DB.prepare(
                    'SELECT id, device_name, created_at, last_used_at FROM webauthn_credentials WHERE user_id=? ORDER BY created_at DESC')
                    .bind(authUser.id).all();
                return json({ credentials: results || [] }, 200, cors);
            }
            const waCredMatch = path.match(/^\/api\/auth\/webauthn\/credentials\/([^/]+)$/);
            if (waCredMatch && method === 'DELETE') {
                if (!authUser) return json({ error: 'No autorizado' }, 401, cors);
                if (!V.id(waCredMatch[1])) return invalid('passkey', cors);
                const del = await env.DB.prepare('DELETE FROM webauthn_credentials WHERE id=? AND user_id=?')
                    .bind(waCredMatch[1], authUser.id).run();
                if (del.meta?.changes) ctx.waitUntil(audit(env, request, 'passkey_removed', authUser.id));
                return json({ success: true }, 200, cors);
            }

            // ---------- USERS ----------
            if (path === '/api/users' && method === 'GET') {
                if (!authUser) return json({ error: 'No autorizado' }, 401, cors);
                // Solo devuelve el propio usuario (privacidad)
                return json([publicUser(authUser)], 200, cors);
            }

            const userMatch = path.match(/^\/api\/users\/(.+)$/);
            if (userMatch) {
                if (!authUser || authUser.id !== userMatch[1]) return json({ error: 'No autorizado' }, 403, cors);
                if (method === 'GET') return json(publicUser(authUser), 200, cors);
                if (method === 'PUT') {
                    const u = await request.json();
                    if (!V.obj(u) || !V.optStr(u.name, 100)) return invalid('name (máx. 100 caracteres)', cors);
                    const now = new Date().toISOString();
                    // plan y plan_expires_at NUNCA se aceptan del cliente: solo el webhook
                    // de Stripe y verify-session pueden cambiarlos.
                    const newName = u.name ?? authUser.name;
                    // Divisa: solo cambia el formato/símbolo mostrado (no hay conversión de
                    // importes ni afecta al cobro de Stripe, que sigue en EUR). Validar contra
                    // la lista permitida (EUR + principales de LATAM).
                    const ALLOWED_CURRENCIES = ['EUR','USD','MXN','COP','ARS','CLP','PEN','UYU','BOB','PYG','BRL','GTQ','CRC','DOP','HNL','NIO','PAB','VES'];
                    let newCurrency = authUser.currency || 'EUR';
                    if (u.currency !== undefined) {
                        if (!ALLOWED_CURRENCIES.includes(u.currency)) return json({ error: 'Divisa no permitida' }, 400, cors);
                        newCurrency = u.currency;
                    }
                    await env.DB.prepare(
                        `UPDATE users SET name=?, currency=?, updated_at=? WHERE id=?`)
                        .bind(newName, newCurrency, now, authUser.id).run();
                    return json(publicUser({ ...authUser, name: newName, currency: newCurrency, updated_at: now }), 200, cors);
                }
               if (method === "DELETE") {
          const delId = authUser.id;
          await env.DB.batch([
            env.DB.prepare("DELETE FROM movements WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM accounts WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM categorization_rules WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM autocontrol_plan WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM autocontrol_associations WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM scenarios WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM notifications WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM bank_connections WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM import_info WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM webauthn_credentials WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM push_log WHERE user_id=?").bind(delId),
            env.DB.prepare("DELETE FROM users WHERE id=?").bind(delId)
          ]);
          // Auditoría: se borra el historial del usuario y queda solo el evento de borrado
          // (sin IP ni user-agent). Fuera del batch para no depender de la migración 0002.
          try { await env.DB.prepare("DELETE FROM audit_log WHERE user_id=?").bind(delId).run(); }
          catch (e) { console.error('audit_log (borrado):', e && e.message); }
          await audit(env, null, 'account_deleted', delId);
          return json({ success: true }, 200, cors);
        }
      }
            
            // ---------- ACCOUNTS ----------
            if (path === '/api/accounts') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id=?`).bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const a = await request.json();
                    if (!V.obj(a) || !V.id(a.id) || !V.str(a.nombre, 120, 1) || !ACCOUNT_TYPES.includes(a.tipo) ||
                        !V.optStr(a.descripcion, 500) || !V.optAmount(a.saldo_inicial) || !V.optAmount(a.saldo_actual) ||
                        !V.optAmount(a.fixed_monthly_amount) || !V.dueDay(a.fixed_due_day) || !V.optDate(a.created_at))
                        return invalid('cuenta', cors);
                    const isNewAccount = !(await env.DB.prepare('SELECT 1 FROM accounts WHERE id=? AND user_id=?').bind(a.id, uid).first());
                    if (isNewAccount) {
                        const limit = ACCOUNT_LIMITS[isPremiumUser(authUser) ? 'premium' : 'free'][a.tipo];
                        const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id=? AND tipo=?')
                            .bind(uid, a.tipo).first();
                        if (n >= limit)
                            return json({ error: `Has alcanzado el límite de cuentas de tipo ${a.tipo} de tu plan` }, 403, cors);
                    }
                    const now = new Date().toISOString();
                    await env.DB.prepare(
                        `INSERT INTO accounts (id,user_id,nombre,tipo,descripcion,saldo_inicial,saldo_actual,
                            is_fixed_cost,fixed_monthly_amount,fixed_due_day,is_bank_account,created_at,updated_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, descripcion=excluded.descripcion,
                            saldo_inicial=excluded.saldo_inicial, saldo_actual=excluded.saldo_actual,
                            is_fixed_cost=excluded.is_fixed_cost, fixed_monthly_amount=excluded.fixed_monthly_amount,
                            fixed_due_day=excluded.fixed_due_day, is_bank_account=excluded.is_bank_account,
                            updated_at=excluded.updated_at
                         WHERE accounts.user_id = excluded.user_id`)
                        .bind(a.id, uid, a.nombre, a.tipo, a.descripcion || '', a.saldo_inicial || 0,
                              a.saldo_actual || 0, a.is_fixed_cost ? 1 : 0, a.fixed_monthly_amount ?? null,
                              a.fixed_due_day ?? null, a.is_bank_account ? 1 : 0, a.created_at || now, now).run();
                    return json(a, 200, cors);
                }
            }
            const accMatch = path.match(/^\/api\/accounts\/(.+)$/);
            if (accMatch && method === 'DELETE') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('DELETE FROM accounts WHERE id=? AND user_id=?')
                    .bind(accMatch[1].split('?')[0], uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- MOVEMENTS ----------
            if (path === '/api/movements') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare(`SELECT ${MOVEMENT_COLUMNS} FROM movements WHERE user_id=?`).bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const m = await request.json();
                    if (!V.obj(m) || !V.id(m.id) || !MOVEMENT_TYPES.includes(m.tipo) || !V.amount(m.cantidad) ||
                        !V.str(m.descripcion, 1000) || !V.date(m.fecha) || !V.optId(m.cuenta_id) || !V.optId(m.cuenta_destino_id) ||
                        !V.optStr(m.categoria, 100) || !V.optStr(m.origen, 30) || !V.optStr(m.applied_rule, 128) ||
                        !V.optStr(m.rule_name, 200) || !V.optStr(m.bank_reference, 200) || !V.optDate(m.created_at))
                        return invalid('movimiento', cors);
                    const now = new Date().toISOString();
                    await env.DB.prepare(
                        `INSERT INTO movements (id,user_id,tipo,cantidad,descripcion,fecha,cuenta_id,
                            cuenta_destino_id,categoria,origen,auto_categorized,applied_rule,rule_name,
                            manually_categorized,bank_reference,created_at,updated_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, cantidad=excluded.cantidad,
                            descripcion=excluded.descripcion, fecha=excluded.fecha, cuenta_id=excluded.cuenta_id,
                            cuenta_destino_id=excluded.cuenta_destino_id, categoria=excluded.categoria,
                            updated_at=excluded.updated_at
                         WHERE movements.user_id = excluded.user_id`)
                        .bind(m.id, uid, m.tipo, m.cantidad, m.descripcion, m.fecha, m.cuenta_id ?? null,
                              m.cuenta_destino_id ?? null, m.categoria ?? null, m.origen || 'manual',
                              m.auto_categorized ? 1 : 0, m.applied_rule ?? null, m.rule_name ?? null,
                              m.manually_categorized ? 1 : 0, m.bank_reference ?? null, m.created_at || now, now).run();
                    return json(m, 200, cors);
                }
            }
            const movMatch = path.match(/^\/api\/movements\/(.+)$/);
            if (movMatch && method === 'DELETE') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('DELETE FROM movements WHERE id=? AND user_id=?')
                    .bind(movMatch[1].split('?')[0], uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- RULES ----------
            if (path === '/api/rules') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM categorization_rules WHERE user_id=?').bind(uid).all();
                    // Mapear snake_case (D1) -> camelCase (frontend) y enteros (1/0) -> booleanos,
                    // para que el motor de reglas (accounting-manager.js) lea los campos correctamente.
                    return json(results.map(r => ({
                        id: r.id,
                        name: r.name,
                        keywords: JSON.parse(r.keywords || '[]'),
                        accountType: r.account_type,
                        accountId: r.account_id,
                        accountName: r.account_name,
                        enabled: r.enabled === 1 || r.enabled === true,
                        isDefault: r.is_default === 1 || r.is_default === true,
                        createdAt: r.created_at
                    })), 200, cors);
                }
                if (method === 'POST') {
                    if (!isPremiumUser(authUser)) return premiumRequired('Las reglas de registro automático', cors);
                    const r = await request.json();
                    if (!validRule(r)) return invalid('regla', cors);
                    await env.DB.prepare(
                        `INSERT INTO categorization_rules (id,user_id,name,keywords,account_type,account_id,account_name,enabled,is_default,created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET name=excluded.name, keywords=excluded.keywords,
                            account_type=excluded.account_type, account_id=excluded.account_id,
                            account_name=excluded.account_name, enabled=excluded.enabled
                         WHERE categorization_rules.user_id = excluded.user_id`)
                        .bind(r.id, uid, r.name, JSON.stringify(r.keywords || []), r.accountType ?? null,
                              r.accountId ?? null, r.accountName ?? null, r.enabled ? 1 : 0,
                              r.isDefault ? 1 : 0, r.createdAt || new Date().toISOString()).run();
                    return json(r, 200, cors);
                }
            }
            if (path === '/api/rules/bulk' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (!isPremiumUser(authUser)) return premiumRequired('Las reglas de registro automático', cors);
                const { rules } = await request.json();
                if (!Array.isArray(rules) || rules.length > 500 || !rules.every(validRule)) return invalid('reglas', cors);
                // Atómico (batch = transacción en D1): si un INSERT falla, por ejemplo por un id
                // que ya usa otro usuario (la PK es global), se deshace también el DELETE y el
                // usuario conserva las reglas que tenía.
                await env.DB.batch([
                    env.DB.prepare('DELETE FROM categorization_rules WHERE user_id=?').bind(uid),
                    ...rules.map(r => env.DB.prepare(
                        `INSERT INTO categorization_rules (id,user_id,name,keywords,account_type,account_id,account_name,enabled,is_default,created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?)`)
                        .bind(r.id, uid, r.name, JSON.stringify(r.keywords || []), r.accountType ?? null,
                              r.accountId ?? null, r.accountName ?? null, r.enabled ? 1 : 0,
                              r.isDefault ? 1 : 0, r.createdAt || new Date().toISOString()))
                ]);
                return json({ success: true, count: rules.length }, 200, cors);
            }
            const ruleMatch = path.match(/^\/api\/rules\/(.+)$/);
            if (ruleMatch && method === 'DELETE' && ruleMatch[1] !== 'bulk') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('DELETE FROM categorization_rules WHERE id=? AND user_id=?')
                    .bind(ruleMatch[1].split('?')[0], uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- AUTOCONTROL PLAN ----------
            if (path === '/api/autocontrol-plan') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const row = await env.DB.prepare('SELECT plan_data FROM autocontrol_plan WHERE user_id=?').bind(uid).first();
                    return json(row ? JSON.parse(row.plan_data) : null, 200, cors);
                }
                if (method === 'POST') {
                    if (!isPremiumUser(authUser)) return premiumRequired('El plan de autocontrol', cors);
                    const plan = await request.json();
                    if (!V.blob(plan, 100000)) return invalid('plan de autocontrol', cors);
                    await env.DB.prepare(
                        `INSERT INTO autocontrol_plan (user_id,plan_data,updated_at) VALUES (?,?,?)
                         ON CONFLICT(user_id) DO UPDATE SET plan_data=excluded.plan_data, updated_at=excluded.updated_at`)
                        .bind(uid, JSON.stringify(plan), new Date().toISOString()).run();
                    return json(plan, 200, cors);
                }
            }

            // ---------- AUTOCONTROL ASSOCIATIONS ----------
            if (path === '/api/autocontrol-associations') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const row = await env.DB.prepare('SELECT associations_data FROM autocontrol_associations WHERE user_id=?').bind(uid).first();
                    return json(row ? JSON.parse(row.associations_data) : null, 200, cors);
                }
                if (method === 'POST') {
                    if (!isPremiumUser(authUser)) return premiumRequired('El plan de autocontrol', cors);
                    const assoc = await request.json();
                    if (!V.blob(assoc, 100000)) return invalid('asociaciones', cors);
                    await env.DB.prepare(
                        `INSERT INTO autocontrol_associations (user_id,associations_data,updated_at) VALUES (?,?,?)
                         ON CONFLICT(user_id) DO UPDATE SET associations_data=excluded.associations_data, updated_at=excluded.updated_at`)
                        .bind(uid, JSON.stringify(assoc), new Date().toISOString()).run();
                    return json(assoc, 200, cors);
                }
            }

            // ---------- SCENARIOS ----------
            if (path === '/api/scenarios') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT scenario_data FROM scenarios WHERE user_id=?').bind(uid).all();
                    return json(results.map(r => JSON.parse(r.scenario_data)), 200, cors);
                }
                if (method === 'POST') {
                    const { scenarios } = await request.json();
                    if (!isNil(scenarios) && (!Array.isArray(scenarios) || scenarios.length > 100 ||
                        !scenarios.every(s => V.blob(s, 200000) && V.optId(s.id))))
                        return invalid('escenarios', cors);
                    await env.DB.prepare('DELETE FROM scenarios WHERE user_id=?').bind(uid).run();
                    for (const s of (scenarios || [])) {
                        await env.DB.prepare('INSERT INTO scenarios (id,user_id,scenario_data,created_at) VALUES (?,?,?,?)')
                            .bind(s.id || crypto.randomUUID(), uid, JSON.stringify(s), new Date().toISOString()).run();
                    }
                    return json(scenarios, 200, cors);
                }
            }

            // ---------- PREMIUM TRIAL ----------
            if (path === '/api/premium-trial') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const row = await env.DB.prepare('SELECT premium_trial_expires_at FROM users WHERE id=?').bind(uid).first();
                    return json({ expiry: row?.premium_trial_expires_at || null }, 200, cors);
                }
                // POST eliminado: las pruebas premium gratuitas ya no existen.
                // Antes aceptaba un 'expiry' arbitrario del cliente -> escalada de privilegios.
                if (method === 'POST') return json({ error: 'Función no disponible' }, 410, cors);
            }

            // ---------- NOTIFICATIONS ----------
            if (path === '/api/notifications') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE user_id=? ORDER BY created_at DESC`).bind(uid).all();
                    return json(results.map(n => ({ ...n, read: !!n.read, data: n.data ? JSON.parse(n.data) : {} })), 200, cors);
                }
                if (method === 'POST') {
                    const { notifications } = await request.json();
                    if (!isNil(notifications) && (!Array.isArray(notifications) || notifications.length > 200 ||
                        !notifications.every(n => V.obj(n) && V.id(n.id) && V.optStr(n.type, 50) && V.optStr(n.title, 300) &&
                            V.optStr(n.message, 2000) && (isNil(n.data) || V.blob(n.data, 10000)) && V.optDate(n.createdAt))))
                        return invalid('notificaciones', cors);
                    await env.DB.prepare('DELETE FROM notifications WHERE user_id=?').bind(uid).run();
                    for (const n of (notifications || [])) {
                        await env.DB.prepare(
                            'INSERT INTO notifications (id,user_id,type,title,message,data,read,created_at) VALUES (?,?,?,?,?,?,?,?)')
                            .bind(n.id, uid, n.type, n.title, n.message, JSON.stringify(n.data || {}),
                                  n.read ? 1 : 0, n.createdAt || new Date().toISOString()).run();
                    }
                    return json({ success: true }, 200, cors);
                }
            }

            // ---------- WEB PUSH: SUSCRIPCIONES ----------
            if (path === '/api/push/subscribe') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'POST') {
                    if (authUser.plan !== 'premium')
                        return json({ error: 'Las notificaciones push requieren Premium' }, 403, cors);
                    const sub = await request.json();
                    if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth)
                        return json({ error: 'Suscripción inválida' }, 400, cors);
                    // El Worker hará fetch a este endpoint (cron y /push/test): solo URLs
                    // https a un host con nombre (no IPs ni localhost) y claves de tamaño acotado.
                    if (!isPushEndpoint(sub.endpoint) || !V.str(sub.keys.p256dh, 200) || !V.str(sub.keys.auth, 100))
                        return json({ error: 'Suscripción inválida' }, 400, cors);
                    // device_id: identificador estable del dispositivo (localStorage del
                    // cliente). Permite reconciliar suscripciones muertas del MISMO
                    // dispositivo sin tocar las de otros dispositivos del usuario.
                    const deviceId = (typeof sub.deviceId === 'string' && sub.deviceId) ? sub.deviceId.slice(0, 64) : null;
                    await env.DB.prepare(
                        `INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth,user_agent,device_id,created_at)
                         VALUES (?,?,?,?,?,?,?,?)
                         ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,
                            p256dh=excluded.p256dh, auth=excluded.auth, device_id=excluded.device_id`)
                        .bind(crypto.randomUUID(), uid, sub.endpoint, sub.keys.p256dh, sub.keys.auth,
                              request.headers.get('User-Agent') || null, deviceId, new Date().toISOString()).run();
                    return json({ success: true }, 200, cors);
                }
                if (method === 'DELETE') {
                    const { endpoint } = await request.json();
                    if (!V.optStr(endpoint, 2048)) return invalid('endpoint', cors);
                    await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?')
                        .bind(uid, endpoint || '').run();
                    return json({ success: true }, 200, cors);
                }
            }

            // ---------- WEB PUSH: LISTA DE SUSCRIPCIONES (reconciliación) ----------
            // Devuelve los endpoints registrados del usuario (endpoint, device_id y
            // fecha; nada sensible) para que el cliente reconcilie la suscripción del
            // dispositivo actual sin borrar las de otros dispositivos.
            if (path === '/api/push/subscriptions' && method === 'GET') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const { results } = await env.DB.prepare(
                    'SELECT endpoint, device_id, created_at FROM push_subscriptions WHERE user_id=?').bind(uid).all();
                return json({ subscriptions: results || [] }, 200, cors);
            }

            // ---------- WEB PUSH: TEST (diagnóstico / soporte) ----------
            // Herramienta de soporte: envía una notificación de prueba a TODAS las
            // suscripciones del usuario autenticado y devuelve, por endpoint, el host,
            // el status HTTP y el error del proveedor (Apple/FCM). Sirve para verificar
            // de un vistazo si las notificaciones llegan a un dispositivo concreto sin
            // esperar al cron. Se dispara desde la app:
            //   fetch(API_URL + '/push/test', { method:'POST',
            //     headers:{ Authorization:'Bearer '+token } }).then(r=>r.json())
            // Protegido con rate limit (5 llamadas por usuario cada 10 min) para que no
            // pueda usarse como amplificador de envíos push.
            if (path === '/api/push/test' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (await rateLimited(env, `rl:pushtest:${uid}`, 5, 600))
                    return json({ error: 'Demasiadas pruebas. Espera unos minutos e inténtalo de nuevo.' }, 429, cors);
                const { results: testSubs } = await env.DB.prepare(
                    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?').bind(uid).all();
                if (!testSubs.length)
                    return json({ error: 'No hay suscripciones para este usuario' }, 404, cors);
                const results = [];
                for (const s of testSubs) {
                    const r = await sendPush(env, s, {
                        title: 'Prueba de notificación',
                        body: 'Si ves esto, las notificaciones push funcionan.',
                        url: '/dashboard.html',
                        tag: 'push-test'
                    });
                    results.push({ host: r.host, status: r.status, ok: r.ok, error: r.error });
                }
                return json({ count: results.length, results }, 200, cors);
            }

            // ---------- FEEDBACK (valoración al mes de registro) ----------
            if (path === '/api/feedback/status' && method === 'GET') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const dias = (Date.now() - new Date(authUser.created_at).getTime()) / 86400000;
                const shouldAsk = dias >= 30 && !authUser.feedback_requested_at;
                return json({ shouldAsk: !!shouldAsk }, 200, cors);
            }
            if (path === '/api/feedback/dismiss' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('UPDATE users SET feedback_requested_at=? WHERE id=?')
                    .bind(new Date().toISOString(), uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- BANK CONNECTIONS ----------
            if (path === '/api/bank-connections') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare(`SELECT ${BANK_CONNECTION_COLUMNS} FROM bank_connections WHERE user_id=?`).bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const c = await request.json();
                    if (!V.obj(c) || !V.id(c.id) || !V.optStr(c.bankCode, 128) || !V.optStr(c.bankName, 128) ||
                        !V.optStr(c.institutionId, 128) || !V.optStr(c.requisitionId, 128) ||
                        !V.optStr(c.gocardlessAccountId, 128) || !V.optStr(c.linkedAccountId, 128) ||
                        !V.optStr(c.status, 30) || !V.optDate(c.lastSyncAt) || !V.optDate(c.createdAt))
                        return invalid('conexión bancaria', cors);
                    await env.DB.prepare(
                        `INSERT INTO bank_connections (id,user_id,bank_code,bank_name,institution_id,requisition_id,
                            gocardless_account_id,linked_account_id,status,is_active,last_sync_at,created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET status=excluded.status, is_active=excluded.is_active,
                            gocardless_account_id=excluded.gocardless_account_id, last_sync_at=excluded.last_sync_at
                         WHERE bank_connections.user_id = excluded.user_id`)
                        .bind(c.id, uid, c.bankCode ?? null, c.bankName ?? null, c.institutionId ?? null,
                              c.requisitionId ?? null, c.gocardlessAccountId ?? null, c.linkedAccountId ?? null,
                              c.status || 'pending', c.isActive ? 1 : 0, c.lastSyncAt ?? null,
                              c.createdAt || new Date().toISOString()).run();
                    return json(c, 200, cors);
                }
            }
            const bcMatch = path.match(/^\/api\/bank-connections\/(.+)$/);
            if (bcMatch && method === 'DELETE') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('DELETE FROM bank_connections WHERE id=? AND user_id=?')
                    .bind(bcMatch[1].split('?')[0], uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- IMPORT INFO ----------
            if (path === '/api/import-info') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const bankCode = url.searchParams.get('bankCode');
                    if (!V.str(bankCode, 50)) return invalid('bankCode', cors);
                    const row = await env.DB.prepare(`SELECT ${IMPORT_INFO_COLUMNS} FROM import_info WHERE user_id=? AND bank_code=?`).bind(uid, bankCode).first();
                    return json(row || null, 200, cors);
                }
                if (method === 'POST') {
                    const { bankCode, importInfo } = await request.json();
                    if (!V.str(bankCode, 50) || !V.obj(importInfo) || !V.optDate(importInfo.lastImportDate) ||
                        !V.optAmount(importInfo.lastImportCount) || !V.optAmount(importInfo.totalImported))
                        return invalid('importInfo', cors);
                    await env.DB.prepare(
                        `INSERT INTO import_info (user_id,bank_code,last_import_at,last_import_count,total_imported)
                         VALUES (?,?,?,?,?)
                         ON CONFLICT(user_id,bank_code) DO UPDATE SET last_import_at=excluded.last_import_at,
                            last_import_count=excluded.last_import_count, total_imported=excluded.total_imported`)
                        .bind(uid, bankCode, importInfo.lastImportDate || new Date().toISOString(),
                              importInfo.lastImportCount || 0, importInfo.totalImported || 0).run();
                    return json({ success: true }, 200, cors);
                }
            }

            // ---------- STRIPE ----------
            if (path === '/api/stripe/create-checkout' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                // Cada llamada crea una Checkout Session en Stripe: máx. 10 por usuario cada 15 min
                if (await rateLimited(env, `rl:checkout:${uid}`, 10, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);
                const body = await request.json();
                // Aceptar tanto plan_type como planType; normalizar 'annual'/'yearly'
                const planRaw = body.plan_type || body.planType || 'monthly';
                const isAnnual = planRaw === 'annual' || planRaw === 'yearly';
                const priceId = isAnnual
                    ? 'price_1TaNmTRr7a5Py1C04bl5J8DC'
                    : 'price_1SjKSQRr7a5Py1C0K1jRHpPc';
                const params = new URLSearchParams();
                params.append('mode', 'subscription');
                params.append('line_items[0][price]', priceId);
                params.append('line_items[0][quantity]', '1');
                params.append('allow_promotion_codes', 'true');
                params.append('success_url', `${env.APP_URL}/dashboard.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}`);
                params.append('cancel_url', `${env.APP_URL}/dashboard.html?upgrade=cancelled`);
                params.append('client_reference_id', uid);
                params.append('customer_email', authUser.email);
                params.append('metadata[user_id]', uid);
                params.append('metadata[plan_type]', isAnnual ? 'annual' : 'monthly');

                const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params
                });
                const session = await resp.json();
                if (!resp.ok) {
                    console.error('Stripe create-checkout:', resp.status, session.error?.message);
                    return json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo.' }, 502, cors);
                }
                return json({ checkout_url: session.url, session_id: session.id }, 200, cors);
            }

            if (path === '/api/stripe/customer-portal' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const customerId = authUser.stripe_customer_id;
                if (!customerId) return json({ error: 'No tienes una suscripción activa' }, 400, cors);

                const params = new URLSearchParams();
                params.append('customer', customerId);
                params.append('return_url', `${env.APP_URL}/dashboard.html`);

                const resp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params
                });
                const session = await resp.json();
                if (!resp.ok) {
                    console.error('Stripe customer-portal:', resp.status, session.error?.message);
                    return json({ error: 'No se pudo abrir el portal de gestión' }, 502, cors);
                }
                return json({ portal_url: session.url }, 200, cors);
            }

            if (path === '/api/stripe/webhook' && method === 'POST') {
                const sig = request.headers.get('stripe-signature');
                const body = await request.text();
                const verified = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
                if (!verified) return json({ error: 'Firma inválida' }, 400, cors);

                const event = JSON.parse(body);
                // Idempotencia
                const seen = await env.DB.prepare('SELECT event_id FROM stripe_events WHERE event_id=?').bind(event.id).first();
                if (seen) return json({ received: true, duplicate: true }, 200, cors);
                await env.DB.prepare('INSERT INTO stripe_events (event_id,type,processed_at,payload) VALUES (?,?,?,?)')
                    .bind(event.id, event.type, new Date().toISOString(), body.slice(0, 5000)).run();

                // Premium solo para pagos iniciados por /api/stripe/create-checkout: es la única vía
                // que fija metadata.user_id (y client_reference_id) con el uid, y metadata solo se
                // escribe con la clave secreta. La cuenta de Stripe tiene más productos y Payment
                // Links que también llegan a este webhook, y un Payment Link acepta
                // ?client_reference_id=<lo que sea> en la URL: nunca deben dar Premium.
                // Además, el pago tiene que estar hecho: 'paid', o 'no_payment_required' (cupón del
                // 100 %). Con métodos de pago diferidos (SEPA…) la sesión se completa sin cobrar y
                // el Premium llega con checkout.session.async_payment_succeeded.
                if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
                    const s = event.data.object;
                    const userId = s.metadata?.user_id;
                    const fromApp = !!userId && s.client_reference_id === userId && s.mode === 'subscription';
                    const paid = s.payment_status === 'paid' || s.payment_status === 'no_payment_required';
                    if (!fromApp || !paid)
                        console.log('Stripe: sesión ignorada', event.id, event.type, s.mode, s.payment_status, fromApp ? 'app' : 'otro producto');
                    const planType = s.metadata?.plan_type || 'monthly';
                    const expDays = planType === 'annual' ? 365 : 30;
                    const exp = new Date(Date.now() + expDays * 864e5).toISOString();
                    if (fromApp && paid) {
                        await env.DB.prepare(
                            `UPDATE users SET plan='premium', plan_expires_at=?, stripe_customer_id=?, stripe_subscription_id=?, updated_at=? WHERE id=?`)
                            .bind(exp, s.customer || null, s.subscription || null, new Date().toISOString(), userId).run();
                        ctx.waitUntil(audit(env, null, 'plan_changed', userId, { plan: 'premium', planType, stripe_event: event.id }));
                        const u = await env.DB.prepare('SELECT email, name FROM users WHERE id=?').bind(userId).first();
                        if (u && u.email) {
                            ctx.waitUntil(sendEmail(env, {
                                to: u.email,
                                subject: '¡Bienvenido a Premium! - Contabilidad Personal',
                                html: premiumActivatedEmailHTML(u.name || '', planType)
                            }));
                        }
                    }
                }

                if (event.type === 'customer.subscription.deleted') {
                    const sub = event.data.object;
                    const subUser = await env.DB.prepare('SELECT id FROM users WHERE stripe_subscription_id=?').bind(sub.id).first();
                    await env.DB.prepare(
                        `UPDATE users SET plan='free', plan_expires_at=NULL WHERE stripe_subscription_id=?`)
                        .bind(sub.id).run();
                    if (subUser) ctx.waitUntil(audit(env, null, 'plan_changed', subUser.id, { plan: 'free', stripe_event: event.id }));
                }
                return json({ received: true }, 200, cors);
            }

            if (path === '/api/stripe/verify-session' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (await rateLimited(env, `rl:verify:${uid}`, 20, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);
                const { session_id } = await request.json();
                // Solo IDs de Checkout Session: el valor va en la URL de la API de Stripe
                // con la clave secreta, así que no puede apuntar a otro recurso.
                if (typeof session_id !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(session_id))
                    return json({ error: 'Sesión de pago inválida' }, 400, cors);
                const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
                    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
                });
                const session = await resp.json();
                // La sesión tiene que ser del usuario autenticado (create-checkout fija
                // client_reference_id y metadata.user_id con su id).
                const owner = session.client_reference_id || session.metadata?.user_id;
                if (!resp.ok || owner !== uid)
                    return json({ error: 'La sesión de pago no pertenece a este usuario' }, 403, cors);
                const paid = session.payment_status === 'paid';
                return json({ paid, plan: paid ? 'premium' : 'free' }, 200, cors);
            }

            // ---------- GOCARDLESS (Bank Account Data) ----------
            // Token de acceso cacheado en KV (caduca a las 24h)
            if (path.startsWith('/api/banking/')) {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                // Conexión bancaria = función Premium (getPlanLimits: 'bank_connection') y
                // cada requisición tiene coste en GoCardless: se exige en servidor, con el plan de D1.
                if (authUser.plan !== 'premium')
                    return json({ error: 'La conexión bancaria requiere Premium' }, 403, cors);
                // Cada llamada usa la cuenta de GoCardless de la app: máx. 60 por usuario y hora
                if (await rateLimited(env, `rl:banking:${uid}`, 60, 3600))
                    return json({ error: 'Demasiadas peticiones bancarias. Inténtalo más tarde.' }, 429, cors);
                const gcToken = await getGoCardlessToken(env);

                if (path === '/api/banking/institutions' && method === 'POST') {
                    const { country = 'ES' } = await request.json();
                    if (!/^[A-Z]{2}$/.test(String(country))) return json({ error: 'País inválido' }, 400, cors);
                    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/institutions/?country=${country}`, {
                        headers: { 'Authorization': `Bearer ${gcToken}`, 'Accept': 'application/json' }
                    });
                    if (!r.ok) return gcError('institutions', r, cors);
                    return json(await r.json(), 200, cors);
                }

                if (path === '/api/banking/requisition' && method === 'POST') {
                    const { institution_id } = await request.json();
                    if (typeof institution_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(institution_id))
                        return json({ error: 'Banco inválido' }, 400, cors);
                    const r = await fetch('https://bankaccountdata.gocardless.com/api/v2/requisitions/', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${gcToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            redirect: `${env.APP_URL}/dashboard.html?bank=connected`,
                            institution_id,
                            reference: `${uid}_${Date.now()}`,
                            user_language: 'ES'
                        })
                    });
                    if (!r.ok) return gcError('requisition', r, cors);
                    const req = await r.json();
                    return json(req, 200, cors); // contiene { id, link } -> redirige al usuario a req.link
                }

                if (path === '/api/banking/accounts' && method === 'GET') {
                    const requisitionId = url.searchParams.get('requisition_id');
                    if (!isUuid(requisitionId)) return json({ error: 'Requisición inválida' }, 400, cors);
                    const req = await getOwnedRequisition(gcToken, requisitionId, uid);
                    if (!req) return json({ error: 'No encontrado' }, 404, cors);
                    return json(req, 200, cors);
                }

                if (path === '/api/banking/sync' && method === 'POST') {
                    const { account_id } = await request.json();
                    if (!isUuid(account_id)) return json({ error: 'Cuenta inválida' }, 400, cors);
                    if (!(await gcAccountOwnedBy(env, gcToken, account_id, uid)))
                        return json({ error: 'No encontrado' }, 404, cors);
                    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/accounts/${account_id}/transactions/`, {
                        headers: { 'Authorization': `Bearer ${gcToken}` }
                    });
                    if (!r.ok) return gcError('sync', r, cors);
                    const data = await r.json();
                    return json(data, 200, cors); // el frontend mapea a movimientos contables
                }
            }

                 return json({ error: 'Not found', path }, 404, cors);

        } catch (err) {
            // No filtrar detalles internos al cliente; registrar el detalle en el servidor.
            console.error('Error 500', requestId, err && err.stack ? err.stack : err);
            return json({ error: 'Server error', requestId }, 500, { ...cors, 'X-Request-Id': requestId });
        }
    },

    // ---------- CRON DIARIO DE AVISOS PUSH ----------
    async scheduled(event, env, ctx) {
        const now = new Date();

        // Usuarios premium con al menos una suscripción push
        const { results: users } = await env.DB.prepare(
            `SELECT DISTINCT u.id, u.plan FROM users u
             JOIN push_subscriptions ps ON ps.user_id = u.id
             WHERE u.plan = 'premium'`).all();

        for (const user of users) {
            try {
                // Datos del usuario: cuentas, movimientos de los últimos 6 meses
                // (cubre mes actual, anterior y el histórico del Índice Flow),
                // plan de autocontrol y asociaciones cuenta→grupo.
                const sinceDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
                const since = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, '0')}-01`;
                const { results: movs } = await env.DB.prepare(
                    'SELECT tipo, cantidad, fecha, cuenta_id, cuenta_destino_id FROM movements WHERE user_id=? AND fecha>=?')
                    .bind(user.id, since).all();
                const { results: accounts } = await env.DB.prepare(
                    'SELECT id, nombre, tipo, saldo_actual, is_fixed_cost, fixed_monthly_amount, fixed_due_day FROM accounts WHERE user_id=?')
                    .bind(user.id).all();
                const planRow = await env.DB.prepare('SELECT plan_data FROM autocontrol_plan WHERE user_id=?').bind(user.id).first();
                const assocRow = await env.DB.prepare('SELECT associations_data FROM autocontrol_associations WHERE user_id=?').bind(user.id).first();
                const plan = planRow ? JSON.parse(planRow.plan_data) : null;
                const associations = assocRow ? JSON.parse(assocRow.associations_data) : null;

                const avisos = computeDailyAlerts(now, movs, accounts, plan, associations);
                if (!avisos.length) continue;

                const { results: subs } = await env.DB.prepare(
                    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?').bind(user.id).all();

                // Máximo 3 pushes por usuario y día (los avisos ya vienen priorizados)
                let sent = 0;
                for (const aviso of avisos) {
                    if (sent >= 3) break;

                    // Deduplicación: INSERT en push_log; si falla por PK duplicada, no se envía
                    try {
                        await env.DB.prepare('INSERT INTO push_log (user_id, notif_key, sent_at) VALUES (?,?,?)')
                            .bind(user.id, aviso.notifKey, now.toISOString()).run();
                    } catch (e) {
                        continue; // ya enviado anteriormente
                    }

                    // Insertar también en el centro de notificaciones de la app
                    // (INSERT directo con el mismo formato que devuelve el GET /api/notifications)
                    await env.DB.prepare(
                        'INSERT INTO notifications (id,user_id,type,title,message,data,read,created_at) VALUES (?,?,?,?,?,?,?,?)')
                        .bind(crypto.randomUUID(), user.id, aviso.type, aviso.title, aviso.body,
                              JSON.stringify({ notifKey: aviso.notifKey }), 0, now.toISOString()).run();

                    // Enviar a todas las suscripciones del usuario
                    for (const sub of subs) {
                        await sendPush(env, sub, {
                            title: aviso.title,
                            body: aviso.body,
                            url: '/dashboard.html',
                            tag: aviso.notifKey
                        });
                    }
                    sent++;
                }
            } catch (e) {
                console.error('Cron push, usuario', user.id, ':', e);
            }
        }

        // ── Retención del registro de auditoría: 365 días ──
        try {
            await env.DB.prepare('DELETE FROM audit_log WHERE created_at < ?')
                .bind(new Date(Date.now() - 365 * 86400000).toISOString()).run();
        } catch (e) {
            console.error('Cron audit_log (¿migración 0002 aplicada?):', e && e.message);
        }

        // ── Solicitud de valoración al mes de registro (email, una sola vez) ──
        try {
            const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
            const { results: fbUsers } = await env.DB.prepare(
                `SELECT id, name, email FROM users
                 WHERE feedback_requested_at IS NULL AND created_at <= ?`)
                .bind(cutoff).all();

            for (const u of fbUsers) {
                try {
                    // Marcar ANTES de enviar: prioriza no repetir jamás la petición
                    await env.DB.prepare('UPDATE users SET feedback_requested_at=? WHERE id=?')
                        .bind(now.toISOString(), u.id).run();
                    await sendEmail(env, {
                        to: u.email,
                        subject: '¿Nos ayudas a mejorar Finance Flow?',
                        html: feedbackRequestEmailHTML('https://www.contabilidadpersonal.com/valoracion-finance-flow/')
                    });
                } catch (e) {
                    console.error('Cron feedback, usuario', u.id, ':', e);
                }
            }
        } catch (e) {
            console.error('Cron feedback:', e);
        }
    }
};

// ---------- Helpers GoCardless ----------
async function getGoCardlessToken(env) {
    const cached = await env.CACHE.get('gc_access_token');
    if (cached) return cached;
    const r = await fetch('https://bankaccountdata.gocardless.com/api/v2/token/new/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ secret_id: env.GOCARDLESS_SECRET_ID, secret_key: env.GOCARDLESS_SECRET_KEY })
    });
    const data = await r.json();
    // access expira en ~24h; lo cacheamos 23h por seguridad
    if (data.access) await env.CACHE.put('gc_access_token', data.access, { expirationTtl: 82800 });
    return data.access;
}

// Error del proveedor bancario: el detalle va al log, al cliente solo un mensaje genérico.
async function gcError(op, r, cors) {
    console.error('GoCardless', op, r.status, (await r.text().catch(() => '')).slice(0, 500));
    return json({ error: 'Error del proveedor bancario. Inténtalo más tarde.' }, 502, cors);
}

// Los IDs de requisiciones y cuentas de GoCardless son UUID. Validarlos impide
// que el valor del cliente salga del recurso previsto en la URL de la API.
function isUuid(v) {
    return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Una requisición es del usuario si su `reference` la generó este Worker para él
// (`${uid}_${timestamp}` en /api/banking/requisition). Es la única prueba de
// propiedad que el cliente no puede escribir (bank_connections sí la escribe él).
async function getOwnedRequisition(gcToken, requisitionId, uid) {
    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/requisitions/${requisitionId}/`, {
        headers: { 'Authorization': `Bearer ${gcToken}` }
    });
    if (!r.ok) return null;
    const req = await r.json();
    return (typeof req.reference === 'string' && req.reference.startsWith(`${uid}_`)) ? req : null;
}

// Una cuenta de GoCardless es del usuario si aparece en una requisición SUYA.
// bank_connections solo aporta las requisiciones candidatas; la propiedad se
// comprueba siempre contra GoCardless (máx. 10 para acotar llamadas).
async function gcAccountOwnedBy(env, gcToken, accountId, uid) {
    const { results } = await env.DB.prepare(
        'SELECT DISTINCT requisition_id FROM bank_connections WHERE user_id=? AND requisition_id IS NOT NULL LIMIT 10')
        .bind(uid).all();
    for (const row of results || []) {
        if (!isUuid(row.requisition_id)) continue;
        const req = await getOwnedRequisition(gcToken, row.requisition_id, uid);
        if (req && Array.isArray(req.accounts) && req.accounts.includes(accountId)) return true;
    }
    return false;
}

// ---------- Verificación firma Stripe ----------
async function verifyStripeSignature(payload, sigHeader, secret) {
    if (!sigHeader || !secret) return false;
    try {
        const items = sigHeader.split(',').map(kv => kv.trim().split('='));
        const t = (items.find(([k]) => k === 't') || [])[1];
        // Stripe envía una firma v1 por cada secreto activo (p. ej. al rotar el
        // secreto del webhook): basta con que coincida una.
        const v1s = items.filter(([k]) => k === 'v1').map(([, v]) => v || '');
        const signedPayload = `${t}.${payload}`;
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
        const expected = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
        // B6: comparación en tiempo constante
        if (!v1s.some(v1 => timingSafeEqual(expected, v1))) return false;
        // B3: anti-replay — rechazar eventos fuera de una tolerancia de 5 minutos
        const ts = Number(t);
        if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
        return true;
    } catch { return false; }
}
// ---------- Resend correos app ----------
async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY no configurada');
    return false;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Finance Flow <no-reply@contabilidadpersonal.com>',
        to: [to],
        subject,
        html
      })
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('Error Resend:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Excepción enviando email:', e);
    return false;
  }
}
// El nombre lo escribe el usuario (o quien se registra con un email ajeno): se escapa antes
// de meterlo en el HTML. Los emails que salen sin que nadie haya demostrado ser el dueño del
// email (bienvenida, recuperación, valoración) no lo llevan: si no, cualquiera podría mandar
// a cualquier dirección un email de la marca con su propio texto (p. ej. un enlace de phishing).
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function welcomeEmailHTML() {
  return `
  <!DOCTYPE html>
  <html lang="es">
  <body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
          <tr><td style="background:#0158C9;padding:24px 32px;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;"><img src="https://app.contabilidadpersonal.com/public/logo.png" width="36" height="36" alt="Finance Flow" style="display:block;border-radius:8px;"></td>
              <td style="vertical-align:middle;padding-left:12px;"><h1 style="margin:0;color:#ffffff;font-size:22px;">Finance Flow</h1></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:32px;">
            <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">¡Bienvenido a Finance Flow! 👋</h2>
            <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
              Gracias por unirte a Finance Flow. Ya puedes empezar a controlar tus finanzas con precisión:
              crea tus cuentas, registra movimientos y descubre tu situación financiera real.
            </p>
            <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
              Entra en tu panel y da de alta tu primera cuenta para comenzar.
            </p>
            <a href="https://app.contabilidadpersonal.com/dashboard"
               style="display:inline-block;background:#0158C9;color:#ffffff;text-decoration:none;
                      padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">
              Ir a mi panel
            </a>
            <p style="margin:28px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">
              Si no has creado esta cuenta, puedes ignorar este correo.
            </p>
          </td></tr>
          <tr><td style="background:#f4f6f9;padding:20px 32px;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">
              © 2026 Contabilidad Personal · contabilidadpersonal.com
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
}
function premiumActivatedEmailHTML(name, planType) {
    name = escapeHtml(name);
    const planLabel = planType === 'annual' ? 'anual' : 'mensual';
    return `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#61CE70;padding:28px 32px;"><h1 style="margin:0;color:#ffffff;font-size:22px;">¡Ya eres Premium! 🎉</h1></td></tr>
    <tr><td style="padding:32px;">
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Gracias, ${name}</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Tu suscripción <strong>Premium ${planLabel}</strong> está activa. Ya tienes acceso al registro automático de movimientos (importa tus extractos CSV/Excel), plan de autocontrol, reglas de registro automático y notificaciones inteligentes.</p>
    <a href="https://app.contabilidadpersonal.com/dashboard" style="display:inline-block;background:#0158C9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Ir a mi panel</a>
    </td></tr>
    <tr><td style="background:#f4f6f9;padding:20px 32px;text-align:center;"><p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 Contabilidad Personal · contabilidadpersonal.com</p></td></tr>
    </table></td></tr></table></body></html>`;
}
function resetPasswordEmailHTML(link) {
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#0158C9;padding:24px 32px;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;"><img src="https://app.contabilidadpersonal.com/public/logo.png" width="36" height="36" alt="Finance Flow" style="display:block;border-radius:8px;"></td>
        <td style="vertical-align:middle;padding-left:12px;"><h1 style="margin:0;color:#ffffff;font-size:22px;">Finance Flow</h1></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:32px;">
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Recupera tu contraseña</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hola, hemos recibido una solicitud para restablecer tu contraseña. Pulsa el botón para crear una nueva. Este enlace caduca en 1 hora.</p>
    <a href="${link}" style="display:inline-block;background:#0158C9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Restablecer contraseña</a>
    <p style="margin:24px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">Si no has solicitado esto, ignora este correo. Tu contraseña no cambiará.</p>
    </td></tr>
    <tr><td style="background:#f4f6f9;padding:20px 32px;text-align:center;"><p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 Finance Flow · contabilidadpersonal.com</p></td></tr>
    </table></td></tr></table></body></html>`;
}
function feedbackRequestEmailHTML(link) {
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <tr><td style="background:#0158C9;padding:24px 32px;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;"><img src="https://app.contabilidadpersonal.com/public/logo.png" width="36" height="36" alt="Finance Flow" style="display:block;border-radius:8px;"></td>
        <td style="vertical-align:middle;padding-left:12px;"><h1 style="margin:0;color:#ffffff;font-size:22px;">Finance Flow</h1></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:32px;">
    <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">¿Nos ayudas a mejorar?</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hola, ya llevas un mes usando Finance Flow. ¡Gracias por confiar en nosotros para poner orden en tus finanzas!</p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">Nos encantaría conocer tu opinión: qué te está funcionando y qué podríamos hacer mejor. Son solo 2 minutos y nos ayuda muchísimo.</p>
    <a href="${link}" style="display:inline-block;background:#0158C9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Dar mi opinión</a>
    <p style="margin:28px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">Si ahora no es buen momento, no pasa nada: no volveremos a insistir.</p>
    </td></tr>
    <tr><td style="background:#f4f6f9;padding:20px 32px;text-align:center;"><p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 Contabilidad Personal · contabilidadpersonal.com</p></td></tr>
    </table></td></tr></table></body></html>`;
}
