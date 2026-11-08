/**
 * Trobemmos — servidor HTTP + WebSocket en tiempo real.
 * Sin servicios de terceros: Express, ws y un archivo JSON local.
 */
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  state, DATA_DIR, UPLOAD_DIR, publicUser, createUser, createSession, sessionUser,
  destroySession, verifyPassword, createCircle, makeInviteCode, userCircles,
  circleSnapshot, circleSummary, addEvent, eventsForUser, markEventsRead,
  locationsBetween, appendLocation, saveImage, deleteUserData, flush, save, uid, pruneRetention,
} from './store.js';
import { processLocation, createSosRecord, closeStaleTrips } from './location.js';
import { buildDayTimeline, summarizeDriving, drivingScore, clamp, HISTORY_DAYS } from './core.js';
import {
  ensureDemo, demoCredentials, startDemoSimulation, stopDemoSimulation,
  simulateCrash, markManualLocation, demoState,
} from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
// El chat admite imágenes de hasta 2,5 MB, que en base64 ocupan ~3,4 MB:
// el límite debe cubrirlas o el navegador recibe un 500 al adjuntar una foto.
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const PUBLIC_APIS = new Set(['/api/health', '/api/capabilities', '/api/auth/login', '/api/auth/register', '/api/auth/demo']);

function auth(req, res, next) {
  if (PUBLIC_APIS.has(req.path)) return next();
  if (!req.path.startsWith('/api/')) return next();
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const user = sessionUser(token);
  if (!user) return res.status(401).json({ error: 'Sesión no válida. Inicia sesión de nuevo.' });
  req.user = user;
  req.token = token;
  next();
}
app.use(auth);

const wrap = (fn) => (req, res, next) => {
  try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); }
};
const fail = (res, code, message) => res.status(code).json({ error: message });

function getCircle(req, res, { owner = false } = {}) {
  const circle = state.circles[req.params.id];
  if (!circle) { fail(res, 404, 'Círculo no encontrado'); return null; }
  if (!circle.members[req.user.id]) { fail(res, 403, 'No perteneces a este círculo'); return null; }
  if (owner && circle.ownerId !== req.user.id) { fail(res, 403, 'Solo el administrador puede hacer esto'); return null; }
  return circle;
}

/** Clientes WebSocket autenticados. */
const clients = new Map();
function broadcast(circleId, payload) {
  const circle = state.circles[circleId];
  if (!circle) return;
  const msg = JSON.stringify({ ...payload, circleId });
  for (const [ws, meta] of clients) {
    if (ws.readyState === WebSocket.OPEN && circle.members[meta.userId]) {
      try { ws.send(msg); } catch { /* cliente desconectado */ }
    }
  }
}
function broadcastAll(payload) {
  const msg = JSON.stringify(payload);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) { try { ws.send(msg); } catch {} }
  }
}

