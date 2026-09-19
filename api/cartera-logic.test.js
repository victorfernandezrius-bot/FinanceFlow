// Tests unitarios de la lógica pura de la cartera (sin red ni base de datos).
// Ejecutar: npm test   (node --test api/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    alignedReturns, covarianceMatrix, MIN_SESSIONS, dailyLogReturns
} from './cartera-logic.js';

// Serie sintética de n cierres diarios consecutivos (fechas YYYY-MM-DD) desde 2025-01-01.
function serie(n, start = 0, base = 100) {
    const out = [];
    const d = new Date(Date.UTC(2025, 0, 1));
    d.setUTCDate(d.getUTCDate() + start);
    for (let i = 0; i < n; i++) {
        out.push({ fecha: d.toISOString().slice(0, 10), close: base + Math.sin(i / 3) * 5 + i * 0.1 });
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

// ---------- Bloque 0: una serie corta no debe vaciar la matriz de los demás ----------
test('alignedReturns: sin minLen, una serie corta reduce la ventana común de todos (comportamiento antiguo)', () => {
    const s = { A: serie(100), B: serie(100), C: serie(10) };
    const r = alignedReturns(s, ['A', 'B', 'C']);
    assert.equal(r.dates.length, 10);
    assert.equal(r.returns.A.length, 9);
    assert.deepEqual(r.excluidos, []);
});

test('alignedReturns: con minLen, la serie corta se excluye y A/B conservan su histórico', () => {
    const s = { A: serie(100), B: serie(100), C: serie(10) };
    const r = alignedReturns(s, ['A', 'B', 'C'], MIN_SESSIONS);
    assert.deepEqual(r.excluidos, ['C']);
    assert.equal(r.dates.length, 100);
    assert.equal(r.returns.A.length, 99);
    assert.equal(r.returns.C, undefined);
});

test('alignedReturns: una clave ausente o vacía va a excluidos en vez de abortar todo', () => {
    const s = { A: serie(80), B: [] };
    const r = alignedReturns(s, ['A', 'B', 'Z'], MIN_SESSIONS);
    assert.deepEqual(r.excluidos.sort(), ['B', 'Z']);
    assert.equal(r.returns.A.length, 79);
});

test('alignedReturns + covarianceMatrix: con la exclusión, la matriz sí se calcula para los suficientes', () => {
    const s = { A: serie(120), B: serie(120, 5), C: serie(15) };
    const { returns } = alignedReturns(s, ['A', 'B', 'C'], MIN_SESSIONS);
    const m = covarianceMatrix(returns, ['A', 'B', 'C']);
    assert.deepEqual(m.tickers, ['A', 'B']);
    assert.deepEqual(m.insuficientes, ['C']);
    assert.equal(m.matriz.length, 2);
    // Diagonal = varianza anualizada > 0; matriz simétrica.
    assert.ok(m.matriz[0][0] > 0);
    assert.ok(Math.abs(m.matriz[0][1] - m.matriz[1][0]) < 1e-12);
});

test('dailyLogReturns ignora cierres no positivos', () => {
    assert.deepEqual(dailyLogReturns([100, 0, 110]), []);
    assert.equal(dailyLogReturns([100, 110]).length, 1);
});

// ---------- Bloque 1: liquidez calculada ----------
import { computeCashBalance, accruedInterest, aggregate, openPositions, buildJournal, CASH_TICKER } from './cartera-logic.js';

const cashOp = (tipo, importe, fecha, moneda = 'EUR') => ({ ticker: CASH_TICKER, tipo_activo: 'liquidez', tipo_operacion: tipo, fecha, importe, moneda, cantidad: 0, precio: 0, comision: 0 });
const buy = (t, q, p, c = 0, fecha = '2025-02-01', moneda = 'EUR') => ({ ticker: t, tipo_activo: 'accion', tipo_operacion: 'compra', fecha, cantidad: q, precio: p, comision: c, moneda });
const sell = (t, q, p, c = 0, fecha = '2025-03-01', moneda = 'EUR') => ({ ticker: t, tipo_activo: 'accion', tipo_operacion: 'venta', fecha, cantidad: q, precio: p, comision: c, moneda });

test('computeCashBalance: aportación − compras (con comisión) + ventas (menos comisión) − retirada', () => {
    const ops = [cashOp('aportacion', 10000, '2025-01-01'), buy('AAPL', 10, 100, 2), buy('AAPL', 10, 120, 2),
                 buy('MSFT', 5, 200, 1), sell('AAPL', 5, 150, 1), cashOp('retirada', 500, '2025-04-01')];
    const r = computeCashBalance(ops);
    const e = r.por_moneda.EUR;
    assert.equal(e.aportaciones, 10000);
    assert.equal(e.retiradas, 500);
    assert.equal(e.compras, 1002 + 1202 + 1001);
    assert.equal(e.ventas, 750 - 1);
    // 10000 − 500 − 3205 + 749 = 7044
    assert.equal(e.saldo, 7044);
    assert.equal(r.saldo_total, 7044);
    assert.equal(r.tiene_aportaciones, true);
});

test('computeCashBalance: sin aportaciones, una compra deja saldo negativo (permitido y señalable)', () => {
    const r = computeCashBalance([buy('AAPL', 1, 100, 1)]);
    assert.equal(r.por_moneda.EUR.saldo, -101);
    assert.equal(r.tiene_aportaciones, false);
});

test('computeCashBalance: separa monedas', () => {
    const r = computeCashBalance([cashOp('aportacion', 1000, '2025-01-01', 'EUR'), cashOp('aportacion', 500, '2025-01-01', 'USD'), buy('AAPL', 1, 100, 0, '2025-02-01', 'USD')]);
    assert.equal(r.por_moneda.EUR.saldo, 1000);
    assert.equal(r.por_moneda.USD.saldo, 400);
    assert.equal(r.saldo_total, 1400);
});

test('aggregate/openPositions ignoran las operaciones de efectivo', () => {
    const ops = [cashOp('aportacion', 1000, '2025-01-01'), buy('AAPL', 2, 100)];
    assert.equal(aggregate(ops).has(CASH_TICKER), false);
    assert.deepEqual(openPositions(ops).map(p => p.ticker), ['AAPL']);
});

test('buildJournal: las aportaciones aparecen como filas sin P&L y no cuentan comisiones', () => {
    const { rows, totales } = buildJournal([cashOp('aportacion', 1000, '2025-01-01'), buy('AAPL', 2, 100, 3)]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].tipo_operacion, 'aportacion');
    assert.equal(rows[0].importe, 1000);
    assert.equal(rows[0].beneficio, null);
    assert.equal(totales.comisiones_totales, 3);
});

test('accruedInterest: 1000 al 3% anual, capitalización anual, 1 año → 30; no devenga en saldo negativo ni sin remuneración', () => {
    const now = Date.UTC(2026, 0, 1);
    const cfg = { remunerada: 1, tipo_interes_anual: 3, capitalizacion: 'anual', fecha_inicio: '2025-01-01' };
    const i = accruedInterest(1000, cfg, now);
    assert.ok(Math.abs(i - 30) < 0.05, `esperado ~30, obtenido ${i}`);
    assert.equal(accruedInterest(-1000, cfg, now), 0);
    assert.equal(accruedInterest(1000, { ...cfg, remunerada: 0 }, now), 0);
    // Mensual > anual (capitaliza más veces).
    assert.ok(accruedInterest(1000, { ...cfg, capitalizacion: 'mensual' }, now) > i);
});
