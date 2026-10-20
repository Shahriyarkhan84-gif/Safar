/* ===== Safar shared core: used by both Safar Rides and Safar X ===== */
const SB_URL = 'https://uprrsqqnnvpjevoujxmk.supabase.co';
const SB_KEY = 'sb_publishable_eMwkhTp9QRaT2s6YM03kHg_ZSG4u3uN';
const PX_PER_MILE = 40 / 0.7, FEE = 0.25, SIM_AFTER = 22000, REQ_WINDOW = 20000, POLL_MS = 2500;
const FARE = { base: 2.5, mile: 1.25, min: 0.2, minimum: 5 };
const PLACES = {
  home: { name: '14 Elm Street', area: 'Leeds LS6 2AB', x: 280, y: 200 }, station: { name: 'Leeds Station', area: 'New Station St, Leeds LS1 4DY', x: 160, y: 120 },
  trinity: { name: 'Trinity Leeds', area: 'Albion St, Leeds LS1 5AT', x: 200, y: 80 }, uni: { name: 'University of Leeds', area: 'Woodhouse Ln, Leeds LS2 9JT', x: 120, y: 40 },
  headingley: { name: 'Headingley Stadium', area: "St Michael's Ln, Leeds LS6 3BR", x: 40, y: 40 }, kirkstall: { name: 'Kirkstall Abbey', area: 'Abbey Rd, Leeds LS5 3EH', x: 40, y: 160 },
  roundhay: { name: 'Roundhay Park', area: 'Mansion Ln, Leeds LS8 2HH', x: 320, y: 40 }, whiterose: { name: 'White Rose Centre', area: 'Dewsbury Rd, Leeds LS11 8LU', x: 120, y: 240 }
};
const TYPES = {
  go: { name: 'Safar Go', seats: 4, mult: 1, blurb: 'Everyday rides' },
  green: { name: 'Safar Green', seats: 4, mult: 1.1, blurb: 'Fully electric cars', promo: 0.1 },
  comfort: { name: 'Comfort', seats: 4, mult: 1.35, blurb: 'Newer cars, more legroom' },
  xl: { name: 'Safar XL', seats: 6, mult: 1.65, blurb: 'Groups and luggage' }
};
const SIM = [
  { name: 'Ayesha Malik', car: 'Toyota Prius', colour: 'White', plate: 'YK70 TFR', rating: 4.95, types: ['go'], pos: { x: 200, y: 160 } },
  { name: 'Tom Brennan', car: 'Škoda Octavia', colour: 'Grey', plate: 'LS19 KJD', rating: 4.88, types: ['go', 'comfort'], pos: { x: 80, y: 80 } },
  { name: 'Imran Shah', car: 'Kia Niro EV', colour: 'Blue', plate: 'YB22 NWA', rating: 4.91, types: ['go', 'green'], pos: { x: 240, y: 40 } },
  { name: 'Grace Okafor', car: 'Ford Galaxy', colour: 'Black', plate: 'LN68 XLG', rating: 4.97, types: ['go', 'xl'], pos: { x: 40, y: 200 } }
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

/* ---------- geometry & pricing ---------- */
const path = (a, b) => [a, { x: b.x, y: a.y }, b];
function len(p) { let d = 0; for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return d; }
function pointAt(p, t) {
  let goal = Math.min(1, Math.max(0, t)) * len(p);
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    if (goal <= d || i === p.length - 1) { const f = d ? Math.min(1, goal / d) : 1; return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * f, y: p[i - 1].y + (p[i].y - p[i - 1].y) * f, a: d ? Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x) * 180 / Math.PI : 0 }; }
    goal -= d;
  }
  const e = p[p.length - 1]; return { x: e.x, y: e.y, a: 0 };
}
function fareFor(from, to, type) {
  const miles = len(path(PLACES[from], PLACES[to])) / PX_PER_MILE, mins = Math.round(miles * 3.2 + 3), m = TYPES[type].mult;
  const parts = { base: FARE.base * m, dist: FARE.mile * miles * m, time: FARE.min * mins * m };
  const full = Math.max(parts.base + parts.dist + parts.time, FARE.minimum * m), off = TYPES[type].promo ? full * TYPES[type].promo : 0;
  if (off) parts.promo = -off;
  return { miles, mins, parts, full: Math.round(full * 100) / 100, fare: Math.round((full - off) * 100) / 100 };
}
const minsBetween = (a, b) => Math.max(1, Math.round(len(path(a, b)) / PX_PER_MILE * 3 + 1));
const nearestSim = (pt, type) => SIM.filter(d => d.types.includes(type)).sort((a, b) => len(path(a.pos, pt)) - len(path(b.pos, pt)))[0];

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
  if (ph === 'arriving') return pointAt(path(t.start, A), progress(t, now));
  if (ph === 'arrived') return { ...A, a: 0 };
  if (ph === 'ontrip') return pointAt(path(A, B), progress(t, now));
  return { ...B, a: 0 };
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
const LOGO_R = `<svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="14" fill="#2347e0"/><path d="M8 19 C 11 9, 19 21, 22 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="22" cy="11" r="2.6" fill="#f5b301"/></svg>`;
const LOGO_X = `<svg viewBox="0 0 30 30" aria-hidden="true"><rect x="1" y="1" width="28" height="28" rx="8" fill="#f5b301"/><path d="M9 9 L21 21 M21 9 L9 21" stroke="#161105" stroke-width="3.4" stroke-linecap="round"/></svg>`;
const carIcon = type => { const c = type === 'green' ? 'var(--ok)' : type === 'comfort' ? 'var(--muted)' : 'var(--car)'; const w = type === 'xl' ? 48 : 44; return `<svg viewBox="0 0 52 30" aria-hidden="true"><rect x="2" y="12" width="${w}" height="11" rx="4" fill="${c}"/><path d="M10 12 L16 5 H${type === 'xl' ? 40 : 32} L${type === 'xl' ? 46 : 40} 12 Z" fill="${c}" opacity=".75"/><circle cx="12" cy="23" r="4" fill="var(--surface)" stroke="var(--car)" stroke-width="2"/><circle cx="${w - 8}" cy="23" r="4" fill="var(--surface)" stroke="var(--car)" stroke-width="2"/></svg>`; };
function mapSVG(o) {
  const A = o.from && PLACES[o.from], B = o.to && PLACES[o.to];
  let streets = '';
  for (let x = 0; x <= 360; x += 40) streets += `<line x1="${x}" y1="-10" x2="${x}" y2="270"/>`;
  for (let y = 0; y <= 260; y += 40) streets += `<line x1="-10" y1="${y}" x2="370" y2="${y}"/>`;
  const labels = Object.entries(PLACES).map(([k, p]) => {
    const hot = k === o.from || k === o.to, anchor = p.x > 300 ? 'end' : p.x < 60 ? 'start' : 'middle';
    return `${hot ? '' : `<circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--muted)"/>`}<text class="lbl ${hot ? 'hot' : ''}" x="${p.x}" y="${p.y - 9}" text-anchor="${anchor}">${esc(p.name)}</text>`;
  }).join('');
  const car = (c, mine) => `<g ${c.id ? `data-car="${c.id}"` : ''} transform="translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${(c.a || 0).toFixed(0)})">${mine ? '<circle r="15" fill="var(--accent)" opacity=".2"/>' : ''}<rect x="-8" y="-5" width="16" height="10" rx="3.5" fill="${mine ? 'var(--accent)' : 'var(--car)'}" stroke="var(--surface)" stroke-width="1.5"/><rect x="0" y="-3.6" width="4.5" height="7.2" rx="1.4" fill="var(--surface)" opacity=".75"/></g>`;
  return `<svg class="map" viewBox="-10 -10 380 280" role="img" aria-label="Map of Leeds${A && B ? ' with the route from ' + esc(A.name) + ' to ' + esc(B.name) : ''}">
    <rect x="-10" y="-10" width="380" height="280" fill="var(--ground)"/>
    <rect x="286" y="6" width="74" height="50" rx="10" fill="var(--park)"/><rect x="-4" y="124" width="58" height="52" rx="10" fill="var(--park)"/>
    <path d="M-10 100 C 60 90, 110 112, 170 100 S 290 92, 370 104" fill="none" stroke="var(--water)" stroke-width="9" stroke-linecap="round"/>
    <g stroke="var(--road)" stroke-width="8" stroke-linecap="round">${streets}</g>
    ${o.approach && A ? `<polyline points="${path(o.approach, A).map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-dasharray="1 7" stroke-linecap="round"/>` : ''}
    ${A && B ? `<polyline points="${path(A, B).map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${labels}
    ${A ? `<g transform="translate(${A.x} ${A.y})"><circle r="9" fill="var(--accent)"/><circle r="3.5" fill="var(--surface)"/></g>` : ''}
    ${B ? `<g transform="translate(${B.x} ${B.y})"><rect x="-8" y="-8" width="16" height="16" fill="var(--ink)"/><rect x="-3" y="-3" width="6" height="6" fill="var(--surface)"/></g>` : ''}
    ${(o.cars || []).map(c => car(c, false)).join('')}${o.mine ? car(o.mine, true) : ''}
  </svg>`;
}

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
function heroArt(o) {
  const cars = Array.from({ length: 12 }, (_, i) => {
    const a = i * 30, r = 98, x = 160 + r * Math.sin(a * Math.PI / 180), y = 130 - r * Math.cos(a * Math.PI / 180);
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a})"><rect x="-18" y="-9.5" width="36" height="19" rx="8" fill="${o.car}" stroke="${o.carEdge}" stroke-width="1.2"/><rect x="3" y="-7.5" width="8" height="15" rx="2.5" fill="${o.glass}"/><rect x="-12" y="-7" width="6" height="14" rx="2" fill="${o.glass}"/><rect x="-18" y="-7.5" width="2.6" height="4" rx="1" fill="${o.light}"/><rect x="-18" y="3.5" width="2.6" height="4" rx="1" fill="${o.light}"/></g>`;
  }).join('');
  const pts = Array.from({ length: 24 }, (_, i) => { const a = i * 15 * Math.PI / 180, r = i % 2 ? 46 : 53; return `${(160 + r * Math.sin(a)).toFixed(1)},${(130 - r * Math.cos(a)).toFixed(1)}`; }).join(' ');
  return `<svg class="heroart" viewBox="0 0 320 260" role="img" aria-label="${esc(o.label)}"><rect width="320" height="260" fill="${o.bg}"/>${cars}<polygon points="${pts}" fill="${o.badge}" stroke="${o.bg}" stroke-width="8" stroke-linejoin="round"/>${o.center}</svg>`;
}
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
    body = `${heroArt(o.art)}<div class="authbody"><h1 class="authh big">${o.headline}</h1>
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
