"use strict";
/*
 * js/langgraph-ws-host.js — Browser-side WebSocket bridge for the LangGraph agent
 *
 * This script runs inside the browser alongside the emulator.  It connects
 * to the Node.js LangGraph agent (langgraph-agent/agent.js) that is running
 * on ws://localhost:9001, then relays the agent's requests to the emulator
 * functions (GameBoyJoyPadEvent, gameboy.memory, etc.).
 *
 * Usage (browser console or window.onload):
 *   LangGraphHost.connect();          // connect to the agent on default port
 *   LangGraphHost.connect(9001);      // explicit port
 *   LangGraphHost.disconnect();       // close the WebSocket
 *
 * The LangGraph agent (langgraph-agent/agent.js) must already be running:
 *   cd langgraph-agent && npm install && node agent.js
 */

var LangGraphHost = (function () {

    var WS_PORT_DEFAULT = 9001;
    var _ws = null;

    // -------------------------------------------------------------------------
    // Message handlers
    // -------------------------------------------------------------------------

    /**
     * Handle a single parsed message from the LangGraph agent and, when
     * required, send a response back over the same socket.
     *
     * Supported actions:
     *   press     — hold a button for holdMs (default 80) milliseconds
     *   release   — release a button immediately
     *   read_byte — read one byte from gameboy.memory[addr]
     */
    function _handleMessage(msg) {
        if (!msg || !msg.action) return;

        if (msg.action === "press") {
            if (!GameBoyEmulatorInitialized() || !GameBoyEmulatorPlaying()) return;
            var btn    = msg.button;
            var holdMs = typeof msg.holdMs === "number" ? msg.holdMs : 80;
            GameBoyJoyPadEvent(btn, true);
            setTimeout(function () { GameBoyJoyPadEvent(btn, false); }, holdMs);

        } else if (msg.action === "release") {
            if (!GameBoyEmulatorInitialized()) return;
            GameBoyJoyPadEvent(msg.button, false);

        } else if (msg.action === "read_byte") {
            var value = GameBoyEmulatorInitialized()
                ? (gameboy.memory[msg.addr] & 0xFF)
                : 0;
            _send({ type: "byte", addr: msg.addr, value: value, reqId: msg.reqId });
        }
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _send(obj) {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            _ws.send(JSON.stringify(obj));
        }
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Open a WebSocket connection to the LangGraph agent.
     * @param {number} [port]  Port the agent's WebSocket server is listening on
     *                         (default 9001).
     */
    function connect(port) {
        port = port || WS_PORT_DEFAULT;

        if (_ws) {
            console.warn("[LangGraphHost] Already connected.  Call disconnect() first.");
            return;
        }

        _ws = new WebSocket("ws://localhost:" + port);

        _ws.onopen = function () {
            console.log("[LangGraphHost] Connected to LangGraph agent on port " + port + ".");
        };

        _ws.onmessage = function (evt) {
            var msg;
            try { msg = JSON.parse(evt.data); } catch (e) { return; }
            _handleMessage(msg);
        };

        _ws.onerror = function (err) {
            console.error("[LangGraphHost] WebSocket error:", err);
        };

        _ws.onclose = function () {
            _ws = null;
            console.log("[LangGraphHost] Disconnected from LangGraph agent.");
        };
    }

    /** Close the WebSocket connection to the LangGraph agent. */
    function disconnect() {
        if (_ws) {
            _ws.close();
            _ws = null;
        }
    }

    return {
        /**
         * Connect to the LangGraph agent WebSocket server.
         * @param {number} [port]  Server port (default 9001).
         */
        connect: connect,

        /** Close the connection to the LangGraph agent. */
        disconnect: disconnect,

        /** True while connected to the agent. */
        get connected() { return _ws !== null && _ws.readyState === WebSocket.OPEN; },
    };

}());
