# Quick-start: Pokémon Silver Idle Setup

This guide gets Pokémon Silver running as a self-playing background game in
under five minutes.

## Prerequisites

| Requirement | Notes |
|---|---|
| A legal copy of the Pokémon Silver (U) `.gbc` ROM | Must be obtained by the player |
| A static web server | `npx serve .`, `python -m http.server`, VS Code Live Server, or any equivalent |
| A modern browser | Chrome, Firefox, Safari, or Edge (current) |

> **Why a web server?** The XHR-based ROM loader is blocked by browsers when
> the page is opened directly from the filesystem (`file://`).  Any local static
> server satisfies the requirement.

---

## Step 1 — Place your ROM

Copy the ROM file somewhere under the project root so it is served by the same
origin as the page (CORS applies to XHR requests).  A dedicated folder is
recommended:

```
GameBoy-Online/
  roms/
    pokemon_silver.gbc   ← place it here
  index.html
  js/
    agent.js
    ...
```

The `roms/` directory is already in `.gitignore` — the ROM will never be
accidentally committed.

---

## Step 2 — Configure the agent

Open `js/agent.js` and set `ROM_URL` near the top of the file:

```js
var ROM_URL = "roms/pokemon_silver.gbc";
```

The path is relative to `index.html`.

---

## Step 3 — Start the server and open the page

```bash
# Example using Node:
npx serve .

# Example using Python 3:
python -m http.server 8080
```

Open `http://localhost:8080` (or whatever port your server reports) in your
browser.

---

## Step 4 — Boot the game and start automation

Open the browser **DevTools Console** (F12 → Console tab) and run:

```js
PokemonAgent.boot();   // fetches the ROM and starts the emulator
PokemonAgent.start();  // begins the automation loop
```

The game will appear on screen, run through its intro, and immediately begin
playing itself.  You will see `[PokemonAgent] ROM booted.` and
`[PokemonAgent] Agent started (tick every 450 ms).` logged to the console.

---

## Step 5 — Switch to your work

Minimise or switch away from the browser tab.  The game continues advancing in
the background thanks to the `agentMode` flag.  SRAM (in-game save progress) is
written to `localStorage` every 60 seconds automatically.

Glance back at any time — battles are handled automatically.

---

## Fully automatic boot on every page load

To skip the console step entirely, edit the `window.onload` block inside
`index.html`:

```js
window.onload = function () {
    windowingInitialize();
    PokemonAgent.boot();   // load Pokémon Silver automatically
    PokemonAgent.start();  // begin idle automation immediately
};
```

After this change, every page refresh restores the game and resumes automation
without any manual interaction.

---

## Stopping and resuming

```js
PokemonAgent.stop();    // pause automation and restore normal tab-visibility behaviour
PokemonAgent.start();   // resume automation (does not reload the ROM)
```

---

## What happens next?

| Document | Covers |
|---|---|
| [idle-mode.md](idle-mode.md) | How background running and auto-save work in detail |
| [battle-automation.md](battle-automation.md) | How battles are detected and handled; how to write smarter strategies |
| [agent-api.md](agent-api.md) | Complete `PokemonAgent` API reference |
| [wram-reference.md](wram-reference.md) | All documented WRAM addresses for Pokémon Silver |
| [emulator-internals.md](emulator-internals.md) | How to connect any external AI agent to the emulator |
