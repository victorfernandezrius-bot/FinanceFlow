# SECURITY_AUDIT.md — FinanceFlow

- **Fecha:** 2026-10-20
- **Alcance:** rama `main` en `0b36fc1` (lo que está en producción). No se ha tocado `staging` ni las ramas feature.
- **Método:** lectura completa de `api/worker.js` (1.534 líneas); revisión dirigida (grep + lectura de cada sitio) de `dashboard.html`, `js/auth.js`, `src/services/data-client.js`, `js/stripe-checkout.js`, `login.html`, `register.html`, `reset-password.html`, `sw.js` y `public/*`; `gitleaks v8.30.1` sobre **todo** el historial (184 commits de todas las ramas, tras des-shallow del clon) más búsqueda de patrones propia; `npm audit` con un lockfile generado aparte (el repo no tiene `package-lock.json`).
- **Límite de la verificación:** el entorno de auditoría no tiene salida a `*.pages.dev`, `*.workers.dev`, `contabilidadpersonal.com` ni a los CDN, así que **las cabeceras y el HSTS en vivo no se han podido comprobar**: lo dicho sobre ellos sale del código.
- **Aviso:** el repositorio es público. Este informe da evidencia (archivo:línea) pero no recetas de explotación. Los commits de corrección también revelan qué estaba mal, así que conviene **desplegar el Worker cuanto antes** después de cada push.

Leyenda de estado: **OK** (correcto, no se toca) · **PARCIAL** (falta una parte) · **FALTA**.
Severidad: Crítica · Alta · Media · Baja · Info.

---

## 1. Resumen de los 20 puntos

| # | Punto | Estado inicial | Severidad | Se corrige en |
|---|---|---|---|---|
| 1 | API keys ocultas | OK | Info | — |
| 2 | Secretos fuera de Git (historial completo) | OK | Info | — |
| 3 | Sin claves privadas en el frontend | OK | Info | — |
| 4 | Aislamiento por usuario / IDOR | PARCIAL | Alta | Fase 2 |
| 5 | Cifrado de datos sensibles | OK | Baja | — |
| 6 | Autenticación obligatoria | OK | Info | — |
| 7 | Acceso a registros solo del dueño | PARCIAL | Alta | Fase 2 |
| 8 | Mass assignment | OK (allowlist implícita) | Info | — |
| 9 | Sesiones / tokens | PARCIAL | Media | Fase 3 |
| 10 | Hashing de contraseñas | OK | Info | — |
| 11 | Rate limiting | PARCIAL | Media | Fase 3 |
| 12 | Anti-bots | FALTA | Media | Fase 3 |
| 13 | Queries parametrizadas | OK | Info | — |
| 14 | Validación de inputs | FALTA | Media | Fase 3 |
| 15 | XSS | PARCIAL | Media | Fase 3 |
| 16 | Subida / importación de archivos | PARCIAL | Media | Fase 4 |
| 17 | Respuestas mínimas y errores | PARCIAL | Baja | Fase 3 |
| 18 | Security headers | FALTA | Media | Fase 3 |
| 19 | HTTPS / HSTS | PARCIAL | Baja | Fase 3 + pasos manuales |
| 20 | Dependencias y scripts de CDN | PARCIAL | Media | Fase 4 |

---

## 2. Hipótesis del brief

| | Hipótesis | Resultado | Evidencia |
|---|---|---|---|
| a | `PUT /api/users/:id` permite cambiar `plan` y `plan_expires_at` | **REFUTADA** | `api/worker.js:722-742`: solo escribe `name` y `currency` (esta última contra lista cerrada). |
| b | `/api/auth/register` acepta `plan:'premium'` | **REFUTADA** | `api/worker.js:412-415` fuerza `plan='free'`. El cliente sigue enviando `plan` (`js/auth.js:86,95`) pero el servidor lo ignora. |
| c | `/api/premium-trial` acepta `expiry` del cliente | **REFUTADA** | `api/worker.js:946-948`: el `POST` devuelve 410. |
| d | `verify-session` no valida que la sesión sea del usuario; el frontend activa Premium con `?success=true` | **CONFIRMADA (con matices)** | `api/worker.js:1208-1217` no compara `client_reference_id` con el usuario y además interpola `session_id` en la URL sin validar. En cliente: `dashboard.html:2359-2365` ("Opción B") pone `plan:'premium'` en localStorage si `verify-session` dice `paid`, aunque D1 no lo refleje. `register.html:588-597`, `673-679` y `753-778` marcan `isPremium/premium` con `?success=true` sin verificación, pero **ningún código lee esos campos** (efecto nulo). Todo es Premium solo de cliente: el único control Premium en servidor (`/api/push/subscribe`, `api/worker.js:975`) lee D1. |
| e | `/api/banking/sync` y `/requisition` no validan propiedad | **CONFIRMADA** | `api/worker.js:1249-1264`: `/accounts` y `/sync` aceptan cualquier ID y lo interpolan sin codificar en la URL de GoCardless (permite salir del recurso previsto). Usan el token de la app, así que no hay aislamiento entre usuarios. `/requisition` crea una nueva (no requiere propiedad) pero no valida `institution_id`. Además `POST /api/bank-connections` hace upsert **sin** `WHERE user_id` (`api/worker.js:1066-1075`). La UI no llama a `/api/banking/*` (no aparece en `dashboard.html` ni `js/`). |
| f | Firma de Stripe sin tiempo constante ni tolerancia | **REFUTADA** | `api/worker.js:1400-1404`: hay comparación constante y tolerancia de 5 min. **Pero** solo se lee **una** firma `v1` (`Object.fromEntries` en `:1393` se queda con la última), así que falla al rotar el secreto del webhook. → PARCIAL. |
| g | Cambio de contraseña simulado en cliente | **CONFIRMADA, pero es código muerto** | `dashboard.html:9985-10042` lo simula en localStorage, pero `showChangePasswordModal()` no se llama desde ningún sitio (`dashboard.html:9771` es solo un comentario; el modal de ajustes `:9692-9758` no tiene el botón). No existe endpoint en servidor. La recuperación por email sí es real (`api/worker.js:601-636`). |

---

## 3. Detalle por punto

### 1 · API keys ocultas — OK
- Secretos solo vía `env` (wrangler secret): Stripe `api/worker.js:1133,1155,1212`; GoCardless `:1381`; Resend `:1418`; VAPID privada `:166`; JWT `:422,444`.
- `wrangler.toml` y `public/config.js` solo llevan valores públicos (Google Client ID, VAPID pública, `pk_live`).

