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
- Verify changes in headless Chromium (Playwright is preinstalled in Claude
  Code web sessions): load the page over local HTTP, drive
  `window.VTT.apply([...])`, assert on `window.VTT.stateForGM()`, and check
  for zero page errors. Keep `node --check` passing on the extracted
  `<script>` body.
