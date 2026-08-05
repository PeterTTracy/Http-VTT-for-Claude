const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.VTT_SHOTS || __dirname;
let feedBody = null; // when set, served at /feed.json

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/feed.json') {
    if (!feedBody) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type':'application/json'}); res.end(feedBody); return;
  }
  const f = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type':'text/html'}); res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => server.listen(8931, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

  // feed exists from boot so polling arms itself
  feedBody = JSON.stringify({ seq: 0, batch: [] });

  await page.goto('http://localhost:8931/');
  await page.waitForTimeout(700);

  const t = await page.title();
  console.log('title:', t);
  console.log('tokens on board:', await page.locator('.token').count());
  console.log('chips:', await page.locator('.chip').count());

  // 1. GM batch via the programmatic hook
  const n = await page.evaluate(() => window.VTT.apply([
    { do: 'say', text: 'A skeleton claws out of the shingle!', tone: 'danger' },
    { do: 'spawn', token: { id: 'sc', name: 'Skel C', label: 'c', at: 'C4', kind: 'foe', icon: 'skeleton', hp: 13 }, init: {} },
    { do: 'move', t: 'K', to: 'F6' },
    { do: 'damage', t: 'sa', n: 7 },
    { do: 'heal', t: 'B', n: 3 },
    { do: 'cond', t: 'K', add: ['prone', 'c-burning'] },
    { do: 'marker', marker: { shape: 'circle', at: 'F6', ft: 10, color: 'purple', label: 'web' } },
    { do: 'marker', marker: { shape: 'cone', at: 'K7', ft: 15, dir: 'N', color: 'red', label: 'burning hands' } },
    { do: 'zone', from: 'P13', to: 'P16', type: 'dark' },
    { do: 'next' },
    { do: 'status', t: 'sb', st: 'down' },
    { do: 'bogus_cmd' },
  ]));
  console.log('batch applied ok-count (12 cmds, 1 intentionally bogus):', n);

  const st = await page.evaluate(() => window.VTT.stateForGM());
  console.log('stateForGM:', JSON.stringify(st, null, 1));

  const checks = [];
  const tok = id => st.tokens.find(x => x.id === id);
  checks.push(['K moved to F6', tok('K').at === 'F6']);
  checks.push(['K conds prone+burning', JSON.stringify(tok('K').conds) === '["prone","burning"]']);
  checks.push(['Skel A 6/13 hurt', tok('sa').hp === '6/13' && tok('sa').status === 'hurt']);
  checks.push(['Skel B down', tok('sb').status === 'down']);
  checks.push(['Skel C spawned', !!tok('sc')]);
  checks.push(['turn advanced', st.turn === 'Skel A 14']);
  checks.push(['2 markers', st.markers.length === 2]);
  checks.push(['banner shown', await page.locator('#banner.show').count() === 1]);
  checks.push(['hp bars', await page.locator('.token .hp').count() >= 6]);
  checks.push(['ok-count is 11', n === 11]);

  // 2. undo restores pre-batch state
  await page.locator('#gmtoggle').click();
  await page.locator('#gmundo').click();
  await page.waitForTimeout(600); // token rebuild
  const st2 = await page.evaluate(() => window.VTT.stateForGM());
  checks.push(['undo restored K at J5', st2.tokens.find(x => x.id === 'K').at === 'J5']);
  checks.push(['undo removed Skel C', !st2.tokens.find(x => x.id === 'sc')]);

  // 3. paste path: fenced JSON through the console textarea
  await page.fill('#gmin', '```json\n[{"do":"move","t":"Bren","to":"A1"},{"do":"say","text":"The tide turns."}]\n```');
  await page.locator('#gmapply').click();
  const st3 = await page.evaluate(() => window.VTT.stateForGM());
  checks.push(['fenced paste moved Bren to A1', st3.tokens.find(x => x.id === 'B').at === 'A1']);

  // 4. feed polling applies a new seq
  feedBody = JSON.stringify({ seq: 1, batch: [{ do: 'move', t: 'K', to: 'P16' }] });
  await page.waitForTimeout(2600);
  const st4 = await page.evaluate(() => window.VTT.stateForGM());
  checks.push(['feed live indicator', (await page.locator('#feedstat.live').count()) === 1]);
  checks.push(['feed moved K to P16', st4.tokens.find(x => x.id === 'K').at === 'P16']);

  // 5. full scene swap via paste (scene object, not commands)
  await page.fill('#gmin', JSON.stringify({
    header: 'Wrecker\'s Lighthouse', sub: 'storm · 1 square = 5 ft', ground: 'stone',
    rows: 12, cols: 12,
    zones: [{ from: 'A1', to: 'L2', type: 'water' }],
    props: [{ kind: 'hearth', at: 'F6' }],
    tokens: [
      { id: 'K', name: 'Kira', at: 'J3', kind: 'pc', icon: 'swordwoman', hp: 24 },
      { id: 'gh', name: 'Ghost', at: 'C9', kind: 'foe', icon: 'ghost', hp: 20 }],
    initiative: [{ name: 'Kira 15', t: 'K' }, { name: 'Ghost 11', t: 'gh' }],
  }));
  await page.locator('#gmapply').click();
  await page.waitForTimeout(300);
  const st5 = await page.evaluate(() => window.VTT.stateForGM());
  checks.push(['scene swapped', st5.scene === 'Wrecker\'s Lighthouse' && st5.tokens.length === 2]);
  checks.push(['12x12 grid', await page.evaluate(() => window.VTT.state().rows) === 12]);

  // 6. persistence roundtrip (localStorage path)
  await page.reload();
  await page.waitForTimeout(700);
  const st6 = await page.evaluate(() => window.VTT.stateForGM());
  checks.push(['state survives reload', st6.scene === 'Wrecker\'s Lighthouse']);

  await page.screenshot({ path: path.join(SCRATCH, 'vtt-lighthouse.png'), fullPage: true });

  // 7. scene-link boot (#s=...)
  const link = await page.evaluate(() => {
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify({ scene: window.VTT.state() }))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return '#s=' + enc;
  });
  const page2 = await browser.newPage();
  page2.on('pageerror', e => errors.push('page2: ' + e.message));
  await page2.goto('http://localhost:8931/' + link);
  await page2.waitForTimeout(500);
  const st7 = await page2.evaluate(() => window.VTT.stateForGM());
  checks.push(['scene link boots the encounter', st7.scene === 'Wrecker\'s Lighthouse']);

  // 8. v2 features: hidden/reveal, aura, ping, dice, turn ring, new zones/grounds
  const page3 = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page3.on('pageerror', e => errors.push('page3: ' + e.message));
  await page3.goto('http://localhost:8931/');
  await page3.waitForTimeout(500);
  await page3.evaluate(() => window.VTT.apply({ do: 'scene', scene: {
    header: 'V2 Checks', ground: 'snow', rows: 12, cols: 12,
    zones: [{ from: 'A1', to: 'C3', type: 'lava' }, { from: 'J10', to: 'L12', type: 'fog' },
            { from: 'A10', to: 'C12', type: 'ice' }, { from: 'J1', to: 'L3', type: 'swamp' }],
    tokens: [{ id: 'K', name: 'Kira', at: 'F6', kind: 'pc', icon: 'swordwoman', hp: 24 },
             { id: 'amb', name: 'Ambusher', at: 'B8', kind: 'foe', icon: 'bandit', hp: 12, hidden: true }],
    initiative: [{ name: 'Kira 15', t: 'K' }, { name: 'Ambusher 9', t: 'amb' }] } }));
  await page3.waitForTimeout(300);
  checks.push(['hidden token not rendered', await page3.locator('.token').count() === 1]);
  const okc = await page3.evaluate(() => window.VTT.apply([
    { do: 'reveal', t: 'amb', at: 'E7' },
    { do: 'aura', t: 'K', ft: 15, color: 'purple' },
    { do: 'ping', at: 'F6' },
    { do: 'roll', dice: '3d6+2', label: 'fireball' },
    { do: 'turn', active: 'Kira' }]));
  checks.push(['reveal/aura/ping/roll/turn all applied', okc === 5]);
  checks.push(['revealed token now on board', await page3.locator('.token').count() === 2]);
  const s8 = await page3.evaluate(() => window.VTT.stateForGM());
  checks.push(['reveal moved ambusher to E7', s8.tokens.find(t => t.id === 'amb').at === 'E7']);
  checks.push(['aura in GM state', s8.tokens.find(t => t.id === 'K').aura === '15 ft']);
  checks.push(['ping element rendered', await page3.locator('.ping').count() === 1]);
  checks.push(['active-turn ring on Kira', await page3.locator('.token[data-id="K"].turn').count() === 1]);
  await page3.locator('#dice').click();
  await page3.locator('.die[data-d="20"]').click();
  checks.push(['dice tray rolls', /d20 = \d+/.test(await page3.locator('#measure').textContent())]);
  const hideOk = await page3.evaluate(() => window.VTT.apply([{ do: 'hide', t: 'amb' }]));
  checks.push(['hide removes from board', hideOk === 1 && await page3.locator('.token').count() === 1]);
  // board fits inside the viewport at zoom 1 (no clipping) on phone and desktop
  const fits = async p => p.evaluate(() => {
    const vp = document.getElementById('viewport'), st = document.getElementById('stage');
    const cv = document.getElementById('scene');
    const m = /scale\(([\d.]+)\)/.exec(st.style.transform);
    return parseFloat(cv.style.height) * parseFloat(m[1]) <= vp.clientHeight + 1;
  });
  checks.push(['board fits viewport on phone', await fits(page3)]);
  const dsk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  dsk.on('pageerror', e => errors.push('desktop: ' + e.message));
  await dsk.goto('http://localhost:8931/');
  await dsk.waitForTimeout(600);
  checks.push(['board fits viewport on desktop', await fits(dsk)]);
  checks.push(['new icons present', await dsk.evaluate(() =>
    ['orc','troll','lich','griffin','mimic','pirate','portal','trex','pig'].every(i => !!document.getElementById('tk-' + i)))]);

  let fail = 0;
  for (const [name, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); if (!ok) fail++; }
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
