// ============================================================
// js/savings-logic.js — Planes de Ahorro: matemática de la proyección
// ------------------------------------------------------------
// Módulo PURO: sin DOM, sin fetch, sin estado. Se puede ejecutar en Node y
// por eso tiene test propio (tests/savings-logic.test.mjs).
//
// AVISO QUE NO HAY QUE PERDER DE VISTA: todo lo que calcula este fichero es
// SIMULACIÓN. El interés proyectado no se suma nunca al saldo real de la
// cuenta ni genera movimientos contables. Si el banco paga intereses de
// verdad, el usuario los registra como un ingreso normal, y eso sí entra en
// la contabilidad por su cuenta.
//
// Modelo: interés COMPUESTO con aportaciones periódicas mensuales, pagadas
// al FINAL de cada mes (ordinary annuity). En un mes primero corren los
// intereses sobre el saldo y después entra la aportación:
//
//     FV(n) = P0·(1+i)^n + PMT·[((1+i)^n − 1) / i]
//
// El % que guarda el plan se interpreta como TAE EFECTIVA (es lo que anuncia
// un depósito), así que el tipo mensual equivalente es:
//
//     i = (1 + TAE)^(1/12) − 1          (no TAE/12, que sería el nominal)
//
// Aquí no se usa la fórmula cerrada para resolver: se simula mes a mes, que
// es una sola fuente de verdad y además admite la capitalización anual. El
// test comprueba que la simulación coincide con la fórmula cerrada.
// ============================================================

// Tope de la simulación: 100 años. Más allá, un plan se considera inalcanzable.
export const MAX_MESES = 1200;

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// TAE efectiva (en %) -> tipo mensual equivalente (en tanto por uno).
export function tasaMensual(taeAnual) {
    const tae = Number(taeAnual) || 0;
    if (tae <= 0) return 0;
    return Math.pow(1 + tae / 100, 1 / 12) - 1;
}

