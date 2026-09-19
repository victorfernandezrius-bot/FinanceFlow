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

// ---------- v4: liquidez como eje ----------
// Operaciones de efectivo: 'aportacion' (entra dinero en la cuenta) y 'retirada'
// (sale). No llevan ticker ni precio: solo importe, moneda y fecha. En la tabla
// cartera_operaciones se guardan con ticker = CASH_TICKER, tipo_activo 'liquidez',
// cantidad = precio = 0 e `importe` (columna añadida en la migración 0004).
export const CASH_OPS = ['aportacion', 'retirada'];
export const CASH_TICKER = '__CASH__';
export function isCashOp(op) { return !!op && CASH_OPS.includes(op.tipo_operacion); }

// Saldo de liquidez CALCULADO por moneda (nunca introducido a mano):
//   saldo = Σ aportaciones − Σ retiradas
//           − Σ (cantidad × precio + comisión) de compras
//           + Σ (cantidad × precio − comisión) de ventas
// El interés devengado de una cuenta remunerada se suma aparte (accruedInterest).
// Se permite saldo negativo (brokers con margen): se señala, no se bloquea.
export function computeCashBalance(ops) {
    const por_moneda = {};
    const get = m => {
        const k = (m || 'EUR').toUpperCase();
        if (!por_moneda[k]) por_moneda[k] = { moneda: k, saldo: 0, aportaciones: 0, retiradas: 0, compras: 0, ventas: 0, n_aportaciones: 0 };
        return por_moneda[k];
    };
    for (const op of ops) {
        const b = get(op.moneda);
        if (op.tipo_operacion === 'aportacion') { const v = Number(op.importe) || 0; b.aportaciones += v; b.n_aportaciones++; }
        else if (op.tipo_operacion === 'retirada') { b.retiradas += Number(op.importe) || 0; }
        else {
            const q = Number(op.cantidad) || 0, p = Number(op.precio) || 0, c = Number(op.comision) || 0;
            if (op.tipo_operacion === 'compra') b.compras += q * p + c;
            else if (op.tipo_operacion === 'venta') b.ventas += q * p - c;
        }
    }
    let saldo_total = 0, tiene_aportaciones = false;
    for (const b of Object.values(por_moneda)) {
        b.saldo = b.aportaciones - b.retiradas - b.compras + b.ventas;
        saldo_total += b.saldo;
        if (b.n_aportaciones > 0) tiene_aportaciones = true;
    }
    return { por_moneda, saldo_total, tiene_aportaciones };
}

// Interés devengado de una cuenta remunerada: saldo × ((1 + i/m)^(m·t) − 1), con
// m capitalizaciones/año y t años desde fecha_inicio. Simplificación asumida: se
// aplica al saldo actual (no a cada tramo histórico del saldo). No devenga sobre
// saldo negativo.
export function accruedInterest(saldo, cfg, now = Date.now()) {
    if (!cfg || !(saldo > 0)) return 0;
    const remunerada = (cfg.remunerada === 1 || cfg.remunerada === true);
    const i = (Number(cfg.tipo_interes_anual) || 0) / 100;
    if (!remunerada || i <= 0 || !cfg.fecha_inicio) return 0;
    const mMap = { anual: 1, semestral: 2, trimestral: 4, mensual: 12, diaria: 365 };
    const m = mMap[cfg.capitalizacion] || 1;
    const t = (now - new Date(cfg.fecha_inicio).getTime()) / (365.25 * 86400000);
    if (!(t > 0)) return 0;
    return saldo * (Math.pow(1 + i / m, m * t) - 1);
}

// ---------- v4 Bloque 2: PESOS (una sola definición para toda la página) ----------
// Hay exactamente dos nociones de peso y no se mezclan nunca:
//
//   peso_sobre_cartera   = valor de mercado ÷ valor total de la cartera (liquidez
//                          INCLUIDA). Es el peso principal. Posiciones + liquidez = 100%.
//   peso_sobre_invertido = valor de mercado ÷ valor invertido (liquidez EXCLUIDA).
//                          Secundario: responde "dentro de lo invertido, cuánto pesa".
//
// Ambos se calculan aquí y en ningún otro sitio, para que una tabla no signifique
// una cosa y la de al lado otra.
export function weightPct(valor, total) {
    if (!(Math.abs(total) > EPS) || valor == null || !isFinite(valor)) return 0;
    return (valor / total) * 100;
}

