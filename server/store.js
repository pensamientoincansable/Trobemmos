/**
 * Persistencia ligera en archivo JSON. Sin bases de datos nativas ni servicios
 * externos: `npm install && npm start` y la app funciona. Los datos viven en
 * `data/` (fuera de Git) y cada usuario puede exportarlos o borrarlos.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pruneOld, distanceMeters } from './core.js';

const ROOT = process.cwd();
export const DATA_DIR = process.env.TROBEMMOS_DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
  console.error(`[store] No se pudo crear el directorio de datos ${DATA_DIR}: ${err.message}`);
  console.error('[store] Define TROBEMMOS_DATA_DIR apuntando a una carpeta con permisos de escritura.');
  process.exit(1);
}

const emptyState = () => ({
  version: 1,
  users: {},
  sessions: {},
  circles: {},
  locations: {},       // userId -> muestras ordenadas
  live: {},            // userId -> última muestra
  trips: {},           // tripId -> viaje
  tripState: {},       // userId -> estado del viaje en curso
  geoStates: {},       // `${circleId}:${userId}:${placeId}` -> dentro?
  events: [],          // bandeja de alertas / notificaciones
  counters: {},
  meta: { createdAt: Date.now(), retentionDays: 90 },
});

function load() {
  if (!fs.existsSync(STATE_FILE)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('estado no válido');
    return { ...emptyState(), ...parsed };
  } catch (err) {
    // No perdemos datos en silencio: apartamos el archivo dañado y seguimos.
    const broken = `${STATE_FILE}.corrupt-${Date.now()}`;
    try { fs.renameSync(STATE_FILE, broken); } catch {}
    console.error(`[store] state.json no se pudo leer (${err.message}). Se ha guardado una copia en ${broken} y se empieza de cero.`);
    return emptyState();
  }
}

export const state = load();

let saveTimer = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, 300);
}

export function flush() {
  // Escritura atómica: si el proceso muere a mitad, el state.json anterior
  // sigue siendo válido en lugar de quedar truncado.
  const tmp = `${STATE_FILE}.tmp`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('[store] no se pudo guardar el estado:', err.message);
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}

/** Copia de seguridad del estado (se usa al arrancar, antes de sobrescribir). */
export function backupState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const backup = `${STATE_FILE}.bak`;
    fs.copyFileSync(STATE_FILE, backup);
    return backup;
  } catch { return null; }
}

process.on('SIGTERM', () => { try { flush(); } catch {} });
process.on('SIGINT', () => { try { flush(); } catch {} });

export const uid = (prefix = 'id') => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false;
  const candidate = crypto.scryptSync(password, user.salt, 64);
  const stored = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  state.sessions[token] = { userId, createdAt: Date.now() };
  save();
  return token;
}

export function sessionUser(token) {
  const session = state.sessions[token];
  return session ? state.users[session.userId] || null : null;
}

export function destroySession(token) {
  delete state.sessions[token];
  save();
}

export function publicUser(user, { email = false } = {}) {
  if (!user) return null;
  const { passwordHash, salt, ...rest } = user;
  if (!email) delete rest.email;
  return rest;
}

export function createUser({ name, email, password, emoji = '🙂', color = '#5b6ef5', isDemo = false }) {
  const id = uid('usr');
  const { salt, hash } = hashPassword(password || crypto.randomBytes(12).toString('hex'));
  const user = {
    id,
    name,
    email: (email || `${id}@local`).toLowerCase(),
    passwordHash: hash,
    salt,
    emoji,
    color,
    isDemo,
    phone: '',
    emergencyContacts: [],
    createdAt: Date.now(),
    settings: {
      shareLocation: false,       // Consentimiento explícito, desactivado por defecto.
      notifications: true,
      speedLimitKmh: 50,
      crashDetection: true,
      lowBatteryAlerts: true,
      units: 'km',
    },
  };
  state.users[id] = user;
  save();
  return user;
}

export function makeInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (Object.values(state.circles).some((c) => c.code === code));
  return code;
}

export function createCircle(ownerId, name = 'Mi círculo') {
  const id = uid('cir');
  const circle = {
    id,
    name,
    code: makeInviteCode(),
    ownerId,
    createdAt: Date.now(),
    members: { [ownerId]: { role: 'owner', joinedAt: Date.now(), sharing: true } },
    places: {},
    messages: [],
    sos: [],
    settings: { speedLimitKmh: 50 },
  };
  state.circles[id] = circle;
  save();
  return circle;
}

export function userCircles(userId) {
  return Object.values(state.circles).filter((c) => Boolean(c.members[userId]));
}

export function isMember(circle, userId) {
  return Boolean(circle?.members?.[userId]);
}

export function circleSummary(circle, userId) {
  return {
    ...circle,
    memberCount: Object.keys(circle.members).length,
    unread: state.events.filter((e) => e.circleId === circle.id && !e.readBy?.includes(userId)).length,
  };
}

