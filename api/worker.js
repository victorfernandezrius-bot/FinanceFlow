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
//              POST /api/stripe/verify-session
//   GoCardless:POST /api/banking/institutions, /api/banking/requisition,
//              GET /api/banking/accounts, POST /api/banking/sync
//   Portfolio: POST /api/portfolio/operations, GET /api/portfolio/holdings,
//              POST /api/portfolio/close, GET /api/portfolio/journal,
//              GET /api/portfolio/allocation, GET /api/portfolio/history,
//              GET /api/portfolio/daily-return,
//              GET /api/portfolio/prices?tickers=AAPL,MSFT (batch a Twelve Data)
//   UI:        GET /cartera.html (página standalone de la cartera)
//
// Bindings (wrangler.toml): DB (D1), CACHE (KV)
// Secrets: JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//          GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY
// ============================================================

import { buildPushPayload } from '@block65/webcrypto-web-push';
import { CARTERA_HTML } from './cartera-page.js';
import { aggregate, positionFrom, openPositions, openQty, computeClose, buildJournal, computeAllocation, EPS }
    from './cartera-logic.js';

const json = (data, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
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
        'Access-Control-Allow-Credentials': 'true'
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

async function getAuthUser(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return null;
    return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first();
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

// ---------- Web Push (VAPID + RFC 8291 vía @block65/webcrypto-web-push) ----------
// subscription: fila de push_subscriptions ({endpoint, p256dh, auth}).
// payload: { title, body, url, tag }. Si la suscripción está muerta (404/410), se borra.
async function sendPush(env, subscription, payload) {
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
        if (res.status === 404 || res.status === 410) {
            // Suscripción muerta: eliminarla
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?')
                .bind(subscription.endpoint).run();
            return false;
        }
        return res.ok;
    } catch (e) {
        console.error('sendPush:', e);
        return false;
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
                        title: `Presupuesto de ${g.nombre} superado`,
                        body: `Has superado tu presupuesto de ${g.nombre} en ${fmtEur(exceso)} € este mes (${fmtEur(gastado)} € de ${fmtEur(presupuesto)} €).`
                    });
                } else if (pct >= 80) {
                    al80.push({
                        type: 'presupuesto_80',
                        notifKey: `presupuesto_80:${g.nombre}:${monthStr}`,
                        title: `Presupuesto de ${g.nombre} al ${pct} %`,
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
                    title: `Próximo vencimiento: ${a.nombre}`,
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
                title: `Tu resumen de ${mesNombre}`,
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
                title: 'Te echamos de menos',
                body: `Llevas ${dias} días sin registrar movimientos. Mantén tus finanzas al día.`
            });
        }
    }

    return [...superados, ...al80, ...costesFijos, ...resumen, ...inactividad];
}

// ============================================================
// CARTERA DE INVERSIÓN — helpers
// ============================================================

// TTL de la caché de precios en KV (segundos). 900s = 15 min.
// Para probar la degradación a "stale" en local, bájalo temporalmente a 10.
const PRICE_TTL = 900;

// Tipos de activo admitidos para cartera_activos.
const TIPOS_ACTIVO = ['accion', 'etf', 'fondo', 'cripto'];

// Degradación a "stale" para un ticker: último precio conocido desde el backup
// `price_bak:{ticker}` (sin TTL) o, si no existe, precio nulo. Nunca lanza error.
async function _stalePrice(ticker, env) {
    const backupRaw = await env.CACHE.get(`price_bak:${ticker}`);
    if (backupRaw) {
        try { return { ...JSON.parse(backupRaw), stale: true }; } catch { /* ignore */ }
    }
    return { ticker, price: null, fetched_at: null, stale: true };
}

