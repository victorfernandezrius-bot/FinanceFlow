// ============================================================
// js/savings-plans.js — Planes de Ahorro (PREMIUM)
// ------------------------------------------------------------
// FASE 1: CRUD de planes + "ahorro libre" visible.
//   - SIN proyección ni gráfica (Fase 2: api/savings-logic.js).
//   - SIN aportaciones/retiradas contables (Fase 3: contribute/withdraw/close).
//
// Modelo de "sobres": un plan reserva parte del saldo REAL de una cuenta de
// tipo 'activo'. Una cuenta puede tener varios planes.
//   asignado(cuenta)     = suma de lo asignado a sus planes vivos
//   ahorro_libre(cuenta) = saldo_actual - colchon_minimo - asignado
//
// El % de interés del plan se guarda pero aquí es informativo: no se proyecta
// nada todavía y NUNCA toca saldos ni genera movimientos contables.
//
// El estado vive en el servidor (D1). Este módulo no cachea entre secciones:
// cada entrada a la sección recarga, para no mostrar un "asignado" obsoleto.
// ============================================================

import Auth from './auth.js';
import DataClient from '../src/services/data-client.js';
import { proyectarPlan } from './savings-logic.js';

// Estados que RESERVAN dinero de la cuenta. Debe coincidir con SP_ESTADOS_VIVOS
// del Worker: 'cancelado' libera el dinero y no cuenta.
const ESTADOS_VIVOS = ['activo', 'pausado', 'completado'];

const ESTADO_BADGE = {
    activo:     { texto: 'Activo',     clase: 'bg-green-100 text-green-800' },
    pausado:    { texto: 'Pausado',    clase: 'bg-yellow-100 text-yellow-800' },
    completado: { texto: 'Completado', clase: 'bg-blue-100 text-blue-800' },
    cancelado:  { texto: 'Cancelado',  clase: 'bg-gray-100 text-gray-600' }
};

const PRODUCTOS = {
    cuenta_remunerada: 'Cuenta remunerada',
    deposito: 'Depósito',
    fondo: 'Fondo',
    letras: 'Letras del Tesoro',
    otro: 'Otro'
};

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Nombres de mes fijos: no dependemos de los datos de ICU del navegador.
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesAnio = (iso) => {
    if (!iso) return '—';
    const [y, m] = String(iso).slice(0, 10).split('-').map(Number);
    return (MESES_ES[m - 1] || '?') + ' de ' + y;
};

// Paleta de la gráfica. Dos series categóricas; el objetivo es una línea de
// referencia en tinta neutra, no una tercera serie con color propio.
// Validada para daltonismo y contraste en los dos modos:
//   claro  sobre #FFFFFF  -> ΔE normal 34.7 · protan 27.5 · contraste >= 3:1
//   oscuro sobre #1F2937  -> dentro de la banda de luminosidad oscura, >= 3:1
const PALETA = {
    claro:  { aportado: '#C2410C', total: '#0158C9', refer: '#6B7280',
              grid: 'rgba(17,24,39,.08)', tinta: '#374151' },
    oscuro: { aportado: '#E2690F', total: '#0C8FD6', refer: '#9CA3AF',
              grid: 'rgba(249,250,251,.10)', tinta: '#9CA3AF' }
};
const esModoOscuro = () => document.documentElement.classList.contains('dark');

// Escapado obligatorio: nombre y descripción son texto del usuario y se
// insertan con innerHTML.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

class SavingsPlans {
    // deps.getAccounts: () => cuentas ya cargadas por el AccountingManager
    // deps.toast:       (mensaje, tipo) => void
    // deps.formatCurrency: (importe) => string  (respeta la divisa del usuario)
    constructor(deps = {}) {
        this.getAccounts = deps.getAccounts || (() => []);
        this.toast = deps.toast || ((m) => console.log(m));
        this.formatCurrency = deps.formatCurrency || ((v) => `${r2(v)}`);
        this.plans = [];
        this.editingId = null;      // id del plan en edición (null = nuevo)
        this.deletingId = null;     // id del plan en el diálogo de cierre
        this.cushionAccountId = null;
        this.chart = null;          // instancia de Chart.js; hay que destruirla al reabrir
    }

