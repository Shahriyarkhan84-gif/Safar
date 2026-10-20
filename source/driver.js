/* ===== Safar X: the driver app ===== */
const APP_NAME = 'Safar X';
Account.init('driver');
const prefs = Object.assign({ online: true, pos: { ...CITY } }, LS.get('safar-driver-prefs', {}));
if (!prefs.pos || prefs.pos.lat == null) prefs.pos = { ...CITY };
const savePrefs = () => LS.set('safar-driver-prefs', prefs);
const ui = { tab: 'drive', declined: new Set(), editCar: false, formErr: '', formDraft: null, pinErr: '', busy: '', loaded: false };
let feed = { requests: [], trips: [] };
const writing = new Set();

const vehicle = () => Account.me && Account.me.vehicle;
const myJob = () => feed.trips.find(t => t.status === 'accepted' || t.status === 'ontrip');
function openRequests() {
  const v = vehicle(), now = Date.now();
  if (!v || !prefs.online || myJob()) return [];
  return feed.requests.filter(t => t.status === 'searching' && v.types.includes(t.type) && now - t.requestAt < REQ_WINDOW + 5000 && !ui.declined.has(t.id));
}

/* ---------- server sync ---------- */
async function poll() {
  if (!Account.token || document.hidden || !vehicle()) return;
  try {
    const next = await rpc('safar_driver_feed', { p_token: Account.token, p_online: !!prefs.online });
    const oldTrips = Object.fromEntries(feed.trips.map(t => [t.id, t])), oldReq = new Set(feed.requests.map(t => t.id));
    next.trips = next.trips.map(t => writing.has(t.id) && oldTrips[t.id] ? oldTrips[t.id] : t);
    feed = next; ui.loaded = true;
    notifyChanges(oldTrips, oldReq); render();
  } catch (e) { if (e.kind === 'session') { Account.clear(); toast(APP_NAME, e.message); render(true); } }
}
async function patchTrip(id, patch) {
  const t = feed.trips.find(x => x.id === id); if (!t) return;
  writing.add(id); Object.assign(t, patch); render();
  try { await rpc('safar_update_trip', { p_token: Account.token, p_app: 'driver', p_id: id, p_patch: patch }); }
  catch (e) { toast(APP_NAME, e.message); }
  writing.delete(id); poll();
}
function notifyChanges(oldTrips, oldReq) {
  const v = vehicle();
  for (const t of openRequests()) if (!oldReq.has(t.id)) toast(APP_NAME, `New ${TYPES[t.type].name} request from ${PLACES[t.from].name}.`);
  for (const t of feed.trips) {
    const o = oldTrips[t.id]; if (!o) continue;
    if (o.status !== 'cancelled' && t.status === 'cancelled') toast(APP_NAME, 'The rider cancelled this trip.');
    if (!o.tip && t.tip) toast(APP_NAME, `You got a ${money(t.tip)} tip from ${t.riderName || 'your rider'}.`);
    if (!o.rating && t.rating) toast(APP_NAME, `${t.riderName || 'A rider'} gave you ${t.rating} star${t.rating > 1 ? 's' : ''}.`);
  }
}

