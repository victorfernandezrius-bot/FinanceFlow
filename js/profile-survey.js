// Cuestionario de perfil opcional (se muestra una sola vez, tras el registro).
// showProfileSurvey({ save }) abre el modal y devuelve una promesa que se resuelve con
// 'completed' (respuestas guardadas) o 'skipped' (pulsó «Saltar» o Escape: no se guarda nada).
//  - save(answers) → Promise<{ success, error? }> (DataClient.saveProfileSurvey).
// Sin scripts externos ni cookies: las respuestas van solo al Worker (D1).
// Los valores (value) deben coincidir con PROFILE_SURVEY_OPTIONS de api/worker.js:
// si cambias una opción, cambia ambos. Colores con variables CSS (modo oscuro: html.dark).

export const PROFILE_SURVEY_QUESTIONS = [
    {
        field: 'age_range',
        label: '¿Qué edad tienes?',
        options: [
            ['18_24', '18–24'], ['25_34', '25–34'], ['35_44', '35–44'],
            ['45_54', '45–54'], ['55_64', '55–64'], ['65_mas', '65 o más']
        ]
    },
    {
        field: 'life_situation',
        label: '¿Cuál es tu situación actual?',
        options: [
            ['estudiante', 'Estudio'], ['cuenta_ajena', 'Trabajo por cuenta ajena'],
            ['autonomo', 'Autónomo/a o freelance'], ['empresario', 'Tengo una empresa'],
            ['desempleado', 'Busco empleo'], ['jubilado', 'Jubilado/a']
        ]
    },
    {
        field: 'main_goal',
        label: '¿Qué quieres conseguir con Finance Flow?',
        options: [
            ['controlar_gastos', 'Saber en qué se me va el dinero'], ['ahorrar', 'Ahorrar más cada mes'],
            ['salir_deudas', 'Salir de deudas'], ['objetivo_concreto', 'Ahorrar para algo concreto (casa, viaje…)'],
            ['invertir', 'Empezar a invertir'], ['finanzas_negocio', 'Separar mis finanzas personales y las de mi negocio']
        ]
    },
    {
        field: 'monthly_income_range',
        label: '¿Cuánto ingresas al mes? (neto, aproximado)',
        options: [
            ['menos_1000', 'Menos de 1.000 €'], ['1000_1500', '1.000 – 1.500 €'], ['1500_2500', '1.500 – 2.500 €'],
            ['2500_4000', '2.500 – 4.000 €'], ['mas_4000', 'Más de 4.000 €'], ['prefiero_no_decirlo', 'Prefiero no decirlo']
        ]
    },
    {
        field: 'current_method',
        label: '¿Cómo llevas tus cuentas ahora mismo?',
        options: [
            ['nada', 'No llevo ningún control'], ['de_cabeza', 'De cabeza'], ['papel', 'En papel o libreta'],
            ['hoja_calculo', 'En Excel o Google Sheets'], ['app_banco', 'Con la app de mi banco'],
            ['otra_app', 'Con otra app de finanzas']
        ]
    }
];