    // ---------- Entrada desde dashboard.loadSectionData('savings') ----------
    async initSection() {
        const gate = document.getElementById('savings-premium-gate');
        const content = document.getElementById('savings-content');
        if (!gate || !content) return;

        const nuevoBtn = document.getElementById('savings-new-plan-btn');
        if (!Auth.isPremium()) {
            gate.classList.remove('hidden');
            content.classList.add('hidden');
            nuevoBtn?.classList.add('hidden');   // sección bloqueada: sin acciones
            return;
        }
        gate.classList.add('hidden');
        content.classList.remove('hidden');
        nuevoBtn?.classList.remove('hidden');
        await this.reload();
    }

    async reload() {
        const list = document.getElementById('savings-plans-list');
        if (list) {
            list.innerHTML = `<div class="text-center py-8 text-gray-500">
                <i class="fas fa-spinner fa-spin mr-2"></i>Cargando planes…</div>`;
        }
        try {
            this.plans = await DataClient.listSavingsPlans() || [];
        } catch (e) {
            this.plans = [];
            if (list) {
                list.innerHTML = `<div class="text-center py-8">
                    <i class="fas fa-triangle-exclamation text-3xl text-red-400 mb-2"></i>
                    <p class="text-sm text-gray-600">No se han podido cargar los planes: ${esc(e.message)}</p>
                </div>`;
            }
            return;
        }
        this.render();
    }

    // ---------- Cálculo de sobres ----------
    savingsAccounts() {
        return (this.getAccounts() || []).filter(a => a.tipo === 'activo');
    }

    // Por cuenta de tipo activo: saldo, colchón, asignado, ahorro libre y sus planes.
    summaryByAccount() {
        const out = [];
        for (const acc of this.savingsAccounts()) {
            const planes = this.plans.filter(p => p.cuenta_ahorro_id === acc.id);
            const asignado = r2(planes
                .filter(p => ESTADOS_VIVOS.includes(p.estado))
                .reduce((s, p) => s + (Number(p.asignado) || 0), 0));
            const saldo = Number(acc.saldo_actual) || 0;
            const colchon = Number(acc.colchon_minimo) || 0;
            out.push({
                cuenta: acc, saldo, colchon, asignado, planes,
                libre: r2(saldo - colchon - asignado),
                // >0 cuando hay más asignado del que la cuenta puede respaldar
                descuadre: r2(saldo - colchon - asignado) < 0 ? r2(asignado - (saldo - colchon)) : 0
            });
        }
        return out;
    }

    // ---------- Render ----------
    render() {
        this.renderAccountsSummary();
        this.renderPlansList();
    }

