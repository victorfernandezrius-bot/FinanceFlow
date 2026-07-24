// Registro y migración del Service Worker de FinanceFlow.
// Incluido por las 5 páginas: index, login, register, pricing y dashboard.
//
// Responsabilidad ESTRUCTURAL (no requiere autenticación):
//   1. Registrar /sw.js con scope '/'.
//   2. Si existe un registro antiguo con scope '/public/', preservar el endpoint
//      de su suscripción push en localStorage ('ff_old_push_endpoint').
//   3. NO desregistrar nada.
//
// La RESUSCRIPCIÓN y el desregistro del SW antiguo los completa el dashboard,
// en contexto autenticado (ver migratePushSubscription() en dashboard.html),
// porque solo allí hay token de sesión y clave VAPID.
(function () {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', function () {
        (async function () {
            try {
                // 1. Registrar el nuevo SW en la raíz (idempotente).
                await navigator.serviceWorker.register('/sw.js', { scope: '/' });

                // 2. Preservar el endpoint de la suscripción del SW antiguo (/public/),
                //    solo si aún no lo hemos guardado, para no pisarlo con null.
                if (!localStorage.getItem('ff_old_push_endpoint')) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    const oldReg = regs.find(function (r) {
                        return r.scope && r.scope.replace(/\/+$/, '').endsWith('/public');
                    });
                    if (oldReg) {
                        try {
                            const oldSub = await oldReg.pushManager.getSubscription();
                            if (oldSub && oldSub.endpoint) {
                                localStorage.setItem('ff_old_push_endpoint', oldSub.endpoint);
                            }
                        } catch (e) { /* sin acceso a la suscripción vieja: ignorar */ }
                    }
                }
                // 3. NO desregistrar: lo hace el dashboard tras resuscribir con éxito.
            } catch (e) {
                console.log('sw-register:', e);
            }
        })();
    });
})();
