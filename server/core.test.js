import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceMeters, derivedSpeedKmh, geofenceTransitions, analyzeDrivingSample,
  drivingScore, detectCrash, buildDayTimeline, summarizeDriving, pruneOld,
  bearingDegrees, HISTORY_DAYS,
} from './core.js';

const place = { id: 'p1', name: 'Casa', icon: '🏠', lat: 40.4203, lng: -3.7065, radius: 200, alertsOn: true };

test('distanceMeters: un grado de latitud son ~111 km', () => {
  const d = distanceMeters({ lat: 40, lng: 0 }, { lat: 41, lng: 0 });
  assert.ok(d > 110_500 && d < 111_700, `distancia inesperada: ${d}`);
  assert.equal(distanceMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

test('bearingDegrees: norte y este', () => {
  assert.ok(Math.abs(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })) < 0.001);
  assert.ok(Math.abs(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 90) < 0.001);
});

test('derivedSpeedKmh respeta el tiempo y filtra ruido de GPS', () => {
  const a = { lat: 40.42, lng: -3.7, ts: 0 };
  const b = { lat: 40.421, lng: -3.7, ts: 10000 };
  const speed = derivedSpeedKmh(a, b);
  assert.ok(speed > 30 && speed < 50, `velocidad inesperada: ${speed}`);
  assert.equal(derivedSpeedKmh(a, { ...a, lat: a.lat + 0.000001, ts: 10000 }), 0);
});

test('geocercas: primera muestra, entrada, permanencia y salida', () => {
  const outside = { lat: 40.44, lng: -3.69, ts: 1 };
  const inside = { lat: 40.4203, lng: -3.7065, ts: 2 };
  let states = {};
  let r = geofenceTransitions({ userId: 'u1', circleId: 'c1', sample: outside, places: [place], previousStates: states });
  assert.equal(r.events.length, 0, 'la primera muestra fuera no debe generar salida falsa');
  states = r.states;
  r = geofenceTransitions({ userId: 'u1', circleId: 'c1', sample: inside, places: [place], previousStates: states });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'place_entry');
  states = r.states;
  r = geofenceTransitions({ userId: 'u1', circleId: 'c1', sample: { ...inside, ts: 3 }, places: [place], previousStates: states });
  assert.equal(r.events.length, 0, 'permanecer dentro no repite alertas');
  states = r.states;
  r = geofenceTransitions({ userId: 'u1', circleId: 'c1', sample: { ...outside, ts: 4 }, places: [place], previousStates: states });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'place_exit');
});

test('geocercas desactivadas no generan alertas pero conservan el estado', () => {
  const muted = { ...place, alertsOn: false };
  const r = geofenceTransitions({ userId: 'u', circleId: 'c', sample: { lat: place.lat, lng: place.lng, ts: 1 }, places: [muted], previousStates: { p1: false } });
  assert.equal(r.events.length, 0);
  assert.equal(r.states.p1, true);
});

test('análisis de conducción: exceso, frenada y uso del móvil', () => {
  const prev = { speed: 55, ts: 1000 };
  const curr = { speed: 20, ts: 2500, screenActive: true };
  const events = analyzeDrivingSample({ prev, curr, trip: { events: [] }, config: { speedLimitKmh: 50 } });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('hard_braking'));
  assert.ok(types.includes('phone_use'));
  const fast = analyzeDrivingSample({ prev: { speed: 60, ts: 0 }, curr: { speed: 75, ts: 3000 }, trip: { events: [] } });
  assert.ok(fast.some((e) => e.type === 'speeding'));
});

test('puntuación de conductor descuenta incidencias y nunca baja de 0', () => {
  assert.equal(drivingScore([]), 100);
  const s = drivingScore([{ type: 'speeding' }, { type: 'phone_use' }]);
  assert.equal(s, 85);
  assert.equal(drivingScore(Array(30).fill({ type: 'crash' })), 0);
});

test('detección de colisión: frenada brusca o impacto del acelerómetro', () => {
  const prev = { speed: 45, ts: 0 };
  const curr = { speed: 0, ts: 1500 };
  assert.equal(detectCrash({ prev, curr }), true);
  assert.equal(detectCrash({ prev: { speed: 20, ts: 0 }, curr: { speed: 15, ts: 1500 } }), false);
  assert.equal(detectCrash({ prev, curr, motion: { impactG: 3.1 } }), true);
});

test('cronología diaria agrupa estancias y trayectos', () => {
  const base = Date.parse('2026-11-01T08:00:00Z');
  const samples = [
    { lat: 40.42, lng: -3.7, speed: 0, ts: base },
    { lat: 40.42, lng: -3.7, speed: 0, ts: base + 30 * 60000 },
    { lat: 40.43, lng: -3.69, speed: 40, ts: base + 60 * 60000 },
    { lat: 40.44, lng: -3.68, speed: 42, ts: base + 90 * 60000 },
  ];
  const tl = buildDayTimeline(samples, [place]);
  assert.equal(tl.visits.length, 1);
  assert.equal(tl.movements.length, 1);
  assert.ok(tl.distanceKm > 0);
});

test('informe familiar agrega viajes y ordena por puntuación', () => {
  const trips = [
    { userId: 'a', distanceKm: 10, score: 90, events: [{ type: 'speeding' }] },
    { userId: 'a', distanceKm: 5, score: 80, events: [{ type: 'phone_use' }] },
    { userId: 'b', distanceKm: 3, score: 100, events: [] },
  ];
  const s = summarizeDriving(trips);
  assert.equal(s.totals.trips, 3);
  assert.equal(s.totals.events, 2);
  assert.equal(s.totals.km, 18);
  assert.equal(s.drivers[0].userId, 'b');
  assert.equal(s.drivers[1].score, 85);
});

test('retención por defecto de 90 días', () => {
  assert.equal(HISTORY_DAYS, 90);
  assert.equal(pruneOld(1000 * 86400 * 100, 90) > 0, true);
});
