/**
 * langgraph-agent/agent.js — LangGraph.js agent for GameBoy Online
 *
 * Uses a LangGraph state graph to drive Pokémon Silver autonomously via a
 * WebSocket connection to the browser.  The graph follows an observe → decide
 * → act loop that mirrors the PokemonAgent in js/agent.js but models each step
 * as an explicit LangGraph node.
 *
 * Quick start:
 *   cd langgraph-agent
 *   npm install
 *   node agent.js
 *
 * Then, in the browser console, load the WebSocket host:
 *   // index.html already includes js/langgraph-ws-host.js
 *   LangGraphHost.connect();
 *
 * The agent runs a rule-based decision node by default.  Replace
 * _decideWithRules() with an LLM call (see the comment block below) to enable
 * LLM-powered reasoning.
 *
 * Requirements: Node >= 18, @langchain/langgraph >= 1.1.5
 */

import { Annotation, StateGraph, END } from "@langchain/langgraph";
import { WebSocketServer } from "ws";

// ---------------------------------------------------------------------------
// Button code constants (must match GameBoyIO.js / PokemonAgent.BTN)
// ---------------------------------------------------------------------------

const BTN = { RIGHT: 0, LEFT: 1, UP: 2, DOWN: 3, A: 4, B: 5, SELECT: 6, START: 7 };

// ---------------------------------------------------------------------------
// WRAM address constants for Pokémon Silver (U)
// (same values as PokemonAgent.ADDR in js/agent.js)
// ---------------------------------------------------------------------------

const ADDR = {
    wIsInBattle:       0xD22D,
    wBattleMenuCursor: 0xCC5B,
    wCurMoveNum:       0xCC2B,   // useful for custom battle logic: move slot 0–3
    wPlayerMonHP:      0xD015,
    wPlayerMonMaxHP:   0xD023,
    wEnemyMonHP:       0xCFE6,
    wJoypadBlock:      0xCC8A,
};

// ---------------------------------------------------------------------------
// LangGraph state schema
// ---------------------------------------------------------------------------

const AgentState = Annotation.Root({
    /** Whether a battle (wild or trainer) is currently active. */
    inBattle:         Annotation({ default: () => false }),
    /** Active player mon HP as a fraction 0–1 (1 = full HP). */
    playerHPFraction: Annotation({ default: () => 1 }),
    /** Raw enemy mon HP (0 = fainted). */
    enemyHP:          Annotation({ default: () => 0 }),
    /** Root battle-menu cursor (0=FIGHT 1=ITEM 2=PKMN 3=RUN). */
    battleMenuCursor: Annotation({ default: () => 0 }),
    /** Whether the joypad is blocked (game is running a script). */
    joypadBlocked:    Annotation({ default: () => false }),
    /** Button code chosen by the decide node; null = no action this tick. */
    nextAction:       Annotation({ default: () => null }),
    /** Set to true to stop the agent loop cleanly. */
    stopRequested:    Annotation({ default: () => false }),
});

// ---------------------------------------------------------------------------
// WebSocket server — the browser connects to this
// ---------------------------------------------------------------------------

const WS_PORT = 9001;
let _browser = null;   // the active WebSocket connection to the browser
const _pending = new Map();  // reqId → { resolve, reject }
let _reqId = 0;

function startServer() {
    const wss = new WebSocketServer({ port: WS_PORT });

    wss.on("listening", () => {
        console.log(`[LangGraphAgent] WebSocket server listening on ws://localhost:${WS_PORT}`);
        console.log("[LangGraphAgent] Waiting for browser to connect …");
    });

    wss.on("connection", (ws) => {
        _browser = ws;
        console.log("[LangGraphAgent] Browser connected.");

        ws.on("message", (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            const cb = _pending.get(msg.reqId);
            if (cb) {
                _pending.delete(msg.reqId);
                cb.resolve(msg);
            }
        });

        ws.on("close", () => {
            _browser = null;
            console.log("[LangGraphAgent] Browser disconnected.");
        });
    });
}

/**
 * Send a request to the browser and wait for its response.
 * @param {object} req  JSON message to send.
 * @returns {Promise<object>} Parsed JSON response.
 */
function _request(req) {
    return new Promise((resolve, reject) => {
        if (!_browser || _browser.readyState !== 1 /* OPEN */) {
            return reject(new Error("No browser connected"));
        }
        const id = ++_reqId;
        _pending.set(id, { resolve, reject });
        _browser.send(JSON.stringify({ ...req, reqId: id }));
    });
}

/**
 * Read a single unsigned byte from the emulator's memory map.
 * @param {number} addr  16-bit WRAM address.
 */
async function _readByte(addr) {
    const resp = await _request({ action: "read_byte", addr });
    return resp.value & 0xFF;
}

/**
 * Read a big-endian 16-bit word from the emulator's memory map.
 * @param {number} addr  Base address (high byte at addr, low byte at addr+1).
 */
async function _readWord(addr) {
    const [hi, lo] = await Promise.all([_readByte(addr), _readByte(addr + 1)]);
    return (hi << 8) | lo;
}