/* ------------------------------------------------------------------ */
/* Capacidades / salud                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Trobemmos', time: Date.now(), demo: demoState() }));

export const CAPABILITIES = [
  { id: 'live', group: 'Ubicación', name: 'Ubicación en tiempo real', detail: 'Mapa en vivo de todos los miembros del círculo', included: true },
  { id: 'circles', group: 'Ubicación', name: 'Círculos ilimitados', detail: 'Crea y únete a tantos círculos como quieras', included: true },
  { id: 'places', group: 'Ubicación', name: 'Lugares ilimitados', detail: 'Geocercas con radio y alertas de entrada/salida', included: true },
  { id: 'place_alerts', group: 'Ubicación', name: 'Alertas de lugares ilimitadas', detail: 'Sin cupos diarios ni límites por plan', included: true },
  { id: 'history', group: 'Ubicación', name: `Historial de ${HISTORY_DAYS} días`, detail: 'Cronología diaria, trayectos y reproducción', included: true },
  { id: 'chat', group: 'Comunicación', name: 'Chat privado con fotos', detail: 'Mensajes de texto e imágenes dentro del círculo', included: true },
  { id: 'battery', group: 'Seguridad', name: 'Aviso de batería baja', detail: 'Nivel de batería y aviso al bajar del 20%', included: true },
  { id: 'sos', group: 'Seguridad', name: 'Alerta SOS silenciosa', detail: 'Avisa al círculo y ofrece llamada/SMS a contactos', included: true },
  { id: 'crash', group: 'Seguridad', name: 'Detección de accidentes', detail: 'Heurística de impacto con cancelación rápida', included: true },
  { id: 'driving', group: 'Conducción', name: 'Informes de conducción', detail: 'Velocidad, frenazos, aceleraciones, uso del móvil y puntuación', included: true },
  { id: 'family_report', group: 'Conducción', name: 'Informe familiar semanal', detail: 'Ranking y comparativa de todos los conductores', included: true },
  { id: 'ads', group: 'Experiencia', name: 'Sin publicidad', detail: 'Ni anuncios, ni rastreadores de terceros', included: true },
  { id: 'no_paywall', group: 'Experiencia', name: 'Sin suscripciones', detail: 'Todas las funciones activadas desde el primer minuto', included: true },
];

app.get('/api/capabilities', (req, res) => res.json({
  app: 'Trobemmos',
  tagline: 'Encuentra a tu gente',
  plan: 'Todo incluido · Gratis',
  price: 0,
  retentionDays: HISTORY_DAYS,
  features: CAPABILITIES,
  notice: 'Producto independiente de código abierto. No usa marca, APIs, datos ni servicios de Life360.',
  limitations: [
    'La detección de colisión es una heurística del navegador: no sustituye a los sensores del vehículo ni a una central de emergencias.',
    'Las alertas SOS llegan a los miembros conectados del círculo y ofrecen enlaces de llamada/SMS a los contactos que configures; no envían SMS por sí solas.',
    'Compartir ubicación requiere el consentimiento y el permiso activo de cada persona.',
  ],
}));

/* ------------------------------------------------------------------ */
/* Autenticación y cuenta                                              */
/* ------------------------------------------------------------------ */

app.post('/api/auth/register', wrap((req, res) => {
  const { name, email, password, emoji, color } = req.body || {};
  if (!name || !email || !password) return fail(res, 400, 'Nombre, correo y contraseña son obligatorios');
  if (String(password).length < 6) return fail(res, 400, 'La contraseña debe tener al menos 6 caracteres');
  const normalized = String(email).toLowerCase();
  if (Object.values(state.users).some((u) => u.email === normalized)) return fail(res, 409, 'Ya existe una cuenta con ese correo');
  const user = createUser({ name: String(name).slice(0, 60), email: normalized, password, emoji: emoji || '🙂', color: color || '#5b6ef5' });
  createCircle(user.id, 'Mi círculo');
  const token = createSession(user.id);
  return res.json({ token, user: publicUser(user, { email: true }) });
}));

app.post('/api/auth/login', wrap((req, res) => {
  const { email, password } = req.body || {};
  const user = Object.values(state.users).find((u) => u.email === String(email || '').toLowerCase());
  if (!user || !verifyPassword(String(password || ''), user)) return fail(res, 401, 'Correo o contraseña incorrectos');
  const token = createSession(user.id);
  return res.json({ token, user: publicUser(user, { email: true }) });
}));

app.post('/api/auth/demo', wrap((req, res) => {
  ensureDemo();
  const creds = demoCredentials();
  const user = Object.values(state.users).find((u) => u.email === creds.email);
  if (!user) return fail(res, 500, 'No se pudo crear la cuenta de demostración');
  const token = createSession(user.id);
  return res.json({ token, user: publicUser(user, { email: true }), demo: true });
}));

app.post('/api/auth/logout', wrap((req, res) => {
  destroySession(req.token);
  res.json({ ok: true });
}));

app.get('/api/me', wrap((req, res) => {
  res.json({ user: publicUser(req.user, { email: true }), circles: userCircles(req.user.id).map((c) => circleSummary(c, req.user.id)) });
}));

