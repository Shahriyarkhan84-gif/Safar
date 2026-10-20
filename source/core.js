/* ===== Safar shared core: used by both Safar Rides and Safar X ===== */
const SB_URL = 'https://uprrsqqnnvpjevoujxmk.supabase.co';
const SB_KEY = 'sb_publishable_eMwkhTp9QRaT2s6YM03kHg_ZSG4u3uN';
const FEE = 0.25, SIM_AFTER = 22000, REQ_WINDOW = 20000, POLL_MS = 2500;
const FARE = { base: 2.5, mile: 1.25, min: 0.2, minimum: 5 };
const CITY = { lat: 53.7997, lng: -1.5492 };
const PLACES = {
  home: { name: '14 Elm Street', area: 'Hyde Park, Leeds LS6', lat: 53.8128, lng: -1.5640 }, station: { name: 'Leeds Station', area: 'New Station St, Leeds LS1 4DY', lat: 53.7950, lng: -1.5476 },
  trinity: { name: 'Trinity Leeds', area: 'Albion St, Leeds LS1 5AT', lat: 53.7963, lng: -1.5440 }, uni: { name: 'University of Leeds', area: 'Woodhouse Ln, Leeds LS2 9JT', lat: 53.8067, lng: -1.5550 },
  headingley: { name: 'Headingley Stadium', area: "St Michael's Ln, Leeds LS6 3BR", lat: 53.8170, lng: -1.5820 }, kirkstall: { name: 'Kirkstall Abbey', area: 'Abbey Rd, Leeds LS5 3EH', lat: 53.8203, lng: -1.6066 },
  roundhay: { name: 'Roundhay Park', area: 'Mansion Ln, Leeds LS8 2HH', lat: 53.8390, lng: -1.4970 }, whiterose: { name: 'White Rose Centre', area: 'Dewsbury Rd, Leeds LS11 8LU', lat: 53.7590, lng: -1.5770 }
};
const TYPES = {
  go: { name: 'Safar Go', seats: 4, mult: 1, blurb: 'Everyday rides' },
  green: { name: 'Safar Green', seats: 4, mult: 1.1, blurb: 'Fully electric cars', promo: 0.1 },
  comfort: { name: 'Comfort', seats: 4, mult: 1.35, blurb: 'Newer cars, more legroom' },
  xl: { name: 'Safar XL', seats: 6, mult: 1.65, blurb: 'Groups and luggage' }
};
const SIM = [
  { name: 'Ayesha Malik', car: 'Toyota Prius', colour: 'White', plate: 'YK70 TFR', rating: 4.95, types: ['go'], pos: { lat: 53.8010, lng: -1.5390 } },
  { name: 'Tom Brennan', car: 'Škoda Octavia', colour: 'Grey', plate: 'LS19 KJD', rating: 4.88, types: ['go', 'comfort'], pos: { lat: 53.8100, lng: -1.5720 } },
  { name: 'Imran Shah', car: 'Kia Niro EV', colour: 'Blue', plate: 'YB22 NWA', rating: 4.91, types: ['go', 'green'], pos: { lat: 53.8240, lng: -1.5250 } },
  { name: 'Grace Okafor', car: 'Ford Galaxy', colour: 'Black', plate: 'LN68 XLG', rating: 4.97, types: ['go', 'xl'], pos: { lat: 53.7760, lng: -1.5650 } }
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '£' + (Math.round(n * 100) / 100).toFixed(2);
const first = n => String(n || '').split(' ')[0];
const initials = n => String(n || '?').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const normPhone = v => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('44')) d = d.slice(2); if (d.startsWith('0')) d = d.slice(1); return /^7\d{9}$/.test(d) ? d : null; };
const showPhone = d => '+44 ' + d.slice(0, 4) + ' ' + d.slice(4);

/* ---------- server ---------- */
class ApiError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }
async function rpc(fn, args) {
  let r;
  try {
    r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
  } catch (e) { throw new ApiError('No connection. Check your internet and try again.', 'network'); }
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (!r.ok) {
    if (j && j.hint === 'session') throw new ApiError(j.message, 'session');
    if (j && (j.code === 'PGRST202' || j.code === '42883' || j.code === '42P01')) throw new ApiError('Safar is still being set up. Try again in a minute.', 'setup');
    if (j && j.code === 'P0001' && j.message) throw new ApiError(j.message, 'rule');
    throw new ApiError('Something went wrong on our side. Try again in a moment.', 'error');
  }
  return j;
}

