// Map builder, quick-map generators, weather and the scene round trip.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => server.listen(8941, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:8941/');
  await page.waitForTimeout(500);
  const checks = [];

  // --- every generator, many seeds: valid, connected, inside the board
  const gen = await page.evaluate(() => {
    const out = {};
    for (const q of QUICK_MAPS) {
      let ok = 0, bad = [];
      for (let seed = 1; seed <= 25; seed++) {
        const sc = q.make(seed * 1013);
        const st = normScene(sc);
        const inside = st.tokens.every(t => t.r >= 0 && t.c >= 0 && t.r < st.rows && t.c < st.cols);
        const same = JSON.stringify(q.make(seed * 1013)) === JSON.stringify(sc);
        if (inside && same && sc.tokens.length >= 4) ok++; else bad.push(seed);
      }
      out[q.id] = { ok, bad };
    }
    return out;
  });
  for (const [id, r] of Object.entries(gen)) checks.push([`quick map ${id}: 25 seeds valid + deterministic`, r.ok === 25]);

  // --- loading each generator keeps everyone reachable on the real board
  const reach = await page.evaluate(() => QUICK_MAPS.map(q => {
    VTT.apply({ do: 'scene', scene: q.make(4242) });
    const S = VTT.state(), blocked = new Set(['pit', 'rock', 'chasm', 'lava']);
    const walk = (r, c) => r >= 0 && c >= 0 && r < S.rows && c < S.cols && !blocked.has(typeGrid[r][c]) && !solidGrid[r][c];
    const t0 = S.tokens[0], seen = new Set([t0.r * S.cols + t0.c]), qq = [[t0.r, t0.c]];
    for (let i = 0; i < qq.length; i++) { const [r, c] = qq[i];
      for (const [a, b] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]])
        if (walk(a, b) && !seen.has(a * S.cols + b)) { seen.add(a * S.cols + b); qq.push([a, b]); } }
    return [q.id, S.tokens.every(t => seen.has(t.r * S.cols + t.c))];
  }));
  for (const [id, ok] of reach) checks.push([`quick map ${id}: every token reachable`, ok]);

  // --- the panel
  await page.click('#buildbtn');
  await page.waitForTimeout(200);
  checks.push(['build tab opens', await page.evaluate(() => !$('side').hidden && $('p-build').classList.contains('on'))]);
  await page.click('[data-qmap="crypt"]');
  await page.waitForTimeout(300);
  checks.push(['quick map button loads a crypt', await page.evaluate(() => VTT.state().header === 'The Sunken Crypt' && VTT.state().fow.on)]);

  // blank map, then paint
  await page.click('#bblank');
  await page.waitForTimeout(200);
  await page.click('[data-tool="terrain"]');
  await page.click('#palette [data-pick="water"]');
  const cellXY = (r, c) => page.evaluate(([r, c]) => {
    const b = $('board').getBoundingClientRect(), S = VTT.state();
    return { x: b.left + (c + .5) * b.width / S.cols, y: b.top + (r + .5) * b.height / S.rows };
  }, [r, c]);
  let p = await cellXY(2, 2), q2 = await cellXY(2, 6);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + (q2.x - p.x) * i / 8, p.y);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const painted = await page.evaluate(() => [2, 3, 4, 5, 6].map(c => typeGrid[2][c]));
  checks.push(['drag paints a run of water', painted.every(t => t === 'water')]);
  checks.push(['painted water stored as one zone', await page.evaluate(() => VTT.state().zones.filter(z => z.type === 'water').length === 1)]);
  await page.click('#gmtoggle'); await page.waitForTimeout(100);
  await page.click('#gmundo'); await page.waitForTimeout(150);
  checks.push(['one undo takes the whole stroke back', await page.evaluate(() => typeGrid[2][4] !== 'water')]);
  await page.click('#gmtoggle');

  // floor with a 2x2 brush
  await page.click('[data-tool="floor"]');
  await page.click('#palette [data-pick="marble"]');
  await page.click('[data-brush="2"]');
  p = await cellXY(6, 6); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100);
  checks.push(['2×2 floor brush', await page.evaluate(() => [[6, 6], [6, 7], [7, 6], [7, 7]].every(([r, c]) => typeGrid[r][c] === 'marble'))]);

  // a prop, a token, then erase
  await page.click('[data-tool="prop"]');
  await page.click('#palette [data-pick="pillar"]');
  p = await cellXY(9, 3); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100);
  checks.push(['prop stamped', await page.evaluate(() => VTT.state().props.some(x => x.kind === 'pillar' && x.r === 9 && x.c === 3))]);
  checks.push(['pillar blocks sight', await page.evaluate(() => solidGrid[9][3] === true)]);
  await page.click('[data-tool="token"]');
  await page.click('#palette [data-pick="lich"]');
  await page.fill('#bthp', '60');
  p = await cellXY(10, 10); await page.mouse.click(p.x, p.y); await page.waitForTimeout(200);
  checks.push(['portrait token placed with hp', await page.evaluate(() => VTT.state().tokens.some(t => t.art === 'lich' && t.hp && t.hp.max === 60 && t.r === 10 && t.c === 10))]);
  checks.push(['token shows its portrait', await page.evaluate(() => !!document.querySelector('.token.has-art img.art'))]);
  await page.fill('#bticon', 'drag');
  await page.waitForTimeout(100);
  checks.push(['icon search filters', await page.evaluate(() => { const n = document.querySelectorAll('#palette .pgrid.icons .ptile').length; return n > 0 && n < 20; })]);
  await page.click('[data-tool="erase"]');
  p = await cellXY(9, 3); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100);
  checks.push(['erase lifts the prop', await page.evaluate(() => !VTT.state().props.some(x => x.kind === 'pillar'))]);
  checks.push(['erase leaves tokens alone', await page.evaluate(() => VTT.state().tokens.some(t => t.art === 'lich'))]);
  await page.click('[data-tool="erase"]');               // tool off: clicks go back to tokens
  checks.push(['tool toggles off', await page.evaluate(() => BUILD.tool === null && !$('viewport').classList.contains('painting'))]);

  // weather
  await page.selectOption('#bweather', 'snow');
  await page.waitForTimeout(300);
  checks.push(['weather select sets snow', await page.evaluate(() => VTT.state().weather.type === 'snow' && fxParts.length > 10)]);
  const r = await page.evaluate(() => VTT.apply({ do: 'weather', type: 'storm', intensity: .9 }));
  checks.push(['weather command', await page.evaluate(() => VTT.state().weather.type === 'storm' && Math.abs(VTT.state().weather.intensity - .9) < 1e-9)]);
  await page.evaluate(() => VTT.apply({ do: 'weather', type: 'bogus' }));
  checks.push(['unknown weather clears', await page.evaluate(() => VTT.state().weather.type === 'none')]);

  // scene JSON round trip
  const rt = await page.evaluate(() => {
    VTT.apply({ do: 'scene', scene: QUICK_MAPS.find(q => q.id === 'village').make(77) });
    const before = JSON.stringify(typeGrid), props = VTT.state().props.length, w = VTT.state().weather.type;
    const sc = sceneToJSON(VTT.state());
    VTT.apply({ do: 'scene', scene: JSON.parse(JSON.stringify(sc)) });
    return { grid: before === JSON.stringify(typeGrid), props: props === VTT.state().props.length, weather: w === VTT.state().weather.type };
  });
  checks.push(['scene → JSON → scene keeps terrain', rt.grid]);
  checks.push(['… keeps props', rt.props]);
  checks.push(['… keeps weather', rt.weather]);

  // weather survives a reload
  await page.waitForTimeout(500); await page.reload(); await page.waitForTimeout(600);
  checks.push(['weather restored after reload', await page.evaluate(() => VTT.state().weather.type === 'embers')]);

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  if (fail) console.log(JSON.stringify(gen));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
