/**
 * Procesamiento de cada muestra de ubicación: geocercas, batería, conducción,
 * detección de impacto y difusión en tiempo real. Compartido por la API HTTP
 * y por el simulador de demostración.
 */
import { state, addEvent, appendLocation, nearestPlace, uid, save, userCircles } from './store.js';
import {
  derivedSpeedKmh, geofenceTransitions, analyzeDrivingSample, detectCrash,
  drivingScore, distanceMeters, clamp,
} from './core.js';

const MIN_DRIVING_KMH = 8;
const TRIP_GAP_MS = 4 * 60 * 1000;

function circleIdsFor(userId) {
  return userCircles(userId).map((c) => c.id);
}

function ensureTrip(userId, sample, circleIds) {
  const trip = {
    id: uid('trp'),
    userId,
    circleIds,
    startAt: sample.ts,
    endAt: sample.ts,
    distanceKm: 0,
    maxSpeed: sample.speed || 0,
    avgSpeedSum: sample.speed || 0,
    samples: 1,
    score: 100,
    events: [],
    points: [[sample.lat, sample.lng]],
    demo: Boolean(state.users[userId]?.isDemo),
  };
  state.trips[trip.id] = trip;
  return trip;
}

function finishTrip(tripState, broadcast, userId) {
  const trip = tripState.tripId ? state.trips[tripState.tripId] : null;
  tripState.tripId = null;
  if (!trip) return null;
  trip.endAt = Date.now();
  trip.avgSpeed = Math.round(trip.avgSpeedSum / Math.max(1, trip.samples));
  trip.score = drivingScore(trip.events);
  trip.points = trip.points.slice(0, 600);
  for (const circleId of trip.circleIds || []) {
    broadcast(circleId, { type: 'trip', action: 'updated', tripId: trip.id });
  }
  save();
  return trip;
}

export function closeStaleTrips(broadcast = () => {}) {
  const now = Date.now();
  for (const [userId, ts] of Object.entries(state.tripState)) {
    if (ts.tripId && now - (ts.lastMoveTs || 0) > TRIP_GAP_MS) {
      finishTrip(ts, broadcast, userId);
      save();
    }
  }
}

export function createSosRecord({ user, circle, kind = 'sos', sample = null, note = '', status = null }) {
  const record = {
    id: uid(kind === 'crash' ? 'crh' : 'sos'),
    kind,
    userId: user.id,
    userName: user.name,
    userEmoji: user.emoji,
    circleId: circle.id,
    ts: Date.now(),
    status: status || (kind === 'crash' ? 'pending' : 'active'),
    note,
    location: sample ? { lat: sample.lat, lng: sample.lng, accuracy: sample.accuracy } : null,
    emergencyContacts: user.emergencyContacts || [],
    acknowledgements: [],
    confirmUntil: kind === 'crash' ? Date.now() + 20000 : null,
  };
  circle.sos.push(record);
  if (circle.sos.length > 60) circle.sos.shift();
  save();
  return record;
}

/**
 * @param {object} args
 * @param {object} args.user           Usuario dueño de la muestra
 * @param {object} args.sample         {lat,lng,accuracy,speed,battery,heading,screenActive,motion,source}
 * @param {(circleId:string, payload:object)=>void} args.broadcast
 * @param {boolean} args.allowCrashDetection
 * @param {boolean} args.persistSample  Si es false solo se actualiza la posición
 *   en vivo (útil para el simulador, que emite muestras muy frecuentes).
 */
