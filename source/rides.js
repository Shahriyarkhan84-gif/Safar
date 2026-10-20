/* ===== Safar Rides: the rider app ===== */
const APP_NAME = 'Safar Rides';
Account.init('rides');
const prefs = Object.assign({ draft: { from: 'home', to: 'station', type: 'go', pay: 'card' } }, LS.get('safar-rides-prefs', {}));
const savePrefs = () => LS.set('safar-rides-prefs', prefs);
const ui = { tab: 'ride', stars: 0, tip: 0, simNow: new Set(), busy: false, loaded: false };
let trips = [];
const writing = new Set();
const arrivedSeen = new Set();

function activeTrip() {
  const now = Date.now();
  return trips.filter(t => t.status !== 'cancelled' && !t.rated && (t.status !== 'completed' || now - (t.completedAt || t.requestAt) < 3 * 3600000))
    .sort((a, b) => b.requestAt - a.requestAt)[0];
}

/* ---------- server sync ---------- */
async function poll() {
  if (!Account.token || document.hidden) return;
  try {
    const list = await rpc('safar_my_trips', { p_token: Account.token });
    const old = Object.fromEntries(trips.map(t => [t.id, t]));
    trips = list.map(t => writing.has(t.id) && old[t.id] ? old[t.id] : t);
    ui.loaded = true; notifyChanges(old); render();
  } catch (e) { if (e.kind === 'session') { Account.clear(); toast(APP_NAME, e.message); render(true); } }
}
async function patchTrip(id, patch, quiet) {
  const t = trips.find(x => x.id === id); if (!t) return;
  writing.add(id); Object.assign(t, patch); render();
  try { await rpc('safar_update_trip', { p_token: Account.token, p_app: 'rides', p_id: id, p_patch: patch }); }
  catch (e) { if (!quiet) toast(APP_NAME, e.message); }
  writing.delete(id); poll();
}
function notifyChanges(old) {
  for (const t of trips) {
    const o = old[t.id]; if (!o) continue;
    if (o.status === 'searching' && t.status === 'accepted' && t.driver) toast(APP_NAME, `${first(t.driver.name)} is coming in a ${String(t.driver.colour).toLowerCase()} ${t.driver.car} · ${t.driver.plate}`);
    if (o.status === 'accepted' && t.status === 'ontrip') toast(APP_NAME, `Trip started. About ${t.mins} min to ${PLACES[t.to].name}.`);
  }
}

