// Trobemmos — arranque, shell, tiempo real, geolocalización y acciones globales.
import {
  S, api, esc, icon, toast, openModal, closeModal, confirmModal, navigate,
  setToken, setCircleId, timeAgo, timeHM, dateShort, copyText, browserNotify,
  eventIcon, avatarHtml,
} from './ctx.js';
import { NAV_ITEMS, renderView, mountView, memberCardsHtml } from './views.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const VALID_VIEWS = new Set(NAV_ITEMS.map((n) => n.id));
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};

/* ================================================================== */
/* Arranque                                                           */
/* ================================================================== */

async function boot() {
  bindAuth();
  bindShell();
  window.addEventListener('hashchange', onHashChange);
  try {
    const caps = await api('/api/capabilities', { silent: true });
    S.capabilities = caps;
    const list = $('#auth-features');
    if (list) list.innerHTML = caps.features.slice(0, 8).map((f) => `<li><span>✓</span>${esc(f.name)}</li>`).join('');
  } catch {}
  if (S.token) {
    try { await initApp(); }
    catch (e) { console.warn('Sesión no válida', e.message); setToken(null); showAuth(); }
  } else showAuth();
}

function showAuth() {
  $('#auth').classList.remove('hidden');
  $('#app').classList.add('hidden');
}
function showApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

async function initApp() {
  const me = await api('/api/me', { silent: true });
  S.user = me.user;
  S.circles = me.circles || [];
  S.demo = Boolean(me.user.isDemo);
  window.__trobemmosMeId = me.user.id;
  if (!S.capabilities) S.capabilities = await api('/api/capabilities', { silent: true });
  if (!S.circles.length) {
    const { circle } = await api('/api/circles', { method: 'POST', body: { name: 'Mi círculo' }, silent: true });
    S.circles = [circle];
    setCircleId(circle.id);
  }
  if (!S.circles.some((c) => c.id === S.circleId)) setCircleId(S.circles[0].id);
  showApp();
  renderShell();
  S.booted = false;
  await S.refresh();
  S.booted = true;
  const fromHash = location.hash.replace('#/', '');
  S.view = VALID_VIEWS.has(fromHash) ? fromHash : 'mapa';
  S.renderCurrent();
  connectRealtime();
  initDeviceSignals();
  updateHeader();
}

S.onUnauthorized = () => {
  if (!$('#app').classList.contains('hidden')) {
    toast('Sesión caducada', 'Vuelve a iniciar sesión.', 'warning');
    logout(true);
  }
};

/* ================================================================== */
/* Shell                                                              */
/* ================================================================== */

function renderShell() {
  $('#nav').innerHTML = NAV_ITEMS.map((n) => `<button class="nav-item" data-nav="${n.id}">${icon(n.icon, 18)}<span>${esc(n.label)}</span></button>`).join('');
  $('#mobile-nav').innerHTML = NAV_ITEMS.slice(0, 5).map((n) => `<button data-nav="${n.id}">${icon(n.icon, 19)}<span>${esc(n.label)}</span></button>`).join('')
    + `<button id="mobile-more">${icon('menu', 19)}<span>Más</span></button>`;
  $('#sidebar-plan').innerHTML = `<b>${icon('star', 15)} Todo incluido · 0 €</b>
    <p>Sin suscripciones ni funciones bloqueadas. Todas las herramientas están activas.</p>
    <button class="btn btn-sm" data-nav="plan">Ver el plan</button>`;
  $('#sidebar-user').innerHTML = `${avatarHtml(S.user)}<div class="who"><b>${esc(S.user.name)}</b><span>${S.demo ? 'Cuenta de demostración' : 'Mi cuenta'}</span></div>
    <button class="icon-btn" id="sidebar-logout" style="margin-left:auto;background:transparent;border-color:rgba(255,255,255,.14);color:#a6b1d1">${icon('logout', 15)}</button>`;
  $('#avatar-btn').innerHTML = esc(S.user.emoji || '🙂');
  $('#avatar-btn').style.background = S.user.color || '#5b6ef5';
  updateHeader();
}