app.patch('/api/me', wrap((req, res) => {
  const { name, emoji, color, phone, emergencyContacts, settings } = req.body || {};
  const u = req.user;
  if (name) u.name = String(name).slice(0, 60);
  if (emoji) u.emoji = String(emoji).slice(0, 4);
  if (color) u.color = String(color).slice(0, 20);
  if (phone !== undefined) u.phone = String(phone).slice(0, 30);
  if (Array.isArray(emergencyContacts)) {
    u.emergencyContacts = emergencyContacts.slice(0, 10).map((c) => ({
      id: c.id || uid('ct'), name: String(c.name || '').slice(0, 60), phone: String(c.phone || '').slice(0, 30),
    })).filter((c) => c.name && c.phone);
  }
  if (settings && typeof settings === 'object') u.settings = { ...u.settings, ...settings };
  save();
  res.json({ user: publicUser(u, { email: true }) });
}));

app.get('/api/me/export', wrap((req, res) => {
  const circleIds = userCircles(req.user.id).map((c) => c.id);
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'Trobemmos',
    user: publicUser(req.user, { email: true }),
    circles: Object.values(state.circles).filter((c) => circleIds.includes(c.id)),
    locations: state.locations[req.user.id] || [],
    trips: Object.values(state.trips).filter((t) => t.userId === req.user.id),
    events: state.events.filter((e) => e.userId === req.user.id),
  };
  res.set('Content-Disposition', 'attachment; filename="trobemmos-mis-datos.json"');
  res.json(payload);
}));

app.delete('/api/me', wrap((req, res) => {
  deleteUserData(req.user.id);
  res.json({ ok: true, message: 'Cuenta y datos eliminados' });
}));

/* ------------------------------------------------------------------ */
/* Círculos                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/circles', wrap((req, res) => {
  res.json({ circles: userCircles(req.user.id).map((c) => circleSummary(c, req.user.id)) });
}));

app.post('/api/circles', wrap((req, res) => {
  const name = String(req.body?.name || 'Mi círculo').slice(0, 60);
  const circle = createCircle(req.user.id, name);
  res.status(201).json({ circle: circleSnapshot(circle, req.user.id) });
}));

app.post('/api/circles/join', wrap((req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const circle = Object.values(state.circles).find((c) => c.code === code);
  if (!circle) return fail(res, 404, 'Código de invitación no válido');
  if (circle.members[req.user.id]) return res.json({ circle: circleSnapshot(circle, req.user.id), already: true });
  circle.members[req.user.id] = { role: 'member', joinedAt: Date.now(), sharing: false };
  const event = addEvent({
    type: 'member_joined', circleId: circle.id, userId: req.user.id, userName: req.user.name,
    title: `${req.user.name} se ha unido al círculo`, body: 'Ya puede activar el uso compartido de ubicación.', severity: 'info',
  });
  save();
  broadcast(circle.id, { type: 'event', event });
  res.status(201).json({ circle: circleSnapshot(circle, req.user.id) });
}));

app.get('/api/circles/:id', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  res.json({ circle: circleSnapshot(circle, req.user.id) });
}));

app.patch('/api/circles/:id', wrap((req, res) => {
  const circle = getCircle(req, res, { owner: true });
  if (!circle) return;
  if (req.body?.name) circle.name = String(req.body.name).slice(0, 60);
  if (req.body?.settings) circle.settings = { ...circle.settings, ...req.body.settings };
  if (req.body?.regenerateCode) circle.code = makeInviteCode();
  save();
  broadcast(circle.id, { type: 'circle', action: 'updated' });
  res.json({ circle: circleSnapshot(circle, req.user.id) });
}));

app.delete('/api/circles/:id', wrap((req, res) => {
  const circle = getCircle(req, res, { owner: true });
  if (!circle) return;
  delete state.circles[circle.id];
  save();
  res.json({ ok: true });
}));

app.post('/api/circles/:id/leave', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  delete circle.members[req.user.id];
  if (!Object.keys(circle.members).length) delete state.circles[circle.id];
  else if (circle.ownerId === req.user.id) circle.ownerId = Object.keys(circle.members)[0];
  save();
  res.json({ ok: true });
}));

app.delete('/api/circles/:id/members/:userId', wrap((req, res) => {
  const circle = getCircle(req, res, { owner: true });
  if (!circle) return;
  if (!circle.members[req.params.userId]) return fail(res, 404, 'Miembro no encontrado');
  delete circle.members[req.params.userId];
  save();
  res.json({ ok: true });
}));

app.patch('/api/circles/:id/sharing', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const member = circle.members[req.user.id];
  member.sharing = Boolean(req.body?.sharing);
  // Activar/desactivar el uso compartido es una decisión explícita de cada persona.
  if (member.sharing) req.user.settings.shareLocation = true;
  else {
    const stillSharing = userCircles(req.user.id).some((c) => c.id !== circle.id && c.members[req.user.id].sharing);
    if (!stillSharing) req.user.settings.shareLocation = false;
  }
  save();
  broadcast(circle.id, { type: 'refresh' });
  res.json({ ok: true, sharing: member.sharing });
}));

/* ------------------------------------------------------------------ */
/* Ubicación e historial                                               */
/* ------------------------------------------------------------------ */

