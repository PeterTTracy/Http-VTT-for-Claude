// Room-to-room continuity: linked scenes, floors, party travel, per-room memory.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(f));
});

// A keep: two ground-floor halls tiled edge-to-edge, plus a cellar below.
const WORLD = {
  name: 'Greyhold Keep', start: 'hall',
  rooms: [
    { id: 'hall', name: 'Great Hall', floor: 0, ground: 'stone', rows: 12, cols: 12,
      ambient: 'dim', fow: true,
      props: [{ kind: 'hearth', at: 'F6' }],
      tokens: [
        { id: 'K', name: 'Kira', at: 'F2', kind: 'pc', icon: 'swordwoman', hp: 24, vision: { dark: 60 } },
        { id: 'B', name: 'Bren', at: 'G2', kind: 'pc', icon: 'wizard', hp: 26 },
        { id: 'rat', name: 'Rat', at: 'C9', kind: 'foe', icon: 'rat', hp: 4 }],
      initiative: [{ name: 'Kira 15', t: 'K' }, { name: 'Bren 11', t: 'B' }] },
    { id: 'yard', name: 'East Yard', floor: 0, ground: 'dirt', rows: 12, cols: 12,
      ambient: 'bright',
      tokens: [{ id: 'gd', name: 'Guard', at: 'F3', kind: 'foe', icon: 'watch', hp: 16 }],
      initiative: [] },
    { id: 'cellar', name: 'Cellar', floor: -1, ground: 'stone', rows: 10, cols: 10,
      ambient: 'dark', fow: true,
      tokens: [{ id: 'gh', name: 'Ghoul', at: 'H8', kind: 'foe', icon: 'ghoul', hp: 18 }],
      initiative: [] }],
  links: [
    { from: 'hall', to: 'yard', edge: 'E' },                                    // walk off the east edge
    { from: { room: 'hall', at: 'K6' }, to: { room: 'cellar', at: 'B5' },       // stair down
      kind: 'stairs', label: 'down' }],
};

