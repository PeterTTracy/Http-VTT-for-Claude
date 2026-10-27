// Carried light, moods, quick-map ambience, the welcome card, toasts and keys.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(f));
});

const SCENE = {
  header: 'Dark Hall', rows: 12, cols: 12, ground: 'stone', fow: true, ambient: 'dark',
  tokens: [
    { id: 'kira', name: 'Kira', at: 'C3', kind: 'pc', art: 'fighter', hp: 20 },
    { id: 'gob', name: 'Goblin', at: 'J10', kind: 'foe', art: 'goblin', hp: 6 },
  ],
};

(async () => {
  await new Promise(r => server.listen(8945, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:8945/');
  await page.waitForTimeout(500);
  const checks = [];
  const ev = (f, a) => page.evaluate(f, a);

  // ---------- carried light ----------
  await ev(sc => VTT.apply({ do: 'scene', scene: sc }), SCENE);
  const lit = () => ev(() => { const t = VTT.state().tokens.find(t => t.id === 'kira'); return lightGrid[t.r][t.c]; });
  checks.push(['a dark room starts unlit', (await lit()) === 0]);
  let out = await ev(() => VTT.apply({ do: 'light', t: 'kira', carry: 'torch' }));
  checks.push(['a torch lights its bearer', (await lit()) === 2]);
  checks.push(['the torch is saved on the token', await ev(() => VTT.state().tokens.find(t => t.id === 'kira').light?.kind === 'torch')]);
  await ev(() => VTT.apply({ do: 'move', t: 'kira', to: 'H8' }));
  checks.push(['the light moves with the token', (await lit()) === 2]);
  checks.push(['moving the light reveals fog around it', await ev(() => { const t = VTT.state().tokens.find(t => t.id === 'kira'); return lightGrid[t.r][t.c + 3] >= 1; })]);
  await ev(() => VTT.apply({ do: 'light', t: 'kira', carry: 'none' }));
  checks.push(['putting it out darkens the square', (await lit()) === 0]);
  const bad = await ev(() => { try { return checkCmds([{ do: 'light', t: 'kira', carry: 'flamethrower' }]); } catch (e) { return [String(e)]; } });
  checks.push(['an unknown light is refused with the list', /unknown light.*torch/.test(JSON.stringify(bad))]);

  // ---------- moods ----------
  await ev(() => VTT.apply({ do: 'mood', type: 'bloodmoon' }));
  checks.push(['mood is set', await ev(() => VTT.state().mood === 'bloodmoon')]);
  checks.push(['mood is written into the scene JSON', await ev(() => sceneToJSON(VTT.state()).mood === 'bloodmoon')]);
  const badMood = await ev(() => checkCmds([{ do: 'mood', type: 'disco' }]));
  checks.push(['an unknown mood is refused', /unknown mood/.test(JSON.stringify(badMood))]);
  checks.push(['the builder offers every mood', await ev(() => { openSide('build', true); return document.querySelectorAll('#bmood option').length === Object.keys(MOODS).length; })]);

  // ---------- quick maps carry their mood and light ----------
  const qm = await ev(() => QUICK_MAPS.map(q => { const sc = q.make(42); VTT.apply({ do: 'scene', scene: sc });
    const S = VTT.state(); return { id: q.id, mood: S.mood, lights: S.tokens.filter(t => t.light).length }; }));
  const crypt = qm.find(q => q.id === 'crypt'), chapel = qm.find(q => q.id === 'chapel');
  checks.push(['the crypt party carries two torches', crypt && crypt.lights === 2]);
  checks.push(['the chapel is firelit', chapel && chapel.mood === 'firelit']);
  checks.push(['every quick map builds with no errors', qm.length >= 7 && errors.length === 0]);

  // ---------- toasts and shortcuts ----------
  await ev(sc => VTT.apply({ do: 'scene', scene: sc }), SCENE);
  await ev(() => VTT.apply({ do: 'combat' }));
  const r0 = await ev(() => VTT.state().active);
  await page.mouse.click(5, 5);
  await page.keyboard.press('n');
  await page.waitForTimeout(150);
  checks.push(['n advances the turn', await ev(r0 => VTT.state().active !== r0, r0)]);
  checks.push(['a toast says whose turn it is', await ev(() => /turn/.test(document.getElementById('toast').textContent) && /show/.test(document.getElementById('toast').className))]);
  await page.keyboard.press('c');
  await page.waitForTimeout(150);
  checks.push(['c opens the combat tracker', await ev(() => !document.getElementById('side').hidden && !document.getElementById('p-combat').hidden)]);
  await page.keyboard.press('?');
  checks.push(['? lists the keys', await ev(() => /Keys:/.test(document.getElementById('toast').textContent))]);
  const fail0 = await ev(() => { document.getElementById('gmconsole').classList.remove('show'); VTT.apply({ do: 'move', t: 'nobody', to: 'A1' }); return document.getElementById('toast').textContent; });
  checks.push(['a failed command toasts when the console is shut', /nobody|unknown|no token/i.test(fail0)]);

  // ---------- welcome ----------
  checks.push(['the welcome card stays away in automated browsers', await ev(() => document.getElementById('welcome').hidden)]);
  await page.goto('http://localhost:8945/?welcome=1');
  await page.waitForTimeout(500);
  checks.push(['?welcome shows the card', await ev(() => !document.getElementById('welcome').hidden)]);
  checks.push(['the card shows portraits', await ev(() => document.querySelectorAll('#welcome .wl-heroes img').length >= 5)]);
  await page.screenshot({ path: path.join(__dirname, 'ambience-welcome.png') });
  await page.keyboard.press('n');
  checks.push(['keys are ignored while the card is open', await ev(() => !document.getElementById('welcome').hidden)]);
  await page.click('[data-wl="combat"]');
  await page.waitForTimeout(150);
  checks.push(['a step closes the card and opens its panel', await ev(() => document.getElementById('welcome').hidden && !document.getElementById('p-combat').hidden)]);
  checks.push(['closing remembers it was seen', await ev(() => localStorage.getItem('vtt-welcomed') === '1')]);
  await page.setViewportSize({ width: 390, height: 844 });
  await ev(() => showWelcome());
  await page.waitForTimeout(150);
  const ph = await ev(() => { const r = document.querySelector('#welcome .wl-card').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, b: r.bottom, h: innerHeight }; });
  checks.push(['the card fits a phone', ph.l >= 0 && ph.r <= ph.w && ph.b <= ph.h + 1]);
  await page.screenshot({ path: path.join(__dirname, 'ambience-phone.png') });
  await page.keyboard.press('Escape');
  checks.push(['Escape closes the card', await ev(() => document.getElementById('welcome').hidden)]);

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
