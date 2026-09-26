// Tests unitarios de la lógica pura de tesorería (sin red ni base de datos).
// Ejecutar: node api/tesoreria-logic.test.js   (o npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addMonthsClamped, expandCompromiso, expandCosteFijo, buildAgenda,
    resumenTesoreria, saldoBancario, hoyMadrid, isISODate, addDays
} from './tesoreria-logic.js';

const comp = (o = {}) => ({
    id: 'c1', tipo: 'pago', cuenta_id: 'g1', concepto: 'Alquiler', importe: 800,
    frecuencia: 'mensual', fecha_ancla: '2026-01-15', fecha_fin: null, activo: 1, ...o
});
const fechas = arr => arr.map(i => i.fecha);

test('1. mensual con ancla 31-ene → último día de cada mes sin perder el 31', () => {
    const c = comp({ fecha_ancla: '2026-01-31' });
    assert.deepEqual(fechas(expandCompromiso(c, '2026-01-01', '2026-05-31')),
        ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    // Año bisiesto
    const b = comp({ fecha_ancla: '2028-01-31' });
    assert.deepEqual(fechas(expandCompromiso(b, '2028-01-01', '2028-03-31')), ['2028-02-29', '2028-03-31']);
    assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonthsClamped('2026-01-31', 2), '2026-03-31');
    assert.equal(addMonthsClamped('2026-11-15', 3), '2027-02-15');
});

test('2. trimestral, semestral y anual con ancla normal', () => {
    assert.deepEqual(fechas(expandCompromiso(comp({ frecuencia: 'trimestral', fecha_ancla: '2026-01-10' }), '2026-01-01', '2026-12-31')),
        ['2026-04-10', '2026-07-10', '2026-10-10']);
    assert.deepEqual(fechas(expandCompromiso(comp({ frecuencia: 'semestral', fecha_ancla: '2026-03-05' }), '2026-01-01', '2027-12-31')),
        ['2026-09-05', '2027-03-05', '2027-09-05']);
    assert.deepEqual(fechas(expandCompromiso(comp({ frecuencia: 'anual', fecha_ancla: '2025-06-20' }), '2026-01-01', '2028-12-31')),
        ['2026-06-20', '2027-06-20', '2028-06-20']);
});

test('2b. rango que empieza años después del ancla y la ancla nunca se proyecta', () => {
    const c = comp({ fecha_ancla: '2020-01-31' });
    assert.deepEqual(fechas(expandCompromiso(c, '2026-02-01', '2026-03-31')), ['2026-02-28', '2026-03-31']);
    const c2 = comp({ fecha_ancla: '2026-02-10' });
    assert.deepEqual(fechas(expandCompromiso(c2, '2026-02-01', '2026-03-31')), ['2026-03-10']);
});

