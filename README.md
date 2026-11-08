# Trobemmos · Encuentra a tu gente

Aplicación web **propia y de código abierto** de ubicación compartida para círculos de familia y amigos, con **todas las funciones activadas y gratis desde el primer minuto**: mapa en tiempo real, lugares y alertas ilimitadas, historial de 90 días, chat con imágenes, SOS, detección de colisiones e informes de conducción individuales y familiares.

> **Nota legal y de producto.** Trobemmos es una implementación independiente inspirada en la *categoría* de apps de localización familiar (la ficha de Google Play de Life360 se usó como referencia funcional). **No** utiliza la marca, los logos, el código, las APIs, las suscripciones ni los datos de Life360, y **no** elude ningún sistema de pago de terceros: las funciones equivalentes a los planes de pago están implementadas aquí como software nuevo, bajo licencia Apache-2.0, y se ofrecen sin coste porque es nuestro propio producto. Tampoco se recopilan datos de otras personas sin su consentimiento.

---

## Funciones

| Área | Incluido | Detalle |
| --- | --- | --- |
| Mapa en vivo | ✅ | Posiciones, batería, velocidad, precisión, lugar actual y actualización por WebSocket con *fallback* por sondeo |
| Círculos | ✅ | Crear, unirse por código, cambiar de círculo, invitaciones, roles y expulsión de miembros |
| Lugares (geocercas) | ✅ | **Ilimitados**, radio configurable, iconos y **alertas ilimitadas** de entrada/salida |
| Historial | ✅ | **90 días** (más que los 30 de los planes de pago de referencia), cronología diaria, estancias, trayectos, distancia y reproducción animada |
| Chat privado | ✅ | Mensajes de texto, emojis e imágenes (hasta 2,5 MB), solo para el círculo |
| Batería baja | ✅ | Nivel por miembro y aviso al bajar del 20 % |
| Alerta SOS | ✅ | Botón silencioso de mantener-pulsar, ubicación, confirmaciones y enlaces `tel:`/`sms:` a contactos de emergencia |
| Detección de accidentes | ✅ | Heurística de deceleración brusca + `DeviceMotion`, con cuenta atrás de 20 s y botón «Estoy bien» |
| Conducción | ✅ | Viajes, excesos de velocidad, frenazos, aceleraciones, uso del móvil, puntuación 0–100 e **informe familiar semanal** |
| Notificaciones | ✅ | Bandeja con filtros, avisos in-app y Web Notifications |
| Sin anuncios / sin suscripción | ✅ | Sin compras en la app, sin rastreadores de terceros, sin niveles de plan |
| Privacidad | ✅ | Consentimiento explícito por círculo, pausa inmediata, exportación y borrado de datos |

Mapa con **teselas propias dibujadas en canvas**: funciona sin claves de API, sin CDNs y sin conexión a Internet. Opcionalmente se puede activar una capa de OpenStreetMap desde el botón «Mapa OSM».

---

## Arranque rápido

```bash
npm install
npm start
# http://localhost:3000
```

Requiere Node.js ≥ 20 (probado en Node 22). No hay base de datos ni servicios externos: los datos se guardan en `data/state.json` (fuera de Git).

> **Importante:** Trobemmos es una aplicación **con servidor**. Abrir el `index.html` con doble clic (o publicarlo solo como sitio estático) no es suficiente: el mapa en vivo, las cuentas, el chat y las alertas necesitan `npm start`. Si abres la app sin backend, la propia interfaz lo detecta y te lo explica con un aviso.

### Publicar la interfaz aparte (opcional)

La interfaz puede servirse como sitio estático (por ejemplo GitHub Pages) apuntando a un backend real:

```
https://usuario.github.io/Trobemmos/public/?api=https://mi-servidor-trobemmos
```

También se puede fijar con `window.TROBEMMOS_API = 'https://mi-servidor'` antes de cargar `js/ctx.js`. El parámetro `?api=` se recuerda en el navegador. Para que GitHub Pages publique el sitio estático, el repositorio incluye un `index.html` en la raíz que redirige a `public/`, y los archivos `.nojekyll` necesarios.

```bash
npm test           # tests unitarios de geocercas, conducción, impactos e informes
npm run dev        # reinicio automático con --watch
```

Variables de entorno: `PORT` (3000), `HOST` (`0.0.0.0`), `TROBEMMOS_DATA_DIR` (directorio de datos).

Si el puerto 3000 está ocupado, el servidor lo indica y sugiere `PORT=3001 npm start`. Si `data/state.json` estuviera corrupto, se aparta como `state.json.corrupt-<fecha>` en lugar de perder los datos en silencio.

### Modo demostración

Pulsa **«Explorar la demo interactiva»** en la pantalla de acceso (o entra con `demo@trobemmos.local` / `demo1234`). Se crea automáticamente:

- Un círculo «Familia Madrid» con 5 miembros **ficticios** que se desplazan en tiempo real por un simulador.
- 5 lugares, 30 días de historial, cientos de viajes con incidencias, mensajes de chat y alertas históricas.
- Botones **«Simular viaje»** (Conducción) y **«Simular colisión»** (Seguridad) para probar las funciones premium sin esperar eventos reales.

