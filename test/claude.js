// The Claude panel against a mocked api.anthropic.com: key handling, the
// request shape, tool loops with validation errors, the Director's notes and
// the map maker's build-check-retry loop. No real key and no network.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(f));
});
const FAKE = 'sk-ant-test-0000-not-a-real-key';

// one scripted reply → a Messages API event stream
function sse({ blocks = [], stop = 'end_turn', usage = { input_tokens: 1200, output_tokens: 300 } }) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { id: 'msg_x', model: 'm', usage: { input_tokens: usage.input_tokens, output_tokens: 1 } } });
  blocks.forEach((b, i) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (const part of b.text.match(/.{1,24}/gs) || []) out += ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: part } });
    } else if (b.type === 'thinking') {
      out += ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '' } });
      out += ev('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: b.thinking } });
      out += ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'sig' } });
    } else {
      out += ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      const j = JSON.stringify(b.input);
      for (let k = 0; k < j.length; k += 40) out += ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: j.slice(k, k + 40) } });
    }
    out += ev('content_block_stop', { index: i });
  });
  out += ev('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: usage.output_tokens } });
  out += ev('message_stop', {});
  return out;
}
const text = t => ({ blocks: [{ type: 'text', text: t }] });
const tool = (id, name, input, pre) => ({ blocks: [...(pre ? [{ type: 'text', text: pre }] : []), { type: 'thinking', thinking: 'planning' }, { type: 'tool_use', id, name, input }], stop: 'tool_use' });

