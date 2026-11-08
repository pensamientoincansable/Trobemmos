// Vistas de la aplicación. Cada vista pinta HTML y monta sus propios eventos.
import {
  S, api, esc, icon, toast, openModal, closeModal, confirmModal, navigate,
  timeHM, timeAgo, dateShort, dateLong, durationText, round1, copyText,
  avatarHtml, eventIcon, EMOJIS, PLACE_EMOJIS, apiUrl,
} from './ctx.js';
import { createMap } from './map.js';

export const NAV_ITEMS = [
  { id: 'mapa', label: 'Mapa', icon: 'map' },
  { id: 'historial', label: 'Historial', icon: 'history' },
  { id: 'lugares', label: 'Lugares', icon: 'pin' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'conduccion', label: 'Conducción', icon: 'car' },
  { id: 'seguridad', label: 'Seguridad', icon: 'shield' },
  { id: 'plan', label: 'Todo incluido', icon: 'star' },
  { id: 'ajustes', label: 'Ajustes', icon: 'settings' },
];

const pageHead = (title, subtitle, actions = '') => `
  <div class="page-head">
    <div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
    <div class="chips">${actions}</div>
  </div>`;

const emptyCard = (iconName, title, text) => `<div class="empty"><div class="empty-icon">${icon(iconName, 24)}</div><b>${esc(title)}</b><p>${esc(text)}</p></div>`;

const skeleton = (text = 'Cargando…') => `<div class="empty"><div class="empty-icon">${icon('refresh', 22)}</div><p>${esc(text)}</p></div>`;
let seguridadTimer = null;

function myMembership() {
  return S.circle?.members?.find((m) => m.id === S.user?.id) || null;
}

function batteryMini(level) {
  if (level == null) return '';
  const low = level <= 20;
  return `<span class="battery-mini ${low ? 'low' : ''}"><span class="bar"><i style="width:${Math.max(4, Math.min(100, level))}%"></i></span>${Math.round(level)}%</span>`;
}

/* ================================================================== */
/* MAPA                                                               */
/* ================================================================== */

export function memberCardsHtml() {
  const members = S.circle?.members || [];
  return members.map((m) => {
    const loc = m.location;
    const isMe = m.id === S.user?.id;
    const status = m.paused || !loc
      ? '<span class="pill">Ubicación en pausa</span>'
      : `<span class="pill ${loc.speed > 8 ? 'pill-indigo' : 'pill-green'}">${loc.speed > 8 ? `En movimiento · ${Math.round(loc.speed)} km/h` : loc.place ? `En ${esc(loc.place)}` : 'Ubicación activa'}</span>`;
    return `<div class="member-card" data-member="${esc(m.id)}">
      <div class="mc-top">${avatarHtml(m, 'avatar-lg')}
        <div style="min-width:0;flex:1">
          <div class="mc-name">${esc(m.name)}${isMe ? ' <span class="muted tiny">(tú)</span>' : ''}</div>
          <div class="mc-sub">${loc ? `Actualizado ${timeAgo(loc.ts)}` : 'Sin ubicación compartida'}</div>
        </div>
        ${loc ? batteryMini(loc.battery) : ''}
      </div>
      <div class="mc-meta">${status}${loc ? `<span class="pill">±${Math.round(loc.accuracy || 0)} m</span>` : ''}</div>
      ${loc ? '' : `<div class="mc-empty">Esta persona tiene el uso compartido en pausa.</div>`}
    </div>`;
  }).join('') || emptyCard('users', 'Aún no hay miembros', 'Invita a tu gente con el código del círculo.');
}

function quickAlertsHtml() {
  const events = (S.circle?.alerts || []).slice(0, 4);
  return events.map((e) => `<div class="mini-event"><span>${eventIcon(e.type)}</span><span>${esc(e.title)}</span><time>${timeAgo(e.ts)}</time></div>`).join('')
    || `<div class="tiny muted">Sin alertas recientes.</div>`;
}

function renderMapa() {
  const c = S.circle || { name: 'Círculo', members: [], places: [] };
  const sharing = Boolean(myMembership()?.sharing);
  return `<div class="map-layout">
    <div class="map-stage">
      <div id="main-map" class="map-canvas"></div>
      <div class="map-overlay-top">
        <div class="map-glass" id="share-status">${sharing ? '<span class="pill pill-green">●</span> Compartiendo ubicación' : '<span class="pill">○</span> Ubicación en pausa'}</div>
        <button class="map-glass" data-map-act="toggle-share">${icon('location', 15)} ${sharing ? 'Pausar' : 'Compartir mi ubicación'}</button>
        <button class="map-glass" data-map-act="invite">${icon('share', 15)} Invitar</button>
      </div>
      <div class="map-overlay-bottom">
        <div class="map-actions">
          <button class="btn btn-sm btn-outline" data-map-act="center">${icon('target', 15)} Centrar</button>
          <button class="btn btn-sm btn-outline" data-map-act="pin-me">${icon('pin', 15)} Fijar mi posición</button>
          <button class="btn btn-sm btn-outline" data-map-act="basemap">${icon('globe', 15)} ${S.basemap === 'osm' ? 'Atlas local' : 'Mapa OSM'}</button>
        </div>
        <div class="map-glass map-legend">
          <span><i style="background:var(--primary)"></i> Miembros</span>
          <span><i style="background:var(--teal)"></i> Lugares</span>
          <span>${icon('lock', 12)} Solo tu círculo</span>
        </div>
      </div>
    </div>
    <div class="map-side">
      <div class="map-side-head">
        <div class="row"><h3>${esc(c.name)}</h3><span class="pill pill-indigo">${c.members?.length || 0} miembros</span></div>
        <p class="tiny muted" style="margin:5px 0 0">Toca una persona para ver sus detalles y centrar el mapa.</p>
      </div>
      <div class="map-side-scroll" id="member-cards">${memberCardsHtml()}</div>
      <div class="quick-alerts"><h4>Actividad reciente</h4><div id="quick-alerts">${quickAlertsHtml()}</div></div>
    </div>
  </div>`;
}

function memberModal(m) {
  const loc = m.location;
  openModal(`<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">${avatarHtml(m, 'avatar-lg')}<div><h3 style="margin:0">${esc(m.name)}</h3><p style="margin:3px 0 0">${m.paused ? 'Ubicación en pausa' : 'Compartiendo ubicación'}</p></div></div>
    ${loc ? `<div class="grid-2">
      <div class="card card-pad"><div class="stat-label tiny muted">Última actualización</div><b>${timeAgo(loc.ts)} · ${timeHM(loc.ts)}</b></div>
      <div class="card card-pad"><div class="stat-label tiny muted">Batería</div><b>${loc.battery != null ? Math.round(loc.battery) + '%' : 'No disponible'}</b></div>
      <div class="card card-pad"><div class="stat-label tiny muted">Velocidad</div><b>${Math.round(loc.speed || 0)} km/h</b></div>
      <div class="card card-pad"><div class="stat-label tiny muted">Precisión</div><b>±${Math.round(loc.accuracy || 0)} m</b></div>
    </div><p class="small muted" style="margin-top:12px">Coordenadas: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.place ? ` · En ${esc(loc.place)}` : ''}</p>` : '<div class="notice">Esta persona no está compartiendo su ubicación ahora mismo. El uso compartido siempre es voluntario.</div>'}
    <div class="modal-footer">
      <button class="btn btn-outline" data-close-modal>Cerrar</button>
      <button class="btn btn-primary" id="member-history">${icon('history', 16)} Ver historial</button>
      ${loc ? `<button class="btn btn-teal" id="member-center">${icon('target', 16)} Centrar</button>` : ''}
    </div>`, (modal) => {
    modal.querySelector('#member-center')?.addEventListener('click', () => {
      closeModal();
      navigate('mapa');
      setTimeout(() => S.mapCtl?.focus(loc.lat, loc.lng, 16), 120);
    });
    modal.querySelector('#member-history').addEventListener('click', () => {
      S.historyUser = m.id;
      closeModal();
      navigate('historial');
    });
  });
}

