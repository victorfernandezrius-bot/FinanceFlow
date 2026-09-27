# CLAUDE.md — FinanceFlow

SaaS de contabilidad personal (marca paraguas: Contabilidad Personal). Usuarios en España, UI en español, moneda por defecto EUR.
Las reglas generales (idioma, estilo de trabajo, seguridad) están en el CLAUDE.md global; aquí solo va lo específico de este repo.

## Arquitectura (la real, no la del README)
- **Frontend**: HTML + JS vanilla con ES modules, **sin build step**. Tailwind, Chart.js, SheetJS (xlsx), Stripe.js y SimpleWebAuthn se cargan por **CDN**. No introduzcas npm/bundler en el frontend sin preguntarme.
- **Backend**: un único Cloudflare Worker → `api/worker.js` (router manual con `if (path === '/api/...')`). Worker de producción: `financeflow`.
- **Datos**: Cloudflare **D1** (SQLite) binding `DB` + **KV** binding `CACHE` (rate limit, tokens GoCardless, retos WebAuthn, tokens de reset). **No hay Supabase.**
- **Auth**: JWT propio (HMAC, 30 días) + PBKDF2 para contraseñas, Google Sign-In y passkeys (WebAuthn). Token en `localStorage` → `financeflow_token`.
- **Pagos**: Stripe Checkout + Customer Portal + webhook (firma verificada e idempotencia vía tabla `stripe_events`).
- **Otros**: Resend (emails), GoCardless Bank Account Data (PSD2), Web Push (VAPID) con cron diario `0 8 * * *` → `scheduled()`.
- **PWA**: el service worker activo es el de la **raíz** `/sw.js`. `public/sw.js` es un duplicado antiguo y no se usa.

## Mapa de archivos
| Archivo | Qué es |
|---|---|
| `dashboard.html` | ~10.800 líneas. Markup + un `<script type="module">` (desde ~L2200) con `DashboardApp` (casi toda la UI), `ThemeManager` y `TutorialManager`. **Busca con grep por nombre de método; nunca lo leas entero.** |
| `js/accounting-manager.js` | Lógica contable: debe/haber, libro diario, libro mayor, balance, cuenta de resultados, 50/30/20 (autocontrol), escenarios. |
| `js/auth.js` | Sesión, `isPremium()` (es un **método**, no un booleano), `getPlanLimits()` (límites FREE/PREMIUM), cuenta demo. |
| `src/services/data-client.js` | Capa de datos única. `DATA_MODE='local'` → localStorage / `'remote'` → Worker+D1. **No cambies las claves de localStorage** (hay usuarios que dependen de ellas). |
| `js/stripe-checkout.js` | Cliente Stripe y price IDs. |
| `public/config.js` | Configuración runtime (URLs, entorno, claves públicas). Detecta staging por el hostname. |
| `api/worker.js` | Toda la API, el webhook de Stripe, GoCardless, push y el cron. |
| `db/schema.sql` | Schema D1 (idempotente, `CREATE ... IF NOT EXISTS`). |

## Entornos
- **Producción**: frontend en Cloudflare Pages `financeflow-7nd.pages.dev` y API en `financeflow.victor-a97.workers.dev/api` (orígenes distintos → ver trampa 7).
- **Staging**: `wrangler deploy --env staging` publica el frontend y la API en el mismo origen (`financeflow-staging...workers.dev`), con su propia D1 y KV. Se usa para probar passkeys y cualquier cambio arriesgado.
- **Local**: `npm run dev` (wrangler dev) con los secrets en `.dev.vars`.

## Comandos
```bash
npm run dev                              # Worker en local (localhost:8787)
npx wrangler deploy --env staging        # staging (frontend + API)
npm run deploy:worker                    # API de producción  ⚠️ pedir confirmación
npm run deploy:pages                     # frontend de producción  ⚠️ pedir confirmación (ver trampas)
npm run db:schema                        # aplica el schema a D1 REMOTA  ⚠️ pedir confirmación
npm run tail                             # logs del Worker en vivo
```
No hay tests automáticos. Para verificar: `node --check api/worker.js` como mínimo y, después, una prueba manual en staging. Di siempre qué has probado y qué no.

## Reglas de este proyecto
- **Todo endpoint nuevo** debe usar `getAuthUser()` y filtrar **siempre** por `user_id` en SQL (`WHERE id=? AND user_id=?`). Usa solo consultas con `.bind()`; nunca concatenes strings en SQL.
- **Endpoint nuevo = 3 sitios**: la ruta en `worker.js`, el método en `data-client.js` (en sus dos modos, local y remote) y la llamada desde la UI.
- **Tabla nueva**: añádela a `db/schema.sql` con `IF NOT EXISTS` y también al borrado en cascada de la cuenta de usuario (`DELETE ... WHERE user_id=?` en el `batch` de `worker.js`, ~L745).
- **Cambios en precios de Stripe**: los price IDs están duplicados en `js/stripe-checkout.js` y en `api/worker.js` (create-checkout). Cambia ambos a la vez.
- **Lógica premium**: comprueba con `Auth.isPremium()` en el cliente, pero la fuente de verdad es el campo `plan` del usuario en D1, que actualiza el webhook de Stripe. Nunca des acceso premium solo desde el frontend.
- **Si cambias archivos que cachea el service worker**, sube `CACHE_NAME` en `/sw.js` (ahora `financeflow-v3`).
- **Contabilidad**: cada movimiento debe cuadrar (debe = haber). Si tocas cálculos de saldos, balance o 50/30/20, explícame el impacto con un ejemplo numérico.
- **Dark mode**: usa variables CSS (`var(--border-color)`, etc.) y no colores fijos.
- **Secrets del Worker** (solo con `wrangler secret put`): `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY`, `VAPID_PRIVATE_KEY`. Las claves públicas (Stripe `pk_`, VAPID pública, Google Client ID) sí pueden ir en `config.js` / `wrangler.toml`.

## Trampas conocidas (léelas antes de actuar)
1. **El README está desactualizado**: habla de `cp-api`, `app.contabilidadpersonal.com`, `plan-limits.js` / `plan-config.js` (no existen) y dice que falta `dashboard.html`. Fíate del código, no del README.
2. **NO copies `public/config.production.js` sobre `config.js`** aunque lo diga el README: tiene una `pk_live` de ejemplo y URLs antiguas, y rompería producción.
3. `deploy:pages` apunta al proyecto `cp-app`, pero producción es `financeflow-7nd`. Verifica el nombre real antes de desplegar.
4. `deploy:pages` sube la carpeta entera (`.`). Comprueba que `api/`, `db/`, `wrangler.toml` y `README.md` no quedan públicos en la web.
5. `.dev.vars.example` no incluye `RESEND_API_KEY` ni `VAPID_PRIVATE_KEY`.
6. La cuenta demo (`auth.js`) solo se desactiva si `APP_ENV === 'production'`; en staging y en local sí existe.
7. **CORS vs URLs**: `corsHeaders()` solo acepta `APP_URL` (`app.contabilidadpersonal.com` en `wrangler.toml`) o `*.contabilidadpersonal.com`, pero `config.js` define `APP_URL = financeflow-7nd.pages.dev`. Si aparecen errores de CORS o de redirecciones (Stripe, GoCardless, emails de reset), el origen es este. Hay que unificar el dominio.
