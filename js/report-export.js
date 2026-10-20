// Escritura de los informes exportados (CSV y Excel).
// Recibe un "modelo de informe" ya calculado y redondeado por AccountingManager
// (con los mismos cálculos que la pantalla) y solo le da forma de archivo:
// aquí no se calcula ningún saldo.

export const EXCELJS_URL = '/vendor/exceljs-4.4.0/exceljs.min.js';   // autoalojado (ver vendor/README.md)
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const C = {
    black: 'FF000000',
    grey: 'FF6B7280',
    line: 'FFE5E7EB',
    green: 'FF15803D',
    red: 'FFB91C1C',
    purple: 'FF9333EA',
    white: 'FFFFFFFF'
};

// ---------- utilidades ----------

const pad2 = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' → 'dd/mm/aaaa' sin pasar por Date (evita desfases de zona horaria)
function dmy(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return (y && m && d) ? `${d}/${m}/${y}` : String(iso);
}

// 'YYYY-MM-DD' → fecha de Excel exacta (Date en UTC, que es como la convierte ExcelJS)
function excelDate(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function subtitle(report) {
    const g = report.generatedAt;
    const generado = `Generado el ${pad2(g.getDate())}/${pad2(g.getMonth() + 1)}/${g.getFullYear()} ${pad2(g.getHours())}:${pad2(g.getMinutes())}`;
    return [report.userName, report.periodLabel, generado].filter(Boolean).join(' · ');
}

// Importe como texto en la divisa del usuario (para las ecuaciones de los recuadros)
export function formatMoneyText(n, currency) {
    let s;
    try {
        s = new Intl.NumberFormat(currency.locale, { style: 'currency', currency: currency.code, useGrouping: 'always' }).format(n || 0);
    } catch (e) {
        s = `${(n || 0).toFixed(2)} ${currency.symbol}`;
    }
    return s.replace('-', '−');
}

// Formatos numéricos de Excel en la divisa del usuario: 2 decimales y miles.
// std: negativos en rojo con "−". plain: "−" sin color (el color lo pone la fuente).
export function moneyFormats(currency) {
    const s = String(currency.symbol || '€').replace(/"/g, '');
    if (currency.symbolFirst) {
        // "−" y el símbolo en un único literal entre comillas ("−$"), no en dos seguidos
        return {
            std: `"${s}"#,##0.00;[Red]"−${s}"#,##0.00;"${s}"#,##0.00`,
            plain: `"${s}"#,##0.00;"−${s}"#,##0.00;"${s}"#,##0.00`
        };
    }
    return {
        std: `#,##0.00 "${s}";[Red]"−"#,##0.00 "${s}";#,##0.00 "${s}"`,
        plain: `#,##0.00 "${s}";"−"#,##0.00 "${s}";#,##0.00 "${s}"`
    };
}

// Nombres de hoja válidos y únicos: máx. 31 caracteres, sin \ / ? * [ ] :
export function uniqueSheetNames(labels) {
    const used = new Set();
    return labels.map(label => {
        let base = String(label == null ? '' : label)
            .replace(/[\\/?*[\]:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^'+|'+$/g, '');
        if (!base) base = 'Cuenta';
        if (base.toLowerCase() === 'history') base = 'History (cuenta)'; // nombre reservado en Excel
        let name = base.slice(0, 31).trim();
        let n = 2;
        while (used.has(name.toLowerCase())) {
            const suffix = ` (${n++})`;
            name = base.slice(0, 31 - suffix.length).trim() + suffix;
        }
        used.add(name.toLowerCase());
        return name;
    });
}

// ---------- filas de datos (CSV y Excel sin formato) ----------

function ledgerRows(l) {
    const rows = [[dmy(l.openingDate), 'Saldo inicial', '', '', '', l.opening]];
    l.rows.forEach(r => rows.push([dmy(r.fecha), r.concepto, r.contrapartida, r.aumento || '', r.disminucion || '', r.saldo]));
    rows.push([dmy(l.closingDate), 'Saldo final', '', l.totalAumentos || '', l.totalDisminuciones || '', l.closing]);
    return rows;
}

const LEDGER_HEAD = ['Fecha', 'Concepto', 'Contrapartida', 'Aumento', 'Disminución', 'Saldo'];

function tableRows(report) {
    const d = report.data;
    switch (report.kind) {
        case 'balance': {
            const out = [['Sección', 'Cuenta', 'Importe']];
            const sec = (titulo, lineas, totalLabel, total) => {
                lineas.forEach(l => out.push([titulo, l.nombre, l.importe]));
                out.push([titulo, totalLabel, total]);
            };
            sec('ACTIVO', d.activos, 'TOTAL ACTIVO', d.totals.activos);
            sec('PATRIMONIO NETO', d.patrimonio, 'TOTAL PATRIMONIO NETO', d.totals.patrimonio);
            sec('PASIVO', d.pasivos, 'TOTAL PASIVO', d.totals.pasivos);
            out.push(['BALANCE TOTAL', 'Activos − Pasivos + Patrimonio Neto', d.totals.balance]);
            return out;
        }
        case 'income_statement': {
            const out = [['Sección', 'Cuenta', 'Importe']];
            d.ingresos.forEach(l => out.push(['INGRESOS', l.nombre, l.importe]));
            out.push(['INGRESOS', 'TOTAL INGRESOS', d.totals.ingresos]);
            d.gastos.forEach(l => out.push(['GASTOS', l.nombre, l.importe]));
            out.push(['GASTOS', 'TOTAL GASTOS', d.totals.gastos]);
            out.push(['RESULTADO DEL PERÍODO', 'Ingresos − Gastos', d.totals.resultado]);
            return out;
        }
        case 'accounts': {
            const out = [['Nombre', 'Tipo', 'Saldo Inicial', d.saldoLabel, 'Descripción']];
            d.rows.forEach(r => out.push([r.nombre, r.tipo, r.saldoInicial, r.saldo, r.descripcion]));
            out.push([]);
            out.push(['TOTALES POR TIPO']);
            d.totalsByType.forEach(t => out.push(['', t.tipo, '', t.total, '']));
            return out;
        }
        case 'ledger': {
            // CSV: un único archivo con la columna "Cuenta" delante y los bloques seguidos
            const out = [['Cuenta', ...LEDGER_HEAD]];
            d.ledgers.forEach(l => ledgerRows(l).forEach(r => out.push([l.label, ...r])));
            return out;
        }
        case 'movements': {
            const out = [['Fecha', 'Tipo', 'Cuenta origen', 'Cuenta destino', 'Descripción', 'Importe']];
            d.rows.forEach(r => out.push([dmy(r.fecha), r.tipo, r.origen, r.destino, r.descripcion, r.importe]));
            return out;
        }
        default:
            throw new Error('Tipo de informe no válido');
    }
}

// ---------- CSV ----------
// Separador ";" y decimales con coma, con BOM UTF-8: lo abre bien el Excel en español.

function csvCell(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '';
    let s = String(v);
    // Una descripción importada que empiece por = + - @ no debe ejecutarse como fórmula
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}

export function buildCSV(report) {
    const rows = tableRows(report);
    const width = rows[0].length;
    const lines = rows.map(r => {
        const cells = r.length ? [...r, ...Array(Math.max(0, width - r.length)).fill('')] : [];
        return cells.map(csvCell).join(';');
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ---------- Excel sin formato (SheetJS, si ExcelJS no carga) ----------

export function buildSheetJSBlob(XLSX, report) {
    if (!XLSX || !XLSX.utils) throw new Error('No se pudo generar el archivo Excel');
    const wb = XLSX.utils.book_new();
    const add = (name, title, rows, widths) => {
        const aoa = [[title], [subtitle(report)], [], ...rows].map(r => r.map(v => (v === '' ? null : v)));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = widths.map(wch => ({ wch }));
        Object.keys(ws).forEach(addr => {
            if (addr[0] !== '!' && ws[addr].t === 'n') ws[addr].z = '#,##0.00';
        });
        XLSX.utils.book_append_sheet(wb, ws, name);
    };

    if (report.kind === 'ledger') {
        const names = uniqueSheetNames(report.data.ledgers.map(l => l.label));
        report.data.ledgers.forEach((l, i) => {
            add(names[i], `${report.title} — ${l.label}`, [LEDGER_HEAD, ...ledgerRows(l)], [12, 40, 26, 15, 15, 16]);
        });
    } else {
        const rows = tableRows(report);
        add(report.sheetName, report.title, rows, rows[0].map((_, i) => (i === 0 ? 24 : 18)));
    }

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: XLSX_MIME });
}

// ---------- Excel con formato (ExcelJS) ----------

// Carga ExcelJS desde cdnjs solo al exportar, una sola vez. Si falla, se puede reintentar.
let excelJSPromise = null;
export function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (excelJSPromise) return excelJSPromise;
    excelJSPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = EXCELJS_URL;
        script.async = true;
        const fail = (msg) => {
            clearTimeout(timer);
            script.remove();
            reject(new Error(msg));
        };
        const timer = setTimeout(() => fail('Tiempo de espera agotado cargando ExcelJS'), 20000);
        script.onload = () => {
            clearTimeout(timer);
            if (window.ExcelJS) resolve(window.ExcelJS);
            else fail('ExcelJS no se inicializó');
        };
        script.onerror = () => fail('No se pudo cargar ExcelJS');
        document.head.appendChild(script);
    }).catch(error => {
        excelJSPromise = null;
        throw error;
    });
    return excelJSPromise;
}

// Logo de FinanceFlow (el mismo del header de la web) en base64, con su tamaño real
let logoPromise = null;
export function loadLogo() {
    if (logoPromise) return logoPromise;
    const url = new URL('../public/logo.png', import.meta.url).href;
    logoPromise = fetch(url)
        .then(res => (res.ok ? res.arrayBuffer() : null))
        .then(buf => (buf ? logoFromBuffer(buf) : null))
        .catch(() => null)
        .then(logo => {
            if (!logo) logoPromise = null; // sin logo se exporta igual; se reintenta la próxima vez
            return logo;
        });
    return logoPromise;
}

function logoFromBuffer(buf) {
    const bytes = new Uint8Array(buf);
    let width = 1;
    let height = 1;
    // PNG: ancho y alto en la cabecera IHDR (bytes 16-23, big-endian)
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        const view = new DataView(buf);
        width = view.getUint32(16);
        height = view.getUint32(20);
    }
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return { base64: btoa(bin), width, height };
}

