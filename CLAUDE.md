# Claude VTT

Single-file virtual tabletop (`index.html`) driven by a Claude gamemaster
via a JSON command protocol. No build, no dependencies, no framework.

## If you are gamemastering a play session

Read `GM_PROTOCOL.md` first — it is the complete command language. Icon ids
live in `TOKENS_index.md`. In short:

- Emit one fenced ```json block per update for the player to paste into the
  board's **⚙ GM** console, or — if you have file access and the board is
  served over HTTP from this directory — write
  `{"seq": N, "batch": [...]}` to `feed.json` (increment `seq` every write;
  the board polls it every 2 s).
- Open encounters with a `scene` command; run turns as one batch: `say`,
  moves, damage, conditions, `next`.
- The board is fully player-visible — never stage hidden enemies on it;
  `spawn` them when revealed.
- When the player pastes board state back (from **⧉ copy state for GM**),
  treat it as ground truth over your own notes.

To serve locally: `python3 -m http.server` (or `npx http-server`) in the
repo root, then open `http://localhost:8000/`.

## If you are changing the code

- `index.html` is the entire product: styles, a ~380 KB inline SVG icon
  sprite (one long line — game-icons.net, CC BY 3.0, keep the attribution
  comment), and the engine script. Everything renders from the single state
  object `S`; mutate it only through `applyCmd`/UI handlers so rendering,
  persistence, and the GM log stay in sync.
- Grid refs are row-letter + column-number ("D7"); `normScene`/`normToken`
  convert external refs to internal 0-based `r`/`c`.
- Verify with the regression suites: `node test/smoke.js`, `node test/fow.js`,
  `node test/world.js`, `node test/mega.js`, `node test/tiles.js`,
  `node test/builder.js`, `node test/claude.js`, `node test/combat.js`,
  `node test/tools.js`, `node test/ambience.js` and `node test/area.js`
  (need Playwright;
  preinstalled in Claude Code web sessions — `NODE_PATH=/opt/node22/lib/node_modules`
  if it isn't local). It serves the repo, drives `window.VTT.apply([...])`,
  asserts on `window.VTT.stateForGM()`, checks the board fits its viewport
  at phone and desktop sizes, and fails on any page error. Add a check when
  you add a command. Keep `node --check` passing on the extracted
  `<script>` body.
- Multi-room worlds live in `WORLD` (rooms, links, pristine copies); `S` is
  always the *current* room and points into `WORLD.rooms`. `WORLD` is null in
  plain single-scene mode, and every code path must keep working in it.
- Ways between rooms are drawn by `drawPortal`/`drawEdgePortal` from
  `roomPortals()`, painted after markers but before `drawFOW` so fog hides
  undiscovered exits. Up/down arrows come from the two rooms' `floor` values.
- Fog of war lives in `computeLight`/`computeVision`/`drawFOW`: a light grid
  (ambient + sources, occluded by walls), shadowcasting FOV per viewer, then
  visibility = line of sight AND (lit OR within darkvision). Anything that
  moves a token, a light, or a wall must call `refreshFOW()`, not `repaint()`.
- Light from every source accumulates into `glowWarm`/`glowCool` in
  `computeLight`, clamped to `S.maxLight` (default `GLOW_CAP_DEFAULT`), and
  is painted by `drawGlow` from a one-pixel-per-cell canvas — never add a
  per-source radial gradient back, that is what used to wash the board out.
- Walls come in two forms that must stay equivalent for sight: the `pit`
  zone type and the `wall`/`woodwall` props (via `solidGrid`). `blocksSight`
  and `blocksView` consult both — change one, check the other.
- Props are painted by `drawProp`; `LIGHT_PROPS` decides which ones feed
  `computeLight` (ranges in feet) and `SOLID_PROPS`/`propSolid` which ones
  fill `solidGrid` and so block sight. Adding a prop kind means a `case` in
  `drawProp` plus, if it glows or blocks, an entry in those tables.
- Terrain painters live in `drawGround`/`drawWater`/`drawLava`/… and use
  `rnd(r,c,k)` for per-tile detail plus `macro(r,c)` for smooth
  low-frequency variation — use both so floors don't look like static.
- Floors, zones, props and portraits are all painted in code: floors in
  `drawGround`, zones by type, props in `drawProp`, portraits from the
  `PIXEL_ART` palette grids. `BLOCKING_ZONES` (`pit`, `rock`, `chasm`,
  `lava`) is what the generators and the map maker treat as impassable.
- The ✎ Build tab (`renderBuilder`, `paintAt`, `writeLayers`) paints into a
  per-cell layer and writes it back as merged rectangles, so a painted map
  stays a small scene. One stroke is one undo.
- Quick maps are seeded generators in `QUICK_MAPS` (`qmBase` helpers,
  `qmMake` retries until `qmConnected` passes). Keep them deterministic for a
  seed; `test/builder.js` checks 25 seeds of each.
- The ✦ Claude panel: `runAgent` runs one turn on either engine (the key
  engine runs the tool loop itself; the page engine hands tools to the
  artifact's `sample` capability). The model only changes the board through
  `TOOL_APPLY` / `TOOL_SUGGEST` / `TOOL_BUILD`, which go through `checkCmds`
  and `applyTransaction` (all-or-nothing, rolled back on error). Never send
  `temperature`/`top_p`/`top_k` (the 2026-10-21 API refuses them) and never
  force `tool_choice`.
- The API key lives only under `vtt-anthropic-key` in sessionStorage or
  localStorage (`getKey`/`setKey`/`forgetKey`). Never copy it into `S`,
  `SET`, `CL`, a log line or the DOM; `test/claude.js` fails if it shows up
  anywhere else.
- Every Claude tool input goes through `prepToolInput` (a small JSON Schema
  check, `schemaErrors`, with gentle coercion of a JSON string or a single
  object) before `run`; a refusal must be an `Error` with a message the model
  can act on. `test/tools.js` fuzzes 1200 malformed calls and fails if one
  changes the board.
- Combat bookkeeping lives between `VALUED` and `showSummary`: `addCond` /
  `removeCond` (values in `tk.cval`, durations in `tk.cdur`), `turnHooks`
  (end and start of turn), `deathRules`/`recoveryCheck`, `tallyHit` (credit
  through `HP_CTX`), `checkVictory`. `hpDelta` is the one place HP changes,
  so damage from anywhere reaches dying, the tally and victory.
- Moods (`MOODS`) are composite layers drawn after darkness and before glow;
  carried light (`CARRY`, `tk.light`) is just another source in
  `computeLight`, so a moving token must refresh fog.
- Area templates (`AREA`, `cellInMarker`, `caughtBy`) use the same shapes
  `drawMarker` draws; the live preview is the marker id `_area`, which
  `save` and `sceneToJSON` leave out. Batch saves go through `applyBatch`
  so one undo takes back the whole area.