// Suma meses a una fecha YYYY-MM-DD sin que se desborde el día
// (31 de enero + 1 mes = 28/29 de febrero, no el 2 o 3 de marzo).
export function sumarMeses(fechaISO, meses) {
    const [y, m, d] = String(fechaISO).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    const total = (m - 1) + Math.round(meses);
    const anio = y + Math.floor(total / 12);
    const mes = ((total % 12) + 12) % 12;
    const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    const dia = Math.min(d, ultimoDia);
    return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Serie mes a mes. Devuelve [{mes, aportado, interes, saldo}], con el mes 0
// como punto de partida (lo que ya hay asignado al plan).
//
// capitalizacion:
//   'mensual' -> el interés se abona cada mes y capitaliza (compuesto puro).
//   'anual'   -> el interés se abona una vez al año, calculado sobre el saldo
//                MEDIO de esos 12 meses, y a partir de ahí capitaliza. Es la
//                aproximación habitual de un depósito que liquida una vez al
//                año; dentro del año no hay capitalización.
//                Sin aportaciones da EXACTAMENTE lo mismo que 'mensual' (la TAE
//                es efectiva). Con aportaciones difiere por céntimos sobre
//                miles de euros, y el signo depende del calendario de ingresos:
//                es una convención de abono, no otro modelo de rentabilidad.
export function serieMensual({ capitalInicial = 0, aportacion = 0, taeAnual = 0,
                               capitalizacion = 'mensual', meses = 0 } = {}) {
    const i = tasaMensual(taeAnual);
    const anual = capitalizacion === 'anual';
    const n = Math.max(0, Math.min(MAX_MESES, Math.floor(meses)));
    const pmt = Math.max(0, Number(aportacion) || 0);

    let saldo = Math.max(0, Number(capitalInicial) || 0);
    let aportado = saldo;          // dinero REAL puesto (sin intereses)
    let interesAcum = 0;
    let sumaSaldos = 0;            // para la media del año en capitalización anual

    const serie = [{ mes: 0, aportado: r2(aportado), interes: 0, saldo: r2(saldo) }];

    for (let m = 1; m <= n; m++) {
        if (i > 0) {
            if (anual) {
                sumaSaldos += saldo;
                if (m % 12 === 0) {
                    const interes = (sumaSaldos / 12) * (Math.pow(1 + i, 12) - 1);
                    saldo += interes;
                    interesAcum += interes;
                    sumaSaldos = 0;
                }
            } else {
                const interes = saldo * i;
                saldo += interes;
                interesAcum += interes;
            }
        }
        saldo += pmt;
        aportado += pmt;
        serie.push({ mes: m, aportado: r2(aportado), interes: r2(interesAcum), saldo: r2(saldo) });
    }
    return serie;
}

// Valor futuro a n meses (el último punto de la serie).
export function valorFuturo(opts) {
    const serie = serieMensual(opts);
    return serie[serie.length - 1].saldo;
}

// ¿Cuántos meses faltan para llegar al objetivo?
// Devuelve el número de meses, o null si no se alcanza nunca (sin aportación
// y sin interés suficiente) o si harían falta más de MAX_MESES.
export function mesesHastaObjetivo({ capitalInicial = 0, aportacion = 0, taeAnual = 0,
                                     capitalizacion = 'mensual', objetivo = 0 } = {}) {
    const meta = Number(objetivo) || 0;
    let saldo = Math.max(0, Number(capitalInicial) || 0);
    if (meta <= 0) return null;
    if (saldo >= meta) return 0;

    const i = tasaMensual(taeAnual);
    const pmt = Math.max(0, Number(aportacion) || 0);
    // Sin aportación y sin interés el saldo no se mueve: nunca llega.
    if (pmt === 0 && i === 0) return null;

    const anual = capitalizacion === 'anual';
    let sumaSaldos = 0;
    for (let m = 1; m <= MAX_MESES; m++) {
        if (i > 0) {
            if (anual) {
                sumaSaldos += saldo;
                if (m % 12 === 0) {
                    saldo += (sumaSaldos / 12) * (Math.pow(1 + i, 12) - 1);
                    sumaSaldos = 0;
                }
            } else {
                saldo += saldo * i;
            }
        }
        saldo += pmt;
        if (r2(saldo) >= r2(meta)) return m;
    }
    return null;
}

// ¿Qué cuota mensual hace falta para llegar al objetivo en n meses?
// Se resuelve por bisección sobre la misma simulación, para no tener dos
// fórmulas que puedan discrepar. Devuelve null si no tiene sentido pedirlo.
export function cuotaNecesaria({ capitalInicial = 0, taeAnual = 0,
                                 capitalizacion = 'mensual', objetivo = 0, meses = 0 } = {}) {
    const meta = Number(objetivo) || 0;
    const n = Math.floor(Number(meses) || 0);
    const p0 = Math.max(0, Number(capitalInicial) || 0);
    if (meta <= 0 || n <= 0) return null;
    // Ya se llega sin aportar nada (solo con el capital y sus intereses).
    if (valorFuturo({ capitalInicial: p0, aportacion: 0, taeAnual, capitalizacion, meses: n }) >= meta) {
        return 0;
    }

    const fv = (pmt) => valorFuturo({ capitalInicial: p0, aportacion: pmt, taeAnual, capitalizacion, meses: n });

    // Cota superior: duplicar hasta pasarse (como mucho, toda la meta cada mes).
    let hi = Math.max(1, meta / n);
    let intentos = 0;
    while (fv(hi) < meta && intentos++ < 60) hi *= 2;
    if (fv(hi) < meta) return null;

    let lo = 0;
    for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (fv(mid) >= meta) hi = mid; else lo = mid;
    }
    // Se redondea al alza: quedarse corto por medio céntimo no sirve de nada.
    return Math.ceil(hi * 100) / 100;
}

