// Every tool the models can call is checked against its schema before it
// runs, and fuzzed: hundreds of malformed inputs per tool must come back as a
// plain error for the model and leave the board exactly as it was.
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
  await new Promise(r => server.listen(8944, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  const queue = [], seen = [];
  await page.route('https://api.anthropic.com/**', async route => {
    const rq = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push({ body: JSON.parse(rq.postData() || '{}') });
    const next = queue.shift();
    if (!next) return route.fulfill({ status: 500, headers: cors, body: '{"error":{"message":"test queue empty"}}' });
    route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(next) });
  });
  await page.goto('http://localhost:8944/');
  await page.waitForTimeout(500);
  const checks = [];

  // ---------- the schemas themselves ----------
  const shape = await page.evaluate(() => {
    const T = [TOOL_ROLL, TOOL_APPLY, TOOL_SUGGEST, TOOL_BUILD];
    const tryIt = (t, i) => { try { prepToolInput(t, i); return null; } catch (e) { return e.message; } };
    return {
      allObjects: T.every(t => t.input_schema.type === 'object' && Array.isArray(t.input_schema.required)),
      rollNoDice: tryIt(TOOL_ROLL, {}), rollNum: tryIt(TOOL_ROLL, { dice: 7 }), rollDcStr: tryIt(TOOL_ROLL, { dice: 'd20', dc: '15' }),
      rollDcBig: tryIt(TOOL_ROLL, { dice: 'd20', dc: 400 }), rollOk: tryIt(TOOL_ROLL, { dice: '2d6+3', label: 'x', dc: 12 }),
      applyNone: tryIt(TOOL_APPLY, {}), applyEmpty: tryIt(TOOL_APPLY, { commands: [] }), applyNoDo: tryIt(TOOL_APPLY, { commands: [{ t: 'Kira' }] }),
      applyBadDo: tryIt(TOOL_APPLY, { commands: [{ do: 'teleport' }] }), applyStr: tryIt(TOOL_APPLY, { commands: '[{"do":"next"}]' }),
      applyOne: tryIt(TOOL_APPLY, { commands: { do: 'next' } }), apply41: tryIt(TOOL_APPLY, { commands: Array(41).fill({ do: 'next' }) }),
      sugNoSum: tryIt(TOOL_SUGGEST, { commands: [{ do: 'next' }] }), sugLong: tryIt(TOOL_SUGGEST, { commands: [{ do: 'next' }], summary: 'x'.repeat(300) }),
      buildNone: tryIt(TOOL_BUILD, {}), buildArr: tryIt(TOOL_BUILD, { scene: [1, 2] }), buildStr: tryIt(TOOL_BUILD, { scene: '{"rows":10}' }),
      itemEnum: TOOL_APPLY.input_schema.properties.commands.items.properties.do.enum.length,
    };
  });
  checks.push(['every tool schema is an object with required fields', shape.allObjects]);
  checks.push(['roll_dice: missing dice rejected', /dice is required/.test(shape.rollNoDice || '')]);
  checks.push(['roll_dice: a number for dice rejected', /should be a string/.test(shape.rollNum || '')]);
  checks.push(['roll_dice: "15" as a DC accepted', shape.rollDcStr === null]);
  checks.push(['roll_dice: DC 400 rejected', /above 99/.test(shape.rollDcBig || '')]);
  checks.push(['roll_dice: good input passes', shape.rollOk === null]);
  checks.push(['apply_commands: missing commands rejected', /commands is required/.test(shape.applyNone || '')]);
  checks.push(['apply_commands: empty array rejected', /at least 1/.test(shape.applyEmpty || '')]);
  checks.push(['apply_commands: command without "do" rejected', /\[0\]\.do is required/.test(shape.applyNoDo || '')]);
  checks.push(['apply_commands: unknown command named with the list', /not one of/.test(shape.applyBadDo || '') && /attack/.test(shape.applyBadDo || '')]);
  checks.push(['apply_commands: JSON-string array taken gently', shape.applyStr === null]);
  checks.push(['apply_commands: a single object taken gently', shape.applyOne === null]);
  checks.push(['apply_commands: more than 40 rejected', /more than 40/.test(shape.apply41 || '')]);
  checks.push(['suggest_commands: summary required', /summary is required/.test(shape.sugNoSum || '')]);
  checks.push(['suggest_commands: overlong summary rejected', /longer than 200/.test(shape.sugLong || '')]);
  checks.push(['build_map: scene required', /scene is required/.test(shape.buildNone || '')]);
  checks.push(['build_map: an array is not a scene', /should be an object/.test(shape.buildArr || '')]);
  checks.push(['build_map: scene as a JSON string taken gently', shape.buildStr === null]);
  checks.push(['command names come from the board itself', shape.itemEnum >= 40]);

  // ---------- fuzz: malformed input never half-applies ----------
  const fuzz = await page.evaluate(() => {
    let seed = 1234567;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const FIELDS = ['do', 't', 'target', 'to', 'at', 'from', 'n', 'hp', 'dice', 'dc', 'mod', 'bonus', 'add', 'remove', 'damage', 'cond', 'type',
      'carry', 'value', 'rounds', 'token', 'marker', 'scene', 'label', 'text', 'active', 'end', 'map', 'ft', 'intensity', 'light', 'id', 'on'];
    const ids = () => VTT.state().tokens.map(t => t.id);
    const leaf = () => pick([() => pick(ids()), () => pick(['E7', 'A1', 'Z99', 'Q', '', 'D07', 'e5']), () => pick(['2d6+3', 'd20', 'd', '1d0', '9999d9999', 'fire']),
      () => pick([0, 1, -5, 3.5, 1e9, -1e9, 40]), () => pick([true, false, null]), () => pick(['prone', 'frightened 2', 'burning 1d6', 'nope', 'c-']),
      () => pick(['storm', 'dusk', 'torch', 'all', 'none']), () => 'x'.repeat(Math.floor(rnd() * 40))])();
    const val = d => d > 2 ? leaf() : pick([leaf, leaf, leaf, () => Array.from({ length: Math.floor(rnd() * 4) }, () => val(d + 1)), () => obj(d + 1)])();
    const obj = d => { const o = {}; const n = Math.floor(rnd() * 5); for (let i = 0; i < n; i++) o[pick(FIELDS)] = val(d); return o; };
    const SAFE = [...CMD_NAMES].filter(c => !['scene', 'world', 'room', 'goto'].includes(c));
    const cmd = () => { const o = obj(1); if (rnd() < .9) o.do = pick(rnd() < .95 ? SAFE : ['teleport', 'DAMAGE', '', 7]); return o; };
    const input = t => {
      const r = rnd();
      if (r < .08) return pick([null, 7, 'text', [], true]);
      if (t.name === 'roll_dice') return rnd() < .5 ? { dice: leaf(), ...(rnd() < .5 ? { dc: leaf() } : {}), ...(rnd() < .3 ? { label: leaf() } : {}) } : obj(1);
      if (t.name === 'build_map') return { scene: rnd() < .7 ? { rows: leaf(), cols: leaf(), tokens: rnd() < .5 ? [obj(1), obj(1)] : leaf(), zones: rnd() < .5 ? [obj(1)] : undefined, ground: leaf() } : leaf() };
      const cs = Array.from({ length: 1 + Math.floor(rnd() * 4) }, cmd);
      return { commands: rnd() < .1 ? JSON.stringify(cs) : rnd() < .05 ? leaf() : cs, ...(t.name === 'suggest_commands' && rnd() < .8 ? { summary: 'fuzz' } : {}) };
    };
    const ctx = { suggest: () => {} };
    const out = { runs: 0, ok: 0, rejected: 0, nonError: [], halfApplied: [], crashed: [] };
    const snap = () => JSON.stringify(VTT.state());
    for (const t of [TOOL_ROLL, TOOL_APPLY, TOOL_SUGGEST, TOOL_BUILD]) {
      for (let i = 0; i < 300; i++) {
        if (i % 40 === 0) { VTT.apply({ do: 'scene', scene: DEFAULT_SCENE }); $('csum').hidden = true; }
        const inp = input(t), before = snap();
        out.runs++;
        try { t.run(prepToolInput(t, inp), { ...ctx }); out.ok++; }
        catch (e) {
          out.rejected++;
          if (!(e instanceof Error)) out.nonError.push(t.name + ': ' + String(e).slice(0, 80));
          if ((t.name === 'apply_commands' || t.name === 'build_map' || t.name === 'suggest_commands') && snap() !== before) out.halfApplied.push(t.name + ' ' + JSON.stringify(inp).slice(0, 160));
        }
        try { if (!Array.isArray(VTT.state().tokens) || typeGrid.length !== VTT.state().rows) throw 'grid out of step'; }
        catch (e) { out.crashed.push(t.name + ' ' + e); VTT.apply({ do: 'scene', scene: DEFAULT_SCENE }); }
      }
    }
    $('csum').hidden = true;
    return out;
  });
  checks.push([`fuzz: ${fuzz.runs} malformed calls ran (${fuzz.ok} applied, ${fuzz.rejected} refused)`, fuzz.runs === 1200 && fuzz.rejected > 300 && fuzz.ok > 50]);
  checks.push(['fuzz: every refusal is an Error the model can read', fuzz.nonError.length === 0]);
  checks.push(['fuzz: a refused call never changes the board', fuzz.halfApplied.length === 0]);
  checks.push(['fuzz: the board never falls out of step', fuzz.crashed.length === 0]);
  if (fuzz.nonError.length || fuzz.halfApplied.length || fuzz.crashed.length) console.log(JSON.stringify({ n: fuzz.nonError.slice(0, 5), h: fuzz.halfApplied.slice(0, 5), c: fuzz.crashed.slice(0, 5) }, null, 1));

  // ---------- end to end: a bad tool call goes back to the model, the retry works ----------
  await page.evaluate(() => { VTT.apply({ do: 'scene', scene: DEFAULT_SCENE }); openSide('claude', true); });
  await page.fill('#clkey', FAKE); await page.click('#clsetkey');
  queue.push(
    tool('b1', 'roll_dice', { dice: 20, label: 'perception' }),
    tool('b2', 'roll_dice', { dice: 'd20+4', label: 'perception', dc: 15 }),
    text('The sentry spots nothing amiss.'));
  await page.fill('#clin', 'Does the sentry notice us?'); await page.press('#clin', 'Enter');
  await page.waitForFunction(() => !CL.busy, null, { timeout: 8000 }).catch(() => {});
  const r1 = seen[1] || { body: { messages: [] } }, res = (r1.body.messages[r1.body.messages.length - 1] || {}).content || [];
  checks.push(['schema error returned as is_error to the model', res[0] && res[0].is_error === true && /doesn't match its schema/.test(res[0].content) && /dice should be a string/.test(res[0].content)]);
  checks.push(['the corrected call rolls', await page.evaluate(() => ROLL_LOG.some(r => r.label === 'perception' && r.dc === 15))]);
  checks.push(['the answer still arrives', /spots nothing/.test(await page.textContent('#cllog'))]);
  checks.push(['the bad call shows as a tool note', await page.isVisible('.cl-tool.err')]);

  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
  console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
