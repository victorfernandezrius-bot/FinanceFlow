// Tests de la matemática de proyección de los Planes de Ahorro.
//   npm test   (node --test api/ y js/)
//
// La pieza clave es "la simulación coincide con la fórmula cerrada": el módulo
// simula mes a mes (una sola fuente de verdad, y así admite la capitalización
// anual), pero el resultado tiene que ser exactamente el del valor futuro de
// una serie de pagos. Si alguien toca el bucle, aquí se nota.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    tasaMensual, sumarMeses, mesesEntre, serieMensual, valorFuturo,
    mesesHastaObjetivo, cuotaNecesaria, proyectarPlan, MAX_MESES
} from './savings-logic.js';

const cerca = (a, b, tol = 0.02) =>
    assert.ok(Math.abs(a - b) <= tol, `esperaba ~${b}, obtuve ${a} (tolerancia ${tol})`);

// Fórmula cerrada: FV = P0(1+i)^n + PMT·[((1+i)^n - 1)/i]
const fvCerrada = (p0, pmt, i, n) =>
    i === 0 ? p0 + pmt * n
            : p0 * Math.pow(1 + i, n) + pmt * ((Math.pow(1 + i, n) - 1) / i);

test('tasaMensual convierte TAE efectiva, no nominal', () => {
    assert.equal(tasaMensual(0), 0);
    assert.equal(tasaMensual(-5), 0);
    const i = tasaMensual(12);
    cerca(Math.pow(1 + i, 12) - 1, 0.12, 1e-9);   // 12 meses -> la TAE exacta
    assert.ok(i < 0.12 / 12, 'la efectiva mensual debe ser menor que TAE/12');
});

test('la simulación mensual coincide con la fórmula cerrada', () => {
    for (const [p0, pmt, tae, n] of [
        [0, 200, 0, 24], [0, 200, 3, 24], [1000, 250, 2.5, 60],
        [5000, 0, 4, 120], [0, 50, 10, 1], [12345.67, 333.33, 1.75, 37]
    ]) {
        const i = tasaMensual(tae);
        cerca(valorFuturo({ capitalInicial: p0, aportacion: pmt, taeAnual: tae, meses: n }),
              fvCerrada(p0, pmt, i, n));
    }
});

test('sin interés, el valor futuro es la suma de aportaciones', () => {
    assert.equal(valorFuturo({ capitalInicial: 100, aportacion: 50, taeAnual: 0, meses: 10 }), 600);
});

test('la serie empieza en el mes 0 y no inventa intereses sin TAE', () => {
    const s = serieMensual({ capitalInicial: 400, aportacion: 100, taeAnual: 0, meses: 3 });
    assert.equal(s.length, 4);
    assert.deepEqual(s[0], { mes: 0, aportado: 400, interes: 0, saldo: 400 });
    assert.equal(s[3].saldo, 700);
    assert.equal(s[3].interes, 0);
    assert.equal(s[3].aportado, 700);
});

test('con interés, el saldo supera a lo aportado y la diferencia es el interés', () => {
    const s = serieMensual({ capitalInicial: 1000, aportacion: 100, taeAnual: 5, meses: 36 });
    const fin = s[s.length - 1];
    assert.ok(fin.saldo > fin.aportado);
    cerca(fin.saldo - fin.aportado, fin.interes, 0.05);
});

test('sin aportaciones, mensual y anual dan lo MISMO (la TAE es efectiva)', () => {
    // Capitalizar una TAE efectiva mes a mes o abonarla de golpe al año es
    // idéntico cuando no hay flujos de caja: eso es lo que significa "efectiva".
    const comun = { capitalInicial: 10000, aportacion: 0, taeAnual: 4, meses: 24 };
    const mensual = valorFuturo({ ...comun, capitalizacion: 'mensual' });
    const anual = valorFuturo({ ...comun, capitalizacion: 'anual' });
    assert.equal(anual, mensual);
    assert.equal(mensual, 10816);              // 10000 x 1,04^2
});

