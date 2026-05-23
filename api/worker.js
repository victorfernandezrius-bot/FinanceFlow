// ============================================================
// FinanceFlow / Contabilidad Personal — Cloudflare Worker API
// ------------------------------------------------------------
// Endpoints:
//   Auth:      POST /api/auth/register, /api/auth/login, /api/auth/logout
//              GET  /api/auth/session
//   Users:     GET/PUT/DELETE /api/users/:id, GET /api/users
//   Accounts:  GET/POST /api/accounts, DELETE /api/accounts/:id
//   Movements: GET/POST /api/movements, DELETE /api/movements/:id
//   Rules:     GET/POST /api/rules, POST /api/rules/bulk, DELETE /api/rules/:id
//   Autocontrol, scenarios, notifications, bank-connections, import-info
//   Stripe:    POST /api/stripe/create-checkout, POST /api/stripe/webhook,
//              POST /api/stripe/verify-session
//   GoCardless:POST /api/banking/institutions, /api/banking/requisition,
//              GET /api/banking/accounts, POST /api/banking/sync
//
// Bindings (wrangler.toml): DB (D1), CACHE (KV)
// Secrets: JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//          GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY
// ============================================================

const json = (data, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
    });

function corsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.APP_URL || '').replace(/\/$/, '');
    const allowOrigin = origin && (origin === allowed || origin.endsWith('.contabilidadpersonal.com'))
        ? origin : allowed;
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true'
    };
}

