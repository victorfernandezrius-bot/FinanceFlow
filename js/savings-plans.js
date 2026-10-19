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
                </div>
            </div>`;
        }).join('');
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
