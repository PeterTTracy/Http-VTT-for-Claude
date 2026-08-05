# Claude VTT — a battle map your Claude gamemaster can drive

A single-file virtual tabletop (`index.html`, no dependencies, no build)
designed for play sessions where **Claude is the gamemaster**. The GM never
edits the file: the whole board renders from one state object, and Claude
changes it by emitting small JSON commands — moves animate, damage floats
off tokens, narration banners across the top.

## What's on the board

- **Canvas-rendered terrain** — wood / shingle / stone / grass / sand
  floors, animated water, difficult-terrain hatching, walls, darkness,
  lamplight pools, glowing hearths, and 13 drawn prop kinds (trees, boats,
  tables, barrels…). Grids up to 26×26, 5-ft squares.
- **~200 embedded token icons** (game-icons.net, CC BY 3.0) with
  per-kind styling (pc / ally / foe / mark), Large & Huge sizes, HP bars,
  wound states, and up to 3 condition badges per token.
- **Play aids** — drag-to-measure in feet with difficult-terrain warnings,
  initiative chips that show live HP for linked tokens, round counter,
  spell/AoE markers (circle · cone · line · square), pinch-zoom and pan.
- **A tap-to-inspect panel** — select any token to edit HP and toggle
  conditions at the table without asking the GM.
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
| `CLAUDE.md` | Briefing for Claude sessions run from this repo |

## Credits

Token art from [game-icons.net](https://game-icons.net) (Lorc, Delapouite &
contributors), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/),
embedded as an inline SVG sprite. Keep the attribution comment in
`index.html` when redistributing.
