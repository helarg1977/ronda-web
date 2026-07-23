# Ronda — Mini-web del cliente

"La siguiente ronda está a un toque"

Mini-web que se abre al escanear el QR de la mesa. Sin login, sin descargar nada.
Flujo: escanear → ver menú → pedir → ver estado del pedido en tiempo real.

## Desarrollo local

```
npm install
npm run dev
```

Para probar una mesa específica, abre:
```
http://localhost:5173/?m=CODIGO_QR_DE_LA_MESA
```
(el código `qr_code` de cada mesa se genera solo al crearla en la tabla `mesas`)

## Despliegue

Pensado para desplegar en Vercel (igual que tallerya-web). El QR físico de cada mesa
debe apuntar a: `https://ronda-web.vercel.app/?m=CODIGO_DE_LA_MESA`
