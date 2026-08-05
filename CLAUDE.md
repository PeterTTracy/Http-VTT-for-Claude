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
  `node test/world.js` and `node test/mega.js`
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
- Terrain painters live in `drawGround`/`drawWater`/`drawLava`/… and use
  `rnd(r,c,k)` for per-tile detail plus `macro(r,c)` for smooth
  low-frequency variation — use both so floors don't look like static.