Los datos de demo están etiquetados como simulados en la interfaz. Si envías tu propia ubicación, el simulador deja de mover tu personaje.

---

## Arquitectura

```
server/
  index.js       Express + WebSocket: rutas REST, difusión en tiempo real, arranque
  store.js       Persistencia JSON, cuentas, círculos, eventos, export/borrado
  location.js    Procesamiento de cada muestra: geocercas, batería, conducción, impactos
  core.js        Lógica pura: distancias, geocercas, análisis de conducción, cronología
  demo.js        Semilla de demostración y simulador en vivo
  core.test.js   Tests con node:test
public/
  index.html     Shell de la app
  styles.css     Diseño responsive (escritorio + móvil)
  js/ctx.js      Estado, cliente HTTP, utilidades, modales y toasts
  js/views.js    Vistas: mapa, historial, lugares, chat, conducción, seguridad, ajustes, plan
  js/map.js      Leaflet + capa de atlas procedural y marcadores
  js/icons.js    Iconos SVG en línea
  vendor/leaflet Leaflet 1.9.4 incluido localmente
```

**Tiempo real:** el navegador abre un WebSocket autenticado en `/ws`. Mensajes `location`, `event`, `message`, `sos`, `places` y `trip` actualizan la interfaz al instante. Si el proxy o la red bloquean WebSockets, el cliente pasa automáticamente a sondeo cada 4,5 s (`GET /api/events` + snapshot del círculo), por lo que la app sigue funcionando.

**Ubicación:** `navigator.geolocation.watchPosition` (con consentimiento explícito), `navigator.getBattery` y `DeviceMotion` cuando están disponibles. Si el GPS no está disponible —por ejemplo dentro de un iframe sin permisos— se puede **fijar la posición haciendo clic en el mapa** o usar una coordenada de ejemplo, para poder probar alertas e informes igualmente.

### API principal

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/auth/register`, `/login`, `/demo`, `/logout` | Cuentas y sesiones |
| `GET/PATCH` | `/api/me` | Perfil, ajustes y contactos de emergencia |
| `GET` | `/api/me/export` · `DELETE /api/me` | Portabilidad y borrado de datos |
| `GET/POST` | `/api/circles`, `/api/circles/join` | Círculos e invitaciones |
| `GET/PATCH/DELETE` | `/api/circles/:id` | Detalle, ajustes, baja y miembros |
| `PATCH` | `/api/circles/:id/sharing` | Activar/pausar el uso compartido |
| `POST` | `/api/circles/:id/location` | Enviar muestra de ubicación |
| `GET` | `/api/circles/:id/history` | Cronología de un día (fecha + zona horaria) |
| `GET/POST/PATCH/DELETE` | `/api/circles/:id/places[/:placeId]` | Geocercas ilimitadas |
| `GET/POST` | `/api/circles/:id/messages` | Chat con imágenes |
| `GET/POST` | `/api/circles/:id/sos` | Enviar alerta SOS |
| `POST` | `/api/circles/:id/sos/:sosId` | `ack`, `resolved`, `cancel`, `confirm` |
| `GET` | `/api/circles/:id/driving?days=7` | Informes de conducción |
| `GET/POST` | `/api/events`, `/api/events/read` | Bandeja de notificaciones |
| `GET` | `/api/capabilities`, `/api/health` | Funciones incluidas y estado |

---

## Privacidad, consentimiento y límites honestos

- El uso compartido está **desactivado por defecto**. Cada persona lo activa voluntariamente por círculo mediante un diálogo de consentimiento y puede pausarlo en cualquier momento; al pausar, el servidor deja de exponer su posición al resto.
- Unirse a un círculo requiere un código de invitación. No hay seguimiento encubierto, ni «modo invisible» para vigilar a terceros.
- Los datos se almacenan **en el servidor que ejecutas tú**. No hay analítica, publicidad ni cesión a terceros. Cualquier despliegue público debería añadir TLS, copias de seguridad y su propia política de privacidad.
- **SOS no es una central de emergencias:** avisa a los miembros conectados del círculo y ofrece enlaces de llamada/SMS a los contactos configurados. No envía SMS automáticamente ni contacta con servicios de emergencia. Ante una emergencia real, llama al **112**.
- **La detección de colisiones es orientativa:** usa muestras de velocidad del navegador y el acelerómetro cuando existe. No sustituye a los sensores de un vehículo ni a un servicio de asistencia profesional.
- Los informes de conducción son estimaciones a partir de GPS; la precisión depende del dispositivo y de la señal.
- Para producción multi-usuario se recomienda sustituir el almacén JSON por una base de datos, añadir rate limiting, TLS y un sistema de notificaciones push real.

## Licencia

Apache License 2.0 (ver [LICENSE](LICENSE)). Leaflet se distribuye bajo BSD-2-Clause y está incluido en `public/vendor/leaflet`. La capa opcional de OpenStreetMap usa teselas de © OpenStreetMap contributors.
