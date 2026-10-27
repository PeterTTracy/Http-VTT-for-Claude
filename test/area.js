// Area templates: shapes catch the right squares, the bar lists who is caught,
// one button rolls every save as one undoable batch, the ruler measures.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(f));
});
const SCENE = {
  header: 'Courtyard', rows: 12, cols: 12, ground: 'stone',
  tokens: [
    { id: 'wiz', name: 'Bren', at: 'F2', kind: 'pc', art: 'wizard', hp: 14, ac: 15 },
    { id: 'g1', name: 'Goblin 1', at: 'F6', kind: 'foe', art: 'goblin', hp: 12, ac: 15 },
    { id: 'g2', name: 'Goblin 2', at: 'G7', kind: 'foe', art: 'goblin', hp: 12, ac: 15 },
    { id: 'g3', name: 'Goblin 3', at: 'L12', kind: 'foe', art: 'goblin', hp: 12, ac: 15 },
  ],
};
(async () => {
  await new Promise(r => server.listen(8946, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    const real = Math.random; window.__dice = [];
    Math.random = () => { const q = window.__dice.shift(); return q ? (q[0] - .5) / q[1] : real(); };
  });
  await page.goto('http://localhost:8946/');
  await page.waitForTimeout(500);
  const checks = [];
  const ev = (f, a) => page.evaluate(f, a);
  await ev(sc => { SET.rules = 'pf2e'; saveSet(); VTT.apply({ do: 'scene', scene: sc }); }, SCENE);

  // ---------- geometry ----------
  const geo = await ev(() => {
    const ids = m => caughtBy(normMarker(m)).map(t => t.id).sort().join(',');
    return {
      burst: ids({ shape: 'circle', at: 'F6', ft: 10 }),
      bigBurst: ids({ shape: 'circle', at: 'F6', ft: 30 }),
      cone: ids({ shape: 'cone', at: 'F2', ft: 30, dir: 'E' }),
      coneBack: ids({ shape: 'cone', at: 'F2', ft: 30, dir: 'W' }),
      line: ids({ shape: 'line', at: 'F2', ft: 60, dir: 'E', w: 5 }),
      cube: ids({ shape: 'square', at: 'F6', ft: 10 }),
    };
  });
  checks.push(['a 10 ft burst catches the two goblins beside each other', geo.burst === 'g1,g2']);
  checks.push(['a 30 ft burst catches the caster too', geo.bigBurst === 'g1,g2,wiz']);
  checks.push(['a cone east catches both goblins ahead, not the caster', geo.cone === 'g1,g2']);
  checks.push(['a cone the other way catches nobody', geo.coneBack === '']);
  checks.push(['a line east catches only the goblin on the row', geo.line === 'g1']);
  checks.push(['a 10 ft cube from F6 catches both', geo.cube === 'g1,g2']);

  // ---------- the tool ----------
  await page.click('#areabtn');
  checks.push(['the Area button opens the bar', await ev(() => !document.getElementById('areabar').hidden && AREA.on)]);
  const box = await ev(() => { const b = document.getElementById('board').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width / COLS, h: b.height / ROWS }; });
  const at = (r, c) => ({ x: box.x + (c + .5) * box.w, y: box.y + (r + .5) * box.h });
  // tap F6 with a 10 ft burst
  await ev(() => { AREA.ft = 10; renderArea(); });
  let p = at(5, 5); await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  checks.push(['a tap drops the burst there', await ev(() => { const m = areaMarker(); return m && m.r === 5 && m.c === 5 && m.ft === 10; })]);
  checks.push(['the bar lists both goblins', await ev(() => document.querySelectorAll('#areabar .ar-tok').length === 2)]);
  checks.push(['caught tokens glow on the board', await ev(() => document.querySelectorAll('.token.caught').length === 2)]);
  checks.push(['the board state tells Claude who is caught', await ev(() => boardBrief().areas?.find(a => a.id === 'area')?.caught.sort().join(',') === 'g1,g2')]);
  // roll: goblin 1 +5, goblin 2 +5, DC 18, 2d6 (fixed 4+4=8)
  await page.fill('[data-amod="g1"]', '5'); await page.fill('[data-amod="g2"]', '5');
  await page.fill('#adc', '18'); await page.fill('#admg', '2d6'); await page.fill('#acond', 'prone');
  await ev(() => { window.__dice = [[5, 20], [4, 6], [4, 6], [15, 20], [4, 6], [4, 6]]; });   // g1 fails (10), g2 succeeds (20)
  await page.click('[data-aa="roll"]');
  await page.waitForTimeout(150);
  const after = await ev(() => Object.fromEntries(['g1', 'g2'].map(id => { const t = VTT.state().tokens.find(t => t.id === id); return [id, { hp: t.hp.cur, conds: t.conds }]; })));
  checks.push(['a failed save takes full damage and the condition', after.g1.hp === 4 && after.g1.conds.includes('prone')]);
  checks.push(['a success takes half and no condition', after.g2.hp === 8 && !after.g2.conds.includes('prone')]);
  checks.push(['the bar shows each result', await ev(() => document.querySelectorAll('#areabar .ar-out li').length === 2)]);
  await ev(() => document.getElementById('gmundo').click());
  checks.push(['one undo takes back the whole area', await ev(() => VTT.state().tokens.filter(t => t.id[0] === 'g' && t.hp.cur === 12).length === 3)]);
  await ev(() => document.getElementById('gmundo').click());
  // a roll with no DC is stopped with a note
  await ev(() => { AREA.dc = ''; renderArea(); });
  await page.click('[data-aa="roll"]');
  checks.push(['rolling without a DC asks for one', await ev(() => /DC/.test(document.getElementById('toast').textContent))]);

  // cone: press on the caster and drag east
  await page.click('[data-ash="cone"]');
  await ev(() => { AREA.ft = 30; renderArea(); });
  p = at(5, 1); const q = at(5, 4);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(100);
  checks.push(['dragging aims the cone', await ev(() => { const m = areaMarker(); return m.shape === 'cone' && Math.abs(m.dir) < 10 && m.r === 5 && m.c === 1; })]);
  checks.push(['the aimed cone catches the goblins ahead', await ev(() => caughtBy(areaMarker()).map(t => t.id).sort().join() === 'g1,g2')]);
  await page.screenshot({ path: path.join(__dirname, 'area-cone.png') });

  // ruler
  await page.click('[data-ash="ruler"]');
  p = at(0, 0); const r2 = at(3, 4);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(r2.x, r2.y, { steps: 4 }); await page.mouse.up();
  checks.push(['the ruler measures with alternating diagonals', await ev(() => /A1 → D5 · 25 ft/.test(document.getElementById('areabar').textContent))]);
  checks.push(['the ruler leaves no saved marker behind', await ev(() => !sceneToJSON(VTT.state()).markers?.some(m => m.id === '_area'))]);

  // damage with "by" credits the tally
  checks.push(['damage "by" a token counts in the tally', await ev(() => { VTT.apply({ do: 'combat' }); VTT.apply({ do: 'damage', t: 'g3', n: 5, by: 'wiz' });
    return VTT.state().combat.stats.wiz?.dealt === 5; })]);
  // shortcuts, closing, phone
  await page.keyboard.press('Escape');
  checks.push(['Escape closes the tool and the ruler line', await ev(() => !AREA.on && document.getElementById('areabar').hidden && !VTT.state().markers.some(m => m.id === '_area'))]);
  await page.mouse.click(5, 5); await page.keyboard.press('a');
  checks.push(['a opens it again', await ev(() => AREA.on)]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await ev(() => { AREA.shape = 'circle'; renderArea(); });
  checks.push(['the bar fits a phone without sideways scroll', await ev(() => document.documentElement.scrollWidth - innerWidth <= 1)]);
  await page.screenshot({ path: path.join(__dirname, 'area-phone.png'), fullPage: true });

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
