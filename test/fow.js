// Focused verification of fog of war / LOS / light / darkvision semantics.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => server.listen(8940, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8940/');
  await page.waitForTimeout(600);

  // expose the vision grid for assertions
  await page.evaluate(() => { window.__vis = () => {
    const s = window.VTT.state();
    return { grid: window.VTT.vis(), light: window.VTT.light(), rows: s.rows, cols: s.cols };
  }; });

  const checks = [];
  const at = (g, ref) => { const r = ref.charCodeAt(0) - 65, c = +ref.slice(1) - 1; return g[r][c]; };

  // --- Scene 1: a lit room, a wall down column 8, PC at E4 with no darkvision
  await page.evaluate(() => window.VTT.apply({ do: 'scene', scene: {
    header: 'LOS Test', ground: 'stone', rows: 12, cols: 12,
    ambient: 'bright', fow: true,
    zones: [{ from: 'A8', to: 'L8', type: 'wall' }],
    tokens: [{ id: 'K', name: 'Kira', at: 'E4', kind: 'pc', icon: 'swordwoman', hp: 20 },
             { id: 'foe', name: 'Lurker', at: 'E11', kind: 'foe', icon: 'bandit', hp: 10 }],
    initiative: [] } }));
  await page.waitForTimeout(300);
  let v = await page.evaluate(() => window.__vis());
  checks.push(['own square visible', at(v.grid, 'E4') > 0]);
  checks.push(['same side of wall visible', at(v.grid, 'E2') > 0]);
  checks.push(['wall itself visible', at(v.grid, 'E8') > 0]);
  checks.push(['behind wall NOT visible', at(v.grid, 'E10') <= 0]);
  checks.push(['far corner behind wall unexplored', at(v.grid, 'A12') === -1]);
  checks.push(['foe behind wall hidden', await page.evaluate(() =>
    document.querySelector('.token[data-id="foe"]').classList.contains('unseen'))]);
  checks.push(['PC always shown', !await page.evaluate(() =>
    document.querySelector('.token[data-id="K"]').classList.contains('unseen'))]);

  // --- Scene 2: dark dungeon, no light, no darkvision → sees nothing but own square
  await page.evaluate(() => window.VTT.apply([
    { do: 'ambient', light: 'dark' }]));
  await page.waitForTimeout(200);
  v = await page.evaluate(() => window.__vis());
  checks.push(['dark: distant cell not visible', at(v.grid, 'E2') <= 0]);
  checks.push(['dark: own square still known', at(v.grid, 'E4') > 0]);

  // --- darkvision 30 ft = 6 cells
  await page.evaluate(() => window.VTT.apply({ do: 'vision', t: 'K', darkvision: 30 }));
  await page.waitForTimeout(200);
  v = await page.evaluate(() => window.__vis());
  checks.push(['darkvision 30ft reaches 3 cells away', at(v.grid, 'E1') > 0]);
  checks.push(['darkvision stops past its range', at(v.grid, 'L4') <= 0]);      // 7 rows S
  checks.push(['darkvision reads as dim (not bright)', at(v.grid, 'E1') === 1]);

  // --- a torch relights the room: bright near, dim further
  await page.evaluate(() => window.VTT.apply({ do: 'light', at: 'E4', bright: 20, dim: 40 }));
  await page.waitForTimeout(200);
  v = await page.evaluate(() => window.__vis());
  checks.push(['torch: adjacent cell bright', at(v.light, 'E5') === 2]);
  checks.push(['torch: 20ft edge still bright', at(v.light, 'A4') === 2]);   // exactly 4 cells
  checks.push(['torch: past bright radius is dim', at(v.light, 'A1') === 1]); // 5 cells
  checks.push(['torch light blocked by wall', at(v.light, 'E11') === 0]);

  // --- magical darkness defeats darkvision
  await page.evaluate(() => window.VTT.apply([
    { do: 'clearlights' },
    { do: 'zone', from: 'D2', to: 'F3', type: 'dark' }]));
  await page.waitForTimeout(200);
  v = await page.evaluate(() => window.__vis());
  checks.push(['magical darkness blocks darkvision', at(v.grid, 'E2') <= 0]);

  // --- memory: explored cells stay explored (as 0) after the party leaves
  await page.evaluate(() => window.VTT.apply([
    { do: 'clearzones', type: 'dark' },
    { do: 'ambient', light: 'bright' }]));
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => window.__vis());
  checks.push(['bright again: E2 visible', at(before.grid, 'E2') > 0]);
  await page.evaluate(() => window.VTT.apply({ do: 'ambient', light: 'dark' }));
  await page.evaluate(() => window.VTT.apply({ do: 'vision', t: 'K', darkvision: 0 }));
  await page.waitForTimeout(200);
  v = await page.evaluate(() => window.__vis());
  checks.push(['explored cell remembered, not visible', at(v.grid, 'E2') === 0]);
  checks.push(['never-seen cell still unexplored', at(v.grid, 'A12') === -1]);

  // --- GM reveal + off switch
  await page.evaluate(() => window.VTT.apply({ do: 'fow', reveal: 'all' }));
  await page.waitForTimeout(200);
  v = await page.evaluate(() => window.__vis());
  checks.push(['GM reveal marks all explored', at(v.grid, 'A12') === 0]);
  const gm = await page.evaluate(() => window.VTT.stateForGM());
  checks.push(['GM state reports fow + unseen foe',
    !!gm.fow && gm.tokens.find(t => t.id === 'foe').unseen === true]);
  await page.evaluate(() => window.VTT.apply({ do: 'fow', on: false }));
  await page.waitForTimeout(200);
  checks.push(['fow off → grid cleared', await page.evaluate(() => window.VTT.vis()) === null]);
  checks.push(['fow off → foe shown again', !await page.evaluate(() =>
    document.querySelector('.token[data-id="foe"]').classList.contains('unseen'))]);

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