function bindShell() {
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { navigate(nav.dataset.nav); $('#sidebar').classList.remove('open'); return; }
    if (e.target.closest('#mobile-menu')) { $('#sidebar').classList.toggle('open'); return; }
    if (e.target.closest('#mobile-more')) { $('#sidebar').classList.add('open'); return; }
    if (e.target.closest('#sidebar-logout')) { logout(); return; }
    if (e.target.closest('#avatar-btn')) { navigate('ajustes'); return; }
    if (e.target.closest('#bell-btn')) { toggleDrawer(); return; }
    if (e.target.closest('#sos-mini')) {
      confirmModal('Enviar alerta SOS', 'Se avisará a tu círculo con tu última ubicación. ¿Continuar?', () => S.sendSos(), { danger: true, confirmText: 'Enviar SOS' });
      return;
    }
    if (e.target.closest('#circle-btn')) { S.openCircleModal(); return; }
    if (e.target.closest('#drawer-close') || e.target.closest('#drawer-backdrop')) { closeDrawer(); return; }
    if (e.target.closest('#mark-all-read')) {
      api('/api/events/read', { method: 'POST', body: { all: true } }).then(async () => { await S.refresh(); renderDrawer(); }).catch(() => {});
    }
  });
}

function updateHeader() {
  const cs = $('#circle-select');
  if (cs) {
    const c = S.circles.find((x) => x.id === S.circleId) || S.circle;
    cs.innerHTML = `<button class="circle-btn" id="circle-btn"><span class="circle-icon">${icon('users', 16)}</span><span>${esc(c?.name || 'Sin círculo')}</span>${icon('down', 14)}</button>
      ${c?.code ? `<button class="invite-code" id="invite-code" title="Código de invitación">${esc(c.code)}</button>` : ''}`;
    $('#invite-code')?.addEventListener('click', () => S.openInviteModal());
  }
  const conn = $('#connection-pill');
  if (conn) conn.innerHTML = `<span class="dot"></span>${S.online ? 'En directo' : 'Reconectando'}`;
  if (conn) conn.classList.toggle('offline', !S.online);
  const unread = (S.events || []).filter((e) => !e.read).length;
  const bell = $('#bell-btn');
  if (bell) bell.innerHTML = `${icon('bell', 19)}${unread ? `<span class="badge-dot">${unread > 9 ? '9+' : unread}</span>` : ''}`;
  $$('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === S.view));
  const sbUser = $('#sidebar-user .who b');
  if (sbUser && S.user) sbUser.textContent = S.user.name;
}

function onHashChange() {
  const v = location.hash.replace('#/', '');
  S.view = VALID_VIEWS.has(v) ? v : 'mapa';
  closeDrawer();
  $('#sidebar').classList.remove('open');
  S.renderCurrent();
}

S.renderCurrent = function renderCurrent() {
  S.viewToken += 1;
  if (S.replay?.timer) { clearInterval(S.replay.timer); S.replay.timer = null; }
  if (S.mapCtl?.destroy) { try { S.mapCtl.destroy(); } catch {} }
  if (S._extraMap?.destroy) { try { S._extraMap.destroy(); } catch {} }
  S.mapCtl = null;
  S._extraMap = null;
  const view = $('#view');
  if (!view) return;
  view.classList.toggle('no-scroll', S.view === 'mapa');
  view.innerHTML = renderView(S.view);
  try { mountView(S.view); } catch (e) { console.error('mountView', S.view, e); }
  updateHeader();
};

/* ================================================================== */
/* Datos y tiempo real                                                */
/* ================================================================== */

function ingestEvents(events = []) {
  for (const e of events) {
    if (S.seenEvents.has(e.id)) continue;
    S.seenEvents.add(e.id);
    if (S.booted) {
      const type = e.severity === 'critical' ? 'critical' : e.severity === 'warning' ? 'warning' : 'info';
      toast(e.title, e.body || '', type);
      browserNotify(e.title, e.body || '', e.severity);
    }
  }
  S.events = events;
}

S.refresh = async function refresh() {
  if (!S.circleId) return;
  try {
    const [snap, ev, circles] = await Promise.all([
      api(`/api/circles/${S.circleId}`, { silent: true }),
      api('/api/events?since=0', { silent: true }),
      api('/api/circles', { silent: true }),
    ]);
    S.circle = snap.circle;
    S.circles = circles.circles;
    ingestEvents(ev.events || []);
    updateHeader();
    if (S.drawerOpen) renderDrawerBody();
    S.afterRefresh?.();
  } catch (e) {
    if (e.status === 404) { setCircleId(null); S.openCircleModal(); }
  }
};

let lastRefresh = 0;
let refreshTimeout = null;
function throttledRefresh() {
  const now = Date.now();
  if (now - lastRefresh > 2800) { lastRefresh = now; S.refresh(); }
  else if (!refreshTimeout) {
    refreshTimeout = setTimeout(() => { refreshTimeout = null; lastRefresh = Date.now(); S.refresh(); }, 2800 - (now - lastRefresh));
  }
}

function connectRealtime() {
  if (!S.token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  try { ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(S.token)}`); }
  catch { startPolling(); return; }
  S.ws = ws;
  ws.onopen = () => {
    S.online = true;
    stopPolling();
    updateHeader();
    S.refresh();
  };
  ws.onmessage = (ev) => {
    try { handleRealtime(JSON.parse(ev.data)); } catch (e) { console.warn('ws msg', e); }
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onclose = () => {
    S.online = false;
    updateHeader();
    startPolling();
    if (S.wsRetry) clearTimeout(S.wsRetry);
    S.wsRetry = setTimeout(() => { if (S.token && $('#app').classList.contains('hidden') === false) connectRealtime(); }, 6000);
  };
}

function startPolling() {
  if (!S.pollTimer) S.pollTimer = setInterval(() => S.refresh(), 4500);
}
function stopPolling() {
  if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
}

function handleRealtime(msg) {
  switch (msg.type) {
    case 'location': {
      const m = S.circle?.members?.find((x) => x.id === msg.userId);
      if (m) { m.location = msg.location; m.sharing = true; m.paused = false; }
      if (S.view === 'mapa') {
        S.mapCtl?.setMembers(S.circle?.members || []);
        const cards = $('#member-cards');
        if (cards) cards.innerHTML = memberCardsHtml();
      }
      break;
    }
    case 'event': {
      if (msg.event) {
        ingestEvents([...(S.events || []).filter((e) => e.id !== msg.event.id), { ...msg.event, read: false }]);
        updateHeader();
        if (S.drawerOpen) renderDrawerBody();
      }
      throttledRefresh();
      break;
    }
    case 'message':
      if (msg.message) S.appendChatMessages([msg.message]);
      break;
    case 'sos':
    case 'places':
    case 'circle':
    case 'refresh':
      S.refresh();
      break;
    case 'trip':
      throttledRefresh();
      break;
    default: break;
  }
}

/* ================================================================== */
/* Círculos                                                           */
/* ================================================================== */

S.openCircleModal = function openCircleModal() {
  openModal(`<h3>Mis círculos</h3><p>Cada círculo es un grupo privado. Únete solo con el código que te compartan.</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">${(S.circles || []).map((c) => `<button class="btn btn-outline" style="justify-content:space-between" data-select-circle="${esc(c.id)}"><span>${icon('users', 16)} ${esc(c.name)} · ${c.memberCount} miembros</span><span class="pill ${c.id === S.circleId ? 'pill-indigo' : ''}">${c.id === S.circleId ? 'Actual' : 'Cambiar'}</span></button>`).join('')}</div>
    <div class="divider"></div>
    <div class="field"><label>Crear un círculo nuevo</label><div style="display:flex;gap:8px"><input id="new-circle-name" placeholder="Familia, amigos, equipo…"><button class="btn btn-primary btn-sm" id="create-circle">Crear</button></div></div>
    <div class="field"><label>Unirme con un código</label><div style="display:flex;gap:8px"><input id="join-code" placeholder="Ej. DEMO26" style="text-transform:uppercase"><button class="btn btn-outline btn-sm" id="join-circle">Unirme</button></div></div>`,
  (modal) => {
    $$('[data-select-circle]', modal).forEach((b) => b.addEventListener('click', async () => {
      setCircleId(b.dataset.selectCircle);
      closeModal();
      await S.refresh();
      S.renderCurrent();
    }));
    $('#create-circle', modal).addEventListener('click', async () => {
      const name = $('#new-circle-name', modal).value.trim() || 'Mi círculo';
      const { circle } = await api('/api/circles', { method: 'POST', body: { name } });
      setCircleId(circle.id);
      closeModal();
      await S.refresh();
      S.renderCurrent();
      toast('Círculo creado', name, 'success');
    });
    $('#join-circle', modal).addEventListener('click', async () => {
      const code = $('#join-code', modal).value.trim().toUpperCase();
      if (!code) return;
      try {
        const { circle } = await api('/api/circles/join', { method: 'POST', body: { code } });
        setCircleId(circle.id);
        closeModal();
        await S.refresh();
        S.renderCurrent();
        toast('Te has unido', circle.name, 'success');
      } catch {}
    });
  });
};

S.openInviteModal = function openInviteModal() {
  const c = S.circles.find((x) => x.id === S.circleId) || S.circle;
  if (!c) return;
  const link = `${location.origin}/?circle=${encodeURIComponent(c.code)}`;
  const members = S.circle?.members || [];
  const owner = c.ownerId === S.user?.id;
  openModal(`<h3>Invitar a ${esc(c.name)}</h3><p>Comparte este código. Solo quien lo tenga puede unirse, y cada persona decide si activa su ubicación.</p>
    <div style="text-align:center;background:var(--primary-soft);border-radius:14px;padding:18px;margin-bottom:14px">
      <div class="eyebrow">Código de invitación</div>
      <div style="font-size:30px;font-weight:850;letter-spacing:.22em;margin:6px 0;font-family:ui-monospace,monospace">${esc(c.code)}</div>
      <div class="chips" style="justify-content:center"><button class="btn btn-sm btn-primary" id="copy-code">${icon('copy', 14)} Copiar código</button><button class="btn btn-sm btn-outline" id="copy-link">${icon('share', 14)} Copiar enlace</button></div>
    </div>
    <h3 style="font-size:14px;margin:16px 0 8px">Miembros (${members.length})</h3>
    <div style="max-height:190px;overflow-y:auto">${members.map((m) => `<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--line)">${avatarHtml(m)}<div style="flex:1"><b class="small">${esc(m.name)}</b><div class="tiny muted">${m.membership?.role === 'owner' ? 'Administrador' : 'Miembro'} · ${m.paused ? 'Ubicación en pausa' : 'Compartiendo'}</div></div>
      ${owner && m.id !== S.user.id ? `<button class="btn btn-sm btn-danger" data-remove-member="${esc(m.id)}">${icon('trash', 13)}</button>` : ''}</div>`).join('')}</div>
    ${owner ? `<button class="btn btn-ghost btn-sm" id="regen-code" style="margin-top:12px">${icon('refresh', 14)} Generar código nuevo</button>` : ''}
    <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cerrar</button></div>`,
  (modal) => {
    $('#copy-code', modal).addEventListener('click', () => copyText(c.code));
    $('#copy-link', modal).addEventListener('click', () => copyText(link));
    $('#regen-code', modal)?.addEventListener('click', async () => {
      await api(`/api/circles/${c.id}`, { method: 'PATCH', body: { regenerateCode: true } });
      await S.refresh();
      closeModal();
      S.openInviteModal();
      toast('Código renovado', 'El anterior ya no funciona.', 'success');
    });
    $$('[data-remove-member]', modal).forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/circles/${c.id}/members/${b.dataset.removeMember}`, { method: 'DELETE' });
      await S.refresh();
      closeModal();
      toast('Miembro eliminado', '', 'success');
    }));
  });
};

