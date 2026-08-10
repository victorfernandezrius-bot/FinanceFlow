/* ============================================================
   Sistema de Iconos Flow — FinanceFlow
   Sustituye Font Awesome preservando clases, estilos y colores.
   No modifica ningún estilo existente de la app.
   ============================================================ */
(function () {
  'use strict';
  if (window.FlowIcons) return;

  var CSS = [
    '.ff{width:1em;height:1em;display:inline-block;vertical-align:-.125em;',
    'fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;',
    'stroke-linejoin:round;flex-shrink:0;overflow:visible}',
    '.ff-fw{width:1.25em}',
    '.fa-xs{font-size:.75em}.fa-sm{font-size:.875em}.fa-lg{font-size:1.33em}',
    '.fa-2x{font-size:2em}.fa-3x{font-size:3em}.fa-4x{font-size:4em}.fa-5x{font-size:5em}',
    '@keyframes ff-spin{to{transform:rotate(360deg)}}',
    '.ff-spin{animation:ff-spin 1.15s linear infinite;transform-origin:50% 50%}',
    '@media (prefers-reduced-motion:reduce){.ff-spin{animation:none}}'
  ].join('');

  var ICONS = {
  'flow-dashboard': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="M12 12l4.2-4.2"/><circle cx="12" cy="12" r="1.4" opacity=".42"/>',
  'flow-accounts': '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M11.72 8.81A3.2 3.2 0 1 0 14.26 9.74"/><path d="M12 12l2.3-2.3" opacity=".42"/>',
  'flow-movements': '<path d="M4 8.5h12.5"/><path d="m13.5 5.5 3 3-3 3"/><path d="M20 15.5H7.5"/><path d="m10.5 12.5-3 3 3 3" opacity=".42"/>',
  'flow-reports': '<path d="M4.4 12.4 5.4 6.6l4 .7-.6 5.1"/><path d="M6.3 8.9l2.4.42M6.05 10.7l2.4.42" opacity=".42"/><path d="M19.6 12.4 18.6 6.6l-4 .7.6 5.1"/><path d="M17.7 8.9l-2.4.42M17.95 10.7l-2.4.42" opacity=".42"/><path d="M2.8 12.4h18.4v6.1a1.9 1.9 0 0 1-1.9 1.9H4.7a1.9 1.9 0 0 1-1.9-1.9v-6.1Z"/><path d="M10.2 12.4v-1a1.7 1.7 0 0 1 1.7-1.7h.2a1.7 1.7 0 0 1 1.7 1.7v1"/>',
  'flow-scenarios': '<path d="M4 12h4.5"/><path d="M8.5 12c3.2 0 3.2-5.5 6.4-5.5H20"/><path d="M8.5 12c3.2 0 3.2 5.5 6.4 5.5H20" opacity=".42"/><circle cx="8.5" cy="12" r="1.5"/>',
  'flow-autocontrol': '<path d="M17.14 5.87A8 8 0 0 0 6.86 5.87"/><path d="M5.87 6.86A8 8 0 0 0 5.87 17.14"/><path d="M6.86 18.13A8 8 0 0 0 17.14 18.13"/><path d="M18.13 17.14A8 8 0 0 0 18.13 6.86"/><circle cx="12" cy="12" r="1.6" opacity=".42"/>',
  'flow-rules': '<path d="M3.5 5h17l-6.6 7.6v5.9l-3.8 2.1v-8L3.5 5Z"/><path d="M8 8.2h8" opacity=".42"/>',
  'flow-bell': '<path d="M6.5 16.5v-4.9a5.5 5.5 0 0 1 11 0v4.9"/><path d="M4.5 16.5h15"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0" opacity=".42"/>',
  'flow-bell-off': '<path d="M6.5 16.5v-4.9a5.5 5.5 0 0 1 11 0v4.9" opacity=".42"/><path d="M4.5 16.5h15" opacity=".42"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0" opacity=".42"/><path d="M3.8 20.2 20.2 3.8"/>',
  'flow-push': '<rect x="3.8" y="3.2" width="11" height="17.6" rx="2.2"/><path d="M7.5 6.4h3.6" opacity=".42"/><path d="M7.7 18h3.2" opacity=".42"/><path d="M17.08 10.11A2.4 2.4 0 0 1 17.08 13.89"/><path d="M18.43 8.38A4.6 4.6 0 0 1 18.43 15.62" opacity=".42"/>',
  'flow-patrimonio': '<path d="M2.6 10.4 12 4.2l9.4 6.2Z"/><path d="M5.8 10.4v7.4M9.4 10.4v7.4M14.6 10.4v7.4M18.2 10.4v7.4"/><path d="M10.7 17.8v-2.5a1.3 1.3 0 0 1 2.6 0v2.5" opacity=".42"/><path d="M4 17.8h16"/><path d="M3 19.9h18" opacity=".42"/>',
  'flow-cash': '<rect x="2" y="5.4" width="14.6" height="8.2" rx="1.8"/><path d="M9.06 7.51A2.2 2.2 0 1 0 10.81 8.14"/><path d="M17.13 12.32A4.2 4.2 0 1 0 20.47 13.53"/><path d="M17.5 14.4v4" opacity=".42"/>',
  'flow-wallet': '<path d="M4.6 9.4V5.6a1.7 1.7 0 0 1 2.14-1.64l6.8 1.8V9.4"/><path d="M7.6 9.4V8.4a1.3 1.3 0 0 1 1.64-1.26l7.9 2.26" opacity=".42"/><rect x="2.6" y="9.4" width="18.8" height="11.2" rx="2.2"/><path d="M21.4 13.4h-4.3a2 2 0 0 0 0 4h4.3"/><circle cx="17.4" cy="15.4" r=".55"/>',
  'flow-fixed-cost': '<path d="M6.6 8.6a5.4 5.4 0 0 1 10.8 0"/><path d="M15.4 8 17.4 8.6 18 6.6"/><path d="M4 19.25h16" opacity=".42"/><path d="M7 19v-6"/><path d="M12 19v-6"/><path d="M17 19v-6"/>',
  'flow-monthly': '<path d="M3.6 4.4v15.2h16.8" opacity=".42"/><path d="m6.4 15.4 3.5-4.1 3.5 2.6 5.2-6.5"/><circle cx="9.9" cy="11.3" r="1.05" opacity=".42"/><circle cx="13.4" cy="13.9" r="1.05" opacity=".42"/><circle cx="18.6" cy="7.4" r="1.15"/>',
  'flow-asset': '<path d="M12 3.5 20.5 8v8L12 20.5 3.5 16V8L12 3.5Z"/><path d="M12 12 20.5 8" opacity=".42"/><path d="M12 12v8.5" opacity=".42"/><path d="M12 12 3.5 8" opacity=".42"/>',
  'flow-liability': '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M6.5 14.5h4" opacity=".42"/>',
  'flow-equity': '<path d="M6 4h12l3.5 5-9.5 11L2.5 9 6 4Z"/><path d="M2.5 9h19" opacity=".42"/><path d="M9.5 9 12 20" opacity=".42"/><path d="M14.5 9 12 20" opacity=".42"/>',
  'flow-unknown': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="M9.8 10.1a2.3 2.3 0 1 1 2.9 2.6c-.5.2-.7.6-.7 1.1v.5" opacity=".42"/><path d="M12 16.9h.01" opacity=".42"/>',
  'flow-in': '<path d="M12 19.5V6.2"/><path d="m6.9 11.3 5.1-5.1 5.1 5.1"/><path d="M7.5 19.5h9" opacity=".42"/>',
  'flow-out': '<path d="M12 4.5v13.3"/><path d="m6.9 12.7 5.1 5.1 5.1-5.1"/><path d="M7.5 4.5h9" opacity=".42"/>',
  'flow-transfer': '<path d="M6.5 9.2h11"/><path d="m14.8 6.5 2.7 2.7-2.7 2.7"/><path d="M17.5 14.8h-11" opacity=".42"/><path d="m9.2 12.1-2.7 2.7 2.7 2.7" opacity=".42"/>',
  'flow-equal': '<path d="M5.2 9.4h13.6"/><path d="M5.2 14.6h13.6"/>',
  'flow-insight': '<path d="M9.8 13.9a3.8 3.8 0 1 1 4.4 0v1.7H9.8v-1.7Z"/><path d="M10.3 15.6v1.7a1.35 1.35 0 0 0 1.35 1.35h.7a1.35 1.35 0 0 0 1.35-1.35v-1.7"/><path d="M10.3 17.2h3.4" opacity=".42"/><path d="m11 10.5 1 1.5 1-1.5" opacity=".42"/><path d="M12 5.4V3.2"/><path d="m15.47 6.66 1.42-1.68"/><path d="M8.53 6.66 7.11 4.98"/><path d="m17.22 9.4 2.12-.57"/><path d="M6.78 9.4 4.66 8.83"/>',
  'flow-journal': '<circle cx="5" cy="7" r="1.3"/><path d="M9.5 7h10"/><circle cx="5" cy="12" r="1.3"/><path d="M9.5 12h10"/><circle cx="5" cy="17" r="1.3" opacity=".42"/><path d="M9.5 17h6.5" opacity=".42"/>',
  'flow-ledger': '<path d="M4.5 4.5h13a2 2 0 0 1 2 2v13H6.5a2 2 0 0 1-2-2v-13Z"/><path d="M4.5 17.5a2 2 0 0 1 2-2h13" opacity=".42"/><path d="M9 8.5h6" opacity=".42"/>',
  'flow-balance': '<path d="M12 5v14.5"/><path d="M5 8.2h14"/><path d="M2.6 13.4a3.4 3.4 0 0 0 6.8 0"/><path d="M6 8.2 2.6 13.4M6 8.2l3.4 5.2" opacity=".42"/><path d="M14.6 13.4a3.4 3.4 0 0 0 6.8 0"/><path d="M18 8.2l-3.4 5.2M18 8.2l3.4 5.2" opacity=".42"/><path d="M8.5 19.5h7"/>',
  'flow-income-statement': '<path d="M3.6 6.4h3M5.1 4.9v3"/><path d="M9.4 6.4h11"/><path d="M3.6 11.2h3"/><path d="M9.4 11.2h8" opacity=".42"/><path d="M3.2 14.8h17.6"/><path d="M3.6 17.7h3M3.6 20.1h3"/><path d="M9.4 18.9h9.4"/>',
  'flow-export': '<path d="M2.4 10.6h11.8v6a1.8 1.8 0 0 1-1.8 1.8H4.2a1.8 1.8 0 0 1-1.8-1.8v-6Z"/><path d="M6.1 10.6V9.4a1.6 1.6 0 0 1 1.6-1.6h1.2a1.6 1.6 0 0 1 1.6 1.6v1.2"/><path d="M7.4 13.8h1.8" opacity=".42"/><path d="M19 6.4v9.4"/><path d="m16 12.8 3 3 3-3"/>',
  'flow-import': '<path d="M2.4 10.6h11.8v6a1.8 1.8 0 0 1-1.8 1.8H4.2a1.8 1.8 0 0 1-1.8-1.8v-6Z"/><path d="M6.1 10.6V9.4a1.6 1.6 0 0 1 1.6-1.6h1.2a1.6 1.6 0 0 1 1.6 1.6v1.2"/><path d="M7.4 13.8h1.8" opacity=".42"/><path d="M19 15.8V6.4"/><path d="m16 9.4 3-3 3 3"/>',
  'flow-file-data': '<path d="M6 3.5h7L18 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V3.5Z"/><path d="M13 3.5v5h5" opacity=".42"/><path d="M8.8 12.8h6.4M8.8 16.3h6.4M12 12.8v3.5" opacity=".42"/>',
  'flow-analysis': '<path d="M9.86 4.22A6.2 6.2 0 1 0 14.78 6.02"/><path d="M7.8 13.4v-2.4M10.4 13.4v-4.4M13 13.4v-3.2" opacity=".42"/><path d="M14.78 14.78 20.6 20.6"/>',
  'flow-premium': '<path d="M3.5 7.2 7.1 11.8 12 4.2l4.9 7.6 3.6-4.6-1.7 10.6H5.2L3.5 7.2Z"/><path d="M6.4 16.2h11.2" opacity=".42"/>',
  'flow-trial': '<path d="M12 3.8 14.6 9.1l5.8.85-4.2 4.1 1 5.75L12 17.1l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85L12 3.8Z"/>',
  'flow-locked': '<rect x="4.5" y="10.5" width="15" height="9.2" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14v2.4" opacity=".42"/>',
  'flow-unlock': '<rect x="4.5" y="10.5" width="15" height="9.2" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/><path d="M12 14v2.4" opacity=".42"/>',
  'flow-success': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="m8.2 12.2 2.7 2.7 5.4-5.6"/>',
  'flow-error': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="M12 8.2v4.6"/><path d="M12 16h.01"/>',
  'flow-info': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="M12 16.2v-4.6"/><path d="M12 8.4h.01"/>',
  'flow-warning': '<path d="M12 4.4 20.8 19.4H3.2L12 4.4Z"/><path d="M12 10.2v4.2"/><path d="M12 17.2h.01"/>',
  'flow-help': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="M9.8 10.1a2.3 2.3 0 1 1 2.9 2.6c-.5.2-.7.6-.7 1.1v.5"/><path d="M12 16.9h.01"/>',
  'flow-offline': '<path d="M4 9.2a12 12 0 0 1 16 0" opacity=".42"/><path d="M7.4 12.6a7.2 7.2 0 0 1 9.2 0" opacity=".42"/><path d="M12 17.6h.01"/><path d="M3.6 20.4 20.4 3.6"/>',
  'flow-retry': '<path d="M19.4 10.4A7.7 7.7 0 0 0 5.9 7.4"/><path d="M4.6 13.6a7.7 7.7 0 0 0 13.5 3"/><path d="M20 5.6v4.8h-4.8"/><path d="M4 18.4v-4.8h4.8" opacity=".42"/>',
  'flow-add': '<path d="M12 4.8v14.4"/><path d="M4.8 12h14.4"/>',
  'flow-add-circle': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="M12 8v8M8 12h8"/>',
  'flow-minus-circle': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="M8 12h8"/>',
  'flow-close': '<path d="M6.8 6.8 17.2 17.2"/><path d="M17.2 6.8 6.8 17.2"/>',
  'flow-check': '<path d="m4.8 12.6 4.6 4.6L19.2 6.8"/>',
  'flow-check-double': '<path d="m2.4 12.6 3.8 3.8 6.6-7"/><path d="m9.6 16.4 1.6 1.6 9.2-9.6" opacity=".42"/>',
  'flow-prev': '<path d="M19.5 12H5"/><path d="m10.4 6.4-5.4 5.6 5.4 5.6"/>',
  'flow-next': '<path d="M4.5 12H19"/><path d="m13.6 6.4 5.4 5.6-5.4 5.6"/>',
  'flow-chevron': '<path d="m9.2 5.4 6.8 6.6-6.8 6.6"/>',
  'flow-edit': '<path d="M4.5 19.5h4l10.2-10.2a2.15 2.15 0 0 0-3-3L5.5 16.5v3Z"/><path d="m14.7 5.7 3 3" opacity=".42"/>',
  'flow-delete': '<path d="M4.5 6.6h15"/><path d="M9.2 6.6V4.9h5.6v1.7"/><path d="M6.6 6.6 7.6 19a1.6 1.6 0 0 0 1.6 1.5h5.6a1.6 1.6 0 0 0 1.6-1.5l1-12.4"/><path d="M10.6 10.4v6M13.4 10.4v6" opacity=".42"/>',
  'flow-copy': '<rect x="8.4" y="8.4" width="12" height="12" rx="2"/><path d="M15.6 8.4V5.6a2 2 0 0 0-2-2H5.6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2.8" opacity=".42"/>',
  'flow-save': '<path d="M4.6 3.6h11.4L20.4 8v12.4H4.6V3.6Z"/><path d="M8.2 3.6h7.2v5.2H8.2V3.6Z" opacity=".42"/><path d="M7.6 13.2h8.8v7.2H7.6v-7.2Z"/>',
  'flow-eye': '<path d="M2.5 12S6 5.9 12 5.9 21.5 12 21.5 12 18 18.1 12 18.1 2.5 12 2.5 12Z"/><path d="M11.74 9.01A3 3 0 1 0 14.12 9.88"/>',
  'flow-eye-off': '<path d="M2.5 12S6 5.9 12 5.9 21.5 12 21.5 12 18 18.1 12 18.1 2.5 12 2.5 12Z" opacity=".42"/><path d="M11.74 9.01A3 3 0 1 0 14.12 9.88" opacity=".42"/><path d="M3.8 20.2 20.2 3.8"/>',
  'flow-signup': '<path d="M9.66 4.12A3.9 3.9 0 1 0 12.76 5.24"/><path d="M2.8 20.4a7.2 7.2 0 0 1 14.4 0" opacity=".42"/><path d="M19.6 4.4v4.6M17.3 6.7h4.6"/>',
  'flow-user': '<path d="M11.66 4.52A3.9 3.9 0 1 0 14.76 5.64"/><path d="M4.8 20.6a7.2 7.2 0 0 1 14.4 0" opacity=".42"/>',
  'flow-signin': '<path d="M13.4 3.6h4.6a2 2 0 0 1 2 2v12.8a2 2 0 0 1-2 2h-4.6" opacity=".42"/><path d="M3.6 12h10.4"/><path d="m10.4 8.4 3.6 3.6-3.6 3.6"/>',
  'flow-signout': '<path d="M10.6 3.6H6a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h4.6" opacity=".42"/><path d="M20.4 12H10"/><path d="m17 8.4 3.4 3.6-3.4 3.6"/>',
  'flow-key': '<path d="M15.63 3.82A4.2 4.2 0 1 0 18.97 5.03"/><path d="M13.03 10.97 4.6 19.4"/><path d="m7.4 16.6 2.2 2.2M9.8 14.2l2 2" opacity=".42"/>',
  'flow-shield': '<path d="M12 3.2 20 6v6.2c0 4.4-3.2 7.6-8 8.6-4.8-1-8-4.2-8-8.6V6l8-2.8Z"/><path d="m8.6 12.2 2.4 2.4 4.4-4.6" opacity=".42"/>',
  'flow-light': '<path d="M11.58 7.22A4.8 4.8 0 1 0 15.39 8.61"/><path d="M12 2.2v2.2M12 19.6v2.2M2.2 12h2.2M19.6 12h2.2" opacity=".42"/><path d="m5.1 5.1 1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" opacity=".42"/>',
  'flow-dark': '<path d="M20 14.6A8.6 8.6 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6Z"/><path d="M16.4 8.2h.01M18.6 11.4h.01" opacity=".42"/>',
  'flow-menu': '<path d="M4 7h16"/><path d="M4 12h11"/><path d="M4 17h16" opacity=".42"/>',
  'flow-settings': '<path d="M3.6 8.4h5.2M12.6 8.4h7.8"/><circle cx="10.7" cy="8.4" r="1.9"/><path d="M3.6 15.6h9.4M16.8 15.6h3.6"/><circle cx="14.9" cy="15.6" r="1.9"/>',
  'flow-calendar': '<rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.2"/><path d="M3.2 10h17.6"/><path d="M8 3.4v3.4M16 3.4v3.4"/><path d="M7.4 13.4h2M11 13.4h2M14.6 13.4h2M7.4 16.8h2M11 16.8h2" opacity=".42"/>',
  'flow-calendar-check': '<rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.2"/><path d="M3.2 10h17.6"/><path d="M8 3.4v3.4M16 3.4v3.4"/><path d="m8.2 15.4 2.6 2.6 5-5.2"/>',
  'flow-clock': '<path d="M11.3 4A8 8 0 1 0 17.66 6.34"/><path d="M12 7.4V12l3.2 2.2"/>',
  'flow-mail': '<rect x="2.6" y="5" width="18.8" height="14" rx="2.2"/><path d="m3.2 7.4 7.7 5.4a2 2 0 0 0 2.2 0l7.7-5.4"/>',
  'flow-chat': '<path d="M4 5.4h16a1.8 1.8 0 0 1 1.8 1.8v8a1.8 1.8 0 0 1-1.8 1.8h-8.6L7 20.4V17H4a1.8 1.8 0 0 1-1.8-1.8v-8A1.8 1.8 0 0 1 4 5.4Z"/><path d="M8 11.2h.01M12 11.2h.01M16 11.2h.01" opacity=".42"/>',
  'flow-inbox': '<path d="M2.6 13.4 5.4 4.8a1.8 1.8 0 0 1 1.7-1.2h9.8a1.8 1.8 0 0 1 1.7 1.2l2.8 8.6" opacity=".42"/><path d="M2.6 13.4h5l1.4 2.8h6l1.4-2.8h5v5a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2v-5Z"/>',
  'flow-gift': '<rect x="2.8" y="9" width="18.4" height="4.4" rx="1.2"/><path d="M4.4 13.4v6a1.8 1.8 0 0 0 1.8 1.8h11.6a1.8 1.8 0 0 0 1.8-1.8v-6"/><path d="M12 9v12.2"/><path d="M12 9C12 9 10.6 4.6 8.6 4.6a2.2 2.2 0 0 0 0 4.4H12Z" opacity=".42"/><path d="M12 9s1.4-4.4 3.4-4.4a2.2 2.2 0 0 1 0 4.4H12Z" opacity=".42"/>',
  'flow-trophy': '<path d="M7.8 4.2h8.4v5.2a4.2 4.2 0 0 1-8.4 0V4.2Z"/><path d="M7.8 5.8H5v1.4a3.2 3.2 0 0 0 2.9 3.2" opacity=".42"/><path d="M16.2 5.8H19v1.4a3.2 3.2 0 0 1-2.9 3.2" opacity=".42"/><path d="M12 13.6v3.2"/><path d="M9 19.8h6"/><path d="M10.2 16.8h3.6v3h-3.6Z" opacity=".42"/>',
  'flow-receipt': '<path d="M4.8 3.4h14.4v17.4l-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5V3.4Z"/><path d="M8 8h8M8 11.4h8M8 14.8h4.8" opacity=".42"/>',
  'flow-savings': '<rect x="3.4" y="8" width="15.6" height="9.6" rx="4.8"/><path d="m9 8 .5-2.2 2.4 1.2" opacity=".42"/><path d="M7 17.6v2.2M15.4 17.6v2.2"/><path d="M9.4 10.2h3.6"/><circle cx="15.8" cy="11.8" r=".55"/><path d="M19 11.6h1.9v2.4H19" opacity=".42"/>',
  'flow-income-hand': '<path d="M2.8 15.4a9.2 9.2 0 0 0 18.4 0"/><path d="M2.8 15.4v2.8M21.2 15.4v2.8" opacity=".42"/><path d="M11.69 4.81A3.6 3.6 0 1 0 14.55 5.85"/><path d="M12 6.8v3.4" opacity=".42"/>',
  'flow-seedling': '<path d="M12 19.25v-6.4"/><path d="M12 12.85C12 9.7 9.55 7.25 6.4 7.25c0 3.15 2.45 5.6 5.6 5.6Z"/><path d="M12 12.85c0-3.15 2.45-5.6 5.6-5.6 0 3.15-2.45 5.6-5.6 5.6Z" opacity=".42"/><path d="M6.6 19.25h10.8" opacity=".42"/>',
  'flow-external': '<path d="M13.4 4.6h6v6"/><path d="m11.6 12.4 7.8-7.8"/><path d="M18 14v4.4a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10" opacity=".42"/>',
  'flow-play': '<path d="M6.8 4.6 19.4 12 6.8 19.4V4.6Z"/>',
  'flow-pause': '<path d="M9.2 4.8v14.4M14.8 4.8v14.4"/>',
  'flow-loading': '<path fill="currentColor" stroke="none" d="M12.74 1.09C12.72 1.13 12.68 1.15 12.66 1.19C12.58 1.3 12.62 1.44 12.62 1.57C12.86 2.05 13.16 1.82 13.55 1.91C13.69 1.95 13.85 1.93 13.99 1.96C14.34 2.04 14.7 2.08 15.06 2.17C15.89 2.37 17.16 2.88 17.87 3.39C18.13 3.58 18.39 3.78 18.65 3.96C18.94 4.18 19.62 4.74 19.82 5.02C19.97 5.21 20.15 5.43 20.32 5.6C20.58 5.86 20.76 6.23 20.98 6.52C21.08 6.67 21.13 6.85 21.23 6.98C21.82 7.8 22.15 9.31 22.38 10.28C22.5 10.77 22.51 11.51 22.51 12.03C22.51 12.39 22.53 12.78 22.44 13.12C22.38 13.4 22.4 13.74 22.34 14.02C22.2 14.6 22.02 15.46 21.8 15.98C21.48 16.76 21.13 17.59 20.62 18.29C19.12 20.37 16.85 22.32 14.21 22.32C14.16 22.27 14.2 22.08 14.2 22.0C14.2 21.69 14.22 21.38 14.22 21.06C14.22 19.81 14.27 18.54 14.27 17.3C14.36 17.21 14.79 17.1 14.92 17.06C15.27 16.98 15.96 16.56 16.26 16.35C16.71 16.02 17.16 15.61 17.48 15.16C17.59 15.01 17.68 14.82 17.79 14.67C17.92 14.49 18.11 14.14 18.16 13.92C18.21 13.7 18.3 13.49 18.36 13.27C18.39 13.11 18.38 12.94 18.42 12.78C18.47 12.57 18.5 12.08 18.45 11.86C18.42 11.72 18.44 11.57 18.41 11.42C18.34 11.15 18.28 10.87 18.21 10.6C18.12 10.22 17.85 9.68 17.62 9.36C17.42 9.09 17.22 8.83 17.02 8.56C16.91 8.4 16.74 8.29 16.6 8.15C16.1 7.65 15.22 7.1 14.52 6.94C14.25 6.87 13.99 6.78 13.72 6.72C13.55 6.68 13.36 6.7 13.19 6.66C13.06 6.63 12.82 6.62 12.73 6.72C12.61 6.83 12.6 6.93 12.53 7.07C12.53 7.33 12.68 7.51 12.93 7.57C13.07 7.6 13.23 7.57 13.37 7.6C13.63 7.66 13.93 7.7 14.17 7.8C14.87 8.09 15.22 8.3 15.83 8.74C16.13 8.95 16.39 9.29 16.6 9.58C17.6 10.98 17.86 12.95 16.82 14.41C16.61 14.69 16.38 15.04 16.1 15.24C15.67 15.56 15.26 15.9 14.75 16.11C14.37 16.26 13.98 16.36 13.59 16.46C13.53 16.47 13.49 16.55 13.43 16.58C13.43 16.65 13.35 16.72 13.33 16.8C13.3 16.96 13.33 17.19 13.33 17.36C13.33 17.72 13.32 18.08 13.32 18.45C13.32 19.46 13.27 20.47 13.27 21.48C13.27 21.72 13.21 22.51 13.25 22.67C13.29 22.84 13.27 23.02 13.44 23.14C13.66 23.3 13.89 23.28 14.15 23.28C14.69 23.28 15.19 23.2 15.7 23.08C17.93 22.55 19.92 20.97 21.27 19.09C22.21 17.78 22.84 16.23 23.21 14.67C23.27 14.39 23.3 14.11 23.37 13.83C23.41 13.65 23.37 13.46 23.42 13.29C23.49 12.96 23.55 11.82 23.48 11.5C23.43 11.3 23.5 11.08 23.45 10.89C23.32 10.35 23.31 9.51 23.09 8.97C23.04 8.86 22.91 8.38 22.88 8.25C22.77 7.78 22.24 6.66 21.96 6.28C21.81 6.07 21.7 5.82 21.55 5.6C21.0 4.85 20.37 4.03 19.61 3.48C19.47 3.38 19.35 3.25 19.22 3.15C18.66 2.75 17.97 2.25 17.34 1.99C16.62 1.69 15.93 1.4 15.18 1.22C14.97 1.17 14.76 1.16 14.55 1.11C14.29 1.05 13.25 0.91 13.01 0.97C12.9 0.99 12.84 1.04 12.74 1.09Z"/><path fill="currentColor" stroke="none" d="M11.24 22.96C11.36 22.72 11.41 22.81 11.41 22.49C11.12 21.92 10.81 22.2 10.33 22.09C10.16 22.05 9.98 22.07 9.82 22.03C9.49 21.95 9.17 21.9 8.85 21.82C8.01 21.62 6.76 21.09 6.06 20.58C5.77 20.38 5.5 20.16 5.22 19.95C4.96 19.76 4.42 19.32 4.24 19.07C3.99 18.73 3.67 18.44 3.42 18.1C3.25 17.86 3.11 17.6 2.94 17.37C2.82 17.2 2.72 16.99 2.65 16.81C2.48 16.42 2.21 16.06 2.11 15.65C2.02 15.27 1.86 14.91 1.77 14.53C1.7 14.2 1.66 13.86 1.58 13.53C1.53 13.33 1.58 13.11 1.53 12.9C1.41 12.4 1.46 11.12 1.58 10.62C1.62 10.46 1.6 10.28 1.64 10.11C1.72 9.76 1.79 9.4 1.87 9.05C1.97 8.64 2.16 8.26 2.26 7.86C2.33 7.54 2.91 6.42 3.12 6.13C3.45 5.68 3.71 5.15 4.11 4.75C4.48 4.39 4.86 4.0 5.23 3.64C5.48 3.39 6.08 2.92 6.4 2.79C6.6 2.7 6.97 2.42 7.22 2.31C8.03 1.98 8.85 1.68 9.74 1.68C9.81 1.75 9.78 1.91 9.78 2.0C9.78 2.28 9.77 2.56 9.77 2.85C9.77 3.77 9.73 4.67 9.73 5.59C9.73 5.86 9.72 6.12 9.72 6.39C9.72 6.48 9.75 6.64 9.71 6.73C9.6 6.84 9.23 6.88 9.08 6.95C8.73 7.09 8.32 7.26 8.01 7.48C7.17 8.09 6.39 8.8 5.98 9.77C5.93 9.91 5.82 10.06 5.79 10.21C5.71 10.54 5.64 10.87 5.56 11.21C5.5 11.45 5.54 12.27 5.59 12.52C5.64 12.72 5.66 12.94 5.7 13.15C5.95 14.2 6.73 15.42 7.62 16.06C7.96 16.3 8.49 16.76 8.91 16.86C9.1 16.9 9.31 17.07 9.51 17.11C9.67 17.15 9.81 17.19 9.95 17.25C10.07 17.3 10.3 17.28 10.44 17.31C10.67 17.36 11.01 17.43 11.24 17.32C11.38 17.18 11.55 16.95 11.44 16.72C11.34 16.68 11.32 16.5 11.13 16.46C10.87 16.4 10.6 16.42 10.35 16.36C9.71 16.21 9.08 15.95 8.53 15.56C7.87 15.09 7.53 14.59 7.06 13.95C6.85 13.65 6.78 13.21 6.64 12.88C6.51 12.56 6.57 11.98 6.52 11.76C6.42 11.34 6.74 10.27 6.99 9.92C7.2 9.62 7.34 9.32 7.61 9.05C7.94 8.71 8.85 7.99 9.31 7.88C9.49 7.84 9.66 7.73 9.84 7.69C10.07 7.63 10.36 7.63 10.54 7.44C10.78 6.97 10.55 6.51 10.65 6.07C10.72 5.78 10.6 5.44 10.67 5.15C10.73 4.86 10.68 4.49 10.68 4.18C10.68 3.59 10.7 3.0 10.7 2.41C10.7 2.06 10.8 1.35 10.68 1.05C10.65 0.97 10.54 0.88 10.47 0.83C10.3 0.71 10.08 0.74 9.89 0.74C9.45 0.74 9.02 0.77 8.6 0.87C7.81 1.06 6.72 1.36 6.03 1.85C5.82 2.0 5.59 2.13 5.38 2.28C5.14 2.45 4.92 2.67 4.69 2.84C4.37 3.06 3.74 3.64 3.52 3.95C3.36 4.18 3.14 4.37 2.97 4.59C2.62 5.08 2.04 5.89 1.82 6.41C1.37 7.5 1.07 8.13 0.79 9.3C0.68 9.76 0.67 10.25 0.56 10.71C0.5 10.98 0.58 11.29 0.51 11.56C0.46 11.78 0.46 12.18 0.51 12.41C0.56 12.61 0.54 13.4 0.61 13.69C0.73 14.2 0.82 14.71 0.94 15.22C1.06 15.75 1.3 16.23 1.51 16.72C1.8 17.42 2.2 18.07 2.64 18.68C2.78 18.89 2.97 19.07 3.12 19.27C3.31 19.53 3.57 19.84 3.82 20.02C3.94 20.11 4.05 20.25 4.15 20.35C4.49 20.69 4.91 20.96 5.29 21.24C6.43 22.06 7.77 22.52 9.1 22.84C9.47 22.93 9.87 22.93 10.24 23.02C10.31 23.04 10.39 23.0 10.46 23.02C10.69 23.07 11.03 23.06 11.24 22.96Z"/>',
  };

  /* Mapa clase Font Awesome -> icono Flow.
     Si una clase no está aquí, el <i> se deja EXACTAMENTE como está. */
  var MAP = {
    'fa-tachometer-alt': 'flow-dashboard',
    'fa-gauge': 'flow-dashboard',
    'fa-gauge-high': 'flow-dashboard',
    'fa-university': 'flow-accounts',
    'fa-building-columns': 'flow-accounts',
    'fa-bank': 'flow-accounts',
    'fa-exchange-alt': 'flow-transfer',
    'fa-right-left': 'flow-transfer',
    'fa-chart-bar': 'flow-reports',
    'fa-chart-column': 'flow-reports',
    'fa-flask': 'flow-scenarios',
    'fa-bullseye': 'flow-autocontrol',
    'fa-tags': 'flow-rules',
    'fa-tag': 'flow-rules',
    'fa-filter': 'flow-rules',
    'fa-bell': 'flow-bell',
    'fa-bell-slash': 'flow-bell-off',
    'fa-mobile-alt': 'flow-push',
    'fa-mobile': 'flow-push',
    'fa-mobile-screen': 'flow-push',
    'fa-mobile-screen-button': 'flow-push',
    'fa-chart-pie': 'flow-patrimonio',
    'fa-wallet': 'flow-wallet',
    'fa-chart-line': 'flow-monthly',
    'fa-credit-card': 'flow-liability',
    'fa-gem': 'flow-equity',
    'fa-question': 'flow-help',
    'fa-question-circle': 'flow-help',
    'fa-circle-question': 'flow-help',
    'fa-arrow-up': 'flow-in',
    'fa-arrow-down': 'flow-out',
    'fa-equals': 'flow-equal',
    'fa-lightbulb': 'flow-insight',
    'fa-list': 'flow-journal',
    'fa-list-ul': 'flow-journal',
    'fa-book': 'flow-ledger',
    'fa-balance-scale': 'flow-balance',
    'fa-scale-balanced': 'flow-balance',
    'fa-file-export': 'flow-export',
    'fa-download': 'flow-export',
    'fa-upload': 'flow-import',
    'fa-file-import': 'flow-import',
    'fa-file-csv': 'flow-file-data',
    'fa-file-excel': 'flow-file-data',
    'fa-file-alt': 'flow-file-data',
    'fa-file-lines': 'flow-file-data',
    'fa-magnifying-glass-chart': 'flow-analysis',
    'fa-search': 'flow-analysis',
    'fa-magnifying-glass': 'flow-analysis',
    'fa-crown': 'flow-premium',
    'fa-star': 'flow-trial',
    'fa-lock': 'flow-locked',
    'fa-unlock': 'flow-unlock',
    'fa-check-circle': 'flow-success',
    'fa-circle-check': 'flow-success',
    'fa-exclamation-circle': 'flow-error',
    'fa-circle-exclamation': 'flow-error',
    'fa-info-circle': 'flow-info',
    'fa-circle-info': 'flow-info',
    'fa-exclamation-triangle': 'flow-warning',
    'fa-triangle-exclamation': 'flow-warning',
    'fa-spinner': 'flow-loading',
    'fa-circle-notch': 'flow-loading',
    'fa-wifi-slash': 'flow-offline',
    'fa-wifi': 'flow-offline',
    'fa-sync-alt': 'flow-retry',
    'fa-sync': 'flow-retry',
    'fa-redo': 'flow-retry',
    'fa-rotate-right': 'flow-retry',
    'fa-plus': 'flow-add',
    'fa-plus-circle': 'flow-add-circle',
    'fa-circle-plus': 'flow-add-circle',
    'fa-minus-circle': 'flow-minus-circle',
    'fa-circle-minus': 'flow-minus-circle',
    'fa-times': 'flow-close',
    'fa-xmark': 'flow-close',
    'fa-check': 'flow-check',
    'fa-check-double': 'flow-check-double',
    'fa-arrow-left': 'flow-prev',
    'fa-arrow-right': 'flow-next',
    'fa-chevron-right': 'flow-chevron',
    'fa-angle-right': 'flow-chevron',
    'fa-edit': 'flow-edit',
    'fa-pen': 'flow-edit',
    'fa-pencil-alt': 'flow-edit',
    'fa-pen-to-square': 'flow-edit',
    'fa-trash': 'flow-delete',
    'fa-trash-alt': 'flow-delete',
    'fa-trash-can': 'flow-delete',
    'fa-copy': 'flow-copy',
    'fa-save': 'flow-save',
    'fa-floppy-disk': 'flow-save',
    'fa-eye': 'flow-eye',
    'fa-eye-slash': 'flow-eye-off',
    'fa-user-plus': 'flow-signup',
    'fa-user': 'flow-user',
    'fa-user-circle': 'flow-user',
    'fa-sign-in-alt': 'flow-signin',
    'fa-right-to-bracket': 'flow-signin',
    'fa-sign-out-alt': 'flow-signout',
    'fa-right-from-bracket': 'flow-signout',
    'fa-key': 'flow-key',
    'fa-shield-alt': 'flow-shield',
    'fa-shield-halved': 'flow-shield',
    'fa-sun': 'flow-light',
    'fa-moon': 'flow-dark',
    'fa-bars': 'flow-menu',
    'fa-cog': 'flow-settings',
    'fa-gear': 'flow-settings',
    'fa-cogs': 'flow-settings',
    'fa-sliders-h': 'flow-settings',
    'fa-external-link-alt': 'flow-external',
    'fa-arrow-up-right-from-square': 'flow-external',
    'fa-play': 'flow-play',
    'fa-pause': 'flow-pause',
    'fa-calendar-alt': 'flow-calendar',
    'fa-calendar': 'flow-calendar',
    'fa-calendar-days': 'flow-calendar',
    'fa-calendar-check': 'flow-calendar-check',
    'fa-clock': 'flow-clock',
    'fa-envelope': 'flow-mail',
    'fa-comment-dots': 'flow-chat',
    'fa-comments': 'flow-chat',
    'fa-inbox': 'flow-inbox',
    'fa-gift': 'flow-gift',
    'fa-trophy': 'flow-trophy',
    'fa-receipt': 'flow-receipt',
    'fa-piggy-bank': 'flow-savings',
    'fa-hand-holding-usd': 'flow-income-hand',
    'fa-hand-holding-dollar': 'flow-income-hand',
    'fa-seedling': 'flow-seedling',
    'flow-asset': 'flow-asset',
    'flow-cash': 'flow-cash',
    'flow-fixed-cost': 'flow-fixed-cost',
    'flow-income-statement': 'flow-income-statement',
    'flow-movements': 'flow-movements',
    'flow-unknown': 'flow-unknown',
    'flow-in': 'flow-in',
    'flow-out': 'flow-out',
    'flow-liability': 'flow-liability',
    'flow-equity': 'flow-equity',
  };

  var FA_TOKENS = /^(fa|fas|far|fab|fal|fad|fa-fw|fa-spin|fa-pulse|fa-[a-z0-9-]+)$/;

  function svgMarkup(name, cls, style) {
    var inner = ICONS[name];
    if (!inner) return null;
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
           inner + '</svg>';
  }

  /* Devuelve el string SVG para usar en template literals. */
  function icon(nameOrFa, extraClass, extraStyle) {
    var name = ICONS[nameOrFa] ? nameOrFa : MAP[nameOrFa];
    if (!name || !ICONS[name]) return '';
    var cls = 'ff' + (extraClass ? ' ' + extraClass : '');
    var st = extraStyle ? ' style="' + extraStyle + '"' : '';
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"' +
           st + '>' + ICONS[name] + '</svg>';
  }

  /* Sustituye un <i> conservando clases no-FA, style, id, title y data-*. */
  function replaceNode(el) {
    var classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    var faName = null, spin = false, fw = false, keep = [];

    for (var i = 0; i < classes.length; i++) {
      var c = classes[i];
      if (c === 'fa-spin' || c === 'fa-pulse') { spin = true; continue; }
      if (c === 'fa-fw') { fw = true; continue; }
      if (MAP[c]) { faName = MAP[c]; continue; }
      if (FA_TOKENS.test(c) && (c === 'fa' || c === 'fas' || c === 'far' || c === 'fab' ||
          c === 'fal' || c === 'fad')) { continue; }
      keep.push(c);                      // <- clases de color/tamaño/margen: SE CONSERVAN
    }
    if (!faName) return false;           // no sabemos qué es: se deja intacto

    var cls = ['ff'].concat(keep);
    if (fw) cls.push('ff-fw');
    if (spin) cls.push('ff-spin');

    var tmp = document.createElement('div');
    tmp.innerHTML = svgMarkup(faName, cls.join(' '));
    var svg = tmp.firstChild;
    if (!svg) return false;

    /* Copia literal de los atributos que llevaban color, tamaño o comportamiento. */
    ['style', 'id', 'title', 'aria-label', 'role'].forEach(function (a) {
      if (el.hasAttribute(a)) svg.setAttribute(a, el.getAttribute(a));
    });
    for (var j = 0; j < el.attributes.length; j++) {
      var at = el.attributes[j];
      if (at.name.indexOf('data-') === 0) svg.setAttribute(at.name, at.value);
    }
    svg.setAttribute('data-ff', faName);

    el.parentNode.replaceChild(svg, el);
    return true;
  }

  function hydrate(root) {
    var scope = root || document;
    var list = scope.querySelectorAll('i[class*="fa-"], span[class*="fa-"]');
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].tagName === 'SPAN' && !/\bfa[srb]?\b/.test(list[i].className)) continue;
      if (replaceNode(list[i])) n++;
    }
    return n;
  }

  function injectCSS() {
    if (document.getElementById('flow-icons-css')) return;
    var s = document.createElement('style');
    s.id = 'flow-icons-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function start() {
    injectCSS();
    hydrate(document);
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'I' && /\bfa-/.test(node.className || '')) replaceNode(node);
          else if (node.querySelectorAll) hydrate(node);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.FlowIcons.observer = mo;
  }

  window.FlowIcons = { icons: ICONS, map: MAP, icon: icon, hydrate: hydrate, start: start };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
