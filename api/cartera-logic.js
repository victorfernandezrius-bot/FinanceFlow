// ============================================================
// Cartera de Inversión v2 — lógica pura (sin I/O).
// Las posiciones abiertas y el precio medio se CALCULAN agregando el histórico
// de operaciones (cartera_operaciones). Método de coste medio ponderado simple
// (no FIFO/LIFO estricto): vender no altera el precio medio de las acciones que
// quedan; consume coste y comisión de entrada de forma proporcional.
//
// Estas funciones son puras para poder testearlas sin base de datos. El Worker
// (api/worker.js) hace el I/O de D1/KV y las invoca.
// ============================================================

export const EPS = 1e-9;

// Agrega todas las operaciones por ticker sumando compras/ventas.
// Devuelve un Map<ticker, {buyQty,buyCost,buyComision,sellQty,sellComision,...}>.
export function aggregate(ops) {
    const m = new Map();
    for (const op of ops) {
        const t = op.ticker;
        let a = m.get(t);
        if (!a) {
            a = { ticker: t, tipo_activo: op.tipo_activo, moneda: op.moneda || 'EUR',
                  buyQty: 0, buyCost: 0, buyComision: 0, sellQty: 0, sellComision: 0 };
            m.set(t, a);
        }
        const q = Number(op.cantidad) || 0, p = Number(op.precio) || 0, c = Number(op.comision) || 0;
        if (op.tipo_operacion === 'compra') { a.buyQty += q; a.buyCost += q * p; a.buyComision += c; }
        else if (op.tipo_operacion === 'venta') { a.sellQty += q; a.sellComision += c; }
        if (op.tipo_activo) a.tipo_activo = op.tipo_activo;
        if (op.moneda) a.moneda = op.moneda;
    }
    return m;
}

// Posición (abierta o no) a partir de un agregado por ticker.
export function positionFrom(a) {
    const cantidad_abierta = a.buyQty - a.sellQty;
    const precio_medio = a.buyQty > 0 ? a.buyCost / a.buyQty : 0;
    return {
        ticker: a.ticker,
        tipo_activo: a.tipo_activo,
        moneda: a.moneda,
        cantidad_abierta,
        precio_medio,
        comision_total_pagada: a.buyComision + a.sellComision
    };
}

// Posiciones con cantidad_abierta > 0.
export function openPositions(ops) {
    const out = [];
    for (const a of aggregate(ops).values()) {
        const p = positionFrom(a);
        if (p.cantidad_abierta > EPS) out.push(p);
    }
    return out;
}

// Cantidad abierta actual de un ticker (compras − ventas).
export function openQty(ops, ticker) {
    const a = aggregate(ops).get(ticker);
    return a ? a.buyQty - a.sellQty : 0;
}

// Cálculo del cierre TOTAL de una posición (venta de toda la cantidad abierta).
// Devuelve null si no hay nada abierto para ese ticker.
export function computeClose(ops, ticker, precioCierre, comisionSalida) {
    const a = aggregate(ops).get(ticker);
    if (!a) return null;
    const cantidad = a.buyQty - a.sellQty;
    if (cantidad <= EPS) return null;
    const precio_medio = a.buyQty > 0 ? a.buyCost / a.buyQty : 0;
    // Comisión de entrada proporcional a la fracción de compras que se cierra ahora.
    const comision_entrada_proporcional = a.buyQty > 0 ? a.buyComision * (cantidad / a.buyQty) : 0;
    const comSalida = Number(comisionSalida) || 0;
    const pc = Number(precioCierre);
    const beneficio = (pc - precio_medio) * cantidad - comision_entrada_proporcional - comSalida;
    const base = precio_medio * cantidad;
    const rentabilidad_pct = base > 0 ? (beneficio / base) * 100 : 0;
    return {
        ticker, tipo_activo: a.tipo_activo, moneda: a.moneda,
        cantidad, precio_medio, precio_cierre: pc,
        comision_entrada_proporcional, comision_salida: comSalida,
        beneficio, rentabilidad_pct
    };
}

