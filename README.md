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
