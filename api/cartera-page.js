// Página standalone de la "Cartera de Inversión". La sirve el Worker en
// /cartera.html (ver api/worker.js) para poder verificarla con `wrangler dev`
// en el mismo origen que la API (sin CORS) y sin tocar el enorme dashboard.html.
//
// Sin dependencias ni CDNs externos: CSS y JS propios. Las tipografías de marca
// (Bricolage Grotesque / Instrument Sans) se referencian por font-family con
// fallback del sistema; NO se cargan por CDN, así que degradan a las fuentes del
// sistema si no están instaladas (se respetan colores, tabular-nums y radios).
//
// El <script> interno evita backticks y ${...} a propósito para no colisionar
// con este template literal exterior.
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
    --bg:#F5F7FB; --card:#FFFFFF; --line:#E4E9F2;
    --text:#0F1B2D; --muted:#5B6B85;
    --pos:#0F9D58; --neg:#D93636; --warn:#B26A00; --warn-bg:#FFF4E0;
    --radius:12px;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:15px;line-height:1.5;}
  .wrap{max-width:1040px;margin:0 auto;padding:24px 20px 64px;}
  h1{font-family:var(--font-display);font-weight:800;font-size:1.6rem;margin:0;}
  .sub{color:var(--muted);margin:4px 0 0;}
  .num{font-family:var(--font-display);font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);}
  .head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;}
  .total{text-align:right}
  .total .label{color:var(--muted);font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;}
  .total .value{font-family:var(--font-display);font-variant-numeric:tabular-nums;font-weight:800;font-size:1.9rem;color:var(--brand);}
  .panel{padding:16px 18px;margin-bottom:20px;}
  .panel h2{font-family:var(--font-display);font-size:1.05rem;margin:0 0 12px;}
  form.add{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;align-items:end;}
  form.add .field{display:flex;flex-direction:column;gap:4px;}
  form.add .field.wide{grid-column:span 2;}
  label{font-size:.78rem;color:var(--muted);font-weight:600;}
  input,select{font-family:var(--font-body);font-size:.95rem;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);width:100%;}
  input:focus,select:focus{outline:2px solid var(--brand-3);border-color:var(--brand-2);}
  .btn{font-family:var(--font-body);font-weight:700;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;background:var(--brand);color:#fff;}
  .btn:hover{background:var(--brand-2);}
  .btn.sm{padding:6px 10px;font-size:.85rem;}
  .btn.ghost{background:transparent;color:var(--neg);border:1px solid var(--line);}
  .btn.ghost:hover{background:#FDECEC;border-color:var(--neg);}
  table{width:100%;border-collapse:collapse;}
  th,td{padding:12px 14px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap;}
  th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left;}
  thead th{font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700;}
  tbody tr:last-child td{border-bottom:0;}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:999px;background:#EAF2FF;color:var(--brand);text-transform:capitalize;}
  .pos{color:var(--pos)} .neg{color:var(--neg)}
  .stale{display:inline-block;margin-left:6px;font-size:.68rem;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--warn-bg);color:var(--warn);vertical-align:middle;}
  .muted{color:var(--muted)}
  .notice{padding:14px 16px;border-radius:var(--radius);background:#EAF2FF;border:1px solid #CFE0FA;margin-bottom:20px;}
  .notice.err{background:#FDECEC;border-color:#F5C2C2;color:#8a1f1f;}
  .tokenbox{display:flex;gap:8px;margin-top:10px;}
  .empty{padding:28px;text-align:center;color:var(--muted);}
  @media(max-width:760px){form.add{grid-template-columns:1fr 1fr;}form.add .field.wide{grid-column:span 2;}.wrap{padding:16px 12px 48px;}}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>Cartera de Inversión</h1>
      <p class="sub">Posiciones, precio actual y valoración en tiempo (casi) real.</p>
    </div>
    <div class="total">
      <div class="label">Valor total cartera</div>
      <div class="value num" id="totalValue">—</div>
    </div>
  </div>

  <div id="msg"></div>

  <div class="card panel">
    <h2>Añadir posición</h2>
    <form class="add" id="addForm" autocomplete="off">
      <div class="field"><label for="f_ticker">Ticker</label><input id="f_ticker" required placeholder="AAPL"></div>
      <div class="field"><label for="f_tipo">Tipo</label>
        <select id="f_tipo">
          <option value="accion">Acción</option>
          <option value="etf">ETF</option>
          <option value="fondo">Fondo</option>
          <option value="cripto">Cripto</option>
        </select>
      </div>
      <div class="field"><label for="f_cantidad">Cantidad</label><input id="f_cantidad" type="number" step="any" min="0" required placeholder="10"></div>
      <div class="field"><label for="f_precio">Precio medio compra</label><input id="f_precio" type="number" step="any" min="0" required placeholder="150.50"></div>
      <div class="field"><label for="f_moneda">Moneda</label>
        <select id="f_moneda"><option>EUR</option><option>USD</option><option>GBP</option></select>
      </div>
      <div class="field"><label>&nbsp;</label><button class="btn" type="submit">Añadir</button></div>
      <div class="field wide"><label for="f_broker">Broker (opcional)</label><input id="f_broker" placeholder="IBKR, MyInvestor…"></div>
      <div class="field wide"><label for="f_nombre">Nombre (opcional)</label><input id="f_nombre" placeholder="Apple Inc."></div>
    </form>
  </div>

  <div class="card">
    <table>
      <thead><tr>
        <th>Ticker</th><th>Tipo</th><th>Cantidad</th><th>Precio medio</th>
        <th>Precio actual</th><th>Valor actual</th><th>Var. %</th><th></th>
      </tr></thead>
      <tbody id="rows"><tr><td colspan="8" class="empty">Cargando…</td></tr></tbody>
    </table>
  </div>
</div>

<script>
(function(){
  "use strict";
  var API = (window.API_URL || '/api');
  var TOKEN = localStorage.getItem('financeflow_token') || '';

  var $ = function(id){ return document.getElementById(id); };
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function money(n, cur){
    if (n == null || !isFinite(n)) return '—';
    try { return new Intl.NumberFormat('es-ES',{style:'currency',currency:cur||'EUR'}).format(n); }
    catch(e){ return n.toFixed(2) + ' ' + (cur||'EUR'); }
  }
  function pct(n){ return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

  function showMsg(text, isErr){
    $('msg').innerHTML = text ? '<div class="notice ' + (isErr?'err':'') + '">' + text + '</div>' : '';
  }
  function showTokenBox(){
    $('msg').innerHTML =
      '<div class="notice err">No hay sesión (falta el JWT). Pega un token válido para ver tu cartera.' +
      '<div class="tokenbox"><input id="tk" placeholder="Bearer JWT…" style="flex:1">' +
      '<button class="btn sm" id="tkSave">Guardar</button></div></div>';
    $('tkSave').onclick = function(){
      var v = ($('tk').value || '').trim().replace(/^Bearer\\s+/i,'');
      if (!v) return;
      localStorage.setItem('financeflow_token', v);
      TOKEN = v; showMsg(''); load();
    };
  }

  function api(path, opts){
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type':'application/json', 'Authorization':'Bearer ' + TOKEN }, opts.headers||{});
    return fetch(API + path, opts);
  }

  function render(holdings, prices){
    var tbody = $('rows');
    if (!holdings.length){
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Aún no tienes posiciones. Añade la primera arriba.</td></tr>';
      $('totalValue').textContent = money(0,'EUR');
      return;
    }
    var total = 0, html = '';
    holdings.forEach(function(h){
      var p = prices[h.ticker] || {};
      var cur = (p.price != null && isFinite(p.price)) ? Number(p.price) : null;
      var valor = cur != null ? cur * Number(h.cantidad) : null;
      if (valor != null) total += valor;
      var variation = (cur != null && h.precio_medio_compra > 0)
        ? ((cur - h.precio_medio_compra) / h.precio_medio_compra) * 100 : null;
      var staleTag = (p.stale && cur != null) ? '<span class="stale" title="Precio no actualizado (última cotización conocida)">precio no actualizado</span>' : '';
      var noPrice = (cur == null) ? '<span class="stale" title="Sin cotización disponible">sin precio</span>' : '';
      html +=
        '<tr>' +
          '<td><strong>' + esc(h.ticker) + '</strong>' + (h.nombre ? '<div class="muted" style="font-size:.8rem">'+esc(h.nombre)+'</div>' : '') + '</td>' +
          '<td><span class="tag">' + esc(h.tipo_activo) + '</span></td>' +
          '<td class="num">' + Number(h.cantidad) + '</td>' +
          '<td class="num">' + money(Number(h.precio_medio_compra), h.moneda) + '</td>' +
          '<td class="num">' + (cur != null ? money(cur, h.moneda) : '—') + staleTag + noPrice + '</td>' +
          '<td class="num">' + (valor != null ? money(valor, h.moneda) : '—') + '</td>' +
          '<td class="num ' + (variation==null?'':(variation>=0?'pos':'neg')) + '">' + (variation != null ? pct(variation) : '—') + '</td>' +
          '<td><button class="btn ghost sm" data-del="' + esc(h.id) + '">Eliminar</button></td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
    $('totalValue').textContent = money(total, holdings[0].moneda || 'EUR');
    Array.prototype.forEach.call(tbody.querySelectorAll('[data-del]'), function(btn){
      btn.onclick = function(){ removeHolding(btn.getAttribute('data-del')); };
    });
  }

  function load(){
    if (!TOKEN){ showTokenBox(); return; }
    api('/portfolio/holdings').then(function(r){
      if (r.status === 401){ showTokenBox(); throw new Error('401'); }
      return r.json();
    }).then(function(holdings){
      holdings = holdings || [];
      var tickers = [];
      holdings.forEach(function(h){ if (tickers.indexOf(h.ticker) < 0) tickers.push(h.ticker); });
      if (!tickers.length){ render(holdings, {}); return; }
      // UNA sola petición batch de precios para todos los tickers.
      api('/portfolio/prices?tickers=' + encodeURIComponent(tickers.join(','))).then(function(r){
        return r.ok ? r.json() : { prices:{} };
      }).then(function(data){ render(holdings, (data && data.prices) || {}); })
        .catch(function(){ render(holdings, {}); });
    }).catch(function(e){ if (String(e.message) !== '401') showMsg('Error cargando la cartera.', true); });
  }

  function removeHolding(id){
    if (!confirm('¿Eliminar esta posición?')) return;
    api('/portfolio/holdings/' + encodeURIComponent(id), { method:'DELETE' })
      .then(function(){ load(); })
      .catch(function(){ showMsg('No se pudo eliminar.', true); });
  }

  $('addForm').addEventListener('submit', function(ev){
    ev.preventDefault();
    var body = {
      ticker: $('f_ticker').value.trim(),
      tipo_activo: $('f_tipo').value,
      cantidad: parseFloat($('f_cantidad').value),
      precio_medio_compra: parseFloat($('f_precio').value),
      moneda: $('f_moneda').value,
      broker_origen: $('f_broker').value.trim() || null,
      nombre: $('f_nombre').value.trim() || null
    };
    api('/portfolio/holdings', { method:'POST', body: JSON.stringify(body) })
      .then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
      .then(function(res){
        if (!res.ok){ showMsg('No se pudo añadir: ' + esc(res.d && res.d.error || 'error'), true); return; }
        showMsg('');
        $('addForm').reset();
        load();
      })
      .catch(function(){ showMsg('Error de red al añadir.', true); });
  });

  load();
})();
</script>
</body>
</html>`;
