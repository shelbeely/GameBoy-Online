# LangGraph.js Agent

This document explains how to connect a
[LangGraph.js](https://github.com/langchain-ai/langgraphjs) stateful agent to
GameBoy Online to automate Pokémon Silver via a WebSocket bridge.

---

## Architecture

```
Browser (emulator + LangGraphHost)
        ↕  WebSocket (ws://localhost:9001)
Node.js (LangGraph agent)
```

The Node.js process runs a LangGraph state graph.  Each iteration of the
graph:

1. **`observe`** — requests memory reads from the browser to build a picture of
   the current game state (battle flag, HP values, cursor position, …).
2. **`decide`** — chooses the next button action based on the observed state.
   Swap in an LLM call here for smarter reasoning.
3. **`act`** — sends a `press` message to the browser, which calls
   `GameBoyJoyPadEvent()` on the emulator.

The graph then loops back to `observe` after a configurable delay (`TICK_MS`,
default 450 ms).

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | Needed to run the agent process |
| A legal Pokémon Silver (U) `.gbc` ROM | See [quickstart.md](quickstart.md) |
| A running web server | `npx serve .` or `python -m http.server 8080` |

---

## Step 1 — Install the agent dependencies

```bash
cd langgraph-agent
npm install
```

This installs `@langchain/langgraph`, `@langchain/core`, and `ws`.

---

## Step 2 — Start the LangGraph agent

```bash
node agent.js
```

You should see:

```
[LangGraphAgent] WebSocket server listening on ws://localhost:9001
[LangGraphAgent] Waiting for browser to connect …
```

---

## Step 3 — Open the emulator in the browser

Start your local static server from the project root:

```bash
npx serve .
# or
python -m http.server 8080
```

Open `http://localhost:8080` and load a Pokémon Silver ROM via **File → Open
As → Local File** (or use `PokemonAgent.boot()`).

---

## Step 4 — Connect the browser to the agent

Open the browser DevTools Console (F12) and run:

```js
LangGraphHost.connect();   // connects to ws://localhost:9001
```

You should see both sides log a connection message:

- **Browser:** `[LangGraphHost] Connected to LangGraph agent on port 9001.`
- **Agent:** `[LangGraphAgent] Browser connected.`
- **Agent:** `[LangGraphAgent] Starting agent loop (tick every 450 ms) …`

The agent immediately starts observing game state and pressing buttons.

---

## Step 5 (optional) — Auto-connect on page load

Add a `LangGraphHost.connect()` call to the `window.onload` block in
`index.html`:

```js
window.onload = function () {
    windowingInitialize();
    LangGraphHost.connect();   // auto-connect to the LangGraph agent
};
```

---

## Replacing the rule-based decision with an LLM

Open `langgraph-agent/agent.js` and find the `decide` node.  Replace the call
to `_decideWithRules()` with an LLM invocation.  For example, using OpenAI:

```js
import { ChatOpenAI } from "@langchain/openai";

// Add to package.json dependencies: "@langchain/openai": "^0.4.0"
const model = new ChatOpenAI({ model: "gpt-4o-mini" });

async function decide(state) {
    const prompt = `You are playing Pokémon Silver.
Game state:
- In battle: ${state.inBattle}
- Player HP: ${Math.round(state.playerHPFraction * 100)}%
- Enemy HP: ${state.enemyHP}
- Battle menu cursor: ${state.battleMenuCursor} (0=FIGHT 1=ITEM 2=PKMN 3=RUN)

Choose one button to press: A, B, UP, DOWN, LEFT, RIGHT, START, SELECT.
Respond with ONLY the button name.`;

    const result = await model.invoke(prompt);
    const name   = result.content.trim().toUpperCase();
    const BTN    = { RIGHT: 0, LEFT: 1, UP: 2, DOWN: 3, A: 4, B: 5, SELECT: 6, START: 7 };
    return { nextAction: BTN[name] ?? BTN.A };
}
```

Set your API key before running:

```bash
export OPENAI_API_KEY="sk-..."
node agent.js
```

---

## Stopping the agent

```js
// Browser console
LangGraphHost.disconnect();
```

The agent loop exits automatically when the WebSocket closes.

---

## Graph diagram

```
        [START]
           │
       ┌───▼───┐
       │observe│  ← reads WRAM memory via WebSocket
       └───┬───┘
           │
       ┌───▼───┐
       │decide │  ← rule-based (or LLM) action selection
       └───┬───┘
           │
       ┌───▼───┐
       │  act  │  ← sends press command to browser
       └───┬───┘
           │
    ┌──────▼──────┐
    │ connected?  │
    │ stop req?   │
    └──┬──────┬───┘
       │ yes  │ no
      [END]   └──► observe  (loop)
```

---

## File reference

| File | Purpose |
|---|---|
| `langgraph-agent/agent.js` | Node.js LangGraph agent (observe / decide / act graph) |
| `langgraph-agent/package.json` | NPM manifest for the agent process |
| `js/langgraph-ws-host.js` | Browser bridge — relays agent messages to the emulator |

---

## Related documentation

| Document | Covers |
|---|---|
| [quickstart.md](quickstart.md) | Idle-play setup with the simpler `PokemonAgent` |
| [agent-api.md](agent-api.md) | `PokemonAgent` API reference |
| [emulator-internals.md](emulator-internals.md) | WebSocket protocol and state snapshots |
| [wram-reference.md](wram-reference.md) | All documented WRAM addresses |
