# Idle Mode — Background Running and Auto-save

This document explains how the emulator is kept alive when the browser tab is
hidden, how SRAM progress is persisted automatically, and how to tune both
behaviours.

---

## The problem: browsers pause hidden tabs

By default, browsers throttle or completely freeze `setInterval` timers in
background tabs to save CPU and battery.  GameBoy Online already guards the
emulator loop against this:

```js
// js/GameBoyIO.js  — original guard
gbRunInterval = setInterval(function () {
    if (!document.hidden) {   // ← stops ticking when tab is hidden
        gameboy.run();
    }
}, settings[6]);
```

This is fine for interactive play but breaks the idle use-case where you want
the game to keep advancing while you focus on a coding project in another window.

---

## The solution: `agentMode`

`js/GameBoyIO.js` exposes a single module-level boolean:

```js
var agentMode = false;
```

The run-loop guard was updated to honour this flag:

```js
gbRunInterval = setInterval(function () {
    if (!document.hidden || agentMode) {   // ← agent bypasses the visibility check
        gameboy.run();
    }
}, settings[6]);
```

When `agentMode` is `true`, `gameboy.run()` is called on every timer fire
regardless of whether the tab is visible.

### Enabling / disabling

`PokemonAgent.start()` sets `agentMode = true` before starting its own tick
timer.  `PokemonAgent.stop()` sets it back to `false`.  You can also toggle it
directly from the browser console:

```js
agentMode = true;    // keep emulator alive in background
agentMode = false;   // restore normal browser throttling
```

### Performance notes

- The emulator interval defaults to **8 ms** (`settings[6]`), matching a
  roughly 125 fps emulation cadence.  This continues in the background when
  `agentMode` is on.
- Modern browser tab-throttling policies differ by browser.  Chrome and Edge
  throttle timers to 1-second intervals in hidden tabs by default, regardless of
  the requested interval.  Firefox is similar.  The `agentMode` flag does **not**
  override this throttling; it only prevents the explicit `document.hidden` guard
  inside GameBoy Online from skipping `gameboy.run()` calls.  In practice the
  game may run at reduced speed in a hidden tab; this is acceptable for an idle
  game.
- If you need full-speed background execution (e.g. for benchmarking), run the
  page in a separate window rather than a background tab; windows are rarely
  throttled.

---

## Auto-save

The agent calls `saveSRAM()` on a fixed timer so your in-game progress is
written to `localStorage` automatically.

### How it works

`saveSRAM()` (declared in `js/GameBoyIO.js`) calls `gameboy.saveSRAMState()`,
which reads the battery-backed RAM banks from the running emulator and returns
a `Uint8Array`.  That array is Base64-encoded and stored under the key:

```
B64_SRAM_<cartridge name>
```

For Pokémon Silver, the cartridge name reported by the ROM header is
`POKEMON_SLVAAXE` (varies slightly by revision), so the key in `localStorage`
will be something like `B64_SRAM_POKEMON_SLVAAXE`.

RTC (real-time clock) state is also saved automatically alongside SRAM:

```js
// js/GameBoyIO.js
function autoSave() {
    saveSRAM();   // writes B64_SRAM_<name>
    saveRTC();    // writes RTC_<name>
}
```

### Auto-save interval

Configured in `js/agent.js`:

```js
var AUTO_SAVE_INTERVAL_S = 60;   // save every 60 seconds; set to 0 to disable
```

On every tick of the save timer the agent calls:

```js
if (GameBoyEmulatorInitialized()) saveSRAM();
```

### Manually triggering a save

```js
saveSRAM();   // browser console — saves SRAM + RTC immediately
```

---

## Persistence across page reloads

When the page reloads and `PokemonAgent.boot()` is called, `start()` in
`js/GameBoyIO.js` calls `openSRAM()`:

```js
gameboy.openMBC = openSRAM;   // called by GameBoyCore when it initialises MBC
```

`openSRAM()` reads `B64_SRAM_<name>` from `localStorage` and passes the decoded
bytes to the emulator.  The game therefore picks up where it left off — the
player does not need to use the in-game save.

### Full freeze-state saves

In addition to SRAM, you can save a complete CPU + memory snapshot (a
"freeze state") with:

```js
// js/GameBoyIO.js
save();    // writes FREEZE_<name>_<n> to localStorage
```

Freeze states capture CPU registers, all memory banks, VRAM, and timing counters
as a JSON array.  They allow resuming from the exact emulator state rather than
relying on the in-game save system.  See
[emulator-internals.md](emulator-internals.md) for the full format.

---

## Combining idle mode with the in-game save

Pokémon Silver has its own save system (Start → Save).  Using it alongside the
agent's SRAM auto-save is redundant but harmless.  The agent's auto-save is more
reliable for the idle use-case because it does not require navigating menus.

---

## Disabling idle mode

```js
PokemonAgent.stop();   // clears both the tick timer and the save timer; agentMode → false
```

After stopping, the emulator continues running in the foreground but will pause
when you switch away from the tab.
