# GM Protocol — how a Claude gamemaster drives the board

The board (`index.html`) renders entirely from one state object and accepts
**JSON commands**. As GM, you never edit the HTML: you emit JSON, and it
reaches the board one of three ways.

## Transports

1. **Paste (works everywhere).** Emit one fenced ```json block per update.
   The player taps **⚙ GM** on the board, pastes it, hits **▶ apply**.
   Code fences are stripped automatically.
2. **Scene link.** Encode `{"scene": {...}}` as base64url and append it to
   the board URL as `#s=<encoded>`. Opening the link boots that encounter.
3. **HTTP feed (fully live, no pasting).** If the board is served over HTTP
   with a `feed.json` next to it, it polls every 2 s and applies any update
   whose `seq` is higher than the last one seen:

   ```json
   {"seq": 1, "batch": [{"do":"move","t":"K","to":"D7"}]}
   ```

   Increment `seq` on every write; keep only the newest batch in the file.
   A Claude Code session editing `feed.json` in the served directory drives
   the board in real time. (`?feed=other.json` points the board elsewhere.)

**Closing the loop:** after players drag tokens or edit HP themselves, ask
them to tap **⧉ copy state for GM** and paste the result back to you. That
JSON is the ground truth of the board — trust it over your memory.

## Grid references

Cells are `"D7"`: row letter (A = top) + column number (1 = left).
One square = 5 ft. Grids up to 26×26; default 16×16.

## Commands

Send a single command object or an array (a batch). Each command has a
`do` field. `t` selects a token by `id`, exact name, or unique name prefix.
Failed commands are logged on the board and skipped; the rest of the batch
still applies.

| Command | Shape | Notes |
|---|---|---|
| scene | `{"do":"scene","scene":{…}}` | Replace the whole encounter (schema below) |
| title | `{"do":"title","header":"…","sub":"…"}` | Either field optional |
| say | `{"do":"say","text":"…","tone":"danger"}` | Banner narration; tone: `info`/`danger`/`success` |
| move | `{"do":"move","t":"K","to":"D7"}` | Animated; `"instant":true` to teleport |
| damage | `{"do":"damage","t":"sa","n":7}` | Floating −7; auto hurt/down at ½ and 0 HP |
| heal | `{"do":"heal","t":"K","n":5}` | |
| hp | `{"do":"hp","t":"K","set":12}` | Also `"max":30` and `"delta":-3` |
| status | `{"do":"status","t":"sa","st":"down"}` | `fresh`/`hurt`/`down`; sets HP to match |
| cond | `{"do":"cond","t":"K","add":["prone"],"remove":["frightened"]}` | `"remove":"all"` clears; max 3 shown |
| spawn | `{"do":"spawn","token":{…},"init":{"after":2}}` | Token schema below; `init` optionally inserts an initiative chip |
| remove | `{"do":"remove","t":"sa"}` | Also drops its initiative chip |
| hide | `{"do":"hide","t":"amb"}` | Token leaves the board but keeps its state — stage ambushes with `"hidden":true` and reveal on the round they strike |
| reveal | `{"do":"reveal","t":"amb","at":"F9"}` | `at` optional (reveals in place); pulses on arrival |
| aura | `{"do":"aura","t":"K","ft":10,"color":"blue"}` | Radius that follows the token (auras, torchlight, dragon breath range); `ft:0` clears |
| ping | `{"do":"ping","at":"F9"}` | Expanding ring — "look here" |
| roll | `{"do":"roll","dice":"2d6+3","label":"club"}` | Rolls on the board and logs it; players also have a d4–d100 tray |
| marker | `{"do":"marker","marker":{"shape":"circle","at":"F6","ft":10,"color":"purple","label":"web"}}` | Shapes: `circle` (radius ft), `cone` (length ft + `dir`), `line` (length ft + `dir` + width `w`), `square` (side ft, from top-left). `dir`: `N/NE/E/…` or degrees. Colors: red orange yellow green blue purple white. Same `id` replaces. |
| unmark | `{"do":"unmark","id":"web"}` | Matches id or label; `{"do":"unmark"}` clears all |
| zone | `{"do":"zone","from":"A1","to":"D16","type":"water"}` | Types: `water` (depth-shaded, foams at the shore) · `rough` · `swamp` · `lava` · `ice` · `fog` (translucent veil, blocks sight) · `dark` (magical darkness) · `wall` (blocks movement, sight and light; `pit` is the same thing) |
| fow | `{"do":"fow","on":true}` | Fog of war master switch. Also `"ambient":"dark"`, `"reveal":"all"` (show the whole map), `"reset":true` (forget explored ground) |
| ambient | `{"do":"ambient","light":"dark"}` | Scene light level: `bright` (daylight) · `dim` (dusk) · `dark` (night, dungeon) |
| vision | `{"do":"vision","t":"D","darkvision":60}` | Per-token sight. Also `{"vision":{"normal":30,"blind":true}}` and `"eyes":true/false` to add or drop a token from the party's shared view |
| clearzones | `{"do":"clearzones","type":"dark"}` | `type` optional |
| light | `{"do":"light","at":"G13","bright":20,"dim":40}` | Light source: bright to `bright` ft, dim to `dim` ft, occluded by walls. (Legacy `"rad"` in cells still works.) Hearths and 🔥 props light themselves. |
| clearlights | `{"do":"clearlights"}` | |
| prop | `{"do":"prop","kind":"barrel","at":"C3"}` | Kinds: tree pine rock table bar chair hearth barrel crate wagon haystack boat door — or `{"glyph":"🔥"}` |
| unprop | `{"do":"unprop","at":"C3"}` | |
| ground | `{"do":"ground","ground":"grass"}` | `stone` (flagstones) · `wood` · `shingle` · `grass` · `sand` · `dirt` · `snow` |
| line | `{"do":"line","after":"E","label":"high tide"}` | Dashed rule below row E; omit `label` to remove |
| legend | `{"do":"legend","legend":[["~ water","#6fa9ad"]]}` | |
| init | `{"do":"init","order":[{"name":"Kira 19","t":"K"}]}` | Replace turn order; `t` links a chip to a token so it shows live HP |
| turn | `{"do":"turn","active":"Kira"}` | By initiative name or token |
| next | `{"do":"next"}` | Advance; wraps to next round |
| round | `{"do":"round","n":3}` | |

