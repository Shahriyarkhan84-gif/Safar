// Safar smoke tests: open both apps with a fake server and check the key screens and fare rules.
// Run: npm install jsdom && node tests/smoke.test.js
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failed++; };
const fakeServer = (calls) => async (url, opts) => {
  const fn = url.split('/rpc/')[1]; const body = JSON.parse((opts && opts.body) || '{}'); calls.push(fn);
  const ok = data => ({ ok: true, text: async () => JSON.stringify(data) });
  if (fn === 'safar_lookup') return ok({ exists: body.p_ident.includes('known') || body.p_ident === '7700900001' });
  if (fn === 'safar_login') return ok({ token: '00000000-0000-0000-0000-000000000001', account: { id: 'a1', name: 'Test Rider', email: 'known@example.com', phone: '7700900001', vehicle: { car: 'Toyota Prius', colour: 'White', plate: 'YK21 TST', types: ['go'] } } });
  if (fn === 'safar_my_trips' || fn === 'safar_my_reservations') return ok([]);
  if (fn === 'safar_driver_feed') return ok({ requests: [], trips: [] });
  if (fn === 'safar_log_error') return ok(null);
  return { ok: false, text: async () => JSON.stringify({ code: 'PGRST202', message: 'not found' }) };
};
function open(app) {
  const html = fs.readFileSync(path.join(__dirname, '..', app, 'index.html'), 'utf8').replace(/<script src="https:\/\/unpkg[^>]*><\/script>/, '');
  const calls = [], errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/', beforeParse(w) { w.fetch = fakeServer(calls); w.scrollTo = () => {}; w.WebSocket = undefined; } });
  dom.window.addEventListener('error', e => errors.push(e.message));
  const d = dom.window.document;
  return { w: dom.window, d, calls, errors,
    click: s => d.querySelector(s).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    type: (id, v) => { const el = d.getElementById(id); el.value = v; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); },
    txt: s => (d.querySelector(s) || {}).textContent || '' };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const [app, heading] of [['rides', 'Sign in to get a ride'], ['driver', 'Sign in to drive']]) {
    const A = open(app); await wait(200);
    check(`${app}: sign-in screen shows`, A.txt('h1').includes(heading), A.txt('h1'));
    A.click('[data-act="authContinue"]'); check(`${app}: empty sign-in shows an error`, A.txt('.err').length > 0);
    A.type('au-ident', 'new.person@example.com'); A.click('[data-act="authContinue"]'); await wait(200);
    check(`${app}: new email goes to sign-up`, !!A.d.getElementById('au-name'));
    A.click('[data-act="authStep"][data-step="start"]'); A.type('au-ident', '07700 900001'); A.click('[data-act="authContinue"]'); await wait(200);
    A.type('au-password', 'secret-pass'); A.click('[data-act="login"]'); await wait(400);
    check(`${app}: logs in`, A.calls.includes('safar_login') && !A.d.getElementById('au-password'));
    check(`${app}: no script errors`, A.errors.length === 0, A.errors.join('; '));
    if (app === 'rides') {
      const w = A.w;
      const tue = new Date('2026-10-20T12:00:00').getTime(), rush = new Date('2026-10-20T17:00:00').getTime(), sat = new Date('2026-10-24T23:30:00').getTime();
      check('fares: quiet time has no busy charge', !w.eval(`fareFor('home','station','go',${tue}).busy`));
      check('fares: 5pm weekday is busy', w.eval(`fareFor('home','station','go',${rush}).busy`));
      check('fares: Saturday night is busy', w.eval(`fareFor('home','station','go',${sat}).busy`));
      check('fares: busy is 25% more', Math.abs(w.eval(`fareFor('home','station','go',${rush}).full / fareFor('home','station','go',${tue}).full`) - 1.25) < 0.01);
      check('fares: airport adds £3', Math.abs(w.eval(`fareFor('home','airport','go',${tue}).parts.airport`) - 3) < 0.001);
      check('fares: Green is 10% off', w.eval(`fareFor('home','station','green',${tue}).fare < fareFor('home','station','green',${tue}).full`));
      check('fares: minimum fare applies', w.eval(`fareFor('trinity','station','go',${tue}).full`) >= 5);
      A.click('.where .go'); await wait(100); A.click('[data-act="pickTo"][data-to="station"]'); await wait(100);
      check('rides: ride options show 4 types', A.d.querySelectorAll('.ride').length === 4);
    } else {
      check('driver: shows waiting screen', A.txt('.status').includes('Looking for riders') || A.txt('.status').includes('offline'), A.txt('.status'));
    }
  }
  console.log(failed ? `\n${failed} test(s) failed` : '\nAll tests passed');
  process.exit(failed ? 1 : 0);
})();
