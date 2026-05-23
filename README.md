# SaaS FinanceFlow — Contabilidad Personal

App de contabilidad personal lista para desplegar en **Cloudflare Pages + Workers + D1 + KV**.
Incluye autenticación, gestión contable (debe/haber, balance, libro mayor), plan 50/30/20,
reglas de categorización, suscripciones con **Stripe** y conexión bancaria real con **GoCardless** (PSD2).

---

## ✅ Estado de la infraestructura (ya creada en tu Cloudflare)

| Recurso | Nombre | ID | Estado |
|---|---|---|---|
| Base de datos D1 | `cp-db` | `74410e1d-4bd3-40ec-af72-528ad92fd3a1` | ✅ creada + schema aplicado (12 tablas) |
| KV namespace | `cp-cache` | `e85a2416b563411189118400f714b0ab` | ✅ creado |
| Worker | `cp-api` | (se crea al hacer deploy) | ⏳ pendiente deploy |
| Pages | `cp-app` | (se crea al hacer deploy) | ⏳ pendiente deploy |

El `wrangler.toml` ya tiene esos IDs rellenados. No tienes que tocarlos.

---

## 📂 Estructura del proyecto

```
saas-financeflow/
├── api/
│   └── worker.js              # Backend completo (auth, datos, Stripe, GoCardless)
├── js/
│   ├── auth.js                # Sistema de autenticación (CORREGIDO)
│   ├── accounting-manager.js  # Lógica contable con caché síncrona (CORREGIDO)
│   ├── plan-limits.js         # PlanLimitsManager (validación de límites)
│   ├── plan-config.js         # Configuración estática de planes FREE/PREMIUM
│   └── stripe-checkout.js     # Cliente Stripe (price IDs reales)
├── src/services/
│   └── data-client.js         # Capa de datos unificada local/remote (CORREGIDO)
├── public/
│   ├── config.js              # Config runtime DESARROLLO (localStorage)
│   ├── config.production.js   # Config runtime PRODUCCIÓN (D1) ← usar en deploy
│   ├── manifest.json          # PWA manifest
│   └── logo.png               # Icono base
├── db/
│   └── schema.sql             # Schema de la base de datos (ya aplicado)
├── login.html, register.html, pricing.html, offline.html
├── wrangler.toml              # Config Cloudflare (IDs ya rellenados)
├── package.json
├── _routes.json               # Rutas función vs estáticas
└── .dev.vars.example          # Plantilla de secrets para desarrollo local

✅ dashboard.html — incluido y adaptado a la nueva arquitectura:
   - Carga config.js primero, imports a rutas nuevas
   - Datos de negocio (cuentas, movimientos, reglas, autocontrol, escenarios,
     conexiones bancarias) van por DataClient → D1 en modo remoto
   - Solo quedan en localStorage las preferencias de cliente (sesión, tema,
     perfil UI, tutorial visto), que es lo correcto
```

---

## 🔑 PASO 1 — Configurar los secrets (TÚ, con tus claves)

Desde la carpeta del proyecto, con Wrangler instalado y autenticado
(`npm install && npx wrangler login`):

```bash
# Genera un JWT secret aleatorio (o usa el tuyo)
npx wrangler secret put JWT_SECRET
# (pega una cadena larga aleatoria, ej: el resultado de `openssl rand -hex 32`)

# Stripe (modo LIVE para cobrar de verdad)
npx wrangler secret put STRIPE_SECRET_KEY
# (pega tu sk_live_...)

npx wrangler secret put STRIPE_WEBHOOK_SECRET
# (pega el whsec_... del webhook en modo live — ver PASO 4)

# GoCardless (Bank Account Data)
npx wrangler secret put GOCARDLESS_SECRET_ID
# (pega tu secret_id)

npx wrangler secret put GOCARDLESS_SECRET_KEY
# (pega tu secret_key)
```

Estos secrets se guardan cifrados en Cloudflare. **Nunca van en el código ni en git.**

---

## 🚀 PASO 2 — Desplegar el Worker (API)

```bash
npm run deploy:worker
```

Esto publica `cp-api`. Anota la URL que te da (algo como
`https://cp-api.<tu-subdominio>.workers.dev`).

---

## 🌐 PASO 3 — Desplegar el frontend (Pages) y conectar dominio