(async () => {
  await new Promise(r => server.listen(8942, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { logs.push(m.text()); if (m.type() === 'error' && !/404|Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });

  const keyHosts = new Set();
  page.on('request', rq => { const h = rq.headers(); if (Object.values(h).some(v => String(v).includes(FAKE)) || (rq.postData() || '').includes(FAKE) || rq.url().includes(FAKE)) keyHosts.add(new URL(rq.url()).host); });
  const queue = [], seen = [];
  let mode = 'ok';
  await page.route('https://api.anthropic.com/**', async route => {
    const rq = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (mode === 'down') return route.abort('internetdisconnected');
    seen.push({ headers: rq.headers(), body: JSON.parse(rq.postData() || '{}') });
    const next = queue.shift();
    if (!next) return route.fulfill({ status: 500, headers: cors, body: '{"error":{"message":"test queue empty"}}' });
    if (next.status) return route.fulfill({ status: next.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(next.json || {}) });
    route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(next) });
  });

  await page.goto('http://localhost:8942/');
  await page.waitForTimeout(500);
  const checks = [];
  const idle = () => page.waitForFunction(() => !CL.busy, null, { timeout: 8000 }).catch(() => {});

  // --- key handling
  await page.click('#side .tab[data-tab="claude"]').catch(async () => { await page.click('#claudebtn'); });
  await page.evaluate(() => openSide('claude', true));
  await page.waitForTimeout(150);
  checks.push(['panel opens on the key box', await page.isVisible('#clkey')]);
  checks.push(['key field is a password field', await page.getAttribute('#clkey', 'type') === 'password']);
  await page.fill('#clkey', FAKE); await page.click('#clsetkey');
  await page.waitForTimeout(100);
  let st = await page.evaluate(k => ({ s: sessionStorage.getItem('vtt-anthropic-key'), l: localStorage.getItem('vtt-anthropic-key') }), FAKE);
  checks.push(['default: key kept for this tab only', st.s === FAKE && st.l === null]);
  checks.push(['the panel says where the key lives', /for this tab only/.test(await page.textContent('#p-claude'))]);
  checks.push(['the key is not echoed into the page', !(await page.content()).includes(FAKE)]);
  await page.click('#clforget'); await page.waitForTimeout(80);
  st = await page.evaluate(() => ({ s: sessionStorage.getItem('vtt-anthropic-key'), l: localStorage.getItem('vtt-anthropic-key') }));
  checks.push(['forget key clears it', st.s === null && st.l === null && await page.isVisible('#clkey')]);
  await page.fill('#clkey', FAKE); await page.check('#clremember'); await page.click('#clsetkey');
  st = await page.evaluate(() => ({ s: sessionStorage.getItem('vtt-anthropic-key'), l: localStorage.getItem('vtt-anthropic-key') }));
  checks.push(['remember on this device uses local storage only', st.l === FAKE && st.s === null]);
  await page.click('#clforget');
  await page.fill('#clkey', FAKE); await page.click('#clsetkey');

  // --- rules assistant: request shape, roll, suggestion card, apply
  queue.push(
    tool('tu1', 'roll_dice', { dice: 'd20+7', label: 'Kira athletics', dc: 15 }),
    tool('tu2', 'suggest_commands', { commands: [{ do: 'move', t: 'Kira', to: 'J6' }], summary: 'Kira steps to J6 to flank' }),
    text('Flanking needs an ally on the **opposite side**. Kira can step to J6 and take the flank.'));
  await page.fill('#clin', 'Can Kira flank the skeleton?'); await page.press('#clin', 'Enter');
  await idle();
  const r0 = seen[0] || { headers: {}, body: {} };
  checks.push(['sends x-api-key', r0.headers['x-api-key'] === FAKE]);
  checks.push(['sends anthropic-version 2026-10-21', r0.headers['anthropic-version'] === '2026-10-21']);
  checks.push(['sends the direct-browser-access header', r0.headers['anthropic-dangerous-direct-browser-access'] === 'true']);
  checks.push(['streams, caches the system prompt, no sampling params', r0.body.stream === true && r0.body.system && r0.body.system[0].cache_control
    && !('temperature' in r0.body) && !('top_p' in r0.body) && !('top_k' in r0.body)]);
  checks.push(['uses the chosen model with effort', r0.body.model === 'claude-haiku-5-5' && r0.body.output_config && r0.body.output_config.effort === 'low']);
  checks.push(['offers roll_dice and suggest_commands', JSON.stringify((r0.body.tools || []).map(t => t.name)) === '["roll_dice","suggest_commands"]']);
  checks.push(['board state goes in the prompt', /Kira/.test(JSON.stringify(r0.body.messages)) && /J5/.test(JSON.stringify(r0.body.messages))]);
  const r1 = seen[1] || { body: { messages: [] } }, last1 = r1.body.messages[r1.body.messages.length - 1] || {};
  checks.push(['tool result goes back with the roll', Array.isArray(last1.content) && last1.content[0].type === 'tool_result' && /total/.test(last1.content[0].content)]);
  checks.push(['thinking kept inside the tool loop', JSON.stringify(r1.body.messages).includes('"thinking"')]);
  checks.push(['the roll lands on the dice tray', await page.evaluate(() => ROLL_LOG.some(r => /athletics/.test(r.label || '')))]);
  checks.push(['streamed answer is rendered', /opposite side/.test(await page.textContent('#cllog'))]);
  checks.push(['history is stored without thinking blocks', await page.evaluate(() => !JSON.stringify(CL.chat).includes('"thinking"') && CL.chat.length >= 4)]);
  checks.push(['suggestion card with an Apply button', await page.isVisible('.cl-sug [data-apply]')]);
  checks.push(['suggestion not applied by itself', await page.evaluate(() => { const k = VTT.state().tokens.find(t => t.name === 'Kira'); return k.r === 9 && k.c === 4; })]);
  await page.click('.cl-sug [data-apply]'); await page.waitForTimeout(150);
  checks.push(['Apply moves Kira to J6', await page.evaluate(() => { const k = VTT.state().tokens.find(t => t.name === 'Kira'); return k.r === 9 && k.c === 5; })]);
  checks.push(['the card says it was applied', /applied/.test(await page.textContent('.cl-sug'))]);
  checks.push(['cost meter counts the calls', /\$/.test(await page.textContent('#clusage')) && await page.evaluate(() => USAGE.calls === 3)]);

  // --- narrator: a bad command is rejected and rolled back, the fix goes through
  await page.click('[data-cmode="narrator"]'); await page.waitForTimeout(100);
  const hpBefore = await page.evaluate(() => VTT.state().tokens.map(t => t.hp && t.hp.cur).join());
  queue.push(
    tool('n1', 'apply_commands', { commands: [{ do: 'damage', t: 'Skel A', n: 5 }, { do: 'move', t: 'Zed', to: 'E5' }] }),
    tool('n2', 'apply_commands', { commands: [{ do: 'damage', t: 'Skel A', n: 5 }] }),
    text('Kira’s blade bites into the skeleton’s ribs; bone splinters across the shingle. It is still your turn, Kira.'));
  const before = seen.length;
  await page.fill('#clin', 'Kira hacks at the nearest skeleton'); await page.press('#clin', 'Enter');
  await idle();
  const n2 = seen[before + 1] || { body: { messages: [] } }, res1 = (n2.body.messages[n2.body.messages.length - 1] || {}).content || [];
  checks.push(['narrator gets apply_commands and roll_dice', JSON.stringify(((seen[before] || {}).body || {}).tools?.map(t => t.name)) === '["roll_dice","apply_commands"]']);
  checks.push(['bad batch comes back as an error', res1[0] && res1[0].is_error === true && /Zed/.test(res1[0].content) && /Nothing was applied/.test(res1[0].content)]);
  const hpAfter = await page.evaluate(() => VTT.state().tokens.find(t => t.name === 'Skel A').hp.cur);
  checks.push(['the bad batch changed nothing, the fix applied once', hpAfter === 8 && hpBefore.includes('13')]);
  checks.push(['narration shown in the story style', /bone splinters/.test(await page.textContent('#cllog')) && await page.isVisible('.cl-msg.narr')]);
  checks.push(['error shown as a tool note', await page.isVisible('.cl-tool.err')]);

  // --- director: scores and notes, then notes steer the next narration
  queue.push(text('```json\n{"scores":{"narrative_coherence":8,"encounter_pacing":6,"lore_consistency":9,"player_agency":7,"tone_calibration":8,"rule_accuracy":9,"dramatic_tension":5},"summary":"Solid.","notes_for_narrator":["Have the ogre wade ashore and roar"],"next_beat":"The tide turns the shingle into a trap."}\n```'));
  const dIdx = seen.length;
  await page.click('#cldirect'); await idle();
  checks.push(['director runs on the director model', (seen[dIdx] || { body: {} }).body.model === 'claude-sonnet-5-5']);
  checks.push(['director scores shown as bars', (await page.$$('.cl-dir .bar')).length === 7]);
  checks.push(['director notes shown', /ogre wade ashore/.test(await page.textContent('#p-claude'))]);
  queue.push(text('The ogre wades out of the surf, roaring.'));
  const nIdx = seen.length;
  await page.fill('#clin', 'Bren readies a spell'); await page.press('#clin', 'Enter');
  await idle();
  checks.push(['notes reach the next narrator prompt', /ogre wade ashore/.test(((seen[nIdx] || { body: {} }).body.system || [{ text: '' }])[0].text)]);
  checks.push(['narrator is a fresh request each turn', ((seen[nIdx] || { body: {} }).body.messages || []).length === 1]);

  // --- map maker: invalid build is rolled back, the fixed one is checked and kept, then graded
  await page.click('[data-cmode="map"]'); await page.waitForTimeout(100);
  const party = [{ id: 'K', name: 'Kira', at: 'B2', kind: 'pc', icon: 'swordwoman', hp: 24, ac: 18, init: 7 },
    { id: 'B', name: 'Bren', at: 'C3', kind: 'pc', icon: 'wizard', hp: 26, ac: 15, init: 5 }];
  const scene = toks => ({ header: 'Test Barrow', sub: 'a ring of stones', rows: 12, cols: 12, ground: 'stone',
    zones: [{ from: 'A1', to: 'C2', type: 'rock' }, { from: 'F6', to: 'G7', type: 'water' }],
    props: [{ kind: 'pillar', at: 'E9' }, { kind: 'brazier', at: 'H4' }], tokens: toks });
  queue.push(
    tool('m1', 'build_map', { scene: scene([...party, { id: 'g1', name: 'Ghoul', at: 'K10', kind: 'foe', art: 'ghoul', hp: 20, ac: 14, init: 6 }]) }),
    tool('m2', 'build_map', { scene: scene([{ ...party[0], at: 'E2' }, { ...party[1], at: 'E3' },
      { id: 'g1', name: 'Ghoul', at: 'K10', kind: 'foe', art: 'ghoul', hp: 20, ac: 14, init: 6 }]) }),
    text('A barrow ring: the pillar and the pool split the approach.'),
    text('{"score":8,"strengths":"good cover","fixes":""}'));
  const mIdx = seen.length;
  await page.fill('#clmapbrief', 'Two adventurers meet a ghoul in a barrow');
  await page.click('#clmapgo'); await idle();
  const m2 = seen[mIdx + 1] || { body: { messages: [] } }, mres = (m2.body.messages[m2.body.messages.length - 1] || {}).content || [];
  checks.push(['map maker offers build_map only', JSON.stringify(((seen[mIdx] || {}).body || {}).tools?.map(t => t.name)) === '["build_map"]']);
  checks.push(['map prompt lists the asset library', /ASSET LIBRARY/.test(((seen[mIdx] || { body: {} }).body.system || [{ text: '' }])[0].text)]);
  checks.push(['token in solid rock is refused', mres[0] && mres[0].is_error && /inside solid wall/.test(mres[0].content)]);
  checks.push(['second build is on the board', await page.evaluate(() => VTT.state().header === 'Test Barrow' && VTT.state().tokens.length === 3)]);
  const m3 = seen[mIdx + 2] || { body: { messages: [] } }, mres3 = (m3.body.messages[m3.body.messages.length - 1] || {}).content || [];
  checks.push(['the model gets a text picture of the map', mres3[0] && !mres3[0].is_error && /Built on attempt 2/.test(mres3[0].content) && /@/.test(mres3[0].content)]);
  checks.push(['director grades the map', /director: 8\/10/.test(await page.textContent('#cllog'))]);
  await page.click('#gmtoggle'); await page.waitForTimeout(80); await page.click('#gmundo'); await page.waitForTimeout(150); await page.click('#gmtoggle');
  checks.push(['one undo takes the map back', await page.evaluate(() => VTT.state().header !== 'Test Barrow')]);

  // --- errors: bad key, network down
  await page.click('[data-cmode="rules"]');
  queue.push({ status: 401, json: { error: { message: 'invalid x-api-key' } } });
  await page.fill('#clin', 'hello'); await page.press('#clin', 'Enter'); await idle();
  checks.push(['401 explained in plain words', /refused that key/.test(await page.textContent('#cllog'))]);
  mode = 'down';
  await page.fill('#clin', 'hello again'); await page.press('#clin', 'Enter'); await idle();
  checks.push(['network failure points to the page engine', /engine to “this page”/.test(await page.textContent('#cllog'))]);
  mode = 'ok';

  // --- the key never leaks into saved state or logs
  await page.waitForTimeout(400);
  const leak = await page.evaluate(k => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) { const n = localStorage.key(i); if (n !== 'vtt-anthropic-key' && (localStorage.getItem(n) || '').includes(k)) out.push(n); }
    for (let i = 0; i < sessionStorage.length; i++) { const n = sessionStorage.key(i); if (n !== 'vtt-anthropic-key' && (sessionStorage.getItem(n) || '').includes(k)) out.push(n); }
    if (document.documentElement.outerHTML.includes(k)) out.push('DOM');
    return out;
  }, FAKE);
  checks.push(['key is in no other storage slot or the DOM', leak.length === 0]);
  checks.push(['key never printed to the console', !logs.some(l => l.includes(FAKE))]);
  checks.push(['key only ever sent to api.anthropic.com', keyHosts.size === 1 && keyHosts.has('api.anthropic.com')]);

  // --- reload: the chat log survives, the tab key survives, nothing else does
  await page.reload(); await page.waitForTimeout(600);
  await page.evaluate(() => openSide('claude', true)); await page.waitForTimeout(150);
  checks.push(['log restored after reload', /opposite side|refused that key/.test(await page.textContent('#p-claude'))]);
  checks.push(['tab key still set after reload', await page.evaluate(() => keyWhere() === 'tab')]);

  // --- the page engine (a Claude artifact's own sample capability), mocked
  const p2 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  p2.on('pageerror', e => errors.push('page engine: ' + e.message));
  await p2.addInitScript(() => {
    window.__calls = [];
    const s = async (input, opts = {}) => {
      window.__calls.push({ input, tier: opts.modelTier, tools: (opts.tools || []).map(t => t.name), cache: opts.cache });
      if (opts.tools && opts.tools.length) {
        const t = opts.tools.find(x => x.name === 'apply_commands');
        if (t) { try { await t.execute({ commands: [{ do: 'combat' }] }); } catch (e) { window.__err = String(e.message || e); } }
      }
      const text = (opts.tools || []).some(t => t.name === 'apply_commands') ? 'Steel rings as the fight begins.' : 'Flanking gives the target off-guard.';
      opts.onText && opts.onText({ text, delta: text });
      return { text, truncated: false };
    };
    s.limits = async () => ({ tools: true, images: false });
    window.claude = { use: async n => (n === 'sample' ? s : null) };
  });
  await p2.goto('http://localhost:8942/'); await p2.waitForTimeout(600);
  await p2.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p2.reload(); await p2.waitForTimeout(600);
  await p2.evaluate(() => openSide('claude', true)); await p2.waitForTimeout(150);
  checks.push(['page engine picked when no key is set', await p2.evaluate(() => engine() === 'page') && !(await p2.isVisible('#clkey'))]);
  await p2.evaluate(() => { SET.cmode = 'rules'; renderClaude(); });
  await p2.fill('#clin', 'How does flanking work?'); await p2.press('#clin', 'Enter');
  await p2.waitForFunction(() => !CL.busy, null, { timeout: 5000 }).catch(() => {});
  let calls = await p2.evaluate(() => window.__calls);
  checks.push(['page engine: rules question answered', /off-guard/.test(await p2.textContent('#cllog'))]);
  checks.push(['page engine: system prompt and board folded into the input', calls[0] && /rules assistant/.test(calls[0].input) && /Kira/.test(calls[0].input) && calls[0].tier === 'quick']);
  await p2.click('[data-cmode="narrator"]');
  await p2.fill('#clin', 'We attack!'); await p2.press('#clin', 'Enter');
  await p2.waitForFunction(() => !CL.busy, null, { timeout: 5000 }).catch(() => {});
  calls = await p2.evaluate(() => window.__calls);
  checks.push(['page engine: narrator gets the board tools', calls[1] && calls[1].tools.includes('apply_commands') && calls[1].cache === undefined]);
  checks.push(['page engine: the tool really drives the board', await p2.evaluate(() => VTT.state().initiative.length >= 4 && !window.__err)]);
  checks.push(['page engine sends no request to the API', !keyHosts.has('api.anthropic.com') || seen.length === 13]);
  await p2.close();

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('requests:', seen.length, ' page errors:', errors.length ? errors : 'none');
  if (process.env.VTT_SHOTS) await page.screenshot({ path: process.env.VTT_SHOTS + '/claude-panel.png' });
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
