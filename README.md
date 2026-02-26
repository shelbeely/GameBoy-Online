JavaScript GameBoy Color Emulator
=================================

**Copyright (C) 2010 - 2026 Grant Galitz**

A GameBoy Color emulator that utilizes HTML5 canvas and the Web Audio API to provide a full emulation of the console.

**License:**

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

How JSON Works in This App
--------------------------

### 1. The `json2.js` polyfill (`js/other/json2.js`)

Older browsers that predate the native `JSON` global are supported via `js/other/json2.js`, a public-domain reference implementation from [json.org](http://www.json.org/js.html). It registers two methods on the global `JSON` object only when they are not already present:

- **`JSON.stringify(value, replacer, space)`** – converts any JavaScript value (object, array, number, boolean, string, or null) into a JSON-formatted string.
- **`JSON.parse(text, reviver)`** – parses a JSON string back into a live JavaScript value.

All modern browsers already provide these natively, so the polyfill is effectively inert on current versions of Firefox, Chrome, Safari, and Edge.

### 2. Persistent storage (`js/other/gui.js`)

All emulator data that must survive a page reload is persisted through `window.localStorage`. Two thin wrappers handle the encoding:

| Function | Direction | JSON call |
|---|---|---|
| `setValue(key, value)` | JavaScript → `localStorage` | `JSON.stringify(value)` |
| `findValue(key)` | `localStorage` → JavaScript | `JSON.parse(rawString)` |

Every read from or write to `localStorage` therefore passes through JSON, which means any structured JavaScript value (arrays, objects, numbers, booleans) round-trips cleanly.

### 3. What is stored as JSON vs. Base64

| `localStorage` key prefix | Contents | Encoding |
|---|---|---|
| `FREEZE_<name>_<n>` | Complete emulator freeze state (CPU registers, all RAM banks, VRAM, I/O, timing counters) serialized by `gameboy.saveState()` | JSON array via `JSON.stringify` |
| `RTC_<name>` | Real-time clock counters for MBC3 cartridges, serialized by `gameboy.saveRTCState()` | JSON array via `JSON.stringify` |
| `B64_SRAM_<name>` | Battery-backed cartridge RAM (binary data) | Base64 string — **not** JSON |
| `SRAM_<name>` | Legacy battery-backed RAM format | Plain numeric array via `JSON.stringify` (deprecated) |

SRAM is stored as Base64 rather than JSON because it is raw binary data; representing each byte as a JSON number would bloat the payload significantly.

### 4. Export and import blobs (`js/GameBoyIO.js`, `js/other/gui.js`)

When a player downloads their saves through the **Save Manager**:

1. `getBlobPreEncoded(keyName)` calls `JSON.stringify(findValue(keyName))` to turn the live JavaScript value back into a JSON string.
2. That string is embedded into the binary `EMULATOR_DATA` blob format by `generateMultiBlob` / `generateBlob`.

When a player imports a previously exported file:

1. `import_save(blobData)` calls `decodeBlob` to extract each blob's raw content string.
2. For non-SRAM blobs, `JSON.parse(blobData.blobs[index].blobContent)` reconstructs the original JavaScript value.
3. `setValue(key, parsedValue)` writes it back to `localStorage` (which immediately re-serializes it through `JSON.stringify`).

---

Giving an AI Agent Access to the GameBoy via JSON
--------------------------------------------------

Because every piece of emulator state is a plain JavaScript value and all inputs are simple function calls, it is straightforward to build a JSON-based interface that lets an AI agent observe and control the emulator.

### Reading game state

```js
// Capture a full snapshot of the running emulator.
var state = gameboy.saveState();          // returns a JavaScript array
var stateJson = JSON.stringify(state);    // portable JSON string

// The array contains CPU registers, all memory banks, timing counters, etc.
// An agent can inspect individual fields before serializing if needed, e.g.:
// state[2]  → registerA
// state[13] → programCounter
```

Restore the snapshot at any time (even in a fresh `GameBoyCore` instance):

```js
var canvas = document.getElementById("mainCanvas");
gameboy = new GameBoyCore(canvas, "");
gameboy.returnFromState(JSON.parse(stateJson));
run();
```

### Sending button inputs

The eight GameBoy buttons map to integer key codes:

| Code | Button |
|---|---|
| 0 | Right |
| 1 | Left |
| 2 | Up |
| 3 | Down |
| 4 | A |
| 5 | B |
| 6 | Select |
| 7 | Start |

An agent can encode an action as JSON and dispatch it:

```js
// Example JSON action an agent might produce:
var action = { "button": 4, "down": true };   // press A

// Dispatch it:
GameBoyJoyPadEvent(action.button, action.down);

// Release after the desired number of frames:
GameBoyJoyPadEvent(action.button, false);
```

### Capturing screen output

The emulator renders to an HTML5 `<canvas>` element. An agent can capture a screenshot as a Base64-encoded PNG:

```js
var screenshotDataUrl = gameboy.canvas.toDataURL("image/png");
// Send screenshotDataUrl to the agent; it encodes the 160×144 pixel frame.
```

Raw pixel data (RGBA, 160×144) is also available without Base64 overhead:

```js
var ctx = gameboy.canvas.getContext("2d");
var imageData = ctx.getImageData(0, 0, 160, 144);
// imageData.data is a Uint8ClampedArray of [R, G, B, A, R, G, B, A, ...]
```

### Sample JSON agent protocol

A minimal request/response protocol an agent and a host page could share:

Agent → host: press a button for a given number of frames
```json
{ "action": "press", "button": 4, "frames": 2 }
```

Agent → host: release a button
```json
{ "action": "release", "button": 4 }
```

Agent → host: request a screenshot
```json
{ "action": "screenshot" }
```

Host → agent: screenshot response
```json
{ "type": "screenshot", "dataUrl": "data:image/png;base64,..." }
```

Agent → host: save the current emulator state
```json
{ "action": "save_state" }
```

Host → agent: state snapshot response
```json
{ "type": "state", "state": "[...]" }
```

Agent → host: restore a previously saved state
```json
{ "action": "load_state", "state": "[...]" }
```

The host page listens for these messages (e.g. via `window.addEventListener("message", ...)` or a WebSocket), parses them with `JSON.parse`, calls the appropriate emulator functions (`GameBoyJoyPadEvent`, `gameboy.saveState`, `gameboy.returnFromState`, `gameboy.canvas.toDataURL`), and posts JSON responses back to the agent.

---

---

Pokémon Silver Idle / Autoplay Mode
------------------------------------

This section documents how to have GameBoy Online auto-boot Pokémon Silver and
play itself autonomously in the background — similar to "Claude plays Pokémon"
or any other "X plays Pokémon" project.  The game keeps advancing even while
you are focused on another window, acting as a living progress bar you can
glance at between coding sessions.

### Overview

The implementation has three layers:

| Layer | What it does | Where it lives |
|---|---|---|
| **Autoboot** | Fetches the ROM via XHR on page load and calls `start()` | `js/agent.js` → `PokemonAgent.boot()` |
| **Background running** | Bypasses the `document.hidden` check so the emulator ticks in hidden tabs | `js/GameBoyIO.js` → `agentMode` flag |
| **Agent loop** | `setInterval` tick that reads game memory, detects battles, and presses buttons | `js/agent.js` → `PokemonAgent.start()` |

### Setup

1. **Obtain a legal copy** of the Pokémon Silver (U) ROM and place it somewhere
   served by the same web server as the page (CORS applies).

2. **Set the ROM path** in `js/agent.js`:
   ```js
   var ROM_URL = "roms/pokemon_silver.gbc";  // relative to index.html
   ```

3. **`js/agent.js` is already included** in `index.html`.  No further HTML
   changes are needed.

4. Open the page in a browser, then in the browser console run:
   ```js
   PokemonAgent.boot();   // fetch ROM and start emulator
   PokemonAgent.start();  // begin automation loop
   ```

5. Switch to your code editor.  The game will continue playing in the background
   and auto-save SRAM to `localStorage` every 60 seconds.

To auto-start on every page load without typing in the console, add this to the
`window.onload` block already in `index.html`:

```js
window.onload = function () {
    windowingInitialize();
    PokemonAgent.boot();   // load Pokémon Silver
    PokemonAgent.start();  // begin idle automation
};
```

### Background-tab running (`agentMode`)

By default the emulator pauses when the browser tab is hidden
(`document.hidden`).  The agent overrides this by setting `agentMode = true`,
which is declared in `GameBoyIO.js` and checked in the run loop:

```js
gbRunInterval = setInterval(function () {
    if (!document.hidden || agentMode) {
        gameboy.run();
    }
}, settings[6]);
```

Calling `PokemonAgent.stop()` resets `agentMode = false`, restoring normal
foreground-only behaviour.

### Battle automation

Pokémon Silver battles present a four-option root menu: **FIGHT / ITEM / PKMN / RUN**.
The game always starts with FIGHT highlighted, and within FIGHT the first move
is highlighted.  The default agent strategy therefore reduces to:

```
detect wIsInBattle ≠ 0  →  tap A  (choose FIGHT)
next tick              →  tap A  (use Move 1)
subsequent ticks       →  tap A  (advance result text, level-up screens, etc.)
```

Outside of battle the agent also taps A to dismiss any text boxes or dialogs
that the game presents (Pokémon center prompts, NPC dialogue, etc.).

### Key Pokémon Silver WRAM addresses

These addresses are read directly from `gameboy.memory[addr]` (the emulator's
flat 64 KB memory array).  Source:
[pret/pokegold disassembly](https://github.com/pret/pokegold) — verify against
your specific ROM version.

| Address | Symbol | Description |
|---|---|---|
| `0xD22D` | `wIsInBattle` | 0 = not in battle, 1 = wild battle, 2 = trainer battle |
| `0xCC5B` | `wBattleMenuCursor` | Root battle-menu cursor (0=FIGHT 1=ITEM 2=PKMN 3=RUN) |
| `0xCC2B` | `wCurMoveNum` | Highlighted move in FIGHT submenu (0–3) |
| `0xD015`–`0xD016` | `wPlayerMonHP` | Active player Pokémon HP during battle (big-endian) |
| `0xD023`–`0xD024` | `wPlayerMonMaxHP` | Active player Pokémon max HP during battle (big-endian) |
| `0xCFE6`–`0xCFE7` | `wEnemyMonHP` | Enemy Pokémon HP during battle (big-endian) |
| `0xDCE0`–`0xDCE1` | `wPartyMon1HP` | Party slot 1 current HP (big-endian) |
| `0xDCF9`–`0xDCFA` | `wPartyMon1MaxHP` | Party slot 1 max HP (big-endian) |
| `0xCC8A` | `wJoypadBlock` | Non-zero (1 byte) while the game is blocking joypad input |

Read any address from the browser console at any time:

```js
PokemonAgent.readByte(0xD22D);   // check battle status
PokemonAgent.readWord(0xD015);   // player HP
PokemonAgent.readWord(0xCFE6);   // enemy HP
```

### Button codes

```js
PokemonAgent.BTN.A       // 4  — confirm / choose highlighted option
PokemonAgent.BTN.B       // 5  — cancel / back
PokemonAgent.BTN.START   // 7  — open menu
PokemonAgent.BTN.RIGHT   // 0
PokemonAgent.BTN.LEFT    // 1
PokemonAgent.BTN.UP      // 2
PokemonAgent.BTN.DOWN    // 3
```

Send a button press at any time from the console:

```js
PokemonAgent.tap(PokemonAgent.BTN.START);   // open in-game menu
PokemonAgent.press(PokemonAgent.BTN.A, 200); // hold A for 200 ms
```

### Extending the agent — smarter battles

The `_handleBattle()` function inside `js/agent.js` is the single place to add
more sophisticated battle logic.  Replace the default `_tap(BTN.A)` with
decision logic such as:

```js
function _handleBattle() {
    var hpFrac = playerHPFraction();

    if (hpFrac < 0.2) {
        // HP is critical — navigate to ITEM then use a Potion.
        // 1. Cursor is on FIGHT (0); press Down to reach ITEM (1).
        _tap(BTN.DOWN);
        // 2. On the next tick, A opens the bag.  Further taps navigate to Potion.
        return;
    }

    // Default: choose FIGHT and use the first move.
    _tap(BTN.A);
}
```

Other ideas for future automation:

- **Encounter rate control** — walk in circles on a patch of grass to trigger
  wild encounters, or avoid high-grass tiles to reduce them.
- **Move-PP awareness** — read the PP bytes for each move
  (offset into the party data starting at `0xDCDF`) and switch moves when
  the primary move runs out.
- **Pokémon switching** — detect fainting (`wPlayerMonHP` == 0) and send the
  correct menu inputs to switch to the next healthy party member.
- **Poké Ball throwing** — when in a wild battle and the enemy HP is low,
  navigate to ITEM and use a Poké Ball.
- **Healing at the Pokémon Center** — detect party HP levels and walk to a
  fixed-save-state position near a Pokémon Center to heal.

### Auto-save and persistence

The agent calls `saveSRAM()` (from `GameBoyIO.js`) every 60 seconds.  This
writes the in-game save data to `localStorage` under the key
`B64_SRAM_<game name>`.  Progress is therefore preserved across page reloads
automatically.

To change the auto-save interval, edit `AUTO_SAVE_INTERVAL_S` in `js/agent.js`.
Set it to `0` to disable auto-saving.

### PokemonAgent public API reference

| Call | Description |
|---|---|
| `PokemonAgent.boot(url)` | Fetch the ROM from `url` (or `ROM_URL`) and start the emulator |
| `PokemonAgent.start()` | Begin the automation tick loop; enables background running |
| `PokemonAgent.stop()` | Pause automation; restores foreground-only running |
| `PokemonAgent.running` | `true` while the tick loop is active |
| `PokemonAgent.inBattle()` | `true` when `wIsInBattle ≠ 0` |
| `PokemonAgent.playerHPFraction()` | Active mon HP as a fraction (0–1) |
| `PokemonAgent.readByte(addr)` | Read one byte from `gameboy.memory[addr]` |
| `PokemonAgent.readWord(addr)` | Read a big-endian 16-bit word |
| `PokemonAgent.tap(btn)` | Tap a button (80 ms press) |
| `PokemonAgent.press(btn, ms)` | Hold a button for `ms` milliseconds |
| `PokemonAgent.ADDR` | Object containing all documented WRAM address constants |
| `PokemonAgent.BTN` | Object containing all button code constants |

---

Known browsers to work well in:
-------------------------------

* Firefox (current)
* Google Chrome (current)
* Safari (current)
* Microsoft Edge (current)

Browsers that are not supported:
---------------------------------

* Internet Explorer (any version)
* Any browser without Web Audio API support

CPU instruction set accuracy test results (Blargg's cpu_instrs.gb test ROM):
-----------------------------------------------------

* **GameBoy Online:**

	Passes
* **Visual Boy Advance 1.7.2:**

	Fails
* **KiGB:**

	Fails
* **Gambatte:**

	Passes