    renderAccountsSummary() {
        const cont = document.getElementById('savings-accounts-summary');
        if (!cont) return;
        const resumen = this.summaryByAccount();

        if (resumen.length === 0) {
            cont.innerHTML = `
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <div class="flex items-start">
                        <i class="fas fa-circle-info text-yellow-600 mr-3 mt-1"></i>
                        <div class="text-sm text-yellow-800">
                            <p class="font-medium">No tienes cuentas de tipo Activo</p>
                            <p>Un plan de ahorro se vincula a una cuenta de activo (tu cuenta de ahorro).
                               Crea una primero en la sección Cuentas.</p>
                        </div>
                    </div>
                </div>`;
            return;
        }

        // Solo se listan las cuentas que participan en algún plan, para no
        // repetir la sección Cuentas entera.
        const conPlanes = resumen.filter(r => r.planes.length > 0);
        if (conPlanes.length === 0) { cont.innerHTML = ''; return; }

        cont.innerHTML = conPlanes.map(r => `
            <div class="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h4 class="font-semibold text-gray-900">
                            <i class="fas fa-piggy-bank mr-2" style="color: var(--brand-primary);"></i>
                            ${esc(r.cuenta.nombre)}
                        </h4>
                        <p class="text-xs text-gray-500 mt-1">
                            ${r.planes.length} ${r.planes.length === 1 ? 'plan' : 'planes'} ·
                            saldo real ${this.formatCurrency(r.saldo)}
                        </p>
                    </div>
                    <button onclick="savingsPlans.openCushionModal('${esc(r.cuenta.id)}')"
                            class="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 w-full sm:w-auto">
                        <i class="fas fa-shield-halved mr-1"></i>Colchón: ${this.formatCurrency(r.colchon)}
                    </button>
                </div>
                <div class="grid grid-cols-3 gap-3 mt-4 text-center">
                    <div class="bg-gray-50 rounded-lg py-2">
                        <p class="text-xs text-gray-500">Asignado a planes</p>
                        <p class="font-semibold text-gray-900">${this.formatCurrency(r.asignado)}</p>
                    </div>
                    <div class="bg-gray-50 rounded-lg py-2">
                        <p class="text-xs text-gray-500">Colchón mínimo</p>
                        <p class="font-semibold text-gray-900">${this.formatCurrency(r.colchon)}</p>
                    </div>
                    <div class="${r.descuadre > 0 ? 'bg-red-50' : 'bg-green-50'} rounded-lg py-2">
                        <p class="text-xs ${r.descuadre > 0 ? 'text-red-600' : 'text-green-700'}">Ahorro libre</p>
                        <p class="font-semibold ${r.descuadre > 0 ? 'text-red-700' : 'text-green-800'}">
                            ${this.formatCurrency(r.libre)}
                        </p>
                    </div>
                </div>
                ${r.descuadre > 0 ? `
                <div class="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                    <i class="fas fa-triangle-exclamation mr-2"></i>
                    Hay ${this.formatCurrency(r.descuadre)} asignados por encima de lo que esta cuenta
                    puede respaldar. Reduce lo asignado a algún plan o baja el colchón mínimo.
                </div>` : ''}
            </div>
        `).join('');
    }