function put(ws, row, col, value, style = {}) {
    const cell = ws.getCell(row, col);
    cell.value = value;
    if (style.font) cell.font = style.font;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.numFmt) cell.numFmt = style.numFmt;
    if (style.fill) cell.fill = style.fill;
    return cell;
}

function putDate(ws, row, col, iso) {
    if (!iso) return;
    put(ws, row, col, excelDate(iso), { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'center', vertical: 'middle' } });
}

const RIGHT = { horizontal: 'right', vertical: 'middle' };
const LEFT = { horizontal: 'left', vertical: 'middle' };

// Borde exterior de un rango. Se asigna un estilo nuevo por celda para no modificar
// estilos compartidos entre celdas combinadas.
function box(ws, r1, c1, r2, c2, style) {
    const side = { style, color: { argb: C.black } };
    for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
            if (r !== r1 && r !== r2 && c !== c1 && c !== c2) continue;
            const cell = ws.getCell(r, c);
            const border = { ...((cell.style && cell.style.border) || {}) };
            if (r === r1) border.top = side;
            if (r === r2) border.bottom = side;
            if (c === c1) border.left = side;
            if (c === c2) border.right = side;
            cell.style = { ...cell.style, border };
        }
    }
}

function bottomLine(ws, row, c1, c2, style, argb) {
    for (let c = c1; c <= c2; c++) {
        const cell = ws.getCell(row, c);
        const border = { ...((cell.style && cell.style.border) || {}), bottom: { style, color: { argb } } };
        cell.style = { ...cell.style, border };
    }
}

