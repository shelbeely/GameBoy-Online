# `PokemonAgent` API Reference

`PokemonAgent` is a module-level object declared in `js/agent.js` and loaded
into the page by `index.html`.  All members are accessible from the browser
console or from any JavaScript file loaded after `agent.js`.

---

## Configuration constants

These are `var` declarations inside the IIFE.  Edit `js/agent.js` directly to
change their values; they are not writable from outside the module.

| Variable | Default | Description |
|---|---|---|
| `ROM_URL` | `""` | Path / URL of the Pokémon Silver ROM (relative to `index.html`). Passed to `boot()` when no argument is given. |
| `TICK_MS` | `450` | How often (in milliseconds) the decision tick fires. Lower = faster reactions; higher = less CPU use in background. |
| `AUTO_SAVE_INTERVAL_S` | `60` | How often (in seconds) SRAM is written to `localStorage`. Set to `0` to disable. |

---

## Boot and lifecycle

### `PokemonAgent.boot([romUrl])`

Fetches the ROM via XHR and starts the emulator.

- `romUrl` *(string, optional)* — Override for `ROM_URL`.  If omitted, `ROM_URL`
  is used.
- The ROM must be served from the **same origin** as the page (standard browser
  CORS rules).
- Internally calls `initPlayer()` (hides the title overlay) and then the
  existing `start(canvas, romData)` from `GameBoyIO.js`.
- Logs `[PokemonAgent] ROM booted.` on success or an error message on failure.

```js
PokemonAgent.boot("roms/pokemon_silver.gbc");
```

---

### `PokemonAgent.start()`

Begins the automation loop.

- Sets `agentMode = true` (keeps the emulator running in background tabs).
- Starts a `setInterval` tick at `TICK_MS` that calls the decision function on
  every cycle.
- Starts a second `setInterval` that calls `saveSRAM()` every
  `AUTO_SAVE_INTERVAL_S` seconds (skipped if `AUTO_SAVE_INTERVAL_S` is `0`).
- Calling `start()` when the agent is already running is a no-op.
- Logs `[PokemonAgent] Agent started (tick every NNN ms).`.

```js
PokemonAgent.start();
```

---

### `PokemonAgent.stop()`

Pauses the automation loop.

- Clears the tick and save-timer intervals.
- Resets `agentMode = false`, restoring normal browser tab-visibility throttling.
- The emulator keeps running; only the automation ticks stop.
- Logs `[PokemonAgent] Agent stopped.`.

```js
PokemonAgent.stop();
```

---

### `PokemonAgent.running` *(read-only getter)*

`true` while the tick loop is active.

```js
if (PokemonAgent.running) {
    console.log("Agent is active");
}
```

---

## Game state queries

### `PokemonAgent.inBattle()`

Returns `true` when `gameboy.memory[0xD22D]` (`wIsInBattle`) is non-zero.

```js
if (PokemonAgent.inBattle()) {
    console.log("A battle is in progress");
}
```

---

### `PokemonAgent.playerHPFraction()`

Returns the active battling Pokémon's current HP divided by its max HP, as a
number between `0` and `1`.  Returns `1` when the emulator is not initialised
or max HP is zero.

```js
var frac = PokemonAgent.playerHPFraction();
console.log("HP: " + Math.round(frac * 100) + "%");
```

---

## Memory access

### `PokemonAgent.readByte(addr)`

Reads a single unsigned byte (`0`–`255`) from `gameboy.memory[addr]`.  Returns
`0` if the emulator is not initialised.

```js
PokemonAgent.readByte(0xD22D);   // battle status flag
```

---

### `PokemonAgent.readWord(addr)`

Reads a big-endian 16-bit unsigned integer (two consecutive bytes) from
`gameboy.memory[addr]` and `gameboy.memory[addr + 1]`.  Returns `0` if the
emulator is not initialised.

```js
PokemonAgent.readWord(0xD015);   // active player mon current HP
PokemonAgent.readWord(0xCFE6);   // enemy mon current HP
```

---

## Input helpers

### `PokemonAgent.tap(btn)`

Presses `btn` for **80 ms** and then releases it.

```js
PokemonAgent.tap(PokemonAgent.BTN.A);       // confirm / advance text
PokemonAgent.tap(PokemonAgent.BTN.START);   // open menu
```

---

### `PokemonAgent.press(btn, ms)`

Holds `btn` down for `ms` milliseconds, then releases it.  Useful for
directional inputs that need to be held for movement.

```js
PokemonAgent.press(PokemonAgent.BTN.RIGHT, 300);  // walk right for 300 ms
```

---

## Constants

### `PokemonAgent.BTN`

Button code constants that match the `matchKey()` ordering in `GameBoyIO.js`.

| Key | Value | GameBoy button |
|---|---|---|
| `BTN.RIGHT` | `0` | D-pad Right |
| `BTN.LEFT` | `1` | D-pad Left |
| `BTN.UP` | `2` | D-pad Up |
| `BTN.DOWN` | `3` | D-pad Down |
| `BTN.A` | `4` | A button |
| `BTN.B` | `5` | B button |
| `BTN.SELECT` | `6` | Select |
| `BTN.START` | `7` | Start |

---

### `PokemonAgent.ADDR`

WRAM address constants for Pokémon Silver.  All values are 16-bit addresses
into `gameboy.memory[]`.  See [wram-reference.md](wram-reference.md) for full
descriptions.

```js
PokemonAgent.ADDR.wIsInBattle       // 0xD22D
PokemonAgent.ADDR.wBattleMenuCursor // 0xCC5B
PokemonAgent.ADDR.wCurMoveNum       // 0xCC2B
PokemonAgent.ADDR.wPlayerMonHP      // 0xD015
PokemonAgent.ADDR.wPlayerMonMaxHP   // 0xD023
PokemonAgent.ADDR.wEnemyMonHP       // 0xCFE6
PokemonAgent.ADDR.wPartyMon1HP      // 0xDCE0
PokemonAgent.ADDR.wPartyMon1MaxHP   // 0xDCF9
PokemonAgent.ADDR.wJoypadBlock      // 0xCC8A
```

---

## Underlying emulator functions

`PokemonAgent` is a thin wrapper around the lower-level functions from
`GameBoyIO.js`.  You can call these directly from the console at any time:

| Function | Description |
|---|---|
| `GameBoyJoyPadEvent(keycode, down)` | Press (`down=true`) or release (`down=false`) a button |
| `GameBoyEmulatorInitialized()` | `true` when a `GameBoyCore` instance exists |
| `GameBoyEmulatorPlaying()` | `true` when the emulator is not paused |
| `start(canvas, ROM)` | Load a new ROM string and start the emulator |
| `pause()` | Pause emulation |
| `run()` | Resume emulation after a pause |
| `saveSRAM()` | Write SRAM + RTC to `localStorage` |
| `save()` | Write a full freeze-state snapshot to `localStorage` |
| `openState(key, canvas)` | Restore a previously saved freeze state |

See [emulator-internals.md](emulator-internals.md) for deeper documentation on
these functions.