    renderPlansList() {
        const cont = document.getElementById('savings-plans-list');
        if (!cont) return;

        if (this.plans.length === 0) {
            const sinCuentas = this.savingsAccounts().length === 0;
            cont.innerHTML = `
                <div class="text-center py-12">
                    <i class="fas fa-piggy-bank text-6xl text-gray-300 mb-4"></i>
                    <h3 class="text-lg font-medium text-gray-900 mb-2">Aún no tienes planes de ahorro</h3>
                    <p class="text-gray-500 mb-4">
                        Un plan es un "sobre" dentro de una cuenta de ahorro: reserva parte del saldo
                        para un objetivo concreto sin separar el dinero de la cuenta.
                    </p>
                    ${sinCuentas ? '' : `
                    <button onclick="savingsPlans.openPlanModal()"
                            class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                        <i class="fas fa-plus mr-2"></i>Crear primer plan
                    </button>`}
                </div>`;
            return;
        }

        const cuentas = {};
        for (const a of this.savingsAccounts()) cuentas[a.id] = a.nombre;

        cont.innerHTML = this.plans.map(p => {
            const asignado = Number(p.asignado) || 0;
            const objetivo = Number(p.objetivo_total) || 0;
            const pct = objetivo > 0 ? Math.min(100, Math.round((asignado / objetivo) * 1000) / 10) : 0;
            const badge = ESTADO_BADGE[p.estado] || ESTADO_BADGE.activo;
            const cuentaNombre = p.cuenta_nombre || cuentas[p.cuenta_ahorro_id] || '(cuenta eliminada)';
            const detalle = p.modo === 'cuota_fija'
                ? `Cuota de ${this.formatCurrency(p.aportacion)} al mes`
                : `Fecha límite: ${esc(p.fecha_limite || '—')}`;
            // Proyección: SIMULACIÓN. Nunca toca el saldo real ni la contabilidad.
            const proyLinea = this.lineaProyeccion(p, asignado);
            const conProyeccion = p.estado === 'activo' || p.estado === 'pausado';
            return `
            <div class="bg-white rounded-lg p-5 shadow-sm border border-gray-200">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="font-semibold text-gray-900 truncate">${esc(p.nombre)}</h4>
                            <span class="px-2 py-0.5 text-xs rounded-full ${badge.clase}">${badge.texto}</span>
                        </div>
                        <p class="text-xs text-gray-500 mt-1">
                            <i class="fas fa-building-columns mr-1"></i>${esc(cuentaNombre)}
                            ${p.producto_tipo ? ` · ${esc(PRODUCTOS[p.producto_tipo] || p.producto_tipo)}` : ''}
                            ${Number(p.interes_anual) > 0 ? ` · ${esc(p.interes_anual)}% anual` : ''}
                        </p>
                        ${p.descripcion ? `<p class="text-sm text-gray-600 mt-2">${esc(p.descripcion)}</p>` : ''}
                    </div>
                    <div class="flex gap-2 shrink-0">
                        ${conProyeccion ? `
                        <button onclick="savingsPlans.openProjectionModal('${esc(p.id)}')"
                                class="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
                            <i class="fas fa-chart-line mr-1"></i>Proyección
                        </button>` : ''}
                        <button onclick="savingsPlans.openPlanModal('${esc(p.id)}')"
                                class="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
                            <i class="fas fa-pen mr-1"></i>Editar
                        </button>
                        <button onclick="savingsPlans.openDeleteModal('${esc(p.id)}')"
                                class="text-sm px-3 py-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50">
                            <i class="fas fa-xmark mr-1"></i>Cerrar
                        </button>
                    </div>
                </div>
                <div class="mt-4">
                    <div class="flex justify-between text-sm mb-1">
                        <span class="text-gray-600">${detalle}</span>
                        <span class="font-medium text-gray-900">
                            ${this.formatCurrency(asignado)} de ${this.formatCurrency(objetivo)}
                        </span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2.5">
                        <div class="h-2.5 rounded-full" style="width:${pct}%;background-color:var(--brand-primary);"></div>
                    </div>
                    <p class="text-xs text-gray-500 mt-1">${pct}% del objetivo asignado</p>
                    ${proyLinea}
                </div>
            </div>`;
        }).join('');
    }

    // ---------- Proyección (SIMULACIÓN) ----------
    // Recordatorio permanente: nada de lo que se pinta aquí toca el saldo real
    // de la cuenta ni genera movimientos. Si el banco paga intereses de verdad,
    // el usuario los registra como un ingreso y eso ya va por la contabilidad.

    // Línea resumen dentro de la tarjeta del plan.
    lineaProyeccion(plan, asignado) {
        if (plan.estado === 'cancelado') return '';
        if (plan.estado === 'completado') {
            return `<p class="text-xs text-green-700 mt-2">
                <i class="fas fa-circle-check mr-1"></i>Plan completado</p>`;
        }
        const pr = proyectarPlan(plan, asignado);
        if (pr.cumplido) {
            return `<p class="text-xs text-green-700 mt-2">
                <i class="fas fa-circle-check mr-1"></i>Objetivo alcanzado: ya tienes asignado lo necesario</p>`;
        }
        if (!pr.alcanzable) {
            return `<p class="text-xs text-amber-700 mt-2">
                <i class="fas fa-triangle-exclamation mr-1"></i>${esc(pr.motivo)}</p>`;
        }
        const interes = pr.interesProyectado > 0
            ? ` · intereses estimados ${this.formatCurrency(pr.interesProyectado)}` : '';
        const texto = plan.modo === 'objetivo_fecha'
            ? `Necesitas aportar <strong>${this.formatCurrency(pr.cuota)}</strong> al mes hasta ${esc(mesAnio(plan.fecha_limite))}`
            : `A este ritmo lo alcanzas en <strong>${esc(mesAnio(pr.fechaEstimada))}</strong> (${pr.meses} ${pr.meses === 1 ? 'mes' : 'meses'})`;
        return `<p class="text-xs text-gray-600 mt-2">
            <i class="fas fa-chart-line mr-1" style="color: var(--brand-primary);"></i>${texto}${esc(interes)}</p>`;
    }