function mountMapa() {
  const el = document.getElementById('main-map');
  if (!el) return;
  S.mapCtl = createMap(el, { onPick: (lat, lng) => {} });
  S.mapCtl.setBasemap(S.basemap);
  S.mapCtl.setMembers(S.circle?.members || []);
  S.mapCtl.setPlaces(S.circle?.places || []);
  setTimeout(() => S.mapCtl?.fitAll(S.circle?.members || [], S.circle?.places || []), 150);
  S.afterRefresh = () => {
    const cards = document.getElementById('member-cards');
    if (cards) cards.innerHTML = memberCardsHtml();
    const qa = document.getElementById('quick-alerts');
    if (qa) qa.innerHTML = quickAlertsHtml();
    const status = document.getElementById('share-status');
    if (status) {
      const on = Boolean(myMembership()?.sharing);
      status.innerHTML = on ? '<span class="pill pill-green">●</span> Compartiendo ubicación' : '<span class="pill">○</span> Ubicación en pausa';
      const btn = document.querySelector('[data-map-act="toggle-share"]');
      if (btn) btn.innerHTML = `${icon('location', 15)} ${on ? 'Pausar' : 'Compartir mi ubicación'}`;
    }
    S.mapCtl?.setMembers(S.circle?.members || []);
    S.mapCtl?.setPlaces(S.circle?.places || []);
  };

  document.getElementById('member-cards').addEventListener('click', (e) => {
    const card = e.target.closest('[data-member]');
    if (!card) return;
    const m = S.circle.members.find((x) => x.id === card.dataset.member);
    if (!m) return;
    if (m.location) S.mapCtl?.focus(m.location.lat, m.location.lng, 16);
    memberModal(m);
  });
  el.parentElement.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-map-act]');
    if (!btn) return;
    const act = btn.dataset.mapAct;
    if (act === 'toggle-share') S.toggleSharing();
    if (act === 'invite') S.openInviteModal();
    if (act === 'center') S.mapCtl?.fitAll(S.circle?.members || [], S.circle?.places || []);
    if (act === 'basemap') {
      S.basemap = S.basemap === 'osm' ? 'atlas' : 'osm';
      S.mapCtl?.setBasemap(S.basemap);
      btn.innerHTML = `${icon('globe', 15)} ${S.basemap === 'osm' ? 'Atlas local' : 'Mapa OSM'}`;
      toast('Capa de mapa cambiada', S.basemap === 'osm' ? 'OpenStreetMap (requiere conexión)' : 'Atlas local sin servicios externos', 'success');
    }
    if (act === 'pin-me') S.pinMyLocation();
  });
}

/* ================================================================== */
/* HISTORIAL                                                          */
/* ================================================================== */

function renderHistorial() {
  const minDate = new Date(Date.now() - 89 * 864e5).toLocaleDateString('sv-SE');
  const today = new Date().toLocaleDateString('sv-SE');
  const members = S.circle?.members || [];
  return `<div class="page">
    ${pageHead('Historial de ubicaciones', 'Cronología diaria, trayectos y reproducción · 90 días incluidos sin coste',
      `<input class="input" style="width:auto" type="date" id="history-date" value="${esc(S.historyDate)}" min="${minDate}" max="${today}">
       <button class="btn btn-outline btn-sm" id="history-today">Hoy</button>`)}
    <div class="chips" style="margin-bottom:16px" id="history-users">
      <button class="chip ${S.historyUser === 'all' ? 'active' : ''}" data-huser="all">Todos</button>
      ${members.map((m) => `<button class="chip ${S.historyUser === m.id ? 'active' : ''}" data-huser="${esc(m.id)}">${esc(m.emoji)} ${esc(m.name)}</button>`).join('')}
    </div>
    <div class="grid-4" id="history-stats">${skeleton('Calculando el día…')}</div>
    <div class="history-layout" style="margin-top:16px">
      <div class="card" style="padding:10px">
        <div id="history-map" class="history-map"></div>
        <div class="replay-bar">
          <button class="btn btn-sm btn-primary" id="replay-play">${icon('play', 15)} Reproducir</button>
          <input type="range" id="replay-range" min="0" max="100" value="0" step="1">
          <span class="tiny muted" id="replay-label">0 / 0</span>
          <select class="input" style="width:auto" id="replay-speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select>
        </div>
      </div>
      <div class="card card-pad" style="max-height:540px;overflow-y:auto">
        <div class="section-title"><div><h2 style="font-size:16px">Cronología</h2><p>${esc(dateLong(Date.parse(`${S.historyDate}T12:00:00`)))}</p></div></div>
        <div id="history-timeline">${skeleton()}</div>
      </div>
    </div>
  </div>`;
}