/** Snapshot completo de un círculo para la pantalla principal. */
export function circleSnapshot(circle, viewerId) {
  const members = Object.entries(circle.members).map(([id, membership]) => {
    const user = state.users[id];
    const live = state.live[id] || null;
    return {
      ...publicUser(user),
      membership,
      // Si el miembro pausó el uso compartido no exponemos su posición.
      location: membership.sharing && user?.settings?.shareLocation !== false ? live : null,
      sharing: Boolean(membership.sharing) && user?.settings?.shareLocation !== false,
      paused: !membership.sharing || user?.settings?.shareLocation === false,
    };
  });
  return {
    ...circleSummary(circle, viewerId),
    members,
    places: Object.values(circle.places),
    messages: circle.messages.slice(-120),
    sos: circle.sos.slice(-20).reverse(),
    alerts: state.events.filter((e) => e.circleId === circle.id).slice(-80).reverse(),
  };
}

export function addEvent(event) {
  const full = {
    id: uid('evt'),
    ts: event.ts || Date.now(),
    readBy: [],
    severity: event.severity || 'info',
    ...event,
  };
  state.events.push(full);
  if (state.events.length > 1200) state.events.splice(0, state.events.length - 1200);
  save();
  return full;
}

export function eventsForUser(userId, since = 0) {
  const circleIds = new Set(userCircles(userId).map((c) => c.id));
  return state.events
    .filter((e) => e.ts > since && (circleIds.has(e.circleId) || e.userId === userId || e.targetUserId === userId))
    .map((e) => ({ ...e, read: Boolean(e.readBy?.includes(userId)) }))
    .slice(-200);
}

export function markEventsRead(userId, ids) {
  // `ids === undefined` -> todas (lo pide «Marcar leídas»). Una lista vacía no
  // debe marcar nada: antes convertía en leída toda la bandeja por error.
  const all = ids === undefined || ids === null;
  const set = new Set(all ? [] : ids);
  let changed = 0;
  for (const e of state.events) {
    if (all || set.has(e.id)) {
      e.readBy ||= [];
      if (!e.readBy.includes(userId)) { e.readBy.push(userId); changed++; }
    }
  }
  if (changed) save();
  return changed;
}

export function appendLocation(userId, sample) {
  const list = (state.locations[userId] ||= []);
  list.push(sample);
  if (list.length > 30000) list.splice(0, list.length - 30000);
  state.live[userId] = sample;
  save();
}

export function locationsBetween(userId, from, to) {
  return (state.locations[userId] || []).filter((s) => s.ts >= from && s.ts <= to);
}

export function nearestPlace(circleId, sample) {
  const circle = state.circles[circleId];
  if (!circle || !sample) return null;
  return Object.values(circle.places)
    .map((p) => ({ place: p, distance: Math.round(distanceMeters(sample, p)) }))
    .filter((x) => x.distance <= (x.place.radius || 200) * 1.25)
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

/** Guarda una imagen de chat (data URL) como archivo y devuelve su ruta pública. */
export function saveImage(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Formato de imagen no admitido');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2_500_000) throw new Error('La imagen supera los 2,5 MB');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[match[1]];
  const filename = `${uid('img')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/media/${filename}`;
}

/** Derecho al olvido: elimina cuenta, posiciones, viajes y mensajes propios. */
export function deleteUserData(userId) {
  delete state.users[userId];
  delete state.locations[userId];
  delete state.live[userId];
  delete state.tripState[userId];
  for (const [id, t] of Object.entries(state.trips)) if (t.userId === userId) delete state.trips[id];
  for (const token of Object.keys(state.sessions)) if (state.sessions[token].userId === userId) delete state.sessions[token];
  for (const circle of Object.values(state.circles)) {
    delete circle.members[userId];
    circle.messages = circle.messages.filter((m) => m.userId !== userId);
    if (!Object.keys(circle.members).length) delete state.circles[circle.id];
  }
  for (const key of Object.keys(state.geoStates)) if (key.includes(`:${userId}:`)) delete state.geoStates[key];
  state.events = state.events.filter((e) => e.userId !== userId);
  flush();
}

export function pruneRetention() {
  const cutoff = pruneOld(Date.now(), state.meta.retentionDays || 90);
  for (const [userId, list] of Object.entries(state.locations)) {
    const kept = list.filter((s) => s.ts >= cutoff);
    if (kept.length !== list.length) state.locations[userId] = kept;
  }
  for (const [id, trip] of Object.entries(state.trips)) if (trip.endAt && trip.endAt < cutoff) delete state.trips[id];
  state.events = state.events.filter((e) => e.ts >= cutoff);
  for (const circle of Object.values(state.circles)) circle.messages = circle.messages.filter((m) => m.ts >= cutoff);
  save();
}
