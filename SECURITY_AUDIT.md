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

_(fases 3 y 4: más abajo)_

## 6. Pasos manuales para Víctor

_(al final)_

## 7. Checklist de pruebas post-deploy

_(al final)_

## 8. Puntos dudosos (necesitan tu decisión)

_(al final)_
