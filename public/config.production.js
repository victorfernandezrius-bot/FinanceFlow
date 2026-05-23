// FinanceFlow Runtime Configuration — PRODUCCIÓN
// Renombrar a config.js al desplegar, o configurar el build para sustituirlo.
window.STRIPE_PUBLISHABLE_KEY = 'pk_live_PEGA_AQUI_TU_CLAVE_PUBLICA_LIVE';
window.APP_URL = 'https://app.contabilidadpersonal.com';
window.API_URL = 'https://app.contabilidadpersonal.com/api';
window.DATA_MODE = 'remote';        // usa el Worker + D1 (no localStorage)
window.APP_ENV = 'production';      // desactiva la cuenta demo
window.BANK_SIMULATOR_ENABLED = false;

window.APP_CONFIG = {
    brandName: 'FinanceFlow',
    parentBrand: 'Contabilidad Personal',
    parentUrl: 'https://www.contabilidadpersonal.com',
    helpUrl: 'https://www.contabilidadpersonal.com/category/financeflow/',
    privacyUrl: 'https://www.contabilidadpersonal.com/politica-de-privacidad/',
    termsUrl: 'https://www.contabilidadpersonal.com/terminos-y-condiciones/',
    supportEmail: 'soporte@contabilidadpersonal.com'
};
