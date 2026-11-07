/**
 * Datos de demostración y simulador en vivo.
 *
 * Todo lo que aparece aquí es FICTICIO y está claramente etiquetado en la
 * interfaz. Permite probar las funciones de la app (mapa, alertas, historial,
 * informes de conducción) sin esperar a que se conecten otras personas.
 */
import { state, createUser, createCircle, uid, flush, save, addEvent } from './store.js';
import { processLocation, createSosRecord } from './location.js';
import { drivingScore, distanceMeters } from './core.js';

let seed = 20261107;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;

const HOME = { lat: 40.4203, lng: -3.7065 };
const PLACES = [
  { id: 'plc_casa', name: 'Casa', icon: '🏠', color: '#5b6ef5', lat: 40.4203, lng: -3.7065, radius: 180, alertsOn: true },
  { id: 'plc_trabajo', name: 'Trabajo', icon: '🏢', color: '#12a594', lat: 40.437, lng: -3.69, radius: 220, alertsOn: true },
  { id: 'plc_colegio', name: 'Colegio', icon: '🎒', color: '#f59e0b', lat: 40.41, lng: -3.715, radius: 200, alertsOn: true },
  { id: 'plc_gimnasio', name: 'Gimnasio', icon: '🏋️', color: '#ec4899', lat: 40.426, lng: -3.72, radius: 160, alertsOn: true },
  { id: 'plc_parque', name: 'Parque', icon: '🌳', color: '#22a06b', lat: 40.408, lng: -3.688, radius: 300, alertsOn: true },
];

const DEMO_PASSWORD = 'demo1234';

