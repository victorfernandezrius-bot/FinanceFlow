// Página standalone de la "Cartera de Inversión" v3 (analizador de cartera).
// La sirve el Worker en /cartera.html para verificarla con `wrangler dev` en el
// mismo origen que la API (sin CORS). Sin dependencias ni CDNs; gráficos en SVG
// propio. El <script> interno evita backticks y ${...} para no colisionar con
// este template literal exterior.
export const CARTERA_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cartera de Inversión · FinanceFlow</title>
<style>
  :root{
    --brand:#0158C9; --brand-2:#2B7BE4; --brand-3:#5EC6FF;
    --font-display:'Bricolage Grotesque','Segoe UI',system-ui,-apple-system,sans-serif;
    --font-body:'Instrument Sans','Segoe UI',system-ui,-apple-system,sans-serif;
    --bg:#EEF2F8; --card:#FFFFFF; --line:#E4E9F2; --text:#0F1B2D; --muted:#5B6B85;
    --pos:#0F9D58; --neg:#D93636; --warn:#B26A00; --warn-bg:#FFF4E0; --tag-bg:#EAF2FF;
    --radius:12px; --shadow:0 1px 2px rgba(15,27,45,.04),0 6px 20px rgba(15,27,45,.05);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1120px;margin:0 auto;padding:26px 20px 80px;}
  h1{font-family:var(--font-display);font-weight:800;font-size:1.6rem;margin:0;letter-spacing:-.01em;}
  h2{font-family:var(--font-display);font-weight:700;font-size:1.1rem;margin:0 0 14px;}
  h3{font-family:var(--font-display);font-weight:700;font-size:.98rem;margin:0 0 10px;}
  .sub{color:var(--muted);margin:4px 0 0;}
  .num{font-family:var(--font-display);font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);}
  .head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;}
  .pos{color:var(--pos);font-weight:700}.neg{color:var(--neg);font-weight:700}.muted{color:var(--muted)}
  section{margin-bottom:22px}
  .panel{padding:16px 18px;}
  .sect-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:14px;}
  .sect-head h2{margin:0}

  /* KPIs */
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
  .kpi{padding:12px 14px;display:flex;flex-direction:column;gap:3px;}
  .kpi .label{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700;}
  .kpi .value{font-family:var(--font-display);font-variant-numeric:tabular-nums;font-weight:800;font-size:1.3rem;line-height:1.1;}
  .classbar{display:flex;height:12px;border-radius:6px;overflow:hidden;margin-top:2px;background:var(--line)}
  .classbar span{display:block;height:100%}

  form.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;align-items:end;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field.wide{grid-column:span 2}
  .field.hidden{display:none}
  .fieldgroup{grid-column:1/-1;display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding-top:10px;border-top:1px dashed var(--line)}
  .fieldgroup.hidden{display:none}
  label{font-size:.72rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
  input,select{font-family:var(--font-body);font-size:.95rem;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);width:100%;}
  input:focus,select:focus{outline:none;border-color:var(--brand-2);box-shadow:0 0 0 3px rgba(94,198,255,.4);}
  .btn{font-family:var(--font-body);font-weight:700;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;background:var(--brand);color:#fff;}
  .btn:hover{background:var(--brand-2)} .btn.sm{padding:6px 11px;font-size:.85rem}
  .btn.ghost{background:transparent;color:var(--brand);border:1px solid var(--line)} .btn.ghost:hover{background:var(--tag-bg)}
  .btn.danger{background:transparent;color:var(--neg);border:1px solid var(--line)} .btn.danger:hover{background:#FDECEC;border-color:var(--neg)}
  .aviso{grid-column:1/-1;font-size:.85rem;background:var(--warn-bg);color:var(--warn);border:1px solid #F0D9A8;border-radius:8px;padding:8px 12px;display:none;}

  .table-scroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;min-width:560px}
  th,td{padding:10px 13px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
  th:first-child,td:first-child,th.l,td.l{text-align:left}
  thead th{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:800}
  tbody tr:last-child td{border-bottom:0}
  tfoot td{font-weight:700;border-top:2px solid var(--line);border-bottom:0}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tag-bg);color:var(--brand-2);text-transform:capitalize}
  .tag.agresiva{background:#E7F0FF;color:#0158C9}.tag.defensiva{background:#EAF6FF;color:#2B7BE4}.tag.igual_benchmark{background:#EEF2F8;color:#5B6B85}
  .stale{display:inline-block;margin-left:6px;font-size:.66rem;font-weight:800;padding:1px 7px;border-radius:999px;background:var(--warn-bg);color:var(--warn);vertical-align:middle}
  .empty{padding:24px;text-align:center;color:var(--muted)}
  .foot-note{font-size:.82rem;color:var(--muted);margin-top:10px}

  .charts{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:16px}
  .legend{display:flex;flex-direction:column;gap:6px;margin-top:8px;font-size:.85rem}
  .legend .row{display:flex;align-items:center;gap:8px}
  .legend .dot{width:11px;height:11px;border-radius:3px;flex:none}
  .legend .pct{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700}
  .filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:14px}
  .filters .field{min-width:120px}

  /* Matriz var-cov */
  .matrix{border-collapse:collapse;min-width:auto}
  .matrix th,.matrix td{padding:8px 10px;text-align:right;border:1px solid var(--line);font-variant-numeric:tabular-nums}
  .matrix th{background:var(--bg);font-size:.72rem}
  .matrix td.diag{font-weight:800;outline:2px solid var(--brand-3);outline-offset:-2px}

  .notice{padding:12px 16px;border-radius:var(--radius);background:var(--tag-bg);border:1px solid #CFE0FA;margin-bottom:18px}
  .notice.err{background:#FDECEC;border-color:#F5C2C2;color:#8a1f1f}
  .tokenbox{display:flex;gap:8px;margin-top:10px}
  .modal-bg{position:fixed;inset:0;background:rgba(15,27,45,.45);display:none;align-items:center;justify-content:center;padding:16px;z-index:20}
  .modal{background:var(--card);border-radius:var(--radius);box-shadow:0 20px 60px rgba(0,0,0,.3);max-width:420px;width:100%;padding:22px}
  .modal h3{font-family:var(--font-display);margin:0 0 14px}
  .modal .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .modal .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
  @media(max-width:860px){.charts{grid-template-columns:1fr}form.grid,.fieldgroup{grid-template-columns:1fr 1fr}.kpi-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div><h1>Cartera de Inversión</h1><p class="sub">Analizador de cartera: riesgo, beta y clases de activo.</p></div>
    <div style="text-align:right">
      <div class="muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Valor de mercado</div>
      <div class="num" id="marketValue" style="font-weight:800;font-size:1.9rem;color:var(--brand)">—</div>
    </div>
  </div>
  <div id="msg"></div>

  <!-- 2. KPIs agregados -->
  <section class="card panel">
    <div class="sect-head"><h2>Resumen</h2><span class="muted" id="benchNote" style="font-size:.82rem"></span></div>
    <div class="kpi-grid" id="kpiGrid"></div>
    <div style="margin-top:12px">
      <div class="label muted" style="font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;font-weight:700">Peso por clase de activo</div>
      <div class="classbar" id="classBar"></div>
      <div class="legend" id="classLegend" style="flex-direction:row;flex-wrap:wrap;gap:14px;margin-top:8px"></div>
    </div>
  </section>

  <!-- 3. Añadir operación -->
  <section class="card panel">
    <h2>Añadir operación</h2>
    <form class="grid" id="opForm" autocomplete="off">
      <div class="field"><label for="f_ticker">Ticker</label><input id="f_ticker" required placeholder="AAPL"></div>
      <div class="field"><label for="f_tipoop">Operación</label><select id="f_tipoop"><option value="compra">Compra</option><option value="venta">Venta</option></select></div>
      <div class="field"><label for="f_tipo">Tipo activo</label>
        <select id="f_tipo"><option value="accion">Acción</option><option value="etf">ETF</option><option value="fondo">Fondo</option><option value="renta_fija">Renta fija</option><option value="derivado">Derivado</option><option value="cripto">Cripto</option></select></div>
      <div class="field"><label for="f_fecha">Fecha</label><input id="f_fecha" type="date" required></div>
      <div class="field"><label for="f_cantidad">Cantidad</label><input id="f_cantidad" type="number" step="any" min="0" required placeholder="10"></div>
      <div class="field"><label for="f_precio">Precio de entrada</label><input id="f_precio" type="number" step="any" min="0" required placeholder="150.50"></div>
      <div class="field"><label for="f_comision">Comisión</label><input id="f_comision" type="number" step="any" min="0" placeholder="0"></div>
      <div class="field"><label for="f_nombre">Nombre</label><input id="f_nombre" placeholder="Apple Inc."></div>
      <div class="field"><label for="f_broker">Broker</label><input id="f_broker" placeholder="IBKR…"></div>
      <div class="field"><label>&nbsp;</label><button class="btn" type="submit">Registrar</button></div>
      <!-- Campos condicionales -->
      <div class="fieldgroup hidden" id="grp_rv">
        <div class="field wide"><label for="f_sector">Sector (renta variable)</label><input id="f_sector" placeholder="Tecnología"></div>
      </div>
      <div class="fieldgroup hidden" id="grp_rf">
        <div class="field"><label for="f_rf_tipo">Tipo interés %</label><input id="f_rf_tipo" type="number" step="any" placeholder="3.5"></div>
        <div class="field"><label for="f_rf_cupon">Cupón %</label><input id="f_rf_cupon" type="number" step="any" placeholder="4"></div>
        <div class="field"><label for="f_rf_frec">Frecuencia cupón</label><select id="f_rf_frec"><option value="anual">Anual</option><option value="semestral">Semestral</option><option value="trimestral">Trimestral</option></select></div>
        <div class="field"><label for="f_rf_venc">Vencimiento</label><input id="f_rf_venc" type="date"></div>
        <div class="field"><label for="f_rf_nom">Nominal</label><input id="f_rf_nom" type="number" step="any" placeholder="1000"></div>
      </div>
      <div class="fieldgroup hidden" id="grp_der">
        <div class="field"><label for="f_der_tipo">Tipo</label><select id="f_der_tipo"><option value="futuro">Futuro</option><option value="opcion">Opción</option></select></div>
        <div class="field"><label for="f_der_venc">Vencimiento</label><input id="f_der_venc" type="date"></div>
        <div class="field der-fut"><label for="f_der_sub">Activo cubierto</label><input id="f_der_sub" placeholder="SP500"></div>
        <div class="field der-opt hidden"><label for="f_der_opt">Call/Put</label><select id="f_der_opt"><option value="call">Call</option><option value="put">Put</option></select></div>
        <div class="field der-opt hidden"><label for="f_der_prima">Prima pagada</label><input id="f_der_prima" type="number" step="any" placeholder="50"></div>
      </div>
      <div class="aviso" id="avisoPos"></div>
    </form>
  </section>

  <!-- 4. Posiciones abiertas -->
  <section class="card panel">
    <div class="sect-head"><h2>Posiciones</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="muted" style="font-size:.8rem">Estado</span>
        <select id="estadoSel" style="max-width:150px"><option value="abiertas">Abiertas</option><option value="cerradas">Cerradas</option><option value="todas">Todas</option></select>
      </div>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th class="l">Ticker</th><th class="l">Tipo</th><th>Cantidad</th><th>Precio medio</th><th>Precio actual</th><th>Comisión</th><th>Valor</th><th>Rent. no realizada</th><th></th></tr></thead>
      <tbody id="posRows"></tbody>
    </table></div>
  </section>

  <!-- 5. Tablas por clase -->
  <section id="classTables"></section>

  <!-- 6. Matriz var-cov -->
  <section class="card panel">
    <h2>Matriz de varianzas-covarianzas (anualizada)</h2>
    <div class="table-scroll" id="matrixWrap"></div>
    <p class="foot-note" id="matrixNote"></p>
    <p class="foot-note">Esta matriz mide cómo se mueven tus activos entre sí. La diagonal es la varianza de cada activo (cuánto oscila por sí solo). El resto son covarianzas: un valor positivo significa que los dos activos tienden a subir y bajar a la vez; uno negativo, que se compensan. Cuanto más cerca de cero o negativos, más diversificada está tu cartera y menos riesgo total asumes para la misma rentabilidad esperada.</p>
  </section>

  <!-- 7. Diario -->
  <section class="card panel">
    <h2>Diario de operaciones</h2>
    <div class="filters">
      <div class="field"><label for="fl_desde">Desde</label><input id="fl_desde" type="date"></div>
      <div class="field"><label for="fl_hasta">Hasta</label><input id="fl_hasta" type="date"></div>
      <div class="field"><label for="fl_ticker">Ticker</label><input id="fl_ticker" placeholder="Todos"></div>
      <div class="field"><label for="fl_tipo">Operación</label><select id="fl_tipo"><option value="">Todas</option><option value="compra">Compra</option><option value="venta">Venta</option></select></div>
      <div class="field"><label>&nbsp;</label><button class="btn ghost sm" id="flApply">Filtrar</button></div>
      <div class="field"><label>&nbsp;</label><button class="btn ghost sm" id="flClear">Limpiar</button></div>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th class="l">Fecha</th><th class="l">Tipo</th><th class="l">Activo</th><th>Precio</th><th>Com. entrada</th><th>Com. salida</th><th>Peso</th><th>Beneficio</th><th>Rentabilidad</th></tr></thead>
      <tbody id="jRows"></tbody><tfoot id="jFoot"></tfoot>
    </table></div>
  </section>

  <!-- 8. Gráficos (selector de benchmark = estado compartido) -->
  <section class="charts">
    <div class="card panel"><h2>Reparto por activo</h2><div id="pieWrap"></div><div class="legend" id="pieLegend"></div></div>
    <div class="card panel">
      <div class="sect-head"><h2>Evolución vs. benchmark</h2>
        <select id="benchSel" style="max-width:180px">
          <option value="SP500">S&amp;P 500</option><option value="NASDAQ100">Nasdaq 100</option><option value="DOWJONES">Dow Jones</option>
          <option value="IBEX35">IBEX 35</option><option value="CAC40">CAC 40</option><option value="DAX">DAX</option><option value="FTSE100">FTSE 100</option>
        </select>
      </div>
      <div id="lineWrap"></div><div class="legend" id="lineLegend" style="flex-direction:row;gap:18px"></div>
    </div>
  </section>
</div>

<div class="modal-bg" id="closeModal"><div class="modal">
  <h3 id="closeTitle">Cerrar posición</h3><p class="muted" id="closeSub" style="margin-top:0;font-size:.9rem"></p>
  <div class="row2"><div class="field"><label for="c_precio">Precio de cierre</label><input id="c_precio" type="number" step="any" min="0"></div>
  <div class="field"><label for="c_com">Comisión salida</label><input id="c_com" type="number" step="any" min="0" placeholder="0"></div></div>
  <div class="field" style="margin-top:10px"><label for="c_fecha">Fecha de cierre</label><input id="c_fecha" type="date"></div>
  <div class="actions"><button class="btn ghost" id="cCancel">Cancelar</button><button class="btn danger" id="cConfirm">Cerrar posición</button></div>
</div></div>

<script>
(function(){
  "use strict";
  var API=(window.API_URL||'/api');
  var TOKEN=localStorage.getItem('financeflow_token')||'';
  var PALETTE=['#0158C9','#2B7BE4','#5EC6FF','#0F9D58','#B26A00','#8E5AE8','#E0568B','#00A6A6'];
  var CLASS_COLORS={renta_variable:'#0158C9',renta_fija:'#2B7BE4',derivados:'#8E5AE8',cripto:'#5EC6FF',liquidez:'#B0BCD0'};
  var CLASS_LABEL={renta_variable:'Renta variable',renta_fija:'Renta fija',derivados:'Derivados',cripto:'Cripto',liquidez:'Liquidez'};
  var CLASI_LABEL={agresiva:'Agresiva',defensiva:'Defensiva',igual_benchmark:'Igual al benchmark'};
  var BENCH_NAME={SP500:'S&P 500',NASDAQ100:'Nasdaq 100',DOWJONES:'Dow Jones',IBEX35:'IBEX 35',CAC40:'CAC 40',DAX:'DAX',FTSE100:'FTSE 100'};
  var state={holdings:[],prices:{},closeTicker:null};

  function $(id){return document.getElementById(id);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function money(n,cur){if(n==null||!isFinite(n))return '—';try{return new Intl.NumberFormat('es-ES',{style:'currency',currency:cur||'EUR'}).format(n);}catch(e){return Number(n).toFixed(2)+' '+(cur||'EUR');}}
  function pct(n){if(n==null||!isFinite(n))return '—';return (n>=0?'+':'')+Number(n).toFixed(2)+'%';}
  function pct0(n){if(n==null||!isFinite(n))return '—';return Number(n).toFixed(2)+'%';}
  function num(n,d){if(n==null||!isFinite(n))return '—';return Number(n).toFixed(d==null?2:d);}
  function cls(n){return n==null?'':(n>=0?'pos':'neg');}
  function today(){return new Date().toISOString().slice(0,10);}
  function bench(){return $('benchSel').value;}
  function showMsg(t,e){$('msg').innerHTML=t?'<div class="notice '+(e?'err':'')+'">'+t+'</div>':'';}
  function showTokenBox(){$('msg').innerHTML='<div class="notice err">No hay sesión (falta el JWT). Pega un token válido.<div class="tokenbox"><input id="tk" placeholder="Bearer JWT…" style="flex:1"><button class="btn sm" id="tkSave">Guardar</button></div></div>';
    $('tkSave').onclick=function(){var v=($('tk').value||'').trim().replace(/^Bearer\\s+/i,'');if(!v)return;localStorage.setItem('financeflow_token',v);TOKEN=v;showMsg('');loadAll();};}
  function api(path,opts){opts=opts||{};opts.headers=Object.assign({'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},opts.headers||{});return fetch(API+path,opts);}

  // ---------- KPIs ----------
  function kpiCard(label,value,klass){return '<div class="kpi"><span class="label">'+label+'</span><span class="value num '+(klass||'')+'">'+value+'</span></div>';}
  function refreshKpis(){
    return api('/portfolio/kpis?benchmark='+bench()).then(function(r){return r.ok?r.json():null;}).then(function(k){
      if(!k)return;
      $('marketValue').textContent=money(k.valor_mercado_total,'EUR');
      var h='';
      h+=kpiCard('Valor de mercado',money(k.valor_mercado_total,'EUR'));
      h+=kpiCard('Coste invertido',money(k.coste_total_invertido,'EUR'));
      h+=kpiCard('P&L no realizado',money(k.pnl_no_realizado,'EUR'),cls(k.pnl_no_realizado));
      h+=kpiCard('P&L realizado',money(k.pnl_realizado,'EUR'),cls(k.pnl_realizado));
      h+=kpiCard('Rentabilidad total',pct(k.rentabilidad_total_pct),cls(k.rentabilidad_total_pct));
      h+=kpiCard('Beta cartera',k.beta_cartera!=null?num(k.beta_cartera,2):'—');
      h+=kpiCard('Volatilidad anual',k.volatilidad_anualizada_pct!=null?pct0(k.volatilidad_anualizada_pct):'—');
      h+=kpiCard('Comisiones',money(k.comisiones_totales,'EUR'));
      h+=kpiCard('% en liquidez',pct0(k.pct_liquidez));
      $('kpiGrid').innerHTML=h;
      // barra de pesos por clase
      var pc=k.peso_por_clase||{}; var bar='',leg='';
      ['renta_variable','renta_fija','derivados','cripto','liquidez'].forEach(function(c){ var v=pc[c]||0; if(v>0.001){ bar+='<span style="width:'+v+'%;background:'+CLASS_COLORS[c]+'"></span>';
        leg+='<div class="row"><span class="dot" style="background:'+CLASS_COLORS[c]+'"></span>'+CLASS_LABEL[c]+' <span class="pct">'+v.toFixed(1)+'%</span></div>'; } });
      $('classBar').innerHTML=bar; $('classLegend').innerHTML=leg;
    });
  }

  // ---------- Posiciones ----------
  function refreshPositions(){
    var estado=$('estadoSel').value;
    return api('/portfolio/holdings?estado='+estado).then(function(r){if(r.status===401){showTokenBox();throw new Error('401');}return r.json();}).then(function(h){
      state.holdings=h||[]; var tk=[]; state.holdings.forEach(function(p){if(p.cantidad_abierta>0&&tk.indexOf(p.ticker)<0)tk.push(p.ticker);});
      if(!tk.length){state.prices={};renderPositions();return;}
      return api('/portfolio/prices?tickers='+encodeURIComponent(tk.join(','))).then(function(r){return r.ok?r.json():{prices:{}};}).then(function(d){state.prices=(d&&d.prices)||{};renderPositions();});
    });
  }
  function renderPositions(){
    var tbody=$('posRows'),h=state.holdings;
    if(!h.length){tbody.innerHTML='<tr><td colspan="9" class="empty">Sin posiciones en este estado.</td></tr>';return;}
    var html='';
    h.forEach(function(p){
      var abierta=p.cantidad_abierta>0; var pr=state.prices[p.ticker]||{}; var cur=(pr.price!=null&&isFinite(pr.price))?Number(pr.price):null;
      var valor=cur!=null?cur*p.cantidad_abierta:null; var rentNR=(cur!=null&&p.precio_medio>0)?((cur-p.precio_medio)/p.precio_medio)*100:null;
      html+='<tr><td class="l"><strong>'+esc(p.ticker)+'</strong></td><td class="l"><span class="tag">'+esc(p.tipo_activo)+'</span></td>'+
        '<td class="num">'+(+p.cantidad_abierta.toFixed(6))+'</td><td class="num">'+money(p.precio_medio,p.moneda)+'</td>'+
        '<td class="num">'+(abierta&&cur!=null?money(cur,p.moneda):'—')+(pr.stale&&cur!=null?'<span class="stale">no act.</span>':'')+'</td>'+
        '<td class="num">'+money(p.comision_total_pagada,p.moneda)+'</td><td class="num">'+(valor!=null?money(valor,p.moneda):'—')+'</td>'+
        '<td class="num '+cls(rentNR)+'">'+(abierta?pct(rentNR):'—')+'</td>'+
        '<td>'+(abierta?'<button class="btn danger sm" data-close="'+esc(p.ticker)+'">Cerrar</button>':'<span class="muted">cerrada</span>')+'</td></tr>';
    });
    tbody.innerHTML=html;
    tbody.querySelectorAll('[data-close]').forEach(function(b){b.onclick=function(){openCloseModal(b.getAttribute('data-close'));};});
  }

  // ---------- Diario ----------
  function refreshJournal(){
    var qs=[]; var d=$('fl_desde').value,ha=$('fl_hasta').value,tk=$('fl_ticker').value.trim(),tp=$('fl_tipo').value;
    if(d)qs.push('desde='+d);if(ha)qs.push('hasta='+ha);if(tk)qs.push('ticker='+encodeURIComponent(tk));if(tp)qs.push('tipo_operacion='+tp);
    return api('/portfolio/journal'+(qs.length?'?'+qs.join('&'):'')).then(function(r){return r.ok?r.json():{rows:[],totales:{}};}).then(function(j){
      var tbody=$('jRows'),rows=j.rows||[];
      if(!rows.length){tbody.innerHTML='<tr><td colspan="9" class="empty">Sin operaciones.</td></tr>';$('jFoot').innerHTML='';return;}
      var html=''; rows.forEach(function(r){html+='<tr><td class="l num">'+esc(r.fecha)+'</td><td class="l"><span class="tag">'+esc(r.tipo_operacion)+'</span></td><td class="l">'+esc(r.ticker)+'</td>'+
        '<td class="num">'+money(r.precio)+'</td><td class="num">'+(r.comision_entrada!=null?money(r.comision_entrada):'—')+'</td><td class="num">'+(r.comision_salida!=null?money(r.comision_salida):'—')+'</td>'+
        '<td class="num">'+(r.peso_en_cartera!=null?r.peso_en_cartera.toFixed(1)+'%':'—')+'</td><td class="num '+cls(r.beneficio)+'">'+(r.beneficio!=null?money(r.beneficio):'—')+'</td><td class="num '+cls(r.rentabilidad_pct)+'">'+pct(r.rentabilidad_pct)+'</td></tr>';});
      tbody.innerHTML=html; var t=j.totales||{};
      $('jFoot').innerHTML='<tr><td class="l" colspan="6">Totales — comisiones: '+money(t.comisiones_totales)+' · peso abierto: '+(t.peso_total!=null?t.peso_total.toFixed(0)+'%':'—')+'</td><td class="num">'+pct(t.rentabilidad_pct_media_ponderada)+'</td><td class="num '+cls(t.beneficio_total)+'">'+money(t.beneficio_total)+'</td><td></td></tr>';
    });
  }

  // ---------- Tablas por clase + matriz (breakdown + risk) ----------
  function refreshAnalysis(){
    return Promise.all([
      api('/portfolio/breakdown?benchmark='+bench()).then(function(r){return r.ok?r.json():null;}),
      api('/portfolio/risk?benchmark='+bench()).then(function(r){return r.ok?r.json():null;})
    ]).then(function(res){ renderClassTables(res[0]); renderMatrix(res[1]); });
  }
  function renderClassTables(b){
    var host=$('classTables'); if(!b){host.innerHTML='';return;}
    var out=''; var c=b.clases||{};
    // Renta variable
    if(c.renta_variable&&c.renta_variable.length){
      var rows=c.renta_variable.map(function(x){return '<tr><td class="l"><strong>'+esc(x.ticker)+'</strong>'+(x.nombre?'<div class="muted" style="font-size:.8rem">'+esc(x.nombre)+'</div>':'')+'</td>'+
        '<td class="num">'+(+x.unidades.toFixed(6))+'</td><td class="num">'+pct0(x.peso_pct)+'</td><td class="num">'+(x.beta!=null?num(x.beta,2):'—')+'</td>'+
        '<td>'+(x.clasificacion?'<span class="tag '+x.clasificacion+'">'+CLASI_LABEL[x.clasificacion]+'</span>':'<span class="muted">—</span>')+'</td><td class="l">'+esc(x.sector||'—')+'</td></tr>';}).join('');
      out+='<div class="card panel"><h3>Renta variable</h3><div class="table-scroll"><table><thead><tr><th class="l">Nombre</th><th>Unidades</th><th>Peso</th><th>Beta</th><th class="l">Tipo</th><th class="l">Sector</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
        '<p class="foot-note">La clasificación agresiva/defensiva/neutra depende del benchmark seleccionado en el gráfico de evolución ('+esc(BENCH_NAME[bench()])+'). Al cambiarlo, esta tabla se recalcula.</p></div>';
    }
    // Renta fija
    if(c.renta_fija&&c.renta_fija.length){
      var rows2=c.renta_fija.map(function(x){return '<tr><td class="l"><strong>'+esc(x.ticker)+'</strong>'+(x.nombre?'<div class="muted" style="font-size:.8rem">'+esc(x.nombre)+'</div>':'')+'</td>'+
        '<td class="num">'+(+x.unidades.toFixed(4))+'</td><td class="num">'+pct0(x.peso_pct)+'</td><td class="num">'+(x.tipo_interes!=null?pct0(x.tipo_interes):'—')+'</td>'+
        '<td class="num">'+(x.cupon!=null?pct0(x.cupon):'—')+'</td><td class="num">'+(x.duracion_modificada!=null?num(x.duracion_modificada,2):'—')+'</td><td class="l num">'+esc(x.vencimiento||'—')+'</td></tr>';}).join('');
      out+='<div class="card panel"><h3>Renta fija</h3><div class="table-scroll"><table><thead><tr><th class="l">Nombre</th><th>Unidades</th><th>Peso</th><th>Tipo interés</th><th>Cupón</th><th>Duración mod.</th><th class="l">Vencimiento</th></tr></thead><tbody>'+rows2+'</tbody></table></div></div>';
    }
    // Derivados
    if(c.derivados&&c.derivados.length){
      var rows3=c.derivados.map(function(x){var esFut=x.der_tipo==='futuro';return '<tr><td class="l"><strong>'+esc(x.ticker)+'</strong>'+(x.nombre?'<div class="muted" style="font-size:.8rem">'+esc(x.nombre)+'</div>':'')+'</td>'+
        '<td class="num">'+(+x.unidades.toFixed(4))+'</td><td class="num">'+pct0(x.peso_pct)+'</td><td class="l">'+esc(x.der_tipo||'—')+'</td>'+
        '<td class="l">'+esc(esFut?(x.der_vencimiento||'—'):(x.der_tipo_opcion||'—'))+'</td><td class="l">'+esc(esFut?(x.der_subyacente_cobertura||'—'):(x.der_prima!=null?money(x.der_prima):'—'))+'</td></tr>';}).join('');
      out+='<div class="card panel"><h3>Derivados</h3><div class="table-scroll"><table><thead><tr><th class="l">Nombre</th><th>Unidades</th><th>Peso</th><th class="l">Tipo</th><th class="l">Venc. / Call·Put</th><th class="l">Cubre / Prima</th></tr></thead><tbody>'+rows3+'</tbody></table></div></div>';
    }
    // Cripto
    if(c.cripto&&c.cripto.length){
      var rows4=c.cripto.map(function(x){return '<tr><td class="l"><strong>'+esc(x.ticker)+'</strong></td><td class="l"><span class="tag">cripto</span></td><td class="num">'+pct0(x.peso_pct)+'</td></tr>';}).join('');
      out+='<div class="card panel"><h3>Criptomonedas</h3><div class="table-scroll"><table><thead><tr><th class="l">Ticker</th><th class="l">Tipo</th><th>Peso</th></tr></thead><tbody>'+rows4+'</tbody></table></div></div>';
    }
    // Liquidez (editable)
    var liq=c.liquidez&&c.liquidez.length?c.liquidez:[{moneda:'EUR',saldo:0,remunerada:false,tipo_interes_anual:0,capitalizacion:'anual',fecha_inicio:'',interes_devengado:0,peso_pct:0}];
    var rows5=liq.map(function(x){return '<tr><td class="l"><strong>'+esc(x.moneda)+'</strong></td><td class="num">'+money(x.saldo,x.moneda)+'</td><td class="num">'+pct0(x.peso_pct)+'</td>'+
      '<td><input type="checkbox" data-liq="rem" '+(x.remunerada?'checked':'')+'></td>'+
      '<td><input type="number" step="any" data-liq="tin" value="'+(x.tipo_interes_anual||0)+'" style="max-width:90px"></td>'+
      '<td><select data-liq="cap"><option value="anual">Anual</option><option value="semestral">Semestral</option><option value="trimestral">Trimestral</option><option value="mensual">Mensual</option><option value="diaria">Diaria</option></select></td>'+
      '<td><input type="date" data-liq="ini" value="'+(x.fecha_inicio||'')+'" style="max-width:150px"></td>'+
      '<td class="num pos">'+money(x.interes_devengado,x.moneda)+'</td>'+
      '<td><button class="btn ghost sm" data-liq="save" data-mon="'+esc(x.moneda)+'" data-saldo="'+x.saldo+'">Guardar</button></td></tr>';}).join('');
    out+='<div class="card panel"><h3>Liquidez</h3><div class="table-scroll"><table><thead><tr><th class="l">Moneda</th><th>Saldo</th><th>Peso</th><th>Remunerada</th><th>Tipo %</th><th>Capitalización</th><th>Desde</th><th>Interés devengado</th><th></th></tr></thead><tbody>'+rows5+'</tbody></table></div>'+
      '<p class="foot-note">Edita el saldo desde “añadir operación” con tipo Liquidez no; usa este bloque para la remuneración. Interés devengado = saldo·((1+i/m)^(m·t)−1).</p></div>';
    host.innerHTML=out;
    // set selects capitalizacion values + wire liquidity save
    host.querySelectorAll('select[data-liq="cap"]').forEach(function(sel,idx){ if(liq[idx]) sel.value=liq[idx].capitalizacion||'anual'; });
    host.querySelectorAll('[data-liq="save"]').forEach(function(btn){ btn.onclick=function(){
      var tr=btn.closest('tr');
      var body={moneda:btn.getAttribute('data-mon'),saldo:parseFloat(btn.getAttribute('data-saldo'))||0,
        remunerada:tr.querySelector('[data-liq="rem"]').checked,
        tipo_interes_anual:parseFloat(tr.querySelector('[data-liq="tin"]').value)||0,
        capitalizacion:tr.querySelector('[data-liq="cap"]').value,
        fecha_inicio:tr.querySelector('[data-liq="ini"]').value||null};
      api('/portfolio/cash',{method:'PUT',body:JSON.stringify(body)}).then(function(){ showMsg('Liquidez actualizada.'); reloadData(); });
    };});
  }

  function shade(v,maxAbs){ if(v==null||!isFinite(v)||maxAbs<=0) return 'transparent'; var a=Math.min(1,Math.abs(v)/maxAbs)*0.5; return 'rgba(1,88,201,'+a.toFixed(3)+')'; }
  function renderMatrix(r){
    var wrap=$('matrixWrap'),note=$('matrixNote');
    if(!r||!r.tickers||!r.tickers.length){ wrap.innerHTML='<div class="empty">Sin activos con histórico suficiente para la matriz.</div>';
      note.textContent=(r&&r.insuficientes&&r.insuficientes.length)?('Sin histórico suficiente (mín. 60 sesiones): '+r.insuficientes.join(', ')+'.'):''; return; }
    var tk=r.tickers, M=r.matriz, maxAbs=0;
    M.forEach(function(row){row.forEach(function(v){if(isFinite(v))maxAbs=Math.max(maxAbs,Math.abs(v));});});
    var h='<table class="matrix"><thead><tr><th></th>'+tk.map(function(t){return '<th>'+esc(t)+'</th>';}).join('')+'</tr></thead><tbody>';
    for(var i=0;i<tk.length;i++){ h+='<tr><th class="l">'+esc(tk[i])+'</th>';
      for(var j=0;j<tk.length;j++){ var v=M[i][j]; h+='<td class="'+(i===j?'diag':'')+'" style="background:'+shade(v,maxAbs)+'">'+(v!=null&&isFinite(v)?v.toFixed(4):'—')+'</td>'; }
      h+='</tr>'; }
    h+='</tbody></table>'; wrap.innerHTML=h;
    var extra=[]; if(!r.benchmark_disponible) extra.push('el benchmark ('+esc(BENCH_NAME[bench()])+') no devolvió datos, por lo que no hay betas');
    if(r.insuficientes&&r.insuficientes.length) extra.push('sin histórico suficiente: '+r.insuficientes.join(', '));
    note.textContent=(r.sesiones?('Calculado con '+r.sesiones+' sesiones comunes. '):'')+(extra.length?'('+extra.join('; ')+').':'');
  }

  // ---------- Tarta ----------
  function polar(cx,cy,r,a){var t=(a-90)*Math.PI/180;return [cx+r*Math.cos(t),cy+r*Math.sin(t)];}
  function arc(cx,cy,r,a0,a1){var p0=polar(cx,cy,r,a1),p1=polar(cx,cy,r,a0),big=(a1-a0)>180?1:0;return 'M '+p0[0]+' '+p0[1]+' A '+r+' '+r+' 0 '+big+' 0 '+p1[0]+' '+p1[1];}
  function refreshPie(){
    return api('/portfolio/allocation').then(function(r){return r.ok?r.json():{items:[],total:0};}).then(function(d){
      var its=(d.items||[]).filter(function(i){return i.valor!=null&&i.valor>0;}),wrap=$('pieWrap'),legend=$('pieLegend');
      if(!its.length){wrap.innerHTML='<div class="empty">Sin datos de mercado.</div>';legend.innerHTML='';return;}
      var ang=0,svg='<svg viewBox="0 0 220 220" width="100%" style="max-width:250px;display:block;margin:0 auto">';
      its.forEach(function(it,i){var sw=it.peso_pct/100*360,col=PALETTE[i%PALETTE.length];svg+=sw>=359.99?'<circle cx="110" cy="110" r="92" fill="none" stroke="'+col+'" stroke-width="30"/>':'<path d="'+arc(110,110,92,ang,ang+sw)+'" fill="none" stroke="'+col+'" stroke-width="30"/>';ang+=sw;});
      svg+='</svg>';wrap.innerHTML=svg;
      legend.innerHTML=its.map(function(it,i){return '<div class="row"><span class="dot" style="background:'+PALETTE[i%PALETTE.length]+'"></span>'+esc(it.ticker)+'<span class="pct">'+it.peso_pct.toFixed(1)+'%</span></div>';}).join('');
    });
  }

  // ---------- Línea ----------
  function rebase(s){if(!s.length)return [];var b=s[0].valor;return s.map(function(p){return {t:new Date(p.fecha).getTime(),v:b>0?p.valor/b*100:100,fecha:p.fecha};});}
  function refreshLine(){
    return api('/portfolio/history?periodo=1A&benchmark='+bench()).then(function(r){return r.ok?r.json():null;}).then(function(d){
      var wrap=$('lineWrap'),legend=$('lineLegend');if(!d){wrap.innerHTML='<div class="empty">—</div>';return;}
      var pf=rebase(d.portfolio||[]),bs=(d.benchmark&&d.benchmark.serie)?rebase(d.benchmark.serie):[];
      if(pf.length<1){wrap.innerHTML='<div class="empty">Aún no hay histórico de valor de cartera (se genera con el cron diario).</div>';legend.innerHTML='';return;}
      var all=pf.concat(bs),tMin=Math.min.apply(null,all.map(function(p){return p.t;})),tMax=Math.max.apply(null,all.map(function(p){return p.t;}));
      var vMin=Math.min.apply(null,all.map(function(p){return p.v;})),vMax=Math.max.apply(null,all.map(function(p){return p.v;}));
      if(tMax===tMin)tMax=tMin+1;var pad=(vMax-vMin)*0.1||1;vMin-=pad;vMax+=pad;
      var W=520,H=240,mL=40,mR=12,mT=14,mB=24,iw=W-mL-mR,ih=H-mT-mB;
      function X(t){return mL+(t-tMin)/(tMax-tMin)*iw;}function Y(v){return mT+(1-(v-vMin)/(vMax-vMin))*ih;}
      function path(s){return s.map(function(p,i){return (i?'L':'M')+X(p.t).toFixed(1)+' '+Y(p.v).toFixed(1);}).join(' ');}
      var svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%">';
      [vMin,(vMin+vMax)/2,vMax,100].forEach(function(v){if(v<vMin||v>vMax)return;var y=Y(v);svg+='<line x1="'+mL+'" y1="'+y.toFixed(1)+'" x2="'+(W-mR)+'" y2="'+y.toFixed(1)+'" stroke="#E4E9F2"/><text x="4" y="'+(y+3).toFixed(1)+'" font-size="9" fill="#8A98B0">'+v.toFixed(0)+'</text>';});
      if(bs.length)svg+='<path d="'+path(bs)+'" fill="none" stroke="#5B6B85" stroke-width="1.5" stroke-dasharray="4 3"/>';
      svg+='<path d="'+path(pf)+'" fill="none" stroke="#0158C9" stroke-width="2.5"/>';
      svg+='<text x="'+mL+'" y="'+(H-6)+'" font-size="9" fill="#8A98B0">'+esc(pf[0].fecha)+'</text><text x="'+(W-mR)+'" y="'+(H-6)+'" text-anchor="end" font-size="9" fill="#8A98B0">'+esc(pf[pf.length-1].fecha)+'</text></svg>';
      wrap.innerHTML=svg;
      legend.innerHTML='<div class="row"><span class="dot" style="background:#0158C9"></span>Cartera</div><div class="row"><span class="dot" style="background:#5B6B85"></span>'+esc((d.benchmark&&d.benchmark.nombre)||bench())+(bs.length?'':' (sin datos)')+'</div>';
    });
  }

  // ---------- Formulario: campos condicionales + aviso ----------
  function toggleFields(){
    var t=$('f_tipo').value;
    $('grp_rv').className='fieldgroup'+(['accion','etf','fondo'].indexOf(t)>=0?'':' hidden');
    $('grp_rf').className='fieldgroup'+(t==='renta_fija'?'':' hidden');
    $('grp_der').className='fieldgroup'+(t==='derivado'?'':' hidden');
    var opt=$('f_der_tipo').value==='opcion';
    document.querySelectorAll('.der-opt').forEach(function(e){e.className=e.className.replace(' hidden','')+(opt?'':' hidden');});
    document.querySelectorAll('.der-fut').forEach(function(e){e.className=e.className.replace(' hidden','')+(opt?' hidden':'');});
  }
  function updateAviso(){
    var t=$('f_ticker').value.trim().toUpperCase(),op=$('f_tipoop').value,box=$('avisoPos');
    var p=state.holdings.filter(function(h){return h.ticker===t&&h.cantidad_abierta>0;})[0];
    if(t&&p&&op==='compra'){box.style.display='block';box.textContent='Ya tienes '+(+p.cantidad_abierta.toFixed(6))+' de '+t+' a precio medio '+money(p.precio_medio,p.moneda)+' — esta compra recalculará el promedio.';}
    else if(t&&p&&op==='venta'){box.style.display='block';box.textContent='Tienes '+(+p.cantidad_abierta.toFixed(6))+' de '+t+' abiertas (máximo vendible).';}
    else box.style.display='none';
  }

  // ---------- Modal cierre ----------
  function openCloseModal(t){state.closeTicker=t;var p=state.holdings.filter(function(h){return h.ticker===t;})[0];
    $('closeTitle').textContent='Cerrar posición · '+t;$('closeSub').textContent=p?('Se venderán las '+(+p.cantidad_abierta.toFixed(6))+' unidades (precio medio '+money(p.precio_medio,p.moneda)+').'):'';
    $('c_precio').value=(state.prices[t]&&state.prices[t].price!=null)?state.prices[t].price:'';$('c_com').value='';$('c_fecha').value=today();$('closeModal').style.display='flex';}
  function hideCloseModal(){$('closeModal').style.display='none';state.closeTicker=null;}

  // ---------- Orquestación ----------
  function reloadData(){ $('benchNote').textContent='Benchmark: '+BENCH_NAME[bench()];
    return Promise.all([refreshKpis(),refreshPositions(),refreshJournal(),refreshAnalysis(),refreshPie(),refreshLine()]); }
  function loadAll(){ if(!TOKEN){showTokenBox();return;} $('f_fecha').value=today(); toggleFields(); reloadData().then(updateAviso).catch(function(e){if(String(e.message)!=='401')showMsg('Error cargando la cartera.',true);}); }

  // ---------- Eventos ----------
  $('opForm').addEventListener('submit',function(ev){ev.preventDefault();
    var t=$('f_ticker').value.trim().toUpperCase(),tipo=$('f_tipo').value;
    var body={ticker:t,tipo_operacion:$('f_tipoop').value,tipo_activo:tipo,fecha:$('f_fecha').value||today(),
      cantidad:parseFloat($('f_cantidad').value),precio:parseFloat($('f_precio').value),comision:$('f_comision').value?parseFloat($('f_comision').value):0,broker_origen:$('f_broker').value.trim()||null};
    api('/portfolio/operations',{method:'POST',body:JSON.stringify(body)}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});}).then(function(res){
      if(!res.ok){showMsg('No se pudo registrar: '+esc(res.d&&res.d.error||'error'),true);return;}
      // Guardar atributos de instrumento si aplica
      var instr={nombre:$('f_nombre').value.trim()||null,tipo_activo:tipo};
      if(['accion','etf','fondo'].indexOf(tipo)>=0) instr.sector=$('f_sector').value.trim()||null;
      if(tipo==='renta_fija'){instr.rf_tipo_interes=$('f_rf_tipo').value;instr.rf_cupon=$('f_rf_cupon').value;instr.rf_frecuencia_cupon=$('f_rf_frec').value;instr.rf_vencimiento=$('f_rf_venc').value||null;instr.rf_nominal=$('f_rf_nom').value;}
      if(tipo==='derivado'){instr.der_tipo=$('f_der_tipo').value;instr.der_vencimiento=$('f_der_venc').value||null;instr.der_subyacente_cobertura=$('f_der_sub').value.trim()||null;instr.der_tipo_opcion=$('f_der_opt').value;instr.der_prima=$('f_der_prima').value;}
      var after=function(){showMsg('Operación registrada.');$('opForm').reset();$('f_fecha').value=today();toggleFields();$('avisoPos').style.display='none';reloadData();};
      if(instr.nombre||instr.sector||tipo==='renta_fija'||tipo==='derivado'){ api('/portfolio/instruments/'+encodeURIComponent(t),{method:'PUT',body:JSON.stringify(instr)}).then(after); } else after();
    }).catch(function(){showMsg('Error de red al registrar.',true);});
  });
  $('f_ticker').addEventListener('input',updateAviso);
  $('f_tipoop').addEventListener('change',updateAviso);
  $('f_tipo').addEventListener('change',toggleFields);
  $('f_der_tipo').addEventListener('change',toggleFields);
  $('estadoSel').addEventListener('change',refreshPositions);
  $('benchSel').addEventListener('change',function(){ $('benchNote').textContent='Benchmark: '+BENCH_NAME[bench()]; refreshKpis(); refreshAnalysis(); refreshLine(); });
  $('flApply').addEventListener('click',function(e){e.preventDefault();refreshJournal();});
  $('flClear').addEventListener('click',function(e){e.preventDefault();$('fl_desde').value='';$('fl_hasta').value='';$('fl_ticker').value='';$('fl_tipo').value='';refreshJournal();});
  $('cCancel').addEventListener('click',hideCloseModal);
  $('closeModal').addEventListener('click',function(e){if(e.target===$('closeModal'))hideCloseModal();});
  $('cConfirm').addEventListener('click',function(){var precio=parseFloat($('c_precio').value);if(!(precio>0)){$('c_precio').focus();return;}
    var body={ticker:state.closeTicker,precio_cierre:precio,comision_salida:$('c_com').value?parseFloat($('c_com').value):0,fecha_cierre:$('c_fecha').value||today()};
    api('/portfolio/close',{method:'POST',body:JSON.stringify(body)}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});}).then(function(res){
      if(!res.ok){showMsg('No se pudo cerrar: '+esc(res.d&&res.d.error||'error'),true);return;}
      hideCloseModal();showMsg('Posición cerrada: beneficio '+money(res.d.beneficio)+' ('+pct(res.d.rentabilidad_pct)+').');reloadData();
    }).catch(function(){showMsg('Error de red al cerrar.',true);});
  });

  loadAll();
})();
</script>
</body>
</html>`;