const STYLE = `
.ffps-overlay { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(0, 0, 0, 0.5); }
.ffps { --ffps-on-brand: #ffffff; --ffps-err: #b91c1c; --ffps-ok: #15803d;
  display: flex; flex-direction: column; width: 100%; max-width: 36rem; max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px); overflow: hidden; background: var(--bg-elevated, var(--bg-primary, #ffffff));
  color: var(--text-primary, #111827); border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-card, 12px); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25); }
html.dark .ffps { --ffps-on-brand: #0b1220; --ffps-err: #fca5a5; --ffps-ok: #86efac; }
.ffps:focus { outline: none; }
.ffps-head { padding: 20px 20px 12px; border-bottom: 1px solid var(--border-color, #e5e7eb); }
.ffps .ffps-kicker { margin: 0 0 4px; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--brand-primary, #0158c9); }
.ffps .ffps-head h2 { margin: 0 0 6px; font-family: var(--font-display, inherit); font-size: 1.25rem; font-weight: 700;
  line-height: 1.25; color: var(--text-primary, #111827); }
.ffps .ffps-head p.ffps-sub { margin: 0; font-size: 0.875rem; line-height: 1.5; color: var(--text-secondary, #374151); }
.ffps-body { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 2px 20px 16px; }
.ffps-body fieldset { margin: 18px 0 0; padding: 0; border: 0; min-width: 0; }
.ffps .ffps-body legend { padding: 0; margin-bottom: 10px; font-size: 0.95rem; font-weight: 600; color: var(--text-primary, #111827); }
.ffps-options { display: flex; flex-wrap: wrap; gap: 8px; }
.ffps-opt { position: relative; display: inline-flex; cursor: pointer; }
.ffps-opt input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.ffps-opt span { display: inline-block; padding: 8px 12px; font-size: 0.875rem; line-height: 1.3;
  border: 1px solid var(--border-color, #d1d5db); border-radius: 999px; color: var(--text-primary, #111827);
  background: var(--bg-secondary, #f9fafb); transition: background-color .15s, border-color .15s, color .15s; }
.ffps-opt:hover span { border-color: var(--brand-primary, #0158c9); }
.ffps-opt input:checked + span { background: var(--brand-primary, #0158c9); border-color: var(--brand-primary, #0158c9);
  color: var(--ffps-on-brand); font-weight: 600; }
.ffps-opt input:focus-visible + span { outline: 2px solid var(--brand-primary, #0158c9); outline-offset: 2px; }
.ffps-foot { padding: 12px 20px 16px; border-top: 1px solid var(--border-color, #e5e7eb);
  background: var(--bg-elevated, var(--bg-primary, #ffffff)); }
.ffps .ffps-msg { margin: 0 0 10px; font-size: 0.85rem; color: var(--ffps-err); }
.ffps .ffps-msg.ok { color: var(--ffps-ok); }
.ffps .ffps-privacy a { color: var(--brand-primary, #0158c9); text-decoration: underline; }
.ffps .ffps-privacy { margin: 0 0 12px; font-size: 0.75rem; line-height: 1.45; color: var(--text-secondary, #6b7280); }
.ffps-actions { display: flex; gap: 10px; align-items: center; }
.ffps-actions .ffps-progress { margin-right: auto; font-size: 0.8rem; color: var(--text-secondary, #6b7280); }
.ffps-btn { padding: 10px 16px; border-radius: var(--radius-control, 8px); font-size: 0.9rem; font-weight: 600; cursor: pointer; }
.ffps-skip { background: transparent; color: var(--text-primary, #111827); border: 1px solid var(--border-color, #d1d5db); }
.ffps-skip:hover { background: var(--bg-secondary, #f3f4f6); }
.ffps-send { background: var(--brand-primary, #0158c9); color: var(--ffps-on-brand); border: 1px solid transparent; }
.ffps-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ffps-btn:focus-visible { outline: 2px solid var(--brand-primary, #0158c9); outline-offset: 2px; }
@media (max-width: 480px) {
  .ffps-overlay { padding: 12px; align-items: flex-end; }
  .ffps { max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); }
  .ffps-head { padding: 16px 16px 10px; }
  .ffps-body { padding: 0 16px 14px; }
  .ffps-foot { padding: 10px 16px 14px; }
  .ffps-actions .ffps-progress { display: none; }
  .ffps-actions .ffps-btn { flex: 1; }
}
`;

function injectStyle() {
    if (document.getElementById('ffps-style')) return;
    const s = document.createElement('style');
    s.id = 'ffps-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
}

function el(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
}