// Diario de operaciones + totales. `ops` debe venir ya filtrado y ordenado
// cronológicamente (fecha asc, luego id asc). Procesa en orden manteniendo un
// "pool" por ticker (coste medio) para calcular P&L realizado en cada venta.
export function buildJournal(ops) {
    // Agregado global por ticker (todas las compras) como red de seguridad: si una
    // venta aparece antes que sus compras en orden cronológico —p. ej. datos v1
    // migrados con fecha "hoy" y ventas manuales con fecha anterior— el pool
    // corriente estaría vacío; en ese caso usamos el coste medio global del ticker
    // en lugar de un precio medio 0 falso.
    const glob = aggregate(ops);
    const pool = new Map(); // ticker -> { qty, cost, com }
    let capitalBruto = 0;   // capital bruto invertido acumulado (importe de compras)
    const rows = [];
    let beneficioTotal = 0, comisionesTotales = 0, baseVentas = 0;

    for (const op of ops) {
        const q = Number(op.cantidad) || 0, p = Number(op.precio) || 0, c = Number(op.comision) || 0;
        let s = pool.get(op.ticker);
        if (!s) { s = { qty: 0, cost: 0, com: 0 }; pool.set(op.ticker, s); }
        comisionesTotales += c;

        const row = {
            id: op.id, fecha: op.fecha, tipo_operacion: op.tipo_operacion,
            ticker: op.ticker, tipo_activo: op.tipo_activo, precio: p,
            comision_entrada: null, comision_salida: null,
            peso_en_cartera: null, beneficio: null, rentabilidad_pct: null
        };

        if (op.tipo_operacion === 'compra') {
            s.qty += q; s.cost += q * p; s.com += c;
            capitalBruto += q * p;
            row.comision_entrada = c;
            row.peso_en_cartera = capitalBruto > 0 ? ((q * p) / capitalBruto) * 100 : 0;
        } else if (op.tipo_operacion === 'venta') {
            let precio_medio, comEntradaProp;
            if (s.qty > EPS) {
                precio_medio = s.cost / s.qty;
                comEntradaProp = s.com * (q / s.qty);
                // Consumir el pool proporcionalmente (mantiene el precio medio constante).
                const f = Math.max(0, (s.qty - q)) / s.qty;
                s.cost *= f; s.com *= f; s.qty -= q;
            } else {
                // Pool vacío en este punto: usar coste medio global del ticker.
                const g = glob.get(op.ticker);
                precio_medio = g && g.buyQty > 0 ? g.buyCost / g.buyQty : 0;
                comEntradaProp = g && g.buyQty > 0 ? g.buyComision * (q / g.buyQty) : 0;
            }
            const beneficio = (p - precio_medio) * q - comEntradaProp - c;
            const base = precio_medio * q;
            row.comision_entrada = comEntradaProp;
            row.comision_salida = c;
            row.beneficio = beneficio;
            row.base_venta = base; // coste base de la venta (precio_medio × cantidad), para totales ponderados
            row.rentabilidad_pct = base > 0 ? (beneficio / base) * 100 : 0;
            row.peso_en_cartera = capitalBruto > 0 ? ((p * q) / capitalBruto) * 100 : 0;
            beneficioTotal += beneficio; baseVentas += base;
        }
        rows.push(row);
    }

    // peso_total: peso de las posiciones que siguen abiertas sobre su coste total
    // (suma 100% si hay algo abierto). Es una noción distinta del peso por operación.
    let openCostTotal = 0;
    for (const s of pool.values()) {
        if (s.qty > EPS) openCostTotal += s.cost;
    }

    const totales = {
        beneficio_total: beneficioTotal,
        comisiones_totales: comisionesTotales,
        rentabilidad_pct_media_ponderada: baseVentas > 0 ? (beneficioTotal / baseVentas) * 100 : 0,
        peso_total: openCostTotal > 0 ? 100 : 0
    };
    return { rows, totales };
}

// Reparto (allocation) de las posiciones abiertas sobre el valor de mercado total.
// priceMap: { TICKER: { price, stale } } tal como devuelve getTickerPrices.
export function computeAllocation(positions, priceMap) {
    let total = 0;
    const items = positions.map(p => {
        const pr = priceMap && priceMap[p.ticker];
        const price = pr && pr.price != null && isFinite(pr.price) ? Number(pr.price) : null;
        const valor = price != null ? price * p.cantidad_abierta : null;
        if (valor != null) total += valor;
        return {
            ticker: p.ticker, tipo_activo: p.tipo_activo,
            cantidad_abierta: p.cantidad_abierta, precio_medio: p.precio_medio,
            precio_actual: price, valor, stale: pr ? !!pr.stale : true
        };
    });
    for (const it of items) {
        it.peso_pct = (total > 0 && it.valor != null) ? (it.valor / total) * 100 : 0;
    }
    return { items, total };
}

// ============================================================
// v3 — Motor de riesgo (funciones puras, testeables sin red ni BD)
// ============================================================

// Ventana y umbrales (constantes nombradas, no incrustadas en la lógica).
export const RISK_WINDOW = 252;         // sesiones de rendimientos diarios
export const TRADING_DAYS = 252;        // factor de anualización
export const MIN_SESSIONS = 60;         // mínimo de sesiones para calcular beta/varianza
export const BETA_AGRESIVA = 1.1;       // β > 1.1  -> agresiva
export const BETA_DEFENSIVA = 0.9;      // β < 0.9  -> defensiva  (entre medias: igual al benchmark)

// Rendimientos diarios logarítmicos a partir de una serie de cierres ascendente.
export function dailyLogReturns(closes) {
    const out = [];
    for (let i = 1; i < closes.length; i++) {
        const a = Number(closes[i - 1]), b = Number(closes[i]);
        if (a > 0 && b > 0) out.push(Math.log(b / a));
    }
    return out;
}

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
// Varianza y covarianza muestrales (divisor n-1), convención financiera estándar.
export function sampleVariance(a) {
    if (a.length < 2) return 0;
    const m = mean(a); let s = 0;
    for (const x of a) s += (x - m) * (x - m);
    return s / (a.length - 1);
}
export function sampleCovariance(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return 0;
    const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
    return s / (n - 1);
}