app.post('/api/circles/:id/location', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  if (!circle.members[req.user.id].sharing) return fail(res, 403, 'Activa el uso compartido de ubicación en este círculo');
  const s = req.body || {};
  if (!Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lng))) return fail(res, 400, 'Se requieren latitud y longitud');
  markManualLocation(req.user.id);
  const result = processLocation({
    user: req.user,
    sample: {
      lat: Number(s.lat), lng: Number(s.lng), accuracy: Number(s.accuracy) || 20,
      speed: Number(s.speed) || 0, battery: s.battery ?? null,
      heading: Number(s.heading) || 0, screenActive: Boolean(s.screenActive),
      motion: s.motion || null, source: 'browser',
    },
    broadcast,
    allowCrashDetection: req.user.settings.crashDetection !== false,
  });
  res.json({ ok: true, ...result });
}));

/** Cronología de un día. `date` = YYYY-MM-DD; `tzOffset` = minutos (Date.getTimezoneOffset). */
app.get('/api/circles/:id/history', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  const tzOffset = clamp(Number(req.query.tzOffset) || 0, -840, 840);
  const start = Date.parse(`${date}T00:00:00Z`) + tzOffset * 60000;
  const end = start + 86400000;
  const places = Object.values(circle.places);
  const onlyUser = req.query.userId && circle.members[req.query.userId] ? req.query.userId : null;
  const members = Object.entries(circle.members)
    .filter(([id, m]) => (!onlyUser || id === onlyUser) && m.sharing)
    .map(([id]) => {
      const user = state.users[id];
      const samples = locationsBetween(id, start, end);
      const timeline = buildDayTimeline(samples, places);
      return {
        userId: id,
        name: user?.name || 'Miembro', emoji: user?.emoji || '🙂', color: user?.color || '#5b6ef5',
        points: samples.map((s) => [s.lat, s.lng, s.ts, Math.round(s.speed || 0)]),
        timeline,
        last: samples.at(-1) || null,
      };
    });
  res.json({ date, start, end, members, retentionDays: HISTORY_DAYS });
}));

/* ------------------------------------------------------------------ */
/* Lugares (ilimitados)                                                */
/* ------------------------------------------------------------------ */

app.get('/api/circles/:id/places', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  res.json({ places: Object.values(circle.places) });
}));

app.post('/api/circles/:id/places', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const b = req.body || {};
  if (!b.name || !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) return fail(res, 400, 'Nombre y coordenadas obligatorios');
  const place = {
    id: uid('plc'),
    name: String(b.name).slice(0, 50),
    icon: String(b.icon || '📍').slice(0, 4),
    color: String(b.color || '#5b6ef5').slice(0, 20),
    lat: clamp(Number(b.lat), -90, 90),
    lng: clamp(Number(b.lng), -180, 180),
    radius: clamp(Number(b.radius) || 200, 20, 5000),
    alertsOn: b.alertsOn !== false,
    createdBy: req.user.id,
    createdAt: Date.now(),
  };
  circle.places[place.id] = place;
  save();
  broadcast(circle.id, { type: 'places', action: 'updated' });
  res.status(201).json({ place });
}));

app.patch('/api/circles/:id/places/:placeId', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const place = circle.places[req.params.placeId];
  if (!place) return fail(res, 404, 'Lugar no encontrado');
  const b = req.body || {};
  for (const key of ['name', 'icon', 'color']) if (b[key] !== undefined) place[key] = String(b[key]).slice(0, 50);
  for (const key of ['lat', 'lng', 'radius']) if (Number.isFinite(Number(b[key])) && b[key] !== undefined) place[key] = Number(b[key]);
  if (b.alertsOn !== undefined) place.alertsOn = Boolean(b.alertsOn);
  place.radius = clamp(place.radius, 20, 5000);
  save();
  broadcast(circle.id, { type: 'places', action: 'updated' });
  res.json({ place });
}));