export function processLocation({ user, sample, broadcast = () => {}, allowCrashDetection = true, persistSample = true }) {
  const now = Date.now();
  const clean = {
    lat: clamp(Number(sample.lat), -90, 90),
    lng: clamp(Number(sample.lng), -180, 180),
    accuracy: clamp(Number(sample.accuracy) || 20, 1, 5000),
    speed: clamp(Number(sample.speed) || 0, 0, 260),
    battery: sample.battery == null ? null : clamp(Math.round(Number(sample.battery)), 0, 100),
    heading: Number(sample.heading) || 0,
    ts: now,
    source: sample.source || 'gps',
  };
  if (!Number.isFinite(clean.lat) || !Number.isFinite(clean.lng)) throw new Error('Coordenadas no válidas');

  const userId = user.id;
  const ts = (state.tripState[userId] ||= { tripId: null, lastSample: null, lastMoveTs: 0, batteryLow: false });
  const prev = ts.lastSample;
  if (!clean.speed && prev) clean.speed = derivedSpeedKmh(prev, clean);

  const circleIds = circleIdsFor(userId);
  const result = { sample: clean, alerts: [], drivingEvents: [], crash: null, tripId: null, place: null };

  if (persistSample) appendLocation(userId, clean);
  else state.live[userId] = clean;

  // 1. Lugares ilimitados con alertas ilimitadas de entrada/salida.
  for (const circleId of circleIds) {
    const circle = state.circles[circleId];
    if (!circle) continue;
    const places = Object.values(circle.places);
    const previousStates = {};
    for (const p of places) {
      const key = `${circleId}:${userId}:${p.id}`;
      if (state.geoStates[key] !== undefined) previousStates[p.id] = state.geoStates[key];
    }
    const { states, events } = geofenceTransitions({ userId, circleId, sample: clean, places, previousStates });
    for (const [placeId, inside] of Object.entries(states)) {
      state.geoStates[`${circleId}:${userId}:${placeId}`] = inside;
    }
    for (const e of events) {
      const event = addEvent({
        ...e,
        userName: user.name,
        title: `${user.name} ${e.type === 'place_entry' ? 'ha llegado a' : 'ha salido de'} ${e.placeName}`,
        body: `${e.placeIcon} ${e.placeName} · ${new Date(clean.ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`,
        severity: 'info',
        location: { lat: clean.lat, lng: clean.lng },
      });
      result.alerts.push(event);
      broadcast(circleId, { type: 'event', event });
    }
    const near = nearestPlace(circleId, clean);
    if (near) result.place = near.place.name;
  }

  // 2. Batería baja (un aviso por ciclo de descarga, no spam).
  if (clean.battery != null && user.settings?.lowBatteryAlerts !== false) {
    const low = clean.battery <= 20;
    if (low && !ts.batteryLow) {
      for (const circleId of circleIds) {
        const event = addEvent({
          type: 'low_battery', circleId, userId, userName: user.name,
          title: `🔋 ${user.name} tiene la batería al ${clean.battery}%`,
          body: 'Puede dejar de compartir su ubicación pronto.',
          severity: 'warning', ts: clean.ts,
        });
        result.alerts.push(event);
        broadcast(circleId, { type: 'event', event });
      }
    }
    ts.batteryLow = low;
  }

  // 3. Detección de impacto (heurística + acelerómetro si el dispositivo lo da).
  if (allowCrashDetection && user.settings?.crashDetection !== false && detectCrash({ prev, curr: clean, motion: sample.motion })) {
    for (const circleId of circleIds) {
      const circle = state.circles[circleId];
      if (!circle) continue;
      const record = createSosRecord({ user, circle, kind: 'crash', sample: clean, note: 'Posible colisión detectada' });
      const event = addEvent({
        type: 'crash', circleId, userId, userName: user.name,
        title: `⚠️ Posible colisión de ${user.name}`,
        body: 'Se ha detectado una deceleración brusca. Cancelar si está bien.',
        severity: 'critical', ts: clean.ts, sosId: record.id,
      });
      result.crash = record;
      result.alerts.push(event);
      broadcast(circleId, { type: 'event', event, sos: record });
    }
  }

  // 4. Conducción: agrupación en viajes, eventos y puntuación.
  const limit = user.settings?.speedLimitKmh || 50;
  let trip = ts.tripId ? state.trips[ts.tripId] : null;
  const moving = clean.speed >= MIN_DRIVING_KMH;
  if (moving) {
    if (!trip || clean.ts - (ts.lastMoveTs || 0) > TRIP_GAP_MS) {
      if (trip) finishTrip(ts, broadcast, userId);
      trip = ensureTrip(userId, clean, circleIds);
      ts.tripId = trip.id;
    }
    const detected = analyzeDrivingSample({ prev, curr: clean, trip, config: { speedLimitKmh: limit } });
    for (const ev of detected) {
      trip.events.push({ ...ev, lat: clean.lat, lng: clean.lng });
      result.drivingEvents.push(ev);
    }
    if (prev) trip.distanceKm += distanceMeters(prev, clean) / 1000;
    trip.distanceKm = Math.round(trip.distanceKm * 1000) / 1000;
    trip.maxSpeed = Math.round(Math.max(trip.maxSpeed, clean.speed));
    trip.avgSpeedSum += clean.speed;
    trip.samples += 1;
    trip.endAt = clean.ts;
    trip.points.push([clean.lat, clean.lng]);
    trip.score = drivingScore(trip.events);
    ts.lastMoveTs = clean.ts;
    result.tripId = trip.id;
    for (const circleId of circleIds) {
      broadcast(circleId, { type: 'trip', action: 'live', tripId: trip.id, userId, speed: Math.round(clean.speed) });
    }
  }

  // 5. Difusión de la posición en tiempo real.
  for (const circleId of circleIds) {
    broadcast(circleId, {
      type: 'location',
      userId,
      location: { ...clean, place: result.place },
      userName: user.name,
    });
  }

  ts.lastSample = clean;
  save();

  // 6. Cierre de viajes inactivos (sin muestras nuevas).
  if (trip && !moving && clean.ts - (ts.lastMoveTs || 0) > TRIP_GAP_MS) finishTrip(ts, broadcast, userId);
  return result;
}
