# Claude VTT — a battle map your Claude gamemaster can drive

A single-file virtual tabletop (`index.html`, no dependencies, no build)
designed for play sessions where **Claude is the gamemaster**. The GM never
edits the file: the whole board renders from one state object, and Claude
changes it by emitting small JSON commands — moves animate, damage floats
off tokens, narration banners across the top.

## What's on the board

- **Canvas-rendered terrain** — seven floors (flagstone, wood, shingle,
  grass, sand, dirt, snow) with low-frequency variation so ground reads as
  patches rather than per-tile static, plus eight hazard zones: water
  (depth-shaded, foams against the shore), rough, swamp, lava, ice, fog
  (translucent veil), darkness, and walls. Lamplight pools, glowing
  hearths, and **56 drawn prop tiles** — pillars, statues, altars,
  sarcophagi, braziers, forges, bookshelves, thrones, cages, webs,
  summoning circles, trapdoors, spikes, wells, fountains, stalagmites,
  crystals, market stalls, lampposts, fences, tents, campfires, logs and
  more. Braziers and lampposts light the room; pillars and bookshelves
  cast shadows. Grids up to 26×26, 5-ft squares.
- **274 token icons + 26 condition badges** (game-icons.net, CC BY 3.0):
  heroes, townsfolk, undead, fey, giants, dragons, aberrations, beasts,
  sea life, dinosaurs, dungeon dressing — with per-kind styling
  (pc / ally / foe / mark), Large & Huge sizes, HP bars, wound and down
  states, auras, and up to 3 condition badges per token.
- **Worlds** — many rooms joined by doors, stairs, ladders, gates, portals
  and map edges, so a dungeon can be bigger than one grid, span floors, or
  be a settlement the party keeps returning to. Each room keeps its own
  tokens, initiative and fog memory; the party travels between them
  carrying HP and conditions. Every way out is drawn on the square it
  occupies — steps, rungs, a swinging door — captioned with its destination
  and an ▲/▼ from the floor difference, and lit when someone stands on it.
  Rooms can be added one at a time, so a mega-dungeon grows as the party
  explores it, and a 🗺 overview groups every room by floor.
- **Fog of war with real line of sight** — shadowcasting from each party
  member, walls that block sight and light, bright/dim/dark light levels
  from ambient plus every torch and hearth, darkvision (and magical
  darkness that defeats it), and explored-ground memory. Enemies render
  only while the party can see them.
- **Play aids** — drag-to-measure in feet with per-hazard warnings, a
  persistent ring on whoever's turn it is, initiative chips showing live HP,
  round counter, spell/AoE markers (circle · cone · line · square), token
  auras, GM pings, a d4–d100 dice tray, pinch-zoom and pan.
- **A tap-to-inspect panel** — select any token to edit HP and toggle
  conditions at the table without asking the GM.
- **Phone-first layout** — the whole board fits the screen at rest (no
  clipping at any size), the initiative rail scrolls horizontally, touch
  targets are sized for thumbs, and it scales up cleanly to desktop.
- **Persistence** — the session survives reloads (localStorage, or
  `window.storage` when hosted as a claude.ai artifact); ↺ reset restores
  the encounter's starting state; ↩ undo reverts the last GM batch.

## How Claude drives it

Three transports, all speaking the same JSON protocol
([GM_PROTOCOL.md](GM_PROTOCOL.md)):

| Transport | How | When |
|---|---|---|
| **⚙ GM console** | Claude writes a ```json block in chat; a player pastes it and taps apply | Any chat, any hosting — the default |
| **Scene links** | Claude emits a `#s=<base64>` link that boots a whole encounter | Starting a fight, sharing a setup |
| **HTTP feed** | Board polls `feed.json` every 2 s and applies batches by `seq` | Served over HTTP with Claude Code editing `feed.json` — fully live, zero pasting |

And the loop closes in the other direction: **⧉ copy state for GM** puts a
compact JSON summary (positions, HP, conditions, turn, round) on the
clipboard to paste back to Claude, so the GM always knows the real board —
including everything players did by hand.

## Running a session

1. **Give Claude the protocol.** Paste `GM_PROTOCOL.md` (and optionally
   `TOKENS_index.md`) into your session, or run the session from this repo
   with Claude Code — `CLAUDE.md` briefs the GM automatically.
2. **Open the board.** Any of:
   - open `index.html` in a browser (double-click works),
   - serve it — `npx http-server` or `python3 -m http.server` — for
     feed-driven live play,
   - or have Claude publish it as a claude.ai artifact.
3. **Play.** Claude opens with a `scene`, then sends a batch per turn:
   narration (`say`), moves, damage, conditions, `next`. You drag your own
   token, tap it to edit HP or conditions, and send **⧉ copy state** back
   whenever the GM should see the board.

Everything is also scriptable from the page itself:
`window.VTT.apply(commands)`, `window.VTT.state()`, `window.VTT.stateForGM()`.

## Repo layout

| File | Purpose |
|---|---|
| `index.html` | The whole product — engine, styles, icon sprite |
| `GM_PROTOCOL.md` | The JSON command language a Claude GM speaks |
| `TOKENS_index.md` | Icon & condition id reference |
| `test/smoke.js` | Playwright regression suite (31 checks) — `node test/smoke.js` |
| `test/fow.js` | Fog of war / line of sight / light suite (24 checks) |
| `test/world.js` | Room-to-room continuity suite (30 checks) |
| `test/mega.js` | Mega-dungeon scale + portal art suite (13 checks) |
| `test/tiles.js` | Prop tiles, light emission, shadow casting, glow ceiling (13 checks) |
| `CLAUDE.md` | Briefing for Claude sessions run from this repo |

## Credits

Token art from [game-icons.net](https://game-icons.net) (Lorc, Delapouite &
contributors), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/),
embedded as an inline SVG sprite. Keep the attribution comment in
`index.html` when redistributing.