export function showProfileSurvey({ save }) {
    if (document.getElementById('ffps-overlay')) return Promise.resolve('skipped');
    injectStyle();

    return new Promise((resolve) => {
        const total = PROFILE_SURVEY_QUESTIONS.length;
        const overlay = el('div', { id: 'ffps-overlay', class: 'ffps-overlay' });
        const card = el('div', { class: 'ffps', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ffps-title', tabindex: '-1' });

        const head = el('div', { class: 'ffps-head' });
        head.append(
            el('div', { class: 'ffps-kicker' }, 'Opcional · menos de 1 minuto'),
            el('h2', { id: 'ffps-title' }, 'Cuéntanos un poco sobre ti'),
            el('p', { class: 'ffps-sub' },
                'Nos ayuda a adaptar Finance Flow a lo que necesitas. Si prefieres no responder, pulsa «Saltar»: no cambia nada en tu cuenta.')
        );

        const form = el('form', { id: 'ffps-form', class: 'ffps-body', novalidate: '' });
        PROFILE_SURVEY_QUESTIONS.forEach((q, i) => {
            const fs = el('fieldset');
            fs.appendChild(el('legend', {}, `${i + 1}. ${q.label}`));
            const opts = el('div', { class: 'ffps-options' });
            for (const [value, label] of q.options) {
                const lab = el('label', { class: 'ffps-opt' });
                const input = el('input', { type: 'radio', name: q.field, value });
                lab.append(input, el('span', {}, label));
                opts.appendChild(lab);
            }
            fs.appendChild(opts);
            form.appendChild(fs);
        });

        const foot = el('div', { class: 'ffps-foot' });
        // div (no p): el dashboard fuerza el color de los <p> en modo oscuro con !important
        const msg = el('div', { class: 'ffps-msg', role: 'alert', 'aria-live': 'polite', hidden: '' });
        const privacy = el('p', { class: 'ffps-privacy' },
            'Tus respuestas se guardan solo en tu cuenta de Finance Flow, sin cookies, y no se comparten con terceros. Puedes borrarlas cuando quieras desde Mi Perfil. ');
        const privacyUrl = (window.APP_CONFIG && window.APP_CONFIG.privacyUrl) ||
            'https://www.contabilidadpersonal.com/politica-de-privacidad/';
        privacy.append(el('a', { href: privacyUrl, target: '_blank', rel: 'noopener' }, 'Política de privacidad'), '.');
        const actions = el('div', { class: 'ffps-actions' });
        const progress = el('span', { class: 'ffps-progress', 'aria-live': 'polite' }, `0 de ${total} respondidas`);
        const skipBtn = el('button', { type: 'button', class: 'ffps-btn ffps-skip' }, 'Saltar');
        const sendBtn = el('button', { type: 'submit', form: 'ffps-form', class: 'ffps-btn ffps-send', disabled: '' }, 'Enviar');
        actions.append(progress, skipBtn, sendBtn);
        foot.append(msg, privacy, actions);

        card.append(head, form, foot);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        let busy = false;
        let closed = false;

        const answers = () => {
            const out = {};
            for (const q of PROFILE_SURVEY_QUESTIONS) {
                const checked = form.querySelector(`input[name="${q.field}"]:checked`);
                if (checked) out[q.field] = checked.value;
            }
            return out;
        };
        const refresh = () => {
            const n = Object.keys(answers()).length;
            progress.textContent = `${n} de ${total} respondidas`;
            sendBtn.disabled = busy || n < total;
        };
        const close = (result) => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            document.body.style.overflow = prevOverflow;
            resolve(result);
        };
        const onKey = (e) => { if (e.key === 'Escape' && !busy) close('skipped'); };

        form.addEventListener('change', () => { msg.hidden = true; refresh(); });
        skipBtn.addEventListener('click', () => { if (!busy) close('skipped'); });
        document.addEventListener('keydown', onKey);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = answers();
            if (busy || Object.keys(data).length < total) return;
            busy = true;
            skipBtn.disabled = true;
            sendBtn.textContent = 'Guardando…';
            refresh();
            let result;
            try { result = await save(data); } catch (err) { result = { success: false }; }
            if (result && result.success) {
                msg.className = 'ffps-msg ok';
                msg.textContent = '¡Gracias! Ya lo tenemos.';
                msg.hidden = false;
                setTimeout(() => close('completed'), 900);
                return;
            }
            busy = false;
            skipBtn.disabled = false;
            sendBtn.textContent = 'Enviar';
            msg.className = 'ffps-msg';
            msg.textContent = (result && result.error) || 'No se han podido guardar tus respuestas. Inténtalo de nuevo o pulsa «Saltar».';
            msg.hidden = false;
            refresh();
        });

        // Foco en el diálogo (teclado / lectores de pantalla), sin marcar ninguna opción
        card.focus({ preventScroll: true });
    });
}