/* ---------- views ---------- */
const DI = {
  drive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.5v6.3M4.2 15.5l5.8-2.4M19.8 15.5 14 13.1"/></svg>',
  earn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  cash: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>'
};
const net = t => t.fare * (1 - FEE) + (t.tip || 0);
const dstop = (cls, small, big, side = '') => `<div class="rstop ${cls}"><i></i><span>${small ? `<small>${small}</small>` : ''}<b>${big}</b></span>${side}</div>`;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function completed() { return feed.trips.filter(t => t.status === 'completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)); }
function view() {
  if (!Account.token) return authView({ app: 'driver', logo: LOGO_X, headline: 'Sign in to drive', steps: true, signupTitle: 'Create your driver account', signupNote: 'Next you add your car. Riders see your first name and number plate.', namePh: 'Bilal Ahmed', termsText: 'I agree to the Safar X terms and privacy policy, and confirm I am 21 or over',
    fine: 'By continuing you agree to the Safar X terms and privacy policy. You need a private hire licence to drive.', other: 'Need a ride? Get the <b>Safar Rides</b> app.' });
  const head = `<header class="top"><div class="top-in"><span class="brandmini">${LOGO_X}Safar X</span>${vehicle() && !ui.editCar ? `<button class="switch" role="switch" aria-checked="${prefs.online}" data-act="online" style="margin-left:auto" ${myJob() ? 'disabled' : ''}><span>${prefs.online ? 'Online' : 'Offline'}</span><i></i></button>` : ''}</div></header>`;
  if (!vehicle() || ui.editCar) return head + `<main class="wrap">${carForm()}${vehicle() ? '' : '<p class="foot"><button class="linkbtn" data-act="logout">Log out</button></p>'}</main>`;
  const job = myJob(), tab = job ? 'drive' : ui.tab;
  const body = tab === 'earnings' ? earningsView() : tab === 'you' ? youView() : driveView();
  return head + `<main class="wrap" style="padding-bottom:96px">${body}</main>${job ? '' : dtabbar()}`;
}
function dtabbar() {
  const tabs = [['drive', 'Drive', DI.drive], ['earnings', 'Earnings', DI.earn], ['you', 'Account', DI.user]];
  return `<nav class="tabbar" style="--n:3" aria-label="Main">${tabs.map(([k, l, ic]) => `<button data-act="tab" data-tab="${k}" aria-current="${ui.tab === k}">${ic}<span>${l}</span></button>`).join('')}</nav>`;
}
function driveView() {
  const v = vehicle(), job = myJob(), reqs = openRequests();
  if (!ui.loaded) return '<div class="empty">Connecting to Safar…</div>';
  if (job) return jobView(job);
  if (reqs.length) {
    const t = reqs[0], A = PLACES[t.from], left = Math.max(0, Math.ceil((t.requestAt + REQ_WINDOW - Date.now()) / 1000));
    return mapSlot({ from: t.from, to: t.to, approach: prefs.pos, mine: { ...prefs.pos, a: 0 } }) + `<section class="panel" aria-label="New ride request">
      <div class="spread"><div class="stack tight"><span class="label">${esc(TYPES[t.type].name)} · ${t.pay === 'cash' ? 'cash' : 'card'}</span><h1>${money(net(t))}</h1><span class="small muted">Your earnings after the 25% fee</span></div>
        ${ring(left / (REQ_WINDOW / 1000), 64, { w: 7, attr: `data-ring="${t.id}"`, inner: `<b style="font-size:1.25rem" data-count="${t.id}">${left}</b>` })}</div>
      <div class="ribbon">${dstop('start', `${minsBetween(prefs.pos, A)} min away`, esc(A.name))}${dstop('end', `${t.miles.toFixed(1)} mi trip`, esc(PLACES[t.to].name))}</div>
      <p class="small muted">Rider: ${esc(t.riderName || 'Rider')}</p>
      <div class="swipe"><span>${ui.busy === t.id ? 'Accepting…' : 'Swipe to accept'}</span><input type="range" min="0" max="100" value="${ui.busy === t.id ? 100 : 0}" data-swipe="${t.id}" aria-label="Swipe to accept this ride" ${ui.busy ? 'disabled' : ''}></div>
      <button class="textbtn" data-act="decline" data-id="${t.id}">Decline</button></section>`;
  }
  const done = completed(), today = done.filter(t => sameDay(t.completedAt || t.requestAt, Date.now())), earned = today.reduce((a, t) => a + net(t), 0);
  const rated = done.filter(t => t.rating), rating = rated.length ? (rated.reduce((a, t) => a + t.rating, 0) / rated.length).toFixed(1) : null;
  return mapSlot({ mine: { ...prefs.pos, a: 0 } }, 'tall') + `<section class="panel">
      <h2 class="status">${prefs.online ? 'Looking for riders' : 'You\'re offline'}</h2>
      <p class="small muted">${prefs.online ? `You'll get ${v.types.map(k => TYPES[k].name).join(', ')} requests here. Keep this screen open.` : 'Turn on Online at the top to start getting ride requests.'}</p>
      <div class="menu"><div><span class="muted">Today</span><span>${money(earned)} · ${today.length} trip${today.length === 1 ? '' : 's'}</span></div><div><span class="muted">Rating</span><span>${rating ? '★ ' + rating : 'No ratings yet'}</span></div></div></section>`;
}
function earningsView() {
  const done = completed(), all = done.reduce((a, t) => a + net(t), 0), tips = done.reduce((a, t) => a + (t.tip || 0), 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6 + i); return d; });
  const per = days.map(d => done.filter(t => sameDay(t.completedAt || t.requestAt, d)).reduce((a, t) => a + net(t), 0));
  const week = per.reduce((a, b) => a + b, 0), max = Math.max(...per, 1);
  return `<div class="stack tight"><span class="label">Last 7 days</span><h1>${money(week)}</h1><span class="small muted">${done.length} trip${done.length === 1 ? '' : 's'} in total · ${money(tips)} in tips</span></div>
    <div class="bars" role="img" aria-label="Earnings for the last 7 days">${days.map((d, i) => `<div><em>${per[i] ? '£' + Math.round(per[i]) : ''}</em><i class="${i === 6 ? 'on' : ''}" style="height:${Math.max(2, per[i] / max * 100).toFixed(0)}%"></i><small>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</small></div>`).join('')}</div>
    <section class="stack tight"><h2>Trips</h2>${done.length ? `<div class="menu">${done.slice(0, 10).map(t => `<div><span>${esc(PLACES[t.from].name)} → ${esc(PLACES[t.to].name)}<br><span class="small muted">${esc(t.riderName || 'Rider')} · ${ago(t.completedAt || t.requestAt)}${t.rating ? ' · ★ ' + t.rating : ''}${t.tip ? ' · ' + money(t.tip) + ' tip' : ''}</span></span><span>${money(net(t))}</span></div>`).join('')}</div>` : '<p class="muted">Finish a trip and your earnings show here.</p>'}</section>
    <p class="small muted">All-time: ${money(all)} after the 25% Safar fee.</p>`;
}
function youView() {
  const me = Account.me || {}, v = vehicle();
  return `<div class="drv" style="grid-template-columns:60px 1fr"><div class="avatar" style="width:60px;height:60px;font-size:1.2rem">${esc(initials(me.name))}</div><div class="stack tight"><h1>${esc(me.name || '')}</h1><span class="small muted">Safar X driver</span></div></div>
    <div class="menu"><div><span class="muted">Car</span><span>${esc(v.colour)} ${esc(v.car)}</span></div><div><span class="muted">Number plate</span><span class="plate">${esc(v.plate)}</span></div><div><span class="muted">Ride types</span><span>${v.types.map(k => TYPES[k].name).join(', ')}</span></div>
      <div><span class="muted">Email</span><span>${esc(me.email || '')}</span></div><div><span class="muted">Mobile</span><span>${me.phone ? showPhone(me.phone) : ''}</span></div></div>
    <div class="row"><button class="btn ghost" data-act="editCar">Edit car details</button><button class="btn line" data-act="logout">Log out</button></div>`;
}
function jobView(job) {
  const ph = phase(job), A = PLACES[job.from], B = PLACES[job.to];
  const map = mapSlot({ from: job.from, to: job.to, approach: ph === 'arriving' && job.start && job.start.lat != null ? job.start : null, mine: { ...carPos(job), id: job.id } });
  const rider = `<div class="spread"><div class="stack tight"><span class="label">Rider</span><h3>${esc(job.riderName || 'Rider')}</h3></div><span style="font-weight:600">${money(job.fare * (1 - FEE))}</span></div>`;
  if (ph === 'arriving') return map + `<section class="panel"><div class="spread"><h2 class="status" data-eta="${job.id}">${etaText(job)}</h2><span class="pill">To pickup</span></div>
      <div class="prog"><i data-prog="${job.id}" style="width:${(progress(job) * 100).toFixed(1)}%"></i></div>
      <p>Pick up at <b>${esc(A.name)}</b></p>${rider}
      <button class="btn line sm" data-act="skipPickup" data-id="${job.id}">Testing: arrive now</button></section>`;
  if (ph === 'arrived') return map + `<section class="panel"><h2 class="status">You're at ${esc(A.name)}</h2>${rider}
      <label class="field"><span>Ask the rider for their 4-digit PIN</span><input id="pin" class="pininput" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></label>
      ${ui.pinErr ? `<p class="err" role="alert">${esc(ui.pinErr)}</p>` : '<p class="small muted">The trip only starts when the PIN matches.</p>'}
      <button class="btn block authgo" data-act="start" data-id="${job.id}" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Checking…' : 'Start trip'}</button></section>`;
  if (ph === 'ontrip') return map + `<section class="panel"><div class="spread"><h2 class="status" data-eta="${job.id}">${etaText(job)}</h2><span class="pill">On trip</span></div>
      <div class="prog"><i data-prog="${job.id}" style="width:${(progress(job) * 100).toFixed(1)}%"></i></div>
      <p>Drop off at <b>${esc(B.name)}</b> · ${job.pay === 'cash' ? `collect <b>${money(job.fare)}</b> in cash` : 'paid by card'}</p>${rider}
      <button class="btn line sm" data-act="skipTrip" data-id="${job.id}">Testing: arrive now</button></section>`;
  return map + `<section class="panel"><h2 class="status">You've arrived at ${esc(B.name)}</h2>${rider}
      ${job.pay === 'cash' ? `<div class="note">${DI.cash}<span>Collect <b>${money(job.fare)}</b> in cash before the rider leaves.</span></div>` : ''}
      <button class="btn block authgo" data-act="complete" data-id="${job.id}">Complete trip</button></section>`;
}
function carForm() {
  const p = vehicle(), v = ui.formDraft || p || { car: '', colour: '', plate: '', types: ['go'] };
  return `<section class="sheet">
    <div class="stack tight"><span class="label">${p ? 'Your car' : 'Step 2 of 2'}</span><h1>${p ? 'Edit car details' : 'Add your car, ' + esc(first(Account.me.name))}</h1>
    <p class="small muted">Riders see your first name, car and number plate when you accept their ride.</p></div>
    <div class="grid2">
      <label class="field"><span>Number plate</span><input id="su-plate" class="mono" value="${esc(v.plate)}" placeholder="YK21 BLL" style="text-transform:uppercase"></label>
      <label class="field"><span>Car make and model</span><input id="su-car" value="${esc(v.car)}" placeholder="Toyota Corolla Hybrid"></label>
      <label class="field"><span>Colour</span><input id="su-colour" value="${esc(v.colour)}" placeholder="Silver"></label>
    </div>
    <div class="stack tight"><span class="label">Ride types you can take</span>
      <div class="checks">${Object.entries(TYPES).map(([k, t]) => `<label><input type="checkbox" id="su-t-${k}" ${v.types.includes(k) ? 'checked' : ''}>${t.name} <span class="small muted">· ${t.blurb.toLowerCase()}</span></label>`).join('')}</div></div>
    ${p ? '' : `<div class="stack tight"><span class="label">Before you drive</span><div class="checks">
      ${['I hold a private hire driver licence', 'My car has hire and reward insurance', 'My car has a valid MOT'].map((l, i) => `<label><input type="checkbox" id="su-d${i + 1}" ${v.docs && v.docs[i] ? 'checked' : ''}>${l}</label>`).join('')}</div></div>`}
    ${ui.formErr ? `<p class="err" role="alert">${esc(ui.formErr)}</p>` : ''}
    <div class="row"><button class="btn" data-act="saveCar" style="flex:1" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Saving…' : p ? 'Save details' : 'Start driving'}</button>${p ? '<button class="btn ghost" data-act="cancelCar">Cancel</button>' : ''}</div>
  </section>`;
}
function viewKey() { const j = Account.token && vehicle() && myJob(); return (Account.token ? 'in' : 'out') + (vehicle() ? 'v' : '') + (j ? j.id + phase(j) : 'req:' + openRequests().map(t => t.id).join(',')); }

/* ---------- actions ---------- */
const ACTIONS = {
  tab: d => { ui.tab = d.tab; render(true); window.scrollTo(0, 0); },
  online: () => { prefs.online = !prefs.online; savePrefs(); render(true); poll(); },
  editCar: () => { ui.editCar = true; ui.formErr = ''; ui.formDraft = null; render(true); },
  cancelCar: () => { ui.editCar = false; ui.formErr = ''; ui.formDraft = null; render(true); },
  saveCar: async () => {
    const g = id => (document.getElementById(id) || {}).value || '';
    const p = { plate: g('su-plate').trim().toUpperCase(), car: g('su-car').trim(), colour: g('su-colour').trim(), types: Object.keys(TYPES).filter(k => document.getElementById('su-t-' + k).checked) };
    const docs = ['su-d1', 'su-d2', 'su-d3'].map(id => !!(document.getElementById(id) || {}).checked);
    ui.formErr = !p.car || !p.colour ? 'Fill in your car and its colour.' : !/^[A-Z0-9 ]{2,8}$/.test(p.plate) ? 'Enter a number plate, for example YK21 BLL.' : !p.types.length ? 'Choose at least one ride type.' : !vehicle() && !docs.every(Boolean) ? 'Tick all three boxes to confirm your licence, insurance and MOT.' : '';
    ui.formDraft = Object.assign({}, p, { docs });
    if (ui.formErr) { render(true); return; }
    const first_ = !vehicle(); ui.busy = 'car'; render(true);
    try { Account.setMe(await rpc('safar_set_vehicle', { p_token: Account.token, p_vehicle: p })); ui.editCar = false; ui.formDraft = null; if (first_) toast(APP_NAME, 'You are set up. Go online to get ride requests.'); poll(); }
    catch (e) { ui.formErr = e.message; }
    ui.busy = ''; render(true);
  },
  decline: d => { ui.declined.add(d.id); render(true); },
  accept: async d => {
    const t = feed.requests.find(x => x.id === d.id); if (!t || ui.busy) return;
    const A = PLACES[t.from]; ui.busy = t.id; render(true);
    try {
      await rpc('safar_accept_trip', { p_token: Account.token, p_id: t.id, p_patch: { start: { lat: prefs.pos.lat, lng: prefs.pos.lng }, acceptedAt: Date.now(), pickupDur: Math.max(6000, roadMiles(prefs.pos, A) * 2600), pickupMins: minsBetween(prefs.pos, A) } });
      toast(APP_NAME, `Ride accepted. Head to ${A.name}.`);
    } catch (e) { toast(APP_NAME, e.message); ui.declined.add(t.id); }
    ui.busy = ''; await poll(); render(true);
  },
  skipPickup: d => { const t = feed.trips.find(x => x.id === d.id); patchTrip(d.id, { pickupDur: Math.max(0, Date.now() - t.acceptedAt) }); },
  start: async d => {
    const t = feed.trips.find(x => x.id === d.id), v = ((document.getElementById('pin') || {}).value || '').trim();
    if (!/^\d{4}$/.test(v)) { ui.pinErr = 'Enter the 4-digit PIN from the rider.'; render(true); return; }
    ui.busy = 'pin'; ui.pinErr = ''; render(true);
    try { await rpc('safar_start_trip', { p_token: Account.token, p_id: d.id, p_pin: v, p_patch: { startedAt: Date.now(), tripDur: 8000 + t.miles * 2500 } }); }
    catch (e) { ui.pinErr = e.message; }
    ui.busy = ''; await poll(); render(true);
  },
  skipTrip: d => { const t = feed.trips.find(x => x.id === d.id); patchTrip(d.id, { tripDur: Math.max(0, Date.now() - t.startedAt) }); },
  complete: d => {
    const t = feed.trips.find(x => x.id === d.id); prefs.pos = { lat: PLACES[t.to].lat, lng: PLACES[t.to].lng }; savePrefs();
    patchTrip(d.id, { status: 'completed', completedAt: Date.now() });
    toast(APP_NAME, `Trip complete. You earned ${money(t.fare * (1 - FEE))}.`);
  }
};

/* ---------- clock ---------- */
function tick() {
  if (!Account.token) return;
  if (viewKey() !== lastKey) { render(); return; }
  const now = Date.now(), job = vehicle() && myJob();
  if (job) {
    const pt = carPos(job, now);
    moveCar(job.id, pt);
    document.querySelectorAll(`[data-prog="${job.id}"]`).forEach(b => b.style.width = (progress(job, now) * 100).toFixed(1) + '%');
    document.querySelectorAll(`[data-eta="${job.id}"]`).forEach(x => x.textContent = etaText(job));
  }
  document.querySelectorAll('[data-count]').forEach(x => { const t = feed.requests.find(r => r.id === x.dataset.count); if (t) x.textContent = Math.max(0, Math.ceil((t.requestAt + REQ_WINDOW - now) / 1000)); });
  document.querySelectorAll('[data-ring]').forEach(x => { const t = feed.requests.find(r => r.id === x.dataset.ring); if (t) x.setAttribute('stroke-dasharray', (Math.max(0, (t.requestAt + REQ_WINDOW - now) / REQ_WINDOW) * 100).toFixed(1) + ' 100'); });
}
/* swipe to accept: drag the coral knob to the end of the track */
document.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.swipe && +t.value >= 90 && !ui.busy) { t.value = 100; t.blur(); ACTIONS.accept({ id: t.dataset.swipe }); } });
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.swipe && +t.value < 90) { t.value = 0; t.blur(); } });
function onLoggedIn() { ui.tab = 'drive'; ui.loaded = false; feed = { requests: [], trips: [] }; poll(); }
setInterval(tick, 250);
setInterval(poll, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
render(true);
if (Account.token) Account.refresh().then(() => { render(true); poll(); });