app.delete('/api/circles/:id/places/:placeId', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  if (!circle.places[req.params.placeId]) return fail(res, 404, 'Lugar no encontrado');
  delete circle.places[req.params.placeId];
  for (const key of Object.keys(state.geoStates)) if (key.endsWith(`:${req.params.placeId}`)) delete state.geoStates[key];
  save();
  broadcast(circle.id, { type: 'places', action: 'updated' });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

app.get('/api/circles/:id/messages', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const since = Number(req.query.since) || 0;
  res.json({ messages: circle.messages.filter((m) => m.ts > since).slice(-200) });
}));

app.post('/api/circles/:id/messages', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  let image = null;
  if (req.body?.image) {
    try { image = saveImage(req.body.image); }
    catch (e) { return fail(res, 400, e.message); }
  }
  if (!text && !image) return fail(res, 400, 'Escribe un mensaje o adjunta una imagen');
  const message = {
    id: uid('msg'), circleId: circle.id, userId: req.user.id, userName: req.user.name,
    kind: image ? 'image' : 'text', text, image, ts: Date.now(),
  };
  circle.messages.push(message);
  if (circle.messages.length > 500) circle.messages.shift();
  save();
  broadcast(circle.id, { type: 'message', message });
  res.status(201).json({ message });
}));

/* ------------------------------------------------------------------ */
/* SOS, colisiones y emergencias                                       */
/* ------------------------------------------------------------------ */

app.get('/api/circles/:id/sos', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  res.json({ sos: circle.sos.slice(-30).reverse() });
}));

app.post('/api/circles/:id/sos', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const live = state.live[req.user.id];
  const sample = Number.isFinite(Number(req.body?.lat)) && Number.isFinite(Number(req.body?.lng))
    ? { lat: Number(req.body.lat), lng: Number(req.body.lng), accuracy: Number(req.body.accuracy) || 20 }
    : live || null;
  const record = createSosRecord({
    user: req.user, circle, kind: 'sos', sample,
    note: String(req.body?.note || '').slice(0, 200), status: 'active',
  });
  const contacts = (req.user.emergencyContacts || []).map((c) => c.name).join(', ');
  const event = addEvent({
    type: 'sos', circleId: circle.id, userId: req.user.id, userName: req.user.name,
    title: `🆘 ${req.user.name} ha enviado una alerta SOS`,
    body: contacts ? `Contactos de emergencia: ${contacts}` : 'Abre la alerta para ver la ubicación y llamar.',
    severity: 'critical', sosId: record.id, location: sample,
  });
  save();
  broadcast(circle.id, { type: 'event', event, sos: record });
  res.status(201).json({ sos: record, event });
}));

app.post('/api/circles/:id/sos/:sosId', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const record = circle.sos.find((s) => s.id === req.params.sosId);
  if (!record) return fail(res, 404, 'Alerta no encontrada');
  const action = String(req.body?.action || 'ack');
  if (action === 'ack') {
    if (!record.acknowledgements.includes(req.user.id)) record.acknowledgements.push(req.user.id);
  } else if (action === 'resolved') {
    record.status = 'resolved';
    record.resolvedAt = Date.now();
    record.resolvedBy = req.user.id;
  } else if (action === 'cancel') {
    record.status = 'cancelled';
    addEvent({
      type: 'crash_cancelled', circleId: circle.id, userId: record.userId, userName: record.userName,
      title: `✅ ${record.userName} está bien`, body: 'La posible colisión se ha cancelado.', severity: 'info',
    });
  } else if (action === 'confirm') {
    record.status = 'active';
    addEvent({
      type: 'sos', circleId: circle.id, userId: record.userId, userName: record.userName,
      title: `🆘 Colisión confirmada: ${record.userName} necesita ayuda`,
      body: 'Se ha compartido la ubicación con el círculo y los contactos de emergencia.',
      severity: 'critical', sosId: record.id, location: record.location,
    });
  } else return fail(res, 400, 'Acción no válida');
  save();
  broadcast(circle.id, { type: 'sos', action, sos: record });
  res.json({ sos: record });
}));

