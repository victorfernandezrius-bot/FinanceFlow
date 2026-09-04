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
        window.APP_URL = 'https://financeflow-7nd.pages.dev';
        window.API_URL = 'https://financeflow.victor-a97.workers.dev/api';
        window.APP_ENV = 'production';
    }
})();
window.DATA_MODE = 'remote';
window.BANK_SIMULATOR_ENABLED = false;
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