// ---------- JWT mínimo (HS256) ----------
async function signJWT(payload, secret) {
    const enc = new TextEncoder();
    const header = { alg: 'HS256', typ: 'JWT' };
    const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const data = `${b64(header)}.${b64(payload)}`;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${data}.${b64sig}`;
}

async function verifyJWT(token, secret) {
    try {
        const enc = new TextEncoder();
        const [h, p, s] = token.split('.');
        const data = `${h}.${p}`;
        const key = await crypto.subtle.importKey('raw', enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const sigBytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
        if (!ok) return null;
        const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && Date.now() / 1000 > payload.exp) return null;
        return payload;
    } catch { return null; }
}

// ---------- Hash de contraseña (PBKDF2) ----------
async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    salt = salt || crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password),
        { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial, 256);
    const hashArr = new Uint8Array(bits);
    const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
    const hashHex = [...hashArr].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, stored) {
    const [saltHex] = stored.split(':');
    const salt = Uint8Array.from(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const recomputed = await hashPassword(password, salt);
    return recomputed === stored;
}

async function getAuthUser(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return null;
    return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first();
}

// ============================================================
// ROUTER
// ============================================================
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;
        const cors = corsHeaders(request, env);

        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

        try {
            // ---------- HEALTH ----------
            if (path === '/api/health') return json({ ok: true, ts: Date.now() }, 200, cors);

            // ---------- AUTH ----------
            if (path === '/api/auth/register' && method === 'POST') {
                const { email, password, name, plan = 'free' } = await request.json();
                if (!email || !password || !name) return json({ error: 'Faltan campos' }, 400, cors);
                if (password.length < 8) return json({ error: 'Contraseña mínima 8 caracteres' }, 400, cors);

                const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
                    .bind(email.toLowerCase()).first();
                if (exists) return json({ error: 'Email ya registrado' }, 409, cors);

                const id = crypto.randomUUID();
                const now = new Date().toISOString();
                const pwHash = await hashPassword(password);
                const planExp = plan === 'premium'
                    ? new Date(Date.now() + 30 * 864e5).toISOString() : null;

                await env.DB.prepare(
                    `INSERT INTO users (id,email,name,password_hash,plan,plan_expires_at,created_at)
                     VALUES (?,?,?,?,?,?,?)`)
                    .bind(id, email.toLowerCase(), name, pwHash, plan, planExp, now).run();

                const token = await signJWT({ sub: id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, env.JWT_SECRET);
                const user = { id, email: email.toLowerCase(), name, plan, plan_expires_at: planExp, created_at: now };
                return json({ success: true, token, currentUser: user }, 201, cors);
            }

            if (path === '/api/auth/login' && method === 'POST') {
                const { email, password } = await request.json();
                const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
                    .bind((email || '').toLowerCase()).first();
                if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash)))
                    return json({ error: 'Credenciales inválidas' }, 401, cors);

                const token = await signJWT({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, env.JWT_SECRET);
                delete user.password_hash;
                return json({ success: true, token, currentUser: user }, 200, cors);
            }

            if (path === '/api/auth/session' && method === 'GET') {
                const user = await getAuthUser(request, env);
                if (!user) return json({ token: null, currentUser: null }, 200, cors);
                delete user.password_hash;
                return json({ token: 'valid', currentUser: user }, 200, cors);
            }

            if (path === '/api/auth/logout' && method === 'POST') {
                return json({ success: true }, 200, cors);
            }

            // A partir de aquí, todo requiere autenticación
            const authUser = await getAuthUser(request, env);
            const uid = authUser?.id;

            // ---------- USERS ----------
            if (path === '/api/users' && method === 'GET') {
                if (!authUser) return json({ error: 'No autorizado' }, 401, cors);
                // Solo devuelve el propio usuario (privacidad)
                delete authUser.password_hash;
                return json([authUser], 200, cors);
            }

            const userMatch = path.match(/^\/api\/users\/(.+)$/);
            if (userMatch) {
                if (!authUser || authUser.id !== userMatch[1]) return json({ error: 'No autorizado' }, 403, cors);
                if (method === 'GET') { delete authUser.password_hash; return json(authUser, 200, cors); }
                if (method === 'PUT') {
                    const u = await request.json();
                    const now = new Date().toISOString();
                    await env.DB.prepare(
                        `UPDATE users SET name=?, plan=?, plan_expires_at=?, updated_at=? WHERE id=?`)
                        .bind(u.name ?? authUser.name, u.plan ?? authUser.plan,
                              u.plan_expires_at ?? authUser.plan_expires_at, now, authUser.id).run();
                    return json({ ...authUser, ...u }, 200, cors);
                }
                if (method === 'DELETE') {
                    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(authUser.id).run();
                    return json({ success: true }, 200, cors);
                }
            }

            // ---------- ACCOUNTS ----------
            if (path === '/api/accounts') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM accounts WHERE user_id=?').bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const a = await request.json();
                    const now = new Date().toISOString();
                    await env.DB.prepare(
                        `INSERT INTO accounts (id,user_id,nombre,tipo,descripcion,saldo_inicial,saldo_actual,
                            is_fixed_cost,fixed_monthly_amount,fixed_due_day,is_bank_account,created_at,updated_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, descripcion=excluded.descripcion,
                            saldo_inicial=excluded.saldo_inicial, saldo_actual=excluded.saldo_actual,
                            is_fixed_cost=excluded.is_fixed_cost, fixed_monthly_amount=excluded.fixed_monthly_amount,
                            fixed_due_day=excluded.fixed_due_day, is_bank_account=excluded.is_bank_account,
                            updated_at=excluded.updated_at`)
                        .bind(a.id, uid, a.nombre, a.tipo, a.descripcion || '', a.saldo_inicial || 0,
                              a.saldo_actual || 0, a.is_fixed_cost ? 1 : 0, a.fixed_monthly_amount ?? null,
                              a.fixed_due_day ?? null, a.is_bank_account ? 1 : 0, a.created_at || now, now).run();
                    return json(a, 200, cors);
                }
            }
            const accMatch = path.match(/^\/api\/accounts\/(.+)$/);
            if (accMatch && method === 'DELETE') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('DELETE FROM accounts WHERE id=? AND user_id=?')
                    .bind(accMatch[1].split('?')[0], uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- MOVEMENTS ----------
            if (path === '/api/movements') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM movements WHERE user_id=?').bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const m = await request.json();
                    const now = new Date().toISOString();
                    await env.DB.prepare(
                        `INSERT INTO movements (id,user_id,tipo,cantidad,descripcion,fecha,cuenta_id,
                            cuenta_destino_id,categoria,origen,auto_categorized,applied_rule,rule_name,
                            manually_categorized,bank_reference,created_at,updated_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, cantidad=excluded.cantidad,
                            descripcion=excluded.descripcion, fecha=excluded.fecha, cuenta_id=excluded.cuenta_id,
                            cuenta_destino_id=excluded.cuenta_destino_id, categoria=excluded.categoria,
                            updated_at=excluded.updated_at`)
                        .bind(m.id, uid, m.tipo, m.cantidad, m.descripcion, m.fecha, m.cuenta_id ?? null,
                              m.cuenta_destino_id ?? null, m.categoria ?? null, m.origen || 'manual',
                              m.auto_categorized ? 1 : 0, m.applied_rule ?? null, m.rule_name ?? null,
                              m.manually_categorized ? 1 : 0, m.bank_reference ?? null, m.created_at || now, now).run();
                    return json(m, 200, cors);
                }
            }
            const movMatch = path.match(/^\/api\/movements\/(.+)$/);
            if (movMatch && method === 'DELETE') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('DELETE FROM movements WHERE id=? AND user_id=?')
                    .bind(movMatch[1].split('?')[0], uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- RULES ----------
            if (path === '/api/rules') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM categorization_rules WHERE user_id=?').bind(uid).all();
                    return json(results.map(r => ({ ...r, keywords: JSON.parse(r.keywords || '[]') })), 200, cors);
                }
                if (method === 'POST') {
                    const r = await request.json();
                    await env.DB.prepare(
                        `INSERT INTO categorization_rules (id,user_id,name,keywords,account_type,account_id,account_name,enabled,is_default,created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET name=excluded.name, keywords=excluded.keywords,
                            account_type=excluded.account_type, account_id=excluded.account_id,
                            account_name=excluded.account_name, enabled=excluded.enabled`)
                        .bind(r.id, uid, r.name, JSON.stringify(r.keywords || []), r.accountType ?? null,
                              r.accountId ?? null, r.accountName ?? null, r.enabled ? 1 : 0,
                              r.isDefault ? 1 : 0, r.createdAt || new Date().toISOString()).run();
                    return json(r, 200, cors);
                }
            }
            if (path === '/api/rules/bulk' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const { rules } = await request.json();
                await env.DB.prepare('DELETE FROM categorization_rules WHERE user_id=?').bind(uid).run();
                for (const r of rules) {
                    await env.DB.prepare(
                        `INSERT INTO categorization_rules (id,user_id,name,keywords,account_type,account_id,account_name,enabled,is_default,created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?)`)
                        .bind(r.id, uid, r.name, JSON.stringify(r.keywords || []), r.accountType ?? null,
                              r.accountId ?? null, r.accountName ?? null, r.enabled ? 1 : 0,
                              r.isDefault ? 1 : 0, r.createdAt || new Date().toISOString()).run();
                }
                return json({ success: true, count: rules.length }, 200, cors);
            }
            const ruleMatch = path.match(/^\/api\/rules\/(.+)$/);
            if (ruleMatch && method === 'DELETE' && ruleMatch[1] !== 'bulk') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('DELETE FROM categorization_rules WHERE id=? AND user_id=?')
                    .bind(ruleMatch[1].split('?')[0], uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- AUTOCONTROL PLAN ----------
            if (path === '/api/autocontrol-plan') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const row = await env.DB.prepare('SELECT plan_data FROM autocontrol_plan WHERE user_id=?').bind(uid).first();
                    return json(row ? JSON.parse(row.plan_data) : null, 200, cors);
                }
                if (method === 'POST') {
                    const plan = await request.json();
                    await env.DB.prepare(
                        `INSERT INTO autocontrol_plan (user_id,plan_data,updated_at) VALUES (?,?,?)
                         ON CONFLICT(user_id) DO UPDATE SET plan_data=excluded.plan_data, updated_at=excluded.updated_at`)
                        .bind(uid, JSON.stringify(plan), new Date().toISOString()).run();
                    return json(plan, 200, cors);
                }
            }

            // ---------- AUTOCONTROL ASSOCIATIONS ----------
            if (path === '/api/autocontrol-associations') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const row = await env.DB.prepare('SELECT associations_data FROM autocontrol_associations WHERE user_id=?').bind(uid).first();
                    return json(row ? JSON.parse(row.associations_data) : null, 200, cors);
                }
                if (method === 'POST') {
                    const assoc = await request.json();
                    await env.DB.prepare(
                        `INSERT INTO autocontrol_associations (user_id,associations_data,updated_at) VALUES (?,?,?)
                         ON CONFLICT(user_id) DO UPDATE SET associations_data=excluded.associations_data, updated_at=excluded.updated_at`)
                        .bind(uid, JSON.stringify(assoc), new Date().toISOString()).run();
                    return json(assoc, 200, cors);
                }
            }

            // ---------- SCENARIOS ----------
            if (path === '/api/scenarios') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT scenario_data FROM scenarios WHERE user_id=?').bind(uid).all();
                    return json(results.map(r => JSON.parse(r.scenario_data)), 200, cors);
                }
                if (method === 'POST') {
                    const { scenarios } = await request.json();
                    await env.DB.prepare('DELETE FROM scenarios WHERE user_id=?').bind(uid).run();
                    for (const s of (scenarios || [])) {
                        await env.DB.prepare('INSERT INTO scenarios (id,user_id,scenario_data,created_at) VALUES (?,?,?,?)')
                            .bind(s.id || crypto.randomUUID(), uid, JSON.stringify(s), new Date().toISOString()).run();
                    }
                    return json(scenarios, 200, cors);
                }
            }

            // ---------- NOTIFICATIONS ----------
            if (path === '/api/notifications') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC').bind(uid).all();
                    return json(results.map(n => ({ ...n, read: !!n.read, data: n.data ? JSON.parse(n.data) : {} })), 200, cors);
                }
                if (method === 'POST') {
                    const { notifications } = await request.json();
                    await env.DB.prepare('DELETE FROM notifications WHERE user_id=?').bind(uid).run();
                    for (const n of (notifications || [])) {
                        await env.DB.prepare(
                            'INSERT INTO notifications (id,user_id,type,title,message,data,read,created_at) VALUES (?,?,?,?,?,?,?,?)')
                            .bind(n.id, uid, n.type, n.title, n.message, JSON.stringify(n.data || {}),
                                  n.read ? 1 : 0, n.createdAt || new Date().toISOString()).run();
                    }
                    return json({ success: true }, 200, cors);
                }
            }

            // ---------- BANK CONNECTIONS ----------
            if (path === '/api/bank-connections') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM bank_connections WHERE user_id=?').bind(uid).all();
                    return json(results, 200, cors);
                }
                if (method === 'POST') {
                    const c = await request.json();
                    await env.DB.prepare(
                        `INSERT INTO bank_connections (id,user_id,bank_code,bank_name,institution_id,requisition_id,
                            gocardless_account_id,linked_account_id,status,is_active,last_sync_at,created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET status=excluded.status, is_active=excluded.is_active,
                            gocardless_account_id=excluded.gocardless_account_id, last_sync_at=excluded.last_sync_at`)
                        .bind(c.id, uid, c.bankCode ?? null, c.bankName ?? null, c.institutionId ?? null,
                              c.requisitionId ?? null, c.gocardlessAccountId ?? null, c.linkedAccountId ?? null,
                              c.status || 'pending', c.isActive ? 1 : 0, c.lastSyncAt ?? null,
                              c.createdAt || new Date().toISOString()).run();
                    return json(c, 200, cors);
                }
            }
            const bcMatch = path.match(/^\/api\/bank-connections\/(.+)$/);
            if (bcMatch && method === 'DELETE') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                await env.DB.prepare('DELETE FROM bank_connections WHERE id=? AND user_id=?')
                    .bind(bcMatch[1].split('?')[0], uid).run();
                return json({ success: true }, 200, cors);
            }

            // ---------- IMPORT INFO ----------
            if (path === '/api/import-info') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                if (method === 'GET') {
                    const bankCode = url.searchParams.get('bankCode');
                    const row = await env.DB.prepare('SELECT * FROM import_info WHERE user_id=? AND bank_code=?').bind(uid, bankCode).first();
                    return json(row || null, 200, cors);
                }
                if (method === 'POST') {
                    const { bankCode, importInfo } = await request.json();
                    await env.DB.prepare(
                        `INSERT INTO import_info (user_id,bank_code,last_import_at,last_import_count,total_imported)
                         VALUES (?,?,?,?,?)
                         ON CONFLICT(user_id,bank_code) DO UPDATE SET last_import_at=excluded.last_import_at,
                            last_import_count=excluded.last_import_count, total_imported=excluded.total_imported`)
                        .bind(uid, bankCode, importInfo.lastImportDate || new Date().toISOString(),
                              importInfo.lastImportCount || 0, importInfo.totalImported || 0).run();
                    return json({ success: true }, 200, cors);
                }
            }

            // ---------- STRIPE ----------
            if (path === '/api/stripe/create-checkout' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const body = await request.json();
                // Aceptar tanto plan_type como planType; normalizar 'annual'/'yearly'
                const planRaw = body.plan_type || body.planType || 'monthly';
                const isAnnual = planRaw === 'annual' || planRaw === 'yearly';
                const priceId = isAnnual
                    ? 'price_1SjKUPRr7a5Py1C0SoaFNKuC'
                    : 'price_1SjKSQRr7a5Py1C0K1jRHpPc';
                const params = new URLSearchParams();
                params.append('mode', 'subscription');
                params.append('line_items[0][price]', priceId);
                params.append('line_items[0][quantity]', '1');
                params.append('success_url', `${env.APP_URL}/dashboard.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}`);
                params.append('cancel_url', `${env.APP_URL}/dashboard.html?upgrade=cancelled`);
                params.append('client_reference_id', uid);
                params.append('customer_email', authUser.email);
                params.append('metadata[user_id]', uid);
                params.append('metadata[plan_type]', isAnnual ? 'annual' : 'monthly');

                const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params
                });
                const session = await resp.json();
                if (!resp.ok) return json({ error: session.error?.message || 'Error Stripe' }, 500, cors);
                return json({ checkout_url: session.url, session_id: session.id }, 200, cors);
            }

            if (path === '/api/stripe/webhook' && method === 'POST') {
                const sig = request.headers.get('stripe-signature');
                const body = await request.text();
                const verified = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
                if (!verified) return json({ error: 'Firma inválida' }, 400, cors);

                const event = JSON.parse(body);
                // Idempotencia
                const seen = await env.DB.prepare('SELECT event_id FROM stripe_events WHERE event_id=?').bind(event.id).first();
                if (seen) return json({ received: true, duplicate: true }, 200, cors);
                await env.DB.prepare('INSERT INTO stripe_events (event_id,type,processed_at,payload) VALUES (?,?,?,?)')
                    .bind(event.id, event.type, new Date().toISOString(), body.slice(0, 5000)).run();

                if (event.type === 'checkout.session.completed') {
                    const s = event.data.object;
                    const userId = s.metadata?.user_id || s.client_reference_id;
                    const planType = s.metadata?.plan_type || 'monthly';
                    const expDays = planType === 'annual' ? 365 : 30;
                    const exp = new Date(Date.now() + expDays * 864e5).toISOString();
                    if (userId) {
                        await env.DB.prepare(
                            `UPDATE users SET plan='premium', plan_expires_at=?, stripe_customer_id=?, stripe_subscription_id=?, updated_at=? WHERE id=?`)
                            .bind(exp, s.customer || null, s.subscription || null, new Date().toISOString(), userId).run();
                    }
                }
                if (event.type === 'customer.subscription.deleted') {
                    const sub = event.data.object;
                    await env.DB.prepare(
                        `UPDATE users SET plan='free', plan_expires_at=NULL WHERE stripe_subscription_id=?`)
                        .bind(sub.id).run();
                }
                return json({ received: true }, 200, cors);
            }

            if (path === '/api/stripe/verify-session' && method === 'POST') {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const { session_id } = await request.json();
                const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
                    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
                });
                const session = await resp.json();
                const paid = session.payment_status === 'paid';
                return json({ paid, plan: paid ? 'premium' : 'free' }, 200, cors);
            }

            // ---------- GOCARDLESS (Bank Account Data) ----------
            // Token de acceso cacheado en KV (caduca a las 24h)
            if (path.startsWith('/api/banking/')) {
                if (!uid) return json({ error: 'No autorizado' }, 401, cors);
                const gcToken = await getGoCardlessToken(env);

                if (path === '/api/banking/institutions' && method === 'POST') {
                    const { country = 'ES' } = await request.json();
                    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/institutions/?country=${country}`, {
                        headers: { 'Authorization': `Bearer ${gcToken}`, 'Accept': 'application/json' }
                    });
                    return json(await r.json(), 200, cors);
                }

                if (path === '/api/banking/requisition' && method === 'POST') {
                    const { institution_id } = await request.json();
                    const r = await fetch('https://bankaccountdata.gocardless.com/api/v2/requisitions/', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${gcToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            redirect: `${env.APP_URL}/dashboard.html?bank=connected`,
                            institution_id,
                            reference: `${uid}_${Date.now()}`,
                            user_language: 'ES'
                        })
                    });
                    const req = await r.json();
                    return json(req, 200, cors); // contiene { id, link } -> redirige al usuario a req.link
                }

                if (path === '/api/banking/accounts' && method === 'GET') {
                    const requisitionId = url.searchParams.get('requisition_id');
                    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/requisitions/${requisitionId}/`, {
                        headers: { 'Authorization': `Bearer ${gcToken}` }
                    });
                    return json(await r.json(), 200, cors);
                }

                if (path === '/api/banking/sync' && method === 'POST') {
                    const { account_id } = await request.json();
                    const r = await fetch(`https://bankaccountdata.gocardless.com/api/v2/accounts/${account_id}/transactions/`, {
                        headers: { 'Authorization': `Bearer ${gcToken}` }
                    });
                    const data = await r.json();
                    return json(data, 200, cors); // el frontend mapea a movimientos contables
                }
            }

            return json({ error: 'Not found', path }, 404, cors);

        } catch (err) {
            return json({ error: 'Server error', detail: err.message }, 500, cors);
        }
    }
};

// ---------- Helpers GoCardless ----------
async function getGoCardlessToken(env) {
    const cached = await env.CACHE.get('gc_access_token');
    if (cached) return cached;
    const r = await fetch('https://bankaccountdata.gocardless.com/api/v2/token/new/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ secret_id: env.GOCARDLESS_SECRET_ID, secret_key: env.GOCARDLESS_SECRET_KEY })
    });
    const data = await r.json();
    // access expira en ~24h; lo cacheamos 23h por seguridad
    if (data.access) await env.CACHE.put('gc_access_token', data.access, { expirationTtl: 82800 });
    return data.access;
}

// ---------- Verificación firma Stripe ----------
async function verifyStripeSignature(payload, sigHeader, secret) {
    if (!sigHeader || !secret) return false;
    try {
        const parts = Object.fromEntries(sigHeader.split(',').map(kv => kv.split('=')));
        const signedPayload = `${parts.t}.${payload}`;
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
        const expected = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
        return expected === parts.v1;
    } catch { return false; }
}
