/**
 * Trobemmos — lógica de dominio pura (sin efectos secundarios).
 *
 * Aquí viven los cálculos geoespaciales y de seguridad vial. Mantenerlos
 * aislados permite testearlos y sustituirlos por modelos más avanzados
 * sin tocar la capa HTTP.
 */

export const EARTH_RADIUS_M = 6371008.8;
export const HISTORY_DAYS = 90; // Más que los 30 días de los planes de pago de referencia.
export const DEFAULT_SPEED_LIMIT_KMH = 50;

const toRad = (d) => (d * Math.PI) / 180;

export function distanceMeters(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bearing aproximado en grados (0 = norte), útil para orientar marcadores. */
export function bearingDegrees(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Velocidad instantánea derivada de dos muestras, en km/h. */
export function derivedSpeedKmh(prev, curr) {
  if (!prev || !curr) return 0;
  const dt = (curr.ts - prev.ts) / 1000;
  if (dt <= 0 || dt > 120) return 0;
  const metres = distanceMeters(prev, curr);
  // Filtra el ruido de GPS: desplazamientos de pocos metros no son conducción.
  if (metres < 3) return 0;
  return clamp((metres / dt) * 3.6, 0, 260);
}

/** Aceleración en m/s² (negativa = frenada). */
export function derivedAcceleration(prev, curr) {
  if (!prev || !curr) return 0;
  const dt = (curr.ts - prev.ts) / 1000;
  if (dt <= 0 || dt > 30) return 0;
  const dv = ((curr.speed || 0) - (prev.speed || 0)) / 3.6;
  return clamp(dv / dt, -20, 20);
}

/**
 * Transiciones de geocerca. Devuelve los nuevos estados y los eventos
 * de entrada/salida. No limita el número de lugares ni de avisos.
 */
export function geofenceTransitions({ userId, circleId, sample, places, previousStates = {} }) {
  const states = { ...previousStates };
  const events = [];
  for (const place of places) {
    if (!place || place.alertsOn === false) {
      // Aunque las alertas estén apagadas seguimos registrando el estado
      // para que al reactivarlas no se dispare un falso "ha llegado".
      states[place.id] = distanceMeters(sample, place) <= (place.radius || 200);
      continue;
    }
    const key = place.id;
    const inside = distanceMeters(sample, place) <= (place.radius || 200);
    const wasInside = Boolean(states[key]);
    if (inside !== wasInside) {
      states[key] = inside;
      // Primera muestra: se notifica solo la entrada, nunca una salida falsa.
      if (!(previousStates[key] === undefined && !inside)) {
        events.push({
          type: inside ? 'place_entry' : 'place_exit',
          circleId,
          userId,
          placeId: place.id,
          placeName: place.name,
          placeIcon: place.icon || '📍',
          ts: sample.ts,
          title: inside ? `${place.icon || '📍'} Ha llegado a ${place.name}` : `↗️ Ha salido de ${place.name}`,
        });
      }
    }
  }
  return { states, events };
}

export const EVENT_WEIGHTS = {
  speeding: 5,
  hard_braking: 7,
  rapid_acceleration: 5,
  phone_use: 10,
  crash: 25,
};

/**
 * Analiza una muestra de conducción y devuelve los eventos de seguridad
 * detectados. `trip` puede estar vacío; `config` permite ajustar umbrales.
 *
 * Nota honesta: la detección desde navegador es orientativa. Un teléfono en
 * el bolsillo no sustituye a los sensores de un vehículo ni a un servicio
 * de emergencias real.
 */
export function analyzeDrivingSample({ prev, curr, trip = null, config = {} }) {
  const limit = config.speedLimitKmh ?? DEFAULT_SPEED_LIMIT_KMH;
  const events = [];
  if (!prev || !curr) return events;
  const speed = curr.speed || 0;
  const accel = derivedAcceleration(prev, curr);
  const lastOf = (type, withinMs) =>
    trip?.events?.some((e) => e.type === type && curr.ts - e.ts < withinMs);

  if (speed > limit + 5 && !lastOf('speeding', 45000)) {
    events.push({ type: 'speeding', ts: curr.ts, severity: speed > limit + 30 ? 'high' : 'medium', detail: `${Math.round(speed)} km/h (límite ${limit})` });
  }
  if (accel < -3.6 && (prev.speed || 0) > 18 && !lastOf('hard_braking', 12000)) {
    events.push({ type: 'hard_braking', ts: curr.ts, severity: accel < -6 ? 'high' : 'medium', detail: `Frenada de ${Math.abs(accel).toFixed(1)} m/s²` });
  }
  if (accel > 3.4 && !lastOf('rapid_acceleration', 12000)) {
    events.push({ type: 'rapid_acceleration', ts: curr.ts, severity: 'low', detail: `Aceleración de ${accel.toFixed(1)} m/s²` });
  }
  if (curr.screenActive && speed > 15 && !lastOf('phone_use', 60000)) {
    events.push({ type: 'phone_use', ts: curr.ts, severity: 'medium', detail: 'Pantalla en uso durante la marcha' });
  }
  return events;
}

export function drivingScore(events = []) {
  const penalty = events.reduce((sum, e) => sum + (EVENT_WEIGHTS[e.type] || 0), 0);
  return clamp(Math.round(100 - penalty), 0, 100);
}

/**
 * Heurística de impacto. Requiere una deceleración brusca desde velocidad
 * de circulación, o un pico de acelerómetro (DeviceMotion, en g).
 */
export function detectCrash({ prev, curr, motion = null }) {
  if (!prev || !curr) return false;
  const dt = (curr.ts - prev.ts) / 1000;
  if (dt <= 0 || dt > 5) return false;
  const prevSpeed = prev.speed || 0;
  const currSpeed = curr.speed || 0;
  const suddenStop = prevSpeed >= 30 && currSpeed <= 4 && (prevSpeed - currSpeed) / 3.6 / dt >= 7;
  const impact = motion && Number.isFinite(motion.impactG) && motion.impactG >= 2.4;
  return Boolean(suddenStop || impact);
}

/** Puntúa una lista de viajes para el informe semanal del círculo. */
export function summarizeDriving(trips = []) {
  const byUser = new Map();
  let totalEvents = 0;
  const counts = { speeding: 0, hard_braking: 0, rapid_acceleration: 0, phone_use: 0, crash: 0 };
  for (const trip of trips) {
    const entry = byUser.get(trip.userId) || { userId: trip.userId, trips: 0, km: 0, scoreSum: 0, events: 0, eventCounts: { ...counts } };
    entry.trips += 1;
    entry.km += trip.distanceKm || 0;
    entry.scoreSum += trip.score ?? 100;
    for (const ev of trip.events || []) {
      entry.events += 1;
      totalEvents += 1;
      if (counts[ev.type] !== undefined) {
        counts[ev.type] += 1;
        entry.eventCounts[ev.type] += 1;
      }
    }
    byUser.set(trip.userId, entry);
  }
  const drivers = [...byUser.values()]
    .map((e) => ({ ...e, km: Math.round(e.km * 10) / 10, score: Math.round(e.scoreSum / Math.max(1, e.trips)) }))
    .sort((a, b) => b.score - a.score || a.events - b.events);
  return {
    drivers,
    totals: { trips: trips.length, km: Math.round(trips.reduce((s, t) => s + (t.distanceKm || 0), 0) * 10) / 10, events: totalEvents, counts },
  };
}

/** Agrupa muestras en visitas (estancias) y desplazamientos para la cronología diaria. */
export function buildDayTimeline(samples = [], places = [], stationarySpeedKmh = 6) {
  const clean = [...samples].sort((a, b) => a.ts - b.ts);
  if (!clean.length) return { visits: [], movements: [], distanceKm: 0 };
  const visits = [];
  const movements = [];
  let current = null;
  let distance = 0;
  for (let i = 0; i < clean.length; i++) {
    const s = clean[i];
    const next = clean[i + 1];
    if (next) distance += distanceMeters(s, next);
    const moving = (s.speed || 0) > stationarySpeedKmh;
    const kind = moving ? 'trip' : 'stop';
    if (!current || current.kind !== kind) {
      if (current) (current.kind === 'stop' ? visits : movements).push(finishSegment(current, places));
      current = { kind, start: s.ts, end: s.ts, points: [s], maxSpeed: s.speed || 0 };
    } else {
      current.end = s.ts;
      current.points.push(s);
      current.maxSpeed = Math.max(current.maxSpeed, s.speed || 0);
    }
  }
  if (current) (current.kind === 'stop' ? visits : movements).push(finishSegment(current, places));
  return {
    visits: visits.filter((v) => v.durationMin >= 2),
    movements: movements.filter((m) => m.durationMin >= 1),
    distanceKm: Math.round((distance / 1000) * 10) / 10,
  };
}

function finishSegment(segment, places) {
  const centre = segment.points[Math.floor(segment.points.length / 2)] || segment.points[0];
  const nearest = places
    .map((p) => ({ place: p, d: distanceMeters(centre, p) }))
    .filter((x) => x.d <= (x.place.radius || 200) * 1.5)
    .sort((a, b) => a.d - b.d)[0];
  return {
    kind: segment.kind,
    start: segment.start,
    end: segment.end,
    durationMin: Math.max(1, Math.round((segment.end - segment.start) / 60000)),
    label: nearest ? `${nearest.place.icon || '📍'} ${nearest.place.name}` : segment.kind === 'stop' ? 'Parada' : 'Trayecto',
    maxSpeed: Math.round(segment.maxSpeed),
    points: segment.points.map((p) => [p.lat, p.lng]),
    centre: { lat: centre.lat, lng: centre.lng },
  };
}

/** Recorta el historial y los eventos antiguos. Política: 90 días, sin coste. */
export function pruneOld(now = Date.now(), days = HISTORY_DAYS) {
  return now - days * 24 * 60 * 60 * 1000;
}

export function formatDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}
