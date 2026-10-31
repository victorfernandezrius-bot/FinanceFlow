// FinanceFlow Runtime Configuration
window.STRIPE_PUBLISHABLE_KEY = 'pk_live_51PhqUIRr7a5Py1C0O4KbbPtgPyrWs1kcoxLh9Cl5vfnWgqpNbgWvMDiVEOuQA1gYxzojqpZhaGdVIJkdX0lhsKYT00KKJ4yP0r';
// Origen dinámico: en staging (host con "staging" o *.workers.dev) la app y la API
// viven en el MISMO origen, para que rpID de WebAuthn coincida. En producción, valores fijos.
(function () {
    var host = (typeof location !== 'undefined' && location.hostname) || '';
    if (/staging/.test(host) || /\.workers\.dev$/.test(host)) {
        window.APP_URL = location.origin;
        window.API_URL = location.origin + '/api';
        window.APP_ENV = 'staging';
    } else {
        window.APP_URL = 'https://app.contabilidadpersonal.com';
        window.API_URL = 'https://financeflow.victor-a97.workers.dev/api';
        window.APP_ENV = 'production';
    }
    // Dominio canónico: app.contabilidadpersonal.com. La API solo acepta peticiones de
    // *.contabilidadpersonal.com (CORS), así que por el dominio por defecto de Pages no se
    // puede entrar: quien llegue a él va a la misma página en el dominio bueno. Solo ese host
    // exacto; las vistas previas de Pages (<rama>.financeflow-7nd.pages.dev) no se tocan.
    if (host === 'financeflow-7nd.pages.dev') {
        location.replace(window.APP_URL + location.pathname + location.search + location.hash);
    }
})();
window.DATA_MODE = 'remote';
window.BANK_SIMULATOR_ENABLED = false;
// Cloudflare Turnstile (anti-bots en login/registro/recuperación). Clave PÚBLICA del
// widget (site key). Vacía = desactivado. El servidor solo lo exige si existe el
// secreto TURNSTILE_SECRET_KEY: configura primero esta clave y después el secreto.
window.TURNSTILE_SITE_KEY = '0x4AAAAAAFuJKD3L2fV8TGxl';
// Clave pública VAPID para Web Push (misma que en wrangler.toml [vars])
window.VAPID_PUBLIC_KEY = 'BP6sAnJPgQWmT4963pl7rWZBLt55TP3NX1m0VKc_jf9rDI8tfOhmYuOT8CmAZsxxJHTO2jHuYh31sS3hVzihFUc';

window.APP_CONFIG = {
    brandName: 'FinanceFlow',
    parentBrand: 'Contabilidad Personal',
    parentUrl: 'https://www.contabilidadpersonal.com',
    helpUrl: 'https://www.contabilidadpersonal.com/category/financeflow/',
    privacyUrl: 'https://www.contabilidadpersonal.com/politica-de-privacidad/',
    termsUrl: 'https://www.contabilidadpersonal.com/terminos-y-condiciones/',
    supportEmail: 'clientes@contabilidadpersonal.com'
};