/* ================================================================== */
/* Notificaciones (drawer)                                            */
/* ================================================================== */

function toggleDrawer() { S.drawerOpen ? closeDrawer() : openDrawer(); }
function openDrawer() {
  S.drawerOpen = true;
  $('#drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
  renderDrawer();
  api('/api/events/read', { method: 'POST', body: { all: true }, silent: true }).then(() => {
    S.events = S.events.map((e) => ({ ...e, read: true }));
    updateHeader();
  }).catch(() => {});
}
function closeDrawer() {
  S.drawerOpen = false;
  $('#drawer').classList.add('hidden');
  $('#drawer-backdrop').classList.add('hidden');
}
function renderDrawer() {
  $('#drawer').innerHTML = `<div class="drawer-head"><h3>Notificaciones</h3><div class="chips"><button class="btn btn-sm btn-ghost" id="mark-all-read">Marcar leídas</button><button class="icon-btn" id="drawer-close">${icon('close', 16)}</button></div></div>
    <div class="chips" style="padding:12px 14px 0" id="drawer-filters">
      <button class="chip active" data-filter="all">Todas</button><button class="chip" data-filter="critical">Seguridad</button><button class="chip" data-filter="places">Lugares</button>
    </div>
    <div class="drawer-body" id="drawer-body"></div>`;
  S.drawerFilter = 'all';
  $('#drawer-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    S.drawerFilter = b.dataset.filter;
    $$('#drawer-filters .chip').forEach((x) => x.classList.toggle('active', x === b));
    renderDrawerBody();
  });
  renderDrawerBody();
}
function renderDrawerBody() {
  const body = $('#drawer-body');
  if (!body) return;
  let events = [...(S.events || [])].sort((a, b) => b.ts - a.ts);
  if (S.drawerFilter === 'critical') events = events.filter((e) => ['sos', 'crash', 'low_battery'].includes(e.type));
  if (S.drawerFilter === 'places') events = events.filter((e) => e.type.startsWith('place_'));
  body.innerHTML = events.length ? events.map((e) => `<div class="event-row ${e.read ? '' : 'unread'}" data-event-type="${esc(e.type)}">
      <div class="event-icon ${e.severity === 'critical' ? 'critical' : e.severity === 'warning' ? 'warning' : ''}">${eventIcon(e.type)}</div>
      <div style="flex:1"><b>${esc(e.title)}</b><p>${esc(e.body || '')}</p><time>${timeAgo(e.ts)} · ${timeHM(e.ts)}</time></div>
    </div>`).join('') : `<div class="empty"><div class="empty-icon">${icon('bell', 22)}</div><b>Sin notificaciones</b><p>Las alertas de lugares, batería y seguridad aparecerán aquí.</p></div>`;
}

