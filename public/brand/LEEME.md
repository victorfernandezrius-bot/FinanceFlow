# FinanceFlow · kit de marca (símbolo «Núcleo»)

Todo el texto de los SVG está convertido a trazados: no hace falta instalar ninguna fuente.
Los PNG de logo y símbolo tienen fondo transparente.

## Qué archivo usar en cada sitio

| Dónde | Archivo |
|---|---|
| Cabecera de la app o la web, fondo claro | `logo/financeflow-logo-color.svg` |
| Cabecera sobre azul o modo oscuro | `logo/financeflow-logo-blanco.svg` |
| Espacios estrechos (barra de la app, móvil) | `logo/financeflow-logo-sin-endoso-color.svg` o `-blanco.svg` |
| Pantalla de acceso, portadas, formatos cuadrados | `logo/financeflow-logo-vertical-color.svg` o `-blanco.svg` |
| Solo el símbolo | `simbolo/nucleo-color.svg`, `nucleo-blanco.svg`, `nucleo-azul.svg` (una tinta) |
| Pestaña del navegador | `web/favicon.ico` y `web/favicon.svg` |
| Icono al añadir a inicio en iPhone | `web/apple-touch-icon.png` |
| Icono al instalar la app (Android, escritorio) | `web/icon-192.png`, `web/icon-512.png`, `web/icon-maskable-512.png` |
| Vista previa al compartir un enlace | `web/og-image.png` (1200 × 630) |
| Avatar de redes, Telegram, tiendas de apps | `icono-app/icono-cuadrado-1024.png` |
| Icono con esquinas redondeadas ya aplicadas | `icono-app/icono-1024.png`, `icono-512.png`, `icono.svg` |

Cada logo viene en SVG y en PNG a dos tamaños: el grande (2000 px de ancho; 1400 px el vertical) y uno de 800 px.

## Cómo ponerlo en la web

1. Sube todo el contenido de `web/` a la raíz del sitio (junto a `index.html`).
2. Pega el contenido de `web/head-snippet.html` dentro de `<head>`.
3. Si la app ya tiene un archivo de manifiesto, no lo sustituyas: copia solo el bloque `icons` de `web/site.webmanifest`.
4. El navegador guarda el favicon en caché: para ver el cambio, abre la página en una ventana privada.

## Colores

| Uso | Color |
|---|---|
| Azul FinanceFlow («Finance», fondo del icono) | `#0158C9` |
| Verde de «Flow» sobre blanco | `#3FA350` |
| Verde de acento sobre azul (icono) | `#61CE70` |
| Gris de «by Contabilidad Personal» | `#6B7280` |
| Degradado del símbolo (azules del logo madre) | `#015F9B` → `#1B98D5` → `#A3BACD` |

El degradado va oscuro en los laterales y claro hacia el eje central, igual que en el logo de Contabilidad Personal.

## Tipografía

Inter 700 para «FinanceFlow» (espaciado −2,2 %) e Inter 400 para «by Contabilidad Personal».

## Normas de uso

- **Zona de protección.** Los archivos de logo ya incluyen un margen igual a la altura de la «F». No lo recortes ni pegues nada dentro.
- **Tamaño mínimo.** Logo con endoso: 220 px de ancho (180 px el vertical), para que «by Contabilidad Personal» quede a unos 9 px. Por debajo, usa la versión sin endoso, que aguanta hasta 120 px. Símbolo solo: 24 px; por debajo, usa el favicon.
- **Favicon.** A 16–48 px el símbolo va en blanco y con el trazo más grueso para que se lea. El acento verde aparece a partir del icono de 180 px.
- **Contraste.** El verde `#3FA350` sobre blanco solo cumple el mínimo de accesibilidad en texto grande; no lo uses para texto pequeño.
- No cambies los colores, no deformes el logo y no le añadas sombras ni efectos.