/**
 * Press a button in the emulator.
 * @param {number} btn   Button code from BTN.
 * @param {number} [ms]  Hold duration in milliseconds (default 80).
 */
function _press(btn, ms = 80) {
    if (!_browser || _browser.readyState !== 1) return;
    _browser.send(JSON.stringify({ action: "press", button: btn, holdMs: ms }));
}

// ---------------------------------------------------------------------------
// Node: observe
// Reads the current game state from the emulator and returns a state update.
// ---------------------------------------------------------------------------

async function observe(state) {
    const [
        isInBattle,
        joypadBlock,
        playerHP,
        playerMaxHP,
        enemyHP,
        battleCursor,
    ] = await Promise.all([
        _readByte(ADDR.wIsInBattle),
        _readByte(ADDR.wJoypadBlock),
        _readWord(ADDR.wPlayerMonHP),
        _readWord(ADDR.wPlayerMonMaxHP),
        _readWord(ADDR.wEnemyMonHP),
        _readByte(ADDR.wBattleMenuCursor),
    ]);

    return {
        inBattle:         isInBattle !== 0,
        joypadBlocked:    joypadBlock !== 0,
        playerHPFraction: playerMaxHP > 0 ? playerHP / playerMaxHP : 1,
        enemyHP,
        battleMenuCursor: battleCursor,
        nextAction:       null,   // cleared before each decide step
    };
}

// ---------------------------------------------------------------------------
// Node: decide
// Chooses the next button press based on observed state.
//
// To use an LLM instead of the rule-based logic below, replace the body of
// this function with a chat-model call, e.g.:
//
//   import { ChatOpenAI } from "@langchain/openai";
//   const model = new ChatOpenAI({ model: "gpt-4o-mini" });
//   const prompt = `Game state: ${JSON.stringify(state)}
//   Choose one action from: A, B, UP, DOWN, LEFT, RIGHT, START, SELECT.
//   Respond with only the action name.`;
//   const result = await model.invoke(prompt);
//   const actionName = result.content.trim().toUpperCase();
//   return { nextAction: BTN[actionName] ?? BTN.A };
// ---------------------------------------------------------------------------

function _decideWithRules(state) {
    // Skip this tick while the game is processing input.
    if (state.joypadBlocked) return null;

    if (state.inBattle) {
        // In a battle: always press A (selects FIGHT, then Move 1, advances text).
        return BTN.A;
    }

    // Outside battle: press A to dismiss text boxes / advance overworld events.
    return BTN.A;
}

async function decide(state) {
    const action = _decideWithRules(state);
    return { nextAction: action };
}

// ---------------------------------------------------------------------------
// Node: act
// Sends the chosen button press to the emulator.
// ---------------------------------------------------------------------------

async function act(state) {
    if (state.nextAction !== null) {
        _press(state.nextAction);
    }
    return {};
}

// ---------------------------------------------------------------------------
// Conditional edge: should the loop continue?
// ---------------------------------------------------------------------------

function shouldContinue(state) {
    if (state.stopRequested) return END;
    if (!_browser || _browser.readyState !== 1) return END;
    return "observe";
}

// ---------------------------------------------------------------------------
// Build and compile the graph
// ---------------------------------------------------------------------------

function buildGraph() {
    const graph = new StateGraph(AgentState)
        .addNode("observe", observe)
        .addNode("decide", decide)
        .addNode("act", act)
        .addEdge("__start__", "observe")
        .addEdge("observe", "decide")
        .addEdge("decide", "act")
        .addConditionalEdges("act", shouldContinue);

    return graph.compile();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const TICK_MS = 450;   // how long to pause between graph iterations

async function main() {
    startServer();

    const app = buildGraph();

    // Wait until the browser connects before starting the loop.
    await new Promise((resolve) => {
        const check = setInterval(() => {
            if (_browser) { clearInterval(check); resolve(); }
        }, 500);
    });

    console.log("[LangGraphAgent] Starting agent loop (tick every " + TICK_MS + " ms) …");

    let currentState = {
        inBattle:         false,
        playerHPFraction: 1,
        enemyHP:          0,
        battleMenuCursor: 0,
        joypadBlocked:    false,
        nextAction:       null,
        stopRequested:    false,
    };

    // Stream the graph continuously, pausing TICK_MS between iterations.
    while (true) {
        try {
            for await (const chunk of await app.stream(currentState, { streamMode: "updates" })) {
                // Merge each node's output into the running state.
                for (const [, update] of Object.entries(chunk)) {
                    currentState = { ...currentState, ...update };
                }
            }

            if (currentState.stopRequested || !_browser) {
                console.log("[LangGraphAgent] Agent loop ended.");
                break;
            }
        } catch (err) {
            // If the browser disconnected mid-tick, wait and retry.
            console.warn("[LangGraphAgent] Tick error:", err.message);
        }

        await new Promise((r) => setTimeout(r, TICK_MS));
    }
}

main().catch((err) => {
    console.error("[LangGraphAgent] Fatal error:", err);
    process.exit(1);
});
