// Estado compartido, cliente HTTP y utilidades de interfaz.
import { icon, EMOJIS, PLACE_EMOJIS } from './icons.js';

export { icon, EMOJIS, PLACE_EMOJIS };

// El almacenamiento puede estar bloqueado (iframe, modo privado): nunca debe
// impedir que arranque la app.
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export const S = {
  token: storage.get('trobemmos_token') || null,
  user: null,
  demo: false,
  circles: [],
  circleId: storage.get('trobemmos_circle') || null,
  circle: null,
  capabilities: null,
  events: [],
  seenEvents: new Set(),
  view: 'mapa',
  viewToken: 0,
  online: false,
  mapCtl: null,
  basemap: 'atlas',
  ws: null,
  wsRetry: null,
  pollTimer: null,
  refreshTimer: null,
  afterRefresh: () => {},
  renderCurrent: () => {},
  refresh: async () => {},
  toggleSharing: () => {},
  openCircleModal: () => {},
  openInviteModal: () => {},
  sendSos: () => {},
  actions: {},
  // Vista: historial
  historyDate: null,
  historyUser: 'all',
  historyData: null,
  replay: null,
  // Vista: lugares
  editingPlace: null,
  // Vista: chat
  chatImage: null,
  appendChatMessages: () => {},
  // Vista: conducción
  drivingDays: 7,
  drivingData: null,
  // Ubicación del navegador
  geoWatch: null,
  shareOn: false,
  battery: null,
  lastScreenActive: 0,
  lastMotion: null,
  geoError: null,
  // Misc
  drawer: null,
  sosHoldTimer: null,
};

S.historyDate = new Date().toLocaleDateString('sv-SE');

export function setToken(token) {
  S.token = token;
  if (token) storage.set('trobemmos_token', token);
  else storage.del('trobemmos_token');
}

export function setCircleId(id) {
  S.circleId = id;
  if (id) storage.set('trobemmos_circle', id);
  else storage.del('trobemmos_circle');
}

export async function api(path, options = {}) {
  const { method = 'GET', body, silent = false } = options;
  const headers = {};
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    if (res.status === 401 && S.onUnauthorized) S.onUnauthorized();
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    if (!silent) toast('No se pudo completar la acción', err.message, 'critical');
    throw err;
  }
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function timeHM(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
export function dateShort(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}
export function dateLong(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}
export function timeAgo(ts) {
  const d = Math.max(0, Date.now() - ts);
  if (d < 45000) return 'ahora';
  if (d < 3600000) return `hace ${Math.round(d / 60000)} min`;
  if (d < 86400000) return `hace ${Math.round(d / 3600000)} h`;
  if (d < 172800000) return 'ayer';
  return dateShort(ts);
}
export function durationText(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

export function toast(title, body = '', type = 'info', ms = 4800) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const symbol = type === 'critical' ? 'alert' : type === 'warning' ? 'alert' : type === 'success' ? 'check' : 'info';
  el.innerHTML = `<span style="color:var(--primary)">${icon(symbol, 18)}</span><div><b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}</div>`;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; el.style.transition = '.25s'; setTimeout(() => el.remove(), 260); }, ms);
}

export function browserNotify(title, body, severity = 'info') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!S.user?.settings?.notifications) return;
  try { new Notification(title, { body, tag: `trobemmos-${severity}-${Date.now()}` }); } catch {}
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

export function openModal(html, onMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-root"><div class="modal-backdrop" data-close-modal></div><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  root.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  root.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModal));
  if (onMount) onMount(root.querySelector('.modal'));
  return root.querySelector('.modal');
}

export function confirmModal(title, message, onConfirm, { danger = false, confirmText = 'Confirmar' } = {}) {
  openModal(`<h3>${esc(title)}</h3><p>${esc(message)}</p>
    <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancelar</button>
    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-yes">${esc(confirmText)}</button></div>`,
  (m) => {
    m.querySelector('#confirm-yes').addEventListener('click', async () => {
      closeModal();
      await onConfirm();
    });
  });
}

export function navigate(view) {
  if (location.hash === `#/${view}`) { S.view = view; S.renderCurrent(); return; }
  location.hash = `#/${view}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado al portapapeles', text, 'success');
  } catch {
    toast('Copia manual', text, 'info', 8000);
  }
}

export function eventIcon(type) {
  if (type === 'sos' || type === 'crash') return '🆘';
  if (type === 'low_battery') return '🔋';
  if (type === 'place_entry') return '📍';
  if (type === 'place_exit') return '↗️';
  if (type === 'speeding') return '⚡';
  if (type === 'member_joined') return '👋';
  if (type === 'crash_cancelled') return '✅';
  return '🔔';
}

export function avatarHtml(user, cls = '') {
  const color = user?.color || '#5b6ef5';
  return `<span class="avatar ${cls}" style="background:${esc(color)}">${esc(user?.emoji || '🙂')}</span>`;
}
