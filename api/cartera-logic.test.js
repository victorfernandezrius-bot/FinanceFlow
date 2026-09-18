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
