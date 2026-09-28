// ============================================================
// Tesorería — calendario de cobros y pagos recurrentes. Lógica pura (sin I/O).
//
// Un compromiso (tesoreria_compromisos) es una SERIE futura: las ocurrencias no
// se guardan, se calculan al vuelo desde la fecha ancla. El movimiento que creó
// la serie es la primera ocurrencia (ya realizada), así que la proyección
// empieza en la siguiente.
//
// Fechas SIEMPRE como strings 'YYYY-MM-DD'. Toda la aritmética de calendario se
// hace con Date.UTC sobre los componentes numéricos: nunca new Date('YYYY-MM-DD')
// en hora local, que desplaza el día según la zona horaria.
//
// Módulo sin dependencias: lo importa el Worker (api/worker.js) y se puede
// copiar tal cual al frontend.
// ============================================================

export const FRECUENCIAS = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };
export const TIPOS_COMPROMISO = ['cobro', 'pago'];

const round2 = v => Math.round((Number(v) || 0) * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const truthy = v => v === true || v === 1 || v === '1';

export function isISODate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

// m: 1..12
export function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toISO(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

// "Hoy" en Europe/Madrid como 'YYYY-MM-DD' (en-CA formatea ya en ese orden).
export function hoyMadrid(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
}

export function addDays(fechaISO, n) {
    const [y, m, d] = fechaISO.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Suma n meses. Si el día no existe en el mes destino, usa el último día de ese
// mes (31-ene + 1 → 28/29-feb). Es una función del ancla, no se encadena: para
// la ocurrencia k se llama con (ancla, k·paso) y el día 31 no se "pierde".
export function addMonthsClamped(fechaISO, n) {
    const [y, m, d] = fechaISO.split('-').map(Number);
    const idx = (m - 1) + n;
    const ty = y + Math.floor(idx / 12);
    const tm = ((idx % 12) + 12) % 12 + 1;
    return toISO(ty, tm, Math.min(d, daysInMonth(ty, tm)));
}

// Ocurrencias futuras de un compromiso en [desde, hasta], estrictamente
// posteriores a fecha_ancla y ≤ fecha_fin. activo = 0 → ninguna.
export function expandCompromiso(comp, desdeISO, hastaISO) {
    if (!comp || !truthy(comp.activo ?? 1)) return [];
    const paso = FRECUENCIAS[comp.frecuencia];
    if (!paso || !isISODate(comp.fecha_ancla)) return [];
    const fin = comp.fecha_fin && isISODate(comp.fecha_fin) && comp.fecha_fin < hastaISO ? comp.fecha_fin : hastaISO;
    const out = [];
    // Salto directo a la primera k que puede caer en el rango (evita iterar años).
    const [ay, am] = comp.fecha_ancla.split('-').map(Number);
    const [dy, dm] = desdeISO.split('-').map(Number);
    const mesesHastaDesde = (dy - ay) * 12 + (dm - am);
    let k = Math.max(1, Math.floor(mesesHastaDesde / paso));
    for (; ; k++) {
        const fecha = addMonthsClamped(comp.fecha_ancla, k * paso);
        if (fecha > fin) break;
        if (fecha < desdeISO || fecha <= comp.fecha_ancla) continue;
        out.push({
            compromiso_id: comp.id,
            fecha,
            tipo: comp.tipo,
            importe: round2(comp.importe),
            concepto: comp.concepto,
            cuenta_id: comp.cuenta_id,
            frecuencia: comp.frecuencia,
            origen: 'compromiso'
        });
    }
    return out;
}

export function esCosteFijo(account) {
    return !!account && truthy(account.is_fixed_cost)
        && Number(account.fixed_monthly_amount) > 0
        && Number(account.fixed_due_day) >= 1 && Number(account.fixed_due_day) <= 31;
}

// Costes fijos (accounts.is_fixed_cost) como pagos mensuales virtuales, el día
// fixed_due_day de cada mes del rango (con clamp al último día del mes).
export function expandCosteFijo(account, desdeISO, hastaISO) {
    if (!esCosteFijo(account)) return [];
    const dia = Number(account.fixed_due_day);
    let [y, m] = desdeISO.split('-').map(Number);
    const out = [];
    for (; ;) {
        const fecha = toISO(y, m, Math.min(dia, daysInMonth(y, m)));
        if (fecha > hastaISO) break;
        if (fecha >= desdeISO) {
            out.push({
                compromiso_id: null,
                fecha,
                tipo: 'pago',
                importe: round2(account.fixed_monthly_amount),
                concepto: account.nombre,
                cuenta_id: account.id,
                frecuencia: 'mensual',
                origen: 'coste_fijo'
            });
        }
        if (++m > 12) { m = 1; y++; }
    }
    return out;
}

// Agenda unificada ordenada por fecha. El coste fijo de una cuenta se omite si
// esa cuenta ya tiene un compromiso de pago activo (no se duplica).
export function buildAgenda({ compromisos = [], accounts = [], desde, hasta }) {
    const nombres = new Map(accounts.map(a => [a.id, a.nombre]));
    const activos = compromisos.filter(c => truthy(c.activo ?? 1));
    const cuentasConPago = new Set(activos.filter(c => c.tipo === 'pago').map(c => c.cuenta_id));
    const items = [];
    for (const c of activos) items.push(...expandCompromiso(c, desde, hasta));
    for (const a of accounts) {
        if (cuentasConPago.has(a.id)) continue;
        items.push(...expandCosteFijo(a, desde, hasta));
    }
    for (const it of items) it.cuenta_nombre = nombres.get(it.cuenta_id) ?? null;
    const ordenOrigen = { compromiso: 0, coste_fijo: 1 };
    return items.sort((a, b) =>
        a.fecha.localeCompare(b.fecha)
        || (a.tipo === b.tipo ? 0 : a.tipo === 'cobro' ? -1 : 1)
        || ordenOrigen[a.origen] - ordenOrigen[b.origen]
        || String(a.concepto).localeCompare(String(b.concepto)));
}

function agruparPorCuenta(items) {
    const m = new Map();
    for (const it of items) {
        const g = m.get(it.cuenta_id) || { cuenta_id: it.cuenta_id, cuenta_nombre: it.cuenta_nombre ?? null, total: 0, n: 0 };
        g.total += it.importe; g.n++;
        m.set(it.cuenta_id, g);
    }
    return [...m.values()].map(g => ({ ...g, total: round2(g.total) })).sort((a, b) => b.total - a.total);
}

// Efectivo proyectado = saldo bancario actual + cobros pendientes − pagos
// pendientes. flujo_neto = cobros − pagos (NO es efectivo disponible).
export function resumenTesoreria(agenda, saldoBancario) {
    const detalle_cobros = agenda.filter(i => i.tipo === 'cobro');
    const detalle_pagos = agenda.filter(i => i.tipo === 'pago');
    const cobros_total = round2(detalle_cobros.reduce((s, i) => s + i.importe, 0));
    const pagos_total = round2(detalle_pagos.reduce((s, i) => s + i.importe, 0));
    const saldo = round2(saldoBancario);
    return {
        saldo_bancario: saldo,
        cobros_total,
        pagos_total,
        flujo_neto: round2(cobros_total - pagos_total),
        efectivo_proyectado: round2(saldo + cobros_total - pagos_total),
        por_cuenta_cobros: agruparPorCuenta(detalle_cobros),
        por_cuenta_pagos: agruparPorCuenta(detalle_pagos),
        detalle_cobros,
        detalle_pagos
    };
}

// Misma regla que calculateBankBalance() del frontend: activos marcados como
// bancarios; si no hay ninguno, todos los activos.
export function saldoBancario(accounts) {
    const activos = accounts.filter(a => a.tipo === 'activo');
    const bancos = activos.filter(a => truthy(a.is_bank_account));
    return round2((bancos.length ? bancos : activos).reduce((s, a) => s + (Number(a.saldo_actual) || 0), 0));
}
