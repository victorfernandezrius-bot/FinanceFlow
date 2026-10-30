// Paso "Introduce el código" de la verificación de email (registro y login).
// mountVerifyStep(container, { email, autoResend, onVerified, onChangeEmail })
//  - autoResend: pide un código nuevo al abrir (se llega desde un login con 403).
//  - onVerified(step): la sesión ya está creada (Auth.verifyEmail); la página sigue igual
//    que tras un login normal.
//  - onChangeEmail(): vuelve al formulario.
// Devuelve { showSuccess(msg), destroy() }. Colores con variables CSS (modo oscuro: html.dark,
// como el dashboard). El email se pinta con textContent, nunca con innerHTML.
import Auth from './auth.js';
import DataClient from '../src/services/data-client.js';

const RESEND_SECONDS = 60;

const STYLE = `
.ffv { --ffv-bg: var(--bg-primary, #ffffff); --ffv-text: var(--text-primary, #111827);
  --ffv-muted: var(--text-secondary, #6b7280); --ffv-border: var(--border-color, #d1d5db);
  --ffv-accent: var(--azul-oscuro, #0158C9); --ffv-field: var(--bg-secondary, #f9fafb);
  --ffv-err-bg: #fef2f2; --ffv-err-border: #fecaca; --ffv-err-text: #b91c1c;
  --ffv-ok-bg: #f0fdf4; --ffv-ok-border: #bbf7d0; --ffv-ok-text: #15803d;
  --ffv-info-bg: #eff6ff; --ffv-info-border: #bfdbfe; --ffv-info-text: #1e40af;
  background: var(--ffv-bg); color: var(--ffv-text); text-align: center; }
html.dark .ffv { --ffv-bg: var(--bg-primary, #111827); --ffv-text: var(--text-primary, #f9fafb);
  --ffv-muted: var(--text-secondary, #9ca3af); --ffv-border: var(--border-color, #374151);
  --ffv-field: var(--bg-secondary, #1f2937);
  --ffv-err-bg: #3b1219; --ffv-err-border: #7f1d1d; --ffv-err-text: #fca5a5;
  --ffv-ok-bg: #052e16; --ffv-ok-border: #166534; --ffv-ok-text: #86efac;
  --ffv-info-bg: #172554; --ffv-info-border: #1e40af; --ffv-info-text: #bfdbfe; }
.ffv h3 { margin: 0 0 8px; font-size: 1.25rem; font-weight: 700; color: var(--ffv-text); }
.ffv p { margin: 0 0 12px; font-size: 0.9rem; line-height: 1.5; color: var(--ffv-muted); }
.ffv p strong { color: var(--ffv-text); word-break: break-all; }
.ffv-msg { margin: 0 0 16px; padding: 10px 12px; border-radius: 8px; font-size: 0.875rem; border: 1px solid; text-align: left; }
.ffv-msg.err { background: var(--ffv-err-bg); border-color: var(--ffv-err-border); color: var(--ffv-err-text); }
.ffv-msg.ok { background: var(--ffv-ok-bg); border-color: var(--ffv-ok-border); color: var(--ffv-ok-text); }
.ffv-msg.info { background: var(--ffv-info-bg); border-color: var(--ffv-info-border); color: var(--ffv-info-text); }
.ffv-code { display: block; width: 100%; max-width: 260px; margin: 8px auto 16px; padding: 12px; box-sizing: border-box;
  font-size: 2rem; font-weight: 700; letter-spacing: 0.5em; text-indent: 0.5em; text-align: center;
  font-family: 'Courier New', Courier, monospace; color: var(--ffv-text); background: var(--ffv-field);
  border: 1px solid var(--ffv-border); border-radius: 10px; }
.ffv-code:focus { outline: none; border-color: var(--ffv-accent); box-shadow: 0 0 0 3px rgba(1, 88, 201, 0.2); }
.ffv-primary { width: 100%; padding: 12px 16px; border: 0; border-radius: 8px; font-size: 0.9rem; font-weight: 600;
  color: #ffffff; background: var(--ffv-accent); cursor: pointer; }
.ffv-primary:disabled, .ffv-link:disabled { opacity: 0.5; cursor: not-allowed; }
.ffv-turnstile { display: flex; justify-content: center; margin-top: 16px; }
.ffv-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 16px; }
.ffv-link { background: none; border: 0; padding: 4px 0; font-size: 0.875rem; font-weight: 500;
  color: var(--ffv-accent); cursor: pointer; }
html.dark .ffv-link { color: var(--azul-claro, #5EC6FF); }
`;

function injectStyle() {
    if (document.getElementById('ffv-style')) return;
    const s = document.createElement('style');
    s.id = 'ffv-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
}

function el(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
}