// Precios de varios tickers con estrategia cache-first sobre KV (env.CACHE) y
// UNA sola llamada batch a Twelve Data para los que falten:
//   1) Para cada ticker, si hay precio fresco en `price:{ticker}` (dentro del
//      TTL) se usa directamente (no entra en la llamada externa).
//   2) Con los tickers que faltan se hace UNA única petición batch
//      `/price?symbol=A,B,C`. Twelve Data devuelve `{price:"..."}` cuando se pide
//      un único símbolo y `{ A:{price:"..."}, B:{status:"error"} }` cuando se
//      piden varios; se parsean ambos formatos.
//   3) Si el batch falla del todo (red, apikey, rate limit global) o un ticker
//      concreto no viene o viene con error, ese ticker degrada a `stale:true`
//      con su último precio conocido (backup sin TTL). Nunca error duro.
// El backup sin TTL se mantiene aparte porque KV borra la clave con TTL al
// expirar, y entonces no podríamos servir "el último precio aunque haya expirado".
export async function getTickerPrices(tickers, env) {
    const result = {};
    const misses = [];

    // 1) Cache-first por ticker.
    for (const ticker of tickers) {
        const cachedRaw = await env.CACHE.get(`price:${ticker}`);
        if (cachedRaw) {
            try { result[ticker] = { ...JSON.parse(cachedRaw), stale: false }; continue; } catch { /* refetch */ }
        }
        misses.push(ticker);
    }
    if (!misses.length) return result;

    // 2) UNA sola llamada batch para los que faltan.
    let batch = null;
    try {
        const apiKey = env.TWELVE_DATA_API_KEY;
        if (!apiKey) throw new Error('TWELVE_DATA_API_KEY no configurada');
        const symbol = misses.map(encodeURIComponent).join(',');
        const resp = await fetch(`https://api.twelvedata.com/price?symbol=${symbol}&apikey=${apiKey}`);
        const data = await resp.json();
        // Error global (apikey inválida, límite de plan agotado, etc.).
        if (data && data.status === 'error') throw new Error(data.message || 'Error de Twelve Data');
        batch = data;
    } catch (err) {
        // Batch caído por completo: todos los que faltan degradan a stale.
        for (const ticker of misses) result[ticker] = await _stalePrice(ticker, env);
        return result;
    }

    // 3) Resolver cada ticker que faltaba a partir de la respuesta batch.
    const now = new Date().toISOString();
    for (const ticker of misses) {
        // Formato 1 símbolo -> { price }; varios -> { TICKER: { price | status:'error' } }.
        let priceStr = null;
        if (misses.length === 1 && batch && batch.price != null) {
            priceStr = batch.price;
        } else if (batch && batch[ticker] && batch[ticker].status !== 'error' && batch[ticker].price != null) {
            priceStr = batch[ticker].price;
        }
        const price = priceStr != null ? parseFloat(priceStr) : NaN;
        if (isFinite(price)) {
            const payload = { ticker, price, fetched_at: now };
            await env.CACHE.put(`price:${ticker}`, JSON.stringify(payload), { expirationTtl: PRICE_TTL });
            await env.CACHE.put(`price_bak:${ticker}`, JSON.stringify(payload));
            result[ticker] = { ...payload, stale: false };
        } else {
            // Ticker ausente o con error en el batch: degradar a stale.
            result[ticker] = await _stalePrice(ticker, env);
        }
    }
    return result;
}

// Benchmarks soportados por /api/portfolio/history. Los símbolos de índice de
// Twelve Data pueden no coincidir 1:1 con estos alias; conviene verificarlos
// contra la documentación de Twelve Data antes de producción.
const BENCHMARKS = {
    SP500:     { symbol: 'SPX',  nombre: 'S&P 500' },
    NASDAQ100: { symbol: 'NDX',  nombre: 'Nasdaq 100' },
    DOWJONES:  { symbol: 'DJI',  nombre: 'Dow Jones' },
    IBEX35:    { symbol: 'IBEX', nombre: 'IBEX 35' },
    CAC40:     { symbol: 'CAC',  nombre: 'CAC 40' },
    DAX:       { symbol: 'DAX',  nombre: 'DAX' },
    FTSE100:   { symbol: 'FTSE', nombre: 'FTSE 100' }
};

// Traduce un código de periodo a fecha de inicio (YYYY-MM-DD) respecto a hoy.
function periodoToStartDate(periodo, refDate) {
    const d = new Date(refDate.getTime());
    const p = String(periodo || '').toUpperCase();
    if (p === '1M' || p === 'MENSUAL') d.setMonth(d.getMonth() - 1);
    else if (p === '3M' || p === 'TRIMESTRAL') d.setMonth(d.getMonth() - 3);
    else if (p === '6M' || p === 'SEMESTRAL') d.setMonth(d.getMonth() - 6);
    else if (p === '1A' || p === '1Y' || p === 'ANUAL') d.setFullYear(d.getFullYear() - 1);
    else if (p === 'YTD') { d.setMonth(0); d.setDate(1); }
    else if (p === 'MAX') return '1970-01-01';
    else d.setFullYear(d.getFullYear() - 1); // por defecto, 1 año
    return d.toISOString().slice(0, 10);
}

