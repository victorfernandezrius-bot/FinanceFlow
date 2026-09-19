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

// ---------- Bloque 2: pesos ----------
import { weightPct, computePortfolioWeights, adjustTo100, computeAllocation } from './cartera-logic.js';

test('weightPct: definición única; total 0 o valor nulo → 0 (nunca NaN ni 100 falso)', () => {
    assert.equal(weightPct(25, 100), 25);
    assert.equal(weightPct(0, 100), 0);
    assert.equal(weightPct(50, 0), 0);
    assert.equal(weightPct(null, 100), 0);
});

test('computePortfolioWeights: posiciones + liquidez suman exactamente 100%', () => {
    const pos = [{ ticker: 'A', valor: 6000 }, { ticker: 'B', valor: 2000 }];
    const w = computePortfolioWeights(pos, 2000);
    assert.equal(w.total, 10000);
    assert.equal(w.invertido, 8000);
    assert.equal(w.items[0].peso_sobre_cartera, 60);
    assert.equal(w.items[1].peso_sobre_cartera, 20);
    assert.equal(w.peso_liquidez, 20);
    const suma = w.items.reduce((a, i) => a + i.peso_sobre_cartera, 0) + w.peso_liquidez;
    assert.ok(Math.abs(suma - 100) < 1e-9);
});

test('computePortfolioWeights: peso_sobre_invertido excluye la liquidez', () => {
    const w = computePortfolioWeights([{ ticker: 'A', valor: 6000 }, { ticker: 'B', valor: 2000 }], 2000);
    assert.equal(w.items[0].peso_sobre_invertido, 75);
    assert.equal(w.items[1].peso_sobre_invertido, 25);
});

test('computePortfolioWeights: liquidez negativa (margen) sigue sumando 100%', () => {
    const w = computePortfolioWeights([{ ticker: 'A', valor: 12000 }], -2000);
    assert.equal(w.total, 10000);
    assert.equal(w.items[0].peso_sobre_cartera, 120);
    assert.equal(w.peso_liquidez, -20);
    assert.ok(Math.abs(w.items[0].peso_sobre_cartera + w.peso_liquidez - 100) < 1e-9);
});

test('adjustTo100: absorbe el redondeo en la partida mayor y no inventa 100% si todo es 0', () => {
    const items = [{ peso_sobre_cartera: 33.333 }, { peso_sobre_cartera: 33.333 }, { peso_sobre_cartera: 33.333 }];
    const adj = adjustTo100(items);
    assert.ok(Math.abs(adj.reduce((a, i) => a + i.peso_sobre_cartera, 0) - 100) < 1e-9);
    assert.ok(adj[0].peso_sobre_cartera > 33.333);      // el residuo va al mayor (el primero, empatado)
    assert.equal(items[0].peso_sobre_cartera, 33.333);  // función pura: no muta la entrada
    assert.deepEqual(adjustTo100([{ peso_sobre_cartera: 0 }]), [{ peso_sobre_cartera: 0 }]);
    assert.deepEqual(adjustTo100([]), []);
});

test('computeAllocation: la liquidez entra como una posición más y el reparto suma 100%', () => {
    const pos = [{ ticker: 'A', tipo_activo: 'accion', cantidad_abierta: 10, precio_medio: 100 },
                 { ticker: 'B', tipo_activo: 'accion', cantidad_abierta: 10, precio_medio: 100 }];
    const prices = { A: { price: 600 }, B: { price: 200 } };
    const r = computeAllocation(pos, prices, 2000);
    assert.equal(r.total, 10000);
    const suma = r.items.reduce((a, i) => a + i.peso_sobre_cartera, 0);
    assert.ok(Math.abs(suma - 100) < 1e-9);
    const liq = r.items.find(i => i.es_liquidez);
    assert.equal(liq.valor, 2000);
    assert.equal(liq.peso_sobre_cartera, 20);
});

test('computeAllocation: una posición sin precio no falsea el reparto (valor null, peso 0)', () => {
    const pos = [{ ticker: 'A', tipo_activo: 'accion', cantidad_abierta: 10, precio_medio: 100 },
                 { ticker: 'BONO', tipo_activo: 'renta_fija', cantidad_abierta: 1, precio_medio: 1000 }];
    const r = computeAllocation(pos, { A: { price: 100 } }, 0);
    const bono = r.items.find(i => i.ticker === 'BONO');
    assert.equal(bono.valor, null);
    assert.equal(bono.peso_sobre_cartera, 0);
    assert.equal(r.items.find(i => i.ticker === 'A').peso_sobre_cartera, 100);
});

test('buildJournal: el peso de cada fila es histórico (sobre el invertido de ese momento)', () => {
    const { rows } = buildJournal([buy('A', 10, 100, 0, '2025-01-01'), buy('B', 10, 100, 0, '2025-02-01')]);
    assert.equal(rows[0].peso_historico_pct, 100);  // primera compra: era el 100% de lo invertido entonces
    assert.equal(rows[1].peso_historico_pct, 50);   // segunda: 1000 de 2000
});

test('buildJournal: los totales ya NO traen un peso_total tautológico del 100%', () => {
    const { totales } = buildJournal([buy('A', 10, 100, 0, '2025-01-01'), sell('A', 5, 150, 0, '2025-03-01')]);
    assert.equal(totales.peso_total, undefined);
    assert.equal(totales.coste_abierto, 500);        // quedan 5 a coste medio 100
    assert.equal(totales.capital_invertido_bruto, 1000);
});