// ------------------------------------------------------------
// Proyección completa de un plan, lista para pintar.
//
// plan: fila de savings_plans (modo, objetivo_total, aportacion, fecha_limite,
//       interes_anual, capitalizacion)
// asignado: lo que YA tiene el sobre (punto de partida de la simulación)
// hoyISO: fecha desde la que se proyecta (por defecto, hoy)
//
// Devuelve siempre un objeto con `alcanzable` y, si no lo es, un `motivo`
// legible: nunca lanza ni devuelve Infinity.
// ------------------------------------------------------------
export function proyectarPlan(plan, asignado = 0, hoyISO = new Date().toISOString().slice(0, 10)) {
    const objetivo = Number(plan?.objetivo_total) || 0;
    const taeAnual = Number(plan?.interes_anual) || 0;
    const capitalizacion = plan?.capitalizacion === 'anual' ? 'anual' : 'mensual';
    const p0 = Math.max(0, Number(asignado) || 0);
    const base = { objetivo, asignado: r2(p0), taeAnual, capitalizacion, restante: r2(Math.max(0, objetivo - p0)) };

    if (objetivo <= 0) {
        return { ...base, alcanzable: false, motivo: 'El plan no tiene objetivo definido.' };
    }
    if (p0 >= objetivo) {
        return { ...base, alcanzable: true, cumplido: true, meses: 0, fechaEstimada: hoyISO,
                 cuota: Number(plan?.aportacion) || 0, totalAportado: r2(p0), interesProyectado: 0,
                 serie: serieMensual({ capitalInicial: p0, meses: 0 }) };
    }

    if (plan?.modo === 'objetivo_fecha') {
        // El usuario fija meta y fecha; calculamos la cuota necesaria.
        const meses = mesesEntre(hoyISO, plan?.fecha_limite);
        if (meses === null || meses <= 0) {
            return { ...base, alcanzable: false,
                     motivo: 'La fecha límite ya ha pasado: revísala o cambia el plan a cuota fija.' };
        }
        const cuota = cuotaNecesaria({ capitalInicial: p0, taeAnual, capitalizacion, objetivo, meses });
        if (cuota === null) {
            return { ...base, alcanzable: false, meses,
                     motivo: 'No hay una cuota razonable que llegue a ese objetivo en esa fecha.' };
        }
        const serie = serieMensual({ capitalInicial: p0, aportacion: cuota, taeAnual, capitalizacion, meses });
        const fin = serie[serie.length - 1];
        return { ...base, alcanzable: true, meses, cuota, fechaEstimada: sumarMeses(hoyISO, meses),
                 totalAportado: fin.aportado, interesProyectado: fin.interes, serie };
    }

    // modo 'cuota_fija': el usuario fija la cuota; calculamos cuándo llega.
    const cuota = Math.max(0, Number(plan?.aportacion) || 0);
    const meses = mesesHastaObjetivo({ capitalInicial: p0, aportacion: cuota, taeAnual, capitalizacion, objetivo });
    if (meses === null) {
        return { ...base, alcanzable: false, cuota,
                 motivo: cuota > 0
                     ? 'Con esa cuota harían falta más de 100 años.'
                     : 'Sin cuota mensual el plan nunca alcanza el objetivo.' };
    }
    const serie = serieMensual({ capitalInicial: p0, aportacion: cuota, taeAnual, capitalizacion, meses });
    const fin = serie[serie.length - 1];
    return { ...base, alcanzable: true, meses, cuota, fechaEstimada: sumarMeses(hoyISO, meses),
             totalAportado: fin.aportado, interesProyectado: fin.interes, serie };
}

// Meses completos entre dos fechas YYYY-MM-DD (redondeando hacia arriba: si
// quedan 2 meses y 3 días, hay 3 oportunidades de aportar).
export function mesesEntre(desdeISO, hastaISO) {
    if (!desdeISO || !hastaISO) return null;
    const [y1, m1, d1] = String(desdeISO).slice(0, 10).split('-').map(Number);
    const [y2, m2, d2] = String(hastaISO).slice(0, 10).split('-').map(Number);
    if (!y1 || !y2) return null;
    let meses = (y2 - y1) * 12 + (m2 - m1);
    if (d2 > d1) meses += 1;
    return meses;
}

export default {
    MAX_MESES, r2, tasaMensual, sumarMeses, serieMensual, valorFuturo,
    mesesHastaObjetivo, cuotaNecesaria, proyectarPlan, mesesEntre
};
