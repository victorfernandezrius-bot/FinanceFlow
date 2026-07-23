// Página standalone de la "Cartera de Inversión" v2. La sirve el Worker en
// /cartera.html (ver api/worker.js) para verificarla con `wrangler dev` en el
// mismo origen que la API (sin CORS) sin tocar el enorme dashboard.html.
//
// Sin dependencias ni CDNs externos: CSS, JS y gráficos (SVG) propios. Las
// tipografías de marca se referencian por font-family con fallback del sistema.
// El <script> interno evita backticks y ${...} para no colisionar con este
// template literal exterior.
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
    --bg:#EEF2F8; --card:#FFFFFF; --line:#E4E9F2;
    --text:#0F1B2D; --muted:#5B6B85;
    --pos:#0F9D58; --neg:#D93636; --warn:#B26A00; --warn-bg:#FFF4E0; --tag-bg:#EAF2FF;
    --radius:12px; --shadow:0 1px 2px rgba(15,27,45,.04),0 6px 20px rgba(15,27,45,.05);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1100px;margin:0 auto;padding:26px 20px 72px;}
  h1{font-family:var(--font-display);font-weight:800;font-size:1.6rem;margin:0;letter-spacing:-.01em;}
  h2{font-family:var(--font-display);font-weight:700;font-size:1.1rem;margin:0 0 14px;}
  .sub{color:var(--muted);margin:4px 0 0;}
  .num{font-family:var(--font-display);font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);}
  .head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;}
  .pos{color:var(--pos);font-weight:700}.neg{color:var(--neg);font-weight:700}
  .muted{color:var(--muted)}

  /* KPI cards */
  .kpis{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:22px;}
  .kpi{padding:16px 18px;display:flex;flex-direction:column;gap:6px;}
  .kpi .label{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;}
  .kpi .value{font-family:var(--font-display);font-variant-numeric:tabular-nums;font-weight:800;font-size:2rem;line-height:1;}
  .kpi .foot{font-size:.8rem;color:var(--muted)}
  .kpi select{margin-top:2px}

  section{margin-bottom:22px}
  .panel{padding:16px 18px;}
  .sect-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:14px;}
  .sect-head h2{margin:0}
  .daily-pill{font-size:.85rem;font-weight:700;padding:4px 12px;border-radius:999px;background:var(--tag-bg);}

  form.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;align-items:end;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field.wide{grid-column:span 2}
  label{font-size:.72rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
  input,select{font-family:var(--font-body);font-size:.95rem;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);width:100%;}
  input:focus,select:focus{outline:none;border-color:var(--brand-2);box-shadow:0 0 0 3px rgba(94,198,255,.4);}
  .btn{font-family:var(--font-body);font-weight:700;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;background:var(--brand);color:#fff;}
  .btn:hover{background:var(--brand-2)}
  .btn.sm{padding:6px 11px;font-size:.85rem}
  .btn.ghost{background:transparent;color:var(--brand);border:1px solid var(--line)}
  .btn.ghost:hover{background:var(--tag-bg)}
  .btn.danger{background:transparent;color:var(--neg);border:1px solid var(--line)}
  .btn.danger:hover{background:#FDECEC;border-color:var(--neg)}
  .aviso{grid-column:1/-1;font-size:.85rem;background:var(--warn-bg);color:var(--warn);border:1px solid #F0D9A8;border-radius:8px;padding:8px 12px;display:none;}

  .table-scroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;min-width:640px}
  th,td{padding:11px 14px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
  th:first-child,td:first-child,th.l,td.l{text-align:left}
  thead th{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:800}
  tbody tr:last-child td{border-bottom:0}
  tfoot td{font-weight:700;border-top:2px solid var(--line);border-bottom:0}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tag-bg);color:var(--brand-2);text-transform:capitalize}
  .stale{display:inline-block;margin-left:6px;font-size:.66rem;font-weight:800;padding:1px 7px;border-radius:999px;background:var(--warn-bg);color:var(--warn);vertical-align:middle}
  .empty{padding:26px;text-align:center;color:var(--muted)}

  .charts{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:16px}
  .legend{display:flex;flex-direction:column;gap:6px;margin-top:8px;font-size:.85rem}
  .legend .row{display:flex;align-items:center;gap:8px}
  .legend .dot{width:11px;height:11px;border-radius:3px;flex:none}
  .legend .pct{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700}

  .filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:14px}
  .filters .field{min-width:130px}

  .notice{padding:14px 16px;border-radius:var(--radius);background:var(--tag-bg);border:1px solid #CFE0FA;margin-bottom:20px}
  .notice.err{background:#FDECEC;border-color:#F5C2C2;color:#8a1f1f}
  .tokenbox{display:flex;gap:8px;margin-top:10px}

  .modal-bg{position:fixed;inset:0;background:rgba(15,27,45,.45);display:none;align-items:center;justify-content:center;padding:16px;z-index:20}
  .modal{background:var(--card);border-radius:var(--radius);box-shadow:0 20px 60px rgba(0,0,0,.3);max-width:420px;width:100%;padding:22px}
  .modal h3{font-family:var(--font-display);margin:0 0 14px}
  .modal .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .modal .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}

  @media(max-width:820px){ .charts{grid-template-columns:1fr} form.grid{grid-template-columns:1fr 1fr} .kpis{grid-template-columns:1fr} }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>Cartera de Inversión</h1>
      <p class="sub">Posiciones calculadas desde tu histórico de operaciones.</p>
    </div>
    <div class="total" style="text-align:right">
      <div class="label muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Valor de mercado</div>
      <div class="num" id="marketValue" style="font-weight:800;font-size:1.9rem;color:var(--brand)">—</div>
    </div>
  </div>

  <div id="msg"></div>

  <!-- KPI cards -->
  <div class="kpis">
    <div class="card kpi">
      <span class="label">Rentabilidad diaria</span>
      <span class="value num" id="kpiDaily">—</span>
      <span class="foot" id="kpiDailyFoot">Variación de hoy vs. cierre de ayer</span>
    </div>
    <div class="card kpi">
      <span class="label">Rentabilidad acumulada</span>
      <span class="value num" id="kpiAcc">—</span>
      <span class="foot">
        <select id="periodoSel">
          <option value="mensual">Mensual</option>
          <option value="trimestral">Trimestral</option>
          <option value="semestral">Semestral</option>
          <option value="anual">Anual</option>
        </select>
      </span>
    </div>
  </div>

  <!-- Añadir operación -->
  <section class="card panel">
    <h2>Añadir operación</h2>
    <form class="grid" id="opForm" autocomplete="off">
      <div class="field"><label for="f_ticker">Ticker</label><input id="f_ticker" required placeholder="AAPL"></div>
      <div class="field"><label for="f_tipoop">Operación</label>
        <select id="f_tipoop"><option value="compra">Compra</option><option value="venta">Venta</option></select>
      </div>
      <div class="field"><label for="f_tipo">Tipo activo</label>
        <select id="f_tipo"><option value="accion">Acción</option><option value="etf">ETF</option><option value="fondo">Fondo</option><option value="cripto">Cripto</option></select>
      </div>
      <div class="field"><label for="f_fecha">Fecha</label><input id="f_fecha" type="date" required></div>
      <div class="field"><label for="f_cantidad">Cantidad</label><input id="f_cantidad" type="number" step="any" min="0" required placeholder="10"></div>
      <div class="field"><label for="f_precio">Precio de entrada</label><input id="f_precio" type="number" step="any" min="0" required placeholder="150.50"></div>
      <div class="field"><label for="f_comision">Comisión</label><input id="f_comision" type="number" step="any" min="0" placeholder="0"></div>
      <div class="field"><label for="f_moneda">Moneda</label><select id="f_moneda"><option>EUR</option><option>USD</option><option>GBP</option></select></div>
      <div class="field"><label for="f_broker">Broker</label><input id="f_broker" placeholder="IBKR…"></div>
      <div class="field"><label>&nbsp;</label><button class="btn" type="submit">Registrar</button></div>
      <div class="aviso" id="avisoPos"></div>
    </form>
  </section>

  <!-- Posiciones abiertas -->
  <section class="card panel">
    <div class="sect-head">
      <h2>Posiciones abiertas</h2>
      <span class="daily-pill num" id="dailyPill">—</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th class="l">Ticker</th><th class="l">Tipo</th><th>Cantidad</th><th>Precio medio</th>
          <th>Precio actual</th><th>Comisión pagada</th><th>Valor actual</th><th>Rent. no realizada</th><th></th>
        </tr></thead>
        <tbody id="posRows"><tr><td colspan="9" class="empty">Cargando…</td></tr></tbody>
      </table>
    </div>
  </section>

  <!-- Gráficos -->
  <section class="charts">
    <div class="card panel">
      <h2>Reparto por activo</h2>
      <div id="pieWrap"><div class="empty">—</div></div>
      <div class="legend" id="pieLegend"></div>
    </div>
    <div class="card panel">
      <div class="sect-head">
        <h2>Evolución vs. benchmark</h2>
        <select id="benchSel" style="max-width:180px">
          <option value="SP500">S&amp;P 500</option>
          <option value="NASDAQ100">Nasdaq 100</option>
          <option value="DOWJONES">Dow Jones</option>
          <option value="IBEX35">IBEX 35</option>
          <option value="CAC40">CAC 40</option>
          <option value="DAX">DAX</option>
          <option value="FTSE100">FTSE 100</option>
        </select>
      </div>
      <div id="lineWrap"><div class="empty">—</div></div>
      <div class="legend" id="lineLegend" style="flex-direction:row;gap:18px"></div>
    </div>
  </section>

  <!-- Diario -->
  <section class="card panel">
    <h2>Diario de operaciones</h2>
    <div class="filters">
      <div class="field"><label for="fl_desde">Desde</label><input id="fl_desde" type="date"></div>
      <div class="field"><label for="fl_hasta">Hasta</label><input id="fl_hasta" type="date"></div>
      <div class="field"><label for="fl_ticker">Ticker</label><input id="fl_ticker" placeholder="Todos"></div>
      <div class="field"><label for="fl_tipo">Operación</label>
        <select id="fl_tipo"><option value="">Todas</option><option value="compra">Compra</option><option value="venta">Venta</option></select>
      </div>
      <div class="field"><label>&nbsp;</label><button class="btn ghost sm" id="flApply">Filtrar</button></div>
      <div class="field"><label>&nbsp;</label><button class="btn ghost sm" id="flClear">Limpiar</button></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th class="l">Fecha</th><th class="l">Tipo</th><th class="l">Activo</th><th>Precio</th>
          <th>Com. entrada</th><th>Com. salida</th><th>Peso</th><th>Beneficio</th><th>Rentabilidad</th>
        </tr></thead>
        <tbody id="jRows"><tr><td colspan="9" class="empty">Cargando…</td></tr></tbody>
        <tfoot id="jFoot"></tfoot>
      </table>
    </div>
  </section>
</div>

<!-- Modal cerrar posición -->
<div class="modal-bg" id="closeModal">
  <div class="modal">
    <h3 id="closeTitle">Cerrar posición</h3>
    <p class="muted" id="closeSub" style="margin-top:0;font-size:.9rem"></p>
    <div class="row2">
      <div class="field"><label for="c_precio">Precio de cierre</label><input id="c_precio" type="number" step="any" min="0"></div>
      <div class="field"><label for="c_com">Comisión salida</label><input id="c_com" type="number" step="any" min="0" placeholder="0"></div>
    </div>
    <div class="field" style="margin-top:10px"><label for="c_fecha">Fecha de cierre</label><input id="c_fecha" type="date"></div>
    <div class="actions">
      <button class="btn ghost" id="cCancel">Cancelar</button>
      <button class="btn danger" id="cConfirm">Cerrar posición</button>
    </div>
  </div>
</div>

<script>
(function(){
  "use strict";
  var API = (window.API_URL || '/api');
  var TOKEN = localStorage.getItem('financeflow_token') || '';
  var PALETTE = ['#0158C9','#2B7BE4','#5EC6FF','#0F9D58','#B26A00','#8E5AE8','#E0568B','#00A6A6','#C0417A','#6C8AE4'];
  var state = { holdings: [], prices: {}, closeTicker: null };

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function money(n,cur){ if(n==null||!isFinite(n)) return '—'; try{ return new Intl.NumberFormat('es-ES',{style:'currency',currency:cur||'EUR'}).format(n);}catch(e){ return Number(n).toFixed(2)+' '+(cur||'EUR'); } }
  function pct(n){ if(n==null||!isFinite(n)) return '—'; return (n>=0?'+':'')+Number(n).toFixed(2)+'%'; }
  function cls(n){ return n==null?'':(n>=0?'pos':'neg'); }
  function today(){ return new Date().toISOString().slice(0,10); }

  function showMsg(t,e){ $('msg').innerHTML = t ? '<div class="notice '+(e?'err':'')+'">'+t+'</div>' : ''; }
  function showTokenBox(){
    $('msg').innerHTML = '<div class="notice err">No hay sesión (falta el JWT). Pega un token válido.'+
      '<div class="tokenbox"><input id="tk" placeholder="Bearer JWT…" style="flex:1"><button class="btn sm" id="tkSave">Guardar</button></div></div>';
    $('tkSave').onclick = function(){ var v=($('tk').value||'').trim().replace(/^Bearer\\s+/i,''); if(!v)return; localStorage.setItem('financeflow_token',v); TOKEN=v; showMsg(''); loadAll(); };
  }
  function api(path,opts){ opts=opts||{}; opts.headers=Object.assign({'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},opts.headers||{}); return fetch(API+path,opts); }

  // ---------- Posiciones ----------
  function renderPositions(){
    var tbody=$('posRows'), h=state.holdings, prices=state.prices;
    if(!h.length){ tbody.innerHTML='<tr><td colspan="9" class="empty">Sin posiciones abiertas. Registra una compra arriba.</td></tr>'; $('marketValue').textContent=money(0,'EUR'); return; }
    var total=0, html='';
    h.forEach(function(p){
      var pr=prices[p.ticker]||{}; var cur=(pr.price!=null&&isFinite(pr.price))?Number(pr.price):null;
      var valor=cur!=null?cur*p.cantidad_abierta:null; if(valor!=null) total+=valor;
      var rentNR=(cur!=null&&p.precio_medio>0)?((cur-p.precio_medio)/p.precio_medio)*100:null;
      var staleTag=(pr.stale&&cur!=null)?'<span class="stale">no actualizado</span>':'';
      html+='<tr>'+
        '<td class="l"><strong>'+esc(p.ticker)+'</strong></td>'+
        '<td class="l"><span class="tag">'+esc(p.tipo_activo)+'</span></td>'+
        '<td class="num">'+p.cantidad_abierta+'</td>'+
        '<td class="num">'+money(p.precio_medio,p.moneda)+'</td>'+
        '<td class="num">'+(cur!=null?money(cur,p.moneda):'—')+staleTag+'</td>'+
        '<td class="num">'+money(p.comision_total_pagada,p.moneda)+'</td>'+
        '<td class="num">'+(valor!=null?money(valor,p.moneda):'—')+'</td>'+
        '<td class="num '+cls(rentNR)+'">'+pct(rentNR)+'</td>'+
        '<td><button class="btn danger sm" data-close="'+esc(p.ticker)+'">Cerrar</button></td>'+
      '</tr>';
    });
    tbody.innerHTML=html; $('marketValue').textContent=money(total, h[0].moneda||'EUR');
    Array.prototype.forEach.call(tbody.querySelectorAll('[data-close]'),function(b){ b.onclick=function(){ openCloseModal(b.getAttribute('data-close')); }; });
  }
  function refreshPositions(){
    return api('/portfolio/holdings').then(function(r){ if(r.status===401){showTokenBox();throw new Error('401');} return r.json(); })
      .then(function(h){ state.holdings=h||[]; var tk=[]; state.holdings.forEach(function(p){ if(tk.indexOf(p.ticker)<0) tk.push(p.ticker); });
        if(!tk.length){ state.prices={}; renderPositions(); return; }
        return api('/portfolio/prices?tickers='+encodeURIComponent(tk.join(','))).then(function(r){ return r.ok?r.json():{prices:{}}; })
          .then(function(d){ state.prices=(d&&d.prices)||{}; renderPositions(); });
      });
  }

  // ---------- KPIs / daily ----------
  function refreshKPIs(){
    var periodo=$('periodoSel').value;
    return api('/portfolio/daily-return?periodo='+encodeURIComponent(periodo)).then(function(r){return r.ok?r.json():null;}).then(function(d){
      if(!d) return;
      var dr=d.rentabilidad_diaria_pct, ac=d.rentabilidad_acumulada_pct;
      var kd=$('kpiDaily'); kd.textContent=pct(dr); kd.className='value num '+cls(dr);
      var ka=$('kpiAcc'); ka.textContent=pct(ac); ka.className='value num '+cls(ac);
      var dp=$('dailyPill'); dp.textContent='Rent. diaria cartera: '+pct(dr); dp.className='daily-pill num '+cls(dr);
    });
  }

  // ---------- Diario ----------
  function refreshJournal(){
    var qs=[]; var desde=$('fl_desde').value, hasta=$('fl_hasta').value, tk=$('fl_ticker').value.trim(), tp=$('fl_tipo').value;
    if(desde)qs.push('desde='+desde); if(hasta)qs.push('hasta='+hasta); if(tk)qs.push('ticker='+encodeURIComponent(tk)); if(tp)qs.push('tipo_operacion='+tp);
    return api('/portfolio/journal'+(qs.length?'?'+qs.join('&'):'')).then(function(r){return r.ok?r.json():{rows:[],totales:{}};}).then(function(j){
      var tbody=$('jRows'), rows=j.rows||[];
      if(!rows.length){ tbody.innerHTML='<tr><td colspan="9" class="empty">Sin operaciones.</td></tr>'; $('jFoot').innerHTML=''; return; }
      var html='';
      rows.forEach(function(r){
        html+='<tr>'+
          '<td class="l num">'+esc(r.fecha)+'</td>'+
          '<td class="l"><span class="tag">'+esc(r.tipo_operacion)+'</span></td>'+
          '<td class="l">'+esc(r.ticker)+'</td>'+
          '<td class="num">'+money(r.precio)+'</td>'+
          '<td class="num">'+(r.comision_entrada!=null?money(r.comision_entrada):'—')+'</td>'+
          '<td class="num">'+(r.comision_salida!=null?money(r.comision_salida):'—')+'</td>'+
          '<td class="num">'+(r.peso_en_cartera!=null?r.peso_en_cartera.toFixed(1)+'%':'—')+'</td>'+
          '<td class="num '+cls(r.beneficio)+'">'+(r.beneficio!=null?money(r.beneficio):'—')+'</td>'+
          '<td class="num '+cls(r.rentabilidad_pct)+'">'+pct(r.rentabilidad_pct)+'</td>'+
        '</tr>';
      });
      tbody.innerHTML=html;
      var t=j.totales||{};
      $('jFoot').innerHTML='<tr>'+
        '<td class="l" colspan="6">Totales — comisiones: '+money(t.comisiones_totales)+' · peso abierto: '+(t.peso_total!=null?t.peso_total.toFixed(0)+'%':'—')+'</td>'+
        '<td class="num">'+(t.rentabilidad_pct_media_ponderada!=null?pct(t.rentabilidad_pct_media_ponderada):'—')+'</td>'+
        '<td class="num '+cls(t.beneficio_total)+'">'+money(t.beneficio_total)+'</td>'+
        '<td class="num"></td></tr>';
    });
  }

  // ---------- Gráfico de tarta (SVG) ----------
  function polar(cx,cy,rad,ang){ var a=(ang-90)*Math.PI/180; return [cx+rad*Math.cos(a), cy+rad*Math.sin(a)]; }
  function arc(cx,cy,r,a0,a1){ var p0=polar(cx,cy,r,a1), p1=polar(cx,cy,r,a0); var big=(a1-a0)>180?1:0; return 'M '+p0[0]+' '+p0[1]+' A '+r+' '+r+' 0 '+big+' 0 '+p1[0]+' '+p1[1]; }
  function refreshPie(){
    return api('/portfolio/allocation').then(function(r){return r.ok?r.json():{items:[],total:0};}).then(function(d){
      var items=(d.items||[]).filter(function(i){return i.valor!=null&&i.valor>0;});
      var wrap=$('pieWrap'), legend=$('pieLegend');
      if(!items.length){ wrap.innerHTML='<div class="empty">Sin datos de mercado para repartir.</div>'; legend.innerHTML=''; return; }
      var cx=110,cy=110,r=92, ang=0, svg='<svg viewBox="0 0 220 220" width="100%" style="max-width:260px;display:block;margin:0 auto">';
      items.forEach(function(it,idx){ var sweep=it.peso_pct/100*360; var col=PALETTE[idx%PALETTE.length];
        if(sweep>=359.999){ svg+='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="30"/>'; }
        else { svg+='<path d="'+arc(cx,cy,r,ang,ang+sweep)+'" fill="none" stroke="'+col+'" stroke-width="30"/>'; }
        ang+=sweep;
      });
      svg+='<text x="110" y="104" text-anchor="middle" font-family="'+"'Bricolage Grotesque',sans-serif"+'" font-weight="800" font-size="13" fill="#5B6B85">TOTAL</text>';
      svg+='<text x="110" y="126" text-anchor="middle" font-family="'+"'Bricolage Grotesque',sans-serif"+'" font-weight="800" font-size="16" fill="#0F1B2D">'+esc(money(d.total,'EUR'))+'</text>';
      svg+='</svg>'; wrap.innerHTML=svg;
      var lg=''; items.forEach(function(it,idx){ lg+='<div class="row"><span class="dot" style="background:'+PALETTE[idx%PALETTE.length]+'"></span>'+esc(it.ticker)+'<span class="pct">'+it.peso_pct.toFixed(1)+'%</span></div>'; });
      legend.innerHTML=lg;
    });
  }

  // ---------- Gráfico de líneas (SVG) — rebase 100 ----------
  function rebase(serie){ if(!serie.length) return []; var b=serie[0].valor; return serie.map(function(p){ return {t:new Date(p.fecha).getTime(), v:b>0?(p.valor/b*100):100, fecha:p.fecha}; }); }
  function refreshLine(){
    var bench=$('benchSel').value;
    return api('/portfolio/history?periodo=1A&benchmark='+encodeURIComponent(bench)).then(function(r){return r.ok?r.json():null;}).then(function(d){
      var wrap=$('lineWrap'), legend=$('lineLegend'); if(!d){ wrap.innerHTML='<div class="empty">—</div>'; return; }
      var pf=rebase(d.portfolio||[]); var bs=(d.benchmark&&d.benchmark.serie)?rebase(d.benchmark.serie):[];
      if(pf.length<1){ wrap.innerHTML='<div class="empty">Aún no hay histórico de valor de cartera (se genera con el cron diario).</div>'; legend.innerHTML=''; return; }
      var all=pf.concat(bs); var tMin=Math.min.apply(null,all.map(function(p){return p.t;})), tMax=Math.max.apply(null,all.map(function(p){return p.t;}));
      var vMin=Math.min.apply(null,all.map(function(p){return p.v;})), vMax=Math.max.apply(null,all.map(function(p){return p.v;}));
      if(tMax===tMin) tMax=tMin+1; var pad=(vMax-vMin)*0.1||1; vMin-=pad; vMax+=pad;
      var W=520,H=240,mL=40,mR=12,mT=14,mB=24, iw=W-mL-mR, ih=H-mT-mB;
      function X(t){ return mL+(t-tMin)/(tMax-tMin)*iw; } function Y(v){ return mT+(1-(v-vMin)/(vMax-vMin))*ih; }
      function path(s){ return s.map(function(p,i){ return (i?'L':'M')+X(p.t).toFixed(1)+' '+Y(p.v).toFixed(1); }).join(' '); }
      var svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%">';
      // grid + eje Y (100 = base)
      [vMin,(vMin+vMax)/2,vMax,100].forEach(function(v){ if(v<vMin||v>vMax)return; var y=Y(v); svg+='<line x1="'+mL+'" y1="'+y.toFixed(1)+'" x2="'+(W-mR)+'" y2="'+y.toFixed(1)+'" stroke="#E4E9F2"/>'; svg+='<text x="4" y="'+(y+3).toFixed(1)+'" font-size="9" fill="#8A98B0">'+v.toFixed(0)+'</text>'; });
      if(bs.length) svg+='<path d="'+path(bs)+'" fill="none" stroke="#5B6B85" stroke-width="1.5" stroke-dasharray="4 3"/>';
      svg+='<path d="'+path(pf)+'" fill="none" stroke="#0158C9" stroke-width="2.5"/>';
      svg+='<text x="'+mL+'" y="'+(H-6)+'" font-size="9" fill="#8A98B0">'+esc(pf[0].fecha)+'</text>';
      svg+='<text x="'+(W-mR)+'" y="'+(H-6)+'" text-anchor="end" font-size="9" fill="#8A98B0">'+esc(pf[pf.length-1].fecha)+'</text>';
      svg+='</svg>'; wrap.innerHTML=svg;
      var lg='<div class="row"><span class="dot" style="background:#0158C9"></span>Cartera</div>';
      lg+='<div class="row"><span class="dot" style="background:#5B6B85"></span>'+esc((d.benchmark&&d.benchmark.nombre)||bench)+(bs.length?'':' (sin datos)')+'</div>';
      legend.innerHTML=lg;
    });
  }

  // ---------- Aviso de posición abierta al escribir ticker ----------
  function updateAviso(){
    var t=$('f_ticker').value.trim().toUpperCase(), op=$('f_tipoop').value, box=$('avisoPos');
    var p=state.holdings.filter(function(h){return h.ticker===t;})[0];
    if(t && p && op==='compra'){ box.style.display='block'; box.textContent='Ya tienes '+p.cantidad_abierta+' de '+t+' a precio medio '+money(p.precio_medio,p.moneda)+' — esta compra recalculará el promedio.'; }
    else if(t && p && op==='venta'){ box.style.display='block'; box.textContent='Tienes '+p.cantidad_abierta+' de '+t+' abiertas (máximo vendible).'; }
    else box.style.display='none';
  }

  // ---------- Modal cerrar ----------
  function openCloseModal(ticker){
    state.closeTicker=ticker; var p=state.holdings.filter(function(h){return h.ticker===ticker;})[0];
    $('closeTitle').textContent='Cerrar posición · '+ticker;
    $('closeSub').textContent=p?('Se venderán las '+p.cantidad_abierta+' unidades abiertas (precio medio '+money(p.precio_medio,p.moneda)+').'):'';
    $('c_precio').value=''; $('c_com').value=''; $('c_fecha').value=today();
    $('closeModal').style.display='flex';
  }
  function hideCloseModal(){ $('closeModal').style.display='none'; state.closeTicker=null; }

  // ---------- Orquestación ----------
  function reloadData(){ return Promise.all([refreshPositions(), refreshKPIs(), refreshJournal(), refreshPie(), refreshLine()]); }
  function loadAll(){ if(!TOKEN){ showTokenBox(); return; } $('f_fecha').value=today(); reloadData().then(updateAviso).catch(function(e){ if(String(e.message)!=='401') showMsg('Error cargando la cartera.',true); }); }

  // ---------- Eventos ----------
  $('opForm').addEventListener('submit',function(ev){ ev.preventDefault();
    var body={ ticker:$('f_ticker').value.trim(), tipo_operacion:$('f_tipoop').value, tipo_activo:$('f_tipo').value,
      fecha:$('f_fecha').value, cantidad:parseFloat($('f_cantidad').value), precio:parseFloat($('f_precio').value),
      comision:$('f_comision').value?parseFloat($('f_comision').value):0, moneda:$('f_moneda').value, broker_origen:$('f_broker').value.trim()||null };
    api('/portfolio/operations',{method:'POST',body:JSON.stringify(body)}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(res){ if(!res.ok){ showMsg('No se pudo registrar: '+esc(res.d&&res.d.error||'error'),true); return; }
        showMsg(''); $('opForm').reset(); $('f_fecha').value=today(); $('avisoPos').style.display='none'; reloadData(); })
      .catch(function(){ showMsg('Error de red al registrar.',true); });
  });
  $('f_ticker').addEventListener('input',updateAviso);
  $('f_tipoop').addEventListener('change',updateAviso);
  $('periodoSel').addEventListener('change',refreshKPIs);
  $('benchSel').addEventListener('change',refreshLine);
  $('flApply').addEventListener('click',function(e){ e.preventDefault(); refreshJournal(); });
  $('flClear').addEventListener('click',function(e){ e.preventDefault(); $('fl_desde').value=''; $('fl_hasta').value=''; $('fl_ticker').value=''; $('fl_tipo').value=''; refreshJournal(); });
  $('cCancel').addEventListener('click',hideCloseModal);
  $('closeModal').addEventListener('click',function(e){ if(e.target===$('closeModal')) hideCloseModal(); });
  $('cConfirm').addEventListener('click',function(){
    var precio=parseFloat($('c_precio').value); if(!(precio>0)){ $('c_precio').focus(); return; }
    var body={ ticker:state.closeTicker, precio_cierre:precio, comision_salida:$('c_com').value?parseFloat($('c_com').value):0, fecha_cierre:$('c_fecha').value||today() };
    api('/portfolio/close',{method:'POST',body:JSON.stringify(body)}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(res){ if(!res.ok){ showMsg('No se pudo cerrar: '+esc(res.d&&res.d.error||'error'),true); return; }
        hideCloseModal(); showMsg('Posición cerrada: beneficio '+money(res.d.beneficio)+' ('+pct(res.d.rentabilidad_pct)+').'); reloadData(); })
      .catch(function(){ showMsg('Error de red al cerrar.',true); });
  });

  loadAll();
})();
</script>
</body>
</html>`;
