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

// ---------- Bloque 3: tiempo abierto ----------
import { formatDuration, diffYMD, positionFrom, aggregate as agg2 } from './cartera-logic.js';

test('formatDuration: formatos del enunciado', () => {
    assert.equal(formatDuration('2025-01-01', '2025-01-19'), '18 días');
    assert.equal(formatDuration('2025-01-01', '2025-02-05'), '1 mes y 4 días');
    assert.equal(formatDuration('2025-01-01', '2025-07-18'), '6 meses y 17 días');
    assert.equal(formatDuration('2023-01-01', '2025-05-15'), '2 años, 4 meses y 14 días');
});

test('formatDuration: omite las unidades a cero', () => {
    assert.equal(formatDuration('2023-01-01', '2025-01-15'), '2 años y 14 días');   // no "2 años, 0 meses y 14 días"
    assert.equal(formatDuration('2023-01-01', '2025-01-01'), '2 años');
    assert.equal(formatDuration('2025-01-01', '2025-03-01'), '2 meses');
});

test('formatDuration: singular y plural correctos', () => {
    assert.equal(formatDuration('2025-01-01', '2025-01-02'), '1 día');
    assert.equal(formatDuration('2025-01-01', '2025-01-03'), '2 días');
    assert.equal(formatDuration('2025-01-01', '2025-02-01'), '1 mes');
    assert.equal(formatDuration('2025-01-01', '2025-03-01'), '2 meses');
    assert.equal(formatDuration('2024-01-01', '2025-01-01'), '1 año');
    assert.equal(formatDuration('2023-01-01', '2025-01-01'), '2 años');
});

test('formatDuration: borde 0 días y fecha final anterior', () => {
    assert.equal(formatDuration('2025-05-10', '2025-05-10'), '0 días');
    assert.equal(formatDuration('2025-05-10', '2025-05-01'), '0 días');  // no negativos
});

test('formatDuration: cambio de año', () => {
    assert.equal(formatDuration('2024-12-28', '2025-01-03'), '6 días');
    assert.equal(formatDuration('2024-11-30', '2025-01-01'), '1 mes y 2 días');
    assert.equal(formatDuration('2024-12-31', '2025-01-01'), '1 día');
});

test('formatDuration: 29 de febrero (año bisiesto)', () => {
    assert.equal(formatDuration('2024-02-29', '2024-03-01'), '1 día');
    assert.equal(formatDuration('2024-02-28', '2024-02-29'), '1 día');
    assert.equal(formatDuration('2024-02-29', '2025-03-01'), '1 año');
    // 2024-02-29 + 11 meses = 2025-01-29; + 30 días = 2025-02-28 (el año no se cumple
    // porque el 29 de febrero no existe en 2025).
    assert.equal(formatDuration('2024-02-29', '2025-02-28'), '11 meses y 30 días');
    assert.equal(diffYMD('2024-02-29', '2025-02-28').total_dias, 365);
});

test('buildJournal: tiempo abierto de una posición aún abierta va hasta hoy', () => {
    const { rows } = buildJournal([buy('A', 10, 100, 0, '2025-01-01')], '2025-01-19');
    assert.equal(rows[0].tiempo_abierto, '18 días');
    assert.equal(rows[0].sigue_abierta, true);
    assert.equal(rows[0].cerrada_en, null);
});

test('buildJournal: posición cerrada cuenta hasta la fecha de cierre, no hasta hoy', () => {
    const ops = [buy('A', 10, 100, 0, '2025-01-01'), sell('A', 10, 120, 0, '2025-03-05')];
    const { rows } = buildJournal(ops, '2026-01-01');
    assert.equal(rows[0].tiempo_abierto, '2 meses y 4 días');   // compra -> cierre
    assert.equal(rows[0].sigue_abierta, false);
    assert.equal(rows[0].cerrada_en, '2025-03-05');
    assert.equal(rows[1].tiempo_abierto, '2 meses y 4 días');   // la venta, lo mismo
});

test('buildJournal: venta parcial mantiene la racha abierta; reabrir crea una racha nueva', () => {
    const ops = [buy('A', 10, 100, 0, '2025-01-01'), sell('A', 5, 120, 0, '2025-02-01'),
                 sell('A', 5, 130, 0, '2025-03-01'), buy('A', 3, 90, 0, '2025-06-01')];
    const { rows } = buildJournal(ops, '2025-06-20');
    assert.equal(rows[0].tiempo_abierto, '2 meses');          // 01-01 -> cierre 03-01
    assert.equal(rows[0].sigue_abierta, false);
    assert.equal(rows[1].tiempo_abierto, '1 mes');            // venta parcial: 01-01 -> 02-01
    assert.equal(rows[3].tiempo_abierto, '19 días');          // racha nueva -> hoy
    assert.equal(rows[3].sigue_abierta, true);
});

