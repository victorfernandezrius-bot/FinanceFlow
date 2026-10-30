// Cloudflare Turnstile (anti-bots) para login, registro y recuperación de contraseña.
// Desactivado mientras window.TURNSTILE_SITE_KEY (public/config.js) esté vacío: en
// ese caso mount() no pinta nada y token() devuelve null, y el servidor no lo exige
// mientras no exista el secreto TURNSTILE_SECRET_KEY.
window.FFTurnstile = (function () {
    var loading = null;

    function enabled() {
        return !!window.TURNSTILE_SITE_KEY;
    }

    function load() {
        if (window.turnstile) return Promise.resolve(window.turnstile);
        if (!loading) {
            loading = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                s.async = true;
                s.onload = function () { resolve(window.turnstile); };
                s.onerror = function () { loading = null; reject(new Error('No se pudo cargar Turnstile')); };
                document.head.appendChild(s);
            });
        }
        return loading;
    }

    // Pinta el widget en `container` (id o elemento). Devuelve { token(), reset() }.
    function mount(container) {
        var widgetId = null;
        if (!enabled()) {
            return { token: function () { return null; }, reset: function () {} };
        }
        load().then(function (ts) {
            var el = typeof container === 'string' ? document.getElementById(container) : container;
            if (!ts || !el) return;
            widgetId = ts.render(el, { sitekey: window.TURNSTILE_SITE_KEY, language: 'es', theme: 'light' });
        }).catch(function (e) { console.error('Turnstile:', e); });
        return {
            token: function () {
                return (window.turnstile && widgetId !== null) ? (window.turnstile.getResponse(widgetId) || null) : null;
            },
            // Los tokens son de un solo uso: resetear tras cada intento.
            reset: function () {
                if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
            }
        };
    }

    return { enabled: enabled, mount: mount };
})();