### 2 · Secretos fuera de Git — OK
- `gitleaks` (todas las ramas, 184 commits): 1 hallazgo, la **clave publicable** de Stripe (`pk_live…`) en `public/config.js:2` (commit `6a214a49`). Es pública por diseño: falso positivo.
- Búsqueda propia de `sk_live/sk_test/rk_live/whsec_/re_…/PRIVATE KEY/VAPID_PRIVATE_KEY/secret_id/AKIA/ghp_/JWT`: 0 resultados reales (el único `JWT_SECRET` con valor es el placeholder de `.dev.vars.example`).
- Nunca se ha versionado `.dev.vars`, `.env`, `.pem` ni similar. `.gitignore` los cubre.
- **No hace falta rotar nada** por el historial.

### 3 · Sin claves privadas en frontend — OK
- `public/config.js`: `pk_live` (publicable), VAPID pública y URLs. Nada más.

### 4 · Aislamiento por usuario (IDOR) — PARCIAL · Alta
Correcto (no se toca): todas las tablas de datos filtran por `user_id` del token y no del cliente: accounts `:766,791`, movements `:800,826`, rules `:835,868,882`, autocontrol `:891,908`, scenarios `:925,930`, notifications `:955,960`, push `:995,1008`, import-info `:1092`, bank-connections GET/DELETE `:1061,1082`. Los upserts de accounts, movements y rules llevan `WHERE <tabla>.user_id = excluded.user_id` (`:781,815,858`). WebAuthn: el reto de registro va ligado al usuario (`:662,672`); el login busca la credencial por `credential_id` y la verifica criptográficamente (`:478-502`). Recuperación de contraseña: token aleatorio de un solo uso en KV, 1 h (`:614-615,629-634`).

Falta:
- `/api/banking/accounts` y `/api/banking/sync` sin comprobar propiedad y con IDs sin validar (ver hipótesis e). Si GoCardless está configurado en producción, la severidad es **Crítica** (datos bancarios PSD2).
- `POST /api/bank-connections`: upsert sin `WHERE user_id` (`:1070-1071`).
- `verify-session` no comprueba que la sesión de Stripe sea del usuario (`:1208-1217`).
- Menores: `push/subscribe` reasigna un endpoint existente a otro usuario (`:987-988`; exige conocer la URL del endpoint, Baja). Las reglas por defecto usan IDs fijos y globales (`js/accounting-manager.js:1161-1211`) que chocan entre usuarios en la PK de D1 (ver A6).

### 5 · Cifrado de datos sensibles — OK · Baja
- En tránsito: todo HTTPS. En reposo: D1 y KV van cifrados por Cloudflare.
- Contraseñas con PBKDF2 (punto 10). Tokens de reset aleatorios y con TTL.
- No hay cifrado a nivel de aplicación de los movimientos. No lo recomiendo ahora: la clave viviría en la misma cuenta de Cloudflare y el beneficio es bajo. Lo dejo como decisión tuya (dudosos).

### 6 · Autenticación obligatoria — OK
- Públicos solo: health, register, login, webauthn login-options/verify, google, session, logout, forgot, reset y el webhook (este va con firma). El resto comprueba `uid`/`authUser` (`api/worker.js:638-639` y en cada bloque).

### 7 · Acceso a registros solo del dueño — PARCIAL · Alta
- Mismos hallazgos que el punto 4. `/api/users/:id` sí compara `authUser.id` con el id de la URL (`:720`).

### 8 · Mass assignment — OK (allowlist implícita)
- El servidor nunca hace `INSERT/UPDATE` con el objeto del cliente: enlaza campo a campo. `plan`, `plan_expires_at`, `stripe_*`, `premium_trial_expires_at`, `google_sub`, `password_hash` no son escribibles desde el cliente (`:722-739`, `:412-420`, `:946-948`).
- **No** se implementa "rechazar campos desconocidos" con 400: los clientes actuales envían objetos completos (`saveUser` manda el usuario entero, `src/services/data-client.js:79-84`; cuentas y movimientos llevan campos extra como `userId` o `auto_imported`). Rechazarlos rompería el perfil, las cuentas y la importación. Se ignoran, que es lo compatible (ver dudosos).

### 9 · Sesiones / tokens — PARCIAL · Media
- JWT HS256 propio, 30 días (`:422,444,514,586`), sin `jti`, sin revocación; `logout` no hace nada en servidor (`:598-600`). Además el cliente borra el token **antes** de llamar a logout (`src/services/data-client.js:132-142`), así que ni siquiera lo envía.
- Correcto: firma verificada con `crypto.subtle.verify` (constante) y `exp` comprobado (`:62-76`); el algoritmo no se lee de la cabecera (no hay confusión de `alg`).
- El reset de contraseña no invalida las sesiones abiertas (`:625-636`).
- Token en `localStorage` (`financeflow_token`): un XSS puede robarlo (ver 15). La migración a cookie HttpOnly se evalúa en la Fase 3.

### 10 · Hashing — OK
- PBKDF2-HMAC-SHA256, 100.000 iteraciones, sal aleatoria de 16 bytes (`:79-91`); comparación en tiempo constante (`:95-108`).
- **Límite de Workers:** WebCrypto en Cloudflare Workers no admite más de **100.000** iteraciones de PBKDF2 (lanza `NotSupportedError`). OWASP recomienda 600.000 para PBKDF2-SHA256, pero aquí 100.000 es el máximo posible. Todas las contraseñas ya están en ese máximo, así que **no hay nada a lo que hacer rehash**: el "rehash progresivo" no aplica hoy. No se cambia el algoritmo.
- Nota menor: si el email no existe, el login responde sin calcular el hash (`:441`), lo que permite enumerar emails por tiempo. No añade nada, porque `/register` ya devuelve 409 "Email ya registrado" (`:407`).

### 11 · Rate limiting — PARCIAL · Media
- Existe (KV, `:143-154`): login por IP 10/15 min (`:435-437`), login con passkey por IP (`:465-467`), forgot por email 3/h y por IP 10/h (`:606-610`), registro de passkey por usuario (`:668`), push test (`:1024`).
- Falta: register, login por email (con backoff), Google, `webauthn/login-options` (escribe en KV en cada llamada), reset-password, banking, verify-session, create-checkout.
- El limitador abre en caso de fallo de KV (`:149-153`), una decisión razonable. Ojo: en el plan Free de Workers, KV permite 1.000 escrituras al día.