function mountHistorial() {
  const token = S.viewToken;
  const el = document.getElementById('history-map');
  if (!el) return;
  S.mapCtl = createMap(el, { zoom: 13 });
  S.mapCtl.setBasemap(S.basemap);
  S.afterRefresh = () => {};

  const dateInput = document.getElementById('history-date');
  dateInput.addEventListener('change', () => { S.historyDate = dateInput.value; S.renderCurrent(); });
  document.getElementById('history-today').addEventListener('click', () => {
    S.historyDate = new Date().toLocaleDateString('sv-SE');
    S.renderCurrent();
  });
  document.getElementById('history-users').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-huser]');
    if (!btn) return;
    S.historyUser = btn.dataset.huser;
    S.renderCurrent();
  });

  const playBtn = document.getElementById('replay-play');
  const range = document.getElementById('replay-range');
  const speedSel = document.getElementById('replay-speed');
  const label = document.getElementById('replay-label');

  async function load() {
    const tz = new Date().getTimezoneOffset();
    const userParam = S.historyUser !== 'all' ? `&userId=${encodeURIComponent(S.historyUser)}` : '';
    const data = await api(`/api/circles/${S.circleId}/history?date=${S.historyDate}&tzOffset=${tz}${userParam}`);
    if (token !== S.viewToken) return;
    S.historyData = data;
    const people = data.members || [];
    const totalKm = round1(people.reduce((s, p) => s + (p.timeline.distanceKm || 0), 0));
    const stops = people.reduce((s, p) => s + p.timeline.visits.length, 0);
    const trips = people.reduce((s, p) => s + p.timeline.movements.length, 0);
    document.getElementById('history-stats').innerHTML = `
      <div class="card stat"><div class="stat-label">Distancia</div><div class="stat-value">${totalKm} km</div><div class="stat-sub">entre todos los miembros</div></div>
      <div class="card stat"><div class="stat-label">Estancias</div><div class="stat-value">${stops}</div><div class="stat-sub">paradas de 2 min o más</div></div>
      <div class="card stat"><div class="stat-label">Trayectos</div><div class="stat-value">${trips}</div><div class="stat-sub">desplazamientos del día</div></div>
      <div class="card stat"><div class="stat-label">Muestras</div><div class="stat-value">${people.reduce((s, p) => s + p.points.length, 0)}</div><div class="stat-sub">historial de ${data.retentionDays} días</div></div>`;

    const items = people.flatMap((p) => [
      ...p.timeline.visits.map((v) => ({ ...v, person: p })),
      ...p.timeline.movements.map((v) => ({ ...v, person: p })),
    ]).sort((a, b) => a.start - b.start);
    document.getElementById('history-timeline').innerHTML = items.length ? `<div class="timeline">${items.map((it) => `
      <div class="tl-item ${it.kind === 'trip' ? 'trip' : ''}">
        <div class="tl-card"><div class="tl-time">${timeHM(it.start)} – ${timeHM(it.end)} · ${durationText(it.durationMin)}</div>
        <div class="tl-title">${esc(it.label)} ${it.kind === 'trip' ? `<span class="tiny muted">máx. ${it.maxSpeed} km/h</span>` : ''}</div>
        <div class="tiny muted">${esc(it.person.emoji)} ${esc(it.person.name)}</div></div>
      </div>`).join('')}</div>` : emptyCard('calendar', 'Sin datos para este día', 'Prueba otra fecha u otro miembro del círculo.');

    const trails = people.filter((p) => p.points.length).map((p) => ({ points: p.points, color: p.color || '#5b6ef5' }));
    S.mapCtl.setTrails(trails);
    const all = trails.flatMap((t) => t.points.map((p) => [p[0], p[1]]));
    if (all.length) {
      const lats = all.map((p) => p[0]), lngs = all.map((p) => p[1]);
      S.mapCtl.fitAll([
        { location: { lat: Math.min(...lats), lng: Math.min(...lngs) } },
        { location: { lat: Math.max(...lats), lng: Math.max(...lngs) } },
      ], []);
    }
    const points = (people.find((p) => p.points.length) || {}).points || [];
    S.replay = { points, idx: 0, timer: null, emoji: (people[0] || {}).emoji || '🧭' };
    range.max = Math.max(0, points.length - 1);
    range.value = 0;
    label.textContent = `0 / ${points.length}`;
  }

  function stopReplay() {
    if (S.replay?.timer) clearInterval(S.replay.timer);
    if (S.replay) S.replay.timer = null;
    playBtn.innerHTML = `${icon('play', 15)} Reproducir`;
  }
  function showPoint(i) {
    const p = S.replay?.points?.[i];
    if (!p) return;
    S.mapCtl.setReplayPoint(p[0], p[1], S.replay.emoji);
    range.value = i;
    label.textContent = `${i + 1} / ${S.replay.points.length} · ${timeHM(p[2])}`;
  }
  playBtn.addEventListener('click', () => {
    if (!S.replay?.points?.length) return toast('Sin recorrido', 'No hay muestras para reproducir en esta fecha.', 'warning');
    if (S.replay.timer) { stopReplay(); return; }
    playBtn.innerHTML = `${icon('pause', 15)} Pausar`;
    S.replay.timer = setInterval(() => {
      S.replay.idx = (S.replay.idx + 1) % S.replay.points.length;
      showPoint(S.replay.idx);
      if (S.replay.idx === 0) stopReplay();
    }, 260 / Number(speedSel.value));
  });
  range.addEventListener('input', () => { if (S.replay) { S.replay.idx = Number(range.value); showPoint(S.replay.idx); } });
  document.getElementById('history-timeline').addEventListener('click', (e) => {
    const item = e.target.closest('.tl-item');
    if (item && S.historyData) {
      // Centra el mapa en el índice de cronología pulsado.
      const idx = [...item.parentElement.children].indexOf(item);
      const points = S.replay?.points || [];
      if (points.length) showPoint(Math.min(points.length - 1, Math.round(idx / Math.max(1, document.querySelectorAll('.tl-item').length) * points.length)));
    }
  });
  load().catch(() => {});
}

/* ================================================================== */
/* LUGARES                                                            */
/* ================================================================== */

function placeEditorHtml(p) {
  const isNew = !p.id || p.__new;
  return `<div class="card card-pad" style="margin-bottom:18px">
    <div class="section-title"><div><h2 style="font-size:17px">${isNew ? 'Nuevo lugar' : `Editar ${esc(p.name)}`}</h2><p>Alertas de llegada y salida ilimitadas, sin cupos ni suscripción.</p></div>
      <button class="btn btn-ghost btn-sm" id="place-cancel">${icon('close', 16)} Cancelar</button></div>
    <div class="place-editor-layout">
      <div>
        <div class="field"><label>Nombre</label><input id="place-name" value="${esc(p.name || '')}" placeholder="Casa, trabajo, colegio…"></div>
        <div class="field"><label>Icono</label><div class="chips" id="place-emojis">${PLACE_EMOJIS.map((e) => `<button class="chip ${p.icon === e ? 'active' : ''}" data-pemoji="${e}" style="padding:5px 9px;font-size:16px">${e}</button>`).join('')}</div></div>
        <div class="field"><label>Radio: <b id="radius-value">${p.radius || 200}</b> m</label><input type="range" id="place-radius" min="20" max="2000" step="20" value="${p.radius || 200}"></div>
        <div class="field-row">
          <div class="field"><label>Latitud</label><input id="place-lat" type="number" step="0.000001" value="${Number(p.lat || 40.4203).toFixed(6)}"></div>
          <div class="field"><label>Longitud</label><input id="place-lng" type="number" step="0.000001" value="${Number(p.lng || -3.7065).toFixed(6)}"></div>
        </div>
        <div class="chips" style="margin:4px 0 14px"><button class="btn btn-sm btn-outline" id="place-use-me">${icon('target', 15)} Mi ubicación</button></div>
        <label class="switch"><input type="checkbox" id="place-alerts" ${p.alertsOn === false ? '' : 'checked'}><span class="track"></span><span class="small">Alertas de entrada/salida activadas</span></label>
        <div style="margin-top:16px" class="chips"><button class="btn btn-primary" id="place-save">${icon('check', 16)} ${isNew ? 'Crear lugar' : 'Guardar cambios'}</button></div>
      </div>
      <div class="place-mini-map" id="place-map"></div>
    </div>
    <p class="field-hint" style="margin:12px 0 0">Haz clic en el mapa para colocar el lugar. El círculo muestra el radio de la geocerca.</p>
  </div>`;
}

function renderLugares() {
  const places = S.circle?.places || [];
  const editor = S.editingPlace ? placeEditorHtml(S.editingPlace) : '';
  return `<div class="page">
    ${pageHead('Lugares', `${places.length} lugares configurados · sin límite y con alertas ilimitadas`,
      `<button class="btn btn-primary" id="place-new">${icon('plus', 16)} Nuevo lugar</button>`)}
    ${editor}
    <div class="place-grid">${places.length ? places.map((p) => `
      <div class="card place-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div class="place-emoji" style="background:${esc(p.color || '#5b6ef5')}22">${esc(p.icon || '📍')}</div>
          <span class="pill ${p.alertsOn === false ? '' : 'pill-green'}">${p.alertsOn === false ? 'Avisos off' : 'Avisos on'}</span>
        </div>
        <h3>${esc(p.name)}</h3>
        <div class="tiny muted">Radio ${p.radius || 200} m · ${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}</div>
        <div class="place-actions">
          <button class="btn btn-sm btn-outline" data-place-edit="${esc(p.id)}">${icon('edit', 14)} Editar</button>
          <button class="btn btn-sm btn-outline" data-place-toggle="${esc(p.id)}">${p.alertsOn === false ? 'Activar avisos' : 'Silenciar'}</button>
          <button class="btn btn-sm btn-danger" data-place-del="${esc(p.id)}">${icon('trash', 14)}</button>
        </div>
      </div>`).join('') : emptyCard('pin', 'Sin lugares todavía', 'Crea tu primer lugar para recibir avisos de llegada y salida.')}</div>
    <div class="notice" style="margin-top:18px">${icon('spark', 18)}<span>Los planes de pago de otras apps limitan el número de lugares y los días de historial. Aquí no hay límites artificiales: puedes crear tantos como necesites.</span></div>
  </div>`;
}