    openProjectionModal(planId) {
        const plan = this.plans.find(x => x.id === planId);
        if (!plan) return;
        const asignado = Number(plan.asignado) || 0;
        const pr = proyectarPlan(plan, asignado);
        this.proyeccionActual = pr;

        document.getElementById('savings-projection-nombre').textContent = plan.nombre;
        const resumen = document.getElementById('savings-projection-resumen');
        const aviso = document.getElementById('savings-projection-aviso');
        const cuerpo = document.getElementById('savings-projection-cuerpo');

        if (!pr.alcanzable) {
            aviso.textContent = pr.motivo;
            aviso.classList.remove('hidden');
            cuerpo.classList.add('hidden');
            document.getElementById('savings-projection-modal').classList.remove('hidden');
            return;
        }
        aviso.classList.add('hidden');
        cuerpo.classList.remove('hidden');

        const p = PALETA[esModoOscuro() ? 'oscuro' : 'claro'];
        // Leyenda y etiquetas directas en una sola fila: la identidad de cada
        // serie no depende solo del color, y las cifras van en tinta de texto.
        resumen.innerHTML = `
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><p class="text-xs text-gray-500">Ya asignado</p>
                     <p class="font-semibold text-gray-900">${this.formatCurrency(pr.asignado)}</p></div>
                <div><p class="text-xs text-gray-500">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${p.aportado}"></span>
                        Habrás aportado</p>
                     <p class="font-semibold text-gray-900">${this.formatCurrency(pr.totalAportado)}</p></div>
                <div><p class="text-xs text-gray-500">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${p.total}"></span>
                        Saldo simulado</p>
                     <p class="font-semibold text-gray-900">${this.formatCurrency(pr.totalAportado + pr.interesProyectado)}</p></div>
                <div><p class="text-xs text-gray-500">Intereses simulados</p>
                     <p class="font-semibold text-gray-900">${this.formatCurrency(pr.interesProyectado)}</p></div>
            </div>
            <p class="text-sm text-gray-600 mt-3">
                ${plan.modo === 'objetivo_fecha'
                    ? `Cuota necesaria: <strong>${this.formatCurrency(pr.cuota)}</strong> al mes durante ${pr.meses} ${pr.meses === 1 ? 'mes' : 'meses'}.`
                    : `Con ${this.formatCurrency(pr.cuota)} al mes alcanzas ${this.formatCurrency(pr.objetivo)} en <strong>${esc(mesAnio(pr.fechaEstimada))}</strong> (${pr.meses} ${pr.meses === 1 ? 'mes' : 'meses'}).`}
            </p>`;

        this.renderTablaProyeccion(pr);
        document.getElementById('savings-projection-modal').classList.remove('hidden');
        // El canvas debe estar visible antes de medir, si no Chart.js lo pinta a 0px.
        setTimeout(() => this.renderGrafica(pr), 30);
    }

    closeProjectionModal() {
        document.getElementById('savings-projection-modal').classList.add('hidden');
        if (this.chart) { this.chart.destroy(); this.chart = null; }
    }

    // Vista en tabla (accesibilidad y para quien quiera las cifras exactas):
    // un corte por año, más el mes final.
    renderTablaProyeccion(pr) {
        const cuerpo = document.getElementById('savings-projection-tabla');
        if (!cuerpo) return;
        const filas = pr.serie.filter((x, idx) => x.mes % 12 === 0 || idx === pr.serie.length - 1);
        cuerpo.innerHTML = filas.map(x => `
            <tr>
                <td class="py-1 pr-4">${x.mes === 0 ? 'Hoy' : `Mes ${x.mes}`}</td>
                <td class="py-1 pr-4 text-right">${this.formatCurrency(x.aportado)}</td>
                <td class="py-1 pr-4 text-right">${this.formatCurrency(x.interes)}</td>
                <td class="py-1 text-right font-medium">${this.formatCurrency(x.saldo)}</td>
            </tr>`).join('');
    }