test('3. anual con ancla 29-feb-2024 → 28-feb y vuelve al 29 en bisiesto', () => {
    const c = comp({ frecuencia: 'anual', fecha_ancla: '2024-02-29' });
    assert.deepEqual(fechas(expandCompromiso(c, '2024-01-01', '2028-12-31')),
        ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
});

test('4. fecha_fin corta la serie; activo=0 no genera nada', () => {
    const c = comp({ fecha_ancla: '2026-01-15', fecha_fin: '2026-04-15' });
    assert.deepEqual(fechas(expandCompromiso(c, '2026-01-01', '2026-12-31')), ['2026-02-15', '2026-03-15', '2026-04-15']);
    assert.deepEqual(expandCompromiso(comp({ activo: 0 }), '2026-01-01', '2026-12-31'), []);
    assert.deepEqual(expandCompromiso(comp({ activo: false }), '2026-01-01', '2026-12-31'), []);
});

test('5. coste fijo día 31 en abril → 30-abr', () => {
    const a = { id: 'g2', nombre: 'Gimnasio', tipo: 'gasto', is_fixed_cost: 1, fixed_monthly_amount: 40, fixed_due_day: 31 };
    const occ = expandCosteFijo(a, '2026-04-01', '2026-05-31');
    assert.deepEqual(fechas(occ), ['2026-04-30', '2026-05-31']);
    assert.equal(occ[0].origen, 'coste_fijo');
    assert.equal(occ[0].tipo, 'pago');
    // Fuera de rango por la izquierda: el día 10 de abril no entra si desde es 15-abr
    const b = { ...a, fixed_due_day: 10 };
    assert.deepEqual(fechas(expandCosteFijo(b, '2026-04-15', '2026-06-09')), ['2026-05-10']);
    // No es coste fijo (D1 devuelve 0) → nada
    assert.deepEqual(expandCosteFijo({ ...a, is_fixed_cost: 0 }, '2026-04-01', '2026-05-31'), []);
});

test('6. cuenta con coste fijo Y compromiso pago activo → sin duplicado', () => {
    const accounts = [
        { id: 'g1', nombre: 'Alquiler', tipo: 'gasto', is_fixed_cost: 1, fixed_monthly_amount: 800, fixed_due_day: 1 },
        { id: 'g2', nombre: 'Luz', tipo: 'gasto', is_fixed_cost: 1, fixed_monthly_amount: 60, fixed_due_day: 5 }
    ];
    const compromisos = [comp({ cuenta_id: 'g1', fecha_ancla: '2026-01-01' })];
    const ag = buildAgenda({ compromisos, accounts, desde: '2026-02-01', hasta: '2026-02-28' });
    assert.deepEqual(ag.map(i => [i.fecha, i.cuenta_id, i.origen]),
        [['2026-02-01', 'g1', 'compromiso'], ['2026-02-05', 'g2', 'coste_fijo']]);
    assert.equal(ag[0].cuenta_nombre, 'Alquiler');
    // Si el compromiso se detiene, vuelve a aparecer el coste fijo de la cuenta
    const ag2 = buildAgenda({ compromisos: [{ ...compromisos[0], activo: 0 }], accounts, desde: '2026-02-01', hasta: '2026-02-28' });
    assert.deepEqual(ag2.map(i => [i.cuenta_id, i.origen]), [['g1', 'coste_fijo'], ['g2', 'coste_fijo']]);
});

test('7. resumenTesoreria cuadra: efectivo_proyectado = saldo + cobros − pagos', () => {
    const compromisos = [
        comp({ id: 'n', tipo: 'cobro', cuenta_id: 'i1', concepto: 'Nómina', importe: 2100.10, fecha_ancla: '2026-01-28' }),
        comp({ id: 'a', tipo: 'pago', cuenta_id: 'g1', concepto: 'Alquiler', importe: 850.35, fecha_ancla: '2026-01-01' }),
        comp({ id: 's', tipo: 'pago', cuenta_id: 'g3', concepto: 'Seguro', importe: 300, frecuencia: 'anual', fecha_ancla: '2025-03-15' })
    ];
    const accounts = [{ id: 'g4', nombre: 'Internet', tipo: 'gasto', is_fixed_cost: 1, fixed_monthly_amount: 39.9, fixed_due_day: 20 }];
    const ag = buildAgenda({ compromisos, accounts, desde: '2026-03-01', hasta: '2026-04-30' });
    const r = resumenTesoreria(ag, 1234.56);
    assert.equal(r.cobros_total, 4200.2);
    assert.equal(r.pagos_total, Math.round((850.35 * 2 + 300 + 39.9 * 2) * 100) / 100);
    assert.equal(r.flujo_neto, Math.round((r.cobros_total - r.pagos_total) * 100) / 100);
    assert.equal(r.efectivo_proyectado, Math.round((1234.56 + r.cobros_total - r.pagos_total) * 100) / 100);
    assert.equal(r.detalle_cobros.length + r.detalle_pagos.length, ag.length);
    assert.equal(r.por_cuenta_pagos[0].cuenta_id, 'g1'); // mayor total primero
    assert.equal(r.por_cuenta_pagos.reduce((s, g) => s + g.n, 0), r.detalle_pagos.length);
});

test('saldoBancario: activos bancarios; si no hay, todos los activos (1/0 de D1)', () => {
    const acc = [
        { tipo: 'activo', saldo_actual: 1000, is_bank_account: 1 },
        { tipo: 'activo', saldo_actual: 500, is_bank_account: 0 },
        { tipo: 'pasivo', saldo_actual: 9999, is_bank_account: 1 }
    ];
    assert.equal(saldoBancario(acc), 1000);
    assert.equal(saldoBancario(acc.map(a => ({ ...a, is_bank_account: 0 }))), 1500);
});

test('fechas: hoyMadrid, isISODate, addDays', () => {
    // 23:30 UTC del 31-dic ya es 1-ene en Madrid
    assert.equal(hoyMadrid(new Date('2025-12-31T23:30:00Z')), '2026-01-01');
    assert.equal(hoyMadrid(new Date('2026-07-15T21:59:00Z')), '2026-07-15');
    assert.equal(hoyMadrid(new Date('2026-07-15T22:01:00Z')), '2026-07-16');
    assert.ok(isISODate('2028-02-29'));
    assert.ok(!isISODate('2026-02-29'));
    assert.ok(!isISODate('2026-2-01'));
    assert.equal(addDays('2026-02-27', 2), '2026-03-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
