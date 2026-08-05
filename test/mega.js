// Mega-dungeon scale: 30 rooms over 4 floors, built incrementally, plus portal art.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.VTT_SHOTS || __dirname;
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(fs.readFileSync(f));
});

// a 3x3 tiled cavern level + upper/lower levels, like a Wave Echo Cave sprawl
const rooms = [], links = [];
const FLOORS = [{ f: 0, tag: 'cav', n: 9, ground: 'stone', amb: 'dark' },
                { f: 1, tag: 'hall', n: 9, ground: 'stone', amb: 'dim' },
                { f: -1, tag: 'deep', n: 9, ground: 'dirt', amb: 'dark' }];
for (const F of FLOORS) {
  for (let i = 0; i < F.n; i++) {
    const r = Math.floor(i / 3), c = i % 3;
    rooms.push({ id: `${F.tag}${i}`, name: `${F.tag.toUpperCase()} ${r + 1}-${c + 1}`,
      floor: F.f, ground: F.ground, ambient: F.amb, fow: true, rows: 20, cols: 20,
      header: `${F.tag.toUpperCase()} ${r + 1}-${c + 1}`, sub: `floor ${F.f}`,
      tokens: i === 0 ? [] : [{ id: `m${F.tag}${i}`, name: `Foe ${i}`, at: 'J10', kind: 'foe', icon: 'goblin', hp: 8 }],
      initiative: [] });
    if (c < 2) links.push({ from: `${F.tag}${i}`, to: `${F.tag}${i + 1}`, edge: 'E' });
    if (r < 2) links.push({ from: `${F.tag}${i}`, to: `${F.tag}${i + 3}`, edge: 'S' });
  }
}
links.push({ from: { room: 'cav0', at: 'D4' }, to: { room: 'hall8', at: 'Q17' }, kind: 'stairs', label: 'down' });
links.push({ from: { room: 'cav8', at: 'Q17' }, to: { room: 'deep0', at: 'D4' }, kind: 'ladder', label: 'down' });

