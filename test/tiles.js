// Every drawn prop renders, light-emitting props light, solid props block sight.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.VTT_SHOTS || __dirname;
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(fs.readFileSync(f));
});
const KINDS = ['pillar','statue','altar','sarcophagus','brazier','forge','anvil','cauldron',
  'chest','openchest','bookshelf','bed','throne','cage','rubble','bones','web','runes',
  'trapdoor','grate','lever','plate','spikes','well','fountain','rug','chains',
  'stalagmite','crystal','pool','mushrooms','campfire','tent','stall','lamppost',
  'fence','signpost','trough','sacks','stump','log','bush','reeds',
  'tree','pine','rock','table','bar','chair','hearth','barrel','crate','wagon',
  'haystack','boat','door'];

(async () => {
  await new Promise(r => server.listen(8965, r));
  const browser = await chromium.launch();
  const cols = 8, rows = Math.ceil(KINDS.length / cols);
  const page = await browser.newPage({ viewport: { width: 640, height: 200 + rows * 62 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8965/');
  await page.waitForTimeout(500);

  const checks = [];
  await page.evaluate(d => window.VTT.apply({ do: 'scene', scene: {
    header: 'Tile Sampler', sub: d.KINDS.length + ' drawn props', ground: 'stone',
    rows: d.rows, cols: d.cols, ambient: 'bright',
    props: d.KINDS.map((k, i) => ({ kind: k, at: String.fromCharCode(65 + Math.floor(i / d.cols)) + (i % d.cols + 1) })),
    tokens: [], initiative: [] } }), { KINDS, cols, rows });
  await page.waitForTimeout(600);
  checks.push([`all ${KINDS.length} prop kinds drawn without error`,
    await page.evaluate(() => window.VTT.state().props.length) === KINDS.length]);
  await page.screenshot({ path: path.join(SHOTS, 'tiles.png'), fullPage: true });

  // light emission and shadow casting, on a hall big enough to outrun a torch
  const info = await page.evaluate(() => {
    window.VTT.apply({ do: 'scene', scene: { header: 'LOS', ground: 'stone', rows: 21, cols: 21,
      ambient: 'dark', fow: true,
      props: [{ kind: 'brazier', at: 'K11' }, { kind: 'pillar', at: 'K13' }],
      tokens: [{ id: 'K', name: 'K', at: 'K9', kind: 'pc', hp: 10 }], initiative: [] } });
    const L = window.VTT.light(), V = window.VTT.vis();
    const at = (g, ref) => g[ref.charCodeAt(0) - 65][+ref.slice(1) - 1];
    return { brazier: at(L, 'K11'), near: at(L, 'K12'),        // 20 ft bright
      edgeOfDim: at(L, 'C11'), beyondDim: at(L, 'A1'),         // 40 ft dim, then dark
      // sampled north of the brazier, clear of the pillar's shadow
      behindPillar: at(V, 'K15'), pillar: at(V, 'K13'), open: at(V, 'K10') };
  });
  checks.push(['brazier lights its own square bright', info.brazier === 2]);
  checks.push(['brazier lights the next square bright', info.near === 2]);
  checks.push(['past the bright radius it is only dim', info.edgeOfDim === 1]);
  checks.push(['past the dim radius it is dark', info.beyondDim === 0]);
  checks.push(['a pillar is visible', info.pillar > 0]);
  checks.push(['a pillar casts a shadow behind it', info.behindPillar === -1]);
  checks.push(['open floor beside the party is seen', info.open > 0]);

  // a prop with no light entry lights nothing at all
  const rugDark = await page.evaluate(() => {
    window.VTT.apply({ do: 'scene', scene: { header: 'Rug', ground: 'stone', rows: 9, cols: 9,
      ambient: 'dark', fow: true, props: [{ kind: 'rug', at: 'E5' }],
      tokens: [{ id: 'K', name: 'K', at: 'A1', kind: 'pc', hp: 10 }], initiative: [] } });
    return window.VTT.light().flat().every(v => v === 0);
  });
  checks.push(['a rug emits no light', rugDark]);

  // an explicit blocks flag overrides the default
  const ov = await page.evaluate(() => {
    window.VTT.apply({ do: 'scene', scene: { header: 'Blocks', ground: 'stone', rows: 9, cols: 9,
      ambient: 'bright', fow: true,
      props: [{ kind: 'barrel', at: 'E5', blocks: true }],
      tokens: [{ id: 'K', name: 'K', at: 'E3', kind: 'pc', hp: 10 }], initiative: [] } });
    return window.VTT.vis()[4][6];   // E7, directly behind the blocking barrel
  });
  checks.push(['"blocks":true makes any prop opaque', ov <= 0]);

  // the lighting ceiling: many sources must not stack past the cap
  const glow = await page.evaluate(() => {
    const many = [];
    for (let r = 0; r < 14; r += 2) for (let c = 0; c < 14; c += 2)
      many.push({ kind: 'brazier', at: String.fromCharCode(65 + r) + (c + 1) });
    window.VTT.apply({ do: 'scene', scene: { header: 'Cap', ground: 'stone',
      rows: 14, cols: 14, ambient: 'dark', props: many, tokens: [], initiative: [] } });
    const peak = Math.max(...window.VTT.glow().warm.flat());
    window.VTT.apply({ do: 'ambient', max: 0.3 });
    const dialled = Math.max(...window.VTT.glow().warm.flat());
    window.VTT.apply({ do: 'scene', scene: { header: 'One', ground: 'stone',
      rows: 14, cols: 14, ambient: 'dark',
      props: [{ kind: 'brazier', at: 'G7' }], tokens: [], initiative: [] } });
    const g = window.VTT.glow().warm;
    return { sources: many.length, peak, dialled,
      atSource: g[6][6], fiveAway: g[6][11], acrossRoom: g[0][0] };
  });
  checks.push([`${glow.sources} light sources clamp to the 0.85 ceiling`,
    Math.abs(glow.peak - 0.85) < 1e-9]);
  checks.push(['"max" dials the ceiling down', Math.abs(glow.dialled - 0.3) < 1e-9]);
  checks.push(['a lone light still falls off with distance',
    glow.atSource > glow.fiveAway && glow.fiveAway > glow.acrossRoom]);
  checks.push(['glow reaches nothing past the dim radius', glow.acrossRoom === 0]);

  // a door must lie along the wall it sits in, whichever way that wall runs
  const doors = await page.evaluate(() => {
    window.VTT.apply({ do: 'scene', scene: { header: 'Doors', ground: 'stone',
      rows: 7, cols: 7, ambient: 'bright',
      zones: [{ from: 'A1', to: 'A7', type: 'wall' },   // wall running east-west
               { from: 'C4', to: 'G4', type: 'wall' }], // wall running north-south
      props: [{ kind: 'door', at: 'A3' }, { kind: 'door', at: 'E4' }, { kind: 'door', at: 'G7' }],
      tokens: [], initiative: [] } });
    return { inEW: window.VTT.wallRun(0, 2), inNS: window.VTT.wallRun(4, 3),
      freeStanding: window.VTT.wallRun(6, 6) };
  });
  checks.push(['door in an east-west wall lies east-west', doors.inEW === 'EW']);
  checks.push(['door in a north-south wall lies north-south', doors.inNS === 'NS']);
  checks.push(['a free-standing door still has an orientation', !!doors.freeStanding]);

  // walls as objects: runs, occlusion, cover, and erasing
  const walls = await page.evaluate(() => {
    window.VTT.apply([
      { do: 'scene', scene: { header: 'Walls', ground: 'stone', rows: 12, cols: 12,
        ambient: 'dark', fow: true,
        tokens: [{ id: 'K', name: 'K', at: 'F6', kind: 'pc', hp: 10, vision: { dark: 90 } }],
        initiative: [] } },
      { do: 'wall', from: 'C3', to: 'C9' },              // stone run north of the token
      { do: 'wall', from: 'I3', to: 'I9', kind: 'lowwall' },   // low run south of it
      { do: 'wall', from: 'F10', to: 'F10', kind: 'woodwall' }]);
    const V = window.VTT.vis(), at = ref => V[ref.charCodeAt(0) - 65][+ref.slice(1) - 1];
    const isWall = q => ['wall', 'woodwall', 'lowwall'].includes(q.kind);
    return { count: window.VTT.state().props.filter(isWall).length,
      wallFace: at('C6'), beyondWall: at('A6'),
      lowFace: at('I6'), beyondLow: at('K6'),
      timber: at('F10'), beyondTimber: at('F12') };
  });
  checks.push(['a wall run lays one square per cell', walls.count === 7 + 7 + 1]);
  checks.push(['the wall face is visible', walls.wallFace > 0]);
  checks.push(['a stone wall blocks sight beyond it', walls.beyondWall <= 0]);
  checks.push(['a low wall is visible', walls.lowFace > 0]);
  checks.push(['a low wall is cover, not a sight blocker', walls.beyondLow > 0]);
  checks.push(['a timber wall blocks sight beyond it', walls.beyondTimber <= 0]);

  const erased = await page.evaluate(() => {
    const before = window.VTT.state().props.length;
    window.VTT.apply({ do: 'wall', from: 'C3', to: 'C9', remove: true });
    const V = window.VTT.vis();
    return { removed: before - window.VTT.state().props.length,
      nowVisible: V[0][5] };   // A6, previously behind the wall
  });
  checks.push(['removing a run erases exactly its squares', erased.removed === 7]);
  checks.push(['sight opens up once the wall is gone', erased.nowVisible > 0]);

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