test('con aportaciones, las dos capitalizaciones difieren, pero por céntimos', () => {
    // Con flujos de caja sí difieren, porque cambia CUÁNDO se abona el interés:
    // en mensual cada aportación capitaliza desde el mes siguiente; en anual
    // pondera (12-k)/12 del tipo anual dentro del saldo medio del año. El signo
    // de la diferencia depende del calendario de aportaciones, así que lo que
    // se fija aquí es la magnitud: una convención de abono, no un modelo
    // distinto de rentabilidad.
    const comun = { capitalInicial: 1000, aportacion: 200, taeAnual: 4, meses: 36 };
    const mensual = valorFuturo({ ...comun, capitalizacion: 'mensual' });
    const anual = valorFuturo({ ...comun, capitalizacion: 'anual' });
    const aportado = 1000 + 200 * 36;
    assert.ok(mensual > aportado && anual > aportado, 'ambas deben rendir sobre lo aportado');
    assert.ok(Math.abs(mensual - anual) < mensual * 0.005,
        `diferencia ${Math.abs(mensual - anual)} sobre ${mensual}: debe ser marginal`);
});

test('mesesHastaObjetivo: caso sin interés es aritmética simple', () => {
    assert.equal(mesesHastaObjetivo({ capitalInicial: 0, aportacion: 100, objetivo: 1000 }), 10);
    assert.equal(mesesHastaObjetivo({ capitalInicial: 500, aportacion: 100, objetivo: 1000 }), 5);
});

test('mesesHastaObjetivo: el interés acorta el plazo', () => {
    const sin = mesesHastaObjetivo({ capitalInicial: 0, aportacion: 200, objetivo: 20000 });
    const con = mesesHastaObjetivo({ capitalInicial: 0, aportacion: 200, taeAnual: 5, objetivo: 20000 });
    assert.ok(con < sin, `con interés ${con} debería ser menor que sin interés ${sin}`);
});

test('mesesHastaObjetivo: casos límite devuelven null o 0, nunca Infinity', () => {
    assert.equal(mesesHastaObjetivo({ capitalInicial: 0, aportacion: 0, objetivo: 1000 }), null);
    assert.equal(mesesHastaObjetivo({ capitalInicial: 1000, aportacion: 10, objetivo: 1000 }), 0);
    assert.equal(mesesHastaObjetivo({ capitalInicial: 0, aportacion: 100, objetivo: 0 }), null);
    // 1 €/mes hacia 10 millones sin interés: más de 100 años -> null
    assert.equal(mesesHastaObjetivo({ capitalInicial: 0, aportacion: 1, objetivo: 1e7 }), null);
});

test('mesesHastaObjetivo: solo con interés, sin aportar, también llega', () => {
    const m = mesesHastaObjetivo({ capitalInicial: 10000, aportacion: 0, taeAnual: 10, objetivo: 11000 });
    assert.ok(m !== null && m > 0 && m <= 13, `esperaba ~12 meses, obtuve ${m}`);
});

test('cuotaNecesaria es la inversa de la simulación', () => {
    for (const [p0, tae, meta, n] of [[0, 0, 10000, 50], [1000, 3, 10000, 60], [0, 2.5, 5000, 24]]) {
        const cuota = cuotaNecesaria({ capitalInicial: p0, taeAnual: tae, objetivo: meta, meses: n });
        assert.ok(cuota !== null);
        const conCuota = valorFuturo({ capitalInicial: p0, aportacion: cuota, taeAnual: tae, meses: n });
        assert.ok(conCuota >= meta - 0.01, `con la cuota ${cuota} se llega: ${conCuota} >= ${meta}`);
        const menos = valorFuturo({ capitalInicial: p0, aportacion: cuota - 0.05, taeAnual: tae, meses: n });
        assert.ok(menos < meta, `con 5 céntimos menos NO se llega: ${menos} < ${meta}`);
    }
});

test('cuotaNecesaria: 0 si el capital ya llega solo, null si no tiene sentido', () => {
    assert.equal(cuotaNecesaria({ capitalInicial: 20000, objetivo: 10000, meses: 12 }), 0);
    assert.equal(cuotaNecesaria({ capitalInicial: 0, objetivo: 10000, meses: 0 }), null);
    assert.equal(cuotaNecesaria({ capitalInicial: 0, objetivo: 0, meses: 12 }), null);
});