## Scene schema

```json
{
  "header": "Wrecker's Lighthouse", "sub": "storm · 1 square = 5 ft",
  "ground": "stone", "rows": 12, "cols": 12,
  "zones":  [{"from":"A1","to":"L2","type":"water"}],
  "line":   {"after":"E","label":"high tide"},
  "props":  [{"kind":"hearth","at":"F6"}, {"kind":"boat","at":"G3","w":2}],
  "lights": [{"at":"F6","rad":2.5}],
  "tokens": [
    {"id":"K","name":"Kira","label":"K","at":"J3","kind":"pc","icon":"swordwoman","hp":{"cur":18,"max":24}},
    {"id":"gh","name":"Ghost","at":"C9","kind":"foe","icon":"ghost","hp":20,"size":1,"conds":["hidden"]}
  ],
  "markers": [],
  "initiative": [{"name":"Kira 15","t":"K"}, {"name":"Ghost 11","t":"gh"}],
  "active": "Kira", "round": 1,
  "legend": [["~ water (difficult)","#6fa9ad"]]
}
```

Token fields: `kind` is `pc` | `ally` | `foe` | `mark`; `size` 1–3 squares
(Large 2, Huge 3 — `at` is the top-left square); `hp` a number (means
cur = max) or `{cur,max}`; `icon` any id from `TOKENS_index.md` (without the
`tk-` prefix); `conds` up to 3 condition ids (with or without the `c-`
prefix); `aura` `{ft,color}`; `hidden: true` to stage it off-board until
you `reveal` it; `vision` `{dark, normal, blind}` (or `darkvision: 60`) and
`eyes` to control whose eyes the board renders from.

## Fog of war, line of sight & light

Turn it on per scene with `"fow": true` (or `{"do":"fow","on":true}`) and set
the scene's `"ambient"` light. The board then shows the players only what
their party can actually see:

- **Line of sight** is computed by shadowcasting from every viewer — by
  default all `pc` and `ally` tokens. `wall` zones block sight and light;
  `fog` zones are heavy obscurement (you see the fog, not what's beyond).
- **Light** comes from `ambient` plus every light source, each occluded by
  walls. A cell is bright, dim, or dark. Hearth props light themselves.
- **Darkvision** (`{"do":"vision","t":"D","darkvision":60}`) lets a token
  see darkness as dim light out to that range. Magical darkness (`dark`
  zones) defeats it — that's the difference between a `dark` zone and an
  unlit room.
- **Memory**: ground the party has seen stays on the map, dimmed. Creatures
  in it do not — an enemy that walks out of sight disappears until seen
  again. Unexplored ground is black.
- Enemy tokens are only rendered when the party can see them, so with fog
  on you *can* place foes in advance; they stay invisible until the light
  or the party reaches them. `stateForGM` marks them `"unseen": true`.
- `{"do":"fow","reveal":"all"}` opens the whole map (end of a dungeon,
  or a divination); `{"do":"fow","reset":true}` forgets explored ground;
  `{"do":"fow","on":false}` turns the whole system off.

A dark-dungeon opening looks like:

```json
[{"do":"scene","scene":{
   "header":"Barrow of the Pale King","ground":"stone","rows":16,"cols":16,
   "ambient":"dark","fow":true,
   "zones":[{"from":"H6","to":"H12","type":"wall"}],
   "props":[{"kind":"hearth","at":"D9"}],
   "tokens":[
     {"id":"D","name":"Dain","at":"E12","kind":"pc","icon":"dwarf","hp":30,"vision":{"dark":60}},
     {"id":"B","name":"Bren","at":"F11","kind":"pc","icon":"wizard","hp":26},
     {"id":"g1","name":"Ghoul","at":"J8","kind":"foe","icon":"ghoul","hp":18}]}},
 {"do":"say","text":"Your torch gutters. Something shifts in the dark ahead.","tone":"danger"}]
```

## GM practices

- **Batch a whole turn** into one array — narration first (`say`), then
  moves, damage, conditions, then `next`. One paste per turn keeps play fast.
- **Stage secrets with `hidden`.** Put the ambushers in the scene with
  `"hidden": true` and `reveal` them when they strike — their HP and
  position are already tracked, so the reveal is one command. (Anything
  visible on the board is visible to the players, so don't rely on a token
  simply being unremarkable.)
- **Ask for state** whenever players have acted on the board (dragged
  tokens, edited HP in the inspector) before you narrate consequences.
- The board enforces nothing but grid bounds — rules, cover, and legality
  of moves stay your job. The measure readout and difficult-terrain flags
  are advisory.
- Every applied command is echoed in the board's log; a bad command is
  skipped and logged, never fatal. `↩ undo` reverts the last batch.