/* ================================================================== */
/* Ubicación: consentimiento, GPS y alternativas                      */
/* ================================================================== */

function myMember() { return S.circle?.members?.find((m) => m.id === S.user?.id); }

S.toggleSharing = async function toggleSharing() {
  const on = Boolean(myMember()?.sharing);
  if (on) {
    S.stopGeolocation();
    await api(`/api/circles/${S.circleId}/sharing`, { method: 'PATCH', body: { sharing: false } });
    await S.refresh();
    toast('Ubicación en pausa', 'Tu círculo ya no ve tu posición.', 'success');
    return;
  }
  openModal(`<h3>Compartir mi ubicación</h3>
    <p>Vas a compartir tu posición en tiempo real con los <b>${S.circle?.members?.length || 0} miembros</b> de «${esc(S.circle?.name || '')}». Puedes pausarla cuando quieras desde el mapa o Ajustes. Nadie más fuera del círculo podrá verla.</p>
    <div class="notice">${icon('lock', 16)}<span>El navegador pedirá permiso de ubicación. Si lo rechazas o no está disponible, podrás fijar una posición manualmente para probar la app.</span></div>
    <label class="switch" style="margin:18px 0"><input type="checkbox" id="consent-check"><span class="track"></span><span class="small">Entiendo y quiero compartir mi ubicación con este círculo</span></label>
    <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancelar</button><button class="btn btn-primary" id="consent-accept" disabled>${icon('location', 15)} Activar ubicación</button></div>`,
  (modal) => {
    const check = $('#consent-check', modal);
    const accept = $('#consent-accept', modal);
    check.addEventListener('change', () => { accept.disabled = !check.checked; });
    accept.addEventListener('click', async () => {
      closeModal();
      await api(`/api/circles/${S.circleId}/sharing`, { method: 'PATCH', body: { sharing: true } });
      await S.refresh();
      S.startGeolocation();
      toast('Uso compartido activado', 'Solicitando permiso de ubicación…', 'success');
    });
  });
};

