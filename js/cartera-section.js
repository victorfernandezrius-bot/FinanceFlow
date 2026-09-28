// ============================================================
// Cartera de Inversión — sección del dashboard.
//
// Se monta dentro de #section-cartera (dashboard.html) igual que el resto de
// secciones: el dashboard llama a init() cada vez que se abre. Usa la sesión
// real del dashboard (token de DataClient) — nada de pegar un JWT a mano.
//
// Datos: endpoints /api/portfolio/* del Worker. Cada pestaña se carga al abrirla
// y se marca como "caducada" tras registrar/cerrar operaciones o cambiar el
// benchmark, para no pedir al Worker (y a Twelve Data) lo que no se está viendo.
//
// Regla de la sección: ninguna parte se oculta en silencio. Si no hay datos, se
// dice por qué (sin precio, sin histórico, sin snapshots, proveedor caído...).
// ============================================================

const TABS = ['posiciones', 'operaciones', 'analisis', 'evolucion'];
const BENCHMARKS = [
    ['SP500', 'S&P 500'], ['NASDAQ100', 'Nasdaq 100'], ['DOWJONES', 'Dow Jones'],
    ['IBEX35', 'IBEX 35'], ['CAC40', 'CAC 40'], ['DAX', 'DAX'], ['FTSE100', 'FTSE 100']
];
const BENCH_NAME = Object.fromEntries(BENCHMARKS);
const TIPO_ACTIVO = {
    accion: 'Acción', etf: 'ETF', fondo: 'Fondo', renta_fija: 'Renta fija',
    derivado: 'Derivado', cripto: 'Cripto', liquidez: 'Liquidez'
};
const TIPO_OP = { compra: 'Compra', venta: 'Venta', aportacion: 'Aportación', retirada: 'Retirada' };
const CLASES = [
    ['renta_variable', 'Renta variable', '--cart-rv'],
    ['renta_fija', 'Renta fija', '--cart-rf'],
    ['derivados', 'Derivados', '--cart-der'],
    ['cripto', 'Cripto', '--cart-cripto'],
    ['liquidez', 'Liquidez', '--cart-liq']
];
const CLASI = { agresiva: 'Agresiva', defensiva: 'Defensiva', igual_benchmark: 'Como el índice' };
const PERIODOS = [['1M', '1 mes'], ['3M', '3 meses'], ['6M', '6 meses'], ['1A', '1 año'], ['YTD', 'Este año'], ['MAX', 'Todo']];

// ---------- utilidades de formato (sin estado) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (n) => n != null && isFinite(n);
function money(n, cur = 'EUR') {
    if (!isNum(n)) return '—';
    try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur || 'EUR' }).format(n); }
    catch { return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n) + ' ' + (cur || 'EUR'); }
}
function pct(n, { signed = false, dec = 2 } = {}) {
    if (!isNum(n)) return '—';
    const s = new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
    return (signed && n > 0 ? '+' : '') + s + ' %';
}
function qty(n) {
    if (!isNum(n)) return '—';
    return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6 }).format(n);
}
function num(n, dec = 2) {
    if (!isNum(n)) return '—';
    return new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}
const signCls = (n) => (!isNum(n) || Math.abs(n) < 1e-9) ? '' : (n > 0 ? 'cart-pos' : 'cart-neg');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y) return esc(iso);
    return new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Caja "por qué no hay datos": una sección sin datos SIEMPRE explica el motivo.