test('sumarMeses no desborda el día ni el año', () => {
    assert.equal(sumarMeses('2026-01-31', 1), '2026-02-28');
    assert.equal(sumarMeses('2028-01-31', 1), '2028-02-29');   // bisiesto
    assert.equal(sumarMeses('2026-12-15', 1), '2027-01-15');
    assert.equal(sumarMeses('2026-10-19', 0), '2026-10-19');
    assert.equal(sumarMeses('2026-10-19', 25), '2028-11-19');
});

test('mesesEntre redondea al alza los días sueltos', () => {
    assert.equal(mesesEntre('2026-01-01', '2026-07-01'), 6);
    assert.equal(mesesEntre('2026-01-01', '2026-07-15'), 7);   // 6 meses y pico -> 7 oportunidades
    assert.equal(mesesEntre('2026-01-01', '2025-12-01'), -1);
    assert.equal(mesesEntre(null, '2026-01-01'), null);
});

test('proyectarPlan en modo cuota_fija calcula la fecha', () => {
    const plan = { modo: 'cuota_fija', objetivo_total: 10000, aportacion: 250, interes_anual: 0 };
    const p = proyectarPlan(plan, 0, '2026-01-01');
    assert.equal(p.alcanzable, true);
    assert.equal(p.meses, 40);                       // 10000 / 250
    assert.equal(p.fechaEstimada, '2029-05-01');
    assert.equal(p.interesProyectado, 0);
    assert.equal(p.totalAportado, 10000);
});

test('proyectarPlan en modo objetivo_fecha calcula la cuota', () => {
    const plan = { modo: 'objetivo_fecha', objetivo_total: 12000, fecha_limite: '2027-01-01', interes_anual: 0 };
    const p = proyectarPlan(plan, 0, '2026-01-01');
    assert.equal(p.alcanzable, true);
    assert.equal(p.meses, 12);
    assert.equal(p.cuota, 1000);
});

test('proyectarPlan parte de lo ya asignado, no de cero', () => {
    const plan = { modo: 'cuota_fija', objetivo_total: 10000, aportacion: 250, interes_anual: 0 };
    assert.equal(proyectarPlan(plan, 5000, '2026-01-01').meses, 20);
});

test('proyectarPlan avisa en vez de romperse', () => {
    const vencido = proyectarPlan(
        { modo: 'objetivo_fecha', objetivo_total: 1000, fecha_limite: '2020-01-01' }, 0, '2026-01-01');
    assert.equal(vencido.alcanzable, false);
    assert.match(vencido.motivo, /fecha límite/i);

    const sinCuota = proyectarPlan({ modo: 'cuota_fija', objetivo_total: 1000, aportacion: 0 }, 0, '2026-01-01');
    assert.equal(sinCuota.alcanzable, false);
    assert.match(sinCuota.motivo, /nunca/i);

    const sinObjetivo = proyectarPlan({ modo: 'cuota_fija', objetivo_total: 0, aportacion: 10 }, 0, '2026-01-01');
    assert.equal(sinObjetivo.alcanzable, false);
});

test('proyectarPlan marca cumplido cuando ya se alcanzó', () => {
    const p = proyectarPlan({ modo: 'cuota_fija', objetivo_total: 1000, aportacion: 50 }, 1200, '2026-01-01');
    assert.equal(p.alcanzable, true);
    assert.equal(p.cumplido, true);
    assert.equal(p.meses, 0);
});

test('ninguna salida contiene NaN ni Infinity', () => {
    const casos = [
        { modo: 'cuota_fija', objetivo_total: 10000, aportacion: 250, interes_anual: 2.5 },
        { modo: 'cuota_fija', objetivo_total: 10000, aportacion: null, interes_anual: null },
        { modo: 'objetivo_fecha', objetivo_total: 5000, fecha_limite: '2030-01-01', interes_anual: 3 },
        { modo: 'objetivo_fecha', objetivo_total: 5000, fecha_limite: null },
        {}
    ];
    for (const plan of casos) {
        const p = proyectarPlan(plan, 100, '2026-01-01');
        for (const [k, v] of Object.entries(p)) {
            if (typeof v === 'number') {
                assert.ok(Number.isFinite(v), `${k} = ${v} en ${JSON.stringify(plan)}`);
            }
        }
    }
});

test('la serie nunca supera el tope de meses', () => {
    assert.equal(serieMensual({ aportacion: 1, meses: 99999 }).length, MAX_MESES + 1);
});