let lastPost = 0;
async function postLocation(sample) {
  const now = Date.now();
  if (now - lastPost < 2200) return;
  lastPost = now;
  try {
    await api(`/api/circles/${S.circleId}/location`, { method: 'POST', body: sample, silent: true });
    S.geoError = null;
    throttledRefresh();
  } catch (e) {
    if (e.status === 403) S.stopGeolocation();
  }
}

S.startGeolocation = function startGeolocation() {
  S.stopGeolocation();
  if (!('geolocation' in navigator)) { locationFallback('Este navegador no ofrece geolocalización.'); return; }
  S.shareOn = true;
  try {
    S.geoWatch = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        postLocation({
          lat: c.latitude, lng: c.longitude, accuracy: Math.round(c.accuracy || 20),
          speed: c.speed != null ? Math.round(c.speed * 3.6) : 0,
          heading: c.heading || 0, battery: S.battery,
          screenActive: Date.now() - S.lastScreenActive < 10000,
          motion: S.lastMotion,
        });
      },
      (err) => {
        if (!S.geoError) {
          S.geoError = err.message;
          toast('No se pudo obtener el GPS', 'Puedes fijar tu posición manualmente.', 'warning');
          locationFallback(err.message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 },
    );
  } catch (e) { locationFallback(e.message); }
};

