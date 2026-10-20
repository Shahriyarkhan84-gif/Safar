/* ===== Safar X: the driver app ===== */
const APP_NAME = 'Safar X';
Account.init('driver');
const prefs = Object.assign({ online: true, pos: { x: 160, y: 200 } }, LS.get('safar-driver-prefs', {}));
const savePrefs = () => LS.set('safar-driver-prefs', prefs);
const ui = { declined: new Set(), editCar: false, formErr: '', formDraft: null, pinErr: '', busy: '', loaded: false };
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
function view() {
  if (!Account.token) return authView({ app: 'driver', name: APP_NAME, logo: LOGO_X, tagline: 'Drive around Leeds and earn on your own schedule.', steps: true, signupTitle: 'Create your driver account', signupNote: 'Next you add your car. Riders see your first name and number plate.', namePh: 'Bilal Ahmed', termsText: 'I agree to the Safar X terms and privacy policy, and confirm I am 21 or over', other: 'Need a ride? Get the <b>Safar Rides</b> app.' });
  const me = Account.me || { name: '' }, head = `<header class="top"><div class="top-in">${LOGO_X}<b>Safar X</b></div></header>`;
  if (!vehicle() || ui.editCar) return head + `<main class="wrap">${carForm()}${vehicle() ? '' : '<p class="foot"><button class="linkbtn" data-act="logout">Log out</button></p>'}</main>`;
  const v = vehicle(), job = myJob(), reqs = openRequests();
  const done = feed.trips.filter(t => t.status === 'completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const earned = done.reduce((a, t) => a + t.fare * (1 - FEE) + (t.tip || 0), 0), rated = done.filter(t => t.rating);
  const bar = `<div class="drv" style="grid-template-columns:48px 1fr auto"><div class="avatar" style="width:48px;height:48px;font-size:1rem">${esc(initials(me.name))}</div>
    <div class="stack tight"><h3>${esc(me.name)}</h3><span class="small muted"><span class="plate" style="font-size:.74rem">${esc(v.plate)}</span> ${esc(v.colour)} ${esc(v.car)}</span></div>
    <button class="switch" role="switch" aria-checked="${prefs.online}" data-act="online" ${job ? 'disabled' : ''}><span>${prefs.online ? 'Online' : 'Offline'}</span><i></i></button></div>`;
  let main;
  if (!ui.loaded) main = '<div class="empty">Connecting to Safar…</div>';
  else if (job) main = jobView(job);
  else if (reqs.length) {
    const t = reqs[0], A = PLACES[t.from], left = Math.max(0, Math.ceil((t.requestAt + REQ_WINDOW - Date.now()) / 1000));
    main = mapSVG({ from: t.from, to: t.to, approach: prefs.pos, mine: { ...prefs.pos, a: 0 } }) + `<section class="sheet hot">
      <div class="spread"><div class="stack tight"><span class="label">New ${esc(TYPES[t.type].name)} request</span><h1>${money(t.fare * (1 - FEE))}</h1><span class="small muted">your earnings after the 25% Safar fee</span></div><div class="count" data-count="${t.id}">${left}</div></div>
      <div class="route"><span class="dot"></span><span><b>${esc(A.name)}</b> <span class="small muted">· ${minsBetween(prefs.pos, A)} min away</span></span><span></span><span class="rail"></span><span></span><span></span><span class="sq"></span><span>${esc(PLACES[t.to].name)} <span class="small muted mono">· ${t.miles.toFixed(1)} mi · ${t.pay === 'cash' ? 'cash' : 'card'}</span></span></div>
      <p class="small muted">Rider: ${esc(t.riderName || 'Rider')}</p>
      <div class="row"><button class="btn line" data-act="decline" data-id="${t.id}" style="flex:1">Decline</button><button class="btn" data-act="accept" data-id="${t.id}" style="flex:2" ${ui.busy ? 'disabled' : ''}>${ui.busy === t.id ? 'Accepting…' : 'Accept'}</button></div></section>`;
  } else main = mapSVG({ mine: { ...prefs.pos, a: 0 } }) + `<section class="sheet"><p class="status">${prefs.online ? 'Looking for riders…' : 'You are offline'}</p>
      <p class="small muted">${prefs.online ? `Requests for ${v.types.map(k => TYPES[k].name).join(', ')} appear here. Keep this screen open.` : 'Go online to start getting ride requests.'}</p></section>`;
  return head + `<main class="wrap">${bar}${main}
    <div class="kpis"><div class="kpi"><span class="label">Earnings</span><b>${money(earned)}</b><span class="small muted">after fee, incl. tips</span></div><div class="kpi"><span class="label">Trips</span><b>${done.length}</b><span class="small muted">${rated.length ? '★ ' + (rated.reduce((a, t) => a + t.rating, 0) / rated.length).toFixed(2) + ' from riders' : 'no ratings yet'}</span></div></div>
    ${done.length ? `<section class="sheet"><h2>Recent trips</h2><div class="list">${done.slice(0, 6).map(t => `<div><span>${esc(PLACES[t.from].name)} → ${esc(PLACES[t.to].name)}<br><span class="small muted">${esc(t.riderName || 'Rider')} · ${ago(t.completedAt || t.requestAt)}${t.rating ? ' · ★ ' + t.rating : ''}${t.tip ? ' · ' + money(t.tip) + ' tip' : ''}</span></span><span class="mono">${money(t.fare * (1 - FEE) + (t.tip || 0))}</span></div>`).join('')}</div></section>` : ''}
    <div class="row"><button class="btn ghost sm" data-act="editCar">Edit car details</button><button class="btn ghost sm" data-act="logout" ${job ? 'disabled' : ''}>Log out</button></div></main>`;
}
function jobView(job) {
  const ph = phase(job), A = PLACES[job.from], B = PLACES[job.to];
  const map = mapSVG({ from: job.from, to: job.to, approach: ph === 'arriving' ? job.start : null, mine: { ...carPos(job), id: job.id } });
  const rider = `<div class="spread"><div class="stack tight"><span class="label">Rider</span><h3>${esc(job.riderName || 'Rider')}</h3></div><span class="mono" style="font-weight:600">${money(job.fare * (1 - FEE))}</span></div>`;
  if (ph === 'arriving') return map + `<section class="sheet"><div class="spread"><p class="status" data-eta="${job.id}">${etaText(job)}</p><span class="pill">To pickup</span></div>
      <div class="prog"><i data-prog="${job.id}" style="width:${(progress(job) * 100).toFixed(1)}%"></i></div>${rider}
      <p>Pick up at <b>${esc(A.name)}</b></p><button class="btn line sm" data-act="skipPickup" data-id="${job.id}">Test mode: arrive now</button></section>`;
  if (ph === 'arrived') return map + `<section class="sheet hot"><p class="status">You're at ${esc(A.name)}</p>${rider}
      <label class="field"><span>Ask the rider for their 4-digit PIN</span><input id="pin" class="pininput" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></label>
      ${ui.pinErr ? `<p class="err" role="alert">${esc(ui.pinErr)}</p>` : '<p class="small muted">The rider sees the PIN in Safar Rides. The trip only starts when it matches.</p>'}
      <button class="btn block" data-act="start" data-id="${job.id}" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Checking…' : 'Start trip'}</button></section>`;
  if (ph === 'ontrip') return map + `<section class="sheet"><div class="spread"><p class="status" data-eta="${job.id}">${etaText(job)}</p><span class="pill">On trip</span></div>
      <div class="prog"><i data-prog="${job.id}" style="width:${(progress(job) * 100).toFixed(1)}%"></i></div>${rider}
      <p>Drop off at <b>${esc(B.name)}</b> · ${job.pay === 'cash' ? `collect <b class="mono">${money(job.fare)}</b> in cash` : 'paid by card'}</p>
      <button class="btn line sm" data-act="skipTrip" data-id="${job.id}">Test mode: arrive now</button></section>`;
  return map + `<section class="sheet hot"><p class="status">You've reached ${esc(B.name)}</p>${rider}
      ${job.pay === 'cash' ? `<div class="note amber"><span>💷</span><span>Collect <b class="mono">${money(job.fare)}</b> in cash before the rider leaves.</span></div>` : ''}
      <button class="btn block" data-act="complete" data-id="${job.id}">Complete trip</button></section>`;
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
  }
  document.querySelectorAll('[data-count]').forEach(x => { const t = feed.requests.find(r => r.id === x.dataset.count); if (t) x.textContent = Math.max(0, Math.ceil((t.requestAt + REQ_WINDOW - now) / 1000)); });
}
function onLoggedIn() { ui.loaded = false; feed = { requests: [], trips: [] }; poll(); }
setInterval(tick, 250);
setInterval(poll, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
render(true);
if (Account.token) Account.refresh().then(() => { render(true); poll(); });
