// Cloudflare Turnstile (anti-bots) para login, registro y recuperación de contraseña.
// Desactivado mientras window.TURNSTILE_SITE_KEY (public/config.js) esté vacío: en
// ese caso mount() no pinta nada y token() devuelve null, y el servidor no lo exige
// mientras no exista el secreto TURNSTILE_SECRET_KEY.
// Quien protege es el servidor (siteverify con el secreto): aquí solo se evita enviar
// el formulario antes de completar el reto. Si el widget no puede funcionar (no carga,
// sitekey o dominio no autorizados, error de Turnstile), NO se bloquea el formulario:
// lo decide el servidor, así un fallo de configuración nunca deja a nadie sin entrar
// mientras el secreto no esté puesto.
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

    // Pinta el widget en `container` (id o elemento). Devuelve { token(), reset(), mustWait() }.
    function mount(container) {
        var widgetId = null;
        var failed = false;   // el widget no puede dar token: no bloquear el formulario
        if (!enabled()) {
            return { token: function () { return null; }, reset: function () {}, mustWait: function () { return false; } };
        }
        // Si en 10 s no se ha podido pintar (script bloqueado sin error, red lenta…), no bloquear
        var timer = setTimeout(function () { if (widgetId === null) failed = true; }, 10000);
        load().then(function (ts) {
            var el = typeof container === 'string' ? document.getElementById(container) : container;
            if (!ts || !el) { failed = true; return; }
            widgetId = ts.render(el, {
                sitekey: window.TURNSTILE_SITE_KEY, language: 'es', theme: 'light',
                // Sitekey o dominio no autorizados, error de red, reto fallido…
                'error-callback': function (code) { failed = true; console.error('Turnstile error:', code); return true; }
            });
            clearTimeout(timer);
        }).catch(function (e) { failed = true; console.error('Turnstile:', e); });

        function token() {
            return (window.turnstile && widgetId !== null) ? (window.turnstile.getResponse(widgetId) || null) : null;
        }
        return {
            token: token,
            // Los tokens son de un solo uso: resetear tras cada intento.
            reset: function () {
                if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
            },
            // true = el widget funciona pero el usuario aún no ha completado el reto
            mustWait: function () { return !failed && !token(); }
        };
    }

    return { enabled: enabled, mount: mount };
})();