// Alinea series por FECHA (intersección de fechas) y devuelve los rendimientos
// logarítmicos de cada clave sobre el conjunto de fechas común, en orden.
// seriesByKey: { clave: [{fecha, close}] } (fechas ascendentes).
export function alignedReturns(seriesByKey, keys) {
    // Fechas comunes a todas las claves con serie no vacía.
    let common = null;
    for (const k of keys) {
        const s = seriesByKey[k];
        if (!s || !s.length) { return { dates: [], returns: {} }; }
        const set = new Set(s.map(p => p.fecha));
        common = common == null ? set : new Set([...common].filter(f => set.has(f)));
    }
    const dates = [...(common || [])].sort();
    const returns = {};
    for (const k of keys) {
        const map = new Map(seriesByKey[k].map(p => [p.fecha, Number(p.close)]));
        const closes = dates.map(f => map.get(f));
        returns[k] = dailyLogReturns(closes);
    }
    return { dates, returns };
}

export function beta(rAsset, rBench) {
    const vB = sampleVariance(rBench);
    if (vB === 0) return null;
    return sampleCovariance(rAsset, rBench) / vB;
}

export function classifyBeta(b) {
    if (b == null || !isFinite(b)) return null;
    if (b > BETA_AGRESIVA) return 'agresiva';
    if (b < BETA_DEFENSIVA) return 'defensiva';
    return 'igual_benchmark';
}

// Volatilidad anualizada de una serie de rendimientos diarios.
export function annualizedVolatility(returns) {
    return Math.sqrt(sampleVariance(returns) * TRADING_DAYS);
}

// Matriz de varianzas-covarianzas ANUALIZADA (×252) entre los tickers con
// histórico suficiente (>= MIN_SESSIONS rendimientos). Los que no llegan se
// devuelven en `insuficientes` y NO entran en la matriz (nunca un 0 falso).
// returnsByTicker: { ticker: [r...] }.
export function covarianceMatrix(returnsByTicker, tickers) {
    const suf = tickers.filter(t => (returnsByTicker[t] || []).length >= MIN_SESSIONS);
    const insuf = tickers.filter(t => (returnsByTicker[t] || []).length < MIN_SESSIONS);
    const matriz = suf.map(ti => suf.map(tj =>
        sampleCovariance(returnsByTicker[ti], returnsByTicker[tj]) * TRADING_DAYS));
    return { tickers: suf, insuficientes: insuf, matriz };
}

// Volatilidad de la cartera: σ_p = √(wᵀ·Σ·w). weightsByTicker en tanto por uno.
export function portfolioVolatility(weightsByTicker, matriz, tickers) {
    const w = tickers.map(t => Number(weightsByTicker[t]) || 0);
    let s = 0;
    for (let i = 0; i < tickers.length; i++)
        for (let j = 0; j < tickers.length; j++)
            s += w[i] * matriz[i][j] * w[j];
    return s > 0 ? Math.sqrt(s) : 0;
}

// Beta de la cartera: media de las betas individuales ponderada por peso
// (solo activos con beta calculable). Normaliza por la suma de esos pesos.
export function portfolioBeta(weightsByTicker, betasByTicker) {
    let num = 0, den = 0;
    for (const t of Object.keys(betasByTicker)) {
        const b = betasByTicker[t];
        if (b == null || !isFinite(b)) continue;
        const w = Number(weightsByTicker[t]) || 0;
        num += w * b; den += w;
    }
    return den > 0 ? num / den : null;
}

// Duración de un bono (renta fija).
// Macaulay D = Σ_k [ t_k · PV(CF_k) ] / Precio, con PV(CF_k)=CF_k/(1+y/m)^k,
//   t_k = k/m (años), m = pagos de cupón al año, y = YTM (tipo de interés) anual.
// CF_k = cupón periódico = nominal·(cupón%/100)/m, y en el último período + nominal.
// Duración modificada = Macaulay / (1 + y/m). Devuelve años.
export function bondDuration({ cupon_pct, frecuencia, vencimiento, nominal, ytm_pct, fechaRef }) {
    const mMap = { anual: 1, semestral: 2, trimestral: 4 };
    const m = mMap[frecuencia] || 1;
    const N = Number(nominal) || 0;
    const y = (Number(ytm_pct) || 0) / 100;
    const cupon = N * ((Number(cupon_pct) || 0) / 100) / m;
    const ref = fechaRef ? new Date(fechaRef) : new Date();
    const venc = new Date(vencimiento);
    const years = (venc - ref) / (365.25 * 86400000);
    if (!(years > 0) || N <= 0) return null;
    const n = Math.max(1, Math.round(years * m));
    const rate = y / m;
    let price = 0, weighted = 0;
    for (let k = 1; k <= n; k++) {
        let cf = cupon;
        if (k === n) cf += N;
        const pv = cf / Math.pow(1 + rate, k);
        price += pv;
        weighted += (k / m) * pv;
    }
    if (price <= 0) return null;
    const macaulay = weighted / price;
    const modificada = macaulay / (1 + rate);
    return { macaulay, modificada, precio: price };
}