S.stopGeolocation = function stopGeolocation() {
  if (S.geoWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(S.geoWatch);
  S.geoWatch = null;
  S.shareOn = false;
};

function locationFallback(reason) {
  openModal(`<h3>¿Dónde estás?</h3><p>No hemos podido usar el GPS (${esc(reason)}). Puedes colocar tu posición en el mapa o usar una ubicación de ejemplo para probar todas las funciones.</p>
    <div class="chips" style="margin-bottom:16px"><button class="btn btn-primary" id="fallback-pick">${icon('pin', 15)} Elegir en el mapa</button>
      <button class="btn btn-outline" id="fallback-demo">${icon('globe', 15)} Usar Madrid (ejemplo)</button></div>
    <div class="notice">${icon('info', 16)}<span>Las posiciones manuales se etiquetan como tales y solo se comparten con tu círculo mientras el uso compartido esté activo.</span></div>
    <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Ahora no</button></div>`, (modal) => {
    $('#fallback-demo', modal).addEventListener('click', async () => {
      closeModal();
      await postManualLocation(40.4203, -3.7065);
    });
    $('#fallback-pick', modal).addEventListener('click', () => {
      closeModal();
      navigate('mapa');
      setTimeout(() => {
        if (!S.mapCtl) return;
        toast('Haz clic en el mapa', 'Colocaremos tu posición donde pulses.', 'info');
        S.mapCtl.setPickMode(true);
        S.mapCtl.map.once('click', async (e) => {
          S.mapCtl.setPickMode(false);
          await postManualLocation(e.latlng.lat, e.latlng.lng);
        });
      }, 260);
    });
  });
}

async function postManualLocation(lat, lng) {
  if (!myMember()?.sharing) {
    await api(`/api/circles/${S.circleId}/sharing`, { method: 'PATCH', body: { sharing: true } });
    await S.refresh();
  }
  await postLocation({ lat, lng, accuracy: 15, speed: 0, battery: S.battery, source: 'manual' });
  await S.refresh();
  toast('Posición actualizada', 'Tu círculo ya puede verte en el mapa.', 'success');
}

S.pinMyLocation = function pinMyLocation() {
  openModal(`<h3>Fijar mi posición</h3><p>Útil si el GPS no está disponible o quieres probar las alertas de lugares sin moverte.</p>
    <div class="chips" style="margin-bottom:16px"><button class="btn btn-primary" id="pin-pick">${icon('pin', 15)} Elegir en el mapa</button>
      <button class="btn btn-outline" id="pin-demo">${icon('globe', 15)} Casa (ejemplo)</button></div>
    <div class="notice">${icon('lock', 16)}<span>Al fijar la posición se activará el uso compartido en este círculo si aún no lo estaba. Puedes pausarlo en cualquier momento.</span></div>
    <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancelar</button></div>`, (modal) => {
    $('#pin-demo', modal).addEventListener('click', async () => { closeModal(); await postManualLocation(40.4203, -3.7065); });
    $('#pin-pick', modal).addEventListener('click', () => {
      closeModal();
      if (S.view !== 'mapa') navigate('mapa');
      setTimeout(() => {
        toast('Haz clic en el mapa', 'Tu nueva posición se guardará ahí.', 'info');
        S.mapCtl?.setPickMode(true);
        S.mapCtl?.map.once('click', async (e) => {
          S.mapCtl.setPickMode(false);
          await postManualLocation(e.latlng.lat, e.latlng.lng);
        });
      }, 280);
    });
  });
};

function initDeviceSignals() {
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { S.lastScreenActive = Date.now(); }, { passive: true }));
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      S.battery = Math.round(b.level * 100);
      b.addEventListener('levelchange', () => { S.battery = Math.round(b.level * 100); });
    }).catch(() => {});
  }
  if (window.DeviceMotionEvent) {
    window.addEventListener('devicemotion', (e) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      const g = Math.hypot(a.x || 0, a.y || 0, a.z || 0) / 9.81;
      S.lastMotion = { impactG: Math.round(g * 100) / 100, ts: Date.now() };
    }, { passive: true });
  }
}

