# vendor/ — librerías de terceros autoalojadas

Copias **sin modificar** de ficheros publicados en npm. Se sirven desde el mismo
origen que la app, en lugar de un CDN: así no dependen de un tercero que pueda cambiar
el contenido (antes `chart.js` se cargaba sin versión y `@simplewebauthn/browser@13`
con un rango) y no hace falta SRI. Cada tarball se comprobó contra la integridad
publicada en npm (`npm view <paquete>@<versión> dist.integrity`).

| Carpeta | Paquete npm | Fichero de origen | Integridad del tarball (npm) |
|---|---|---|---|
| `chart.js-4.5.1/` | chart.js@4.5.1 (MIT) | `dist/chart.umd.min.js` | `sha512-GIjfiT9dbmHRiYi6Nl2yFCq7kkwdkp1W/lp2J99rX0yo9tgJGn3lKQATztIjb5tVtevcBtIdICNWqlq5+E8/Pw==` |
| `xlsx-0.20.3/` | SheetJS CE 0.20.3 (Apache-2.0), de `cdn.sheetjs.com` (no está en npm) | `xlsx-0.20.3/package/dist/xlsx.full.min.js` | SHA-256 del fichero: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` (idéntico al de `@e965/xlsx@0.20.3` en npm) |
| `simplewebauthn-browser-13.3.0/` | @simplewebauthn/browser@13.3.0 (MIT) | `dist/bundle/index.umd.min.js` | `sha512-BE/UWv6FOToAdVk0EokzkqQQDOWtNydYlY6+OrmiZ5SCNmb41VehttboTetUM3T/fr6EAFYVXjz4My2wg230rQ==` |
| `pdfjs-dist-3.11.174/` | pdfjs-dist@3.11.174 (Apache-2.0) | `build/pdf.min.js`, `build/pdf.worker.min.js` | `sha512-TdTZPf1trZ8/UFu5Cx/GXB7GZM30LT+wWUNfsi6Bq8ePLnb+woNKtDymI2mxZYBpMbonNFqKmiz684DIfnd8dA==` |
| `exceljs-4.4.0/` | exceljs@4.4.0 (MIT) | `dist/exceljs.min.js` | `sha512-XctvKaEMaj1Ii9oDOqbW/6e1gXknSY4g/aLCDicOXqBE4M0nRWkUu0PTp++UPNzoFY12BNHMfs/VadKIS6llvg==` |

Son las mismas versiones que se cargaban del CDN (chart.js "latest" = 4.5.1 y
`@simplewebauthn/browser@13` = 13.3.0 a 2026-10-20). Cada carpeta incluye la licencia
del paquete.

SheetJS 0.20.3 sustituye a la 0.18.5 (CVE-2023-30533 y CVE-2024-22363) desde el 30-oct-2026.

**Pendiente (ver SECURITY_AUDIT.md):** `pdfjs-dist` 3.11.174 tiene CVE-2024-4367
(mitigado con `isEvalSupported:false`).

Para actualizar una librería: `npm pack <paquete>@<versión>`, comprobar la integridad,
copiar el fichero en una carpeta nueva `<paquete>-<versión>/` y cambiar la ruta en el HTML/JS.