// Pesos de una lista de posiciones ya valoradas ({ticker, valor}) más la liquidez.
// `cashTotal` puede ser negativo (cuenta en descubierto/margen): el cálculo sigue
// siendo correcto (la suma da 100%) aunque no sea representable como tarta.
export function computePortfolioWeights(positions, cashTotal = 0) {
    const invertido = positions.reduce((a, p) => a + (Number(p.valor) || 0), 0);
    const total = invertido + (Number(cashTotal) || 0);
    const items = positions.map(p => ({
        ...p,
        peso_sobre_cartera: weightPct(p.valor, total),
        peso_sobre_invertido: weightPct(p.valor, invertido)
    }));
    return { items, invertido, cashTotal: Number(cashTotal) || 0, total,
             peso_liquidez: weightPct(Number(cashTotal) || 0, total) };
}

// Ajusta `key` para que la suma sea exactamente 100, absorbiendo el residuo de
// redondeo en la partida MAYOR. Función pura: devuelve una copia. Si la suma es 0
// (cartera sin valor) no inventa un 100%: devuelve los items tal cual.
export function adjustTo100(items, key = 'peso_sobre_cartera') {
    const out = items.map(it => ({ ...it }));
    if (!out.length) return out;
    const sum = out.reduce((a, it) => a + (Number(it[key]) || 0), 0);
    if (Math.abs(sum) < EPS) return out;
    const resid = 100 - sum;
    if (Math.abs(resid) < 1e-9) return out;
    let max = out[0];
    for (const it of out) if ((Number(it[key]) || 0) > (Number(max[key]) || 0)) max = it;
    max[key] = (Number(max[key]) || 0) + resid;
    return out;
}

// ---------- v4 Bloque 3: duración en formato humano ----------
// Diferencia de calendario entre dos fechas YYYY-MM-DD (UTC, a>b devuelve ceros).
// Convención de préstamo: si faltan días se toma prestado del mes ANTERIOR a la
// fecha final, que es como se cuenta un "mes" en lenguaje natural. Por eso
// 2024-02-29 → 2025-02-28 son "11 meses y 30 días" (2024-02-29 + 11 meses =
// 2025-01-29, + 30 días = 2025-02-28) y no "1 año": el 29 de febrero no existe
// en 2025, así que el año aún no se ha cumplido.
export function diffYMD(desde, hasta) {
    const a = new Date(`${desde}T00:00:00Z`), b = new Date(`${hasta}T00:00:00Z`);
    if (isNaN(a) || isNaN(b) || b < a) return { anios: 0, meses: 0, dias: 0, total_dias: 0 };
    let y = b.getUTCFullYear() - a.getUTCFullYear();
    let m = b.getUTCMonth() - a.getUTCMonth();
    let d = b.getUTCDate() - a.getUTCDate();
    if (d < 0) {
        m--;
        // Días del mes inmediatamente anterior al de la fecha final.
        d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate();
    }
    if (m < 0) { m += 12; y--; }
    return { anios: y, meses: m, dias: d, total_dias: Math.round((b - a) / 86400000) };
}

// Plural correcto en español para las tres unidades.
function _unidad(n, singular, plural) { return `${n} ${n === 1 ? singular : plural}`; }