/* ================================================================== */
/* SOS y sesión                                                       */
/* ================================================================== */

S.sendSos = async function sendSos() {
  const loc = myMember()?.location;
  try {
    await api(`/api/circles/${S.circleId}/sos`, {
      method: 'POST',
      body: { lat: loc?.lat, lng: loc?.lng, accuracy: loc?.accuracy, note: 'Alerta enviada desde Trobemmos' },
    });
    toast('Alerta SOS enviada', 'Tu círculo ha sido avisado.', 'critical', 8000);
    await S.refresh();
    navigate('seguridad');
  } catch (e) { toast('No se pudo enviar el SOS', e.message, 'critical'); }
};

async function logout(silent = false) {
  S.stopGeolocation();
  stopPolling();
  if (S.wsRetry) clearTimeout(S.wsRetry);
  try { S.ws?.close(); } catch {}
  S.ws = null;
  S.online = false;
  if (!silent) await api('/api/auth/logout', { method: 'POST', body: {}, silent: true }).catch(() => {});
  setToken(null);
  S.user = null;
  S.circle = null;
  S.events = [];
  S.seenEvents.clear();
  S.booted = false;
  closeDrawer();
  closeModal();
  location.hash = '';
  showAuth();
}
S.logout = logout;

/* ================================================================== */
/* Acceso                                                             */
/* ================================================================== */

function bindAuth() {
  let mode = 'login';
  $$('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
    mode = tab.dataset.authTab;
    $$('[data-auth-tab]').forEach((t) => t.classList.toggle('active', t === tab));
    $('#field-name').hidden = mode !== 'register';
    $('#auth-submit').textContent = mode === 'register' ? 'Crear cuenta y entrar' : 'Entrar';
    $('#auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('#auth-error').hidden = true;
  }));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#auth-error');
    err.hidden = true;
    const body = {
      email: $('#auth-email').value.trim(),
      password: $('#auth-password').value,
      name: $('#auth-name').value.trim(),
    };
    try {
      const res = await api(`/api/auth/${mode}`, { method: 'POST', body, silent: true });
      afterAuth(res);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  $('#demo-btn').addEventListener('click', async () => {
    const btn = $('#demo-btn');
    btn.disabled = true;
    btn.textContent = 'Preparando la demo…';
    try {
      const res = await api('/api/auth/demo', { method: 'POST', body: {}, silent: true });
      afterAuth(res);
      setTimeout(() => toast('Modo demostración', 'Los otros miembros son simulados y se mueven en tiempo real.', 'success', 7000), 700);
    } catch (ex) {
      const err = $('#auth-error');
      err.textContent = ex.message;
      err.hidden = false;
    } finally { btn.disabled = false; btn.innerHTML = '<span class="demo-dot"></span> Explorar la demo interactiva'; }
  });
  // Enlace de invitación ?circle=CODIGO
  const params = new URLSearchParams(location.search);
  if (params.get('circle')) {
    $('#auth-email').value = '';
    session.set('trobemmos_join_code', params.get('circle').toUpperCase());
  }
}

async function afterAuth(res) {
  setToken(res.token);
  S.demo = Boolean(res.demo);
  S.user = res.user;
  S.circles = [];
  setCircleId(null);
  try { await initApp(); }
  catch (e) {
    console.error(e);
    setToken(null);
    showAuth();
    return;
  }
  const code = session.get('trobemmos_join_code');
  if (code) {
    session.del('trobemmos_join_code');
    try {
      const { circle } = await api('/api/circles/join', { method: 'POST', body: { code } });
      setCircleId(circle.id);
      await S.refresh();
      S.renderCurrent();
      toast('Te has unido al círculo', circle.name, 'success');
    } catch {}
  }
}

boot();
