# Geo

Mapa para ver dónde están tus vendedores. Ellos solo abren un link y permiten la ubicación; no instalan nada.

## Correr

```
ADMIN_KEY=tu-clave node server.js
```

- `/` — panel de administrador (pide la clave): agregar vendedores, copiar su link, ver el mapa.
- `/s/<token>` — link personal del vendedor.

Variables: `ADMIN_KEY` (obligatoria), `PORT`, `DATA_FILE` (por defecto `data.json`).

Requiere HTTPS en producción (el navegador solo da ubicación en sitios seguros). El servidor guarda datos en un archivo, así que necesita disco persistente (Render, Railway, Fly, VPS).

## Limitación

Sin instalar app, la ubicación solo se envía mientras la página está abierta y la pantalla encendida (se usa Wake Lock). Si el vendedor bloquea el teléfono o cambia de app, se detiene.