1. Antes de desplegar, activa la config de producción:
   ```bash
   cp public/config.production.js public/config.js
   ```
   Y pega tu `pk_live_...` de Stripe en ese archivo (la clave pública es segura en frontend).

2. Despliega:
   ```bash
   npm run deploy:pages
   ```

3. En el panel de Cloudflare → Pages → cp-app → Custom domains, añade
   `app.contabilidadpersonal.com`. Cloudflare te guía con el registro DNS (CNAME).

4. Enruta el `/api/*` al Worker: en Workers Routes (o en el propio Pages con
   Functions), asocia `app.contabilidadpersonal.com/api/*` → `cp-api`.

---

## 💳 PASO 4 — Webhook de Stripe (modo live)

1. En el dashboard de Stripe (modo Live) → Developers → Webhooks → Add endpoint.
2. URL: `https://app.contabilidadpersonal.com/api/stripe/webhook`
3. Eventos a escuchar: `checkout.session.completed`, `customer.subscription.deleted`.
4. Copia el "Signing secret" (`whsec_...`) y configúralo:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
5. IMPORTANTE: crea tus productos/precios en modo **Live** de Stripe. Los price IDs
   actuales del código (`price_1SjKSQ...`, `price_1SjKUP...`) deben existir en modo live;
   si los creaste en test, genera los equivalentes en live y actualízalos en
   `js/stripe-checkout.js` y en `api/worker.js` (función create-checkout).

---

## 🏦 PASO 5 — GoCardless

Las credenciales (secret_id / secret_key) ya las configuraste en el PASO 1.
El Worker gestiona el token de acceso automáticamente (cacheado en KV 23h).

Flujo de conexión bancaria (ya implementado en el Worker):
1. `POST /api/banking/institutions` → lista de bancos del país (ES)
2. `POST /api/banking/requisition` → crea la solicitud, devuelve un `link`
3. Rediriges al usuario a ese `link` → autoriza en su banco
4. Vuelve a `app.contabilidadpersonal.com/dashboard.html?bank=connected`
5. `GET /api/banking/accounts?requisition_id=...` → cuentas autorizadas
6. `POST /api/banking/sync` → importa transacciones

---

## 🔄 Modo local vs remoto (IMPORTANTE)

La app tiene dos modos controlados por `window.DATA_MODE` en `public/config.js`:

- **`'local'`** (por defecto en config.js de desarrollo): los datos se guardan en
  localStorage del navegador. Útil para probar la UI sin backend.
- **`'remote'`** (en config.production.js): los datos van al Worker + D1, y la
  autenticación usa el JWT real del Worker. **Este es el modo de producción.**

En modo remoto:
- El registro/login van contra `/api/auth/register` y `/api/auth/login` del Worker.
- El token JWT se guarda y se envía automáticamente en cada petición (Authorization Bearer).
- Todos los datos del usuario viven en D1, sincronizados entre dispositivos.

Para producción, asegúrate de que `public/config.js` tenga `window.DATA_MODE = 'remote'`
(el config.production.js ya lo trae).

## 🧪 Desarrollo local

```bash
cp .dev.vars.example .dev.vars   # rellena tus claves de TEST aquí
npm run dev                       # arranca en localhost:8787
```

En local, `public/config.js` usa `DATA_MODE` por defecto (localStorage), así que
puedes probar la UI sin backend. Para probar contra D1 local, pon
`window.DATA_MODE = 'remote'` y usa `wrangler dev`.

---

## 🔧 Comandos útiles

```bash
npm run db:schema      # re-aplica el schema a D1 (idempotente)
npm run tail           # ver logs del Worker en vivo
npx wrangler d1 execute cp-db --remote --command "SELECT COUNT(*) FROM users;"
```

---

## ⚠️ Notas importantes

- **dashboard.html falta**: cópialo de tu sandbox antes de desplegar.
- **Cuenta demo**: en producción (`APP_ENV='production'`) la cuenta demo se desactiva sola.
- **Contraseñas**: en el Worker se hashean con PBKDF2 (100k iteraciones). El `btoa`
  del frontend (modo localStorage) era solo para la demo local.
- **Stripe price IDs**: verifica que existan en modo LIVE antes de cobrar.