// ---------- Bloque 4: total invertido de la posición ----------
test('positionFrom: total_invertido = cantidad × precio medio + comisiones de entrada', () => {
    const ops = [buy('A', 10, 100, 5, '2025-01-01'), buy('A', 10, 120, 5, '2025-02-01')];
    const p = positionFrom(agg2(ops).get('A'));
    assert.equal(p.precio_medio, 110);
    assert.equal(p.comision_entrada_total, 10);
    assert.equal(p.total_invertido, 20 * 110 + 10);
    assert.equal(p.primera_compra, '2025-01-01');
});

test('positionFrom: tras vender, el total invertido refleja solo lo que sigue abierto', () => {
    const ops = [buy('A', 10, 100, 5, '2025-01-01'), sell('A', 6, 150, 2, '2025-03-01')];
    const p = positionFrom(agg2(ops).get('A'));
    assert.equal(p.cantidad_abierta, 4);
    assert.equal(p.total_invertido, 4 * 100 + 5);
    assert.equal(p.ultima_venta, '2025-03-01');
});

// ---------- Escenario completo exigido en la verificación ----------
// aportación → dos compras del mismo activo → compra de otro → venta parcial.
test('escenario completo: liquidez, pesos al 100%, pie del diario real y tiempo abierto', () => {
    const HOY = '2025-04-20';
    const ops = [
        cashOp('aportacion', 10000, '2025-01-01'),
        buy('AAPL', 10, 100, 5, '2025-01-10'),
        buy('AAPL', 10, 120, 5, '2025-02-10'),
        buy('MSFT', 5, 200, 5, '2025-03-01'),
        sell('AAPL', 8, 150, 5, '2025-04-15')
    ];

    // 1) Liquidez: baja con cada compra (importe + comisión) y sube con la venta.
    const bal = computeCashBalance(ops);
    // 10000 − 1005 − 1205 − 1005 + 1195 = 7980
    assert.equal(bal.por_moneda.EUR.saldo, 7980);
    assert.equal(bal.tiene_aportaciones, true);

    // 2) Precio medio recalculado con las dos compras: (1000+1200)/20 = 110.
    const pos = openPositions(ops);
    const aapl = pos.find(p => p.ticker === 'AAPL');
    assert.equal(aapl.precio_medio, 110);
    assert.equal(aapl.cantidad_abierta, 12);          // 20 − 8
    assert.equal(aapl.total_invertido, 12 * 110 + 10); // + comisiones de entrada

    // 3) Pesos con liquidez incluida: suman exactamente 100%.
    const valoradas = [{ ...aapl, valor: 12 * 150 }, { ...pos.find(p => p.ticker === 'MSFT'), valor: 5 * 220 }];
    const w = computePortfolioWeights(valoradas, bal.por_moneda.EUR.saldo);
    assert.equal(w.invertido, 1800 + 1100);
    assert.equal(w.total, 2900 + 7980);
    const suma = w.items.reduce((a, i) => a + i.peso_sobre_cartera, 0) + w.peso_liquidez;
    assert.ok(Math.abs(suma - 100) < 1e-9, `los pesos suman ${suma}`);
    // La liquidez es la mayor partida de esta cartera (73,3%).
    assert.ok(Math.abs(w.peso_liquidez - 7980 / 10880 * 100) < 1e-9);

    // 4) El pie del diario ya NO es 100% fijo: lo abierto pesa 26,65% de la cartera.
    const pesoAbierto = weightPct(w.invertido, w.total);
    assert.ok(Math.abs(pesoAbierto - 26.6544) < 0.001, `peso abierto ${pesoAbierto}`);
    assert.notEqual(Math.round(pesoAbierto), 100);

    // 5) Diario: tiempo abierto bien formateado y sin peso_total tautológico.
    const { rows, totales } = buildJournal(ops, HOY);
    assert.equal(totales.peso_total, undefined);
    assert.equal(rows[0].tipo_operacion, 'aportacion');
    assert.equal(rows[0].importe, 1000 * 10);
    assert.equal(rows[1].tiempo_abierto, '3 meses y 10 días');  // 01-10 -> 04-20, sigue abierta
    assert.equal(rows[1].sigue_abierta, true);
    assert.equal(rows[4].tipo_operacion, 'venta');
    assert.equal(rows[4].tiempo_abierto, '3 meses y 5 días');   // 01-10 -> venta 04-15
    // Beneficio de la venta parcial: (150 − 110) × 8 − comisión entrada prop. − 5
    assert.ok(Math.abs(rows[4].beneficio - ((150 - 110) * 8 - 10 * (8 / 20) - 5)) < 1e-9);

    // 6) Reparto: la tarta (posiciones + liquidez) suma 100%.
    const alloc = computeAllocation(pos, { AAPL: { price: 150 }, MSFT: { price: 220 } }, bal.por_moneda.EUR.saldo);
    assert.ok(Math.abs(alloc.items.reduce((a, i) => a + i.peso_sobre_cartera, 0) - 100) < 1e-9);
    assert.equal(alloc.items.find(i => i.es_liquidez).valor, 7980);
});