export function ensureDemo() {
  if (state.meta.demoSeeded) return;
  state.meta.demoSeeded = true;

  const people = [
    { key: 'me', name: 'Alex (tú)', emoji: '🧭', color: '#5b6ef5' },
    { key: 'lucia', name: 'Lucía', emoji: '🌻', color: '#ec4899' },
    { key: 'marcos', name: 'Marcos', emoji: '⚽', color: '#f59e0b' },
    { key: 'nuria', name: 'Nuria', emoji: '🎨', color: '#12a594' },
    { key: 'dani', name: 'Dani', emoji: '🚲', color: '#8b5cf6' },
  ];

  const users = {};
  for (const p of people) {
    const user = createUser({
      name: p.name,
      email: p.key === 'me' ? 'demo@trobemmos.local' : `${p.key}@demo.trobemmos.local`,
      password: p.key === 'me' ? DEMO_PASSWORD : uid('pwd'),
      emoji: p.emoji,
      color: p.color,
      isDemo: true,
    });
    user.settings.shareLocation = true; // Consentimiento explícito en los datos de demo.
    user.phone = p.key === 'me' ? '+34 600 000 000' : '';
    users[p.key] = user;
  }
  users.me.emergencyContacts = [
    { id: uid('ct'), name: 'Emergencias', phone: '112' },
    { id: uid('ct'), name: 'Tía Carmen', phone: '+34 600 000 001' },
  ];

  const circle = createCircle(users.me.id, 'Familia Madrid');
  circle.code = 'DEMO26';
  circle.settings = { speedLimitKmh: 50 };
  for (const p of PLACES) circle.places[p.id] = { ...p, createdBy: users.me.id, createdAt: Date.now() - 30 * 864e5 };
  for (const p of people.slice(1)) {
    circle.members[users[p.key].id] = { role: 'member', joinedAt: Date.now() - 28 * 864e5, sharing: true };
  }
  state.meta.demoCircleId = circle.id;
  state.meta.demoUserIds = Object.values(users).map((u) => u.id);

  // 30 días de historial para todos los miembros (función "premium" incluida).
  const now = Date.now();
  const dayStart = (offset) => {
    const d = new Date(now - offset * 864e5);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const anchors = {
    me: [HOME, PLACES[1], PLACES[0], PLACES[3]],
    lucia: [HOME, PLACES[1], PLACES[0], PLACES[4]],
    marcos: [HOME, PLACES[2], PLACES[0], PLACES[4]],
    nuria: [HOME, PLACES[4], PLACES[0], PLACES[3]],
    dani: [HOME, PLACES[1], PLACES[0], PLACES[2]],
  };
  const trips = [];
  for (const p of people) {
    const userId = users[p.key].id;
    const list = [];
    for (let day = 29; day >= 0; day--) {
      const base = dayStart(day);
      const [home, destination, evening, extra] = anchors[p.key];
      for (let h = 0; h < 24; h++) {
        let point = home;
        let speed = 0;
        if (h === 7) { point = { lat: lerp(home.lat, destination.lat, 0.35), lng: lerp(home.lng, destination.lng, 0.35) }; speed = 28; }
        else if (h === 8) { point = { lat: lerp(home.lat, destination.lat, 0.8), lng: lerp(home.lng, destination.lng, 0.8) }; speed = 42 + Math.round(rnd() * 18); }
        else if (h >= 9 && h <= 16) point = destination;
        else if (h === 17) { point = { lat: lerp(destination.lat, extra.lat, 0.7), lng: lerp(destination.lng, extra.lng, 0.7) }; speed = 33; }
        else if (h === 18) { point = extra; speed = 20; }
        else if (h === 19) { point = { lat: lerp(evening.lat, extra.lat, 0.4), lng: lerp(evening.lng, extra.lng, 0.4) }; speed = 35; }
        else if (h >= 20) point = evening;
        const jitter = (rnd() - 0.5) * 0.00035;
        list.push({
          lat: point.lat + jitter,
          lng: point.lng + jitter * 1.4,
          accuracy: 12 + Math.round(rnd() * 25),
          speed: speed ? Math.round(speed + (rnd() - 0.5) * 6) : 0,
          battery: Math.max(18, Math.round(100 - (h / 24) * 55 - rnd() * 12 - day * 0.05)),
          heading: 0,
          ts: base + h * 3600000 + Math.round(rnd() * 60000),
          source: 'demo',
        });
        if (speed > 0 && rnd() < 0.55 && day < 28) {
          const types = ['speeding', 'hard_braking', 'rapid_acceleration', 'phone_use'];
          const evType = pick(types);
          const events = [{ type: evType, ts: base + h * 3600000, severity: 'medium', detail: 'Registrado durante el trayecto' }];
          if (rnd() < 0.35) events.push({ type: 'speeding', ts: base + h * 3600000 + 60000, severity: 'low', detail: '58 km/h (límite 50)' });
          const km = 2.5 + rnd() * 6;
          trips.push({
            id: uid('trp'), userId, circleIds: [circle.id],
            startAt: base + 7 * 3600000, endAt: base + 8 * 3600000 + 600000,
            distanceKm: Math.round(km * 10) / 10,
            maxSpeed: Math.round(45 + rnd() * 30), avgSpeed: 34,
            samples: 12, score: drivingScore(events), events,
            points: [[home.lat, home.lng], [destination.lat, destination.lng]],
            demo: true,
          });
        }
      }
    }
    list.sort((a, b) => a.ts - b.ts);
    state.locations[userId] = list;
    // La posición en vivo coincide con el inicio de la ruta del simulador:
    // así no se disparan falsas alertas de entrada/salida en el arranque.
    const initial = ROUTES[p.key][0];
    state.live[userId] = { ...initial, accuracy: 18, speed: 0, battery: 62 + people.indexOf(p) * 8, heading: 0, ts: now - Math.round(rnd() * 90000), source: 'demo' };
    state.tripState[userId] = { tripId: null, lastSample: state.live[userId], lastMoveTs: 0, batteryLow: false };
    for (const place of PLACES) {
      state.geoStates[`${circle.id}:${userId}:${place.id}`] = distanceMeters(initial, place) <= place.radius;
    }
  }
  for (const t of trips) state.trips[t.id] = t;

  // Chat del círculo.
  const msg = (key, text, hoursAgo) => ({
    id: uid('msg'), circleId: circle.id, userId: users[key].id,
    userName: users[key].name, kind: 'text', text, image: null,
    ts: now - hoursAgo * 3600000,
  });
  circle.messages = [
    msg('lucia', '¡Buenos días! He dejado las llaves encima de la mesa 👀', 30),
    msg('marcos', 'Salgo del cole en diez minutos, voy para casa', 27),
    msg('me', 'Perfecto, os veo en el mapa. ¿Traéis algo para cenar? 🍕', 26),
    msg('nuria', 'Paso por el parque con la bici, llegaré sobre las siete', 6),
    msg('dani', 'He creado el lugar "Gimnasio" para que avise al llegar 💪', 4),
    msg('lucia', '¡Ya estoy en casa! 🏠', 1.2),
  ];

  // Bandeja de alertas y SOS histórico resuelto (todo simulado).
  const add = (type, title, body, hoursAgo, severity = 'info', extra = {}) => {
    state.events.push({
      id: uid('evt'), ts: now - hoursAgo * 3600000, circleId: circle.id,
      userId: users.lucia.id, userName: 'Lucía', type, title, body, severity,
      readBy: [], ...extra,
    });
  };
  add('place_entry', 'Lucía ha llegado a Casa', '🏠 Casa · 19:42', 1.2);
  add('place_exit', 'Marcos ha salido de Colegio', '🎒 Colegio · 17:05', 4.5);
  add('place_entry', 'Marcos ha llegado a Casa', '🏠 Casa · 17:48', 3.8);
  add('low_battery', '🔋 Dani tiene la batería al 14%', 'Puede dejar de compartir su ubicación pronto.', 8, 'warning');
  add('place_entry', 'Nuria ha llegado a Parque', '🌳 Parque · 11:20', 11);
  add('speeding', 'Exceso de velocidad en un trayecto', '72 km/h (límite 50)', 26, 'warning');
  add('place_exit', 'Lucía ha salido de Trabajo', '🏢 Trabajo · 18:35', 27);
  add('crash', 'Posible colisión cancelada', 'El usuario confirmó que estaba bien.', 52, 'info');
  add('sos', 'Alerta SOS resuelta', 'Todo el círculo fue notificado y se marcó como resuelta.', 74, 'info');
  state.events.sort((a, b) => a.ts - b.ts);
  circle.sos.push({
    id: uid('sos'), kind: 'sos', userId: users.dani.id, userName: 'Dani', userEmoji: '🚲',
    circleId: circle.id, ts: now - 74 * 3600000, status: 'resolved', note: 'Prueba del botón SOS',
    location: { lat: HOME.lat, lng: HOME.lng }, emergencyContacts: [], acknowledgements: [users.me.id],
  });

  flush();
}

export function demoCredentials() {
  return { email: 'demo@trobemmos.local', password: DEMO_PASSWORD };
}

/** Estado en memoria del simulador (no se persiste). */
const sim = new Map();
const manualUsers = new Set();

const ROUTES = {
  me: [
    { lat: 40.4203, lng: -3.7065 }, { lat: 40.426, lng: -3.7 },
    { lat: 40.437, lng: -3.69 }, { lat: 40.428, lng: -3.701 }, { lat: 40.4203, lng: -3.7065 },
  ],
  lucia: [
    { lat: 40.437, lng: -3.69 }, { lat: 40.431, lng: -3.697 },
    { lat: 40.423, lng: -3.706 }, { lat: 40.4203, lng: -3.7065 },
  ],
  marcos: [
    { lat: 40.41, lng: -3.715 }, { lat: 40.414, lng: -3.711 },
    { lat: 40.419, lng: -3.708 }, { lat: 40.4203, lng: -3.7065 },
  ],
  nuria: [
    { lat: 40.408, lng: -3.688 }, { lat: 40.412, lng: -3.695 },
    { lat: 40.417, lng: -3.702 }, { lat: 40.4203, lng: -3.7065 },
  ],
  dani: [
    { lat: 40.426, lng: -3.72 }, { lat: 40.422, lng: -3.714 },
    { lat: 40.418, lng: -3.708 }, { lat: 40.410, lng: -3.715 },
  ],
};

function setupSim() {
  const ids = state.meta.demoUserIds || [];
  const keys = ['me', 'lucia', 'marcos', 'nuria', 'dani'];
  keys.forEach((key, i) => {
    const userId = ids[i];
    if (!userId || sim.has(userId)) return;
    const route = ROUTES[key];
    sim.set(userId, {
      key, route, target: 1,
      pos: { ...route[0] },
      dwell: i * 2,
      battery: key === 'dani' ? 18 : 62 + i * 8,
      tick: 0,
      speed: 0,
    });
  });
}

/** Detiene la simulación de un usuario cuando envía su ubicación real. */
export function markManualLocation(userId) {
  manualUsers.add(userId);
}

function step(s) {
  s.tick += 1;
  if (s.dwell > 0) {
    s.dwell -= 1;
    s.speed = 0;
    return { ...s.pos };
  }
  const target = s.route[s.target];
  const dLat = target.lat - s.pos.lat;
  const dLng = target.lng - s.pos.lng;
  const dist = Math.hypot(dLat, dLng);
  const stepSize = 0.00022;
  if (dist <= stepSize) {
    s.pos = { ...target };
    s.target = (s.target + 1) % s.route.length;
    s.dwell = 3 + Math.floor(rnd() * 5);
    s.speed = 0;
  } else {
    s.pos = { lat: s.pos.lat + (dLat / dist) * stepSize, lng: s.pos.lng + (dLng / dist) * stepSize };
    s.speed = s.key === 'dani' && s.tick % 9 === 0 ? 68 : 24 + Math.round(rnd() * 20);
  }
  return { ...s.pos };
}

let timer = null;

export function startDemoSimulation(broadcast = () => {}, intervalMs = 2600) {
  ensureDemo();
  setupSim();
  if (timer) return;
  timer = setInterval(() => {
    try {
      for (const [userId, s] of sim.entries()) {
        if (manualUsers.has(userId)) continue;
        const user = state.users[userId];
        if (!user || !user.settings.shareLocation) continue;
        const pos = step(s);
        s.battery = Math.max(4, s.battery - (s.tick % 40 === 0 ? 0.4 : 0));
        processLocation({
          user,
          sample: {
            ...pos, accuracy: 14 + Math.round(rnd() * 20),
            speed: s.speed, battery: Math.round(s.battery),
            heading: 0, source: 'demo-sim', screenActive: false,
          },
          broadcast,
          allowCrashDetection: false,
          // Guarda 1 de cada 8 muestras: suficiente historial sin inflar el JSON.
          persistSample: s.tick % 8 === 0,
        });
      }
    } catch (err) {
      console.error('[demo-sim]', err.message);
    }
  }, intervalMs);
  timer.unref?.();
}

export function stopDemoSimulation() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Acciones manuales para probar seguridad sin esperar a un evento real. */
export function simulateCrash(userId, broadcast) {
  const user = state.users[userId];
  if (!user) return null;
  const pos = state.live[userId] || HOME;
  const circleId = state.meta.demoCircleId;
  const circle = state.circles[circleId];
  const record = createSosRecord({ user, circle, kind: 'crash', sample: { ...pos, accuracy: 15 }, note: 'Colisión simulada desde el panel de demostración' });
  const event = addEvent({
    type: 'crash', circleId, userId, userName: user.name,
    title: `⚠️ Posible colisión de ${user.name} (simulada)`,
    body: 'Pulsa «Estoy bien» para cancelar o confirma para avisar al círculo.',
    severity: 'critical', sosId: record.id,
  });
  broadcast(circleId, { type: 'event', event, sos: record });
  return record;
}

export function demoState() {
  return { enabled: Boolean(state.meta.demoSeeded), simulated: [...manualUsers] };
}

export function saveState() { save(); }