/* ---------- geometry & pricing: real Leeds coordinates, road routes from OpenStreetMap ---------- */
const rad = d => d * Math.PI / 180;
function hav(a, b) { const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2; return 2 * 3958.8 * Math.asin(Math.sqrt(h)); }
const pt = p => p && p.lat != null ? { lat: +p.lat, lng: +p.lng } : { ...CITY };
const rkey = (a, b) => [a.lat, a.lng, b.lat, b.lng].map(n => (+n).toFixed(4)).join(',');
const ROUTES = LS.get('safar-routes', {}), routeWait = new Set();
function path(a, b) { a = pt(a); b = pt(b); const k = rkey(a, b); if (ROUTES[k]) return ROUTES[k]; fetchRoute(a, b, k); return [a, b]; }
async function fetchRoute(a, b, k) {
  if (routeWait.has(k) || hav(a, b) < 0.02) return; routeWait.add(k);
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`);
    const c = (await r.json()).routes[0].geometry.coordinates;
    if (c.length > 1) {
      ROUTES[k] = c.map(([lng, lat]) => ({ lat: +lat.toFixed(5), lng: +lng.toFixed(5) }));
      const keys = Object.keys(ROUTES); if (keys.length > 80) delete ROUTES[keys[0]];
      LS.set('safar-routes', ROUTES); MAP.key = ''; render();
    }
  } catch (e) {}
}
function len(p) { let d = 0; for (let i = 1; i < p.length; i++) d += hav(p[i - 1], p[i]); return d; }
const roadMiles = (a, b) => { const p = path(a, b); return p.length > 2 ? len(p) : hav(pt(a), pt(b)) * 1.3; };
function pointAt(p, t) {
  let goal = Math.min(1, Math.max(0, t)) * len(p);
  for (let i = 1; i < p.length; i++) {
    const A = p[i - 1], B = p[i], d = hav(A, B);
    if (goal <= d || i === p.length - 1) { const f = d ? Math.min(1, goal / d) : 1; return { lat: A.lat + (B.lat - A.lat) * f, lng: A.lng + (B.lng - A.lng) * f, a: d ? Math.atan2(-(B.lat - A.lat), (B.lng - A.lng) * Math.cos(rad(A.lat))) * 180 / Math.PI : 0 }; }
    goal -= d;
  }
  const e = p[p.length - 1]; return { lat: e.lat, lng: e.lng, a: 0 };
}
function fareFor(from, to, type) {
  const miles = roadMiles(PLACES[from], PLACES[to]), mins = Math.round(miles * 3.2 + 3), m = TYPES[type].mult;
  const parts = { base: FARE.base * m, dist: FARE.mile * miles * m, time: FARE.min * mins * m };
  const full = Math.max(parts.base + parts.dist + parts.time, FARE.minimum * m), off = TYPES[type].promo ? full * TYPES[type].promo : 0;
  if (off) parts.promo = -off;
  return { miles, mins, parts, full: Math.round(full * 100) / 100, fare: Math.round((full - off) * 100) / 100 };
}
const minsBetween = (a, b) => Math.max(1, Math.round(roadMiles(a, b) * 3 + 1));
const nearestSim = (p, type) => SIM.filter(d => d.types.includes(type)).sort((a, b) => hav(a.pos, p) - hav(b.pos, p))[0];

/* ---------- trip phases, derived from timestamps so both phones agree ---------- */
function phase(t, now = Date.now()) {
  if (t.status === 'accepted') return now < t.acceptedAt + t.pickupDur ? 'arriving' : 'arrived';
  if (t.status === 'ontrip') return now < t.startedAt + t.tripDur ? 'ontrip' : 'dropoff';
  return t.status;
}
function progress(t, now = Date.now()) {
  const ph = phase(t, now);
  if (ph === 'arriving') return Math.min(1, (now - t.acceptedAt) / t.pickupDur);
  if (ph === 'ontrip') return Math.min(1, (now - t.startedAt) / t.tripDur);
  return ph === 'searching' ? 0 : 1;
}
function carPos(t, now = Date.now()) {
  const ph = phase(t, now), A = PLACES[t.from], B = PLACES[t.to];
  if (ph === 'arriving') return pointAt(path(t.start && t.start.lat != null ? t.start : A, A), progress(t, now));
  if (ph === 'arrived') return { ...pt(A), a: 0 };
  if (ph === 'ontrip') return pointAt(path(A, B), progress(t, now));
  return { ...pt(B), a: 0 };
}
function etaText(t) {
  const ph = phase(t), p = progress(t);
  if (ph === 'arriving') return `Arriving in ${Math.max(1, Math.ceil((1 - p) * t.pickupMins))} min`;
  if (ph === 'arrived') return 'Waiting at pickup';
  if (ph === 'ontrip') return `${Math.max(1, Math.ceil((1 - p) * t.mins))} min to ${PLACES[t.to].name}`;
  if (ph === 'dropoff') return `Arrived at ${PLACES[t.to].name}`;
  return '';
}

/* ---------- UI pieces ---------- */
function toast(who, text) {
  const box = document.getElementById('toasts'), el = document.createElement('div');
  el.className = 'toast'; el.innerHTML = `<span class="who">${esc(who)}</span><span>${esc(text)}</span>`;
  box.appendChild(el); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 4500);
}
const LOGO_R = `<svg viewBox="0 0 30 30" aria-hidden="true"><rect x="1" y="1" width="28" height="28" rx="9" fill="#e8c07a"/><path d="M8.5 20 C 11 9, 19 21, 21.5 10" fill="none" stroke="#1a1406" stroke-width="2.6" stroke-linecap="round"/><circle cx="8.5" cy="20" r="2.4" fill="#e8c07a" stroke="#1a1406" stroke-width="1.8"/><rect x="19.3" y="7.8" width="4.4" height="4.4" fill="#1a1406"/></svg>`;
const LOGO_X = `<svg viewBox="0 0 30 30" aria-hidden="true"><rect x="1" y="1" width="28" height="28" rx="9" fill="#ff6f59"/><path d="M9.5 9.5 L20.5 20.5 M20.5 9.5 L9.5 20.5" stroke="#0a0d1c" stroke-width="3.4" stroke-linecap="round"/></svg>`;
/* ---------- live map (Leaflet + OpenStreetMap tiles, darkened with a CSS filter). One map is kept alive and moved into each screen's slot. ---------- */
const MAP = { el: null, map: null, layer: null, cars: {}, key: '' };
const mapSlot = (o, cls = '') => `<div class="mapslot ${cls}" data-map="${esc(JSON.stringify(o))}" role="img" aria-label="Map of Leeds"></div>`;
const carHTML = (a, mine) => `<div class="mcar${mine ? ' mine' : ''}" style="transform:rotate(${Math.round(a || 0)}deg)"><svg viewBox="-13 -8 26 16"><rect x="-11" y="-6.5" width="22" height="13" rx="4.5"/><rect x="2.5" y="-5" width="5" height="10" rx="1.6" class="gl"/></svg></div>`;
function mountMap() {
  const slot = document.querySelector('.mapslot'); if (!slot) return;
  if (!window.L) { slot.classList.add('nomap'); slot.textContent = 'Map unavailable offline'; return; }
  if (!MAP.map) {
    MAP.el = document.createElement('div'); MAP.el.className = 'lmap';
    MAP.map = L.map(MAP.el, { zoomControl: false, attributionControl: true, center: [CITY.lat, CITY.lng], zoom: 13 });
    MAP.map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(MAP.map);
    MAP.layer = L.layerGroup().addTo(MAP.map);
  }
  slot.appendChild(MAP.el); MAP.map.invalidateSize({ animate: false });
  const o = JSON.parse(slot.dataset.map), k = JSON.stringify({ ...o, mine: o.mine ? o.mine.id || 'me' : null });
  if (k !== MAP.key) { MAP.key = k; drawMap(o); } else if (o.mine) moveCar(o.mine.id || 'me', o.mine);
}
function drawMap(o) {
  const m = MAP.map, css = getComputedStyle(document.documentElement), accent = css.getPropertyValue('--accent').trim() || '#e8c07a', ink = css.getPropertyValue('--ink').trim() || '#fff';
  MAP.layer.clearLayers(); MAP.cars = {};
  ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom'].forEach(h => m[h][o.still ? 'disable' : 'enable']());
  const A = o.from && PLACES[o.from], B = o.to && PLACES[o.to], pts = [];
  const label = (p, text) => L.marker([p.lat, p.lng], { opacity: 0, interactive: false }).bindTooltip(esc(text), { permanent: true, direction: 'top', className: 'mlabel', offset: [0, -6] }).addTo(MAP.layer);
  if (o.approach && A) { const p = path(o.approach, A); L.polyline(p.map(x => [x.lat, x.lng]), { color: accent, weight: 4, dashArray: '2 8', lineCap: 'round', opacity: .9 }).addTo(MAP.layer); pts.push(...p); }
  if (A && B) { const p = path(A, B); L.polyline(p.map(x => [x.lat, x.lng]), { color: ink, weight: 5, opacity: .95 }).addTo(MAP.layer); pts.push(...p); }
  if (A) { L.circleMarker([A.lat, A.lng], { radius: 7, color: accent, weight: 4, fillColor: '#111', fillOpacity: 1 }).addTo(MAP.layer); label(A, A.name); pts.push(A); }
  if (B) { L.marker([B.lat, B.lng], { icon: L.divIcon({ className: 'mend', iconSize: [14, 14] }), interactive: false }).addTo(MAP.layer); label(B, B.name); pts.push(B); }
  (o.cars || []).forEach(c => L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'mcarwrap', html: carHTML(c.a), iconSize: [26, 26] }), interactive: false }).addTo(MAP.layer));
  if (o.mine) { MAP.cars[o.mine.id || 'me'] = L.marker([o.mine.lat, o.mine.lng], { icon: L.divIcon({ className: 'mcarwrap', html: carHTML(o.mine.a, true), iconSize: [30, 30] }), interactive: false, zIndexOffset: 500 }).addTo(MAP.layer); pts.push(o.mine); }
  if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map(x => [x.lat, x.lng])), { padding: [36, 36], maxZoom: 15, animate: false });
  else m.setView(pts[0] ? [pts[0].lat, pts[0].lng] : [CITY.lat, CITY.lng], o.zoom || 14, { animate: false });
}
function moveCar(id, p) { const mk = MAP.cars[id]; if (!mk) return; mk.setLatLng([p.lat, p.lng]); const el = mk.getElement && mk.getElement(); const c = el && el.querySelector('.mcar'); if (c) c.style.transform = `rotate(${Math.round(p.a || 0)}deg)`; }

/* ---------- account: log in and sign up (shared by both apps) ---------- */
const Account = {
  key: '', app: '', me: null, token: null,
  init(app) { this.app = app; this.key = 'safar-' + app + '-session'; this.token = LS.get(this.key, null); this.me = LS.get(this.key + '-me', null); },
  set(res) { this.token = res.token; this.me = res.account; LS.set(this.key, this.token); LS.set(this.key + '-me', this.me); },
  setMe(me) { this.me = me; LS.set(this.key + '-me', me); },
  clear() { this.token = null; this.me = null; LS.set(this.key, null); LS.set(this.key + '-me', null); },
  async refresh() {
    if (!this.token) return;
    try { this.setMe(await rpc('safar_me', { p_token: this.token, p_app: this.app })); }
    catch (e) { if (e.kind === 'session') { this.clear(); render(true); } }
  }
};
const authUI = { step: 'start', ident: '', kind: 'phone', draft: { name: '', email: '', phone: '', password: '', terms: false }, err: '', busy: false, show: false };
/* progress ring: frac 0..1 */
const ring = (frac, size, o = {}) => `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" stroke="var(--line)" stroke-width="${o.w || 8}"/><circle ${o.attr || ''} cx="50" cy="50" r="44" pathLength="100" stroke="${o.color || 'var(--accent)'}" stroke-width="${o.w || 8}" stroke-dasharray="${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)} 100"/></svg><div class="in">${o.inner || ''}</div></div>`;
function authView(o) {
  const s = authUI, d = s.draft;
  const err = s.err ? `<p class="err" role="alert">${esc(s.err)}</p>` : '';
  const busy = s.busy ? 'disabled' : '';
  const pass = (auto) => `<label class="field"><span>Password</span><span class="tel pw"><input id="au-password" data-auth="password" type="${s.show ? 'text' : 'password'}" autocomplete="${auto}" value="${esc(d.password)}" placeholder="${auto === 'new-password' ? 'At least 8 characters' : 'Your password'}"><button type="button" class="linkbtn" data-act="togglePw">${s.show ? 'Hide' : 'Show'}</button></span></label>`;
  const who = `<div class="idchip"><span>${esc(s.kind === 'phone' && normPhone(s.ident) ? showPhone(normPhone(s.ident)) : s.ident)}</span><button class="linkbtn" data-act="authStep" data-step="start">Change</button></div>`;
  let body;
  if (s.step === 'password') {
    body = `<div class="authbody"><h1 class="authh">Welcome back</h1>${who}${pass('current-password')}${err}
      <button class="btn block authgo" data-act="login" ${busy}>${s.busy ? 'Logging in…' : 'Log in'}</button>
      <p class="small muted">Forgotten your password? Password reset by email is coming soon.</p></div>`;
  } else if (s.step === 'signup') {
    const phoneField = `<label class="field"><span>Mobile number</span><span class="tel"><span>+44</span><input id="au-phone" data-auth="phone" type="tel" inputmode="tel" autocomplete="tel-national" value="${esc(d.phone)}" placeholder="07700 900123"></span></label>`;
    const emailField = `<label class="field"><span>Email</span><input id="au-email" data-auth="email" type="email" autocomplete="email" value="${esc(d.email)}" placeholder="you@example.com"></label>`;
    body = `<div class="authbody">${o.steps ? '<span class="label">Step 1 of 2</span>' : ''}<h1 class="authh">${o.signupTitle}</h1><p class="muted">${o.signupNote}</p>
      <label class="field"><span>Full name</span><input id="au-name" data-auth="name" autocomplete="name" value="${esc(d.name)}" placeholder="${o.namePh}"></label>
      ${s.kind === 'email' ? emailField + phoneField : phoneField + emailField}${pass('new-password')}
      <div class="checks"><label><input type="checkbox" id="au-terms" data-auth="terms" ${d.terms ? 'checked' : ''}>${o.termsText}</label></div>
      ${err}
      <button class="btn block authgo" data-act="signup" ${busy}>${s.busy ? 'Creating your account…' : 'Create account'}</button>
      <p class="small center">Already have an account? <button class="linkbtn" data-act="authStep" data-step="start">Log in</button></p></div>`;
  } else {
    body = `${mapSlot({ still: true, zoom: 13 }, 'hero')}<div class="authbody"><span class="brandmini">${o.logo}${esc(APP_NAME)}</span><h1 class="authh big">${o.headline}</h1>
      <label class="field"><span class="sr">Email or mobile number</span><input id="au-ident" class="identbox" data-ident type="text" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(s.ident)}" placeholder="Enter email or mobile number"></label>
      ${err}
      <button class="btn block authgo" data-act="authContinue" ${busy}>${s.busy ? 'Checking…' : 'Continue'}</button>
      <p class="small muted authfine">${o.fine}</p></div>`;
  }
  return `<main class="authwrap">${body}<p class="foot">${o.other}</p></main>`;
}
const AuthActions = {
  authStep: d => { authUI.step = d.step; authUI.err = ''; render(true); window.scrollTo(0, 0); },
  togglePw: () => { authUI.show = !authUI.show; render(true); },
  authContinue: async () => {
    const raw = (authUI.ident || '').trim(), isEmail = raw.includes('@'), ph = normPhone(raw);
    authUI.err = !raw ? 'Enter your email or mobile number.' : isEmail ? (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) ? 'That email address doesn\'t look right. Check it and try again.' : '') : (!ph ? 'Enter a UK mobile number, for example 07700 900123, or an email.' : '');
    if (authUI.err) { render(true); return; }
    authUI.kind = isEmail ? 'email' : 'phone'; authUI.busy = true; render(true);
    try {
      const r = await rpc('safar_lookup', { p_app: Account.app, p_ident: isEmail ? raw.toLowerCase() : ph });
      authUI.draft.password = '';
      if (r && r.exists) authUI.step = 'password';
      else { authUI.step = 'signup'; if (isEmail) authUI.draft.email = raw.toLowerCase(); else authUI.draft.phone = raw; }
    } catch (e) { authUI.err = e.message; }
    authUI.busy = false; render(true); window.scrollTo(0, 0);
    setTimeout(() => { const f = document.getElementById(authUI.step === 'password' ? 'au-password' : 'au-name'); if (f) f.focus(); }, 50);
  },
  login: async () => {
    const d = authUI.draft, raw = authUI.ident.trim(), ident = authUI.kind === 'email' ? raw.toLowerCase() : normPhone(raw);
    if (!d.password) { authUI.err = 'Enter your password.'; render(true); return; }
    authUI.busy = true; authUI.err = ''; render(true);
    try {
      const r = await rpc('safar_login', { p_app: Account.app, p_phone: ident, p_password: d.password });
      if (r && r.error) authUI.err = r.error; else { Account.set(r); authDone(false); }
    } catch (e) { authUI.err = e.message; }
    authUI.busy = false; render(true);
  },
  signup: async () => {
    const d = authUI.draft, ph = normPhone(d.phone);
    authUI.err = d.name.trim().length < 2 ? 'Enter your full name.' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim()) ? 'Enter a valid email address, for example you@example.com.' : !ph ? 'Enter a UK mobile number, for example 07700 900123.' : d.password.length < 8 ? 'Use a password of at least 8 characters.' : !d.terms ? 'Tick the box to agree to the terms and privacy policy.' : '';
    if (authUI.err) { render(true); return; }
    authUI.busy = true; render(true);
    try { Account.set(await rpc('safar_signup', { p_app: Account.app, p_name: d.name.trim(), p_email: d.email.trim(), p_phone: ph, p_password: d.password })); authDone(true); }
    catch (e) { authUI.err = e.message; }
    authUI.busy = false; render(true);
  },
  logout: async () => {
    const t = Account.token; Account.clear(); authUI.step = 'start'; authUI.draft.password = ''; render(true); window.scrollTo(0, 0);
    if (t) rpc('safar_logout', { p_token: t }).catch(() => {});
  }
};
function authDone(isNew) {
  authUI.err = ''; authUI.step = 'start'; authUI.ident = ''; authUI.draft = { name: '', email: '', phone: '', password: '', terms: false }; authUI.show = false;
  toast(APP_NAME, isNew ? `Welcome to ${APP_NAME}, ${first(Account.me.name)}.` : `Welcome back, ${first(Account.me.name)}.`);
  onLoggedIn();
}

/* ---------- shared wiring ---------- */
let pendingRender = false;
function render(force) {
  const a = document.activeElement;
  if (!force && a && a.closest && a.closest('#app') && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) { pendingRender = true; return; }
  pendingRender = false;
  document.documentElement.classList.toggle('authscreen', !Account.token);
  document.getElementById('app').innerHTML = view();
  lastKey = viewKey();
  mountMap();
}
let lastKey = '';
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) render(); }, 0));
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  e.preventDefault(); const fn = AuthActions[el.dataset.act] || ACTIONS[el.dataset.act]; if (fn) fn(el.dataset);
});
document.addEventListener('input', e => { const t = e.target; if (t.dataset && 'ident' in t.dataset) authUI.ident = t.value; if (t.dataset && t.dataset.auth) authUI.draft[t.dataset.auth] = t.type === 'checkbox' ? t.checked : t.value; });
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.auth === 'terms') authUI.draft.terms = t.checked; });
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.id) return;
  const map = { 'au-ident': 'authContinue', 'au-phone': 'signup', 'au-password': authUI.step === 'password' ? 'login' : 'signup', pin: 'start' };
  const act = map[e.target.id]; if (act) { const b = document.querySelector(`[data-act="${act}"]`); if (b) b.click(); }
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