function newSheet(wb, name, { landscape = false, widths, freezeRow = 0 }) {
    const view = freezeRow
        ? { state: 'frozen', xSplit: 0, ySplit: freezeRow, topLeftCell: `A${freezeRow + 1}`, showGridLines: false }
        : { showGridLines: false };
    const ws = wb.addWorksheet(name, {
        views: [view],
        pageSetup: {
            paperSize: 9, // A4
            orientation: landscape ? 'landscape' : 'portrait',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            horizontalCentered: true,
            margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
        }
    });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    return ws;
}

// Cabecera común: logo + "FinanceFlow", fila de aire, recuadro de título y subtítulo.
// La columna A es el margen que aloja el logo. Devuelve la primera fila de contenido.
function header(ws, report, ctx, lastCol, title) {
    ws.getRow(1).height = 34;
    if (ctx.logoId !== null) {
        ws.addImage(ctx.logoId, {
            tl: { col: 0.12, row: 0.08 },
            ext: { width: ctx.logoW, height: ctx.logoH },
            editAs: 'oneCell'
        });
    }
    put(ws, 1, 2, 'FinanceFlow', { font: { bold: true, size: 16, color: { argb: C.black } }, alignment: { vertical: 'middle' } });

    put(ws, 3, 2, title, {
        font: { bold: true, size: 16, color: { argb: C.black } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: C.white } }
    });
    ws.mergeCells(3, 2, 3, lastCol);
    ws.getRow(3).height = 30;
    box(ws, 3, 2, 3, lastCol, 'thick');

    // Subtítulo: en hojas estrechas (PyG) puede no caber en una línea → se parte en dos
    const sub = subtitle(report);
    let ancho = 0;
    for (let c = 2; c <= lastCol; c++) ancho += ws.getColumn(c).width || 10;
    const lineas = Math.max(1, Math.ceil(sub.length / (ancho * 1.1)));
    put(ws, 4, 2, sub, { font: { size: 10, color: { argb: C.grey } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
    ws.mergeCells(4, 2, 4, lastCol);
    ws.getRow(4).height = 4 + 14 * lineas;
    return 6;
}

// Línea "cuentas anuales": nombre a la izquierda relleno de puntos (formato @*.) e
// importe a la derecha en la celda contigua.
function dotLine(ws, row, cName, cAmount, nombre, importe, fmt, bold = false) {
    put(ws, row, cName, String(nombre == null ? '' : nombre), {
        numFmt: '@*.',
        font: { bold, size: 11 },
        alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }
    });
    put(ws, row, cAmount, importe, { numFmt: fmt, font: { bold, size: 11 }, alignment: RIGHT });
}

// Rectángulo con cabecera y una línea por cuenta. Devuelve la última fila usada.
function section(ws, row, cName, cAmount, titulo, color, lineas, fmt) {
    const start = row;
    put(ws, row, cName, titulo, {
        font: { bold: true, size: 11, color: { argb: color } },
        alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }
    });
    ws.getRow(row).height = 20;
    row++;
    if (lineas.length === 0) {
        put(ws, row, cName, 'Sin cuentas', {
            font: { italic: true, size: 10, color: { argb: C.grey } },
            alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }
        });
        row++;
    }
    lineas.forEach(l => {
        dotLine(ws, row, cName, cAmount, l.nombre, l.importe, fmt);
        row++;
    });
    box(ws, start, cName, row - 1, cAmount, 'thin');
    return row - 1;
}