(async () => {
  await new Promise(r => server.listen(8960, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8960/');
  await page.waitForTimeout(500);

  // build the world with only the first room, then add the other 26 incrementally
  const t0 = Date.now();
  await page.evaluate(d => window.VTT.apply({ do: 'world', world: {
    name: 'Wave Echo Cave', start: d.rooms[0].id, rooms: [d.rooms[0]], links: [] } }),
    { rooms });
  const added = await page.evaluate(d => {
    let n = 0;
    for (const r of d.rooms.slice(1)) n += window.VTT.apply({ do: 'addroom', room: r });
    n += window.VTT.apply(d.links.map(l => ({ do: 'link', ...l })));
    return n;
  }, { rooms, links });
  const buildMs = Date.now() - t0;
  await page.waitForTimeout(300);

  const st = await page.evaluate(() => window.VTT.stateForGM());
  const checks = [];
  checks.push([`built ${rooms.length} rooms + ${links.length} links incrementally`,
    added === rooms.length - 1 + links.length]);
  checks.push(['world reports 27 rooms', await page.evaluate(() =>
    Object.keys(window.VTT.world().rooms).length) === rooms.length]);
  checks.push([`build under 5s (took ${buildMs}ms)`, buildMs < 5000]);
  checks.push(['start room has both a stair and edge exits', st.exits.length >= 3]);

  // travel across the level and down a floor
  const tTravel = Date.now();
  await page.evaluate(() => window.VTT.apply([{ do: 'room', to: 'cav1' }, { do: 'room', to: 'cav2' },
    { do: 'room', to: 'cav5' }, { do: 'room', to: 'cav8' }]));
  const travelMs = Date.now() - tTravel;
  await page.waitForTimeout(300);
  checks.push([`4 room transitions under 3s (took ${travelMs}ms)`, travelMs < 3000]);
  const st2 = await page.evaluate(() => window.VTT.stateForGM());
  checks.push(['arrived in cav8', st2.room === 'cav8']);
  checks.push(['ladder down is an exit here', st2.exits.some(e => e.to === 'deep0')]);

  // overview panel groups by floor and marks visited
  await page.locator('#mapbtn').click();
  await page.waitForTimeout(200);
  checks.push(['overview lists 3 floors', await page.locator('#overview .flo').count() === 3]);
  checks.push(['overview lists every room', await page.locator('#overview .rm').count() === rooms.length]);
  checks.push(['visited rooms marked', await page.locator('#overview .rm.seen').count() >= 4]);
  checks.push(['current room ringed', await page.locator('#overview .rm.here').count() === 1]);
  await page.screenshot({ path: path.join(SHOTS, 'mega-overview.png') });
  await page.locator('#mapbtn').click();

  // persistence of a big world
  const bytes = await page.evaluate(() => JSON.stringify(window.VTT.world()).length);
  await page.reload();
  await page.waitForTimeout(900);
  const st3 = await page.evaluate(() => window.VTT.stateForGM());
  checks.push([`27-room world (${Math.round(bytes / 1024)}KB) survives reload`,
    st3.room === 'cav8' && st3.world === 'Wave Echo Cave']);

  // ---- portal art: one room with every kind, for the eye test
  await page.evaluate(() => window.VTT.apply({ do: 'world', world: {
    name: 'Portal Gallery', start: 'gal',
    rooms: [
      { id: 'gal', name: 'Gallery', floor: 0, header: 'Portal Gallery',
        sub: 'every way in and out', ground: 'stone', rows: 12, cols: 12, ambient: 'dim',
        zones: [{ from: 'A1', to: 'A12', type: 'wall' }, { from: 'L1', to: 'L12', type: 'wall' },
                { from: 'A1', to: 'L1', type: 'wall' }],
        tokens: [{ id: 'K', name: 'Kira', at: 'D6', kind: 'pc', icon: 'swordwoman', hp: 24 }],
        initiative: [] },
      { id: 'up', name: 'Belfry', floor: 1 }, { id: 'dn', name: 'Crypt', floor: -1 },
      { id: 'hall', name: 'Long Hall', floor: 0 }, { id: 'vault', name: 'Vault', floor: 0 },
      { id: 'weird', name: 'Elsewhere', floor: 0 }, { id: 'pit', name: 'Sump', floor: -2 },
      { id: 'east', name: 'East Cavern', floor: 0 }],
    links: [
      { from: { room: 'gal', at: 'C5' }, to: { room: 'up', at: 'B2' }, kind: 'stairs', label: 'up' },
      { from: { room: 'gal', at: 'C8' }, to: { room: 'dn', at: 'B2' }, kind: 'stairs', label: 'down' },
      { from: { room: 'gal', at: 'F3' }, to: { room: 'hall', at: 'B2' }, kind: 'door' },
      { from: { room: 'gal', at: 'F10' }, to: { room: 'vault', at: 'B2' }, kind: 'gate', label: 'portcullis' },
      { from: { room: 'gal', at: 'F6' }, to: { room: 'vault', at: 'C3' }, kind: 'vault', label: 'vault' },
      { from: { room: 'gal', at: 'D9' }, to: { room: 'hall', at: 'C3' }, kind: 'secretdoor', label: 'secret' },
      { from: { room: 'gal', at: 'I5' }, to: { room: 'weird', at: 'B2' }, kind: 'portal', label: 'rune' },
      { from: { room: 'gal', at: 'I8' }, to: { room: 'pit', at: 'B2' }, kind: 'ladder', label: 'down' },
      { from: { room: 'gal', at: 'K6' }, to: { room: 'sump', at: 'B2' }, kind: 'hole', label: 'chute' },
      { from: 'gal', to: 'east', edge: 'E' }] } }));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.VTT.apply([{ do: 'fow', on: false }]));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'portal-gallery.png') });
  // party standing on a stair lights that portal up
  await page.evaluate(() => window.VTT.apply({ do: 'move', t: 'K', to: 'C5' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, 'portal-ready.png') });
  checks.push(['every portal kind drawn without error',
    await page.evaluate(() => window.VTT.world().links.length) === 10]);

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
