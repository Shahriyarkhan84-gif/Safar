/* ===== Safar Rides: the rider app (dark design) ===== */
const APP_NAME = 'Safar Rides';
Account.init('rides');
const prefs = Object.assign({ draft: { from: 'home', to: 'station', type: 'go', pay: 'card' }, reservations: [] }, LS.get('safar-rides-prefs', {}));
const savePrefs = () => LS.set('safar-rides-prefs', prefs);
const ui = { tab: 'home', screen: null, later: null, laterOpen: false, stars: 0, tip: 0, simNow: new Set(), busy: false, loaded: false };
let trips = [];
const writing = new Set();
const arrivedSeen = new Set();

/* ---------- icons and drawings ---------- */
const I = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2 3 10.5V21h6.5v-6h5v6H21V10.5z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'
};
const art = (kind) => {
  const body = { go: '#f4f5f7', green: '#3ccf8e', comfort: '#c9ced8', xl: '#f4f5f7', later: '#f4f5f7' }[kind] || '#f4f5f7';
  if (kind === 'later') return `<svg viewBox="0 0 64 40" aria-hidden="true"><rect x="14" y="4" width="36" height="32" rx="7" fill="${body}"/><rect x="14" y="4" width="36" height="9" rx="4" fill="#5b7cff"/><circle cx="32" cy="24" r="8" fill="none" stroke="#111214" stroke-width="2.6"/><path d="M32 19v5l3 2" stroke="#111214" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;
  const long = kind === 'xl';
  return `<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M${long ? 4 : 8} 24 L${long ? 12 : 16} 13 Q${long ? 14 : 18} 10 ${long ? 18 : 22} 10 H${long ? 48 : 42} Q${long ? 52 : 46} 10 ${long ? 55 : 49} 14 L${long ? 60 : 56} 24 Z" fill="${body}" opacity=".9"/><rect x="${long ? 2 : 6}" y="22" width="${long ? 60 : 52}" height="9" rx="4" fill="${body}"/><path d="M${long ? 15 : 19} 13 H${long ? 30 : 31} V21 H${long ? 11 : 15} Z M${long ? 33 : 34} 13 H${long ? 46 : 41} L${long ? 50 : 45} 21 H${long ? 33 : 34} Z" fill="#111214" opacity=".55"/><circle cx="${long ? 14 : 17}" cy="31" r="5" fill="#111214"/><circle cx="${long ? 14 : 17}" cy="31" r="2.2" fill="#9aa0aa"/><circle cx="${long ? 50 : 47}" cy="31" r="5" fill="#111214"/><circle cx="${long ? 50 : 47}" cy="31" r="2.2" fill="#9aa0aa"/>${kind === 'green' ? '<path d="M30 3c6 0 8 4 8 4s-4 3-8 1c-2-1-2-3 0-5z" fill="#3ccf8e"/>' : ''}</svg>`;
};
const timeLabel = ts => {
  const d = new Date(ts), now = new Date(), t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  return d.toDateString() === now.toDateString() ? 'Today ' + t : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow ' + t : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + t;
};
function laterOptions() {
  const now = Date.now(), round = ts => Math.ceil(ts / 300000) * 300000, out = [];
  out.push(['In 15 min', round(now + 15 * 60000)], ['In 30 min', round(now + 30 * 60000)], ['In 1 hour', round(now + 60 * 60000)]);
  const ev = new Date(); ev.setHours(18, 0, 0, 0); if (ev.getTime() > now + 20 * 60000) out.push(['Today 18:00', ev.getTime()]);
  const tm = new Date(); tm.setDate(tm.getDate() + 1); tm.setHours(8, 0, 0, 0); out.push(['Tomorrow 08:00', tm.getTime()]);
  return out;
}

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
async function requestRide(d, reserved) {
  if (d.from === d.to || ui.busy) return false;
  const f = fareFor(d.from, d.to, d.type), now = Date.now();
  const trip = { id: 'SF' + now.toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(), from: d.from, to: d.to, type: d.type, pay: d.pay,
    miles: f.miles, mins: f.mins, fare: f.fare, parts: f.parts, pin: String(Math.floor(1000 + Math.random() * 9000)), requestAt: now, rated: false, tip: 0, reserved: !!reserved };
  ui.busy = true; ui.stars = 0; ui.tip = 0; render(true);
  let ok = false;
  try { await rpc('safar_request_trip', { p_token: Account.token, p_trip: trip }); trips.unshift(Object.assign({ status: 'searching', riderName: first(Account.me.name) }, trip)); ok = true; }
  catch (e) { toast(APP_NAME, e.message); }
  ui.busy = false; ui.screen = null; render(true); poll(); return ok;
}

