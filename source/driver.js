/* ===== Safar X: the driver app (Night Route design) ===== */
const APP_NAME = 'Safar X';
Account.init('driver');
const prefs = Object.assign({ online: true, pos: { x: 160, y: 200 } }, LS.get('safar-driver-prefs', {}));
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

/* ---------- views (Night Route design: coral on deep night) ---------- */
const GOAL = 120;
const DI = {
  drive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.5v6.3M4.2 15.5l5.8-2.4M19.8 15.5 14 13.1"/></svg>',
  earn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'
};
const net = t => t.fare * (1 - FEE) + (t.tip || 0);
const dstop = (cls, small, big, side = '') => `<div class="rstop ${cls}"><i></i><span>${small ? `<small>${small}</small>` : ''}<b>${big}</b></span>${side}</div>`;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function completed() { return feed.trips.filter(t => t.status === 'completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)); }
function view() {
  if (!Account.token) return authView({ app: 'driver', headline: 'Your city.<br>Your shift.', steps: true, signupTitle: 'Create your driver account', signupNote: 'Next you add your car. Riders see your first name and number plate.', namePh: 'Bilal Ahmed', termsText: 'I agree to the Safar X terms and privacy policy, and confirm I am 21 or over',
    fine: 'By continuing you agree to the Safar X terms and privacy policy. You need a private hire licence to drive.', other: 'Need a ride? Get the <b>Safar Rides</b> app.',
    hero: { label: 'A night map of Leeds with a glowing coral route to the next pickup', bg: '#0a0d1c', accent: '#ff6f59', ink: '#0a0d1c', tag: '£9.40' } });
  const head = `<header class="top"><div class="top-in"><span class="brandmini">${LOGO_X}Safar X</span>${vehicle() && !ui.editCar ? `<button class="onpill" role="switch" aria-checked="${prefs.online}" data-act="online" style="margin-left:auto" ${myJob() ? 'disabled' : ''}><i></i>${prefs.online ? 'Online' : 'Offline'}</button>` : ''}</div></header>`;
  if (!vehicle() || ui.editCar) return head + `<main class="wrap">${carForm()}${vehicle() ? '' : '<p class="foot"><button class="linkbtn" data-act="logout">Log out</button></p>'}</main>`;
  const job = myJob(), tab = job ? 'drive' : ui.tab;
  const body = tab === 'earnings' ? earningsView() : tab === 'you' ? youView() : driveView();
  return head + `<main class="wrap" style="padding-bottom:120px">${body}</main>${job ? '' : dtabbar()}`;
}
function dtabbar() {
  const tabs = [['drive', 'Drive', DI.drive], ['earnings', 'Earnings', DI.earn], ['you', 'You', DI.user]];
  return `<nav class="tabbar" style="--n:3" aria-label="Main">${tabs.map(([k, l, ic]) => `<button data-act="tab" data-tab="${k}" aria-current="${ui.tab === k}">${ic}<span>${l}</span></button>`).join('')}</nav>`;
}
function driveView() {
  const v = vehicle(), job = myJob(), reqs = openRequests();
  if (!ui.loaded) return '<div class="empty">Connecting to Safar…</div>';
  if (job) return jobView(job);
  if (reqs.length) {
    const t = reqs[0], A = PLACES[t.from], left = Math.max(0, Math.ceil((t.requestAt + REQ_WINDOW - Date.now()) / 1000));
    return mapSVG({ from: t.from, to: t.to, approach: prefs.pos, mine: { ...prefs.pos, a: 0 } }) + `<section class="ticket hot" aria-label="New ride request">
      <div class="spread"><div class="stack tight"><span class="label">New ${esc(TYPES[t.type].name)} request</span><span class="bigeta"><b>${money(net(t))}</b></span><span class="small muted">your earnings after the 25% Safar fee</span></div>
        ${ring(left / (REQ_WINDOW / 1000), 74, { attr: `data-ring="${t.id}"`, inner: `<b class="mono" style="font-size:1.4rem" data-count="${t.id}">${left}</b><br><small class="muted">sec</small>` })}</div>
      <div class="ribbon">${dstop('start', `Pickup · ${minsBetween(prefs.pos, A)} min away`, esc(A.name))}${dstop('end', `Drop-off · ${t.miles.toFixed(1)} mi`, esc(PLACES[t.to].name), `<span class="side">${t.pay === 'cash' ? 'cash' : 'card'}</span>`)}</div>
      <div class="perf"></div>
      <p class="small muted">Rider: <b style="color:var(--ink)">${esc(t.riderName || 'Rider')}</b></p>
      <div class="swipe"><span>${ui.busy === t.id ? 'Accepting…' : 'Swipe to accept'}</span><input type="range" min="0" max="100" value="${ui.busy === t.id ? 100 : 0}" data-swipe="${t.id}" aria-label="Swipe to accept this ride" ${ui.busy ? 'disabled' : ''}></div>
      <div class="row"><button class="btn line" data-act="decline" data-id="${t.id}" style="flex:1">Decline</button><button class="btn ghost" data-act="accept" data-id="${t.id}" style="flex:1" ${ui.busy ? 'disabled' : ''}>Accept</button></div></section>`;
  }
  const done = completed(), today = done.filter(t => sameDay(t.completedAt || t.requestAt, Date.now())), earned = today.reduce((a, t) => a + net(t), 0);
  const rated = done.filter(t => t.rating), rating = rated.length ? (rated.reduce((a, t) => a + t.rating, 0) / rated.length).toFixed(2) : '–';
  return `<section class="ticket" style="flex-direction:row;align-items:center;gap:16px">
      ${ring(earned / GOAL, 118, { w: 9, inner: `<b style="font:800 1.45rem var(--display)">${money(earned)}</b><br><small class="muted">of £${GOAL} goal</small>` })}
      <div class="stack tight"><span class="label">Today</span><h2>${earned >= GOAL ? 'Goal smashed. Nice shift.' : `${money(GOAL - earned)} to your goal`}</h2><span class="small muted">After the Safar fee, including tips.</span></div></section>
    <div class="stat3"><div><small>Trips today</small><b>${today.length}</b></div><div><small>Rating</small><b>★ ${rating}</b></div><div><small>Car</small><b class="plate" style="font:600 .8rem var(--mono);align-self:flex-start">${esc(v.plate)}</b></div></div>
    ${mapSVG({ mine: { ...prefs.pos, a: 0 } })}
    <section class="ticket"><div class="spread"><p class="status">${prefs.online ? 'Looking for riders…' : 'You are offline'}</p>${prefs.online ? '<div class="pulse" style="width:28px;height:28px;margin:0"><i style="width:10px;height:10px"></i></div>' : ''}</div>
      <p class="small muted">${prefs.online ? `Requests for ${v.types.map(k => TYPES[k].name).join(', ')} appear here. Keep this screen open.` : 'Tap Offline at the top to go online and get ride requests.'}</p></section>`;
}
function earningsView() {
  const done = completed(), all = done.reduce((a, t) => a + net(t), 0), tips = done.reduce((a, t) => a + (t.tip || 0), 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6 + i); return d; });
  const per = days.map(d => done.filter(t => sameDay(t.completedAt || t.requestAt, d)).reduce((a, t) => a + net(t), 0));
  const week = per.reduce((a, b) => a + b, 0), max = Math.max(...per, 1);
  return `<div class="stack tight"><span class="label">This week</span><h1 class="display">${money(week)}</h1><span class="small muted">${done.length} trip${done.length === 1 ? '' : 's'} in total · ${money(tips)} in tips</span></div>
    <section class="ticket"><div class="bars" role="img" aria-label="Earnings for the last 7 days">${days.map((d, i) => `<div><em>${per[i] ? '£' + Math.round(per[i]) : ''}</em><i class="${i === 6 ? 'on' : ''}" style="height:${Math.max(3, per[i] / max * 100).toFixed(0)}%"></i><small>${d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</small></div>`).join('')}</div></section>
    <section class="stack"><h2>Recent trips</h2>${done.length ? `<div class="menu">${done.slice(0, 10).map(t => `<div><span>${esc(PLACES[t.from].name)} → ${esc(PLACES[t.to].name)}<br><span class="small muted">${esc(t.riderName || 'Rider')} · ${ago(t.completedAt || t.requestAt)}${t.rating ? ' · ★ ' + t.rating : ''}${t.tip ? ' · ' + money(t.tip) + ' tip' : ''}</span></span><span class="mono">${money(net(t))}</span></div>`).join('')}</div>` : '<div class="empty">Finish a trip and your earnings show here.</div>'}</section>
    <p class="small muted">All-time earnings ${money(all)} after the 25% Safar fee.</p>`;
}
function youView() {
  const me = Account.me || {}, v = vehicle();
  return `<div class="drv" style="grid-template-columns:64px 1fr"><div class="avatar" style="width:64px;height:64px;font-size:1.3rem">${esc(initials(me.name))}</div><div class="stack tight"><h1>${esc(me.name || '')}</h1><span class="small muted">Safar X driver</span></div></div>
    <div class="ticket"><div class="spread"><span class="label">Your car</span><span class="plate">${esc(v.plate)}</span></div><h2>${esc(v.colour)} ${esc(v.car)}</h2><div class="perf"></div><span class="small muted">Takes ${v.types.map(k => TYPES[k].name).join(', ')}</span></div>
    <div class="menu"><div><span class="muted">Email</span><span>${esc(me.email || '')}</span></div><div><span class="muted">Mobile</span><span class="mono">${me.phone ? showPhone(me.phone) : ''}</span></div></div>
    <div class="row"><button class="btn ghost" data-act="editCar">Edit car details</button><button class="btn line" data-act="logout">Log out</button></div>`;
}
function jobView(job) {
  const ph = phase(job), A = PLACES[job.from], B = PLACES[job.to];
  const map = mapSVG({ from: job.from, to: job.to, approach: ph === 'arriving' ? job.start : null, mine: { ...carPos(job), id: job.id } });
  const rider = `<div class="spread"><div class="stack tight"><span class="label">Rider</span><h3>${esc(job.riderName || 'Rider')}</h3></div><span class="mono" style="font-weight:600;color:var(--accent)">${money(job.fare * (1 - FEE))}</span></div>`;
  const ribbon = `<div class="ribbon">${dstop('start', 'Pickup', esc(A.name))}${dstop('end', 'Drop-off', esc(B.name), `<span class="side">${job.pay === 'cash' ? 'cash' : 'card'}</span>`)}</div>`;
  const left = () => Math.max(1, Math.ceil((1 - progress(job)) * (ph === 'arriving' ? job.pickupMins : job.mins)));
  if (ph === 'arriving') return map + `<section class="ticket"><div class="spread"><div class="bigeta"><b data-etanum="${job.id}">${left()}</b><span>min<small>to pickup at ${esc(A.name)}</small></span></div><span class="pill">To pickup</span></div>
      <p class="sr" data-eta="${job.id}">${etaText(job)}</p>
      <div class="prog"><i data-prog="${job.id}" style="width:${(progress(job) * 100).toFixed(1)}%"></i></div>${ribbon}<div class="perf"></div>${rider}
      <button class="btn line sm" data-act="skipPickup" data-id="${job.id}">Test mode: arrive now</button></section>`;
  if (ph === 'arrived') return map + `<section class="ticket hot"><p class="status">You're at ${esc(A.name)}</p>${rider}<div class="perf"></div>
      <label class="field"><span>Ask the rider for their 4-digit boarding PIN</span><input id="pin" class="pininput" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></label>
      ${ui.pinErr ? `<p class="err" role="alert">${esc(ui.pinErr)}</p>` : '<p class="small muted">The rider sees the PIN in Safar Rides. The trip only starts when it matches.</p>'}
      <button class="btn block authgo" data-act="start" data-id="${job.id}" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Checking…' : 'Start trip'}</button></section>`;
  if (ph === 'ontrip') return map + `<section class="ticket"><div class="spread"><div class="bigeta"><b data-etanum="${job.id}">${left()}</b><span>min<small>to ${esc(B.name)}</small></span></div><span class="pill">On trip</span></div>
      <p class="sr" data-eta="${job.id}">${etaText(job)}</p>
      <div class="prog"><i data-prog="${job.id}" style="width:${(progress(job) * 100).toFixed(1)}%"></i></div>${ribbon}<div class="perf"></div>${rider}
      <p class="small">${job.pay === 'cash' ? `Collect <b class="mono">${money(job.fare)}</b> in cash` : 'Paid by card'}</p>
      <button class="btn line sm" data-act="skipTrip" data-id="${job.id}">Test mode: arrive now</button></section>`;
  return map + `<section class="ticket hot"><p class="status">You've reached ${esc(B.name)}</p>${rider}
      ${job.pay === 'cash' ? `<div class="note amber"><span>💷</span><span>Collect <b class="mono">${money(job.fare)}</b> in cash before the rider leaves.</span></div>` : ''}
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
      await rpc('safar_accept_trip', { p_token: Account.token, p_id: t.id, p_patch: { start: { x: prefs.pos.x, y: prefs.pos.y }, acceptedAt: Date.now(), pickupDur: Math.max(6000, len(path(prefs.pos, A)) / 40 * 1800), pickupMins: minsBetween(prefs.pos, A) } });
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
    const t = feed.trips.find(x => x.id === d.id); prefs.pos = { x: PLACES[t.to].x, y: PLACES[t.to].y }; savePrefs();
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
    document.querySelectorAll(`[data-car="${job.id}"]`).forEach(g => g.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)}) rotate(${(pt.a || 0).toFixed(0)})`));
    document.querySelectorAll(`[data-prog="${job.id}"]`).forEach(b => b.style.width = (progress(job, now) * 100).toFixed(1) + '%');
    document.querySelectorAll(`[data-eta="${job.id}"]`).forEach(x => x.textContent = etaText(job));
    const ph = phase(job, now); document.querySelectorAll(`[data-etanum="${job.id}"]`).forEach(x => x.textContent = Math.max(1, Math.ceil((1 - progress(job, now)) * (ph === 'arriving' ? job.pickupMins : job.mins))));
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
