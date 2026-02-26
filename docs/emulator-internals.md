# Emulator Internals — Connecting an AI Agent

This document describes the internal plumbing that makes it possible for any
external program or AI agent to observe and control GameBoy Online.

---

## The memory model

The GameBoy Color has a 16-bit address bus.  `GameBoyCore` represents the
entire address space as the JavaScript array `gameboy.memory` (64 KB, indices
`0x0000`–`0xFFFF`).  Reading or writing any address from JavaScript is a direct
array access:

```js
// Read a byte
var b = gameboy.memory[0xD22D] & 0xFF;

// Write a byte (use with care — bypasses all hardware side-effects)
gameboy.memory[0xFF40] = 0x91;
```

Reading is safe at any time.  Writing should be reserved for debugging or
specific automation cases where you understand the hardware implications.

---

## State snapshots

### Saving state

```js
// Returns a JavaScript array — the complete machine state.
var state = gameboy.saveState();

// Serialize to a portable JSON string:
var stateJson = JSON.stringify(state);
```

The array fields include (non-exhaustive):

| Index | Field |
|---|---|
| `2` | `registerA` |
| `13` | `programCounter` |
| `14` | `stackPointer` |
| … | All CPU registers, flags, timing counters, RAM, VRAM, OAM, I/O |

### Restoring state

```js
var canvas = document.getElementById("mainCanvas");
gameboy = new GameBoyCore(canvas, "");
gameboy.returnFromState(JSON.parse(stateJson));
run();
```

### Persisted freeze states

The existing UI's *Save State* function stores snapshots in `localStorage`:

```js
// js/GameBoyIO.js
save();   // writes to "FREEZE_<cartName>_<n>"
```

Load one back:

```js
openState("FREEZE_POKEMON_SLVAAXE_0", document.getElementById("mainCanvas"));
```

---

## Button input

`GameBoyJoyPadEvent(keycode, down)` is the sole entry point for joypad input:

| `keycode` | Button |
|---|---|
| `0` | Right |
| `1` | Left |
| `2` | Up |
| `3` | Down |
| `4` | A |
| `5` | B |
| `6` | Select |
| `7` | Start |

```js
// Press A
GameBoyJoyPadEvent(4, true);

// Release A after 80 ms
setTimeout(function () { GameBoyJoyPadEvent(4, false); }, 80);
```

---

## Screen capture

The emulator renders to an HTML5 `<canvas>` element.  Capture a screenshot as
Base64-encoded PNG:

```js
var dataUrl = gameboy.canvas.toDataURL("image/png");
// dataUrl = "data:image/png;base64,iVBOR..."
```

Raw RGBA pixel data (160 × 144 pixels):

```js
var ctx  = gameboy.canvas.getContext("2d");
var data = ctx.getImageData(0, 0, 160, 144);
// data.data is a Uint8ClampedArray of [R,G,B,A, R,G,B,A, ...]
```

---

## Persistent storage — JSON and Base64

All emulator data that must survive a page reload is kept in `localStorage`
through two thin wrapper functions in `js/other/gui.js`:

```js
setValue(key, value);     // JSON.stringify(value) → localStorage
findValue(key);           // localStorage → JSON.parse(rawString)
```

### What is stored where

| `localStorage` key | Format | Contents |
|---|---|---|
| `FREEZE_<name>_<n>` | JSON array | Full CPU + RAM snapshot from `gameboy.saveState()` |
| `RTC_<name>` | JSON array | Real-time clock counters (MBC3 cartridges) |
| `B64_SRAM_<name>` | Base64 string | Battery-backed cartridge RAM (binary) |
| `SRAM_<name>` | JSON array (deprecated) | Legacy SRAM format |

SRAM is stored as Base64 (not JSON) because raw binary data represented as a
JSON number array bloats the payload; Base64 is more compact and round-trips
without precision loss.

---

## Export / import blob format

The **Save Manager** exports data as a binary `EMULATOR_DATA` blob.

### Blob wire format

```
Offset  Size   Field
------  -----  -----
0       13     Magic string "EMULATOR_DATA"
13       4     Total size in bytes (little-endian uint32)
17       1     Console ID length N
18       N     Console ID text ("GameBoy")
--- repeated for each blob ---
        1      Blob ID length M
        M      Blob ID text (e.g. "FREEZE_POKEMON_SLVAAXE_0")
        4      Blob data length L (little-endian uint32)
        L      Blob data (JSON string or Base64 string)
```