    renderGrafica(pr) {
        const canvas = document.getElementById('savings-projection-chart');
        const fallback = document.getElementById('savings-projection-sin-grafica');
        if (!canvas) return;
        if (typeof window.Chart === 'undefined') {
            // Chart.js viene de un CDN: si no cargó, la tabla ya lleva los datos.
            canvas.classList.add('hidden');
            fallback?.classList.remove('hidden');
            return;
        }
        canvas.classList.remove('hidden');
        fallback?.classList.add('hidden');
        if (this.chart) { this.chart.destroy(); this.chart = null; }

        const p = PALETA[esModoOscuro() ? 'oscuro' : 'claro'];
        // Planes largos: se muestrea a ~60 puntos para que las etiquetas no se
        // pisen. Las cifras exactas siguen en la tabla.
        const paso = Math.max(1, Math.ceil(pr.serie.length / 60));
        const puntos = pr.serie.filter((x, i) => i % paso === 0 || i === pr.serie.length - 1);
        const conInteres = pr.interesProyectado > 0;

        const datasets = [{
            label: 'Aportado',
            data: puntos.map(x => x.aportado),
            borderColor: p.aportado, backgroundColor: p.aportado,
            borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12, tension: 0.15
        }];
        if (conInteres) {
            datasets.unshift({
                label: 'Con intereses (simulado)',
                data: puntos.map(x => x.saldo),
                borderColor: p.total, backgroundColor: p.total,
                borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12, tension: 0.15
            });
        }
        datasets.push({
            label: 'Objetivo',
            data: puntos.map(() => pr.objetivo),
            borderColor: p.refer, borderWidth: 1, borderDash: [5, 4],
            pointRadius: 0, pointHitRadius: 0, fill: false
        });

        const fmt = (v) => this.formatCurrency(v);
        this.chart = new window.Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels: puntos.map(x => x.mes === 0 ? 'Hoy' : `Mes ${x.mes}`), datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                // Una sola escala: todo son euros. Nunca un segundo eje.
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: datasets.length > 1, position: 'bottom',
                        labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true,
                                  pointStyle: 'circle', color: p.tinta }
                    },
                    tooltip: {
                        callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` }
                    }
                },
                scales: {
                    x: { grid: { color: p.grid }, ticks: { color: p.tinta, maxTicksLimit: 10 } },
                    y: { grid: { color: p.grid },
                         ticks: { color: p.tinta, callback: (v) => fmt(v) },
                         beginAtZero: true }
                }
            }
        });
    }

    // ---------- Modal: crear / editar plan ----------
    openPlanModal(planId = null) {
        if (!Auth.isPremium()) { this.toast('Los Planes de Ahorro requieren Premium', 'error'); return; }
        const cuentas = this.savingsAccounts();
        if (cuentas.length === 0) {
            this.toast('Necesitas una cuenta de tipo Activo para crear un plan', 'error');
            return;
        }
        this.editingId = planId;
        const p = planId ? this.plans.find(x => x.id === planId) : null;

        const sel = document.getElementById('savings-plan-cuenta');
        sel.innerHTML = cuentas.map(c =>
            `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('');

        document.getElementById('savings-plan-modal-title').textContent = p ? 'Editar plan' : 'Nuevo plan de ahorro';
        document.getElementById('savings-plan-nombre').value = p ? p.nombre : '';
        document.getElementById('savings-plan-descripcion').value = p ? (p.descripcion || '') : '';
        document.getElementById('savings-plan-modo').value = p ? p.modo : 'cuota_fija';
        document.getElementById('savings-plan-objetivo').value = p ? p.objetivo_total : '';
        document.getElementById('savings-plan-aportacion').value = p && p.aportacion != null ? p.aportacion : '';
        document.getElementById('savings-plan-inicio').value = p ? p.fecha_inicio : new Date().toISOString().slice(0, 10);
        document.getElementById('savings-plan-limite').value = p ? (p.fecha_limite || '') : '';
        document.getElementById('savings-plan-producto').value = p ? (p.producto_tipo || '') : '';
        document.getElementById('savings-plan-interes').value = p ? (p.interes_anual || 0) : 0;
        document.getElementById('savings-plan-estado').value = p ? p.estado : 'activo';
        if (p) sel.value = p.cuenta_ahorro_id;

        // La cuenta vinculada no se puede cambiar si el plan ya tiene dinero
        // asignado: el dinero está físicamente en esa cuenta (el Worker
        // responde 409 plan_con_saldo).
        const bloquearCuenta = !!p && Math.abs(Number(p.asignado) || 0) > 0.005;
        sel.disabled = bloquearCuenta;
        document.getElementById('savings-plan-cuenta-aviso')
            .classList.toggle('hidden', !bloquearCuenta);

        this.onModoChange();
        document.getElementById('savings-plan-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('savings-plan-nombre').focus(), 100);
    }

    closePlanModal() {
        document.getElementById('savings-plan-modal').classList.add('hidden');
        this.editingId = null;
    }

    // objetivo_fecha: el usuario da meta + fecha límite -> la app calculará la cuota (Fase 2)
    // cuota_fija:     el usuario da cuota + meta       -> la app calculará los meses (Fase 2)
    onModoChange() {
        const modo = document.getElementById('savings-plan-modo').value;
        const esCuota = modo === 'cuota_fija';
        document.getElementById('savings-plan-aportacion-wrap').classList.toggle('hidden', !esCuota);
        document.getElementById('savings-plan-limite-wrap').classList.toggle('hidden', esCuota);
        document.getElementById('savings-plan-modo-ayuda').textContent = esCuota
            ? 'Tú fijas la cuota mensual y la meta; la app calculará cuándo la alcanzas.'
            : 'Tú fijas la meta y la fecha límite; la app calculará la cuota necesaria.';
    }

    async savePlan() {
        const modo = document.getElementById('savings-plan-modo').value;
        const plan = {
            cuenta_ahorro_id: document.getElementById('savings-plan-cuenta').value,
            nombre: document.getElementById('savings-plan-nombre').value.trim(),
            descripcion: document.getElementById('savings-plan-descripcion').value.trim(),
            modo,
            objetivo_total: parseFloat(document.getElementById('savings-plan-objetivo').value),
            fecha_inicio: document.getElementById('savings-plan-inicio').value,
            producto_tipo: document.getElementById('savings-plan-producto').value || null,
            interes_anual: parseFloat(document.getElementById('savings-plan-interes').value) || 0,
            estado: document.getElementById('savings-plan-estado').value
        };
        if (modo === 'cuota_fija') {
            plan.aportacion = parseFloat(document.getElementById('savings-plan-aportacion').value);
        } else {
            plan.fecha_limite = document.getElementById('savings-plan-limite').value;
        }
        if (this.editingId) {
            plan.id = this.editingId;
            const prev = this.plans.find(x => x.id === this.editingId);
            if (prev) plan.created_at = prev.created_at;
            // Si la cuenta está bloqueada por saldo, se reenvía la original.
            if (document.getElementById('savings-plan-cuenta').disabled && prev) {
                plan.cuenta_ahorro_id = prev.cuenta_ahorro_id;
            }
        }

        // Validación mínima en cliente; la de verdad está en el Worker.
        if (!plan.nombre) { this.toast('El nombre del plan es obligatorio', 'error'); return; }
        if (!(plan.objetivo_total > 0)) { this.toast('El objetivo debe ser mayor que 0', 'error'); return; }

        try {
            await DataClient.saveSavingsPlan(plan);
            this.closePlanModal();
            this.toast(this.editingId ? 'Plan actualizado' : 'Plan creado');
            await this.reload();
        } catch (e) {
            this.toast(e.message || 'No se ha podido guardar el plan', 'error');
        }
    }

    // ---------- Modal: cerrar / borrar plan ----------
    // Dos salidas distintas, por eso no basta un confirm():
    //   cancelar -> el dinero asignado vuelve al ahorro libre de la cuenta
    //   borrar   -> solo si no tiene saldo. Nunca borra movimientos.
    openDeleteModal(planId) {
        const p = this.plans.find(x => x.id === planId);
        if (!p) return;
        this.deletingId = planId;
        const asignado = Number(p.asignado) || 0;
        document.getElementById('savings-delete-nombre').textContent = p.nombre;
        document.getElementById('savings-delete-detalle').innerHTML = asignado > 0.005
            ? `Este plan tiene <strong>${this.formatCurrency(asignado)}</strong> asignados.
               Al cancelarlo, ese dinero vuelve al <strong>ahorro libre</strong> de la cuenta:
               no se mueve ni se pierde, solo deja de estar reservado.
               Las transferencias ya registradas se conservan.`
            : `Este plan no tiene dinero asignado, así que se puede borrar del todo.
               Las transferencias ya registradas se conservan en cualquier caso.`;
        document.getElementById('savings-delete-borrar-btn')
            .classList.toggle('hidden', asignado > 0.005);
        document.getElementById('savings-delete-modal').classList.remove('hidden');
    }

    closeDeleteModal() {
        document.getElementById('savings-delete-modal').classList.add('hidden');
        this.deletingId = null;
    }

    async confirmDelete(modo) {
        if (!this.deletingId) return;
        try {
            await DataClient.deleteSavingsPlan(this.deletingId, modo);
            this.closeDeleteModal();
            this.toast(modo === 'borrar' ? 'Plan borrado' : 'Plan cancelado; el dinero vuelve al ahorro libre');
            await this.reload();
        } catch (e) {
            this.toast(e.message || 'No se ha podido cerrar el plan', 'error');
        }
    }

    // ---------- Modal: colchón mínimo de la cuenta ----------
    openCushionModal(accountId) {
        const r = this.summaryByAccount().find(x => x.cuenta.id === accountId);
        if (!r) return;
        this.cushionAccountId = accountId;
        document.getElementById('savings-cushion-cuenta').textContent = r.cuenta.nombre;
        document.getElementById('savings-cushion-valor').value = r.colchon;
        document.getElementById('savings-cushion-info').textContent =
            `Saldo real ${this.formatCurrency(r.saldo)} · asignado a planes ${this.formatCurrency(r.asignado)}. ` +
            `El colchón máximo posible ahora es ${this.formatCurrency(r2(r.saldo - r.asignado))}.`;
        document.getElementById('savings-cushion-modal').classList.remove('hidden');
    }

    closeCushionModal() {
        document.getElementById('savings-cushion-modal').classList.add('hidden');
        this.cushionAccountId = null;
    }

    async saveCushion() {
        if (!this.cushionAccountId) return;
        const valor = parseFloat(document.getElementById('savings-cushion-valor').value);
        if (!(valor >= 0)) { this.toast('El colchón no puede ser negativo', 'error'); return; }
        try {
            const res = await DataClient.saveAccountCushion(this.cushionAccountId, valor);
            // El saldo lo mantiene el AccountingManager en memoria: solo refrescamos
            // el colchón de esa cuenta para no pisar nada más.
            const acc = (this.getAccounts() || []).find(a => a.id === this.cushionAccountId);
            if (acc && res) acc.colchon_minimo = Number(res.colchon_minimo) || 0;
            this.closeCushionModal();
            this.toast('Colchón mínimo actualizado');
            this.render();
        } catch (e) {
            this.toast(e.message || 'No se ha podido guardar el colchón', 'error');
        }
    }
}

export default SavingsPlans;