// Serie del benchmark alineada a las fechas de la cartera. Cache-first en KV
// (`benchmark:{symbol}:{fecha}`, sin TTL: un cierre histórico ya no cambia).
// Best-effort: si la API externa falla, se sirve lo que haya en caché.
async function getBenchmarkSeries(env, symbol, fechas) {
    if (!fechas || !fechas.length) return [];
    const start = fechas[0], end = fechas[fechas.length - 1];
    try {
        const apiKey = env.TWELVE_DATA_API_KEY;
        if (!apiKey) throw new Error('TWELVE_DATA_API_KEY no configurada');
        const u = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}`
            + `&interval=1day&start_date=${start}&end_date=${end}&order=ASC&apikey=${apiKey}`;
        const r = await fetch(u);
        const d = await r.json();
        if (d && d.status !== 'error' && Array.isArray(d.values)) {
            for (const v of d.values) {
                const fecha = (v.datetime || '').slice(0, 10);
                const close = parseFloat(v.close);
                if (fecha && isFinite(close)) {
                    await env.CACHE.put(`benchmark:${symbol}:${fecha}`, String(close));
                }
            }
        }
    } catch (e) { /* best-effort: caemos a lo cacheado */ }

    const serie = [];
    for (const fecha of fechas) {
        const raw = await env.CACHE.get(`benchmark:${symbol}:${fecha}`);
        if (raw != null) {
            const val = parseFloat(raw);
            if (isFinite(val)) serie.push({ fecha, valor: val });
        }
    }
    return serie;
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

        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

        try {
            // ---------- HEALTH ----------
            if (path === '/api/health') return json({ ok: true, ts: Date.now() }, 200, cors);

            // ---------- UI CARTERA (página standalone, servida por el Worker) ----------
            // Pública (la propia página pide el JWT); mismo origen que la API para
            // poder verificarla con `wrangler dev` sin CORS. En producción la web
            // estática va por Pages; esto es sobre todo para pruebas locales.
            if ((path === '/cartera' || path === '/cartera.html') && method === 'GET') {
                return new Response(CARTERA_HTML, {
                    status: 200,
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // ---------- AUTH ----------
            if (path === '/api/auth/register' && method === 'POST') {
                const { email, password, name } = await request.json();
                if (!email || !password || !name) return json({ error: 'Faltan campos' }, 400, cors);
                if (password.length < 8) return json({ error: 'Contraseña mínima 8 caracteres' }, 400, cors);

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

                const token = await signJWT({ sub: id, exp: Math.floor(Date.now() / 1e3) + 30 * 86400 }, env.JWT_SECRET);
        const user = { id, email: email.toLowerCase(), name, plan, plan_expires_at: planExp, created_at: now };
        // Enviar email de bienvenida (sin bloquear la respuesta)
        ctx.waitUntil(sendEmail(env, {
          to: email.toLowerCase(),
          subject: '¡Bienvenido a Finance Flow!',
          html: welcomeEmailHTML(name)
        }));
        return json({ success: true, token, currentUser: user }, 201, cors);
            }

            if (path === '/api/auth/login' && method === 'POST') {
                // B4: máx. 10 intentos por IP cada 15 min (anti fuerza bruta)
                const loginIp = request.headers.get('CF-Connecting-IP') || 'unknown';
                if (await rateLimited(env, `rl:login:${loginIp}`, 10, 900))
                    return json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' }, 429, cors);
                const { email, password } = await request.json();
                const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
                    .bind((email || '').toLowerCase()).first();
                if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash)))
                    return json({ error: 'Credenciales inválidas' }, 401, cors);

                const token = await signJWT({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, env.JWT_SECRET);
                delete user.password_hash;
                return json({ success: true, token, currentUser: user }, 200, cors);
            }

            if (path === '/api/auth/google' && method === 'POST') {
                const { credential } = await request.json();
                if (!credential) return json({ error: 'Falta credential' }, 400, cors);

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
                if (!user) {
                    user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
                        .bind(gEmail).first();
                    if (user) {
                        // Cuenta existente por email: vincular con Google
                        await env.DB.prepare(
                            `UPDATE users SET google_sub=?, auth_provider=COALESCE(auth_provider,'google'),
                                picture=COALESCE(?, picture), updated_at=? WHERE id=?`)
                            .bind(payload.sub, payload.picture ?? null, now, user.id).run();
                        user.google_sub = payload.sub;
                        user.auth_provider = user.auth_provider || 'google';
                        user.picture = payload.picture ?? user.picture;
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
                            html: welcomeEmailHTML(gName)
                        }));
                    }
                }

                const gToken = await signJWT({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, env.JWT_SECRET);
                delete user.password_hash;
                return json({ success: true, token: gToken, currentUser: user }, isNew ? 201 : 200, cors);
            }

            if (path === '/api/auth/session' && method === 'GET') {
                const user = await getAuthUser(request, env);
                if (!user) return json({ token: null, currentUser: null }, 200, cors);
                delete user.password_hash;
                return json({ token: 'valid', currentUser: user }, 200, cors);
            }

            if (path === '/api/auth/logout' && method === 'POST') {
                return json({ success: true }, 200, cors);
            }
            if (path === "/api/auth/forgot-password" && method === "POST") {
        const fp = await request.json();
        const fpEmail = (fp.email || "").toLowerCase();
        // B4: máx. 3 solicitudes por email/hora y 10 por IP/hora (anti bombardeo de emails).
        // Se responde igual que el flujo normal para no revelar el límite ni si el email existe.
        const fpIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (await rateLimited(env, `rl:reset:${fpEmail}`, 3, 3600) ||
            await rateLimited(env, `rl:reset-ip:${fpIp}`, 10, 3600)) {
          return json({ success: true }, 200, cors);
        }
        const fpUser = await env.DB.prepare("SELECT id, name, email FROM users WHERE email=?")
          .bind(fpEmail).first();
        if (fpUser) {
          const resetToken = crypto.randomUUID();
          await env.CACHE.put("reset:" + resetToken, fpUser.id, { expirationTtl: 3600 });
          const link = env.APP_URL + "/reset-password.html?token=" + resetToken;
          ctx.waitUntil(sendEmail(env, {
            to: fpUser.email,
            subject: "Recupera tu contraseña - Finance Flow",
            html: resetPasswordEmailHTML(fpUser.name || "", link)
          }));
        }
        return json({ success: true }, 200, cors);
      }
      if (path === "/api/auth/reset-password" && method === "POST") {
        const rp = await request.json();
        if (!rp.token || !rp.password || rp.password.length < 8)
          return json({ error: "Datos inválidos (contraseña mínima 8 caracteres)" }, 400, cors);
        const rpUserId = await env.CACHE.get("reset:" + rp.token);
        if (!rpUserId) return json({ error: "El enlace no es válido o ha caducado" }, 400, cors);
        const rpHash = await hashPassword(rp.password);
        await env.DB.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?")
          .bind(rpHash, new Date().toISOString(), rpUserId).run();
        await env.CACHE.delete("reset:" + rp.token);
        return json({ success: true }, 200, cors);
      }
            // A partir de aquí, todo requiere autenticación
            const authUser = await getAuthUser(request, env);
            const uid = authUser?.id;

            // ---------- USERS ----------
            if (path === '/api/users' && method === 'GET') {
                if (!authUser) return json({ error: 'No autorizado' }, 401, cors);
                // Solo devuelve el propio usuario (privacidad)
                delete authUser.password_hash;
                return json([authUser], 200, cors);
            }

            const userMatch = path.match(/^\/api\/users\/(.+)$/);
            if (userMatch) {
                if (!authUser || authUser.id !== userMatch[1]) return json({ error: 'No autorizado' }, 403, cors);
                if (method === 'GET') {  delete authUser.password_hash; return json(authUser, 200, cors); }
                if (method === 'PUT') {
                    const u = await request.json();
                    const now = new Date().toISOString();
                    // plan y plan_expires_at NUNCA se aceptan del cliente: solo el webhook
                    // de Stripe y verify-session pueden cambiarlos.
                    const newName = u.name ?? authUser.name;
                    await env.DB.prepare(
                        `UPDATE users SET name=?, updated_at=? WHERE id=?`)
                        .bind(newName, now, authUser.id).run();
                    delete authUser.password_hash;
                    return json({ ...authUser, name: newName, updated_at: now }, 200, cors);
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
            env.DB.prepare("DELETE FROM users WHERE id=?").bind(delId)
          ]);
          return json({ success: true }, 200, cors);
        }
      }
            
            // ---------- ACCOUNTS ----------
            if (path === '/api/accounts') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM accounts WHERE user_id=?').bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const a = await request.json();
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
                    const { results } = await env.DB.prepare('SELECT * FROM movements WHERE user_id=?').bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const m = await request.json();
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
                    const r = await request.json();
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
                const { rules } = await request.json();
                await env.DB.prepare('DELETE FROM categorization_rules WHERE user_id=?').bind(uid).run();
                for (const r of rules) {
                    await env.DB.prepare(
                        `INSERT INTO categorization_rules (id,user_id,name,keywords,account_type,account_id,account_name,enabled,is_default,created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?)`)
                        .bind(r.id, uid, r.name, JSON.stringify(r.keywords || []), r.accountType ?? null,
                              r.accountId ?? null, r.accountName ?? null, r.enabled ? 1 : 0,
                              r.isDefault ? 1 : 0, r.createdAt || new Date().toISOString()).run();
                }
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
                    const plan = await request.json();
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
                    const assoc = await request.json();
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
                    const { results } = await env.DB.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC').bind(uid).all();
                    return json(results.map(n => ({ ...n, read: !!n.read, data: n.data ? JSON.parse(n.data) : {} })), 200, cors);
                }
                if (method === 'POST') {
                    const { notifications } = await request.json();
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
                    await env.DB.prepare(
                        `INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth,user_agent,created_at)
                         VALUES (?,?,?,?,?,?,?)
                         ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,
                            p256dh=excluded.p256dh, auth=excluded.auth`)
                        .bind(crypto.randomUUID(), uid, sub.endpoint, sub.keys.p256dh, sub.keys.auth,
                              request.headers.get('User-Agent') || null, new Date().toISOString()).run();
                    return json({ success: true }, 200, cors);
                }
                if (method === 'DELETE') {
                    const { endpoint } = await request.json();
                    await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?')
                        .bind(uid, endpoint || '').run();
                    return json({ success: true }, 200, cors);
                }
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
                    const { results } = await env.DB.prepare('SELECT * FROM bank_connections WHERE user_id=?').bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const c = await request.json();
                    await env.DB.prepare(
                        `INSERT INTO bank_connections (id,user_id,bank_code,bank_name,institution_id,requisition_id,
                            gocardless_account_id,linked_account_id,status,is_active,last_sync_at,created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET status=excluded.status, is_active=excluded.is_active,
                            gocardless_account_id=excluded.gocardless_account_id, last_sync_at=excluded.last_sync_at`)
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
                    const row = await env.DB.prepare('SELECT * FROM import_info WHERE user_id=? AND bank_code=?').bind(uid, bankCode).first();
                    return json(row || null, 200, cors);
                }
                if (method === 'POST') {
                    const { bankCode, importInfo } = await request.json();
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
                if (!resp.ok) return json({ error: session.error?.message || 'Error Stripe' }, 500, cors);
                return json({ checkout_url: session.url, session_id: session.id }, 200, cors);
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

                if (event.type === 'checkout.session.completed') {
                    const s = event.data.object;
                    const userId = s.metadata?.user_id || s.client_reference_id;
                    const planType = s.metadata?.plan_type || 'monthly';
                    const expDays = planType === 'annual' ? 365 : 30;
                    const exp = new Date(Date.now() + expDays * 864e5).toISOString();
                    if (userId) {
                        await env.DB.prepare(
                            `UPDATE users SET plan='premium', plan_expires_at=?, stripe_customer_id=?, stripe_subscription_id=?, updated_at=? WHERE id=?`)
                            .bind(exp, s.customer || null, s.subscription || null, new Date().toISOString(), userId).run();
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
                    await env.DB.prepare(
                        `UPDATE users SET plan='free', plan_expires_at=NULL WHERE stripe_subscription_id=?`)
                        .bind(sub.id).run();
                }
                return json({ received: true }, 200, cors);
            }

            if (path === '/api/stripe/verify-session' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const { session_id } = await request.json();
                const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
                    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
                });
                const session = await resp.json();
                const paid = session.payment_status === 'paid';
                return json({ paid, plan: paid ? 'premium' : 'free' }, 200, cors);
            }

            // ---------- GOCARDLESS (Bank Account Data) ----------
            // Token de acceso cacheado en KV (caduca a las 24h)
            if (path.startsWith('/api/banking/')) {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const gcToken = await getGoCardlessToken(env);

                if (path === '/api/banking/institutions' && method === 'POST') {
                    const { country = 'ES' } = await request.json();
                    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/institutions/?country=${country}`, {
                        headers: { 'Authorization': `Bearer ${gcToken}`, 'Accept': 'application/json' }
                    });
                    return json(await r.json(), 200, cors);
                }

                if (path === '/api/banking/requisition' && method === 'POST') {
                    const { institution_id } = await request.json();
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
                    const req = await r.json();
                    return json(req, 200, cors); // contiene { id, link } -> redirige al usuario a req.link
                }

                if (path === '/api/banking/accounts' && method === 'GET') {
                    const requisitionId = url.searchParams.get('requisition_id');
                    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/requisitions/${requisitionId}/`, {
                        headers: { 'Authorization': `Bearer ${gcToken}` }
                    });
                    return json(await r.json(), 200, cors);
                }

                if (path === '/api/banking/sync' && method === 'POST') {
                    const { account_id } = await request.json();
                    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/accounts/${account_id}/transactions/`, {
                        headers: { 'Authorization': `Bearer ${gcToken}` }
                    });
                    const data = await r.json();
                    return json(data, 200, cors); // el frontend mapea a movimientos contables
                }
            }

            // ---------- CARTERA DE INVERSIÓN v2 (basada en histórico de operaciones) ----------
            // POST /api/portfolio/operations — registra una compra o venta.
            if (path === '/api/portfolio/operations' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const o = await request.json();
                if (!o || !o.ticker || !o.tipo_activo || !o.tipo_operacion || !o.fecha
                    || o.cantidad == null || o.precio == null) {
                    return json({ error: 'Campos obligatorios: ticker, tipo_activo, tipo_operacion, fecha, cantidad, precio' }, 400, cors);
                }
                if (!TIPOS_ACTIVO.includes(o.tipo_activo)) {
                    return json({ error: `tipo_activo inválido. Debe ser uno de: ${TIPOS_ACTIVO.join(', ')}` }, 400, cors);
                }
                if (o.tipo_operacion !== 'compra' && o.tipo_operacion !== 'venta') {
                    return json({ error: "tipo_operacion debe ser 'compra' o 'venta'" }, 400, cors);
                }
                if (!/^\d{4}-\d{2}-\d{2}$/.test(o.fecha)) {
                    return json({ error: 'fecha debe tener formato YYYY-MM-DD' }, 400, cors);
                }
                const cantidad = Number(o.cantidad);
                if (!isFinite(cantidad) || cantidad <= 0) return json({ error: 'cantidad debe ser un número positivo (> 0)' }, 400, cors);
                const precio = Number(o.precio);
                if (!isFinite(precio) || precio <= 0) return json({ error: 'precio debe ser un número positivo (> 0)' }, 400, cors);
                const comision = o.comision != null ? Number(o.comision) : 0;
                if (!isFinite(comision) || comision < 0) return json({ error: 'comision no puede ser negativa' }, 400, cors);
                const ticker = String(o.ticker).toUpperCase();

                if (o.tipo_operacion === 'venta') {
                    const { results: prev } = await env.DB.prepare(
                        'SELECT * FROM cartera_operaciones WHERE usuario_id=? AND ticker=?').bind(uid, ticker).all();
                    const abierta = openQty(prev, ticker);
                    if (cantidad > abierta + EPS) {
                        return json({ error: `No puedes vender ${cantidad} de ${ticker}: solo tienes ${abierta} abiertas.` }, 400, cors);
                    }
                }
                const res = await env.DB.prepare(
                    `INSERT INTO cartera_operaciones
                        (usuario_id,ticker,tipo_activo,tipo_operacion,fecha,cantidad,precio,comision,moneda,broker_origen,created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
                    .bind(uid, ticker, o.tipo_activo, o.tipo_operacion, o.fecha, cantidad, precio, comision,
                          o.moneda || 'EUR', o.broker_origen ?? null, new Date().toISOString()).run();
                const newId = res.meta && res.meta.last_row_id;
                // Devolver la operación creada + la posición recalculada del ticker.
                const { results: all } = await env.DB.prepare(
                    'SELECT * FROM cartera_operaciones WHERE usuario_id=? AND ticker=?').bind(uid, ticker).all();
                const agg = aggregate(all).get(ticker);
                return json({ id: newId, ticker, tipo_operacion: o.tipo_operacion,
                              posicion: agg ? positionFrom(agg) : null }, 201, cors);
            }

            // GET /api/portfolio/holdings — posiciones abiertas agregadas del histórico.
            if (path === '/api/portfolio/holdings' && method === 'GET') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const { results } = await env.DB.prepare(
                    'SELECT * FROM cartera_operaciones WHERE usuario_id=? ORDER BY fecha ASC, id ASC').bind(uid).all();
                return json(openPositions(results), 200, cors);
            }

            // POST /api/portfolio/close — cierra la posición abierta de un ticker (venta total).
            if (path === '/api/portfolio/close' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const b = await request.json();
                if (!b || !b.ticker || b.precio_cierre == null || !b.fecha_cierre) {
                    return json({ error: 'Campos obligatorios: ticker, precio_cierre, fecha_cierre' }, 400, cors);
                }
                if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha_cierre)) {
                    return json({ error: 'fecha_cierre debe tener formato YYYY-MM-DD' }, 400, cors);
                }
                const precioCierre = Number(b.precio_cierre);
                if (!isFinite(precioCierre) || precioCierre <= 0) return json({ error: 'precio_cierre debe ser un número positivo (> 0)' }, 400, cors);
                const comSalida = b.comision_salida != null ? Number(b.comision_salida) : 0;
                if (!isFinite(comSalida) || comSalida < 0) return json({ error: 'comision_salida no puede ser negativa' }, 400, cors);
                const ticker = String(b.ticker).toUpperCase();

                const { results } = await env.DB.prepare(
                    'SELECT * FROM cartera_operaciones WHERE usuario_id=? AND ticker=?').bind(uid, ticker).all();
                const cl = computeClose(results, ticker, precioCierre, comSalida);
                if (!cl) return json({ error: `No hay posición abierta de ${ticker} para cerrar` }, 400, cors);

                await env.DB.prepare(
                    `INSERT INTO cartera_operaciones
                        (usuario_id,ticker,tipo_activo,tipo_operacion,fecha,cantidad,precio,comision,moneda,broker_origen,created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
                    .bind(uid, ticker, cl.tipo_activo, 'venta', b.fecha_cierre, cl.cantidad, precioCierre, comSalida,
                          cl.moneda, b.broker_origen ?? null, new Date().toISOString()).run();

                return json({
                    ticker, cantidad_cerrada: cl.cantidad, precio_medio: cl.precio_medio, precio_cierre: precioCierre,
                    comision_entrada_proporcional: cl.comision_entrada_proporcional, comision_salida: comSalida,
                    beneficio: cl.beneficio, rentabilidad_pct: cl.rentabilidad_pct
                }, 200, cors);
            }

            // GET /api/portfolio/journal — diario de operaciones con filtros + totales.
            if (path === '/api/portfolio/journal' && method === 'GET') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                // El P&L realizado se calcula sobre TODO el histórico (para que el precio
                // medio sea correcto); los filtros se aplican después, solo a la vista.
                const { results: allOps } = await env.DB.prepare(
                    'SELECT * FROM cartera_operaciones WHERE usuario_id=? ORDER BY fecha ASC, id ASC').bind(uid).all();
                const { rows } = buildJournal(allOps);

                const desde = url.searchParams.get('desde');
                const hasta = url.searchParams.get('hasta');
                const fTicker = url.searchParams.get('ticker');
                const fTipo = url.searchParams.get('tipo_operacion');
                let view = rows;
                if (desde) view = view.filter(r => r.fecha >= desde);
                if (hasta) view = view.filter(r => r.fecha <= hasta);
                if (fTicker) view = view.filter(r => r.ticker === String(fTicker).toUpperCase());
                if (fTipo) view = view.filter(r => r.tipo_operacion === fTipo);

                const ventas = view.filter(r => r.tipo_operacion === 'venta');
                const beneficio_total = ventas.reduce((a, r) => a + (r.beneficio || 0), 0);
                const baseTotal = ventas.reduce((a, r) => a + (r.base_venta || 0), 0);
                // Comisión real pagada por operación: compra -> comision_entrada; venta -> comision_salida.
                const comisiones_totales = view.reduce((a, r) =>
                    a + (r.tipo_operacion === 'compra' ? (r.comision_entrada || 0) : (r.comision_salida || 0)), 0);
                const totales = {
                    beneficio_total,
                    comisiones_totales,
                    rentabilidad_pct_media_ponderada: baseTotal > 0 ? (beneficio_total / baseTotal) * 100 : 0,
                    peso_total: openPositions(allOps).length > 0 ? 100 : 0
                };
                // No exponemos el campo interno base_venta.
                const cleanRows = view.map(({ base_venta, ...r }) => r);
                return json({ rows: cleanRows, totales }, 200, cors);
            }

            // GET /api/portfolio/allocation — peso de cada posición sobre el valor de mercado.
            if (path === '/api/portfolio/allocation' && method === 'GET') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const { results } = await env.DB.prepare(
                    'SELECT * FROM cartera_operaciones WHERE usuario_id=?').bind(uid).all();
                const pos = openPositions(results);
                const tickers = [...new Set(pos.map(p => p.ticker))];
                const prices = tickers.length ? await getTickerPrices(tickers, env) : {};
                const { items, total } = computeAllocation(pos, prices);
                return json({ items, total }, 200, cors);
            }

            // GET /api/portfolio/history — serie diaria de valor de cartera + benchmark.
            if (path === '/api/portfolio/history' && method === 'GET') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const periodo = url.searchParams.get('periodo') || '1A';
                const benchKey = (url.searchParams.get('benchmark') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                const start = periodoToStartDate(periodo, new Date());
                const { results } = await env.DB.prepare(
                    'SELECT fecha, valor_total FROM cartera_valor_diario WHERE usuario_id=? AND fecha>=? ORDER BY fecha ASC')
                    .bind(uid, start).all();
                const portfolio = results.map(r => ({ fecha: r.fecha, valor: Number(r.valor_total) }));

                let benchmark = null;
                if (benchKey) {
                    const bench = BENCHMARKS[benchKey];
                    if (!bench) {
                        benchmark = { key: benchKey, error: 'benchmark no soportado', soportados: Object.keys(BENCHMARKS) };
                    } else {
                        const serie = portfolio.length
                            ? await getBenchmarkSeries(env, bench.symbol, portfolio.map(p => p.fecha)) : [];
                        benchmark = { key: benchKey, symbol: bench.symbol, nombre: bench.nombre, serie };
                    }
                }
                return json({ periodo, desde: start, portfolio, benchmark }, 200, cors);
            }

            // GET /api/portfolio/daily-return — rentabilidad diaria y acumulada del periodo.
            if (path === '/api/portfolio/daily-return' && method === 'GET') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const periodo = url.searchParams.get('periodo') || 'mensual';
                const start = periodoToStartDate(periodo, new Date());
                const { results } = await env.DB.prepare(
                    'SELECT fecha, valor_total FROM cartera_valor_diario WHERE usuario_id=? ORDER BY fecha ASC').bind(uid).all();
                const serie = results.map(r => ({ fecha: r.fecha, valor: Number(r.valor_total) }));

                let valor_actual = null, fecha_actual = null, valor_anterior = null, rentabilidad_diaria_pct = null;
                if (serie.length >= 1) { valor_actual = serie[serie.length - 1].valor; fecha_actual = serie[serie.length - 1].fecha; }
                if (serie.length >= 2) {
                    valor_anterior = serie[serie.length - 2].valor;
                    rentabilidad_diaria_pct = valor_anterior > 0 ? ((valor_actual - valor_anterior) / valor_anterior) * 100 : null;
                }
                const enRango = serie.filter(s => s.fecha >= start);
                let valor_inicial = null, fecha_inicial = null, rentabilidad_acumulada_pct = null;
                if (enRango.length >= 1) {
                    valor_inicial = enRango[0].valor; fecha_inicial = enRango[0].fecha;
                    if (valor_inicial > 0 && valor_actual != null) {
                        rentabilidad_acumulada_pct = ((valor_actual - valor_inicial) / valor_inicial) * 100;
                    }
                }
                return json({ periodo, rentabilidad_diaria_pct, rentabilidad_acumulada_pct,
                              valor_actual, valor_anterior, valor_inicial, fecha_actual, fecha_inicial }, 200, cors);
            }

            if (path === '/api/portfolio/prices' && method === 'GET') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const raw = url.searchParams.get('tickers') || '';
                const tickers = [...new Set(
                    raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
                )].slice(0, 50);
                if (!tickers.length) return json({ error: 'Falta el parámetro tickers' }, 400, cors);
                const prices = await getTickerPrices(tickers, env);
                return json({ prices }, 200, cors);
            }

                 return json({ error: 'Not found', path }, 404, cors);

        } catch (err) {
            // No filtrar detalles internos al cliente; registrar el detalle en el servidor.
            console.error('Error 500:', err && err.stack ? err.stack : err);
            return json({ error: 'Server error' }, 500, cors);
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

        // ── Snapshot diario del valor de cartera (cartera_valor_diario) ──
        // Requisito clave: sin esto no hay serie para el gráfico de evolución ni
        // para la rentabilidad acumulada. Para cada usuario con posiciones abiertas,
        // valor_total = Σ cantidad_abierta × precio_actual.
        try {
            const today = now.toISOString().slice(0, 10);
            const { results: carteraUsers } = await env.DB.prepare(
                'SELECT DISTINCT usuario_id FROM cartera_operaciones').all();
            for (const cu of carteraUsers) {
                try {
                    const { results: ops } = await env.DB.prepare(
                        'SELECT * FROM cartera_operaciones WHERE usuario_id=?').bind(cu.usuario_id).all();
                    const pos = openPositions(ops);
                    if (!pos.length) continue;
                    const prices = await getTickerPrices([...new Set(pos.map(p => p.ticker))], env);
                    let valor = 0, hasPrice = false;
                    for (const p of pos) {
                        const pr = prices[p.ticker];
                        if (pr && pr.price != null && isFinite(pr.price)) { valor += pr.price * p.cantidad_abierta; hasPrice = true; }
                    }
                    if (!hasPrice) continue; // sin ningún precio no guardamos un 0 engañoso
                    await env.DB.prepare(
                        `INSERT INTO cartera_valor_diario (usuario_id, fecha, valor_total) VALUES (?,?,?)
                         ON CONFLICT(usuario_id, fecha) DO UPDATE SET valor_total = excluded.valor_total`)
                        .bind(cu.usuario_id, today, valor).run();
                } catch (e) {
                    console.error('Cron cartera snapshot, usuario', cu.usuario_id, ':', e);
                }
            }
        } catch (e) {
            console.error('Cron cartera snapshot:', e);
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
                        html: feedbackRequestEmailHTML(u.name || '', 'https://www.contabilidadpersonal.com/valoracion-finance-flow/')
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

// ---------- Verificación firma Stripe ----------
async function verifyStripeSignature(payload, sigHeader, secret) {
    if (!sigHeader || !secret) return false;
    try {
        const parts = Object.fromEntries(sigHeader.split(',').map(kv => kv.split('=')));
        const signedPayload = `${parts.t}.${payload}`;
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
        const expected = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
        // B6: comparación en tiempo constante
        if (!timingSafeEqual(expected, parts.v1 || '')) return false;
        // B3: anti-replay — rechazar eventos fuera de una tolerancia de 5 minutos
        const ts = Number(parts.t);
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
function welcomeEmailHTML(name) {
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
            <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">¡Bienvenido, ${name}! 👋</h2>
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
                function resetPasswordEmailHTML(name, link) {
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
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hola ${name}, hemos recibido una solicitud para restablecer tu contraseña. Pulsa el botón para crear una nueva. Este enlace caduca en 1 hora.</p>
    <a href="${link}" style="display:inline-block;background:#0158C9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Restablecer contraseña</a>
    <p style="margin:24px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">Si no has solicitado esto, ignora este correo. Tu contraseña no cambiará.</p>
    </td></tr>
    <tr><td style="background:#f4f6f9;padding:20px 32px;text-align:center;"><p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 Finance Flow · contabilidadpersonal.com</p></td></tr>
    </table></td></tr></table></body></html>`;
}
function feedbackRequestEmailHTML(name, link) {
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
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hola ${name}, ya llevas un mes usando Finance Flow. ¡Gracias por confiar en nosotros para poner orden en tus finanzas!</p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">Nos encantaría conocer tu opinión: qué te está funcionando y qué podríamos hacer mejor. Son solo 2 minutos y nos ayuda muchísimo.</p>
    <a href="${link}" style="display:inline-block;background:#0158C9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Dar mi opinión</a>
    <p style="margin:28px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">Si ahora no es buen momento, no pasa nada: no volveremos a insistir.</p>
    </td></tr>
    <tr><td style="background:#f4f6f9;padding:20px 32px;text-align:center;"><p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 Contabilidad Personal · contabilidadpersonal.com</p></td></tr>
    </table></td></tr></table></body></html>`;
}