/* ---------- views ---------- */
function view() {
  if (!Account.token) return authView({ app: 'rides', name: APP_NAME, logo: LOGO_R, tagline: 'Rides across Leeds, booked in seconds.', signupTitle: 'Create your account', signupNote: 'Your driver sees your first name when they pick you up.', namePh: 'Sara Hussain', termsText: 'I agree to the Safar Rides terms and privacy policy', other: 'Want to drive? Get the <b>Safar X</b> driver app.' });
  const me = Account.me || { name: '' };
  const head = `<header class="top"><div class="top-in">${LOGO_R}<b>Safar Rides</b><button class="avatar sm" data-act="tab" data-tab="account" aria-label="Your account">${esc(initials(me.name))}</button></div></header>`;
  if (!ui.loaded) return head + `<main class="wrap"><div class="empty">Loading your rides…</div></main>`;
  const t = activeTrip();
  if (t) return head + `<main class="wrap">${tripMap(t)}${tripSheet(t)}</main>`;
  const tabs = `<div class="seg" role="group"><button data-act="tab" data-tab="ride" aria-pressed="${ui.tab === 'ride'}">Ride</button><button data-act="tab" data-tab="trips" aria-pressed="${ui.tab === 'trips'}">My trips</button><button data-act="tab" data-tab="account" aria-pressed="${ui.tab === 'account'}">Account</button></div>`;
  if (ui.tab === 'account') return head + `<main class="wrap">${tabs}<section class="sheet"><div class="drv" style="grid-template-columns:52px 1fr"><div class="avatar">${esc(initials(me.name))}</div><div class="stack tight"><h2>${esc(me.name)}</h2><span class="small muted">${esc(me.email || '')}</span><span class="small muted mono">${me.phone ? showPhone(me.phone) : ''}</span></div></div><button class="btn line" data-act="logout">Log out</button></section></main>`;
  if (ui.tab === 'trips') {
    const done = trips.filter(x => x.status === 'completed' || x.status === 'cancelled');
    return head + `<main class="wrap">${tabs}${done.length ? `<section class="sheet"><div class="list">${done.map(x => `<div><span><b>${esc(PLACES[x.from].name)} → ${esc(PLACES[x.to].name)}</b><br><span class="small muted">${TYPES[x.type].name} · ${x.driver ? esc(first(x.driver.name)) : 'no driver'} · ${ago(x.requestAt)}</span></span><span class="mono">${x.status === 'cancelled' ? 'Cancelled' : money(x.fare + (x.tip || 0))}</span></div>`).join('')}</div></section>` : '<div class="empty">No trips yet. Book your first ride.</div>'}</main>`;
  }
  const d = prefs.draft, same = d.from === d.to, A = PLACES[d.from];
  const opts = sel => Object.entries(PLACES).map(([k, p]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const f = same ? null : fareFor(d.from, d.to, d.type);
  return head + `<main class="wrap">${tabs}
    ${mapSVG({ from: d.from, to: same ? null : d.to, cars: SIM.map(s => ({ ...s.pos, a: 0 })) })}
    <section class="sheet">
      <div class="stack tight"><span class="label">Hi ${esc(first(me.name))}</span><h1>Where to?</h1></div>
      <div class="route">
        <span class="dot"></span><select id="from" data-draft="from" aria-label="Pickup">${opts(d.from)}</select>
        <button class="swap" data-act="swap" aria-label="Swap pickup and destination">⇅</button>
        <span class="rail"></span><span></span>
        <span class="sq"></span><select id="to" data-draft="to" aria-label="Destination">${opts(d.to)}</select>
      </div>
      ${same ? '<p class="err">Pick a destination different from your pickup.</p>' : `
      <div class="rides" role="group" aria-label="Ride type">${Object.entries(TYPES).map(([k, ty]) => { const fx = fareFor(d.from, d.to, k), car = nearestSim(A, k); return `<button class="ride" data-act="type" data-type="${k}" aria-pressed="${d.type === k}">${carIcon(k)}<div><h3>${ty.name} <span class="small muted">· ${ty.seats} seats</span></h3><p class="small muted">${minsBetween(car.pos, A)} min away · ${ty.blurb}</p></div><span class="fare">${money(fx.fare)}</span></button>`; }).join('')}</div>
      <div class="spread"><span class="small muted mono">${f.miles.toFixed(1)} mi · about ${f.mins} min</span>
        <div class="seg" role="group" aria-label="Payment"><button data-act="pay" data-pay="card" aria-pressed="${d.pay === 'card'}">Card</button><button data-act="pay" data-pay="cash" aria-pressed="${d.pay === 'cash'}">Cash</button></div></div>
      <button class="btn ink block" data-act="request" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Requesting…' : `Request ${TYPES[d.type].name} · ${money(f.fare)}`}</button>`}
    </section></main>`;
}
function tripMap(t) {
  const ph = phase(t);
  if (ph === 'searching') return mapSVG({ from: t.from, to: t.to, cars: SIM.map(s => ({ ...s.pos, a: 0 })) });
  if (ph === 'dropoff' || ph === 'completed') return '';
  return mapSVG({ from: t.from, to: t.to, approach: ph === 'arriving' ? t.start : null, mine: { ...carPos(t), id: t.id } });
}
function driverCard(t) {
  const d = t.driver;
  return `<div class="drv"><div class="avatar">${esc(initials(d.name))}</div><div class="stack tight"><h3>${esc(first(d.name))} <span class="small muted">★ ${Number(d.rating).toFixed(2)}</span></h3><span class="small muted">${esc(d.colour)} ${esc(d.car)}${d.sim ? ' · test driver' : ' · Safar X driver'}</span></div><span class="plate">${esc(d.plate)}</span></div>`;
}
function tripSheet(t) {
  const ph = phase(t);
  if (ph === 'searching') {
    const left = Math.max(0, Math.ceil((t.requestAt + SIM_AFTER - Date.now()) / 1000));
    return `<section class="sheet"><div class="pulse"><i></i></div><p class="status center">Finding your ${esc(TYPES[t.type].name)}</p>
      <p class="small muted center">${esc(PLACES[t.from].name)} → ${esc(PLACES[t.to].name)} · <span class="mono">${money(t.fare)}</span></p>
      <div class="note"><span>📡</span><span>Sent to Safar X drivers nearby. If nobody accepts in <b class="mono" data-simcount="${t.id}">${left}s</b>, a test driver takes the ride.</span></div>
      <div class="row"><button class="btn line sm" data-act="simNow" data-id="${t.id}">Use a test driver now</button><button class="btn danger sm" data-act="cancel" data-id="${t.id}">Cancel request</button></div></section>`;
  }
  if (ph === 'arriving' || ph === 'arrived') return `<section class="sheet">
      <div class="spread"><p class="status" data-eta="${t.id}">${ph === 'arrived' ? 'Your driver is outside' : etaText(t)}</p><span class="pill">${ph === 'arrived' ? 'Outside' : 'On the way'}</span></div>
      <div class="prog"><i data-prog="${t.id}" style="width:${(progress(t) * 100).toFixed(1)}%"></i></div>
      ${driverCard(t)}
      <div class="spread"><div class="stack tight"><span class="label">Your trip PIN</span><span class="small muted">Tell the driver before you get in</span></div><div class="pin">${String(t.pin).split('').map(c => `<span>${c}</span>`).join('')}</div></div>
      <button class="btn danger sm" data-act="cancel" data-id="${t.id}">Cancel ride</button></section>`;
  if (ph === 'ontrip') return `<section class="sheet">
      <div class="spread"><p class="status" data-eta="${t.id}">${etaText(t)}</p><span class="pill">On trip</span></div>
      <div class="prog"><i data-prog="${t.id}" style="width:${(progress(t) * 100).toFixed(1)}%"></i></div>
      ${driverCard(t)}<p class="small muted">Paying by ${t.pay === 'card' ? 'card' : 'cash'}</p></section>`;
  const d = t.driver;
  return `<section class="sheet">
      <div class="stack tight center"><span class="label">You've arrived</span><h1>${esc(PLACES[t.to].name)}</h1></div>
      <div class="stack tight">
        <div class="sumrow small"><span>Base fare</span><span class="mono">${money(t.parts.base)}</span></div>
        <div class="sumrow small"><span>Distance · ${t.miles.toFixed(1)} mi</span><span class="mono">${money(t.parts.dist)}</span></div>
        <div class="sumrow small"><span>Time · ${t.mins} min</span><span class="mono">${money(t.parts.time)}</span></div>
        ${ui.tip ? `<div class="sumrow small"><span>Tip for ${esc(first(d.name))}</span><span class="mono">${money(ui.tip)}</span></div>` : ''}
        <div class="sumrow total"><span>${t.pay === 'card' ? 'Total by card' : 'Pay in cash'}</span><span class="mono">${money(t.fare + ui.tip)}</span></div>
      </div>
      <h2 class="center">How was your ride with ${esc(first(d.name))}?</h2>
      <div class="stars" role="group" aria-label="Rate your driver">${[1, 2, 3, 4, 5].map(n => `<button data-act="star" data-n="${n}" class="${n <= ui.stars ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <div class="tips" role="group" aria-label="Add a tip">${[0, 1, 2, 3].map(n => `<button data-act="tip" data-n="${n}" aria-pressed="${ui.tip === n}">${n ? '£' + n : 'No tip'}</button>`).join('')}</div>
      <button class="btn ink block" data-act="finish" data-id="${t.id}">${ui.stars ? 'Submit and close' : 'Skip rating'}</button></section>`;
}
function viewKey() { const t = Account.token && activeTrip(); return (Account.token ? 'in' : 'out') + (t ? t.id + phase(t) : ''); }

/* ---------- actions ---------- */
const ACTIONS = {
  tab: d => { ui.tab = d.tab; render(true); },
  swap: () => { const f = prefs.draft.from; prefs.draft.from = prefs.draft.to; prefs.draft.to = f; savePrefs(); render(true); },
  type: d => { prefs.draft.type = d.type; savePrefs(); render(true); },
  pay: d => { prefs.draft.pay = d.pay; savePrefs(); render(true); },
  request: async () => {
    const d = prefs.draft; if (d.from === d.to || ui.busy) return;
    const f = fareFor(d.from, d.to, d.type), now = Date.now();
    const trip = { id: 'SF' + now.toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(), from: d.from, to: d.to, type: d.type, pay: d.pay,
      miles: f.miles, mins: f.mins, fare: f.fare, parts: f.parts, pin: String(Math.floor(1000 + Math.random() * 9000)), requestAt: now, rated: false, tip: 0 };
    ui.busy = true; ui.stars = 0; ui.tip = 0; render(true);
    try { await rpc('safar_request_trip', { p_token: Account.token, p_trip: trip }); trips.unshift(Object.assign({ status: 'searching', riderName: first(Account.me.name) }, trip)); }
    catch (e) { toast(APP_NAME, e.message); }
    ui.busy = false; render(true); poll();
  },
  simNow: d => { ui.simNow.add(d.id); tick(); },
  cancel: d => { patchTrip(d.id, { status: 'cancelled', cancelledAt: Date.now() }); toast(APP_NAME, 'Ride cancelled. You have not been charged.'); },
  star: d => { ui.stars = +d.n; render(true); },
  tip: d => { ui.tip = +d.n; render(true); },
  finish: d => {
    const t = trips.find(x => x.id === d.id), patch = { rated: true, rating: ui.stars || null, tip: ui.tip };
    if (t.status === 'ontrip') Object.assign(patch, { status: 'completed', completedAt: Date.now() });
    patchTrip(d.id, patch); ui.stars = 0; ui.tip = 0; ui.tab = 'ride';
  }
};
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.draft) { prefs.draft[t.dataset.draft] = t.value; savePrefs(); render(true); } });

/* ---------- clock ---------- */
function tick() {
  if (!Account.token) return;
  const now = Date.now(), t = activeTrip();
  if (t && !writing.has(t.id)) {
    if (t.status === 'searching' && (now - t.requestAt > SIM_AFTER || ui.simNow.has(t.id))) {
      const s = nearestSim(PLACES[t.from], t.type);
      patchTrip(t.id, { status: 'accepted', driver: { name: s.name, car: s.car, colour: s.colour, plate: s.plate, rating: s.rating, sim: true },
        start: { x: s.pos.x, y: s.pos.y }, acceptedAt: now, pickupDur: Math.max(5000, len(path(s.pos, PLACES[t.from])) / 40 * 1600), pickupMins: minsBetween(s.pos, PLACES[t.from]) }, true);
    } else if (t.status === 'accepted' && t.driver && t.driver.sim && now > t.acceptedAt + t.pickupDur + 3000) {
      patchTrip(t.id, { status: 'ontrip', startedAt: now, tripDur: 8000 + t.miles * 2500 }, true);
    }
    if (t.status === 'accepted' && phase(t, now) === 'arrived' && !arrivedSeen.has(t.id)) { arrivedSeen.add(t.id); toast(APP_NAME, `${first(t.driver.name)} is outside. Your PIN is ${t.pin}.`); }
  }
  if (viewKey() !== lastKey) { render(); return; }
  if (t) {
    const pt = carPos(t, now);
    document.querySelectorAll(`[data-car="${t.id}"]`).forEach(g => g.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)}) rotate(${(pt.a || 0).toFixed(0)})`));
    document.querySelectorAll(`[data-prog="${t.id}"]`).forEach(b => b.style.width = (progress(t, now) * 100).toFixed(1) + '%');
    document.querySelectorAll(`[data-eta="${t.id}"]`).forEach(x => { if (phase(t, now) !== 'arrived') x.textContent = etaText(t); });
    document.querySelectorAll(`[data-simcount="${t.id}"]`).forEach(x => x.textContent = Math.max(0, Math.ceil((t.requestAt + SIM_AFTER - now) / 1000)) + 's');
  }
}
function onLoggedIn() { ui.loaded = false; ui.tab = 'ride'; trips = []; poll(); }
setInterval(tick, 250);
setInterval(poll, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
render(true);
if (Account.token) { Account.refresh(); poll(); }