function mountLugares() {
  S.mapCtl = null;
  S.afterRefresh = () => {};
  document.getElementById('place-new')?.addEventListener('click', () => {
    const me = S.circle?.members?.find((m) => m.id === S.user?.id);
    const base = me?.location || { lat: 40.4203, lng: -3.7065 };
    S.editingPlace = { __new: true, name: '', icon: '📍', color: '#5b6ef5', lat: base.lat, lng: base.lng, radius: 200, alertsOn: true };
    S.renderCurrent();
  });
  document.querySelectorAll('[data-place-edit]').forEach((b) => b.addEventListener('click', () => {
    const p = S.circle.places.find((x) => x.id === b.dataset.placeEdit);
    S.editingPlace = { ...p };
    S.renderCurrent();
  }));
  document.querySelectorAll('[data-place-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const p = S.circle.places.find((x) => x.id === b.dataset.placeToggle);
    await api(`/api/circles/${S.circleId}/places/${p.id}`, { method: 'PATCH', body: { alertsOn: p.alertsOn === false } });
    await S.refresh();
    S.renderCurrent();
    toast('Avisos actualizados', p.name, 'success');
  }));
  document.querySelectorAll('[data-place-del]').forEach((b) => b.addEventListener('click', () => {
    const p = S.circle.places.find((x) => x.id === b.dataset.placeDel);
    confirmModal('Eliminar lugar', `¿Eliminar «${p.name}» y sus alertas asociadas?`, async () => {
      await api(`/api/circles/${S.circleId}/places/${p.id}`, { method: 'DELETE' });
      await S.refresh();
      S.renderCurrent();
      toast('Lugar eliminado', '', 'success');
    }, { danger: true, confirmText: 'Eliminar' });
  }));
  document.getElementById('place-cancel')?.addEventListener('click', () => { S.editingPlace = null; S.renderCurrent(); });
  if (!S.editingPlace) return;

  const p = S.editingPlace;
  const mapEl = document.getElementById('place-map');
  const editorMap = createMap(mapEl, { center: [p.lat, p.lng], zoom: 15 });
  S._extraMap = editorMap;
  editorMap.setBasemap(S.basemap);
  const latInput = document.getElementById('place-lat');
  const lngInput = document.getElementById('place-lng');
  const radiusInput = document.getElementById('place-radius');
  const radiusLabel = document.getElementById('radius-value');
  let iconValue = p.icon || '📍';
  const preview = () => editorMap.setPlaces([{ ...p, lat: Number(latInput.value), lng: Number(lngInput.value), radius: Number(radiusInput.value), icon: iconValue, name: document.getElementById('place-name').value || 'Nuevo lugar' }]);
  preview();
  editorMap.setPickMode(true);
  // El picker del editor se conecta sustituyendo el callback del mapa.
  mapEl.addEventListener('click', () => {});
  editorMap.map.on('click', (e) => {
    latInput.value = e.latlng.lat.toFixed(6);
    lngInput.value = e.latlng.lng.toFixed(6);
    preview();
  });
  latInput.addEventListener('change', () => { preview(); editorMap.focus(Number(latInput.value), Number(lngInput.value), 15); });
  lngInput.addEventListener('change', () => { preview(); editorMap.focus(Number(latInput.value), Number(lngInput.value), 15); });
  radiusInput.addEventListener('input', () => { radiusLabel.textContent = radiusInput.value; preview(); });
  document.getElementById('place-emojis').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pemoji]');
    if (!b) return;
    iconValue = b.dataset.pemoji;
    document.querySelectorAll('[data-pemoji]').forEach((x) => x.classList.toggle('active', x === b));
    preview();
  });
  document.getElementById('place-use-me').addEventListener('click', () => {
    const me = S.circle?.members?.find((m) => m.id === S.user?.id);
    const loc = me?.location || { lat: 40.4203, lng: -3.7065 };
    latInput.value = Number(loc.lat).toFixed(6);
    lngInput.value = Number(loc.lng).toFixed(6);
    preview();
    editorMap.focus(loc.lat, loc.lng, 15);
  });
  document.getElementById('place-save').addEventListener('click', async () => {
    const name = document.getElementById('place-name').value.trim();
    if (!name) return toast('Falta el nombre', 'Ponle un nombre al lugar.', 'warning');
    const body = {
      name, icon: iconValue, color: '#5b6ef5',
      lat: Number(latInput.value), lng: Number(lngInput.value),
      radius: Number(radiusInput.value), alertsOn: document.getElementById('place-alerts').checked,
    };
    const isNew = !S.editingPlace.id;
    try {
      await api(`/api/circles/${S.circleId}/places${isNew ? '' : `/${S.editingPlace.id}`}`, { method: isNew ? 'POST' : 'PATCH', body });
      S.editingPlace = null;
      await S.refresh();
      S.renderCurrent();
      toast(isNew ? 'Lugar creado' : 'Lugar actualizado', name, 'success');
    } catch {}
  });
}

/* ================================================================== */
/* CHAT                                                               */
/* ================================================================== */

function messageHtml(m) {
  const mine = m.userId === S.user?.id;
  const body = m.image ? `<img src="${esc(m.image)}" alt="Imagen compartida">` : esc(m.text);
  return `<div class="msg ${mine ? 'mine' : ''}" data-msgid="${esc(m.id)}">
    ${mine ? '' : avatarHtml({ emoji: (S.circle?.members || []).find((x) => x.id === m.userId)?.emoji || '🙂', color: (S.circle?.members || []).find((x) => x.id === m.userId)?.color || '#5b6ef5' })}
    <div><div class="msg-body"><div class="msg-meta">${esc(m.userName || 'Miembro')}</div>${body}<div class="msg-time">${timeHM(m.ts)}</div></div></div>
  </div>`;
}

