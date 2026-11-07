/**
 * Mapa basado en Leaflet (incluido localmente en /vendor).
 *
 * La capa por defecto es un "atlas" procedural dibujado en canvas: no necesita
 *Internet, CDNs ni claves de API. Opcionalmente se puede activar la capa de
 * OpenStreetMap si el navegador tiene acceso a ella.
 */
import { icon } from './icons.js';

const TILE = 256;

function hash(x, y, z = 0) {
  let h = Math.imul(x + 1013, 374761393) ^ Math.imul(y + 2099, 668265263) ^ Math.imul(z + 17, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawTile(canvas, coords) {
  const ctx = canvas.getContext('2d');
  const cell = 32;
  const gx = coords.x * (TILE / cell);
  const gy = coords.y * (TILE / cell);
  ctx.fillStyle = '#e8edf0';
  ctx.fillRect(0, 0, TILE, TILE);

  // Manzanas: tono, parques y agua deterministas por coordenada global.
  for (let j = -1; j <= TILE / cell; j++) {
    for (let i = -1; i <= TILE / cell; i++) {
      const bx = gx + i;
      const by = gy + j;
      const r = hash(bx, by, coords.z);
      const x = i * cell;
      const y = j * cell;
      let fill = '#f4f6f7';
      if (r > 0.93) fill = '#d7e7d5';       // parque
      else if (r > 0.90) fill = '#cfe0ea';  // agua
      else if (r > 0.72) fill = '#eaeef1';
      ctx.fillStyle = fill;
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      if (r > 0.35 && r <= 0.9) {
        ctx.fillStyle = r > 0.6 ? '#e2e7ea' : '#e0e5e8';
        const w = 8 + Math.round(hash(bx + 91, by + 7) * 12);
        const h = 8 + Math.round(hash(bx + 13, by + 57) * 10);
        ctx.fillRect(x + 5, y + 5, w, h);
        ctx.fillRect(x + 17, y + 17, 9, 7);
      }
    }
  }

  // Calles menores.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= TILE; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, TILE); }
  for (let y = 0; y <= TILE; y += cell) { ctx.moveTo(0, y); ctx.lineTo(TILE, y); }
  ctx.stroke();

  // Avenidas principales cada 4 manzanas, alineadas entre teselas.
  const major = cell * 4;
  const offX = ((coords.x * TILE) % major + major) % major;
  const offY = ((coords.y * TILE) % major + major) % major;
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  for (let x = -offX; x <= TILE; x += major) { ctx.moveTo(x, 0); ctx.lineTo(x, TILE); }
  for (let y = -offY; y <= TILE; y += major) { ctx.moveTo(0, y); ctx.lineTo(TILE, y); }
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#d9e0e4';
  ctx.beginPath();
  for (let x = -offX; x <= TILE; x += major) { ctx.moveTo(x - 4.5, 0); ctx.lineTo(x - 4.5, TILE); ctx.moveTo(x + 4.5, 0); ctx.lineTo(x + 4.5, TILE); }
  for (let y = -offY; y <= TILE; y += major) { ctx.moveTo(0, y - 4.5); ctx.lineTo(TILE, y - 4.5); ctx.moveTo(0, y + 4.5); ctx.lineTo(TILE, y + 4.5); }
  ctx.stroke();

  // Etiquetas de barrio ficticias muy sutiles, una por tesela aprox.
  if (hash(coords.x, coords.y, coords.z + 5) > 0.72) {
    const names = ['Centro', 'Norte', 'La Vega', 'San Martín', 'Las Flores', 'Ribera', 'Alameda', 'Puente'];
    const label = names[Math.floor(hash(coords.x + 3, coords.y + 9) * names.length)];
    ctx.fillStyle = 'rgba(90,104,120,.45)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(label, 18, 40);
  }
}

const AtlasLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    tile.width = TILE;
    tile.height = TILE;
    drawTile(tile, coords);
    // Diferimos un frame para no bloquear el render con muchas teselas.
    setTimeout(() => done(null, tile), 0);
    return tile;
  },
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function createMap(container, { onPick = null, center = [40.4203, -3.7065], zoom = 14 } = {}) {
  const map = L.map(container, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView(center, zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const atlas = new AtlasLayer({ tileSize: TILE, attribution: 'Atlas Trobemmos · sin servicios externos', maxZoom: 19, minZoom: 3 });
  atlas.addTo(map);
  let osm = null;
  const markers = new L.LayerGroup().addTo(map);
  const placesLayer = new L.LayerGroup().addTo(map);
  const trailLayer = new L.LayerGroup().addTo(map);
  let pickMarker = null;
  let replayMarker = null;
  let picking = false;
  let memberRefs = new Map();
  let lastMembers = [];

  function setBasemap(mode) {
    if (mode === 'osm') {
      if (!osm) osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      });
      if (!map.hasLayer(osm)) { map.removeLayer(atlas); osm.addTo(map); }
    } else {
      if (osm && map.hasLayer(osm)) map.removeLayer(osm);
      if (!map.hasLayer(atlas)) atlas.addTo(map);
    }
  }

  function markerHtml(m) {
    const color = m.color || '#5b6ef5';
    const battery = m.location?.battery;
    const bat = battery == null ? '' : `<span class="mm-bat ${battery <= 20 ? 'low' : ''}">${Math.round(battery)}%</span>`;
    const moving = (m.location?.speed || 0) > 8;
    return `<div class="map-marker ${moving ? 'is-moving' : ''}" style="--mc:${esc(color)}">
      <div class="mm-bubble"><span>${esc(m.emoji || '🙂')}</span></div>
      ${bat}
      <div class="mm-label">${esc(m.name || 'Miembro')}</div>
    </div>`;
  }

  function setMembers(members = []) {
    lastMembers = members;
    markers.clearLayers();
    memberRefs = new Map();
    for (const m of members) {
      if (!m.location) continue;
      const isMe = m.id === window.__trobemmosMeId;
      const marker = L.marker([m.location.lat, m.location.lng], {
        icon: L.divIcon({
          className: 'map-marker-wrap',
          html: markerHtml(m),
          iconSize: [46, 46],
          iconAnchor: [23, 23],
        }),
        zIndexOffset: isMe ? 1000 : 0,
        keyboard: false,
      }).addTo(markers);
      const lines = [
        `<strong>${esc(m.name)}</strong>`,
        m.location.place ? `En ${esc(m.location.place)}` : `${m.location.lat.toFixed(5)}, ${m.location.lng.toFixed(5)}`,
        m.location.battery != null ? `Batería ${Math.round(m.location.battery)}%` : '',
        m.location.speed > 1 ? `${Math.round(m.location.speed)} km/h` : '',
        `Actualizado hace ${Math.max(0, Math.round((Date.now() - m.location.ts) / 60000))} min`,
      ].filter(Boolean);
      marker.bindPopup(`<div class="map-popup">${lines.join('<br>')}</div>`);
      memberRefs.set(m.id, marker);
    }
  }

  function setPlaces(places = []) {
    placesLayer.clearLayers();
    for (const p of places) {
      const color = p.color || '#5b6ef5';
      L.circle([p.lat, p.lng], {
        radius: p.radius || 200, color, weight: 2, dashArray: '6 5',
        fillColor: color, fillOpacity: 0.09,
      }).addTo(placesLayer);
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: 'place-marker-wrap',
          html: `<div class="place-marker" style="--pc:${esc(color)}"><span>${esc(p.icon || '📍')}</span><b>${esc(p.name)}</b></div>`,
          iconSize: [0, 0], iconAnchor: [0, 0],
        }),
      }).addTo(placesLayer).bindPopup(`<div class="map-popup"><strong>${esc(p.icon || '📍')} ${esc(p.name)}</strong><br>Radio ${p.radius || 200} m<br>${p.alertsOn === false ? 'Alertas desactivadas' : 'Alertas activas'}</div>`);
    }
  }

  function setTrail(points = [], color = '#5b6ef5', { markers: showEnds = true } = {}) {
    trailLayer.clearLayers();
    replayMarker = null;
    if (points.length < 1) return;
    const latlngs = points.map((p) => [p[0], p[1]]);
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color, weight: 4, opacity: 0.85, lineCap: 'round' }).addTo(trailLayer);
    }
    if (showEnds) {
      L.circleMarker(latlngs[0], { radius: 6, color: '#12a594', fillColor: '#12a594', fillOpacity: 1 }).addTo(trailLayer).bindTooltip('Inicio');
      L.circleMarker(latlngs.at(-1), { radius: 6, color, fillColor: color, fillOpacity: 1 }).addTo(trailLayer).bindTooltip('Fin');
    }
  }

  function setTrails(trails = []) {
    trailLayer.clearLayers();
    replayMarker = null;
    for (const t of trails) {
      const pts = (t.points || []).map((p) => [p[0], p[1]]);
      if (pts.length < 1) continue;
      const color = t.color || '#5b6ef5';
      if (pts.length > 1) L.polyline(pts, { color, weight: 4, opacity: 0.8, lineCap: 'round' }).addTo(trailLayer);
      L.circleMarker(pts[0], { radius: 5, color: '#12a594', fillColor: '#12a594', fillOpacity: 1 }).addTo(trailLayer);
      L.circleMarker(pts.at(-1), { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(trailLayer);
    }
  }

  function setReplayPoint(lat, lng, emoji = '🧭') {
    if (replayMarker) { trailLayer.removeLayer(replayMarker); replayMarker = null; }
    replayMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'replay-dot', html: `<div class="replay-marker">${esc(emoji)}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
    }).addTo(trailLayer);
  }

  function fitAll(members = lastMembers, places = []) {
    const pts = [];
    for (const m of members) if (m?.location) pts.push([m.location.lat, m.location.lng]);
    for (const p of places) pts.push([p.lat, p.lng]);
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts);
    map.fitBounds(bounds.pad(0.35), { maxZoom: 15, animate: true });
  }

  function focus(lat, lng, z = 16) { map.flyTo([lat, lng], z, { duration: 0.6 }); }

  function setPickMode(on) {
    picking = Boolean(on);
    container.classList.toggle('is-picking', picking);
    if (!picking && pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
  }

  map.on('click', (e) => {
    if (!picking || !onPick) return;
    if (pickMarker) map.removeLayer(pickMarker);
    pickMarker = L.marker(e.latlng, {
      icon: L.divIcon({ className: 'pick-marker-wrap', html: `<div class="pick-marker">${icon('pin', 20)}</div>`, iconSize: [34, 34], iconAnchor: [17, 30] }),
    }).addTo(map);
    onPick(e.latlng.lat, e.latlng.lng);
  });

  setTimeout(() => map.invalidateSize(), 80);

  return {
    map, setMembers, setPlaces, setTrail, setTrails, setReplayPoint, fitAll, focus,
    setBasemap, setPickMode, invalidate: () => map.invalidateSize(),
    destroy: () => map.remove(),
  };
}