### 12 · Anti-bots — FALTA · Media
- Ni Turnstile ni CAPTCHA en register, login ni forgot.

### 13 · Queries parametrizadas — OK
- Todas las consultas usan `prepare(...).bind(...)` con `?`. No hay ninguna con interpolación ni concatenación (comprobado con grep sobre `prepare(`).

### 14 · Validación de inputs — FALTA · Media
- Solo existe: longitud de contraseña ≥ 8 (`:403,627`), lista cerrada de divisas (`:731-736`) y forma de la suscripción push (`:978`).
- Falta: tipos, longitudes, enums (`tipo` de cuenta/movimiento), rangos numéricos (`cantidad`), formato de fecha y de email, límite de tamaño del body, formato de IDs externos (Stripe y GoCardless).

### 15 · XSS — PARCIAL · Media (impacto alto: robo del token)
- Correcto: existe `_escapeHtml` (`dashboard.html:2955-2959`) y se usa en la previsualización de importación (`:3078-3091`), en selectores (`:2951`) y en exportación (`:3487-3489`). El nombre de la cabecera usa `textContent` (`:2853-2859`).
- Falta: unas 100 interpolaciones de datos de usuario sin escapar dentro de `innerHTML`. Por ejemplo: descripciones de movimientos `:6356,6638,6755,7064,7226`, nombres de cuenta `:6517,7361,7403-7509`, reglas `:3755-3769`, escenarios `:4289-4294`, notificaciones `:5047-5053,5138-5139` y perfil `:9413,9449`.
- Vector externo realista: la **descripción de un movimiento importado** de un extracto (CSV/Excel/PDF) se guarda tal cual y después se pinta sin escapar. Los toasts (`:8693-8740,9658-9690`) también pintan con `innerHTML`.
- Emails: el `name` del registro se inserta sin escapar en el HTML del email de bienvenida (`api/worker.js:1454`), y ese email se envía a la dirección que diga el que se registra (A4).

### 16 · Subida / importación — PARCIAL · Media
- Todo el parseo es en cliente (`dashboard.html:3025-3378`). La extensión se filtra solo con `accept` (`:1067`). No hay límite de tamaño, filas ni páginas.
- `pdf.js 3.11.174` se usa con `isEvalSupported` por defecto (`:3322`). Esa versión está afectada por **CVE-2024-4367** (ejecución de JS con un PDF malicioso; la mitigación oficial es `isEvalSupported:false` o actualizar a 4.2.67+).
- `SheetJS 0.18.5` (`:40`) está afectado por **CVE-2023-30533** (prototype pollution al leer un archivo manipulado; corregido en 0.19.3) y **CVE-2024-22363** (ReDoS; corregido en 0.20.2). Las versiones corregidas solo se publican en `cdn.sheetjs.com`.
- Correcto: la previsualización escapa los datos (`:3089-3091`).

### 17 · Respuestas mínimas y errores — PARCIAL · Baja
- Correcto: el `catch` global devuelve un 500 genérico sin `err.message` (`:1269-1273`). No se devuelve `password_hash`.
- Falta: identificador de petición en los 500. Se filtran detalles internos en `:687` (`e.message` de WebAuthn), `:1139,1161` (mensaje de Stripe) y `/api/banking/*` (respuesta cruda de GoCardless). Se usa `SELECT *` hacia el cliente en usuarios (`:137,439,510,541,545`), accounts `:766`, movements `:800`, notifications `:955`, bank_connections `:1061` e import_info `:1092`.