export function mountVerifyStep(container, { email, autoResend = false, onVerified, onChangeEmail }) {
    injectStyle();
    container.textContent = '';
    const root = el('div', { class: 'ffv' });
    root.appendChild(el('h3', {}, 'Verifica tu email'));
    const intro = el('p');
    intro.append('Introduce el código que hemos enviado a ', el('strong', {}, email), '.');
    root.appendChild(intro);
    root.appendChild(el('p', {}, 'Caduca en 10 minutos. Si no lo ves, revisa la carpeta de spam.'));
    const msg = el('div', { class: 'ffv-msg', role: 'alert', 'aria-live': 'polite', hidden: '' });
    root.appendChild(msg);
    const form = el('form', { novalidate: '' });
    const input = el('input', {
        id: 'ffv-code', name: 'code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
        maxlength: '6', pattern: '[0-9]{6}', placeholder: '······', class: 'ffv-code', 'aria-label': 'Código de 6 dígitos'
    });
    const verifyBtn = el('button', { type: 'submit', class: 'ffv-primary' }, 'Verificar');
    form.append(input, verifyBtn);
    root.appendChild(form);
    const tsBox = el('div', { class: 'ffv-turnstile' });
    root.appendChild(tsBox);
    const actions = el('div', { class: 'ffv-actions' });
    const resendBtn = el('button', { type: 'button', class: 'ffv-link' }, 'Reenviar código');
    const changeBtn = el('button', { type: 'button', class: 'ffv-link' }, 'Cambiar email');
    actions.append(resendBtn, changeBtn);
    root.appendChild(actions);
    container.appendChild(root);

    // Turnstile solo hace falta para reenviar (si está activo en config.js)
    const turnstile = (window.FFTurnstile && window.FFTurnstile.enabled()) ? window.FFTurnstile.mount(tsBox) : null;

    let timer = null;
    let busy = false;
    let done = false;

    function show(kind, text) {
        msg.className = 'ffv-msg ' + kind;
        msg.textContent = text;
        msg.hidden = false;
    }
    // Con hora límite (no contando ticks): los navegadores frenan los temporizadores
    // en pestañas en segundo plano.
    function startCountdown(seconds) {
        clearInterval(timer);
        const until = Date.now() + seconds * 1000;
        const tick = () => {
            const left = Math.ceil((until - Date.now()) / 1000);
            if (left <= 0) {
                clearInterval(timer);
                resendBtn.disabled = false;
                resendBtn.textContent = 'Reenviar código';
                return;
            }
            resendBtn.disabled = true;
            resendBtn.textContent = `Reenviar código (${left} s)`;
        };
        tick();
        timer = setInterval(tick, 1000);
    }
    // Espera a que Turnstile entregue un token (modo Managed suele resolverse solo)
    function waitTurnstile(timeoutMs) {
        return new Promise((resolve) => {
            const t0 = Date.now();
            (function poll() {
                const tok = turnstile.token();
                if (tok || done || Date.now() - t0 > timeoutMs) return resolve(tok);
                setTimeout(poll, 300);
            })();
        });
    }

    async function resend(auto) {
        if (busy) return;
        let token = null;
        if (turnstile) {
            token = auto ? await waitTurnstile(20000) : turnstile.token();
            if (!token) {
                resendBtn.disabled = false;
                resendBtn.textContent = 'Reenviar código';
                show(auto ? 'info' : 'err', auto
                    ? 'Completa la verificación anti-bots y pulsa «Reenviar código» para recibir un código nuevo.'
                    : 'Completa la verificación anti-bots para reenviar el código.');
                return;
            }
        }
        busy = true;
        resendBtn.disabled = true;
        const r = await DataClient.resendCode(email, token);
        busy = false;
        if (turnstile) turnstile.reset();
        if (done) return;
        if (r.success) {
            input.value = '';
            show('info', 'Si tu cuenta está pendiente de verificar, te hemos enviado un código nuevo. Puede tardar un minuto en llegar.');
            startCountdown(RESEND_SECONDS);
            input.focus();
        } else {
            resendBtn.disabled = false;
            show('err', r.error || 'No se pudo reenviar el código. Inténtalo de nuevo.');
        }
    }

    async function verify() {
        const code = input.value.replace(/\D/g, '');
        if (code.length !== 6) {
            show('err', 'Introduce los 6 dígitos del código.');
            input.focus();
            return;
        }
        if (busy) return;
        busy = true;
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verificando...';
        const r = await Auth.verifyEmail(email, code);
        busy = false;
        if (r.success) {
            done = true;
            clearInterval(timer);
            input.disabled = true;
            resendBtn.disabled = true;
            changeBtn.disabled = true;
            verifyBtn.textContent = 'Verificado';
            if (onVerified) onVerified(api);
            return;
        }
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verificar';
        show('err', r.error || 'No se pudo verificar el código.');
        if (r.expired) {
            input.value = '';
        } else {
            input.select();
        }
        input.focus();
    }

    input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '').slice(0, 6);
        if (digits !== input.value) input.value = digits;
        // Al completar los 6 dígitos (tecleados, pegados o autocompletados) se verifica solo
        if (digits.length === 6 && !busy) verify();
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); verify(); });
    resendBtn.addEventListener('click', () => resend(false));
    changeBtn.addEventListener('click', () => { if (onChangeEmail) onChangeEmail(); });

    const api = {
        showSuccess(text) { show('ok', text); },
        destroy() {
            done = true;
            clearInterval(timer);
            container.textContent = '';
        }
    };

    if (autoResend) {
        resendBtn.disabled = true;
        show('info', 'Te estamos enviando un código nuevo...');
        resend(true);
    } else {
        startCountdown(RESEND_SECONDS);
    }
    input.focus();
    return api;
}