// Duración humana con desglose, omitiendo las unidades a cero:
//   "18 días" · "1 mes y 4 días" · "6 meses y 17 días" · "2 años, 4 meses y 14 días"
//   "2 años y 14 días" (no "2 años, 0 meses y 14 días")
// Devuelve "0 días" cuando ambas fechas son la misma (posición abierta hoy).
export function formatDuration(desde, hasta) {
    const { anios, meses, dias } = diffYMD(desde, hasta);
    const partes = [];
    if (anios > 0) partes.push(_unidad(anios, 'año', 'años'));
    if (meses > 0) partes.push(_unidad(meses, 'mes', 'meses'));
    if (dias > 0) partes.push(_unidad(dias, 'día', 'días'));
    if (!partes.length) return '0 días';
    if (partes.length === 1) return partes[0];
    return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

// Agrega todas las operaciones por ticker sumando compras/ventas. Las operaciones
// de efectivo (aportación/retirada) NO son posiciones y se ignoran aquí.
// Devuelve un Map<ticker, {buyQty,buyCost,buyComision,sellQty,sellComision,...}>.
export function aggregate(ops) {
    const m = new Map();
    for (const op of ops) {
        if (isCashOp(op)) continue;
        const t = op.ticker;
        let a = m.get(t);
        if (!a) {
            a = { ticker: t, tipo_activo: op.tipo_activo, moneda: op.moneda || 'EUR',
                  buyQty: 0, buyCost: 0, buyComision: 0, sellQty: 0, sellComision: 0,
                  primera_compra: null, ultima_venta: null };
            m.set(t, a);
        }
        const q = Number(op.cantidad) || 0, p = Number(op.precio) || 0, c = Number(op.comision) || 0;
        if (op.tipo_operacion === 'compra') {
            a.buyQty += q; a.buyCost += q * p; a.buyComision += c;
            if (!a.primera_compra || (op.fecha && op.fecha < a.primera_compra)) a.primera_compra = op.fecha || null;
        }
        else if (op.tipo_operacion === 'venta') {
            a.sellQty += q; a.sellComision += c;
            if (!a.ultima_venta || (op.fecha && op.fecha > a.ultima_venta)) a.ultima_venta = op.fecha || null;
        }
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
        comision_total_pagada: a.buyComision + a.sellComision,
        // Comisiones de ENTRADA acumuladas (Bloque 4: total invertido).
        comision_entrada_total: a.buyComision,
        // Total invertido = cantidad abierta × precio medio + comisiones de entrada.
        total_invertido: cantidad_abierta * precio_medio + a.buyComision,
        primera_compra: a.primera_compra || null,
        ultima_venta: a.ultima_venta || null
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
export function buildJournal(ops, hoy = new Date().toISOString().slice(0, 10)) {
    // Agregado global por ticker (todas las compras) como red de seguridad: si una
    // venta aparece antes que sus compras en orden cronológico —p. ej. datos v1
    // migrados con fecha "hoy" y ventas manuales con fecha anterior— el pool
    // corriente estaría vacío; en ese caso usamos el coste medio global del ticker
    // en lugar de un precio medio 0 falso.
    const glob = aggregate(ops);
    const pool = new Map(); // ticker -> { qty, cost, com, racha, abierta_desde }
    const cierres = new Map(); // "TICKER#racha" -> fecha en que se cerró del todo
    // Capital invertido acumulado hasta cada operación (compras: cantidad×precio +
    // comisión). Es el denominador del peso HISTÓRICO de cada fila: la foto del
    // momento en que se ejecutó, no la de hoy.
    let capitalBruto = 0;
    const rows = [];
    let beneficioTotal = 0, comisionesTotales = 0, baseVentas = 0;

    for (const op of ops) {
        // Aportaciones/retiradas: fila informativa del diario, sin P&L ni comisión.
        if (isCashOp(op)) {
            rows.push({ id: op.id, fecha: op.fecha, tipo_operacion: op.tipo_operacion, ticker: null,
                tipo_activo: 'liquidez', moneda: op.moneda || 'EUR', importe: Number(op.importe) || 0, precio: null,
                comision_entrada: null, comision_salida: null, peso_historico_pct: null, beneficio: null, rentabilidad_pct: null });
            continue;
        }
        const q = Number(op.cantidad) || 0, p = Number(op.precio) || 0, c = Number(op.comision) || 0;
        let s = pool.get(op.ticker);
        if (!s) { s = { qty: 0, cost: 0, com: 0 }; pool.set(op.ticker, s); }
        comisionesTotales += c;

        const row = {
            id: op.id, fecha: op.fecha, tipo_operacion: op.tipo_operacion,
            ticker: op.ticker, tipo_activo: op.tipo_activo, precio: p,
            comision_entrada: null, comision_salida: null,
            peso_historico_pct: null, beneficio: null, rentabilidad_pct: null,
            abierta_desde: null, cerrada_en: null, tiempo_abierto: null, sigue_abierta: null
        };

        if (op.tipo_operacion === 'compra') {
            // Una "racha" es un periodo con posición abierta continua en el ticker.
            // Si el pool estaba vacío, esta compra abre una racha nueva.
            if (s.qty <= EPS) { s.racha = (s.racha || 0) + 1; s.abierta_desde = op.fecha; }
            row._racha = `${op.ticker}#${s.racha}`;
            row.abierta_desde = op.fecha;
            s.qty += q; s.cost += q * p; s.com += c;
            capitalBruto += q * p + c;
            row.comision_entrada = c;
            row.peso_historico_pct = weightPct(q * p + c, capitalBruto);
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
            // En una venta el "peso" es el importe desinvertido sobre el capital
            // invertido acumulado en ese momento.
            row.peso_historico_pct = weightPct(p * q, capitalBruto);
            // Tiempo que estuvo abierto lo que se vende: desde que se abrió la racha
            // hasta la fecha de esta venta.
            row.abierta_desde = s.abierta_desde || null;
            row.cerrada_en = op.fecha;
            if (row.abierta_desde) row.tiempo_abierto = formatDuration(row.abierta_desde, op.fecha);
            if (s.qty <= EPS) { cierres.set(`${op.ticker}#${s.racha}`, op.fecha); s.abierta_desde = null; }
            beneficioTotal += beneficio; baseVentas += base;
        }
        rows.push(row);
    }

    // Segunda pasada: las filas de COMPRA ya saben cuándo se abrió su racha, pero
    // no si esa racha llegó a cerrarse (puede cerrarse en una venta posterior). Si
    // se cerró, el tiempo abierto va hasta la fecha de cierre; si sigue abierta,
    // hasta hoy.
    for (const r of rows) {
        if (r.tipo_operacion !== 'compra' || !r.abierta_desde) continue;
        const cierre = cierres.get(r._racha);
        r.cerrada_en = cierre || null;
        r.tiempo_abierto = formatDuration(r.abierta_desde, cierre || hoy);
        r.sigue_abierta = !cierre;
    }
    for (const r of rows) delete r._racha;

    // Coste (base) de las posiciones que siguen abiertas. NO se convierte en un
    // "peso total" del 100%: ese era el bug — un total normalizado sobre sí mismo
    // marca 100% siempre, incluso tras vender, y no informa de nada. El peso real
    // de lo que sigue abierto sobre la cartera de HOY necesita valor de mercado y
    // liquidez, así que lo calcula el Worker (_carteraContext) y no esta función pura.
    let costeAbierto = 0;
    for (const s of pool.values()) {
        if (s.qty > EPS) costeAbierto += s.cost;
    }

    const totales = {
        beneficio_total: beneficioTotal,
        comisiones_totales: comisionesTotales,
        rentabilidad_pct_media_ponderada: baseVentas > 0 ? (beneficioTotal / baseVentas) * 100 : 0,
        coste_abierto: costeAbierto,
        capital_invertido_bruto: capitalBruto
    };
    return { rows, totales };
}

// Reparto (allocation) de las posiciones abiertas MÁS la liquidez, con la
// definición única de peso: peso_sobre_cartera (liquidez incluida) suma 100%.
// priceMap: { TICKER: { price, stale } } tal como devuelve getTickerPrices.
export function computeAllocation(positions, priceMap, cashTotal = 0) {
    const valoradas = positions.map(p => {
        const pr = priceMap && priceMap[p.ticker];
        const price = pr && pr.price != null && isFinite(pr.price) ? Number(pr.price) : null;
        return {
            ticker: p.ticker, tipo_activo: p.tipo_activo,
            cantidad_abierta: p.cantidad_abierta, precio_medio: p.precio_medio,
            precio_actual: price, valor: price != null ? price * p.cantidad_abierta : null,
            stale: pr ? !!pr.stale : true, es_liquidez: false
        };
    });
    const cash = Number(cashTotal) || 0;
    const conValor = valoradas.filter(i => i.valor != null);
    const entradas = cash !== 0
        ? [...conValor, { ticker: 'Liquidez', tipo_activo: 'liquidez', valor: cash, es_liquidez: true, stale: false }]
        : conValor;
    const { items, invertido, total } = computePortfolioWeights(entradas, 0);
    // Las posiciones sin precio se devuelven con peso 0 y valor null (nunca un 0 falso).
    const sinValor = valoradas.filter(i => i.valor == null)
        .map(i => ({ ...i, peso_sobre_cartera: 0, peso_sobre_invertido: 0 }));
    return { items: [...items, ...sinValor], total, invertido, cashTotal: cash };
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
//
// `minLen` (opcional): las claves con menos de `minLen` cierres se EXCLUYEN de la
// intersección y se devuelven en `excluidos`. Sin esto, una sola serie corta (una
// cripto recién comprada, un ticker con 20 días de histórico) reduce la ventana
// común de TODOS los activos por debajo del mínimo y vacía la matriz entera.
// Las claves vacías o ausentes también van a `excluidos` (antes abortaban todo).
export function alignedReturns(seriesByKey, keys, minLen = 0) {
    const excluidos = [];
    const usables = [];
    for (const k of keys) {
        const s = seriesByKey[k];
        if (!s || !s.length || s.length < minLen) excluidos.push(k);
        else usables.push(k);
    }
    let common = null;
    for (const k of usables) {
        const set = new Set(seriesByKey[k].map(p => p.fecha));
        common = common == null ? set : new Set([...common].filter(f => set.has(f)));
    }
    const dates = [...(common || [])].sort();
    const returns = {};
    for (const k of usables) {
        const map = new Map(seriesByKey[k].map(p => [p.fecha, Number(p.close)]));
        const closes = dates.map(f => map.get(f));
        returns[k] = dailyLogReturns(closes);
    }
    return { dates, returns, excluidos };
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