(async () => {
  await new Promise(r => server.listen(8950, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8950/');
  await page.waitForTimeout(500);

  const checks = [];
  const gm = () => page.evaluate(() => window.VTT.stateForGM());
  const ids = st => st.tokens.map(t => t.id).sort().join(',');

  await page.evaluate(w => window.VTT.apply({ do: 'world', world: w }), WORLD);
  await page.waitForTimeout(400);
  let st = await gm();
  checks.push(['world loads at its start room', st.world === 'Greyhold Keep' && st.room === 'hall']);
  checks.push(['start room holds its own tokens', ids(st) === 'B,K,rat']);
  checks.push(['exits listed for this room', st.exits.length === 2]);
  checks.push(['exits not usable until the party stands on them',
    st.exits.every(e => !e.partyIsHere)]);

  // --- wound a foe and burn some HP, so we can prove state survives travel
  await page.evaluate(() => window.VTT.apply([
    { do: 'damage', t: 'rat', n: 3 },
    { do: 'damage', t: 'K', n: 9 },
    { do: 'cond', t: 'B', add: ['blessed'] }]));

  // --- stair down: walk Kira onto K6, the exit lights up, then travel
  await page.evaluate(() => window.VTT.apply({ do: 'move', t: 'K', to: 'K6' }));
  await page.waitForTimeout(200);
  st = await gm();
  checks.push(['standing on a stair readies that exit',
    st.exits.some(e => e.to === 'cellar' && e.partyIsHere)]);
  checks.push(['exit button enabled in the UI',
    await page.locator('.exit.ready').count() === 1]);
  await page.locator('.exit.ready').click();
  await page.waitForTimeout(500);

  st = await gm();
  checks.push(['travelled to the cellar', st.room === 'cellar']);
  checks.push(['floor reported', st.floor === -1]);
  checks.push(['party travelled, locals stayed', ids(st) === 'B,K,gh']);
  checks.push(['party arrives at the stair mouth',
    st.tokens.find(t => t.id === 'K').at === 'B5']);
  checks.push(['second party member placed beside them',
    st.tokens.find(t => t.id === 'B').at !== 'B5']);
  checks.push(['wounds travel with the party', st.tokens.find(t => t.id === 'K').hp === '15/24']);
  checks.push(['conditions travel too',
    JSON.stringify(st.tokens.find(t => t.id === 'B').conds) === '["blessed"]']);
  checks.push(['cellar grid is its own size', await page.evaluate(() => window.VTT.state().rows) === 10]);
  checks.push(['cellar keeps its own darkness', await page.evaluate(() => window.VTT.state().fow.ambient) === 'dark']);
  checks.push(['party auto-added to the room turn order',
    (await page.evaluate(() => window.VTT.state().initiative.map(e => e.t))).includes('K')]);

  // --- explore the cellar so it has fog memory, then go back up
  await page.evaluate(() => window.VTT.apply({ do: 'move', t: 'K', to: 'E5' }));
  await page.waitForTimeout(250);
  const cellarSeen = await page.evaluate(() =>
    window.VTT.state().fow.seen.flat().filter(Boolean).length);
  checks.push(['cellar accrued fog memory', cellarSeen > 0]);

  await page.evaluate(() => window.VTT.apply({ do: 'room', to: 'hall', at: 'K6' }));
  await page.waitForTimeout(400);
  st = await gm();
  checks.push(['back in the hall', st.room === 'hall']);
  checks.push(['hall remembers its wounded rat', st.tokens.find(t => t.id === 'rat').hp === '1/4']);
  checks.push(['ghoul stayed in the cellar', !st.tokens.find(t => t.id === 'gh')]);

  // --- edge link: walk off the east edge into the yard, same row
  await page.evaluate(() => window.VTT.apply({ do: 'move', t: 'K', to: 'H12' }));
  await page.waitForTimeout(200);
  st = await gm();
  checks.push(['edge exit readies at the map edge',
    st.exits.some(e => e.to === 'yard' && e.partyIsHere)]);
  await page.evaluate(() => window.VTT.apply({ do: 'room', to: 'yard', at: 'H1' }));
  await page.waitForTimeout(400);
  st = await gm();
  checks.push(['crossed into the yard', st.room === 'yard']);
  checks.push(['arrived against the opposite edge, same row',
    st.tokens.find(t => t.id === 'K').at === 'H1']);
  checks.push(['yard has its own daylight',
    await page.evaluate(() => window.VTT.state().fow.ambient) === 'bright']);
  checks.push(['yard guard is there, hall rat is not', ids(st) === 'B,K,gd']);

  // --- the whole world survives a reload, with every room's state
  await page.reload();
  await page.waitForTimeout(700);
  st = await gm();
  checks.push(['world survives reload in the same room', st.world === 'Greyhold Keep' && st.room === 'yard']);
  const back = await page.evaluate(() => {
    window.VTT.apply({ do: 'room', to: 'cellar' });
    return window.VTT.stateForGM();
  });
  checks.push(['other rooms survive reload too',
    back.room === 'cellar' && !!back.tokens.find(t => t.id === 'gh')]);
  checks.push(['cellar fog memory survived reload',
    await page.evaluate(() => window.VTT.state().fow.seen.flat().filter(Boolean).length) >= cellarSeen]);

  // --- a plain single scene still works and clears the world
  await page.evaluate(() => window.VTT.apply({ do: 'scene', scene: {
    header: 'Just A Field', ground: 'grass', rows: 8, cols: 8, tokens: [], initiative: [] } }));
  await page.waitForTimeout(300);
  st = await gm();
  checks.push(['plain scene clears world mode', st.world === undefined && st.scene === 'Just A Field']);
  checks.push(['exits strip hidden without a world',
    await page.locator('#exits[hidden]').count() === 1]);

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