/* ------------------------------------------------------------------ */
/* Conducción                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/circles/:id/driving', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const days = clamp(Number(req.query.days) || 7, 1, HISTORY_DAYS);
  const cutoff = Date.now() - days * 864e5;
  const memberIds = Object.keys(circle.members);
  const trips = Object.values(state.trips)
    .filter((t) => memberIds.includes(t.userId) && (t.endAt || t.startAt) >= cutoff)
    .sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
  const summary = summarizeDriving(trips);
  summary.drivers = summary.drivers.map((d) => ({
    ...d,
    name: state.users[d.userId]?.name || 'Miembro',
    emoji: state.users[d.userId]?.emoji || '🙂',
    color: state.users[d.userId]?.color || '#5b6ef5',
  }));
  res.json({
    days, summary,
    trips: trips.slice(0, 80).map(({ points, ...t }) => t),
    speedLimitKmh: req.user.settings.speedLimitKmh || 50,
  });
}));

app.get('/api/circles/:id/trips/:tripId', wrap((req, res) => {
  const circle = getCircle(req, res);
  if (!circle) return;
  const trip = state.trips[req.params.tripId];
  if (!trip || !circle.members[trip.userId]) return fail(res, 404, 'Viaje no encontrado');
  res.json({ trip });
}));

/* ------------------------------------------------------------------ */
/* Eventos / notificaciones                                            */
/* ------------------------------------------------------------------ */

app.get('/api/events', wrap((req, res) => {
  const since = Number(req.query.since) || 0;
  res.json({ events: eventsForUser(req.user.id, since), now: Date.now() });
}));

app.post('/api/events/read', wrap((req, res) => {
  const ids = req.body?.all ? undefined : (req.body?.ids || []);
  const changed = markEventsRead(req.user.id, ids);
  res.json({ ok: true, changed });
}));

/* ------------------------------------------------------------------ */
/* Utilidades de demostración                                          */
/* ------------------------------------------------------------------ */

app.post('/api/demo/simulate-crash', wrap((req, res) => {
  if (!req.user.isDemo) return fail(res, 403, 'Solo disponible en la cuenta de demostración');
  const circleId = state.meta.demoCircleId;
  const record = simulateCrash(req.user.id, broadcast);
  if (!record) return fail(res, 400, 'No se pudo simular la colisión');
  res.json({ sos: record });
}));

app.post('/api/demo/simulate-trip', wrap((req, res) => {
  if (!req.user.isDemo) return fail(res, 403, 'Solo disponible en la cuenta de demostración');
  const circleId = state.meta.demoCircleId;
  const circle = state.circles[circleId];
  if (!circle) return fail(res, 404, 'Círculo de demo no encontrado');
  const now = Date.now();
  const startPoint = state.live[req.user.id] || { lat: 40.4203, lng: -3.7065 };
  const speeds = [18, 32, 46, 58, 72, 64, 38, 24, 52, 44, 28, 0];
  const points = speeds.map((speed, i) => [startPoint.lat + i * 0.00075, startPoint.lng + i * 0.0009]);
  const events = [
    { type: 'speeding', ts: now - 8 * 60000, severity: 'high', detail: '72 km/h (límite 50)', lat: points[4][0], lng: points[4][1] },
    { type: 'hard_braking', ts: now - 7 * 60000, severity: 'medium', detail: 'Frenada de 4,8 m/s²', lat: points[5][0], lng: points[5][1] },
    { type: 'phone_use', ts: now - 4 * 60000, severity: 'medium', detail: 'Pantalla en uso durante la marcha', lat: points[8][0], lng: points[8][1] },
    { type: 'rapid_acceleration', ts: now - 3 * 60000, severity: 'low', detail: 'Aceleración de 3,9 m/s²', lat: points[9][0], lng: points[9][1] },
  ];
  const trip = {
    id: uid('trp'), userId: req.user.id, circleIds: [circleId],
    startAt: now - 12 * 60000, endAt: now, distanceKm: 5.4,
    maxSpeed: 72, avgSpeed: 40, samples: speeds.length,
    score: drivingScore(events), events, points, demo: true,
  };
  state.trips[trip.id] = trip;
  const end = points.at(-1);
  appendLocation(req.user.id, {
    lat: end[0], lng: end[1], accuracy: 15, speed: 0, battery: 68,
    heading: 45, ts: now, source: 'demo-trip',
  });
  const event = addEvent({
    type: 'driving_report', circleId, userId: req.user.id, userName: req.user.name,
    title: `🚗 Nuevo viaje de ${req.user.name}`, body: `5,4 km · puntuación ${trip.score}/100 · 4 incidencias (simulado)`, severity: 'info',
  });
  save();
  broadcast(circleId, { type: 'event', event });
  broadcast(circleId, { type: 'location', userId: req.user.id, location: state.live[req.user.id], userName: req.user.name });
  res.json({ ok: true, tripId: trip.id, score: trip.score, events: events.length });
}));