function totalBox(ws, row, cName, cAmount, etiqueta, importe, fmt) {
    dotLine(ws, row, cName, cAmount, etiqueta, importe, fmt, true);
    ws.getRow(row).height = 22;
    box(ws, row, cName, row, cAmount, 'medium');
}

// Recuadro destacado (borde grueso): título, importe grande y la ecuación debajo
function bigBox(ws, row, c1, c2, titulo, importe, color, ecuacion, fmt, ecRows) {
    put(ws, row, c1, titulo, { font: { bold: true, size: 12 }, alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.mergeCells(row, c1, row, c2);
    ws.getRow(row).height = 20;
    put(ws, row + 1, c1, importe, {
        numFmt: fmt,
        font: { bold: true, size: 22, color: { argb: color } },
        alignment: { horizontal: 'center', vertical: 'middle' }
    });
    ws.mergeCells(row + 1, c1, row + 2, c2);
    put(ws, row + 3, c1, ecuacion, { font: { size: 9 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
    ws.mergeCells(row + 3, c1, row + 2 + ecRows, c2);
    box(ws, row, c1, row + 2 + ecRows, c2, 'thick');
    return row + 2 + ecRows;
}

function tableHeader(ws, row, c1, titles, aligns) {
    titles.forEach((t, i) => put(ws, row, c1 + i, t, {
        font: { bold: true },
        alignment: { horizontal: aligns[i], vertical: 'middle' }
    }));
    bottomLine(ws, row, c1, c1 + titles.length - 1, 'medium', C.black);
    ws.getRow(row).height = 20;
}

function emptyTableRow(ws, row, col, texto) {
    put(ws, row, col, texto, { font: { italic: true, size: 10, color: { argb: C.grey } }, alignment: LEFT });
}

// Balance de Situación: ACTIVO a la izquierda; PATRIMONIO NETO y PASIVO a la derecha;
// KPI "Balance Total" (como en la pantalla). Sin fila de "cuadre".
function balanceSheet(wb, report, ctx) {
    const d = report.data;
    const t = d.totals;
    const ws = newSheet(wb, report.sheetName, { landscape: true, widths: [7, 38, 16, 3, 38, 16, 3, 26, 26] });
    const top = header(ws, report, ctx, 9, report.title);

    const finActivo = section(ws, top, 2, 3, 'ACTIVO', C.black, d.activos, ctx.fmt);
    totalBox(ws, finActivo + 2, 2, 3, 'TOTAL ACTIVO', t.activos, ctx.fmt);

    const finPN = section(ws, top, 5, 6, 'PATRIMONIO NETO', C.black, d.patrimonio, ctx.fmt);
    totalBox(ws, finPN + 2, 5, 6, 'TOTAL PATRIMONIO NETO', t.patrimonio, ctx.fmt);
    const finPasivo = section(ws, finPN + 4, 5, 6, 'PASIVO', C.black, d.pasivos, ctx.fmt);
    totalBox(ws, finPasivo + 2, 5, 6, 'TOTAL PASIVO', t.pasivos, ctx.fmt);

    const m = ctx.money;
    const ecuacion = `Activos ${m(t.activos)} − Pasivos ${m(t.pasivos)} + Patrimonio Neto ${m(t.patrimonio)} = ${m(t.balance)}`;
    bigBox(ws, top, 8, 9, 'Balance Total', t.balance, C.purple, ecuacion, ctx.fmtPlain, 3);
}

// Cuenta de Pérdidas y Ganancias: todo en vertical, en una sola columna
function incomeSheet(wb, report, ctx) {
    const d = report.data;
    const t = d.totals;
    const ws = newSheet(wb, report.sheetName, { widths: [7, 38, 16] });
    const top = header(ws, report, ctx, 3, report.title);

    const finIngresos = section(ws, top, 2, 3, 'INGRESOS', C.green, d.ingresos, ctx.fmt);
    totalBox(ws, finIngresos + 1, 2, 3, 'TOTAL INGRESOS', t.ingresos, ctx.fmt);

    const finGastos = section(ws, finIngresos + 3, 2, 3, 'GASTOS', C.red, d.gastos, ctx.fmt);
    totalBox(ws, finGastos + 1, 2, 3, 'TOTAL GASTOS', t.gastos, ctx.fmt);

    const m = ctx.money;
    const ecuacion = `Ingresos ${m(t.ingresos)} − Gastos ${m(t.gastos)} = ${m(t.resultado)}`;
    bigBox(ws, finGastos + 3, 2, 3, 'RESULTADO DEL PERÍODO', t.resultado,
        t.resultado >= 0 ? C.green : C.red, ecuacion, ctx.fmtPlain, 1);
}

// Libro mayor de una cuenta: una hoja por cuenta
function ledgerSheet(wb, report, ctx, l, sheetName) {
    const ws = newSheet(wb, sheetName, { widths: [7, 12, 40, 32, 15, 15, 16], freezeRow: 6 });
    let row = header(ws, report, ctx, 7, `${report.title} — ${l.label}`);
    tableHeader(ws, row, 2, LEDGER_HEAD, ['center', 'left', 'left', 'right', 'right', 'right']);
    row++;

    putDate(ws, row, 2, l.openingDate);
    put(ws, row, 3, 'Saldo inicial', { font: { bold: true }, alignment: LEFT });
    put(ws, row, 7, l.opening, { numFmt: ctx.fmt, font: { bold: true }, alignment: RIGHT });
    box(ws, row, 2, row, 7, 'thin');
    row++;

    l.rows.forEach(r => {
        putDate(ws, row, 2, r.fecha);
        put(ws, row, 3, r.concepto, { alignment: LEFT });
        put(ws, row, 4, r.contrapartida, { alignment: LEFT });
        if (r.aumento) put(ws, row, 5, r.aumento, { numFmt: ctx.fmt, font: { color: { argb: C.green } }, alignment: RIGHT });
        if (r.disminucion) put(ws, row, 6, r.disminucion, { numFmt: ctx.fmt, font: { color: { argb: C.red } }, alignment: RIGHT });
        put(ws, row, 7, r.saldo, { numFmt: ctx.fmt, font: { color: { argb: C.black } }, alignment: RIGHT });
        bottomLine(ws, row, 2, 7, 'thin', C.line);
        row++;
    });

    // Saldo final, con las sumas del periodo (inicial + aumentos − disminuciones = final)
    putDate(ws, row, 2, l.closingDate);
    put(ws, row, 3, 'Saldo final', { font: { bold: true }, alignment: LEFT });
    if (l.totalAumentos) put(ws, row, 5, l.totalAumentos, { numFmt: ctx.fmt, font: { bold: true, color: { argb: C.green } }, alignment: RIGHT });
    if (l.totalDisminuciones) put(ws, row, 6, l.totalDisminuciones, { numFmt: ctx.fmt, font: { bold: true, color: { argb: C.red } }, alignment: RIGHT });
    put(ws, row, 7, l.closing, { numFmt: ctx.fmt, font: { bold: true }, alignment: RIGHT });
    box(ws, row, 2, row, 7, 'thin');
}

// Saldos de todas las cuentas + "Totales por tipo" con líneas de puntos
function accountsSheet(wb, report, ctx) {
    const d = report.data;
    const ws = newSheet(wb, report.sheetName, { widths: [7, 40, 13, 16, 18, 40], freezeRow: 6 });
    let row = header(ws, report, ctx, 6, report.title);
    tableHeader(ws, row, 2, ['Nombre', 'Tipo', 'Saldo Inicial', d.saldoLabel, 'Descripción'],
        ['left', 'left', 'right', 'right', 'left']);
    ws.getCell(row, 6).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    row++;
    d.rows.forEach(r => {
        put(ws, row, 2, r.nombre, { alignment: LEFT });
        put(ws, row, 3, r.tipo, { alignment: LEFT });
        put(ws, row, 4, r.saldoInicial, { numFmt: ctx.fmt, alignment: RIGHT });
        put(ws, row, 5, r.saldo, { numFmt: ctx.fmt, alignment: RIGHT });
        put(ws, row, 6, r.descripcion, { alignment: { ...LEFT, indent: 1 } });
        bottomLine(ws, row, 2, 6, 'thin', C.line);
        row++;
    });

    row++;
    const start = row;
    put(ws, row, 2, 'TOTALES POR TIPO', { font: { bold: true }, alignment: { horizontal: 'left', vertical: 'middle', indent: 1 } });
    ws.getRow(row).height = 20;
    row++;
    d.totalsByType.forEach(t => {
        put(ws, row, 2, t.tipo, { numFmt: '@*.', alignment: { horizontal: 'left', vertical: 'middle', indent: 1 } });
        ws.mergeCells(row, 2, row, 4);
        put(ws, row, 5, t.total, { numFmt: ctx.fmt, alignment: RIGHT });
        row++;
    });
    box(ws, start, 2, row - 1, 5, 'thin');
}

// Movimientos: importe en verde (ingreso), rojo (gasto) o negro (transferencia)
function movementsSheet(wb, report, ctx) {
    const ws = newSheet(wb, report.sheetName, { widths: [7, 12, 14, 32, 32, 40, 15], freezeRow: 6 });
    let row = header(ws, report, ctx, 7, report.title);
    tableHeader(ws, row, 2, ['Fecha', 'Tipo', 'Cuenta origen', 'Cuenta destino', 'Descripción', 'Importe'],
        ['center', 'left', 'left', 'left', 'left', 'right']);
    row++;
    if (report.data.rows.length === 0) {
        emptyTableRow(ws, row, 2, 'Sin movimientos en el periodo');
        return;
    }
    report.data.rows.forEach(r => {
        const color = r.tipo === 'ingreso' ? C.green : r.tipo === 'gasto' ? C.red : C.black;
        putDate(ws, row, 2, r.fecha);
        put(ws, row, 3, r.tipo, { alignment: LEFT });
        put(ws, row, 4, r.origen, { alignment: LEFT });
        put(ws, row, 5, r.destino, { alignment: LEFT });
        put(ws, row, 6, r.descripcion, { alignment: LEFT });
        put(ws, row, 7, r.importe, { numFmt: ctx.fmt, font: { color: { argb: color } }, alignment: RIGHT });
        bottomLine(ws, row, 2, 7, 'thin', C.line);
        row++;
    });
}

// Crea el libro de ExcelJS. logo: { base64 | buffer, width, height } o null.
export function buildExcelWorkbook(ExcelJS, report, logo) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FinanceFlow';
    wb.created = report.generatedAt;

    const formats = moneyFormats(report.currency);
    const ctx = {
        fmt: formats.std,
        fmtPlain: formats.plain,
        money: (n) => formatMoneyText(n, report.currency),
        logoId: null,
        logoW: 40,
        logoH: 40
    };
    if (logo && (logo.base64 || logo.buffer)) {
        ctx.logoId = wb.addImage(logo.buffer
            ? { buffer: logo.buffer, extension: 'png' }
            : { base64: logo.base64, extension: 'png' });
        // Alto 40 px respetando la proporción del archivo
        ctx.logoW = Math.max(1, Math.round(40 * (logo.width || 1) / (logo.height || 1)));
    }

    switch (report.kind) {
        case 'balance': balanceSheet(wb, report, ctx); break;
        case 'income_statement': incomeSheet(wb, report, ctx); break;
        case 'accounts': accountsSheet(wb, report, ctx); break;
        case 'movements': movementsSheet(wb, report, ctx); break;
        case 'ledger': {
            const names = uniqueSheetNames(report.data.ledgers.map(l => l.label));
            report.data.ledgers.forEach((l, i) => ledgerSheet(wb, report, ctx, l, names[i]));
            break;
        }
        default:
            throw new Error('Tipo de informe no válido');
    }
    return wb;
}
