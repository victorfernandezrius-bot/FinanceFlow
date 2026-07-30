// Banner para navegadores in-app de redes (Instagram / Facebook / TikTok).
// Esos webviews bloquean cookies, la redirección a checkout.stripe.com y flujos
// OAuth, así que el pago y el login de Google fallan. Este banner los detecta y
// guía al usuario a abrir la página en su navegador normal.
//
// Expone window.FFInApp para reutilizar la detección (p. ej. el refuerzo del pago
// en stripe-checkout.js). IMPORTANTE: el pago hace su PROPIA detección inline y no
// depende de que este script haya cargado.
(function () {
    'use strict';

    var UA = navigator.userAgent || '';
    var isInApp = /Instagram|FBAN|FBAV|BytedanceWebview/i.test(UA);
    var isIOS = /iPhone|iPad|iPod/i.test(UA);
    var isAndroid = /Android/i.test(UA);

    // Comodidad para otros scripts (no es la fuente de verdad del pago).
    window.FFInApp = {
        isInApp: function () { return isInApp; },
        isIOS: isIOS,
        isAndroid: isAndroid,
        currentUrl: function () { return window.location.href; }
    };

    if (!isInApp) return;

    var BRAND = '#0158C9';

    function btnStyle(bg, fg) {
        return 'background:' + bg + ';color:' + fg + ';border:0;border-radius:6px;' +
               'padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;';
    }

    function fallbackCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) { /* sin portapapeles: el usuario puede copiar la URL a mano */ }
    }

    function build() {
        // Cerrado en esta sesión: no reaparece hasta una nueva visita (sessionStorage,
        // no localStorage), para no dejar atascado a un Android sin Chrome.
        if (sessionStorage.getItem('ff_inapp_dismissed') === '1') return;
        if (!document.body || document.getElementById('ff-inapp-banner')) return;

        var url = window.location.href;

        var wrap = document.createElement('div');
        wrap.id = 'ff-inapp-banner';
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', 'Aviso: abre esta página en tu navegador');
        // Flujo normal al principio del body: empuja el contenido, no lo tapa.
        wrap.style.cssText = [
            'position:relative', 'z-index:2147483647', 'box-sizing:border-box',
            'width:100%', 'background:' + BRAND, 'color:#fff',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
            'font-size:14px', 'line-height:1.4', 'padding:12px 40px 12px 16px'
        ].join(';');

        var msg = document.createElement('p');
        msg.style.cssText = 'margin:0 0 8px;font-weight:600;';
        msg.textContent = 'Para registrarte y usar Finance Flow correctamente (incluidos los pagos), ' +
            'abre esta página en tu navegador. Pulsa el menú ⋯ arriba a la derecha y elige ' +
            '"Abrir en el navegador".';

        var actions = document.createElement('div');
        actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;';

        var urlBox = document.createElement('span');
        urlBox.textContent = url;
        urlBox.style.cssText = 'flex:1 1 100%;font-size:12px;word-break:break-all;opacity:.95;' +
            'background:rgba(255,255,255,.15);padding:6px 8px;border-radius:6px;';

        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copiar enlace';
        copyBtn.style.cssText = btnStyle('#fff', BRAND);
        copyBtn.onclick = function () {
            var done = function () {
                copyBtn.textContent = '¡Copiado!';
                setTimeout(function () { copyBtn.textContent = 'Copiar enlace'; }, 2000);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy(url); done(); });
            } else {
                fallbackCopy(url);
                done();
            }
        };

        actions.appendChild(urlBox);
        actions.appendChild(copyBtn);

        // Android: intentar abrir en Chrome vía intent:// (en iOS NO hay forma
        // programática de abrir Safari, así que no se ofrece ese botón).
        if (isAndroid) {
            var chromeBtn = document.createElement('a');
            chromeBtn.textContent = 'Abrir en Chrome';
            chromeBtn.href = 'intent://' + url.replace(/^https?:\/\//, '') +
                '#Intent;scheme=https;package=com.android.chrome;end';
            chromeBtn.style.cssText = btnStyle('rgba(255,255,255,.2)', '#fff') + 'text-decoration:none;';
            actions.appendChild(chromeBtn);
        }

        // Cerrar (X): guarda la elección en sessionStorage y quita el banner.
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Cerrar aviso');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = 'position:absolute;top:6px;right:8px;background:transparent;border:0;' +
            'color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;';
        closeBtn.onclick = function () {
            try { sessionStorage.setItem('ff_inapp_dismissed', '1'); } catch (e) {}
            if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        };

        wrap.appendChild(closeBtn);
        wrap.appendChild(msg);
        wrap.appendChild(actions);
        document.body.insertBefore(wrap, document.body.firstChild);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