### 18 · Security headers — FALTA · Media
- No existe el archivo `_headers` (Pages). El Worker solo envía `Content-Type` y CORS (`:30-47`). No hay CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` ni protección anti-framing.

### 19 · HTTPS / HSTS — PARCIAL · Baja
- Todas las URLs del código son `https`. `*.pages.dev` y `*.workers.dev` están en la lista de precarga HSTS (todo el TLD `.dev` lo está).
- Falta la cabecera HSTS explícita. Si se usa un dominio propio (`contabilidadpersonal.com`), hay que activar en el panel Always Use HTTPS, TLS ≥ 1.2 y HSTS (pasos manuales).

### 20 · Dependencias y CDN — PARCIAL · Media
- Runtime del Worker: `npm audit --omit=dev` → **0 vulnerabilidades** (`@simplewebauthn/server 13.3.3`, `@block65/webcrypto-web-push 0.3.2`).
- Dev: `wrangler 3.x` arrastra 7 avisos (5 altos: `sharp`, `ws`, `undici`; 2 moderados: `esbuild`). Solo afectan a la herramienta local; se arreglan con `wrangler 4` (cambio mayor, dudoso).
- No hay `package-lock.json`, CI, Dependabot ni SRI.
- Scripts sin versión fija: `chart.js` sin versión (siempre la última, `dashboard.html:39`) y `@simplewebauthn/browser@13` (rango mayor, `dashboard.html:23`, `login.html:19`). Tailwind Play CDN (`cdn.tailwindcss.com`) no admite SRI y Tailwind no lo recomienda en producción. Stripe.js y Google GSI no deben llevar SRI (lo indican ellos).
- `pdf.js` y `xlsx` desactualizados (punto 16).

---

## 4. Hallazgos adicionales (fuera de los 20 puntos)

| Id | Hallazgo | Severidad | Evidencia | Acción |
|---|---|---|---|---|
| A1 | **Pagos: los suscriptores mensuales pierden Premium en la UI a los 30 días.** El webhook fija `plan_expires_at = hoy + 30/365` (`api/worker.js:1182-1187`) y ninguna renovación lo actualiza. El cliente degrada a `free` si `plan_expires_at` ya pasó (`js/auth.js:330-339`) y además nunca refresca el plan desde el servidor (`dashboard.html:2282-2316`), así que tampoco ve las cancelaciones. En servidor siguen como `premium` hasta `customer.subscription.deleted`. | Alta (negocio) | ver líneas | Fase 2: el servidor pasa a ser la fuente de verdad en el cliente |
| A2 | **Borrar la cuenta no cancela la suscripción de Stripe** (sigue cobrando) y no borra `push_subscriptions` ni `push_log` | Alta (negocio/RGPD) | `api/worker.js:743-759` | Push: Fase 2. Cancelar Stripe: dudoso |
| A3 | Vinculación Google por email sin verificar el email del alta con contraseña (riesgo de *pre-account takeover*) | Media | `api/worker.js:544-555`, `:400-431` | Dudoso (cambia el UX) |
| A4 | HTML sin escapar en emails (el nombre del registro va a una dirección arbitraria) | Media | `api/worker.js:425-429,1454` | Fase 3 |
| A5 | `register.html` guarda la contraseña en claro en `sessionStorage` antes del checkout. Además el alta Premium desde registro está rota (create-checkout exige sesión) | Baja | `register.html:489-497` | Fase 2 (se quita) |
| A6 | Reglas por defecto con IDs fijos globales (`rule_salary`, …). Chocan en la PK de D1 entre usuarios y `/api/rules/bulk` borra antes de insertar, sin transacción: un 2.º usuario puede quedarse sin reglas | Media (integridad) | `js/accounting-manager.js:1161-1211`, `api/worker.js:865-878` | Dudoso |
| A7 | Pages publica la raíz del repo (`api/`, `db/`, `wrangler.toml`, `CLAUDE.md`, este informe). El repo ya es público, así que no hay fuga nueva | Baja | trampa 4 de `CLAUDE.md` | Dudoso (cambiar el directorio de salida) |
| A8 | El webhook registra el evento como procesado **antes** de procesarlo: si falla el `UPDATE`, el reintento de Stripe se descarta como duplicado | Media (pagos) | `api/worker.js:1173-1176` | Dudoso |
| A9 | `checkout.session.completed` no mira `payment_status` (pagos asíncronos tipo SEPA) | Baja | `api/worker.js:1178-1197` | Dudoso |
| A10 | Límites de plan y funciones Premium solo en cliente (`js/auth.js:473-530`); el servidor solo aplica Premium en push | Media (negocio) | — | Fase 2 solo para `/api/banking/*` (coste GoCardless); el resto, dudoso |
| A11 | Endpoint push sin validar: el Worker hace `fetch` a la URL que diga un usuario Premium (SSRF limitado) y `/push/test` devuelve el cuerpo de error | Baja | `api/worker.js:978,1022-1041,175` | Fase 3 (validación https) |
| A12 | Desajuste de dominios (trampa 7): los enlaces de email y de Stripe usan `APP_URL=app.contabilidadpersonal.com` y el frontend vive en `financeflow-7nd.pages.dev` | Info | `wrangler.toml:18`, `public/config.js:12` | Dudoso |
| A13 | `users.currency` no está en `db/schema.sql` (deriva de schema) | Info | `api/worker.js:738` | Dudoso |
| A14 | `setupSettingsEvents` llama a `showDeleteAccountModal()` sin `this.` y lanza `ReferenceError` en consola (no afecta a la seguridad) | Info | `dashboard.html:9779` | No se toca |
| A15 | **Un push a `main` despliega el frontend en producción** (integración Git de Pages; el commit `f445935` re-disparó el build). El Worker se despliega a mano | Info (operativa) | — | Todos los cambios se diseñan para funcionar con el Worker viejo y con el nuevo |

---

## 5. Cambios aplicados

Cada corrección es un commit independiente (`git revert <hash>` deshace solo esa). Probado con un arnés que ejecuta `api/worker.js` en Node (D1 en SQLite, KV y `fetch` simulados) y con Chromium contra `wrangler dev --env staging` (frontend + API en local). **No probado:** llamadas reales a Stripe, GoCardless, Google y Resend, ni producción.

### Fase 2 — P0

| Commit | Punto | Cambio | Comprobado |
|---|---|---|---|
| `187ce94` | 4, 7 | `POST /api/bank-connections`: el upsert solo actúa sobre filas del propio usuario (`WHERE bank_connections.user_id = excluded.user_id`) | B no puede modificar la conexión de A |
| `2ff2844` | f | Webhook: acepta cualquiera de las firmas `v1` (rotación de secreto). Se mantienen la comparación constante y los 5 min | varias v1 → 200; secreto malo → 400; timestamp viejo → 400 |
| `8a87c60` | 4, d | `verify-session`: `session_id` con formato `cs_(live\|test)_…` (si no, 400 sin llamar a Stripe) y la sesión tiene que ser del usuario (`client_reference_id`/`metadata.user_id` = uid; si no, 403) | sesión propia → paid; ajena → 403; manipulada → 400 |
| `136b1d1` | 4, 7, e | `/api/banking/*`: IDs UUID; `country` y `institution_id` validados; propiedad comprobada con la `reference` que genera el Worker (`<uid>_…`) consultada en GoCardless; en `/sync`, la cuenta tiene que estar en una requisición del usuario | ajena → 404; manipulada → 400; las requisiciones declaradas por el cliente no cuentan |
| `6740b80` | A10 | `/api/banking/*` solo con `plan='premium'` en D1 (coste por conexión en GoCardless) | free → 403 |
| `1e0e1c5` | g | `POST /api/auth/change-password` (sesión, contraseña actual verificada, máx. 5 intentos/15 min, 8-256 car.) + `DataClient.changePassword` (local y remoto) + botón en Ajustes que abre el modal que ya existía; tras el cambio cierra la sesión | UI: clave mala → error; buena → logout; la nueva sí vale y la vieja no |
| `e21bda4` | A2 | El borrado de cuenta incluye `push_subscriptions` y `push_log` | sin restos tras el borrado |
| `a237aec` | d | Dashboard: quitada la "Opción B" (Premium en localStorage). Espera hasta ~20 s a que el webhook lo escriba en D1 | sin webhook no se activa nada; con webhook se aplica el plan de D1 |
| `3a78ceb` | d, A1 | El dashboard refresca el usuario desde el servidor en cada carga (el plan es el de D1) | copia local obsoleta → se corrige en las dos direcciones |
| `af0f674` | A1 | `Auth.validateSession` ya no degrada a free por `plan_expires_at` en modo remoto (los suscriptores mensuales perdían Premium a los 30 días) | renovación con fecha pasada → sigue PREMIUM |
| `67b600c` | d, A5 | `register.html`: fuera el flujo `?success=true` que marcaba Premium en local y el guardado de la contraseña en `sessionStorage`; eliminado `Auth.upgradeToPremium()` (sin llamadas) | alta Free igual; la contraseña ya no se guarda |

Sin cambios en esta fase, porque ya estaban bien o no aplica:
- Punto 8 (allowlist): el servidor ya enlaza campo a campo e ignora lo desconocido. Rechazar con 400 rompería los clientes actuales (ver dudosos).
- Hipótesis a, b y c: ya estaban corregidas.

### Fase 3 — P1

| Commit | Punto | Cambio | Comprobado |
|---|---|---|---|
| `7e77415` | 11 | Rate limit (KV) en register (10/h por IP), Google (20/15 min por IP), `webauthn/login-options` (30/15 min), reset-password (10/15 min), verify-session (20/15 min por usuario), create-checkout (10/15 min) y `/api/banking/*` (60/h) | el N+1 → 429 en cada uno |
| `28b892f` | 11 | Login: además del límite por IP, bloqueo por email+IP desde el 5.º fallo con backoff 1, 2, 4… min (máx. 60, con `Retry-After`) y tope global de 50 fallos/h por email; un login correcto reinicia el contador | el dueño entra desde otra IP; tope distribuido → 429 |
| `8c33a70` | 12 | Turnstile verificado en servidor en register, login y forgot. **Solo si existe `TURNSTILE_SECRET_KEY`** (sin el secreto, no cambia nada). Fail-open si siteverify no responde | sin token → 400; token válido → OK; servicio caído → no bloquea |
| `cb9b039` | 12 | Widget Turnstile en login, registro y "¿Olvidaste tu contraseña?" (`public/turnstile.js`); inactivo mientras `TURNSTILE_SITE_KEY` esté vacía en `config.js` | desactivado: igual que antes; activado: el token llega en las 3 peticiones |
| `81ba0f0` | 18, 19 | `_headers` (Pages): HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy y **CSP en Report-Only** (Tailwind, jsDelivr/cdnjs, Stripe, Google, Turnstile, Fonts; `frame-ancestors 'none'`) | recorrido de todas las páginas sin violaciones (en local) |
| `5345af2` | 18 | API: nosniff, `Cache-Control: no-store`, HSTS, `X-Frame-Options`, `Referrer-Policy` en todas las respuestas | cabeceras presentes |
| `f924dce` | 14, A11 | Body > 1 MB → 413. Validación de tipo/longitud/enum/rango/formato en todos los endpoints de escritura. Endpoint push solo https a un host con nombre | 40 casos (rechazos y payloads reales del cliente) |
| `ac3d87a` | 14 | Fechas con formato ISO estricto (antes solo se miraba el prefijo) | `2026-10-01<img…>` → 400 |
| `71db9cd` | 15, A4 | Nombre escapado en el HTML de los 4 emails | email de bienvenida sin el enlace inyectado |
| `6886ed8` | 15 | `_escapeHtml` en las 59 interpolaciones de datos de usuario en `innerHTML`, y en los toasts | con el código anterior 21 payloads se ejecutaban; ahora 0 |
| `09daedf` | 17 | 500 con `requestId` (body y `X-Request-Id`) y sin detalles. WebAuthn, Stripe y GoCardless ya no devuelven mensajes internos | — |
| `802e57f` | 17 | Sin `SELECT *` hacia el cliente: `publicUser()` sin `google_sub`/`stripe_*`/… y listas explícitas de columnas | campos que usa el cliente intactos |
| `d59566d` | 9 | JWT con `jti` + `iat`, **7 días con renovación deslizante** (`X-Refresh-Token`, que `authFetch` guarda). La renovación nunca acorta un token y los tokens antiguos de 30 días se migran solos: **nadie se desloguea** | un usuario con token antiguo sigue dentro y su token se migra |
| `08c22fd` | 9 | Logout que invalida: revocación en KV hasta la caducidad (también de tokens antiguos) y el cliente envía el token antes de borrarlo (`Auth.logout` lo borraba antes) | tras el logout, el token da 401 |
| `4009192` | 9 | Cambiar o restablecer la contraseña cierra todas las sesiones (`users.token_version`, **migración 0001**). Funciona igual con o sin la migración aplicada | con migración se invalidan; sin ella, fail-open sin errores |

Sin cambios en esta fase, porque ya estaba bien: **punto 10 (hashing)**. Comparación en tiempo constante (`timingSafeEqual`); PBKDF2-SHA256 a 100.000 iteraciones, que es el **máximo que admite WebCrypto en Workers**, así que no hay rehash posible a más iteraciones. No se cambia el algoritmo. **Punto 13**: ya era correcto.

#### Evaluación: token en cookie HttpOnly + SameSite + CSRF (no implementado, necesita tu aprobación)

- **Qué gana:** un XSS ya no podría leer el token (hoy está en `localStorage`). Aun así podría actuar como el usuario mientras la página está abierta.
- **Qué impide hoy hacerlo bien:** el frontend (`*.pages.dev`) y la API (`*.workers.dev`) son *sites* distintos, porque ambos dominios están en la Public Suffix List. Una cookie de la API sería de terceros: Safari y Firefox la bloquean por defecto y Chrome la restringe. Antes hay que **unificar dominio** (trampa 7), por ejemplo `app.contabilidadpersonal.com` + la API en la misma zona o en una ruta `/api/*` del mismo host.
- **Coste:** cambiar las respuestas de login/Google/passkey para emitir la cookie, `credentials: 'include'` en todas las llamadas (ya está en `authFetch`), un logout que borre la cookie, protección CSRF (SameSite=Lax/Strict + comprobación de `Origin` o token CSRF en las escrituras) y un periodo de convivencia en el que la API acepte cabecera y cookie.
- **Recomendación:** hacerlo después de unificar el dominio. Mientras tanto, la mitigación es la que ya está aplicada: XSS escapado, CSP en camino de pasar a enforcing, tokens de 7 días, logout y cambio de contraseña que revocan.

### Fase 4 — P2

| Commit | Punto | Cambio | Comprobado |
|---|---|---|---|
| `bae102a` | 16 | Importación: solo csv/xls/xlsx/pdf, máx. 10 MB, 2000 movimientos y 50 páginas de PDF; `sheetRows` en SheetJS; `isEvalSupported:false` en pdf.js (CVE-2024-4367) | CSV y PDF normales OK; .exe, >10 MB, >2000 filas y PDF >50 págs. rechazados |
| `11a316e` | 20 | `package-lock.json` (versiones reproducibles: simplewebauthn/server 13.3.3, web-push 0.3.2, wrangler 3.114.17) | `npm audit --omit=dev`: 0 |
| `9b38555` | 2, 20 | CI `security.yml`: gitleaks v8.30.1 sobre el historial completo (falla si hay secretos), `npm audit --omit=dev --audit-level=high` y `node --check`. `.gitleaks.toml` exceptúa la `pk_live` publicable | en local: 0 hallazgos y un `sk_live` falso sí se detecta |
| `737ba5d` | 20 | Dependabot (npm semanal, Actions mensual) | — |
| `10eb998` | 20 | Chart.js, SheetJS, SimpleWebAuthn, pdf.js y ExcelJS **autoalojados** en `/vendor/` (ficheros exactos de npm, integridad verificada, mismas versiones) + SRI en los 2 CSS de jsDelivr; CSP sin jsDelivr ni cdnjs en `script-src` | sin interceptar nada: todo carga; un CSS manipulado se bloquea |
| `e1186e5` | — | `audit_log` (**migración 0002**): login, login_failed, password_changed, password_reset, plan_changed y account_deleted; retención de 365 días en el cron; sin la migración no rompe nada | 11 casos, con y sin migración |

---

## 5 bis. Estado final por punto

| # | Punto | Estado inicial | Estado final | Qué se hizo |
|---|---|---|---|---|
| 1 | API keys ocultas | OK | OK | Sin cambios, ya estaba bien |
| 2 | Secretos fuera de Git | OK | OK | Sin cambios en el código. Añadido gitleaks en CI. No hay que rotar nada |
| 3 | Sin claves privadas en frontend | OK | OK | Sin cambios, ya estaba bien |
| 4 | Aislamiento / IDOR | PARCIAL | OK | `187ce94`, `136b1d1`, `8a87c60` (pendiente A6, dudoso) |
| 5 | Cifrado de datos sensibles | OK | OK | Sin cambios (cifrado de aplicación: dudoso) |
| 6 | Autenticación obligatoria | OK | OK | Sin cambios, ya estaba bien |
| 7 | Acceso solo del dueño | PARCIAL | OK | Igual que el punto 4 |
| 8 | Mass assignment | OK | OK | Sin cambios (rechazar campos desconocidos: dudoso) |
| 9 | Sesiones / tokens | PARCIAL | OK | `d59566d`, `08c22fd`, `4009192` (cookie HttpOnly: evaluada, pendiente de tu aprobación) |
| 10 | Hashing | OK | OK | Sin cambios; límite de 100.000 iteraciones de PBKDF2 en Workers documentado |
| 11 | Rate limiting | PARCIAL | OK | `7e77415`, `28b892f` |
| 12 | Anti-bots | FALTA | OK (falta activarlo) | `8c33a70`, `cb9b039`; se activa con el paso manual 5 |
| 13 | Queries parametrizadas | OK | OK | Sin cambios, ya estaba bien |
| 14 | Validación de inputs | FALTA | OK | `f924dce`, `ac3d87a` |
| 15 | XSS | PARCIAL | OK | `6886ed8`, `71db9cd` |
| 16 | Subida / importación | PARCIAL | OK | `bae102a` (actualizar SheetJS: dudoso) |
| 17 | Respuestas y errores | PARCIAL | OK | `09daedf`, `802e57f` |
| 18 | Security headers | FALTA | OK (CSP en Report-Only) | `81ba0f0`, `5345af2`; pasar la CSP a obligatoria es el paso manual 8 |
| 19 | HTTPS / HSTS | PARCIAL | OK en código | `81ba0f0`, `5345af2`; dominio propio: paso manual 6 |
| 20 | Dependencias y CDN | PARCIAL | OK | `11a316e`, `9b38555`, `737ba5d`, `10eb998` (Tailwind CDN, SheetJS, pdf.js y wrangler 4: dudosos) |

Además se corrigieron hallazgos fuera de los 20 puntos: A1 (los suscriptores perdían Premium en la UI), A2 (datos push al borrar la cuenta), A4 (HTML en emails), A5 (contraseña en `sessionStorage`), A10 (banca Premium en servidor) y A11 (SSRF por el endpoint push).

**Hallazgo nuevo durante las pruebas — A16 (fallo preexistente del cliente, no corregido):** `saldo_actual += cantidad` concatena strings cuando `cantidad` llega como texto (`createMovement` hace `...movementData` después de `parseFloat`). Ejemplo, en una cuenta de gasto con saldo inicial 0: un gasto manual de 12,34 € y otro importado de 45,30 € deberían dar **57,64 €**. Hoy en memoria queda `"012.3445.3"`, se guarda como texto en D1 y al recargar se ve **0,00 €**. Con la validación nueva ese texto ya no se guarda (D1 se queda en 12,34 €): sigue siendo incorrecto, pero no entra basura en D1. Ver dudoso n.º 1.

---

## 6. Pasos manuales para Víctor (en este orden)

**Estado ahora mismo.** Los cambios de **frontend** ya están en producción, porque un push a `main` despliega Pages (integración Git), y funcionan con el Worker actual. Los cambios del **Worker no se aplican hasta el paso 3**, incluido el IDOR de banca (Crítico si GoCardless está configurado). Los commits son públicos, así que conviene desplegar pronto.

1. **Actualizar tu copia local**
   ```
   cd /d C:\Users\Admin\FinanceFlow
   git pull origin main
   npm ci
   ```

2. **Punto de restauración y migraciones en la D1 de producción (`cp-db`).** Son solo aditivas. El código funciona con o sin ellas, pero sin la 0001 el cambio de contraseña no cierra las demás sesiones, y sin la 0002 no hay registro de auditoría.
   ```
   npx wrangler d1 time-travel info cp-db
   npx wrangler d1 execute cp-db --remote --file=db/migrations/0001_users_token_version.sql
   npx wrangler d1 execute cp-db --remote --file=db/migrations/0002_audit_log.sql
   npx wrangler d1 execute cp-db --remote --command "PRAGMA table_info(users)"
   npx wrangler d1 execute cp-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'"
   ```
   - En `PRAGMA table_info(users)` debe aparecer `token_version`.
   - Apunta el *bookmark* que muestra `time-travel info`. Si hiciera falta volver atrás: `npx wrangler d1 time-travel restore cp-db --bookmark=<bookmark>`.
   - La 0001 no es idempotente: si responde `duplicate column name: token_version`, ya estaba aplicada.

3. **Desplegar el Worker: primero staging, luego producción**
   ```
   npx wrangler d1 execute cp-db-staging --remote --env staging --file=db/migrations/0001_users_token_version.sql
   npx wrangler d1 execute cp-db-staging --remote --env staging --file=db/migrations/0002_audit_log.sql
   npx wrangler deploy --env staging
   ```
   Prueba en `https://financeflow-staging.victor-a97.workers.dev` los puntos 2-8 del checklist. Después:
   ```
   npx wrangler deploy
   npx wrangler tail
   ```
   - Deja `wrangler tail` abierto mientras haces el checklist. Si algo falla: `npx wrangler rollback` vuelve a la versión anterior del Worker.
   - **No ejecutes `npm run deploy:pages`**: apunta al proyecto `cp-app` y sube la carpeta entera (trampas 3 y 4). Pages ya se despliega solo desde `main`.

4. **Webhook de Stripe** (ahora es la ÚNICA vía para activar Premium; el cliente ya no lo activa en local). En el Dashboard de Stripe → Developers → Webhooks, comprueba:
   - el endpoint es `https://financeflow.victor-a97.workers.dev/api/stripe/webhook`;
   - tiene los eventos `checkout.session.completed` y `customer.subscription.deleted`;
   - las entregas recientes devuelven 200.

   Para ver cuántos Premium tenían la UI degradada por A1 (con el frontend nuevo ya ven Premium):
   ```
   npx wrangler d1 execute cp-db --remote --command "SELECT COUNT(*) AS premium, SUM(plan_expires_at < datetime('now')) AS fecha_pasada FROM users WHERE plan='premium'"
   ```

5. **Turnstile (anti-bots). Opcional, y en este orden, o los logins fallarán:**
   1. Cloudflare Dashboard → Turnstile → *Add widget*. Hostnames: `financeflow-7nd.pages.dev`, `financeflow-staging.victor-a97.workers.dev` y tu dominio propio si lo usas. Modo *Managed*.
   2. Pon la **Site Key** en `public/config.js` (`window.TURNSTILE_SITE_KEY = '0x…';`), haz commit y push, y comprueba que el widget aparece en login, registro y "¿Olvidaste tu contraseña?".
   3. Solo entonces, el secreto:
      ```
      npx wrangler secret put TURNSTILE_SECRET_KEY
      npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
      ```
   4. Repite login, registro y recuperación. Para desactivarlo: `npx wrangler secret delete TURNSTILE_SECRET_KEY`.

6. **Panel de Cloudflare, solo si sirves la app desde tu dominio** (`contabilidadpersonal.com` en Cloudflare). `*.pages.dev` y `*.workers.dev` ya son solo HTTPS y tienen HSTS precargado.
   - SSL/TLS → Edge Certificates → **Always Use HTTPS: On**.
   - **Minimum TLS Version: TLS 1.2**.
   - **HSTS**: *Enable*, `max-age` 6 meses (luego 12), `includeSubDomains` solo si **todos** los subdominios sirven HTTPS (incluido el WordPress de `www`), y *Preload* desactivado.

7. **GitHub**: Settings → Code security → activa *Dependabot alerts*, *Dependabot security updates* y *Secret scanning + Push protection* (gratis en repos públicos). Comprueba que el workflow **security** sale en verde.

8. **CSP: pasar de Report-Only a obligatoria.** Tras unos días, recorre login, registro, dashboard, pago de Stripe, Google y passkeys con la consola abierta. Si no hay avisos `[Report Only]`, cambia en `_headers` `Content-Security-Policy-Report-Only:` por `Content-Security-Policy:` y haz push.

9. **Rotación de claves: no hace falta** (el historial no tiene secretos). Si algún día sospechas que se ha filtrado `JWT_SECRET`: `npx wrangler secret put JWT_SECRET`. **Cierra la sesión de todos los usuarios**, así que es decisión tuya.

10. **Revertir un cambio concreto:** `git revert <hash>` y `git push` (el frontend se despliega solo). Si el cambio era del Worker, además `npx wrangler deploy`.

---

## 7. Checklist de pruebas post-deploy (producción)

Usa **dos cuentas de prueba** (A y B) que no sean de clientes. Para leer el token en la consola del navegador sin pegarlo en webs externas:

```js
JSON.parse(atob(localStorage.financeflow_token.split('.')[1]))
```

1. **API viva y cabeceras**: `https://financeflow.victor-a97.workers.dev/api/health` devuelve `{"ok":true}`. En DevTools → Network ves `X-Content-Type-Options`, `Cache-Control: no-store` y HSTS en la API, y `X-Frame-Options` y CSP-Report-Only en las páginas.
2. **Registro** de A con email y contraseña: entra al dashboard como **FREE**.
3. **Login**: cierra sesión y vuelve a entrar. Con 5 contraseñas malas seguidas, el 6.º intento dice "Demasiados intentos fallidos" (se desbloquea en 1 min; desde otra red se puede entrar).
4. **Google** y **passkey**: entran como siempre.
5. **Token nuevo**: tras el login, el token tiene `jti` y `exp` a 7 días.
6. **Logout que revoca**: guarda el token en una variable (`t = localStorage.financeflow_token`), cierra sesión y ejecuta `fetch('https://financeflow.victor-a97.workers.dev/api/accounts',{headers:{Authorization:'Bearer '+t}}).then(r=>r.status)`. Debe dar **401**.
7. **Cambio de contraseña** (Ajustes → Cambiar contraseña): con la actual mal, error; bien, cierra sesión; la nueva vale. Con la migración 0001, la sesión abierta en otro dispositivo también se cierra.
8. **Recuperación**: pide el enlace y comprueba que llega el email. **Comprueba que el enlace abre la página de reset**: apunta a `APP_URL` = `app.contabilidadpersonal.com` (trampa 7). Cambia la contraseña y entra.
9. **Pago sin cobro real.** Crea en Stripe un código promocional del 100 % de un solo uso (el checkout admite códigos) y haz el checkout con A: total 0 €.
   - El webhook pone a A en **PREMIUM**. Como el pago es 0 €, `verify-session` dice `paid:false`: si no ves Premium al volver, recarga.
   - En Stripe → Webhooks, la entrega debe salir 200.
   - Después cancela desde "Gestionar suscripción" (portal): al ejecutarse la cancelación, A vuelve a **FREE**.
   - Alternativa: pago real del plan mensual con tu tarjeta y reembolso inmediato desde Stripe.
10. **Webhook sin firma**: `curl -s -o NUL -w "%{http_code}" -X POST https://financeflow.victor-a97.workers.dev/api/stripe/webhook -d "{}"` devuelve **400**.
11. **Intento de auto-upgrade (debe fallar).** En la consola del dashboard de A (FREE):
    ```js
    const t=localStorage.financeflow_token, u=JSON.parse(localStorage.currentUser);
    fetch(API_URL+'/users/'+u.id,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({plan:'premium',plan_expires_at:'2099-01-01'})}).then(r=>r.json()).then(console.log)
    ```
    La respuesta sigue con `plan:'free'`. Después, en `localStorage`, cambia `currentUser.plan` a `'premium'` y recarga: el dashboard vuelve a **FREE** (el plan viene del servidor).
12. **IDOR entre A y B**, con el token de A:
    - `GET /api/users/<id de B>` → 403.
    - `POST /api/accounts` con el `id` de una cuenta de B y `nombre:'HACK'` → la cuenta de B no cambia.
    - `DELETE /api/movements/<id de un movimiento de B>` → el movimiento de B sigue ahí.
    - `GET /api/banking/accounts?requisition_id=00000000-0000-4000-8000-000000000000` → 403 si A es free, 404 si es premium.
13. **Importación**: importa un extracto real (CSV/XLSX y PDF). Previsualiza, importa, y comprueba que las descripciones se ven como texto. Un archivo de más de 10 MB se rechaza con aviso.
14. **PWA / push** (cuenta premium con avisos activados): la PWA abre. En la consola: `fetch(API_URL+'/push/test',{method:'POST',headers:{Authorization:'Bearer '+localStorage.financeflow_token}}).then(r=>r.json()).then(console.log)`; debe llegar la notificación.
15. **Exportación** de informes a Excel/CSV: se descarga (ExcelJS ahora sale de `/vendor/`).
16. **Borrado de cuenta** de B (Ajustes → Eliminar cuenta): desaparecen sus datos. Si B tenía una suscripción de prueba, cancélala antes (A2).
17. **Logs**: en `wrangler tail` no hay errores inesperados; un 500 muestra su `requestId`.

---

## 8. Puntos dudosos (necesitan tu decisión)

1. **A16 · Saldos que concatenan texto (cliente).** Arreglo propuesto de 2 líneas, sin tocar nada más:
   - en `createMovement`, poner `cantidad: parseFloat(cantidad)` **después** de `...movementData`;
   - en `updateAccountBalances` y `recalcAllBalances`, usar `Number(cantidad)`.

   Impacto: con el ejemplo anterior la cuenta mostraría 57,64 € en lugar de 0,00 €. Los saldos ya corrompidos se corrigen con `recalcAllBalances()`. ¿Lo aplico?
2. **A2 · Borrar la cuenta no cancela la suscripción de Stripe** (se sigue cobrando). ¿Cancelar por API al borrar? ¿Inmediatamente o a fin de periodo? ¿Con reembolso?
3. **A1 · `plan_expires_at` no se renueva.** Ya no afecta, porque el cliente usa el plan de D1. ¿Mantenerlo al día con `invoice.paid`? Requiere activar ese evento en el webhook.
4. **A8 · Idempotencia del webhook:** el evento se marca como procesado antes de procesarlo. Si el `UPDATE` falla, el reintento de Stripe se descarta y ese pago se queda sin Premium. Propuesta: marcarlo solo al terminar.
5. **A9 · `checkout.session.completed` no mira `payment_status`** (afecta a SEPA y otros pagos asíncronos). ¿Esperar a `checkout.session.async_payment_succeeded`?
6. **A3 · Pre-account takeover:** al entrar con Google se vincula una cuenta con contraseña creada por otro con ese email (el alta no verifica el email). Opciones: verificar el email en el alta, o invalidar la contraseña previa al vincular Google (cambia el UX).
7. **A6 · IDs fijos de las reglas por defecto** (`rule_salary`…): chocan entre usuarios en la PK, y `/rules/bulk` borra antes de insertar, sin transacción. Propuesta: IDs únicos por usuario y `batch` transaccional.
8. **A10 · Límites del plan free solo en cliente** (número de cuentas, reglas, autocontrol, importación). ¿Aplicarlos en servidor? Riesgo: usuarios que hoy ya superan los límites.
9. **Punto 8 · Rechazar campos desconocidos con 400:** obliga a cambiar el cliente para que envíe solo los campos necesarios. Hoy se ignoran.
10. **A7 · Pages publica la raíz del repo:** configurar un directorio de salida que contenga solo lo público.
11. **A12 · Unificar dominio** (CORS, `APP_URL` y enlaces de los emails y de Stripe). Es requisito previo de la cookie HttpOnly.
12. **Cookie HttpOnly + CSRF** (sección 5): después de unificar el dominio.
13. **Punto 5 · Cifrado a nivel de aplicación** de los movimientos: no lo recomiendo (la clave estaría en la misma cuenta de Cloudflare).
14. **SheetJS 0.18.5** (CVE-2023-30533, CVE-2024-22363): actualizar a 0.20.3 de `cdn.sheetjs.com`, probando antes importación y exportación.
15. **pdf.js 3.11.174 → 4.x** (ESM, cambia la API) y **wrangler 3 → 4** (avisos solo de desarrollo; cambio mayor).
16. **Tailwind Play CDN en producción:** ni SRI ni versión fija. Pasar a CSS compilado requiere un *build step* (CLAUDE.md pide consultarlo).
17. **Login: tope global de 50 fallos/h por email.** Un atacante con muchas IPs podría bloquear durante 1 h el login con contraseña de una cuenta concreta. ¿Subirlo, bajarlo o quitarlo?
18. **KV del plan Free de Workers** (1.000 escrituras/día): el rate limit y la revocación usan KV. Si estás en el plan Free y crece el tráfico, conviene pasar a Workers Paid.
19. **A13 · `users.currency` no está en `schema.sql`**: añadirla, y que `schema.sql` refleje producción.
20. **Fallos funcionales vistos, que no son de seguridad:**
    - `setupSettingsEvents` lanza `ReferenceError` (A14);
    - en `register.html`, el callback de Google usa `registerPage`, que no está definido en ese ámbito, así que tras registrarse con Google no redirige;
    - `validatePassword` falla cuando FlowIcons cambia los `<i>` por SVG;
    - el alta Premium directa desde `register.html` no funciona, porque create-checkout exige sesión.