/* ---------- views ---------- */
function view() {
  if (!Account.token) return authView({ app: 'rides', name: APP_NAME, logo: LOGO_R, tagline: 'Rides across Leeds, booked in seconds.', signupTitle: 'Create your account', signupNote: 'Your driver sees your first name when they pick you up.', namePh: 'Sara Hussain', termsText: 'I agree to the Safar Rides terms and privacy policy', other: 'Want to drive? Get the <b>Safar X</b> driver app.' });
  if (!ui.loaded) return `<main class="wrap"><div class="empty">Loading your rides…</div></main>`;
  const t = activeTrip();
  if (t) return `<main class="wrap flush"><div class="locbar"><span class="brandmini">${LOGO_R}Safar Rides</span></div>${tripMap(t)}${tripSheet(t)}</main>`;
  if (ui.screen === 'where') return whereView();
  if (ui.screen === 'options') return optionsView();
  const body = ui.tab === 'services' ? servicesView() : ui.tab === 'activity' ? activityView() : ui.tab === 'account' ? accountView() : homeView();
  return `<main class="wrap">${body}</main>${tabbar()}`;
}
function tabbar() {
  const tabs = [['home', 'Home', I.home], ['services', 'Services', I.grid], ['activity', 'Activity', I.receipt], ['account', 'Account', I.user]];
  return `<nav class="tabbar" aria-label="Main">${tabs.map(([k, l, ic]) => `<button data-act="tab" data-tab="${k}" aria-current="${ui.tab === k}">${ic}<span>${l}</span></button>`).join('')}</nav>`;
}
function homeView() {
  const me = Account.me || { name: '' }, d = prefs.draft;
  const recentKeys = [...new Set(trips.filter(x => x.status === 'completed').map(x => x.to))].filter(k => k !== d.from).slice(0, 2);
  const recents = (recentKeys.length ? recentKeys : ['station', 'kirkstall'].filter(k => k !== d.from)).slice(0, 2);
  return `
    <div class="locbar"><button class="locpill" data-act="openWhere" aria-label="Change pickup"><i class="bluedot"></i><span>${esc(PLACES[d.from].name)}</span> <span class="muted">⌄</span></button><span class="brandmini">${LOGO_R}</span></div>
    <div class="where"><button class="go" data-act="openWhere">${I.search}<span>Where to?</span></button><button class="later ${ui.later ? 'on' : ''}" data-act="toggleLater">${I.cal}${ui.later ? esc(timeLabel(ui.later).replace('Today ', '')) : 'Later'}</button></div>
    ${ui.laterOpen ? `<div class="stack tight"><span class="label">Pickup time</span><div class="whenrow" role="group" aria-label="Pickup time"><button data-act="setLater" data-at="0" aria-pressed="${!ui.later}">Now</button>${laterOptions().map(([l, at]) => `<button data-act="setLater" data-at="${at}" aria-pressed="${ui.later === at}">${l}</button>`).join('')}</div></div>` : ''}
    <section class="recents" aria-label="Recent places">${recents.map(k => `<button class="prow" data-act="pickTo" data-to="${k}"><span class="ic">${I.clock}</span><span><b>${esc(PLACES[k].name)}</b><small>${esc(PLACES[k].area)}</small></span><span class="chev">›</span></button>`).join('')}</section>
    <section><h2 class="sechead">For you, ${esc(first(me.name))}</h2>
      <div class="tiles">
        <button class="tile" data-act="openWhere"><span class="disc">${art('go')}</span>Trip</button>
        <button class="tile" data-act="pickType" data-type="green"><span class="badge2">10% off</span><span class="disc">${art('green')}</span>Green</button>
        <button class="tile" data-act="toggleLater" data-open="1"><span class="disc">${art('later')}</span>Reserve</button>
        <button class="tile" data-act="pickType" data-type="xl"><span class="disc">${art('xl')}</span>Group</button>
        <button class="tile" data-act="pickType" data-type="comfort"><span class="disc">${art('comfort')}</span>Comfort</button>
      </div></section>
    <section class="stack"><h2 class="sechead">Ways to ride</h2>
      <div class="offers">
        <button class="offer green" data-act="pickType" data-type="green"><span class="tag">10% off</span><span class="stack tight"><b>Ride electric for less</b><small>Safar Green is 10% off across Leeds</small></span>${art('green')}</button>
        <button class="offer blue" data-act="toggleLater" data-open="1"><span class="tag">New</span><span class="stack tight"><b>Book a ride for later</b><small>Pick a time and we'll find your driver</small></span>${art('later')}</button>
        <button class="offer plum" data-act="pickType" data-type="xl"><span class="tag">6 seats</span><span class="stack tight"><b>Room for the whole group</b><small>Safar XL fits six and their bags</small></span>${art('xl')}</button>
      </div></section>`;
}
function whereView() {
  const d = prefs.draft;
  const opts = sel => Object.entries(PLACES).map(([k, p]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return `<main class="wrap flush">
    <div class="screenhead"><button class="back" data-act="close" aria-label="Back">${I.back}</button><h2>Plan your ride</h2></div>
    ${ui.later ? `<div class="note"><span>📅</span><span>Pickup ${esc(timeLabel(ui.later))} · <button class="linkbtn" data-act="toggleLater" data-open="1">Change</button></span></div>` : ''}
    <div class="planbox"><span class="dot"></span><select id="from" data-draft="from" aria-label="Pickup">${opts(d.from)}</select>
      <span class="sq"></span><input id="q" data-q type="search" placeholder="Where to?" autocomplete="off" aria-label="Destination"></div>
    <section class="recents" id="results">${Object.entries(PLACES).filter(([k]) => k !== d.from).map(([k, p]) => `<button class="prow" data-act="pickTo" data-to="${k}" data-name="${esc((p.name + ' ' + p.area).toLowerCase())}"><span class="ic">${I.pin}</span><span><b>${esc(p.name)}</b><small>${esc(p.area)}</small></span><span class="chev">›</span></button>`).join('')}</section>
    <p class="empty" id="noresults" hidden>No places in Leeds match that yet.</p></main>`;
}
function optionsView() {
  const d = prefs.draft, A = PLACES[d.from], f = fareFor(d.from, d.to, d.type);
  return `<main class="wrap flush">
    <div class="screenhead"><button class="back" data-act="openWhere" aria-label="Back">${I.back}</button><div class="stack tight" style="min-width:0"><h2>${esc(PLACES[d.from].name)} → ${esc(PLACES[d.to].name)}</h2><span class="small muted">${f.miles.toFixed(1)} mi · about ${f.mins} min${ui.later ? ' · pickup ' + esc(timeLabel(ui.later)) : ''}</span></div></div>
    ${mapSVG({ from: d.from, to: d.to, cars: SIM.map(s => ({ ...s.pos, a: 0 })) })}
    <section class="sheet"><h2>Choose a ride</h2>
      <div class="rides" role="group" aria-label="Ride type">${Object.entries(TYPES).map(([k, ty]) => { const fx = fareFor(d.from, d.to, k), car = nearestSim(A, k); return `<button class="ride" data-act="type" data-type="${k}" aria-pressed="${d.type === k}">${art(k)}<div><h3>${ty.name} <span class="small muted">· ${ty.seats} seats</span></h3><p class="small muted">${ui.later ? ty.blurb : minsBetween(car.pos, A) + ' min away · ' + ty.blurb}</p></div><span class="fare">${money(fx.fare)}${ty.promo ? `<span class="strike">${money(fx.full)}</span>` : ''}</span></button>`; }).join('')}</div>
      <div class="spread"><span class="small muted">Payment</span><div class="seg" role="group" aria-label="Payment"><button data-act="pay" data-pay="card" aria-pressed="${d.pay === 'card'}">Card</button><button data-act="pay" data-pay="cash" aria-pressed="${d.pay === 'cash'}">Cash</button></div></div>
      <button class="btn block" data-act="${ui.later ? 'reserve' : 'request'}" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Requesting…' : ui.later ? `Reserve ${TYPES[d.type].name} · ${esc(timeLabel(ui.later))}` : `Choose ${TYPES[d.type].name} · ${money(f.fare)}`}</button>
    </section></main>`;
}
function servicesView() {
  return `<h1>Services</h1><p class="muted">Every way to get around Leeds with Safar.</p>
    <div class="grid4">${Object.entries(TYPES).map(([k, ty]) => `<button class="svc" data-act="pickType" data-type="${k}">${ty.promo ? '<span class="badge2">10% off</span>' : ''}${art(k)}<span><b>${ty.name}</b><br><small>${ty.blurb} · ${ty.seats} seats</small></span></button>`).join('')}
      <button class="svc" data-act="toggleLater" data-open="1">${art('later')}<span><b>Reserve</b><br><small>Book a pickup time ahead</small></span></button></div>`;
}
function activityView() {
  const done = trips.filter(x => x.status === 'completed' || x.status === 'cancelled'), res = prefs.reservations.slice().sort((a, b) => a.at - b.at);
  return `<h1>Activity</h1>
    <section class="stack"><h2>Upcoming</h2>${res.length ? `<div class="menu">${res.map(r => `<div><span><b>${esc(PLACES[r.from].name)} → ${esc(PLACES[r.to].name)}</b><br><span class="small muted">${esc(timeLabel(r.at))} · ${TYPES[r.type].name}</span></span><button class="btn danger sm" data-act="unreserve" data-id="${r.id}">Cancel</button></div>`).join('')}</div>
      <p class="small muted">Keep Safar Rides open on your phone: reserved rides are sent to drivers at pickup time.</p>` : '<div class="empty">No reserved rides. Tap Later on Home to book ahead.</div>'}</section>
    <section class="stack"><h2>Past</h2>${done.length ? `<div class="menu">${done.map(x => `<div><span><b>${esc(PLACES[x.to].name)}</b><br><span class="small muted">${ago(x.requestAt)} · ${TYPES[x.type].name}${x.driver ? ' · ' + esc(first(x.driver.name)) : ''}</span></span><span class="mono">${x.status === 'cancelled' ? 'Cancelled' : money(x.fare + (x.tip || 0))}</span></div>`).join('')}</div>` : '<div class="empty">Your trips will show here.</div>'}</section>`;
}
function accountView() {
  const me = Account.me || {};
  return `<div class="drv" style="grid-template-columns:64px 1fr"><div class="avatar" style="width:64px;height:64px;font-size:1.3rem">${esc(initials(me.name))}</div><div class="stack tight"><h1>${esc(me.name || '')}</h1><span class="small muted">★ Safar rider</span></div></div>
    <div class="menu"><div><span class="muted">Email</span><span>${esc(me.email || '')}</span></div><div><span class="muted">Mobile</span><span class="mono">${me.phone ? showPhone(me.phone) : ''}</span></div>
      <div><span class="muted">Pay with</span><div class="seg" role="group" aria-label="Default payment"><button data-act="pay" data-pay="card" aria-pressed="${prefs.draft.pay === 'card'}">Card</button><button data-act="pay" data-pay="cash" aria-pressed="${prefs.draft.pay === 'cash'}">Cash</button></div></div>
      <div><span class="muted">Trips taken</span><span class="mono">${trips.filter(x => x.status === 'completed').length}</span></div></div>
    <p class="small muted">Want to drive with Safar? Get the <b>Safar X</b> driver app.</p>
    <button class="btn line" data-act="logout">Log out</button>`;
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
      <div class="stack tight center"><span class="label">You've arrived</span><h1>${esc(PLACES[t.to].name)}</h1><span class="small muted">${esc(PLACES[t.to].area)}</span></div>
      <div class="stack tight">
        <div class="sumrow small"><span>Base fare</span><span class="mono">${money(t.parts.base)}</span></div>
        <div class="sumrow small"><span>Distance · ${t.miles.toFixed(1)} mi</span><span class="mono">${money(t.parts.dist)}</span></div>
        <div class="sumrow small"><span>Time · ${t.mins} min</span><span class="mono">${money(t.parts.time)}</span></div>
        ${t.parts.promo ? `<div class="sumrow small" style="color:var(--ok)"><span>Safar Green 10% off</span><span class="mono">−${money(-t.parts.promo)}</span></div>` : ''}
        ${ui.tip ? `<div class="sumrow small"><span>Tip for ${esc(first(d.name))}</span><span class="mono">${money(ui.tip)}</span></div>` : ''}
        <div class="sumrow total"><span>${t.pay === 'card' ? 'Total by card' : 'Pay in cash'}</span><span class="mono">${money(t.fare + ui.tip)}</span></div>
      </div>
      <h2 class="center">How was your ride with ${esc(first(d.name))}?</h2>
      <div class="stars" role="group" aria-label="Rate your driver">${[1, 2, 3, 4, 5].map(n => `<button data-act="star" data-n="${n}" class="${n <= ui.stars ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <div class="tips" role="group" aria-label="Add a tip">${[0, 1, 2, 3].map(n => `<button data-act="tip" data-n="${n}" aria-pressed="${ui.tip === n}">${n ? '£' + n : 'No tip'}</button>`).join('')}</div>
      <button class="btn block" data-act="finish" data-id="${t.id}">${ui.stars ? 'Submit and close' : 'Skip rating'}</button></section>`;
}
function viewKey() { const t = Account.token && activeTrip(); return (Account.token ? 'in' : 'out') + (t ? t.id + phase(t) : '') + (ui.loaded ? 'L' : ''); }

/* ---------- actions ---------- */
const ACTIONS = {
  tab: d => { ui.tab = d.tab; ui.screen = null; ui.laterOpen = false; render(true); window.scrollTo(0, 0); },
  openWhere: () => { ui.screen = 'where'; render(true); window.scrollTo(0, 0); setTimeout(() => { const q = document.getElementById('q'); if (q) q.focus(); }, 50); },
  close: () => { ui.screen = null; render(true); },
  toggleLater: d => { if (ui.screen) { ui.screen = null; ui.tab = 'home'; } ui.laterOpen = d.open ? true : !ui.laterOpen; ui.tab = 'home'; render(true); window.scrollTo(0, 0); },
  setLater: d => { ui.later = +d.at || null; ui.laterOpen = false; render(true); if (ui.later) toast(APP_NAME, `Pickup set for ${timeLabel(ui.later)}. Now choose where to.`); },
  pickTo: d => { if (d.to === prefs.draft.from) return; prefs.draft.to = d.to; savePrefs(); ui.screen = 'options'; render(true); window.scrollTo(0, 0); },
  pickType: d => { prefs.draft.type = d.type; savePrefs(); ui.tab = 'home'; ACTIONS.openWhere(); },
  type: d => { prefs.draft.type = d.type; savePrefs(); render(true); },
  pay: d => { prefs.draft.pay = d.pay; savePrefs(); render(true); },
  request: () => { requestRide(prefs.draft); },
  reserve: () => {
    const d = prefs.draft, r = { id: 'R' + Date.now().toString(36), from: d.from, to: d.to, type: d.type, pay: d.pay, at: ui.later };
    prefs.reservations.push(r); savePrefs();
    toast(APP_NAME, `Reserved: ${TYPES[d.type].name} to ${PLACES[d.to].name}, ${timeLabel(r.at)}.`);
    ui.later = null; ui.screen = null; ui.tab = 'activity'; render(true); window.scrollTo(0, 0);
  },
  unreserve: d => { prefs.reservations = prefs.reservations.filter(r => r.id !== d.id); savePrefs(); render(true); toast(APP_NAME, 'Reservation cancelled.'); },
  simNow: d => { ui.simNow.add(d.id); tick(); },
  cancel: d => { patchTrip(d.id, { status: 'cancelled', cancelledAt: Date.now() }); toast(APP_NAME, 'Ride cancelled. You have not been charged.'); },
  star: d => { ui.stars = +d.n; render(true); },
  tip: d => { ui.tip = +d.n; render(true); },
  finish: d => {
    const t = trips.find(x => x.id === d.id), patch = { rated: true, rating: ui.stars || null, tip: ui.tip };
    if (t.status === 'ontrip') Object.assign(patch, { status: 'completed', completedAt: Date.now() });
    patchTrip(d.id, patch); ui.stars = 0; ui.tip = 0; ui.tab = 'home';
  }
};
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.draft) { prefs.draft[t.dataset.draft] = t.value; if (prefs.draft.to === prefs.draft.from) prefs.draft.to = Object.keys(PLACES).find(k => k !== t.value); savePrefs(); render(true); } });
document.addEventListener('input', e => {
  if (!e.target.hasAttribute || !e.target.hasAttribute('data-q')) return;
  const q = e.target.value.trim().toLowerCase(); let n = 0;
  document.querySelectorAll('#results .prow').forEach(r => { const ok = r.dataset.name.includes(q); r.hidden = !ok; if (ok) n++; });
  const nr = document.getElementById('noresults'); if (nr) nr.hidden = n > 0;
});

/* ---------- clock ---------- */
function tick() {
  if (!Account.token) return;
  const now = Date.now(), t = activeTrip();
  if (!t && ui.loaded && !ui.busy) {
    const due = prefs.reservations.find(r => r.at <= now);
    if (due) { prefs.reservations = prefs.reservations.filter(r => r !== due); savePrefs(); toast(APP_NAME, `Your reserved ride to ${PLACES[due.to].name} is being sent to drivers.`); requestRide(due, true); return; }
  }
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
function onLoggedIn() { ui.loaded = false; ui.tab = 'home'; ui.screen = null; trips = []; poll(); }
setInterval(tick, 250);
setInterval(poll, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
render(true);
if (Account.token) { Account.refresh(); poll(); }
