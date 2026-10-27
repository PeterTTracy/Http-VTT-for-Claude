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

## New in this build

- **Painted art, all drawn in code.** Fifteen floors (flagstone, cobbles,
  crypt tiles, marble, planks, ruined floor, cave, dirt, mud, grass, ash
  waste, boneyard, sand, snow, shingle), fourteen terrain zones including
  solid rock, chasm, blight and consecrated ground, a Gravelands prop set
  (headstones, open graves, mausoleums, gibbets, pyres, sigils) and **22
  pixel-art portrait tokens** (skeleton, ghoul, wraith, death knight, lich,
  vampire, cultist, crusader, priest, rogue, wizard, ranger and more) with
  seven metal frames. No image files, no external art, nothing to license.
- **✎ Build tab.** Paint floors and terrain with a 1/2/3 brush, stamp
  props, drop portrait or icon tokens with HP/AC, erase, resize, set light,
  fog and weather. One undo takes back a whole stroke. Export the scene as
  JSON for Claude or a scene link.
- **Seven quick maps**, each a seeded generator rather than a fixed map:
  a boneyard, a sunken crypt (rooms carved from rock, fog of war, dark), a
  ruined chapel, a cellular-automata cave, a road ambush, a village square
  and a frozen mere. Every one is checked so everybody can reach everybody.
- **Weather** that sits over the board: rain, storm, snow, ash, embers,
  spores, mist. Atmosphere only, and it stops when the OS asks for reduced
  motion.
- **🎲 Dice tray and the mechanical layer.** PF2e or 5e. Degrees of success,
  fortune/misfortune, and board commands for `check`, `save` (basic saves
  halve or double damage), `attack` (crits by the system's rules) and
  `combat` (rolls initiative from each token's bonus). The board rolls; the
  narrator reads the result.
- **✦ Claude panel.** Three ways to play with Claude at the table:
  - **Rules assistant.** Ask about a rule or what someone can do this turn.
    It sees the board, rolls on the tray and proposes changes as a card you
    apply with one tap.
  - **Narrator takes over.** Describe what the players do. The Narrator
    resolves it through the board (moves, attacks, saves, damage, turns),
    plays the monsters until a player is up, and narrates what the dice
    decided. Every few turns the **Director** grades the session on seven
    dimensions and its notes steer the next stretch.
  - **Map maker.** Describe the fight; Claude builds the map from the same
    asset library, every square is checked (no one in a wall, everyone
    reachable, foes not on top of the party) and failures go back to it to
    fix. The Director reviews the result and asks for one rebuild if it
    scores under 7.

  Every board change Claude makes goes through validated, all-or-nothing
  tools: if anything in a batch is wrong, nothing happens and the error goes
  back to the model.

### Bring your own key

Paste an Anthropic API key in the ✦ Claude panel. By default it lives only
in this tab (sessionStorage) and is gone when the tab closes; tick
**remember on this device** to keep it in localStorage instead. **Forget
key** wipes both. It is sent only to `api.anthropic.com`, straight from your
browser, and never written into the saved session, the settings, the chat
log, the console or the page. A running cost meter shows what the session
has spent.

When the page runs as a Claude artifact, pick **this page** instead and it
uses the Claude account of whoever opens it, with no key at all. (An
artifact can't call the API directly, so use the downloaded `index.html` for
your own key.)

Models: Haiku 5.5 is the default for the assistant and the Narrator because
it is fast and cheap; the Director defaults to Sonnet 5.5. Both are
selectable.

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
| `test/tiles.js` | Prop tiles, light, shadows, glow ceiling, walls (25 checks) |
| `test/builder.js` | Build tab, seven quick-map generators × 25 seeds, weather (35 checks) |
| `test/claude.js` | Claude panel against a mocked API: key storage, request shape, tool loops, Director, map maker, page engine (54 checks) |
| `CLAUDE.md` | Briefing for Claude sessions run from this repo |

## Credits

Floors, terrain, props and the pixel-art portraits are drawn in code in
`index.html` for this project. Token icons from [game-icons.net](https://game-icons.net) (Lorc, Delapouite &
contributors), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/),
embedded as an inline SVG sprite. Keep the attribution comment in
`index.html` when redistributing.