function renderChat() {
  const members = S.circle?.members || [];
  return `<div class="page">
    ${pageHead('Chat del círculo', 'Mensajes y fotos privados entre los miembros', `<span class="pill pill-green">${icon('lock', 13)} Solo ${esc(S.circle?.name || 'el círculo')}</span>`)}
    <div class="chat-layout">
      <div class="card chat-main">
        <div class="chat-head">${icon('chat', 18)} <b>${esc(S.circle?.name || 'Chat')}</b><span class="tiny muted">· ${members.length} miembros</span></div>
        <div class="chat-messages" id="chat-messages">${(S.circle?.messages || []).map(messageHtml).join('') || emptyCard('chat', 'Aún no hay mensajes', 'Saluda a tu círculo 👋')}</div>
        <div class="emoji-row" id="emoji-row">${['👍', '❤️', '😂', '🏠', '🚗', '✅', '🤝', '🍕'].map((e) => `<button data-emoji="${e}">${e}</button>`).join('')}</div>
        <div class="chat-composer">
          <button class="icon-btn" id="chat-image-btn" title="Adjuntar imagen">${icon('image', 18)}</button>
          <input type="file" id="chat-image-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
          <input type="text" id="chat-text" placeholder="Escribe un mensaje…" autocomplete="off">
          <button class="btn btn-primary" id="chat-send">${icon('send', 16)} Enviar</button>
        </div>
        <div id="chat-attachment"></div>
      </div>
      <div class="chat-side">
        <div class="card"><h3 style="margin:0 0 12px;font-size:14px">En el círculo</h3>${members.map((m) => `<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">${avatarHtml(m)}<div><b style="font-size:12.5px">${esc(m.name)}</b><div class="tiny muted">${m.paused ? 'Ubicación en pausa' : 'Compartiendo'}</div></div></div>`).join('')}</div>
        <div class="card"><div class="notice ok" style="margin:0">${icon('lock', 16)}<span>Los mensajes y las imágenes se guardan solo en este servidor. No hay anuncios ni analítica de terceros.</span></div></div>
      </div>
    </div>
  </div>`;
}

function mountChat() {
  S.mapCtl = null;
  const box = document.getElementById('chat-messages');
  const known = new Set((S.circle?.messages || []).map((m) => m.id));
  box.scrollTop = box.scrollHeight;
  S.appendChatMessages = (messages = []) => {
    let added = 0;
    for (const m of messages) {
      if (known.has(m.id)) continue;
      known.add(m.id);
      box.insertAdjacentHTML('beforeend', messageHtml(m));
      added++;
    }
    if (added) box.scrollTop = box.scrollHeight;
  };
  S.afterRefresh = () => S.appendChatMessages(S.circle?.messages || []);

  const input = document.getElementById('chat-text');
  const attach = document.getElementById('chat-attachment');
  const fileInput = document.getElementById('chat-image-input');
  const renderAttachment = () => {
    attach.innerHTML = S.chatImage
      ? `<div style="display:flex;align-items:center;gap:9px;padding:0 12px 10px"><img src="${esc(S.chatImage)}" style="height:44px;border-radius:8px"><span class="tiny">Imagen adjunta</span><button class="btn btn-ghost btn-sm" id="chat-remove-image">Quitar</button></div>`
      : '';
    document.getElementById('chat-remove-image')?.addEventListener('click', () => { S.chatImage = null; renderAttachment(); });
  };
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 2_500_000) return toast('Imagen demasiado grande', 'El límite es 2,5 MB.', 'warning');
    const reader = new FileReader();
    reader.onload = () => { S.chatImage = reader.result; renderAttachment(); };
    reader.readAsDataURL(file);
  });
  document.getElementById('chat-image-btn').addEventListener('click', () => fileInput.click());
  document.getElementById('emoji-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    input.value += b.dataset.emoji;
    input.focus();
  });
  async function send() {
    const text = input.value.trim();
    if (!text && !S.chatImage) return;
    input.value = '';
    try {
      const { message } = await api(`/api/circles/${S.circleId}/messages`, { method: 'POST', body: { text, image: S.chatImage } });
      S.chatImage = null;
      renderAttachment();
      S.appendChatMessages([message]);
    } catch {}
  }
  document.getElementById('chat-send').addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
}

/* ================================================================== */
/* CONDUCCIÓN                                                         */
/* ================================================================== */

const EVENT_LABELS = {
  speeding: { label: 'Exceso de velocidad', icon: '⚡' },
  hard_braking: { label: 'Frenada brusca', icon: '🛑' },
  rapid_acceleration: { label: 'Aceleración brusca', icon: '🚀' },
  phone_use: { label: 'Uso del móvil', icon: '📱' },
  crash: { label: 'Colisión', icon: '🆘' },
};
const scoreColor = (s) => s >= 85 ? '#12a594' : s >= 65 ? '#f59e0b' : '#ee4d5a';
const scoreRing = (s, compact = false) => `<div class="score-ring" style="background:conic-gradient(${scoreColor(s)} ${s}%, #eef1f6 0);${compact ? 'width:52px;height:52px;font-size:15px' : ''}"><div style="width:${compact ? '40' : '66'}px;height:${compact ? '40' : '66'}px;border-radius:50%;background:#fff;display:grid;place-items:center;color:${scoreColor(s)}">${s}</div></div>`;

function renderConduccion() {
  return `<div class="page">
    ${pageHead('Conducción segura', 'Informes individuales y familiares, eventos y puntuación por viaje',
      `<select class="input" style="width:auto" id="driving-days"><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option></select>
       <button class="btn btn-outline btn-sm" id="driving-refresh">${icon('refresh', 15)} Actualizar</button>
       ${S.demo ? `<button class="btn btn-teal btn-sm" id="driving-simulate">${icon('bolt', 15)} Simular viaje</button>` : ''}`)}
    <div id="driving-content">${skeleton('Analizando los viajes…')}</div>
  </div>`;
}

function drivingHtml(data) {
  const { summary, trips, days } = data;
  const avg = summary.drivers.length ? Math.round(summary.drivers.reduce((s, d) => s + d.score, 0) / summary.drivers.length) : 100;
  const counts = summary.totals.counts;
  const maxCount = Math.max(1, ...Object.values(counts));
  return `<div class="grid-4" style="margin-bottom:16px">
      <div class="card stat"><div class="stat-label">Puntuación media</div><div class="stat-value" style="color:${scoreColor(avg)}">${avg}</div><div class="stat-sub">sobre 100</div></div>
      <div class="card stat"><div class="stat-label">Viajes</div><div class="stat-value">${summary.totals.trips}</div><div class="stat-sub">últimos ${days} días</div></div>
      <div class="card stat"><div class="stat-label">Kilómetros</div><div class="stat-value">${summary.totals.km}</div><div class="stat-sub">entre todos</div></div>
      <div class="card stat"><div class="stat-label">Incidencias</div><div class="stat-value">${summary.totals.events}</div><div class="stat-sub">eventos detectados</div></div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card card-pad"><div class="section-title"><div><h2 style="font-size:16px">Informe familiar</h2><p>Ranking de conducción del círculo</p></div></div>
        ${summary.drivers.length ? summary.drivers.map((d, i) => `<div class="rank-row"><span class="rank-num">${i + 1}</span>${avatarHtml(d)}<div style="flex:1"><b class="small">${esc(d.name)}</b><div class="tiny muted">${d.trips} viajes · ${d.km} km · ${d.events} incidencias</div></div>${scoreRing(d.score, true)}</div>`).join('') : emptyCard('car', 'Sin viajes', 'Los viajes aparecerán cuando haya desplazamientos.')}
      </div>
      <div class="card card-pad"><div class="section-title"><div><h2 style="font-size:16px">Desglose de eventos</h2><p>Tipos de incidencias detectadas</p></div></div>
        ${Object.entries(counts).map(([k, v]) => `<div class="bar-row"><span>${EVENT_LABELS[k].icon} ${EVENT_LABELS[k].label}</span><div class="bar-track"><i style="width:${(v / maxCount) * 100}%;background:${k === 'crash' ? 'var(--red)' : k === 'phone_use' ? 'var(--amber)' : 'var(--primary)'}"></i></div><b>${v}</b></div>`).join('')}
        <div class="notice" style="margin-top:16px">${icon('info', 16)}<span>Los umbrales son orientativos y se calculan con las muestras del navegador. Puedes ajustar el límite de velocidad en Ajustes.</span></div>
      </div>
    </div>
    <div class="card card-pad"><div class="section-title"><div><h2 style="font-size:16px">Viajes recientes</h2><p>Historial de conducción de todos los miembros</p></div><span class="pill">${trips.length} viajes</span></div>
      ${trips.length ? trips.slice(0, 30).map((t) => {
        const driver = (S.circle?.members || []).find((m) => m.id === t.userId);
        return `<div class="trip-row">${scoreRing(t.score)}
          <div style="flex:1;min-width:0"><b class="small">${esc(driver?.name || 'Miembro')} · ${dateShort(t.startAt)} ${timeHM(t.startAt)}</b>
          <div class="tiny muted">${round1(t.distanceKm)} km · máx. ${t.maxSpeed} km/h · ${t.events.length} incidencias</div>
          <div class="event-tags" style="margin-top:5px">${t.events.slice(0, 4).map((e) => `<span class="pill pill-amber">${EVENT_LABELS[e.type]?.icon || '⚠️'} ${EVENT_LABELS[e.type]?.label || e.type}</span>`).join('')}</div></div>
        </div>`;
      }).join('') : emptyCard('route', 'Sin viajes todavía', 'Conduce con la app abierta o pulsa «Simular viaje» en la demo.')}
    </div>`;
}

function mountConduccion() {
  S.mapCtl = null;
  S.afterRefresh = () => {};
  const sel = document.getElementById('driving-days');
  sel.value = String(S.drivingDays);
  const content = document.getElementById('driving-content');
  const token = S.viewToken;
  async function load() {
    const data = await api(`/api/circles/${S.circleId}/driving?days=${S.drivingDays}`);
    if (token !== S.viewToken) return;
    S.drivingData = data;
    content.innerHTML = drivingHtml(data);
  }
  sel.addEventListener('change', () => { S.drivingDays = Number(sel.value); load().catch(() => {}); });
  document.getElementById('driving-refresh').addEventListener('click', () => { content.innerHTML = skeleton(); load().catch(() => {}); });
  document.getElementById('driving-simulate')?.addEventListener('click', async () => {
    try {
      await api('/api/demo/simulate-trip', { method: 'POST', body: {} });
      toast('Viaje simulado', 'Revisa el informe actualizado.', 'success');
      content.innerHTML = skeleton();
      await load();
    } catch {}
  });
  load().catch(() => {});
}

/* ================================================================== */
/* SEGURIDAD                                                          */
/* ================================================================== */

function incidentsHtml() {
  const list = (S.circle?.sos || []).filter((s) => s.status === 'pending' || s.status === 'active');
  if (!list.length) return `<div class="notice ok">${icon('check', 16)}<span>No hay alertas activas. Todo el círculo está bien.</span></div>`;
  return list.map((s) => {
    const mine = s.userId === S.user?.id;
    const pending = s.kind === 'crash' && s.status === 'pending';
    const secs = pending ? Math.max(0, Math.round((s.confirmUntil - Date.now()) / 1000)) : 0;
    const contacts = (s.emergencyContacts || []).map((c) => `<a class="btn btn-sm btn-outline" href="tel:${esc(c.phone)}">${icon('phone', 14)} ${esc(c.name)}</a><a class="btn btn-sm btn-outline" href="sms:${esc(c.phone)}?body=${encodeURIComponent('Necesito ayuda. Mi ubicación: ' + (s.location ? `${s.location.lat},${s.location.lng}` : 'consultar Trobemmos'))}">SMS</a>`).join('');
    return `<div class="card card-pad incident" style="margin-bottom:12px;${pending ? 'border-left-color:var(--amber)' : ''}">
      <div style="display:flex;align-items:center;gap:10px"><span style="font-size:24px">${pending ? '⚠️' : '🆘'}</span>
        <div style="flex:1"><b>${esc(pending ? `Posible colisión de ${s.userName}` : `Alerta SOS de ${s.userName}`)}</b>
        <div class="tiny muted">${esc(s.note || '')} · ${timeAgo(s.ts)}${pending ? ` · <span class="countdown" data-countdown="${esc(s.id)}" data-until="${s.confirmUntil}">${secs} s</span>` : ''}</div></div>
        <span class="pill ${pending ? 'pill-amber' : 'pill-red'}">${pending ? 'Pendiente' : 'Activa'}</span>
      </div>
      ${s.location ? `<p class="tiny muted" style="margin:10px 0">📍 ${s.location.lat.toFixed(5)}, ${s.location.lng.toFixed(5)} · <a href="https://www.openstreetmap.org/?mlat=${s.location.lat}&mlon=${s.location.lng}#map=16/${s.location.lat}/${s.location.lng}" target="_blank" rel="noopener">Ver en mapa</a></p>` : ''}
      ${contacts ? `<div class="chips" style="margin:10px 0">${contacts}</div>` : ''}
      <div class="chips" style="margin-top:10px">
        ${pending && mine ? `<button class="btn btn-sm btn-teal" data-sos-act="cancel" data-sos-id="${esc(s.id)}">${icon('check', 14)} Estoy bien</button>
          <button class="btn btn-sm btn-danger" data-sos-act="confirm" data-sos-id="${esc(s.id)}">Necesito ayuda</button>` : ''}
        ${!pending ? `<button class="btn btn-sm btn-outline" data-sos-act="ack" data-sos-id="${esc(s.id)}">${icon('check', 14)} Me he enterado (${s.acknowledgements?.length || 0})</button>` : ''}
        <button class="btn btn-sm btn-outline" data-sos-act="resolved" data-sos-id="${esc(s.id)}">Marcar resuelta</button>
      </div>
    </div>`;
  }).join('');
}

function incidentHistoryHtml() {
  const list = (S.circle?.sos || []).filter((s) => s.status !== 'pending' && s.status !== 'active');
  if (!list.length) return '<p class="tiny muted">Sin incidentes anteriores.</p>';
  return list.slice(0, 10).map((s) => `<div class="contact-row"><span>${s.kind === 'crash' ? '⚠️' : '🆘'}</span><div style="flex:1"><b class="small">${esc(s.userName)} · ${s.status === 'cancelled' ? 'Cancelada' : s.status === 'resolved' ? 'Resuelta' : esc(s.status)}</b><div class="tiny muted">${dateShort(s.ts)} ${timeHM(s.ts)} · ${esc(s.note || '')}</div></div></div>`).join('');
}

function renderSeguridad() {
  const contacts = S.user?.emergencyContacts || [];
  return `<div class="page" id="seguridad-page">
    ${pageHead('Seguridad', 'Alerta SOS silenciosa, detección de colisiones y contactos de emergencia', `<span class="pill pill-green">${icon('check', 13)} Incluido gratis</span>`)}
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card card-pad sos-hero" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:26px">
        <span class="eyebrow">Alerta SOS silenciosa</span>
        <h2 style="margin:8px 0 4px;font-size:19px">Mantén pulsado para pedir ayuda</h2>
        <p class="small muted" style="max-width:330px;line-height:1.6;margin:0 0 20px">Avisa al instante a tu círculo con tu ubicación, sin sonido ni llamada automática. Después puedes llamar o escribir a tus contactos con un toque.</p>
        <button class="sos-hold" id="sos-hold"><span>🆘</span>SOS<small>Mantén 1 segundo</small><span class="hold-progress"><i></i></span></button>
        <button class="btn btn-ghost btn-sm" id="sos-now" style="margin-top:14px">¿No puedes mantener? Enviar con confirmación</button>
      </div>
      <div class="card card-pad">
        <div class="section-title"><div><h2 style="font-size:16px">Contactos de emergencia</h2><p>Aparecen en cada alerta SOS</p></div></div>
        <div id="contacts-list">${contacts.length ? contacts.map((c) => `<div class="contact-row"><span style="font-size:18px">📞</span><div style="flex:1"><b class="small">${esc(c.name)}</b><div class="tiny muted">${esc(c.phone)}</div></div><a class="btn btn-sm btn-outline" href="tel:${esc(c.phone)}">Llamar</a><button class="btn btn-sm btn-danger" data-contact-del="${esc(c.id)}">${icon('trash', 13)}</button></div>`).join('') : '<p class="tiny muted">Aún no hay contactos. Añade uno para tenerlo a mano en una emergencia.</p>'}</div>
        <div class="field-row" style="margin-top:14px"><div class="field" style="margin:0"><label>Nombre</label><input id="contact-name" placeholder="Nombre"></div><div class="field" style="margin:0"><label>Teléfono</label><input id="contact-phone" placeholder="+34 600 000 000"></div></div>
        <button class="btn btn-outline btn-sm" id="contact-add" style="margin-top:10px">${icon('plus', 15)} Añadir contacto</button>
      </div>
    </div>
    <div class="card card-pad" style="margin-bottom:16px"><div class="section-title"><div><h2 style="font-size:16px">Alertas activas</h2><p>Incidentes en curso del círculo</p></div></div><div id="incidents">${incidentsHtml()}</div></div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card card-pad"><div class="section-title"><div><h2 style="font-size:16px">Detección de accidentes</h2><p>Heurística de deceleración y acelerómetro</p></div></div>
        <div class="setting-row"><div><b>Detección automática</b><span>Analiza frenadas bruscas a velocidad de circulación</span></div>
          <label class="switch"><input type="checkbox" id="crash-toggle" ${S.user?.settings?.crashDetection === false ? '' : 'checked'}><span class="track"></span></label></div>
        ${S.demo ? `<div class="chips" style="margin-top:14px"><button class="btn btn-sm btn-outline" id="sim-crash">${icon('bolt', 15)} Simular colisión</button></div>` : ''}
        <div class="notice warn" style="margin-top:14px">${icon('alert', 16)}<span>Orientativo: un navegador no sustituye a los sensores del coche ni a los servicios de emergencia. Ante una emergencia real, llama al 112.</span></div>
      </div>
      <div class="card card-pad"><div class="section-title"><div><h2 style="font-size:16px">Historial de incidentes</h2><p>Alertas canceladas y resueltas</p></div></div><div id="incident-history">${incidentHistoryHtml()}</div></div>
    </div>
    <div class="notice">${icon('lock', 16)}<span>Privacidad: cada persona decide si comparte su ubicación y puede pausarla en cualquier momento. Trobemmos no vigila a nadie sin su consentimiento.</span></div>
  </div>`;
}

function mountSeguridad() {
  S.mapCtl = null;
  S.afterRefresh = () => {
    const inc = document.getElementById('incidents');
    if (inc) inc.innerHTML = incidentsHtml();
    const hist = document.getElementById('incident-history');
    if (hist) hist.innerHTML = incidentHistoryHtml();
  };
  const hold = document.getElementById('sos-hold');
  const fill = hold.querySelector('.hold-progress i');
  let raf = null;
  const start = (e) => {
    e.preventDefault();
    const t0 = Date.now();
    raf = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / 950);
      fill.style.width = `${p * 100}%`;
      if (p >= 1) { clearInterval(raf); raf = null; fill.style.width = '0'; S.sendSos(); }
    }, 25);
  };
  const stop = () => { if (raf) clearInterval(raf); raf = null; fill.style.width = '0'; };
  hold.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hold.addEventListener(ev, stop));
  document.getElementById('sos-now').addEventListener('click', () => {
    confirmModal('Enviar alerta SOS', 'Se avisará a todos los miembros del círculo con tu última ubicación. ¿Continuar?', () => S.sendSos(), { danger: true, confirmText: 'Enviar SOS' });
  });

  const view = document.getElementById('seguridad-page');
  view.addEventListener('click', async (e) => {
    const sopBtn = e.target.closest('[data-sos-act]');
    if (sopBtn) {
      try {
        await api(`/api/circles/${S.circleId}/sos/${sopBtn.dataset.sosId}`, { method: 'POST', body: { action: sopBtn.dataset.sosAct } });
        await S.refresh();
        toast('Alerta actualizada', '', 'success');
      } catch {}
      return;
    }
    const del = e.target.closest('[data-contact-del]');
    if (del) {
      const next = (S.user.emergencyContacts || []).filter((c) => c.id !== del.dataset.contactDel);
      await saveContacts(next);
    }
  });

  async function saveContacts(list) {
    const { user } = await api('/api/me', { method: 'PATCH', body: { emergencyContacts: list } });
    S.user = user;
    S.renderCurrent();
  }
  document.getElementById('contact-add').addEventListener('click', async () => {
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    if (!name || !phone) return toast('Faltan datos', 'Nombre y teléfono son obligatorios.', 'warning');
    await saveContacts([...(S.user.emergencyContacts || []), { name, phone }]);
    toast('Contacto añadido', '', 'success');
  });
  document.getElementById('crash-toggle').addEventListener('change', async (e) => {
    const { user } = await api('/api/me', { method: 'PATCH', body: { settings: { crashDetection: e.target.checked } } });
    S.user = user;
    toast(e.target.checked ? 'Detección activada' : 'Detección desactivada', '', 'success');
  });
  document.getElementById('sim-crash')?.addEventListener('click', async () => {
    try {
      await api('/api/demo/simulate-crash', { method: 'POST', body: {} });
      await S.refresh();
      toast('Colisión simulada', 'Usa «Estoy bien» para cancelarla.', 'warning');
    } catch {}
  });

  // Cuenta atrás de las colisiones pendientes: si expira, se confirma la alerta.
  if (seguridadTimer) clearInterval(seguridadTimer);
  seguridadTimer = setInterval(() => {
    if (S.view !== 'seguridad' || !document.getElementById('seguridad-page')) { clearInterval(seguridadTimer); seguridadTimer = null; return; }
    document.querySelectorAll('[data-countdown]').forEach(async (el) => {
      const left = Math.max(0, Math.round((Number(el.dataset.until) - Date.now()) / 1000));
      el.textContent = `${left} s`;
      if (left === 0 && !el.dataset.done) {
        el.dataset.done = '1';
        const record = (S.circle?.sos || []).find((s) => s.id === el.dataset.countdown && s.status === 'pending');
        if (record && record.userId === S.user.id) {
          await api(`/api/circles/${S.circleId}/sos/${record.id}`, { method: 'POST', body: { action: 'confirm' }, silent: true }).catch(() => {});
          await S.refresh();
          toast('Colisión confirmada', 'Se ha avisado al círculo.', 'critical');
        }
      }
    });
  }, 1000);
}

/* ================================================================== */
/* AJUSTES                                                            */
/* ================================================================== */

function renderAjustes() {
  const u = S.user || {};
  const circles = S.circles || [];
  return `<div class="page" style="max-width:900px">
    ${pageHead('Ajustes', 'Tu cuenta, privacidad y control de datos')}
    <div class="card settings-section">
      <h3>Mi perfil</h3><p>Así te ven los demás miembros de tus círculos.</p>
      <div class="field-row">
        <div class="field"><label>Nombre</label><input id="set-name" value="${esc(u.name || '')}"></div>
        <div class="field"><label>Teléfono</label><input id="set-phone" value="${esc(u.phone || '')}" placeholder="+34 …"></div>
      </div>
      <div class="field"><label>Avatar</label><div class="chips" id="set-emojis">${EMOJIS.map((e) => `<button class="chip ${u.emoji === e ? 'active' : ''}" data-semoji="${e}" style="padding:5px 9px;font-size:17px">${e}</button>`).join('')}</div></div>
      <div class="field" style="max-width:180px"><label>Color</label><input type="color" id="set-color" value="${esc(u.color || '#5b6ef5')}" style="height:42px;padding:4px"></div>
      <button class="btn btn-primary btn-sm" id="set-save">${icon('check', 15)} Guardar perfil</button>
    </div>
    <div class="card settings-section">
      <h3>Privacidad y ubicación</h3><p>El uso compartido es voluntario e independiente en cada círculo.</p>
      ${circles.map((c) => `<div class="setting-row"><div><b>${esc(c.name)}</b><span>${c.memberCount} miembros · código ${esc(c.code)}</span></div>
        <label class="switch"><input type="checkbox" data-share-circle="${esc(c.id)}" ${c.members?.[S.user?.id]?.sharing ? 'checked' : ''}><span class="track"></span></label></div>`).join('')}
      <div class="setting-row"><div><b>Detección de colisiones</b><span>Heurística basada en velocidad y acelerómetro</span></div>
        <label class="switch"><input type="checkbox" id="set-crash" ${u.settings?.crashDetection === false ? '' : 'checked'}><span class="track"></span></label></div>
      <div class="setting-row"><div><b>Avisos de batería baja</b><span>Avisar al círculo cuando baje del 20%</span></div>
        <label class="switch"><input type="checkbox" id="set-battery" ${u.settings?.lowBatteryAlerts === false ? '' : 'checked'}><span class="track"></span></label></div>
      <div class="setting-row"><div><b>Notificaciones del navegador</b><span>Permite avisos aunque la pestaña esté en segundo plano</span></div>
        <button class="btn btn-outline btn-sm" id="set-notif-perm">Comprobar permiso</button></div>
      <div class="setting-row"><div><b>Límite de velocidad</b><span>Umbral para detectar excesos en los informes</span></div>
        <div style="display:flex;align-items:center;gap:8px"><input class="input" id="set-speed" type="number" min="20" max="150" value="${u.settings?.speedLimitKmh || 50}" style="width:90px"><span class="tiny muted">km/h</span></div></div>
    </div>
    <div class="card settings-section">
      <h3>Mis datos</h3><p>Transparencia: exporta o elimina toda tu información cuando quieras.</p>
      <div class="chips">
        <button class="btn btn-outline btn-sm" id="set-export">${icon('download', 15)} Exportar mis datos</button>
        <button class="btn btn-outline btn-sm" id="set-logout">${icon('logout', 15)} Cerrar sesión</button>
        <button class="btn btn-danger btn-sm" id="set-delete">${icon('trash', 15)} Eliminar mi cuenta</button>
      </div>
    </div>
    <div class="notice">${icon('info', 16)}<span>Trobemmos guarda los datos en este servidor (archivo local <code>data/state.json</code>). No hay publicidad, ni rastreadores de terceros, ni venta de datos de ubicación.</span></div>
  </div>`;
}

function mountAjustes() {
  S.mapCtl = null;
  S.afterRefresh = () => {};
  let emoji = S.user?.emoji || '🙂';
  document.getElementById('set-emojis').addEventListener('click', (e) => {
    const b = e.target.closest('[data-semoji]');
    if (!b) return;
    emoji = b.dataset.semoji;
    document.querySelectorAll('[data-semoji]').forEach((x) => x.classList.toggle('active', x === b));
  });
  const patch = async (body) => {
    const { user } = await api('/api/me', { method: 'PATCH', body });
    S.user = user;
    return user;
  };
  document.getElementById('set-save').addEventListener('click', async () => {
    await patch({ name: document.getElementById('set-name').value.trim(), phone: document.getElementById('set-phone').value.trim(), emoji, color: document.getElementById('set-color').value });
    await S.refresh();
    toast('Perfil guardado', '', 'success');
  });
  document.querySelectorAll('[data-share-circle]').forEach((input) => input.addEventListener('change', async () => {
    await api(`/api/circles/${input.dataset.shareCircle}/sharing`, { method: 'PATCH', body: { sharing: input.checked } });
    if (input.checked) S.startGeolocation();
    else S.stopGeolocation();
    await S.refresh();
    toast(input.checked ? 'Ubicación compartida' : 'Ubicación en pausa', '', 'success');
  }));
  document.getElementById('set-crash').addEventListener('change', (e) => patch({ settings: { crashDetection: e.target.checked } }));
  document.getElementById('set-battery').addEventListener('change', (e) => patch({ settings: { lowBatteryAlerts: e.target.checked } }));
  document.getElementById('set-speed').addEventListener('change', (e) => patch({ settings: { speedLimitKmh: Number(e.target.value) || 50 } }));
  document.getElementById('set-notif-perm').addEventListener('click', async () => {
    if (!('Notification' in window)) return toast('No disponible', 'Este navegador no admite notificaciones.', 'warning');
    const perm = await Notification.requestPermission();
    toast(perm === 'granted' ? 'Notificaciones activadas' : 'Permiso no concedido', '', perm === 'granted' ? 'success' : 'warning');
  });
  document.getElementById('set-export').addEventListener('click', async () => {
    try {
      const res = await fetch(apiUrl('/api/me/export'), { headers: { Authorization: `Bearer ${S.token}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'trobemmos-mis-datos.json'; a.click();
      URL.revokeObjectURL(url);
      toast('Datos exportados', '', 'success');
    } catch { toast('No se pudo exportar', '', 'critical'); }
  });
  document.getElementById('set-logout').addEventListener('click', () => S.logout());
  document.getElementById('set-delete').addEventListener('click', () => {
    confirmModal('Eliminar cuenta', 'Se borrarán tu perfil, ubicaciones, viajes y mensajes. Esta acción no se puede deshacer.', async () => {
      await api('/api/me', { method: 'DELETE' });
      S.logout();
    }, { danger: true, confirmText: 'Eliminar definitivamente' });
  });
}