### Import flow

1. `import_save(blobData)` → `decodeBlob(blobData)` parses the binary format.
2. For non-SRAM blobs: `JSON.parse(blobContent)` → `setValue(key, value)`.
3. For SRAM blobs: `base64(blobContent)` → `setValue("B64_" + key, encoded)`.

### Export flow

1. `getBlobPreEncoded(keyName)` calls `JSON.stringify(findValue(keyName))`.
2. `generateMultiBlob` / `generateBlob` embed the string into the binary format.

---

## Building an external AI agent

An AI agent running outside the browser can control the emulator through any
message-passing channel.  The pattern used by `PokemonAgent` (same-page
JavaScript) can be extended to a WebSocket, `postMessage`, or any other IPC
mechanism.

### Recommended JSON protocol

#### Agent → host

```json
// Press a button for a number of frames
{ "action": "press", "button": 4, "frames": 2 }

// Release a button
{ "action": "release", "button": 4 }

// Request a screenshot
{ "action": "screenshot" }

// Save the current emulator state
{ "action": "save_state" }

// Restore a previously saved state
{ "action": "load_state", "state": "[...]" }

// Read a memory address
{ "action": "read_byte", "addr": 56365 }
```

#### Host → agent

```json
// Screenshot response
{ "type": "screenshot", "dataUrl": "data:image/png;base64,..." }

// State snapshot response
{ "type": "state", "state": "[...]" }

// Memory read response
{ "type": "byte", "addr": 56365, "value": 1 }
```

### Minimal WebSocket host (browser side)

```js
var ws = new WebSocket("ws://localhost:9000");

ws.onmessage = function (evt) {
    var msg = JSON.parse(evt.data);

    if (msg.action === "press") {
        GameBoyJoyPadEvent(msg.button, true);
        var frames = msg.frames || 2;
        setTimeout(function () {
            GameBoyJoyPadEvent(msg.button, false);
        }, frames * 16);   // ~16 ms per frame at 60 fps

    } else if (msg.action === "release") {
        GameBoyJoyPadEvent(msg.button, false);

    } else if (msg.action === "screenshot") {
        ws.send(JSON.stringify({
            type: "screenshot",
            dataUrl: gameboy.canvas.toDataURL("image/png")
        }));

    } else if (msg.action === "save_state") {
        ws.send(JSON.stringify({
            type: "state",
            state: JSON.stringify(gameboy.saveState())
        }));

    } else if (msg.action === "load_state") {
        var canvas = document.getElementById("mainCanvas");
        gameboy = new GameBoyCore(canvas, "");
        gameboy.returnFromState(JSON.parse(msg.state));
        run();

    } else if (msg.action === "read_byte") {
        ws.send(JSON.stringify({
            type: "byte",
            addr: msg.addr,
            value: gameboy.memory[msg.addr] & 0xFF
        }));
    }
};
```

A Python (or any language) agent on the other side connects to port 9000,
sends JSON commands, and receives JSON responses.  The screenshot `dataUrl` can
be decoded and passed to a vision-capable model such as GPT-4o or Claude 3 to
let the model "see" the game and produce button actions.

---

## `agentMode` — background emulation flag

`agentMode` is a module-level boolean in `js/GameBoyIO.js`:

```js
var agentMode = false;
```

When `true`, the emulator run-loop timer ignores `document.hidden`:

```js
gbRunInterval = setInterval(function () {
    if (!document.hidden || agentMode) {
        gameboy.run();
    }
}, settings[6]);
```

This is the only change required in the core emulator to support background
idle play.  `PokemonAgent.start()` sets it to `true`; `PokemonAgent.stop()`
resets it to `false`.

---

## `GameBoyCore` public methods used by the agent

| Method | Description |
|---|---|
| `gameboy.saveState()` | Returns a JavaScript array of the complete machine state |
| `gameboy.returnFromState(arr)` | Restores state from a previously saved array |
| `gameboy.saveSRAMState()` | Returns battery-backed RAM as a `Uint8Array` |
| `gameboy.saveRTCState()` | Returns RTC counters as an array |
| `gameboy.JoyPadEvent(keycode, down)` | Low-level joypad press / release |
| `gameboy.run()` | Execute one emulation iteration |
| `gameboy.canvas` | The `<canvas>` DOM element used for rendering |
| `gameboy.memory` | The 64 KB flat memory array |
