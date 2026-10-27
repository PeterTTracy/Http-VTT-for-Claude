// Combat engine: dying and recovery (PF2e), death saves (5e), turn effects,
// the damage tally, victory, the tracker panel and command validation.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(f));
});

const SCENE = {
  header: 'Test Pit', rows: 10, cols: 10, ground: 'stone',
  tokens: [
    { id: 'kira', name: 'Kira', at: 'B2', kind: 'pc', art: 'fighter', hp: 20, ac: 18, init: 7 },
    { id: 'bren', name: 'Bren', at: 'B4', kind: 'pc', art: 'wizard', hp: 12, ac: 15, init: 4 },
    { id: 'sk1', name: 'Skeleton', at: 'C3', kind: 'foe', art: 'skeleton', hp: 10, ac: 14, init: 6 },
    { id: 'og', name: 'Ogre', at: 'H8', kind: 'foe', art: 'orc', hp: 30, ac: 17, init: 1 },
  ],
};

(async () => {
  await new Promise(r => server.listen(8943, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  // loaded dice: tests push [value, sides] pairs; anything else rolls normally
  await page.addInitScript(() => {
    const real = Math.random; window.__dice = [];
    Math.random = () => { const q = window.__dice.shift(); return q ? (q[0] - .5) / q[1] : real(); };
  });
  await page.goto('http://localhost:8943/');
  await page.waitForTimeout(500);
  const checks = [];
  const ev = (f, a) => page.evaluate(f, a);
  const reset = (rs) => ev(([sc, rs]) => { SET.rules = rs; saveSet(); VTT.apply({ do: 'scene', scene: sc }); window.__dice = []; }, [SCENE, rs]);
  const tok = id => ev(id => { const t = VTT.state().tokens.find(t => t.id === id);
    return { hp: t.hp.cur, conds: t.conds, cval: t.cval || {}, cdur: t.cdur || {}, ds: t.ds || null }; }, id);

  // ---------- condition parsing ----------
  await reset('pf2e');
  await ev(() => VTT.apply({ do: 'cond', t: 'kira', add: ['frightened 2', 'burning 1d6', { name: 'slowed', value: 1, rounds: 2 }, 'c-prone'] }));
  let k = await tok('kira');
  checks.push(['"frightened 2" keeps its value', k.cval.frightened === 2]);
  checks.push(['"burning 1d6" keeps persistent dice', k.cval.burning === '1d6']);
  checks.push(['{name,value,rounds} keeps a duration', k.cval.slowed === 1 && k.cdur.slowed === 2]);
  checks.push(['c- prefix still accepted', k.conds.includes('prone')]);
  checks.push(['token shows a value badge', await ev(() => !!document.querySelector('.token[data-id="kira"] .cond b'))]);
  checks.push(['more than three conditions show +n', await ev(() => /\+2/.test(document.querySelector('.token[data-id="kira"] .cond.more')?.textContent || ''))]);
  await ev(() => VTT.apply({ do: 'cond', t: 'kira', remove: ['burning'] }));
  k = await tok('kira');
  checks.push(['removing clears the value', !k.conds.includes('burning') && k.cval.burning === undefined]);

  // ---------- end of turn: frightened, durations, persistent damage ----------
  await reset('pf2e');
  await ev(() => { VTT.apply({ do: 'combat' }); });
  // put Kira first so ending her turn runs her hooks
  await ev(() => { VTT.apply({ do: 'turn', active: 'kira' }); VTT.apply({ do: 'cond', t: 'kira', add: ['frightened 2', { name: 'slowed', value: 1, rounds: 1 }, 'bleeding 3'] }); });
  await ev(() => { window.__dice.push([10, 20]); VTT.apply({ do: 'next' }); });   // flat check 10: bleeding stays
  k = await tok('kira');
  checks.push(['frightened drops by one at end of turn', k.cval.frightened === 1]);
  checks.push(['a 1-round condition wears off', !k.conds.includes('slowed')]);
  checks.push(['persistent bleed deals its damage', k.hp === 17]);
  checks.push(['failed flat check keeps bleeding', k.conds.includes('bleeding')]);
  await ev(() => { VTT.apply({ do: 'turn', active: 'kira' }); window.__dice.push([17, 20]); VTT.apply({ do: 'next' }); });
  k = await tok('kira');
  checks.push(['frightened 1 ends', !k.conds.includes('frightened')]);
  checks.push(['DC 15 flat check ends bleeding', !k.conds.includes('bleeding') && k.hp === 14]);
  checks.push(['turn effects reach the combat log', await ev(() => VTT.state().combat.log.some(x => /persistent bleed/.test(x.text)))]);

  // ---------- PF2e dying ----------
  await reset('pf2e');
  await ev(() => VTT.apply({ do: 'combat' }));
  await ev(() => VTT.apply({ do: 'damage', t: 'bren', n: 30 }));
  let b = await tok('bren');
  checks.push(['PF2e: 0 HP → unconscious, dying 1', b.conds.includes('unconscious') && b.cval.dying === 1]);
  checks.push(['dying token pulses', await ev(() => document.querySelector('.token[data-id="bren"]').classList.contains('dying'))]);
  // recovery check at the start of his turn: roll a 1 → critical failure → dying 3
  await ev(() => { const i = VTT.state().initiative.findIndex(e => e.t === 'bren'); VTT.state().active = (i - 1 + VTT.state().initiative.length) % VTT.state().initiative.length;
    window.__dice.push([1, 20]); VTT.apply({ do: 'next' }); });
  b = await tok('bren');
  checks.push(['recovery check crit failure: dying 1 → 3', b.cval.dying === 3]);
  await ev(() => VTT.apply({ do: 'heal', t: 'bren', n: 5 }));
  b = await tok('bren');
  checks.push(['healing clears dying and unconscious', !b.conds.includes('dying') && !b.conds.includes('unconscious') && b.hp === 5]);
  checks.push(['… and leaves wounded 1', b.cval.wounded === 1]);
  await ev(() => VTT.apply({ do: 'damage', t: 'bren', n: 9 }));
  b = await tok('bren');
  checks.push(['dropping again starts at dying 1 + wounded', b.cval.dying === 2]);
  await ev(() => { window.__dice.push([20, 20]); VTT.apply({ do: 'attack', t: 'sk1', target: 'bren', bonus: 5, damage: '1d4' }); });
  b = await tok('bren');
  checks.push(['a critical hit while dying adds 2 → dead at 4', b.conds.includes('dead') && !b.conds.includes('dying')]);
  checks.push(['dead token is greyed', await ev(() => document.querySelector('.token[data-id="bren"]').classList.contains('dead'))]);

  // stabilise on a good recovery check
  await reset('pf2e');
  await ev(() => { VTT.apply({ do: 'combat' }); VTT.apply({ do: 'damage', t: 'kira', n: 99 }); });
  await ev(() => { const S = VTT.state(), i = S.initiative.findIndex(e => e.t === 'kira'); S.active = (i - 1 + S.initiative.length) % S.initiative.length;
    window.__dice.push([20, 20]); VTT.apply({ do: 'next' }); });
  k = await tok('kira');
  checks.push(['crit success from dying 1 → stable, still unconscious, wounded 1', !k.conds.includes('dying') && k.conds.includes('unconscious') && k.cval.wounded === 1]);

  // ---------- 5e death saves ----------
  await reset('5e');
  await ev(() => { VTT.apply({ do: 'combat' }); VTT.apply({ do: 'damage', t: 'kira', n: 25 }); });
  k = await tok('kira');
  checks.push(['5e: 0 HP → unconscious and making death saves', k.conds.includes('dying') && k.ds && k.ds.s === 0 && k.ds.f === 0]);
  const kiraTurn = () => ev(v => { const S = VTT.state(), i = S.initiative.findIndex(e => e.t === 'kira'); S.active = (i - 1 + S.initiative.length) % S.initiative.length;
    window.__dice.push([v, 20]); VTT.apply({ do: 'next' }); }, 0);
  await ev(() => { const S = VTT.state(), i = S.initiative.findIndex(e => e.t === 'kira'); S.active = (i - 1 + S.initiative.length) % S.initiative.length; window.__dice.push([12, 20]); VTT.apply({ do: 'next' }); });
  k = await tok('kira');
  checks.push(['death save 12 is a success', k.ds && k.ds.s === 1]);
  await ev(() => VTT.apply({ do: 'damage', t: 'kira', n: 3 }));
  k = await tok('kira');
  checks.push(['damage at 0 HP is a failed save', k.ds && k.ds.f === 1]);
  await ev(() => { const S = VTT.state(), i = S.initiative.findIndex(e => e.t === 'kira'); S.active = (i - 1 + S.initiative.length) % S.initiative.length; window.__dice.push([20, 20]); VTT.apply({ do: 'next' }); });
  k = await tok('kira');
  checks.push(['natural 20 brings them back with 1 HP', k.hp === 1 && !k.conds.includes('dying') && !k.conds.includes('unconscious')]);
  await ev(() => VTT.apply({ do: 'damage', t: 'kira', n: 5 }));
  for (const v of [1, 4]) await ev(v => { const S = VTT.state(), i = S.initiative.findIndex(e => e.t === 'kira'); S.active = (i - 1 + S.initiative.length) % S.initiative.length; window.__dice.push([v, 20]); VTT.apply({ do: 'next' }); }, v);
  k = await tok('kira');
  checks.push(['nat 1 counts twice; third failure kills', k.conds.includes('dead')]);

  // ---------- tally and victory ----------
  await reset('pf2e');
  await ev(() => VTT.apply({ do: 'combat' }));
  checks.push(['rolling initiative opens the tracker when the panel is shut', await ev(() => SIDE_TAB === 'combat' && !$('side').hidden)]);
  checks.push(['tracker lists every combatant', await ev(() => document.querySelectorAll('#p-combat .cb-row').length === 4)]);
  await ev(() => { window.__dice.push([10, 20], [4, 8]); VTT.apply({ do: 'attack', t: 'kira', target: 'sk1', bonus: 9, damage: '1d8+4' }); });
  let st = await ev(() => VTT.state().combat.stats);
  checks.push(['a hit is tallied for the attacker', st.kira && st.kira.hits === 1 && st.kira.dealt === 8]);
  checks.push(['… and as damage taken by the target', st.sk1 && st.sk1.taken === 8]);
  await ev(() => { window.__dice.push([2, 20]); VTT.apply({ do: 'attack', t: 'og', target: 'kira', bonus: 9, damage: '2d10+7' }); });
  st = await ev(() => VTT.state().combat.stats);
  checks.push(['a miss is tallied', st.og && st.og.misses === 1 && st.og.hits === 0]);
  checks.push(['strike animation adds no page errors', errors.length === 0]);
  await ev(() => { window.__dice.push([20, 20], [8, 8]); VTT.apply({ do: 'attack', t: 'kira', target: 'sk1', bonus: 9, damage: '1d8+4' }); });
  st = await ev(() => VTT.state().combat.stats);
  checks.push(['a crit doubles damage and counts a down', st.kira.crits === 1 && st.kira.downs === 1 && st.sk1.taken === 10]);
  checks.push(['no victory while the ogre stands', await ev(() => !VTT.state().combat.result)]);
  await ev(() => VTT.apply({ do: 'damage', t: 'og', n: 99 }));
  await page.waitForTimeout(100);
  checks.push(['last foe down → victory', await ev(() => VTT.state().combat.result === 'victory')]);
  checks.push(['the summary card opens', await ev(() => !$('csum').hidden && /Victory/.test($('csum').textContent))]);
  checks.push(['summary names the hero of the fight', await ev(() => /Kira/.test($('csum').querySelector('.cs-mvp')?.textContent || ''))]);
  await page.screenshot({ path: path.join(__dirname, 'combat-summary.png') });
  await page.click('[data-cs="end"]');
  checks.push(['End combat clears initiative', await ev(() => VTT.state().initiative.length === 0 && $('csum').hidden)]);
  checks.push(['tracker shows its empty state', await ev(() => !!document.querySelector('#p-combat .cb-empty'))]);

  // defeat
  await reset('pf2e');
  await ev(() => { VTT.apply({ do: 'combat' }); VTT.apply({ do: 'damage', t: 'kira', n: 99 }); VTT.apply({ do: 'damage', t: 'bren', n: 99 }); });
  await page.waitForTimeout(100);
  checks.push(['whole party down → defeat', await ev(() => VTT.state().combat.result === 'defeat')]);
  await ev(() => { $('csum').hidden = true; });

  // ---------- tracker panel controls ----------
  await reset('pf2e');
  await ev(() => VTT.apply({ do: 'combat' }));
  await page.fill('#p-combat .cb-row[data-id="og"] .cb-q input', '7');
  await page.click('#p-combat .cb-row[data-id="og"] [data-cb="dmg"]');
  checks.push(['quick damage from the tracker', (await tok('og')).hp === 23]);
  await page.fill('#p-combat .cb-row[data-id="og"] .cb-q input', '3');
  await page.click('#p-combat .cb-row[data-id="og"] [data-cb="heal"]');
  checks.push(['quick heal from the tracker', (await tok('og')).hp === 26]);
  await page.selectOption('#cbtok', 'og');
  await page.selectOption('#cbcond', 'frightened');
  await page.fill('#cbval', '2'); await page.fill('#cbrd', '3');
  await page.click('[data-cb="addcond"]');
  let og = await tok('og');
  checks.push(['add-condition control', og.cval.frightened === 2 && og.cdur.frightened === 3]);
  await page.click('#p-combat .cb-row[data-id="og"] [data-cb="uncond"]');
  checks.push(['tapping a condition chip removes it', !(await tok('og')).conds.includes('frightened')]);
  const before = await ev(() => VTT.state().active);
  await page.click('#p-combat [data-cb="next"]');
  checks.push(['Next turn button advances', await ev(b => VTT.state().active !== b || VTT.state().round > 1, before)]);
  await page.click('#gmtoggle'); await page.click('#gmundo'); await page.click('#gmtoggle');
  checks.push(['undo steps back one tracker action', await ev(b => VTT.state().active === b, before)]);
  await page.screenshot({ path: path.join(__dirname, 'combat-tracker.png') });

  // ---------- validation for the AI tools ----------
  const errs = await ev(() => ({
    unknown: checkCmds([{ do: 'cond', t: 'kira', add: ['petrified-ish'] }]),
    badval: checkCmds([{ do: 'cond', t: 'kira', add: [{ name: 'frightened', value: 'lots' }] }]),
    badrounds: checkCmds([{ do: 'cond', t: 'kira', add: ['slowed'], rounds: 0 }]),
    empty: checkCmds([{ do: 'cond', t: 'kira' }]),
    ok: checkCmds([{ do: 'cond', t: 'kira', add: ['frightened 2', 'burning 1d6', { name: 'slowed', rounds: 2 }], remove: ['prone'] }]),
    saveCond: checkCmds([{ do: 'save', t: 'kira', mod: 5, dc: 18, cond: 'zapped' }]),
    bonus: checkCmds([{ do: 'attack', t: 'kira', target: 'og', bonus: 'big', damage: '1d8' }]),
  }));
  checks.push(['unknown condition is rejected with the list', errs.unknown.length === 1 && /unknown condition/.test(errs.unknown[0]) && /frightened/.test(errs.unknown[0])]);
  checks.push(['bad condition value rejected', errs.badval.length === 1]);
  checks.push(['rounds 0 rejected', errs.badrounds.length === 1]);
  checks.push(['cond with nothing to do rejected', errs.empty.length === 1]);
  checks.push(['good cond commands pass', errs.ok.length === 0]);
  checks.push(['save with an unknown condition rejected', errs.saveCond.length === 1]);
  checks.push(['non-numeric attack bonus rejected', errs.bonus.length === 1]);
  const brief = await ev(() => { VTT.apply({ do: 'cond', t: 'kira', add: ['frightened 2'] }); return boardBrief().tokens.find(t => t.id === 'kira'); });
  checks.push(['board brief shows condition values', brief.conds.includes('frightened 2') && brief.ac === 18]);

  // ---------- persistence ----------
  await ev(() => { VTT.apply({ do: 'cond', t: 'kira', add: [{ name: 'slowed', value: 1, rounds: 2 }] }); save(); });
  await page.waitForTimeout(500); await page.reload(); await page.waitForTimeout(600);
  k = await tok('kira');
  checks.push(['values and durations survive a reload', k.cval.frightened === 2 && k.cdur.slowed === 2]);
  checks.push(['combat state survives a reload', await ev(() => VTT.state().combat && VTT.state().combat.on === true)]);

  // ---------- phone width ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await ev(() => openSide('combat', true));
  await page.waitForTimeout(200);
  const ph = await ev(() => ({ over: document.documentElement.scrollWidth - innerWidth,
    row: document.querySelector('#p-combat .cb-row').getBoundingClientRect().width }));
  checks.push(['tracker fits a phone without sideways scroll', ph.over <= 1 && ph.row > 300]);
  await page.screenshot({ path: path.join(__dirname, 'combat-phone.png'), fullPage: false });

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