/* ------------------------------------------------------------------ */
/* Estáticos y arranque                                                */
/* ------------------------------------------------------------------ */

app.use('/media', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: false }));
app.use('/vendor', express.static(path.join(ROOT, 'public/vendor'), { maxAge: '1d' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

// Cualquier navegación desconocida devuelve la app (SPA), nunca una página en
// blanco. Las rutas /api/* ya han respondido JSON antes de llegar aquí.
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/vendor/')) return next();
  res.sendFile(path.join(ROOT, 'public', 'index.html'), (err) => { if (err) next(err); });
});

app.use((req, res, next) => {
  // Cualquier /api/ sin ruta propia responde JSON (no el HTML de Express).
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta de la API no encontrada' });
  next();
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', err);
  const isBodyLimit = err.type === 'entity.too.large';
  const message = isBodyLimit
    ? 'La petición es demasiado grande. Las imágenes del chat pueden ocupar hasta 2,5 MB.'
    : err.type === 'entity.parse.failed'
      ? 'El cuerpo de la petición no es JSON válido.'
      : status >= 500 ? 'Error interno del servidor' : err.message || 'Petición no válida';
  res.status(isBodyLimit ? 413 : status).json({ error: message });
});

// Red de seguridad: un fallo inesperado no debe tumbar el servidor entero.
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); });
process.on('unhandledRejection', (err) => { console.error('[unhandledRejection]', err); });

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const user = sessionUser(url.searchParams.get('token'));
    if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.set(ws, { userId: user.id });
      ws.send(JSON.stringify({ type: 'connected', user: publicUser(user) }));
      ws.on('pong', () => {});
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(String(data));
          if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        } catch {}
      });
      ws.on('close', () => clients.delete(ws));
    });
  } catch {
    socket.destroy();
  }
});

setInterval(() => {
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) { try { ws.ping(); } catch {} }
  }
}, 30000).unref();

setInterval(() => closeStaleTrips(broadcast), 30000).unref();
setInterval(() => pruneRetention(), 6 * 3600000).unref();

server.on('error', (err) => {
  // Causa habitual: ya hay otro proceso usando el puerto. Antes el proceso
  // moría con una traza críptica; ahora se explica y se ofrece una salida.
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[trobemmos] El puerto ${PORT} ya está en uso.`);
    console.error('[trobemmos] Cierra la otra instancia o arranca en otro puerto:');
    console.error(`[trobemmos]   PORT=${PORT + 1} npm start\n`);
  } else if (err.code === 'EACCES') {
    console.error(`\n[trobemmos] No hay permisos para escuchar en el puerto ${PORT}. Prueba con PORT=3001 npm start\n`);
  } else {
    console.error('[trobemmos] Error del servidor:', err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  ensureDemo();
  startDemoSimulation(broadcast);
  console.log(`Trobemmos escuchando en http://localhost:${PORT} (interfaz y API)`);
  console.log(`Datos en ${DATA_DIR}`);
  console.log(`Demo: ${demoCredentials().email} / ${demoCredentials().password}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopDemoSimulation();
  try { flush(); } catch (e) { console.error('[trobemmos] no se pudo guardar el estado:', e.message); }
  for (const [ws] of clients) { try { ws.close(); } catch {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