/* ================================================================== */
/* PLAN / TODO INCLUIDO                                               */
/* ================================================================== */

function renderPlan() {
  const caps = S.capabilities || { features: [], plan: 'Todo incluido · Gratis', notice: '', limitations: [] };
  const groups = [...new Set(caps.features.map((f) => f.group))];
  return `<div class="page" style="max-width:960px">
    ${pageHead('Todo incluido, gratis', 'Cada función disponible desde el primer minuto')}
    <div class="card card-pad" style="background:linear-gradient(135deg,#111a35,#273b78);color:#fff;border:0;margin-bottom:20px;padding:26px">
      <span class="eyebrow" style="color:#9fb0e6">Plan único</span>
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:8px 0"><h1 style="font-size:36px;margin:0;letter-spacing:-1px">${esc(caps.plan)}</h1><span style="font-size:22px;font-weight:800;color:#7ce0c6">0 € / mes</span></div>
      <p style="color:#c3cce6;max-width:620px;line-height:1.6;margin:0">Sin niveles Silver ni Gold, sin pruebas caducadas, sin anuncios y sin compras en la aplicación. ${caps.features.length} funciones activadas para todos los miembros de tu círculo.</p>
      <div class="chips" style="margin-top:18px"><span class="pill" style="background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:#fff">${icon('check', 13)} Sin tarjeta</span><span class="pill" style="background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:#fff">${icon('check', 13)} Sin límites</span><span class="pill" style="background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:#fff">${icon('check', 13)} Código abierto</span></div>
    </div>
    ${groups.map((g) => `<div class="feature-group">${esc(g)}</div><div class="feature-grid">${caps.features.filter((f) => f.group === g).map((f) => `<div class="card feature-card"><span class="check">${icon('check', 14)}</span><div><b>${esc(f.name)}</b><span>${esc(f.detail)}</span></div></div>`).join('')}</div>`).join('')}
    <div class="grid-2" style="margin-top:22px">
      <div class="card card-pad"><h3 style="margin:0 0 10px;font-size:15px">Independencia y transparencia</h3><p class="small muted" style="line-height:1.65;margin:0">${esc(caps.notice)} Las funciones de pago se han implementado como software propio, sin eludir suscripciones de terceros ni acceder a sus servicios.</p></div>
      <div class="card card-pad"><h3 style="margin:0 0 10px;font-size:15px">Limitaciones honestas</h3><ul class="small muted" style="line-height:1.7;padding-left:18px;margin:0">${(caps.limitations || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
    </div>
  </div>`;
}

/* ================================================================== */
/* Despacho                                                           */
/* ================================================================== */

export function renderView(view) {
  switch (view) {
    case 'historial': return renderHistorial();
    case 'lugares': return renderLugares();
    case 'chat': return renderChat();
    case 'conduccion': return renderConduccion();
    case 'seguridad': return renderSeguridad();
    case 'ajustes': return renderAjustes();
    case 'plan': return renderPlan();
    default: return renderMapa();
  }
}

export function mountView(view) {
  switch (view) {
    case 'historial': return mountHistorial();
    case 'lugares': return mountLugares();
    case 'chat': return mountChat();
    case 'conduccion': return mountConduccion();
    case 'seguridad': return mountSeguridad();
    case 'ajustes': return mountAjustes();
    case 'plan': S.mapCtl = null; S.afterRefresh = () => {}; return;
    default: return mountMapa();
  }
}