function why(title, items = [], isErr = false) {
    const list = (items || []).filter(Boolean);
    return `<div class="cart-why${isErr ? ' cart-err' : ''}" role="${isErr ? 'alert' : 'status'}"><strong>${esc(title)}</strong>`
        + (list.length ? `<ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '') + '</div>';
}

export default class CarteraSection {
    constructor(dashboard, { DataClient } = {}) {
        this.dashboard = dashboard;
        this.DataClient = DataClient;
        this.mounted = false;
        this.state = {
            tab: 'posiciones',
            benchmark: localStorage.getItem('cartera_benchmark') || 'SP500',
            estado: 'abiertas',
            periodo: '1A',
            kpis: null,
            holdings: [],
            stale: { kpis: true, posiciones: true, operaciones: true, analisis: true, evolucion: true },
            loading: {}
        };
        this.chart = null;
        this._historyData = null;
    }

    // ============================================================
    // Ciclo de vida
    // ============================================================
    async init() {
        const root = document.getElementById('cartera-root');
        if (!root) return;
        if (window.DATA_MODE !== 'remote') {
            root.innerHTML = `<div class="cart-card">${why('La cartera de inversión necesita conexión con el servidor.', ['Esta instalación funciona en modo local; activa el modo remoto para usarla.'])}</div>`;
            return;
        }
        if (!this.mounted) this.mount(root);
        // Al entrar, datos frescos (pueden haber cambiado desde otra pestaña o dispositivo).
        Object.keys(this.state.stale).forEach(k => { this.state.stale[k] = true; });
        await Promise.all([this.loadKpis(), this.loadTab(this.state.tab)]);
    }

    mount(root) {
        root.innerHTML = this.tplSection();
        document.body.insertAdjacentHTML('beforeend', this.tplModals());
        this.mounted = true;
        this.wire();
        // Los gráficos leen sus colores de variables CSS: repintar al cambiar de tema.
        this._themeObserver = new MutationObserver(() => {
            if (this.state.tab === 'evolucion' && this._historyData && this.isVisible()) this.renderChart(this._historyData);
        });
        this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    isVisible() {
        const s = document.getElementById('section-cartera');
        return !!s && !s.classList.contains('hidden');
    }

    invalidate(keys = null) {
        (keys || Object.keys(this.state.stale)).forEach(k => { this.state.stale[k] = true; });
    }

    // Tras cualquier cambio de datos: KPIs + la pestaña visible; el resto al abrirlas.
    async refreshAll() {
        this.invalidate();
        await Promise.all([this.loadKpis(), this.loadTab(this.state.tab)]);
    }

    // ============================================================
    // Acceso a la API (sesión real del dashboard)
    // ============================================================
    token() {
        return (this.DataClient && this.DataClient.getAuthToken && this.DataClient.getAuthToken())
            || localStorage.getItem('financeflow_token') || '';
    }

    async api(path, opts = {}) {
        const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        const t = this.token();
        if (t) headers.Authorization = `Bearer ${t}`;
        let r;
        try {
            r = await fetch(`${window.API_URL}/portfolio${path}`, { ...opts, headers, credentials: 'include' });
        } catch (e) {
            return { ok: false, status: 0, data: { error: 'No hay conexión con el servidor.' } };
        }
        let data = null;
        try { data = await r.json(); } catch { data = null; }
        if (r.status === 401) data = { error: 'Tu sesión ha caducado. Vuelve a iniciar sesión.' };
        return { ok: r.ok, status: r.status, data };
    }

    apiError(res, fallback) {
        return (res && res.data && res.data.error) || fallback || `Error del servidor (${res && res.status})`;
    }

    toast(msg, type = 'success') {
        if (this.dashboard && typeof this.dashboard.showToast === 'function') this.dashboard.showToast(esc(msg), type);
    }

    // ============================================================
    // Plantillas
    // ============================================================
    tplSection() {
        const benchOpts = BENCHMARKS.map(([k, n]) => `<option value="${k}"${k === this.state.benchmark ? ' selected' : ''}>${esc(n)}</option>`).join('');
        return `
        <div class="cart-head">
            <div>
                <h2>Cartera de inversión</h2>
                <p>Tus posiciones, tu liquidez y el riesgo de la cartera, en un solo sitio.</p>
            </div>
            <div class="cart-head-actions">
                <label class="cart-muted" for="cart-bench">Comparar con</label>
                <select id="cart-bench" class="cart-select" aria-describedby="cart-bench-hint">${benchOpts}</select>
                <button type="button" class="cart-btn cart-btn-primary" data-cart-action="nueva"><i class="fas fa-plus" aria-hidden="true"></i>Nueva operación</button>
            </div>
        </div>
        <p id="cart-bench-hint" class="cart-muted cart-hidden">El índice de referencia se usa para la beta, la clasificación de cada acción y la gráfica de evolución.</p>

        <div id="cart-avisos"></div>

        <section class="cart-card" aria-labelledby="cart-resumen-title">
            <div class="cart-card-head">
                <h3 id="cart-resumen-title" class="cart-card-title">Resumen</h3>
            </div>
            <div id="cart-kpis" class="cart-kpis" aria-live="polite"></div>
            <div id="cart-classes" style="margin-top:1rem"></div>
        </section>

        <div class="cart-tabs" role="tablist" aria-label="Vistas de la cartera">
            ${this.tplTab('posiciones', 'fa-layer-group', 'Posiciones')}
            ${this.tplTab('operaciones', 'fa-list', 'Operaciones')}
            ${this.tplTab('analisis', 'fa-shield-alt', 'Riesgo')}
            ${this.tplTab('evolucion', 'fa-chart-line', 'Evolución')}
        </div>

        <div id="cart-panel-posiciones" role="tabpanel" aria-labelledby="cart-tab-posiciones">
            <div>
                <section class="cart-card" aria-labelledby="cart-pos-title">
                    <div class="cart-card-head">
                        <div>
                            <h3 id="cart-pos-title" class="cart-card-title">Posiciones</h3>
                            <p class="cart-muted cart-card-sub">El peso es sobre el total de la cartera, liquidez incluida. Bajo cada activo, el tiempo que lleva abierto.</p>
                        </div>
                        <div class="cart-seg" role="radiogroup" aria-label="Estado de las posiciones" id="cart-estado">
                            <button type="button" role="radio" aria-checked="true" data-estado="abiertas">Abiertas</button>
                            <button type="button" role="radio" aria-checked="false" data-estado="cerradas" tabindex="-1">Cerradas</button>
                            <button type="button" role="radio" aria-checked="false" data-estado="todas" tabindex="-1">Todas</button>
                        </div>
                    </div>
                    <div id="cart-pos-body" aria-live="polite"></div>
                </section>
                <section class="cart-card" aria-labelledby="cart-alloc-title">
                    <div class="cart-card-head">
                        <div>
                            <h3 id="cart-alloc-title" class="cart-card-title">Reparto de la cartera</h3>
                            <p class="cart-muted cart-card-sub">Posiciones + liquidez = 100 %.</p>
                        </div>
                    </div>
                    <div id="cart-alloc-body" aria-live="polite"></div>
                </section>
            </div>
        </div>

        <div id="cart-panel-operaciones" role="tabpanel" aria-labelledby="cart-tab-operaciones" class="cart-hidden">
            <section class="cart-card" aria-labelledby="cart-ops-title">
                <div class="cart-card-head">
                    <div>
                        <h3 id="cart-ops-title" class="cart-card-title">Diario de operaciones</h3>
                        <p class="cart-muted cart-card-sub">Peso hist. = coste de la operación sobre lo invertido en ese momento.</p>
                    </div>
                </div>
                <form class="cart-filters" id="cart-ops-filters">
                    <div class="cart-field"><label for="cart-f-desde">Desde</label><input type="date" id="cart-f-desde" class="cart-input"></div>
                    <div class="cart-field"><label for="cart-f-hasta">Hasta</label><input type="date" id="cart-f-hasta" class="cart-input"></div>
                    <div class="cart-field"><label for="cart-f-ticker">Activo</label><input id="cart-f-ticker" class="cart-input" placeholder="Todos" autocomplete="off" style="max-width:140px"></div>
                    <div class="cart-field"><label for="cart-f-tipo">Operación</label>
                        <select id="cart-f-tipo" class="cart-input"><option value="">Todas</option><option value="compra">Compra</option><option value="venta">Venta</option><option value="aportacion">Aportación</option><option value="retirada">Retirada</option></select></div>
                    <button type="submit" class="cart-btn cart-btn-ghost">Filtrar</button>
                    <button type="button" class="cart-btn cart-btn-ghost" id="cart-f-clear">Limpiar</button>
                </form>
                <div id="cart-ops-body" aria-live="polite"></div>
            </section>
        </div>

        <div id="cart-panel-analisis" role="tabpanel" aria-labelledby="cart-tab-analisis" class="cart-hidden">
            <div id="cart-classes-body" aria-live="polite"></div>
            <section class="cart-card" aria-labelledby="cart-matrix-title">
                <div class="cart-card-head">
                    <div>
                        <h3 id="cart-matrix-title" class="cart-card-title">Matriz de varianzas-covarianzas</h3>
                        <p class="cart-muted cart-card-sub">Anualizada. Cómo se mueven tus activos entre sí.</p>
                    </div>
                    <div class="cart-head-actions">
                        <button type="button" class="cart-btn cart-btn-ghost cart-btn-sm" data-cart-action="recalcular"><i class="fas fa-sync-alt" aria-hidden="true"></i>Recalcular</button>
                        <button type="button" class="cart-btn cart-btn-ghost cart-btn-sm" data-cart-action="diagnostico"><i class="fas fa-stethoscope" aria-hidden="true"></i>Diagnóstico de proveedores</button>
                    </div>
                </div>
                <div id="cart-diag-body"></div>
                <div id="cart-matrix-body" aria-live="polite"></div>
                <p class="cart-muted" style="margin-top:.75rem">La diagonal es la varianza de cada activo (cuánto oscila por sí solo). Fuera de la diagonal, una covarianza positiva significa que dos activos suben y bajan a la vez; una negativa, que se compensan. Cuantas más casillas cerca de cero o negativas, más diversificada está la cartera.</p>
            </section>
        </div>

        <div id="cart-panel-evolucion" role="tabpanel" aria-labelledby="cart-tab-evolucion" class="cart-hidden">
            <section class="cart-card" aria-labelledby="cart-evo-title">
                <div class="cart-card-head">
                    <div>
                        <h3 id="cart-evo-title" class="cart-card-title">Evolución frente al índice</h3>
                        <p class="cart-muted cart-card-sub" id="cart-evo-sub">Base 100 al inicio del periodo.</p>
                    </div>
                    <div class="cart-seg" role="radiogroup" aria-label="Periodo" id="cart-periodo">
                        ${PERIODOS.map(([k, n]) => `<button type="button" role="radio" aria-checked="${k === this.state.periodo}" data-periodo="${k}"${k === this.state.periodo ? '' : ' tabindex="-1"'}>${esc(n)}</button>`).join('')}
                    </div>
                </div>
                <div id="cart-evo-body" aria-live="polite"></div>
                <div class="cart-modal-foot" style="margin-top:.75rem">
                    <span class="cart-muted">En producción el valor diario lo guarda el cron cada mañana. Aquí puedes guardar el de hoy a mano.</span>
                    <div class="cart-head-actions">
                        <button type="button" class="cart-btn cart-btn-ghost cart-btn-sm" data-cart-action="tabla-evo" aria-expanded="false">Ver datos</button>
                        <button type="button" class="cart-btn cart-btn-ghost cart-btn-sm" data-cart-action="snapshot"><i class="fas fa-camera" aria-hidden="true"></i>Guardar valor de hoy</button>
                    </div>
                </div>
                <div id="cart-evo-table" class="cart-hidden"></div>
            </section>
        </div>`;
    }

    tplTab(id, icon, label) {
        const sel = id === this.state.tab;
        return `<button type="button" class="cart-tab" role="tab" id="cart-tab-${id}" aria-controls="cart-panel-${id}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-tab="${id}"><i class="fas ${icon}" aria-hidden="true"></i>${esc(label)}</button>`;
    }

    tplModals() {
        const tipoOpts = Object.entries(TIPO_ACTIVO).filter(([k]) => k !== 'liquidez').map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('');
        return `
        <div id="cart-op-modal" class="cart-modal" role="dialog" aria-modal="true" aria-labelledby="cart-op-title">
            <div class="cart-modal-panel">
                <div class="cart-modal-head">
                    <h3 id="cart-op-title">Nueva operación</h3>
                    <button type="button" class="cart-x" data-cart-close aria-label="Cerrar"><i class="fas fa-times"></i></button>
                </div>
                <div id="cart-first-cash" class="cart-hidden">${why('Registra primero una aportación de efectivo a tu cuenta.', ['Todas las compras se descontarán de ese saldo. Si compras sin aportación, la liquidez quedará en negativo: se permite (cuentas con margen), pero se avisa.'])}</div>
                <div class="cart-seg cart-seg-full" role="radiogroup" aria-label="Tipo de operación" id="cart-op-tipo" style="margin-bottom:1rem">
                    <button type="button" role="radio" aria-checked="true" data-op="compra">Compra</button>
                    <button type="button" role="radio" aria-checked="false" data-op="venta" tabindex="-1">Venta</button>
                    <button type="button" role="radio" aria-checked="false" data-op="aportacion" tabindex="-1">Aportación</button>
                    <button type="button" role="radio" aria-checked="false" data-op="retirada" tabindex="-1">Retirada</button>
                </div>
                <form id="cart-op-form" novalidate autocomplete="off">
                    <div class="cart-form-grid">
                        <div class="cart-field cart-std"><label for="cart-op-ticker">Ticker</label><input id="cart-op-ticker" class="cart-input" placeholder="AAPL, SAN, BTC/USD…" autocapitalize="characters"></div>
                        <div class="cart-field cart-std"><label for="cart-op-activo">Tipo de activo</label><select id="cart-op-activo" class="cart-input">${tipoOpts}</select></div>
                        <div class="cart-field cart-std"><label for="cart-op-cantidad">Cantidad</label><input id="cart-op-cantidad" class="cart-input" type="number" step="any" min="0" inputmode="decimal" placeholder="10"></div>
                        <div class="cart-field cart-std"><label for="cart-op-precio" id="cart-op-precio-label">Precio de compra</label><input id="cart-op-precio" class="cart-input" type="number" step="any" min="0" inputmode="decimal" placeholder="150,50"></div>
                        <div class="cart-field cart-std"><label for="cart-op-comision">Comisión</label><input id="cart-op-comision" class="cart-input" type="number" step="any" min="0" inputmode="decimal" placeholder="0"></div>
                        <div class="cart-field cart-cash cart-hidden"><label for="cart-op-importe">Importe</label><input id="cart-op-importe" class="cart-input" type="number" step="any" min="0" inputmode="decimal" placeholder="5.000"></div>
                        <div class="cart-field cart-cash cart-hidden"><label for="cart-op-moneda">Moneda</label><select id="cart-op-moneda" class="cart-input"><option>EUR</option><option>USD</option><option>GBP</option><option>CHF</option></select></div>
                        <div class="cart-field"><label for="cart-op-fecha">Fecha</label><input id="cart-op-fecha" class="cart-input" type="date"></div>
                        <div class="cart-field cart-std cart-span-2"><label for="cart-op-nombre">Nombre (opcional)</label><input id="cart-op-nombre" class="cart-input" placeholder="Apple Inc."></div>
                        <div class="cart-field cart-span-2"><label for="cart-op-broker">Broker (opcional)</label><input id="cart-op-broker" class="cart-input" placeholder="Interactive Brokers, MyInvestor…"></div>

                        <div class="cart-fieldset cart-hidden" id="cart-grp-rv">
                            <div class="cart-field cart-span-2"><label for="cart-op-sector">Sector</label><input id="cart-op-sector" class="cart-input" placeholder="Tecnología"><span class="cart-hint" id="cart-sector-hint"></span></div>
                        </div>
                        <div class="cart-fieldset cart-hidden" id="cart-grp-rf">
                            <div class="cart-field"><label for="cart-rf-tipo">Tipo de interés %</label><input id="cart-rf-tipo" class="cart-input" type="number" step="any" placeholder="3,5"></div>
                            <div class="cart-field"><label for="cart-rf-cupon">Cupón %</label><input id="cart-rf-cupon" class="cart-input" type="number" step="any" placeholder="4"></div>
                            <div class="cart-field"><label for="cart-rf-frec">Frecuencia del cupón</label><select id="cart-rf-frec" class="cart-input"><option value="anual">Anual</option><option value="semestral">Semestral</option><option value="trimestral">Trimestral</option></select></div>
                            <div class="cart-field"><label for="cart-rf-venc">Vencimiento</label><input id="cart-rf-venc" class="cart-input" type="date"></div>
                            <div class="cart-field"><label for="cart-rf-nom">Nominal</label><input id="cart-rf-nom" class="cart-input" type="number" step="any" placeholder="1.000"></div>
                        </div>
                        <div class="cart-fieldset cart-hidden" id="cart-grp-der">
                            <div class="cart-field"><label for="cart-der-tipo">Tipo</label><select id="cart-der-tipo" class="cart-input"><option value="futuro">Futuro</option><option value="opcion">Opción</option></select></div>
                            <div class="cart-field"><label for="cart-der-venc">Vencimiento</label><input id="cart-der-venc" class="cart-input" type="date"></div>
                            <div class="cart-field cart-der-fut"><label for="cart-der-sub">Activo que cubre</label><input id="cart-der-sub" class="cart-input" placeholder="SP500"></div>
                            <div class="cart-field cart-der-opt cart-hidden"><label for="cart-der-opt">Call / Put</label><select id="cart-der-opt" class="cart-input"><option value="call">Call</option><option value="put">Put</option></select></div>
                            <div class="cart-field cart-der-opt cart-hidden"><label for="cart-der-prima">Prima pagada</label><input id="cart-der-prima" class="cart-input" type="number" step="any" placeholder="50"></div>
                        </div>
                    </div>
                    <div id="cart-op-aviso"></div>
                    <div class="cart-modal-foot">
                        <span class="cart-cash-line" id="cart-op-cash"></span>
                        <div class="cart-head-actions">
                            <button type="button" class="cart-btn cart-btn-ghost" data-cart-close>Cancelar</button>
                            <button type="submit" class="cart-btn cart-btn-primary" id="cart-op-submit">Registrar compra</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>

        <div id="cart-close-modal" class="cart-modal" role="dialog" aria-modal="true" aria-labelledby="cart-close-title">
            <div class="cart-modal-panel" style="max-width:440px">
                <div class="cart-modal-head">
                    <div><h3 id="cart-close-title">Cerrar posición</h3><p class="cart-muted" id="cart-close-sub" style="margin:.25rem 0 0"></p></div>
                    <button type="button" class="cart-x" data-cart-close aria-label="Cerrar"><i class="fas fa-times"></i></button>
                </div>
                <form id="cart-close-form" novalidate>
                    <div class="cart-form-grid">
                        <div class="cart-field"><label for="cart-close-precio">Precio de venta</label><input id="cart-close-precio" class="cart-input" type="number" step="any" min="0" inputmode="decimal"></div>
                        <div class="cart-field"><label for="cart-close-com">Comisión</label><input id="cart-close-com" class="cart-input" type="number" step="any" min="0" inputmode="decimal" placeholder="0"></div>
                        <div class="cart-field cart-span-2"><label for="cart-close-fecha">Fecha</label><input id="cart-close-fecha" class="cart-input" type="date"></div>
                    </div>
                    <div id="cart-close-preview" style="margin-top:.75rem"></div>
                    <div class="cart-modal-foot">
                        <span></span>
                        <div class="cart-head-actions">
                            <button type="button" class="cart-btn cart-btn-ghost" data-cart-close>Cancelar</button>
                            <button type="submit" class="cart-btn cart-btn-primary">Vender todo</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>`;
    }

    // ============================================================
    // Eventos
    // ============================================================
    wire() {
        const sec = document.getElementById('section-cartera');

        sec.addEventListener('click', (e) => {
            const a = e.target.closest('[data-cart-action]');
            if (a) {
                const act = a.dataset.cartAction;
                if (act === 'nueva') this.openOpModal();
                else if (act === 'aportar') this.openOpModal('aportacion');
                else if (act === 'comprar') this.openOpModal('compra');
                else if (act === 'recalcular') this.loadAnalisis(true);
                else if (act === 'diagnostico') this.runDiagnostics();
                else if (act === 'snapshot') this.saveSnapshot(a);
                else if (act === 'tabla-evo') this.toggleEvoTable(a);
                else if (act === 'cerrar') this.openCloseModal(a.dataset.ticker);
                else if (act === 'guardar-liq') this.saveCashConfig(a);
                return;
            }
        });

        // Pestañas (patrón ARIA tabs: flechas mueven, Inicio/Fin a extremos).
        const tablist = sec.querySelector('[role="tablist"]');
        tablist.addEventListener('click', (e) => {
            const t = e.target.closest('[role="tab"]');
            if (t) this.selectTab(t.dataset.tab);
        });
        tablist.addEventListener('keydown', (e) => {
            const i = TABS.indexOf(this.state.tab);
            let n = null;
            if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
            else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
            else if (e.key === 'Home') n = 0;
            else if (e.key === 'End') n = TABS.length - 1;
            if (n == null) return;
            e.preventDefault();
            this.selectTab(TABS[n]);
            document.getElementById(`cart-tab-${TABS[n]}`).focus();
        });

        this.wireRadioGroup(document.getElementById('cart-estado'), 'estado', (v) => { this.state.estado = v; this.renderPositions(); });
        this.wireRadioGroup(document.getElementById('cart-periodo'), 'periodo', (v) => { this.state.periodo = v; this.state.stale.evolucion = true; this.loadEvolucion(); });

        document.getElementById('cart-bench').addEventListener('change', (e) => {
            this.state.benchmark = e.target.value;
            try { localStorage.setItem('cartera_benchmark', this.state.benchmark); } catch { /* ignore */ }
            this.invalidate(['kpis', 'analisis', 'evolucion']);
            this.loadKpis();
            if (this.state.tab === 'analisis' || this.state.tab === 'evolucion') this.loadTab(this.state.tab);
        });

        document.getElementById('cart-ops-filters').addEventListener('submit', (e) => { e.preventDefault(); this.state.stale.operaciones = true; this.loadOperaciones(); });
        document.getElementById('cart-f-clear').addEventListener('click', () => {
            ['cart-f-desde', 'cart-f-hasta', 'cart-f-ticker', 'cart-f-tipo'].forEach(id => { document.getElementById(id).value = ''; });
            this.state.stale.operaciones = true; this.loadOperaciones();
        });

        // ---- Modales ----
        ['cart-op-modal', 'cart-close-modal'].forEach(id => {
            const m = document.getElementById(id);
            m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-cart-close]')) this.closeModal(id); });
            m.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeModal(id); else if (e.key === 'Tab') this.trapFocus(m, e); });
        });
        this.wireRadioGroup(document.getElementById('cart-op-tipo'), 'op', (v) => this.setOpType(v));
        const f = (id) => document.getElementById(id);
        f('cart-op-activo').addEventListener('change', () => this.toggleOpFields());
        f('cart-der-tipo').addEventListener('change', () => this.toggleOpFields());
        ['cart-op-ticker', 'cart-op-cantidad', 'cart-op-precio', 'cart-op-comision', 'cart-op-importe'].forEach(id => f(id).addEventListener('input', () => this.updateOpPreview()));
        f('cart-op-ticker').addEventListener('blur', () => this.suggestSector());
        f('cart-op-form').addEventListener('submit', (e) => { e.preventDefault(); this.submitOp(); });
        ['cart-close-precio', 'cart-close-com'].forEach(id => f(id).addEventListener('input', () => this.updateClosePreview()));
        f('cart-close-form').addEventListener('submit', (e) => { e.preventDefault(); this.submitClose(); });
    }

    // Grupo de radio accesible (segmentados). data-<attr> en cada botón.
    wireRadioGroup(group, attr, onChange) {
        if (!group) return;
        const btns = () => [...group.querySelectorAll('[role="radio"]')];
        const select = (btn, fire = true) => {
            btns().forEach(b => { const s = b === btn; b.setAttribute('aria-checked', s ? 'true' : 'false'); b.tabIndex = s ? 0 : -1; });
            if (fire) onChange(btn.dataset[attr]);
        };
        group.addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) select(b); });
        group.addEventListener('keydown', (e) => {
            const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (!d) return;
            e.preventDefault();
            const list = btns();
            const i = list.findIndex(b => b.getAttribute('aria-checked') === 'true');
            const next = list[(i + d + list.length) % list.length];
            select(next); next.focus();
        });
        group._select = (value, fire = false) => { const b = btns().find(x => x.dataset[attr] === value); if (b) select(b, fire); };
    }

    selectTab(tab) {
        if (!TABS.includes(tab)) return;
        this.state.tab = tab;
        TABS.forEach(t => {
            const on = t === tab;
            const b = document.getElementById(`cart-tab-${t}`);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
            document.getElementById(`cart-panel-${t}`).classList.toggle('cart-hidden', !on);
        });
        this.loadTab(tab);
    }

    loadTab(tab) {
        if (tab === 'posiciones') return this.loadPosiciones();
        if (tab === 'operaciones') return this.loadOperaciones();
        if (tab === 'analisis') return this.loadAnalisis();
        if (tab === 'evolucion') return this.loadEvolucion();
    }

    loadingHTML(txt = 'Cargando…') {
        return `<div class="cart-empty"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i>${esc(txt)}</div>`;
    }

    // ============================================================
    // Resumen (KPIs + barra de clases)
    // ============================================================
    async loadKpis() {
        if (!this.state.stale.kpis) return;
        const box = document.getElementById('cart-kpis');
        if (!this.state.kpis) box.innerHTML = this.loadingHTML('Calculando tu cartera…');
        const res = await this.api(`/kpis?benchmark=${encodeURIComponent(this.state.benchmark)}`);
        if (!res.ok) {
            box.innerHTML = '';
            document.getElementById('cart-classes').innerHTML = why('No se pudo calcular el resumen.', [this.apiError(res)], true);
            return;
        }
        this.state.stale.kpis = false;
        this.state.kpis = res.data;
        this.renderKpis(res.data);
        if ((this.state.holdings || []).length) this.renderPositions();
    }

    renderKpis(k) {
        const card = (label, value, sub = '', extra = '') =>
            `<div class="cart-kpi ${extra}"><span class="cart-kpi-label">${esc(label)}</span><span class="cart-kpi-value">${value}</span>${sub ? `<span class="cart-kpi-sub">${sub}</span>` : ''}</div>`;
        const coste = k.coste_total_invertido;
        const nrPct = isNum(coste) && coste > 0 ? (k.pnl_no_realizado / coste) * 100 : null;
        const betaSub = k.beta_cartera == null ? 'Sin datos suficientes del índice' : `Frente al ${esc(BENCH_NAME[this.state.benchmark] || this.state.benchmark)}`;
        const html = [
            card('Valor total de la cartera', money(k.valor_mercado_total),
                `Posiciones ${money(k.valor_posiciones)} · Liquidez ${money(k.saldo_liquidez)}`, 'cart-kpi-hero'),
            card('Invertido (a coste)', money(coste), `Comisiones pagadas ${money(k.comisiones_totales)}`),
            card('Resultado no realizado', `<span class="${signCls(k.pnl_no_realizado)}">${money(k.pnl_no_realizado)}</span>`, nrPct != null ? pct(nrPct, { signed: true }) + ' sobre lo invertido' : ''),
            card('Resultado realizado', `<span class="${signCls(k.pnl_realizado)}">${money(k.pnl_realizado)}</span>`, 'De las ventas ya hechas'),
            card('Rentabilidad total', `<span class="${signCls(k.rentabilidad_total_pct)}">${pct(k.rentabilidad_total_pct, { signed: true })}</span>`, 'Realizado + no realizado sobre el coste'),
            card('Liquidez', `<span class="${k.liquidez_negativa ? 'cart-neg' : ''}">${money(k.saldo_liquidez)}</span>`,
                k.liquidez_negativa ? 'Saldo negativo' : `${pct(k.pct_liquidez, { dec: 1 })} de la cartera`),
            card('Beta de la cartera', num(k.beta_cartera), betaSub),
            card('Volatilidad anual', isNum(k.volatilidad_anualizada_pct) && k.volatilidad_anualizada_pct > 0 ? pct(k.volatilidad_anualizada_pct, { dec: 1 }) : '—',
                isNum(k.volatilidad_anualizada_pct) && k.volatilidad_anualizada_pct > 0 ? 'Oscilación típica en un año' : 'Necesita 60 sesiones de histórico')
        ].join('');
        document.getElementById('cart-kpis').innerHTML = html;

        // Avisos de cabecera (liquidez negativa / pesos no representativos).
        const avisos = document.getElementById('cart-avisos');
        let a = '';
        if (!k.tiene_aportaciones) {
            a += `<div class="cart-why" role="status"><strong>Empieza registrando una aportación de efectivo.</strong>`
                + `La liquidez es el eje de la cartera: cada compra se descuenta de ella y cada venta la repone. `
                + `<div style="margin-top:.6rem"><button type="button" class="cart-btn cart-btn-primary cart-btn-sm" data-cart-action="aportar">Registrar aportación</button></div></div>`;
        }
        if (k.avisos && k.avisos.length) a += why(k.pesos_fiables ? 'Aviso sobre tu liquidez' : 'Los porcentajes de peso aún no son representativos', k.avisos, !k.pesos_fiables);
        avisos.innerHTML = a;

        // Barra 100 % apilada por clase de activo, con el % siempre escrito en la leyenda.
        const pc = k.peso_por_clase || {};
        const cls = document.getElementById('cart-classes');
        const total = CLASES.reduce((s, [key]) => s + Math.max(0, pc[key] || 0), 0);
        if (!k.pesos_fiables || total <= 0) {
            cls.innerHTML = (k.valor_mercado_total || 0) <= 0 && !k.valor_posiciones
                ? '<p class="cart-muted">El peso por clase de activo aparecerá cuando tengas posiciones o liquidez.</p>'
                : '';
            return;
        }
        const segs = CLASES.filter(([key]) => (pc[key] || 0) > 0.05);
        cls.innerHTML = `<div class="cart-kpi-label">Peso por clase de activo</div>`
            + `<div class="cart-classbar" role="img" aria-label="${esc(segs.map(([key, n]) => `${n} ${pct(pc[key], { dec: 1 })}`).join(', '))}">`
            + segs.map(([key, n, v]) => `<span style="width:${(Math.max(0, pc[key]) / total) * 100}%;background:var(${v})" title="${esc(n)}: ${pct(pc[key], { dec: 1 })}"></span>`).join('')
            + `</div><div class="cart-legend">`
            + segs.map(([key, n, v]) => `<span><i class="cart-sw" style="background:var(${v})"></i>${esc(n)} <b>${pct(pc[key], { dec: 1 })}</b></span>`).join('')
            + `</div>`;
    }

    // ============================================================
    // Pestaña Posiciones
    // ============================================================
    async loadPosiciones() {
        if (!this.state.stale.posiciones) return;
        const body = document.getElementById('cart-pos-body');
        const alloc = document.getElementById('cart-alloc-body');
        body.innerHTML = this.loadingHTML();
        alloc.innerHTML = this.loadingHTML();
        const [h, a] = await Promise.all([this.api('/holdings?estado=todas'), this.api('/allocation')]);
        if (h.ok) {
            this.state.holdings = Array.isArray(h.data) ? h.data : [];
            this.renderPositions();
        } else {
            body.innerHTML = why('No se pudieron cargar las posiciones.', [this.apiError(h)], true);
        }
        if (a.ok) this.renderAllocation(a.data);
        else alloc.innerHTML = why('No se pudo calcular el reparto.', [this.apiError(a)], true);
        if (h.ok && a.ok) this.state.stale.posiciones = false;
    }

    renderPositions() {
        const body = document.getElementById('cart-pos-body');
        const all = this.state.holdings || [];
        if (!all.length) {
            body.innerHTML = `<div class="cart-empty"><i class="fas fa-seedling" aria-hidden="true"></i>
                <p style="margin:.25rem 0 1rem">Aún no has registrado operaciones.</p>
                <div class="cart-head-actions" style="justify-content:center">
                    <button type="button" class="cart-btn cart-btn-primary cart-btn-sm" data-cart-action="aportar">Registrar aportación</button>
                    <button type="button" class="cart-btn cart-btn-ghost cart-btn-sm" data-cart-action="comprar">Añadir compra</button>
                </div></div>`;
            return;
        }
        const e = this.state.estado;
        const rows = all.filter(p => e === 'todas' ? true : e === 'cerradas' ? p.cantidad_abierta <= 1e-9 : p.cantidad_abierta > 1e-9)
            .sort((x, y) => (y.valor || 0) - (x.valor || 0));
        if (!rows.length) {
            body.innerHTML = `<div class="cart-empty">${e === 'cerradas' ? 'Todavía no has cerrado ninguna posición.' : 'No tienes posiciones abiertas.'}</div>`;
            return;
        }
        // Si la cartera vale ~0 o menos (compras sin aportación registrada), el peso
        // sobre la cartera no significa nada: no se pinta un "2628 %".
        const pesosOk = !(this.state.kpis && this.state.kpis.pesos_fiables === false);
        let tInv = 0, tVal = 0, tPeso = 0, tRes = 0, tResOk = false;
        const tr = rows.map(p => {
            const open = p.cantidad_abierta > 1e-9;
            const cur = p.moneda || 'EUR';
            const coste = p.precio_medio * p.cantidad_abierta;
            const sinPrecio = open && p.precio_actual == null;
            const res = open && !sinPrecio && isNum(p.valor) ? p.valor - coste : null;
            const resPct = res != null && coste > 0 ? (res / coste) * 100 : null;
            if (open) {
                tInv += p.total_invertido || 0;
                if (isNum(p.valor)) tVal += p.valor;
                tPeso += p.peso_sobre_cartera || 0;
                if (res != null) { tRes += res; tResOk = true; }
            }
            const badge = !open ? '' : sinPrecio ? '<span class="cart-subline"><span class="cart-badge" title="Sin cotización: se valora a coste">a coste</span></span>'
                : p.stale ? '<span class="cart-subline"><span class="cart-badge" title="Último precio conocido: el proveedor no respondió">no actualizado</span></span>' : '';
            return `<tr>
                <td class="l cart-full"><span class="cart-ticker">${esc(p.ticker)}</span><span class="cart-subname">${esc(TIPO_ACTIVO[p.tipo_activo] || p.tipo_activo)}${p.tiempo_abierto ? ` · ${esc(p.tiempo_abierto)}` : ''}</span></td>
                <td data-label="Cantidad">${open ? qty(p.cantidad_abierta) : '<span class="cart-tag">Cerrada</span>'}</td>
                <td data-label="Precio medio">${money(p.precio_medio, cur)}</td>
                <td data-label="Precio actual">${open && p.precio_actual != null ? money(p.precio_actual, cur) : '—'}${badge}</td>
                <td data-label="Total invertido">${open ? money(p.total_invertido, cur) : '—'}</td>
                <td data-label="Valor">${open ? money(p.valor, cur) : '—'}</td>
                <td data-label="Peso">${open && pesosOk ? pct(p.peso_sobre_cartera, { dec: 1 }) : '—'}</td>
                <td data-label="Resultado" class="${signCls(res)}">${res != null ? `${money(res, cur)}<span class="cart-subline" style="text-align:inherit">${pct(resPct, { signed: true })}</span>` : '—'}</td>
                <td class="cart-full">${open ? `<button type="button" class="cart-btn cart-btn-danger cart-btn-sm" data-cart-action="cerrar" data-ticker="${esc(p.ticker)}" aria-label="Cerrar la posición de ${esc(p.ticker)}">Cerrar</button>` : ''}</td>
            </tr>`;
        }).join('');
        const foot = e === 'cerradas' ? '' : `<tfoot><tr>
            <td class="l cart-full">Total abiertas</td><td></td><td></td><td></td>
            <td data-label="Total invertido">${money(tInv)}</td><td data-label="Valor">${money(tVal)}</td><td data-label="Peso">${pesosOk ? pct(tPeso, { dec: 1 }) : '—'}</td>
            <td data-label="Resultado" class="${signCls(tResOk ? tRes : null)}">${tResOk ? money(tRes) : '—'}</td><td></td></tr></tfoot>`;
        body.innerHTML = (pesosOk ? '' : why('Los pesos no se muestran:', ['La cartera vale casi cero o menos porque falta registrar la aportación inicial de efectivo.']))
            + `<div class="cart-table-wrap"><table class="cart-table cart-cards">
            <caption class="sr-only">Posiciones de la cartera</caption>
            <thead><tr><th class="l" scope="col">Activo</th><th scope="col">Cantidad</th><th scope="col">Precio medio</th><th scope="col">Precio actual</th>
            <th scope="col" title="Cantidad × precio medio + comisiones de entrada">Total invertido</th><th scope="col">Valor</th><th scope="col">Peso</th>
            <th scope="col">Resultado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
            <tbody>${tr}</tbody>${foot}</table></div>`;
    }

    renderAllocation(d) {
        const box = document.getElementById('cart-alloc-body');
        const items = (d && d.items) || [];
        const pos = items.filter(i => isNum(i.valor) && i.valor > 0).sort((a, b) => b.peso_sobre_cartera - a.peso_sobre_cartera);
        const neg = items.filter(i => isNum(i.valor) && i.valor < 0);
        const reasons = (d && d.errores) || [];
        // Invertido = posiciones valoradas (sin la liquidez); total = posiciones + liquidez.
        const inv = items.filter(i => !i.es_liquidez && isNum(i.valor)).reduce((s, i) => s + i.valor, 0);
        const tot = (d && d.total) || 0;
        if (pos.length && (!(tot > 0) || (inv > 0 && tot < inv * 0.05))) {
            box.innerHTML = why('El reparto no es representativo todavía.', ['La cartera (posiciones + liquidez) vale casi cero o menos: la liquidez es negativa porque falta la aportación inicial de efectivo. Regístrala y el reparto sumará 100 %.'])
                + `<div style="margin-top:.6rem"><button type="button" class="cart-btn cart-btn-primary cart-btn-sm" data-cart-action="aportar">Registrar aportación</button></div>`;
            return;
        }
        if (!pos.length) {
            box.innerHTML = why('Todavía no hay reparto que mostrar.', reasons.length ? reasons : ['Registra una aportación o una compra para empezar.']);
            return;
        }
        const max = Math.max(...pos.map(i => i.peso_sobre_cartera), 1);
        box.innerHTML = `<div class="cart-alloc" role="list">`
            + pos.map(i => `<div class="cart-alloc-row" role="listitem">
                <span class="cart-alloc-name" title="${esc(i.ticker)}">${esc(i.es_liquidez ? 'Liquidez' : i.ticker)}</span>
                <span class="cart-alloc-track" aria-hidden="true"><span class="cart-alloc-fill${i.es_liquidez ? ' cart-liq' : ''}" style="width:${Math.max(1, (i.peso_sobre_cartera / max) * 100)}%"></span></span>
                <span class="cart-alloc-val">${pct(i.peso_sobre_cartera, { dec: 1 })}<small>${money(i.valor)}</small></span>
            </div>`).join('')
            + `</div>`
            + (neg.length ? why('No representable como barra (saldo negativo):', neg.map(i => `${i.es_liquidez ? 'Liquidez' : i.ticker}: ${money(i.valor)}`)) : '')
            + (reasons.length ? why('Posiciones sin precio de mercado (fuera del reparto):', reasons) : '');
    }

    // ============================================================
    // Pestaña Operaciones (diario)
    // ============================================================
    async loadOperaciones() {
        if (!this.state.stale.operaciones) return;
        const body = document.getElementById('cart-ops-body');
        body.innerHTML = this.loadingHTML();
        const qs = new URLSearchParams();
        const v = (id) => document.getElementById(id).value.trim();
        if (v('cart-f-desde')) qs.set('desde', v('cart-f-desde'));
        if (v('cart-f-hasta')) qs.set('hasta', v('cart-f-hasta'));
        if (v('cart-f-ticker')) qs.set('ticker', v('cart-f-ticker').toUpperCase());
        if (v('cart-f-tipo')) qs.set('tipo_operacion', v('cart-f-tipo'));
        const res = await this.api(`/journal${qs.toString() ? '?' + qs : ''}`);
        if (!res.ok) { body.innerHTML = why('No se pudo cargar el diario.', [this.apiError(res)], true); return; }
        this.state.stale.operaciones = false;
        const rows = [...((res.data && res.data.rows) || [])].reverse(); // más reciente primero
        const t = (res.data && res.data.totales) || {};
        if (!rows.length) {
            body.innerHTML = `<div class="cart-empty">${qs.toString() ? 'Ninguna operación coincide con el filtro.' : 'Aún no hay operaciones.'}</div>`;
            return;
        }
        const tr = rows.map(r => {
            const cash = r.tipo_operacion === 'aportacion' || r.tipo_operacion === 'retirada';
            const importe = cash ? money(r.importe, r.moneda) : money(r.precio);
            return `<tr>
                <td class="l cart-full"><span class="cart-ticker">${cash ? 'Efectivo' : esc(r.ticker)}</span><span class="cart-subline">${esc(TIPO_OP[r.tipo_operacion] || r.tipo_operacion)} · ${fmtDate(r.fecha)}</span></td>
                <td data-label="Precio / importe">${cash ? `<span class="${r.tipo_operacion === 'aportacion' ? 'cart-pos' : 'cart-neg'}">${r.tipo_operacion === 'retirada' ? '−' : '+'}${importe}</span>` : importe}</td>
                <td data-label="Com. entrada">${r.comision_entrada != null ? money(r.comision_entrada) : '—'}</td>
                <td data-label="Com. salida">${r.comision_salida != null ? money(r.comision_salida) : '—'}</td>
                <td data-label="Peso hist.">${r.peso_historico_pct != null ? pct(r.peso_historico_pct, { dec: 1 }) : '—'}</td>
                <td data-label="Tiempo abierto">${r.tiempo_abierto ? esc(r.tiempo_abierto) + (r.sigue_abierta ? '<span class="cart-subline"><span class="cart-badge cart-badge-open">sigue abierta</span></span>' : '') : '—'}</td>
                <td data-label="Resultado" class="${signCls(r.beneficio)}">${r.beneficio != null ? money(r.beneficio) : '—'}</td>
                <td data-label="Rentab." class="${signCls(r.rentabilidad_pct)}">${r.rentabilidad_pct != null && r.tipo_operacion === 'venta' ? pct(r.rentabilidad_pct, { signed: true }) : '—'}</td>
            </tr>`;
        }).join('');
        // El pie ya no fuerza 100 %: peso real de lo que sigue abierto sobre la cartera de hoy.
        const pa = t.peso_abierto_sobre_cartera_pct;
        const pesosOk = !(this.state.kpis && this.state.kpis.pesos_fiables === false);
        const foot = `<tfoot><tr>
            <td class="l cart-full" colspan="2">Totales${qs.toString() ? ' (filtrado)' : ''}</td>
            <td data-label="Comisiones" colspan="2">${money(t.comisiones_totales)}</td>
            <td data-label="Abierto hoy" title="Peso que hoy tienen las posiciones abiertas sobre la cartera total">${pa != null && pesosOk ? pct(pa, { dec: 1 }) : '—'}</td>
            <td></td>
            <td data-label="Resultado" class="${signCls(t.beneficio_total)}">${money(t.beneficio_total)}</td>
            <td data-label="Rentab. media" class="${signCls(t.rentabilidad_pct_media_ponderada)}">${pct(t.rentabilidad_pct_media_ponderada, { signed: true })}</td>
        </tr></tfoot>`;
        body.innerHTML = `<div class="cart-table-wrap"><table class="cart-table cart-cards">
            <caption class="sr-only">Diario de operaciones</caption>
            <thead><tr><th class="l" scope="col">Operación</th><th scope="col">Precio / importe</th>
            <th scope="col">Com. entrada</th><th scope="col">Com. salida</th><th scope="col" title="Coste de la operación sobre lo invertido en ese momento">Peso hist.</th>
            <th scope="col">Tiempo abierto</th><th scope="col">Resultado</th><th scope="col">Rentab.</th></tr></thead>
            <tbody>${tr}</tbody>${foot}</table></div>
            <p class="cart-muted" style="margin-top:.6rem">En el pie, el peso es el que <b>hoy</b> tienen las posiciones abiertas sobre la cartera total${isNum(t.peso_liquidez_pct) ? ` (la liquidez es el ${pct(t.peso_liquidez_pct, { dec: 1 })})` : ''}. La rentabilidad es la media ponderada de las ventas.</p>`;
    }

    // ============================================================
    // Pestaña Análisis de riesgo
    // ============================================================
    async loadAnalisis(force = false) {
        if (!this.state.stale.analisis && !force) return;
        const cls = document.getElementById('cart-classes-body');
        const mx = document.getElementById('cart-matrix-body');
        cls.innerHTML = `<div class="cart-card">${this.loadingHTML('Calculando riesgo…')}</div>`;
        mx.innerHTML = this.loadingHTML(force ? 'Recalculando…' : 'Calculando…');
        const b = encodeURIComponent(this.state.benchmark);
        // Primero el riesgo (con refresh si se pide): el desglose reutiliza su caché.
        const r = await this.api(`/risk?benchmark=${b}${force ? '&refresh=1' : ''}`);
        const bd = await this.api(`/breakdown?benchmark=${b}`);
        if (bd.ok) this.renderClassTables(bd.data);
        else cls.innerHTML = `<div class="cart-card">${why('No se pudieron cargar las tablas por clase.', [this.apiError(bd)], true)}</div>`;
        if (r.ok) this.renderMatrix(r.data);
        else mx.innerHTML = why('No se pudo calcular la matriz.', [this.apiError(r)], true);
        if (r.ok && bd.ok) this.state.stale.analisis = false;
        if (force) { this.state.stale.kpis = true; this.loadKpis(); }
    }

    renderClassTables(b) {
        const host = document.getElementById('cart-classes-body');
        const c = (b && b.clases) || {};
        const tt = (b && b.totales) || {};
        const bench = esc(BENCH_NAME[this.state.benchmark] || this.state.benchmark);
        const name = (x) => `<span class="cart-ticker">${esc(x.ticker)}</span>${x.nombre ? `<span class="cart-subname">${esc(x.nombre)}</span>` : ''}`;
        const card = (title, sub, head, rows, foot) => `<section class="cart-card"><div class="cart-card-head"><div><h3 class="cart-card-title">${title}</h3>${sub ? `<p class="cart-muted cart-card-sub">${sub}</p>` : ''}</div></div>
            <div class="cart-table-wrap"><table class="cart-table"><thead><tr>${head.map((h, i) => `<th scope="col"${i === 0 ? ' class="l"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>${foot || ''}</table></div></section>`;
        // Fila de totales: se rellenan las columnas pedidas y el resto queda vacío.
        const tfoot = (t, cells) => t && t.n ? `<tfoot><tr><td class="l">Total (${t.n})</td>${cells.map(k => {
            if (k === 'unidades') return `<td>${t.unidades != null ? qty(t.unidades) : ''}</td>`;
            if (k === 'invertido') return `<td>${money(t.total_invertido)}</td>`;
            if (k === 'valor') return `<td>${money(t.valor)}</td>`;
            if (k === 'peso') return `<td>${pct(t.peso_sobre_cartera, { dec: 1 })}</td>`;
            if (k === 'beneficio') return `<td class="${signCls(t.beneficio)}">${t.beneficio != null ? money(t.beneficio) : '—'}</td>`;
            return '<td></td>';
        }).join('')}</tr></tfoot>` : '';
        let out = '';

        if ((c.renta_variable || []).length) {
            out += card('Renta variable', `La clasificación depende del índice elegido (${bench}). Al cambiarlo, se recalcula.`,
                ['Activo', 'Unidades', 'Total invertido', 'Valor', 'Peso', 'Resultado', 'Beta', 'Perfil', 'Sector'],
                c.renta_variable.map(x => `<tr><td class="l">${name(x)}</td><td>${qty(x.unidades)}</td><td>${money(x.total_invertido)}</td>
                    <td>${money(x.valor)}${x.precio_actual == null ? '<span class="cart-badge">a coste</span>' : ''}</td><td>${pct(x.peso_sobre_cartera, { dec: 1 })}</td>
                    <td class="${signCls(x.beneficio)}">${x.beneficio != null && x.precio_actual != null ? money(x.beneficio) : '—'}</td>
                    <td>${num(x.beta)}</td><td>${x.clasificacion ? `<span class="cart-tag">${esc(CLASI[x.clasificacion])}</span>` : '<span class="cart-muted">—</span>'}</td>
                    <td class="l">${esc(x.sector || '—')}</td></tr>`).join(''),
                tfoot(tt.renta_variable, ['unidades', 'invertido', 'valor', 'peso', 'beneficio', '', '', '']));
        }
        if ((c.renta_fija || []).length) {
            out += card('Renta fija', 'Sin cotización en vivo: se valora a coste. Duración modificada calculada con el cupón, la frecuencia y el vencimiento.',
                ['Activo', 'Unidades', 'Total invertido', 'Valor', 'Peso', 'Tipo %', 'Cupón %', 'Duración mod.', 'Vencimiento'],
                c.renta_fija.map(x => `<tr><td class="l">${name(x)}</td><td>${qty(x.unidades)}</td><td>${money(x.total_invertido)}</td><td>${money(x.valor)}</td>
                    <td>${pct(x.peso_sobre_cartera, { dec: 1 })}</td><td>${x.tipo_interes != null ? pct(x.tipo_interes) : '—'}</td><td>${x.cupon != null ? pct(x.cupon) : '—'}</td>
                    <td>${x.duracion_modificada != null ? num(x.duracion_modificada) + ' años' : '—'}</td><td>${fmtDate(x.vencimiento)}</td></tr>`).join(''),
                tfoot(tt.renta_fija, ['unidades', 'invertido', 'valor', 'peso', '', '', '', '']));
        }
        if ((c.derivados || []).length) {
            out += card('Derivados', '',
                ['Activo', 'Unidades', 'Total invertido', 'Valor', 'Peso', 'Tipo', 'Venc. / Call·Put', 'Cubre / Prima'],
                c.derivados.map(x => {
                    const fut = x.der_tipo !== 'opcion';
                    return `<tr><td class="l">${name(x)}</td><td>${qty(x.unidades)}</td><td>${money(x.total_invertido)}</td><td>${money(x.valor)}</td>
                    <td>${pct(x.peso_sobre_cartera, { dec: 1 })}</td><td>${esc(x.der_tipo === 'opcion' ? 'Opción' : x.der_tipo === 'futuro' ? 'Futuro' : '—')}</td>
                    <td>${fut ? fmtDate(x.der_vencimiento) : esc((x.der_tipo_opcion || '—').toUpperCase())}</td><td>${fut ? esc(x.der_subyacente_cobertura || '—') : money(x.der_prima)}</td></tr>`;
                }).join(''),
                tfoot(tt.derivados, ['unidades', 'invertido', 'valor', 'peso', '', '', '']));
        }
        if ((c.cripto || []).length) {
            out += card('Criptomonedas', '',
                ['Activo', 'Unidades', 'Total invertido', 'Valor', 'Peso', 'Resultado'],
                c.cripto.map(x => `<tr><td class="l">${name(x)}</td><td>${qty(x.unidades)}</td><td>${money(x.total_invertido)}</td><td>${money(x.valor)}</td>
                    <td>${pct(x.peso_sobre_cartera, { dec: 1 })}</td><td class="${signCls(x.beneficio)}">${x.beneficio != null ? money(x.beneficio) : '—'}</td></tr>`).join(''),
                tfoot(tt.cripto, ['unidades', 'invertido', 'valor', 'peso', 'beneficio']));
        }
        // Liquidez: saldo calculado (solo lectura) + configuración de remuneración.
        const liq = (c.liquidez && c.liquidez.length) ? c.liquidez
            : [{ moneda: 'EUR', saldo: 0, aportaciones: 0, retiradas: 0, invertido_neto: 0, remunerada: false, tipo_interes_anual: 0, capitalizacion: 'anual', fecha_inicio: '', interes_devengado: 0, peso_sobre_cartera: 0 }];
        const capOpts = (sel) => ['anual', 'semestral', 'trimestral', 'mensual', 'diaria'].map(v => `<option value="${v}"${v === sel ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('');
        out += card('Liquidez', 'El saldo se calcula solo: aportaciones − retiradas − compras (con comisión) + ventas (sin comisión). Aquí solo se configura la remuneración; su peso incluye los intereses devengados.',
            ['Moneda', 'Saldo', 'Intereses', 'Peso', 'Remunerada', 'Tipo anual %', 'Capitalización', 'Desde', ''],
            liq.map(x => `<tr data-moneda="${esc(x.moneda)}">
                <td class="l"><b>${esc(x.moneda)}</b></td>
                <td class="${x.negativo ? 'cart-neg' : ''}" title="Aportado ${money(x.aportaciones, x.moneda)} · retirado ${money(x.retiradas, x.moneda)}">${money(x.saldo, x.moneda)}</td>
                <td class="cart-pos">${money(x.interes_devengado, x.moneda)}</td>
                <td>${pct(x.peso_sobre_cartera, { dec: 1 })}</td>
                <td><input type="checkbox" data-liq="rem" aria-label="Cuenta remunerada"${x.remunerada ? ' checked' : ''}></td>
                <td><input type="number" step="any" min="0" class="cart-input" data-liq="tin" value="${esc(x.tipo_interes_anual || 0)}" style="max-width:90px" aria-label="Tipo de interés anual"></td>
                <td><select class="cart-input" data-liq="cap" aria-label="Capitalización">${capOpts(x.capitalizacion || 'anual')}</select></td>
                <td><input type="date" class="cart-input" data-liq="ini" value="${esc(x.fecha_inicio || '')}" style="max-width:150px" aria-label="Remunerada desde"></td>
                <td><button type="button" class="cart-btn cart-btn-ghost cart-btn-sm" data-cart-action="guardar-liq">Guardar</button></td></tr>`).join(''),
            tt.liquidez && tt.liquidez.n > 1 ? `<tfoot><tr><td class="l">Total (saldo + intereses)</td><td colspan="2">${money(tt.liquidez.valor)}</td><td>${pct(tt.liquidez.peso_sobre_cartera, { dec: 1 })}</td><td colspan="5"></td></tr></tfoot>` : '');

        // Cuadre explícito: la suma de los pesos de todas las clases debe dar 100 %.
        if (isNum(tt.suma_pesos) && b.pesos_fiables !== false) {
            const ok = Math.abs(tt.suma_pesos - 100) < 0.01;
            out += `<p class="cart-muted" style="text-align:right;margin:-.5rem 0 1.25rem">Suma de los pesos de todas las clases: <b>${pct(tt.suma_pesos)}</b> ${ok ? '<i class="fas fa-check cart-pos" aria-label="cuadra"></i>' : '<span class="cart-neg">no cuadra</span>'}</p>`;
        }
        if (b && b.avisos && b.avisos.length && b.pesos_fiables === false) out = why('Los pesos no son representativos todavía', b.avisos, true) + out;
        host.innerHTML = out;
    }

    // Escala divergente para la matriz: azul = se compensan, rojo = se mueven juntos,
    // gris neutro en cero. La diagonal (varianza) no se colorea: es siempre positiva
    // y taparía la lectura de las covarianzas.
    matrixColor(v, maxAbs) {
        if (!isNum(v) || maxAbs <= 0) return 'transparent';
        const dark = document.documentElement.classList.contains('dark');
        const t = Math.min(1, Math.abs(v) / maxAbs);
        const a = (0.08 + 0.47 * t).toFixed(3);
        const [r, g, bl] = v < 0 ? (dark ? [57, 135, 229] : [42, 120, 214]) : (dark ? [230, 103, 103] : [227, 73, 72]);
        return `rgba(${r},${g},${bl},${a})`;
    }

    riskReasons(r) {
        const items = [];
        const min = r.min_sesiones || 60;
        if (r.insuficientes && r.insuficientes.length) {
            items.push(`Necesitas al menos ${min} sesiones de histórico. No llegan: ${r.insuficientes.map(t => {
                const n = r.sesiones_por_ticker && r.sesiones_por_ticker[t];
                return t + (n != null ? ` (${n})` : '');
            }).join(', ')}.`);
        }
        if (r.sin_serie && r.sin_serie.length) items.push(`El proveedor no devolvió precios históricos para: ${r.sin_serie.join(', ')}.`);
        if (r.no_aplica && r.no_aplica.length) items.push(`Sin cotización por su tipo (renta fija, derivados): ${r.no_aplica.join(', ')}.`);
        if (r.benchmark_disponible === false) items.push(`El proveedor no devuelve datos del ${BENCH_NAME[r.benchmark] || r.benchmark}: no se pueden calcular betas.`);
        (r.errores || []).forEach(e => items.push('Detalle: ' + e));
        return items;
    }

    renderMatrix(r) {
        const box = document.getElementById('cart-matrix-body');
        if (!r) { box.innerHTML = why('No se pudo calcular la matriz.', [], true); return; }
        const meta = [r.sesiones ? `${r.sesiones} sesiones comunes` : null, r.fuente_benchmark ? `índice vía ${r.fuente_benchmark === 'twelvedata' ? 'Twelve Data' : 'Stooq'}` : null, r.desde_cache ? 'resultado de hoy en caché' : null].filter(Boolean).join(' · ');
        if (!r.tickers || !r.tickers.length) {
            const its = this.riskReasons(r);
            if (!its.length) its.push('No hay posiciones de renta variable o cripto con las que calcularla.');
            box.innerHTML = why('Todavía no hay matriz. Motivos:', its) + (meta ? `<p class="cart-muted">${esc(meta)}. Pulsa «Recalcular» para forzar un cálculo nuevo.</p>` : '');
            return;
        }
        const tk = r.tickers, M = r.matriz;
        let maxAbs = 0;
        M.forEach((row, i) => row.forEach((v, j) => { if (i !== j && isNum(v)) maxAbs = Math.max(maxAbs, Math.abs(v)); }));
        const head = `<tr><th scope="col"><span class="sr-only">Activo</span></th>${tk.map(t => `<th scope="col">${esc(t)}</th>`).join('')}</tr>`;
        const body = tk.map((ti, i) => `<tr><th scope="row" class="l">${esc(ti)}</th>${tk.map((tj, j) => {
            const v = M[i][j];
            const diag = i === j;
            return `<td class="${diag ? 'cart-diag' : ''}" style="background:${diag ? 'transparent' : this.matrixColor(v, maxAbs)}" title="${esc(ti)} · ${esc(tj)}: ${isNum(v) ? v.toFixed(5) : '—'}${diag ? ' (varianza)' : ''}">${isNum(v) ? num(v, 4) : '—'}</td>`;
        }).join('')}</tr>`).join('');
        const extra = this.riskReasons(r);
        const mid = document.documentElement.classList.contains('dark') ? 'rgba(56,56,53,.9)' : 'rgba(240,239,236,.9)';
        box.innerHTML = `<div class="cart-table-wrap"><table class="cart-matrix"><caption class="sr-only">Matriz de varianzas-covarianzas anualizada</caption><thead>${head}</thead><tbody>${body}</tbody></table></div>
            <div class="cart-scale" aria-hidden="true"><span>Se compensan</span><span class="cart-scale-bar" style="background:linear-gradient(90deg, ${this.matrixColor(-1, 1)}, ${mid} 50%, ${this.matrixColor(1, 1)})"></span><span>Se mueven juntos</span></div>
            ${meta ? `<p class="cart-muted" style="margin-top:.5rem">${esc(meta)}.</p>` : ''}
            ${extra.length ? why('Activos fuera de la matriz:', extra) : ''}`;
    }

    async runDiagnostics() {
        const box = document.getElementById('cart-diag-body');
        box.innerHTML = this.loadingHTML('Probando proveedores desde el servidor…');
        const res = await this.api('/diagnostics');
        if (!res.ok) { box.innerHTML = why(this.apiError(res, 'Error en el diagnóstico.'), [], res.status !== 429); return; }
        const d = res.data || {};
        const td = d.twelve_data || {};
        const row = (prov, idx, sym, ok, detail) => `<tr><td>${prov}</td><td>${esc(idx)}</td><td>${esc(sym || '')}</td><td class="${ok ? 'cart-ok' : 'cart-ko'}">${ok ? 'Responde' : 'No'}</td><td>${esc(detail || '')}</td></tr>`;
        let rows = row('Twelve Data', 'API key', '', !!td.key_configurada, td.key_configurada ? 'configurada' : (td.error || 'no configurada'));
        Object.entries(td.indices || {}).forEach(([k, x]) => { rows += row('Twelve Data', BENCH_NAME[k] || k, x.symbol, x.ok, x.ok ? `${x.n} velas, última ${x.ultima_fecha}` : x.error); });
        Object.entries(d.stooq || {}).forEach(([k, x]) => { rows += row('Stooq', BENCH_NAME[k] || k, x.symbol, x.ok, x.ok ? `${x.n} cierres, último ${x.ultima_fecha}` : x.error); });
        const p = td.profile_AAPL;
        if (p) rows += row('Twelve Data', 'Sector automático (/profile)', 'AAPL', p.ok, p.ok ? `sector: ${p.sector}` : p.error);
        box.innerHTML = `<div class="cart-table-wrap"><table class="cart-diag-table"><thead><tr><th>Proveedor</th><th>Qué</th><th>Símbolo</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    async saveCashConfig(btn) {
        const tr = btn.closest('tr');
        const body = {
            moneda: tr.dataset.moneda,
            remunerada: tr.querySelector('[data-liq="rem"]').checked,
            tipo_interes_anual: parseFloat(tr.querySelector('[data-liq="tin"]').value) || 0,
            capitalizacion: tr.querySelector('[data-liq="cap"]').value,
            fecha_inicio: tr.querySelector('[data-liq="ini"]').value || null
        };
        btn.disabled = true;
        const res = await this.api('/cash', { method: 'PUT', body: JSON.stringify(body) });
        btn.disabled = false;
        if (!res.ok) { this.toast(this.apiError(res, 'No se pudo guardar la liquidez'), 'error'); return; }
        this.toast('Remuneración de la liquidez guardada');
        this.refreshAll();
    }

    // ============================================================
    // Pestaña Evolución
    // ============================================================
    async loadEvolucion() {
        if (!this.state.stale.evolucion) return;
        const body = document.getElementById('cart-evo-body');
        body.innerHTML = this.loadingHTML();
        const res = await this.api(`/history?periodo=${encodeURIComponent(this.state.periodo)}&benchmark=${encodeURIComponent(this.state.benchmark)}`);
        if (!res.ok) { body.innerHTML = why('No se pudo cargar la evolución.', [this.apiError(res)], true); return; }
        this.state.stale.evolucion = false;
        this._historyData = res.data;
        this.renderChart(res.data);
        if (!document.getElementById('cart-evo-table').classList.contains('cart-hidden')) this.renderEvoTable();
    }

    // Serie reescalada a base 100 en su primer punto.
    rebase(s) {
        if (!s || !s.length) return [];
        const b = s[0].valor;
        return s.map(p => ({ fecha: p.fecha, v: b > 0 ? (p.valor / b) * 100 : 100 }));
    }

    renderChart(d) {
        const body = document.getElementById('cart-evo-body');
        if (this.chart) { this.chart.destroy(); this.chart = null; }
        const pf = this.rebase(d.portfolio || []);
        const bench = d.benchmark || {};
        const bs = this.rebase(bench.serie || []);
        const bErr = bench.errores || [];
        if (!pf.length) {
            body.innerHTML = why('Todavía no hay evolución que mostrar.', [d.motivo || 'Aún no hay valores diarios guardados de tu cartera.', ...bErr.map(e => 'Índice: ' + e)]);
            return;
        }
        if (typeof window.Chart === 'undefined') {
            body.innerHTML = why('No se pudo cargar la librería de gráficos.', ['Recarga la página. Mientras tanto, usa «Ver datos».'], true);
            return;
        }
        const notes = [];
        if (pf.length === 1) notes.push('Solo hay un valor guardado: la línea aparecerá a partir del segundo día.');
        if (!bs.length && bench.key) notes.push(`El proveedor no devuelve datos del ${bench.nombre || bench.key}${bErr.length ? ': ' + bErr.join(' · ') : ''}.`);
        body.innerHTML = `<div class="cart-chart"><canvas id="cart-evo-canvas" role="img" aria-label="Evolución de la cartera frente al índice, base 100"></canvas></div>`
            + (notes.length ? why('A tener en cuenta:', notes) : '');
        const cCart = cssVar('--cart-rv') || '#2a78d6';
        const cBench = cssVar('--cart-rf') || '#eb6834';
        const txt = cssVar('--text-secondary') || '#6B7280';
        const grid = cssVar('--border-color') || '#E5E7EB';
        const surface = cssVar('--bg-elevated') || '#fff';
        const labels = pf.map(p => p.fecha);
        const benchMap = new Map(bs.map(p => [p.fecha, p.v]));
        const datasets = [{
            label: 'Tu cartera', data: pf.map(p => p.v), borderColor: cCart, backgroundColor: cCart,
            borderWidth: 2, pointRadius: pf.length < 3 ? 4 : 0, pointHoverRadius: 5, pointHoverBorderWidth: 2,
            pointHoverBorderColor: surface, tension: 0
        }];
        if (bs.length) datasets.push({
            label: bench.nombre || BENCH_NAME[this.state.benchmark], data: labels.map(f => benchMap.get(f) ?? null),
            borderColor: cBench, backgroundColor: cBench, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
            pointHoverBorderWidth: 2, pointHoverBorderColor: surface, tension: 0, spanGaps: true
        });
        // Etiqueta directa al final de cada línea (identidad no solo por color).
        const endLabels = {
            id: 'cartEndLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                ctx.font = '600 11px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
                chart.data.datasets.forEach((ds, i) => {
                    const meta = chart.getDatasetMeta(i);
                    let k = ds.data.length - 1;
                    while (k >= 0 && ds.data[k] == null) k--;
                    if (k < 0 || !meta.data[k]) return;
                    const pt = meta.data[k];
                    ctx.fillStyle = ds.borderColor;
                    ctx.textAlign = 'right';
                    ctx.fillText(ds.label, pt.x - 6, pt.y - 8);
                });
                ctx.restore();
            }
        };
        const fmtIdx = (v) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(v);
        this.chart = new window.Chart(document.getElementById('cart-evo-canvas'), {
            type: 'line',
            data: { labels, datasets },
            plugins: [endLabels],
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 18, right: 8 } },
                plugins: {
                    legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded' } },
                    tooltip: {
                        callbacks: {
                            title: (items) => fmtDate(items[0].label),
                            label: (c) => `${c.dataset.label}: ${fmtIdx(c.parsed.y)} (${c.parsed.y >= 100 ? '+' : ''}${fmtIdx(c.parsed.y - 100)} %)`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, border: { color: grid }, ticks: { color: txt, maxTicksLimit: 6, callback: (v) => fmtDate(labels[v]) } },
                    y: { grid: { color: grid }, border: { display: false }, ticks: { color: txt, callback: (v) => fmtIdx(v) } }
                }
            }
        });
        document.getElementById('cart-evo-sub').textContent = `Base 100 al inicio del periodo · ${pf.length} ${pf.length === 1 ? 'valor guardado' : 'valores guardados'}${bench.fuente ? ` · índice vía ${bench.fuente === 'twelvedata' ? 'Twelve Data' : 'Stooq'}` : ''}`;
    }

    toggleEvoTable(btn) {
        const box = document.getElementById('cart-evo-table');
        const open = box.classList.toggle('cart-hidden') === false;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = open ? 'Ocultar datos' : 'Ver datos';
        if (open) this.renderEvoTable();
    }

    renderEvoTable() {
        const box = document.getElementById('cart-evo-table');
        const d = this._historyData || {};
        const pf = d.portfolio || [];
        if (!pf.length) { box.innerHTML = '<p class="cart-muted">Sin datos.</p>'; return; }
        const bm = new Map(((d.benchmark && d.benchmark.serie) || []).map(p => [p.fecha, p.valor]));
        box.innerHTML = `<div class="cart-table-wrap" style="margin-top:.75rem"><table class="cart-table" style="min-width:420px"><thead><tr><th class="l">Fecha</th><th>Valor de la cartera</th><th>${esc((d.benchmark && d.benchmark.nombre) || 'Índice')}</th></tr></thead><tbody>`
            + [...pf].reverse().map(p => `<tr><td class="l">${fmtDate(p.fecha)}</td><td>${money(p.valor)}</td><td>${bm.has(p.fecha) ? num(bm.get(p.fecha)) : '—'}</td></tr>`).join('')
            + '</tbody></table></div>';
    }

    async saveSnapshot(btn) {
        btn.disabled = true;
        const res = await this.api('/snapshot', { method: 'POST' });
        btn.disabled = false;
        const d = res.data || {};
        if (res.ok && d.guardado) {
            this.toast(`Valor de hoy guardado: ${money(d.valor_total)}`);
            this.state.stale.evolucion = true;
            this.loadEvolucion();
        } else {
            this.toast(d.motivo || this.apiError(res, 'No se guardó el valor de hoy'), 'error');
        }
    }

    // ============================================================
    // Modal: nueva operación
    // ============================================================
    openOpModal(tipo = null) {
        const k = this.state.kpis;
        const sinAport = k ? !k.tiene_aportaciones : false;
        document.getElementById('cart-first-cash').classList.toggle('cart-hidden', !sinAport);
        document.getElementById('cart-op-form').reset();
        document.getElementById('cart-op-fecha').value = today();
        document.getElementById('cart-sector-hint').textContent = '';
        document.getElementById('cart-op-aviso').innerHTML = '';
        this._sectorLookup = null;
        const t = tipo || (sinAport ? 'aportacion' : 'compra');
        document.getElementById('cart-op-tipo')._select(t);
        this.setOpType(t);
        this.openModal('cart-op-modal', t === 'aportacion' || t === 'retirada' ? 'cart-op-importe' : 'cart-op-ticker');
    }

    setOpType(t) {
        this.opType = t;
        const cash = t === 'aportacion' || t === 'retirada';
        document.querySelectorAll('#cart-op-form .cart-std').forEach(el => el.classList.toggle('cart-hidden', cash));
        document.querySelectorAll('#cart-op-form .cart-cash').forEach(el => el.classList.toggle('cart-hidden', !cash));
        document.getElementById('cart-op-precio-label').textContent = t === 'venta' ? 'Precio de venta' : 'Precio de compra';
        document.getElementById('cart-op-submit').textContent = { compra: 'Registrar compra', venta: 'Registrar venta', aportacion: 'Registrar aportación', retirada: 'Registrar retirada' }[t];
        document.getElementById('cart-op-title').textContent = { compra: 'Nueva compra', venta: 'Nueva venta', aportacion: 'Aportación de efectivo', retirada: 'Retirada de efectivo' }[t];
        this.toggleOpFields();
        this.updateOpPreview();
    }

    toggleOpFields() {
        const cash = this.opType === 'aportacion' || this.opType === 'retirada';
        const a = document.getElementById('cart-op-activo').value;
        const compra = this.opType === 'compra';
        // Los atributos del instrumento solo se piden al comprar.
        document.getElementById('cart-grp-rv').classList.toggle('cart-hidden', cash || !compra || !['accion', 'etf', 'fondo'].includes(a));
        document.getElementById('cart-grp-rf').classList.toggle('cart-hidden', cash || !compra || a !== 'renta_fija');
        document.getElementById('cart-grp-der').classList.toggle('cart-hidden', cash || !compra || a !== 'derivado');
        const opt = document.getElementById('cart-der-tipo').value === 'opcion';
        document.querySelectorAll('.cart-der-opt').forEach(el => el.classList.toggle('cart-hidden', !opt));
        document.querySelectorAll('.cart-der-fut').forEach(el => el.classList.toggle('cart-hidden', opt));
    }

    // Vista previa de la liquidez y del efecto sobre la posición, ANTES de registrar.
    updateOpPreview() {
        const g = (id) => document.getElementById(id);
        const k = this.state.kpis || {};
        const saldo = isNum(k.saldo_liquidez) ? k.saldo_liquidez : null;
        const t = this.opType;
        const aviso = g('cart-op-aviso');
        const cashLine = g('cart-op-cash');
        let delta = 0, avisoHtml = '';
        if (t === 'aportacion' || t === 'retirada') {
            const imp = parseFloat(g('cart-op-importe').value) || 0;
            delta = t === 'aportacion' ? imp : -imp;
        } else {
            const ticker = g('cart-op-ticker').value.trim().toUpperCase();
            const q = parseFloat(g('cart-op-cantidad').value) || 0;
            const p = parseFloat(g('cart-op-precio').value) || 0;
            const c = parseFloat(g('cart-op-comision').value) || 0;
            delta = t === 'compra' ? -(q * p + c) : (q * p - c);
            const pos = (this.state.holdings || []).find(h => h.ticker === ticker && h.cantidad_abierta > 1e-9);
            if (ticker && pos && t === 'compra') {
                const nq = pos.cantidad_abierta + q;
                const nm = q > 0 && p > 0 ? (pos.precio_medio * pos.cantidad_abierta + q * p) / nq : null;
                avisoHtml = why(`Ya tienes ${qty(pos.cantidad_abierta)} de ${ticker} a ${money(pos.precio_medio, pos.moneda)} de precio medio.`,
                    nm ? [`Con esta compra, el precio medio pasará a ${money(nm, pos.moneda)}.`] : []);
            } else if (ticker && t === 'venta') {
                avisoHtml = pos ? why(`Tienes ${qty(pos.cantidad_abierta)} de ${ticker} abiertas (máximo que puedes vender).`, q > pos.cantidad_abierta + 1e-9 ? ['La cantidad supera lo que tienes: el servidor la rechazará.'] : [])
                    : why(`No tienes ${ticker} abierta.`, ['Solo puedes vender posiciones abiertas.'], true);
            }
        }
        aviso.innerHTML = avisoHtml;
        if (saldo == null) { cashLine.innerHTML = ''; return; }
        const after = saldo + delta;
        const neg = after < -1e-9 && delta < 0;
        cashLine.innerHTML = `Liquidez: <b>${money(saldo)}</b>${delta ? ` → <b class="${neg ? 'cart-neg' : ''}">${money(after)}</b>` : ''}`
            + (neg ? '<br><span class="cart-neg" style="font-size:.78rem">Quedará en negativo. Se registrará igualmente (margen).</span>' : '');
    }

    async suggestSector() {
        const g = (id) => document.getElementById(id);
        const t = g('cart-op-ticker').value.trim().toUpperCase();
        const hint = g('cart-sector-hint');
        if (!t || this.opType !== 'compra' || !['accion', 'etf', 'fondo'].includes(g('cart-op-activo').value)) return;
        if (g('cart-op-sector').value.trim() || this._sectorLookup === t) return;
        this._sectorLookup = t;
        hint.textContent = 'Buscando sector…';
        const res = await this.api(`/sector?ticker=${encodeURIComponent(t)}`);
        if (!res.ok || !res.data) { hint.textContent = ''; return; }
        const d = res.data;
        if (d.sector && !g('cart-op-sector').value.trim()) g('cart-op-sector').value = d.sector;
        if (d.nombre && !g('cart-op-nombre').value.trim()) g('cart-op-nombre').value = d.nombre;
        hint.textContent = d.sector ? `Sugerido (${d.fuente === 'twelvedata' ? 'Twelve Data' : 'tabla de valores comunes'}). Puedes cambiarlo.` : (d.nota || '');
    }

    async submitOp() {
        const g = (id) => document.getElementById(id);
        const t = this.opType;
        const btn = g('cart-op-submit');
        const fecha = g('cart-op-fecha').value || today();
        const fail = (msg, focusId) => { g('cart-op-aviso').innerHTML = why(msg, [], true); if (focusId) g(focusId).focus(); };
        let body;
        if (t === 'aportacion' || t === 'retirada') {
            const importe = parseFloat(g('cart-op-importe').value);
            if (!(importe > 0)) return fail('Indica un importe mayor que cero.', 'cart-op-importe');
            body = { tipo_operacion: t, importe, moneda: g('cart-op-moneda').value, fecha, broker_origen: g('cart-op-broker').value.trim() || null };
        } else {
            const ticker = g('cart-op-ticker').value.trim().toUpperCase();
            const cantidad = parseFloat(g('cart-op-cantidad').value);
            const precio = parseFloat(g('cart-op-precio').value);
            if (!ticker) return fail('Indica el ticker del activo.', 'cart-op-ticker');
            if (!(cantidad > 0)) return fail('La cantidad debe ser mayor que cero.', 'cart-op-cantidad');
            if (!(precio > 0)) return fail('El precio debe ser mayor que cero.', 'cart-op-precio');
            body = { ticker, tipo_operacion: t, tipo_activo: g('cart-op-activo').value, fecha, cantidad, precio,
                comision: parseFloat(g('cart-op-comision').value) || 0, broker_origen: g('cart-op-broker').value.trim() || null };
        }
        btn.disabled = true;
        const res = await this.api('/operations', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) { btn.disabled = false; return fail(this.apiError(res, 'No se pudo registrar la operación.')); }

        // Atributos del instrumento (nombre, sector, renta fija, derivados) tras una compra.
        if (t === 'compra') {
            const a = body.tipo_activo;
            const instr = { nombre: g('cart-op-nombre').value.trim() || null, tipo_activo: a };
            if (['accion', 'etf', 'fondo'].includes(a)) instr.sector = g('cart-op-sector').value.trim() || null;
            if (a === 'renta_fija') Object.assign(instr, { rf_tipo_interes: g('cart-rf-tipo').value, rf_cupon: g('cart-rf-cupon').value, rf_frecuencia_cupon: g('cart-rf-frec').value, rf_vencimiento: g('cart-rf-venc').value || null, rf_nominal: g('cart-rf-nom').value });
            if (a === 'derivado') Object.assign(instr, { der_tipo: g('cart-der-tipo').value, der_vencimiento: g('cart-der-venc').value || null, der_subyacente_cobertura: g('cart-der-sub').value.trim() || null, der_tipo_opcion: g('cart-der-opt').value, der_prima: g('cart-der-prima').value });
            if (instr.nombre || instr.sector || a === 'renta_fija' || a === 'derivado') {
                await this.api(`/instruments/${encodeURIComponent(body.ticker)}`, { method: 'PUT', body: JSON.stringify(instr) });
            }
        }
        btn.disabled = false;
        this.closeModal('cart-op-modal');
        const liq = res.data && res.data.liquidez;
        const label = { compra: 'Compra', venta: 'Venta', aportacion: 'Aportación', retirada: 'Retirada' }[t];
        if (liq && liq.negativo) this.toast(`${label} registrada. Atención: la liquidez queda en ${money(liq.saldo, liq.moneda)}.`, 'error');
        else this.toast(`${label} registrada${liq ? ` · liquidez ${money(liq.saldo, liq.moneda)}` : ''}`);
        await this.refreshAll();
    }

    // ============================================================
    // Modal: cerrar posición
    // ============================================================
    openCloseModal(ticker) {
        const p = (this.state.holdings || []).find(h => h.ticker === ticker && h.cantidad_abierta > 1e-9);
        if (!p) return;
        this.closeTicker = ticker;
        document.getElementById('cart-close-title').textContent = `Cerrar ${ticker}`;
        document.getElementById('cart-close-sub').textContent = `Se venderán las ${qty(p.cantidad_abierta)} unidades (precio medio ${money(p.precio_medio, p.moneda)}).`;
        document.getElementById('cart-close-precio').value = p.precio_actual != null ? p.precio_actual : '';
        document.getElementById('cart-close-com').value = '';
        document.getElementById('cart-close-fecha').value = today();
        this.updateClosePreview();
        this.openModal('cart-close-modal', 'cart-close-precio');
    }

    updateClosePreview() {
        const p = (this.state.holdings || []).find(h => h.ticker === this.closeTicker);
        const box = document.getElementById('cart-close-preview');
        const precio = parseFloat(document.getElementById('cart-close-precio').value);
        const com = parseFloat(document.getElementById('cart-close-com').value) || 0;
        if (!p || !(precio > 0)) { box.innerHTML = ''; return; }
        // Misma fórmula que el Worker (computeClose): la comisión de entrada se prorratea
        // por la fracción de lo comprado que se vende ahora, más la comisión de salida.
        const comEnt = p.cantidad_comprada > 0 ? (p.comision_entrada_total || 0) * (p.cantidad_abierta / p.cantidad_comprada) : 0;
        const res = (precio - p.precio_medio) * p.cantidad_abierta - comEnt - com;
        const base = p.precio_medio * p.cantidad_abierta;
        box.innerHTML = `<p class="cart-muted" style="margin:0">Resultado estimado: <b class="${signCls(res)}">${money(res, p.moneda)}</b> (${pct(base > 0 ? res / base * 100 : null, { signed: true })}) · entran ${money(precio * p.cantidad_abierta - com, p.moneda)} en liquidez.</p>`;
    }

    async submitClose() {
        const precio = parseFloat(document.getElementById('cart-close-precio').value);
        if (!(precio > 0)) { document.getElementById('cart-close-preview').innerHTML = why('Indica un precio de venta mayor que cero.', [], true); document.getElementById('cart-close-precio').focus(); return; }
        const body = {
            ticker: this.closeTicker, precio_cierre: precio,
            comision_salida: parseFloat(document.getElementById('cart-close-com').value) || 0,
            fecha_cierre: document.getElementById('cart-close-fecha').value || today()
        };
        const res = await this.api('/close', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) { document.getElementById('cart-close-preview').innerHTML = why(this.apiError(res, 'No se pudo cerrar la posición.'), [], true); return; }
        this.closeModal('cart-close-modal');
        this.toast(`Posición cerrada · resultado ${money(res.data.beneficio)} (${pct(res.data.rentabilidad_pct, { signed: true })})`);
        await this.refreshAll();
    }

    // ============================================================
    // Modales: abrir/cerrar con foco gestionado
    // ============================================================
    openModal(id, focusId) {
        this._lastFocus = document.activeElement;
        const m = document.getElementById(id);
        m.classList.add('cart-open');
        document.body.style.overflow = 'hidden';
        setTimeout(() => { const f = focusId && document.getElementById(focusId); (f || m.querySelector('input,select,button')).focus(); }, 30);
    }

    closeModal(id) {
        document.getElementById(id).classList.remove('cart-open');
        document.body.style.overflow = '';
        if (this._lastFocus && this._lastFocus.focus) this._lastFocus.focus();
    }

    trapFocus(m, e) {
        const f = [...m.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(el => !el.disabled && el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
}
