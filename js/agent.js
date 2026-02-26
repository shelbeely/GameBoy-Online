"use strict";
/*
 * js/agent.js  —  Pokémon Silver background automation agent
 *
 * Implements PokemonAgent, a lightweight automation layer that:
 *   • Fetches and starts a Pokémon Silver ROM automatically on page load.
 *   • Keeps the emulator running even when the browser tab is in the background.
 *   • Detects battles via WRAM memory reads and presses buttons autonomously.
 *   • Periodically auto-saves SRAM so progress is never lost.
 *
 * IMPORTANT: You must supply your own legally-obtained Pokémon Silver (U) ROM.
 *
 * Quick start (browser console):
 *   PokemonAgent.boot("pokemon_silver.gbc");  // load and start the ROM
 *   PokemonAgent.start();                     // begin automation
 *
 * To auto-boot on every page load, set ROM_URL below and call
 * PokemonAgent.boot() + PokemonAgent.start() from window.onload.
 */

var PokemonAgent = (function () {

    // -------------------------------------------------------------------------
    // Configuration  (edit these before using the agent)
    // -------------------------------------------------------------------------

    /**
     * Path or URL to the Pokémon Silver (U) ROM file.
     * Set this value, or pass the path directly to PokemonAgent.boot().
     * The file must be served from the same origin as the page (CORS applies).
     *
     * Example:  var ROM_URL = "roms/pokemon_silver.gbc";
     */
    var ROM_URL = "";

    /** How often the agent decision loop fires, in milliseconds. */
    var TICK_MS = 450;

    /**
     * Automatically save SRAM every N seconds so in-game progress is
     * persisted to localStorage.  Set to 0 to disable.
     */
    var AUTO_SAVE_INTERVAL_S = 60;

    // -------------------------------------------------------------------------
    // Pokémon Silver (U) key WRAM addresses
    //
    // These are verified against the pret/pokegold disassembly:
    //   https://github.com/pret/pokegold
    //
    // All addresses are in the GBC's 16-bit address space and are read directly
    // from gameboy.memory[addr] (the emulator's flat 64 KB memory array).
    // -------------------------------------------------------------------------

    var ADDR = {
        // Battle status.  0 = not in battle, 1 = wild battle, 2 = trainer battle.
        wIsInBattle:       0xD22D,

        // Root battle-menu cursor position.  0=FIGHT  1=ITEM  2=PKMN  3=RUN
        wBattleMenuCursor: 0xCC5B,

        // Move cursor within the FIGHT submenu (0 = Move 1, …, 3 = Move 4).
        wCurMoveNum:       0xCC2B,

        // Current HP of the active player Pokémon during a battle (2 bytes, big-endian).
        wPlayerMonHP:      0xD015,
        wPlayerMonMaxHP:   0xD023,

        // Current HP of the enemy Pokémon during a battle (2 bytes, big-endian).
        wEnemyMonHP:       0xCFE6,

        // HP of the first party slot Pokémon (2 bytes, big-endian).
        wPartyMon1HP:      0xDCE0,
        wPartyMon1MaxHP:   0xDCF9,

        // Non-zero while the game is processing input / running a script.
        // Read before sending button presses to avoid dropped inputs.
        wJoypadBlock:      0xCC8A,
    };

    // -------------------------------------------------------------------------
    // Button codes  (must match the matchKey() order in GameBoyIO.js)
    //   0=Right  1=Left  2=Up  3=Down  4=A  5=B  6=Select  7=Start
    // -------------------------------------------------------------------------

    var BTN = { RIGHT: 0, LEFT: 1, UP: 2, DOWN: 3, A: 4, B: 5, SELECT: 6, START: 7 };

    // -------------------------------------------------------------------------
    // Internal state
    // -------------------------------------------------------------------------

    var _running   = false;
    var _tickTimer = null;
    var _saveTimer = null;

    // -------------------------------------------------------------------------
    // Memory helpers
    // -------------------------------------------------------------------------

    /** Read a single unsigned byte from the emulator's memory map. */
    function _byte(addr) {
        return GameBoyEmulatorInitialized() ? (gameboy.memory[addr] & 0xFF) : 0;
    }

    /** Read a big-endian 16-bit word (two consecutive bytes). */
    function _word(addr) {
        return (_byte(addr) << 8) | _byte(addr + 1);
    }

    // -------------------------------------------------------------------------
    // Input helpers
    // -------------------------------------------------------------------------

    /**
     * Press a button and release it after durationMs milliseconds.
     * Uses the existing GameBoyJoyPadEvent() function from GameBoyIO.js.
     */
    function _press(btn, durationMs) {
        if (!GameBoyEmulatorInitialized() || !GameBoyEmulatorPlaying()) return;
        GameBoyJoyPadEvent(btn, true);
        setTimeout(function () { GameBoyJoyPadEvent(btn, false); }, durationMs || 80);
    }

    /** Tap a button with a short press (80 ms). */
    function _tap(btn) { _press(btn, 80); }

    // -------------------------------------------------------------------------
    // Game-state queries
    // -------------------------------------------------------------------------

    /** Returns true while a battle (wild or trainer) is active. */
    function inBattle() {
        return _byte(ADDR.wIsInBattle) !== 0;
    }

    /** Returns true while the game is blocking joypad input. */
    function joypadBlocked() {
        return _byte(ADDR.wJoypadBlock) !== 0;
    }

    /** Current HP of the active battle Pokémon as a fraction (0–1). */
    function playerHPFraction() {
        var max = _word(ADDR.wPlayerMonMaxHP);
        return max > 0 ? _word(ADDR.wPlayerMonHP) / max : 1;
    }

    // -------------------------------------------------------------------------
    // Battle automation
    // -------------------------------------------------------------------------

    /**
     * Called every tick while wIsInBattle is non-zero.
     *
     * Default strategy  ("always press A"):
     *   • On the root battle menu FIGHT is the first option — A enters move select.
     *   • On the move-select screen Move 1 is highlighted by default — A uses it.
     *   • During result text / level-up screens A speeds through the message.
     *
     * To build a smarter strategy, inspect ADDR.wBattleMenuCursor and
     * ADDR.wCurMoveNum before pressing, e.g. to pick a different move or to
     * switch Pokémon when HP is critically low (see playerHPFraction()).
     */
    function _handleBattle() {
        _tap(BTN.A);
    }

    // -------------------------------------------------------------------------
    // Main agent tick
    // -------------------------------------------------------------------------

    function _tick() {
        if (!GameBoyEmulatorInitialized() || !GameBoyEmulatorPlaying()) return;
        // Do not send inputs while the game is running a script / blocking joypad.
        if (joypadBlocked()) return;

        if (inBattle()) {
            _handleBattle();
        } else {
            // Outside battle: tap A to dismiss any lingering text box or dialog.
            _tap(BTN.A);
        }
    }

    // -------------------------------------------------------------------------
    // ROM autoboot
    // -------------------------------------------------------------------------

    /**
     * Fetch the Pokémon Silver ROM from romUrl (or ROM_URL) via XHR and start
     * the emulator.  The ROM must be served from the same origin as the page.
     *
     * @param {string} [romUrl]  Optional override for ROM_URL.
     */
    function boot(romUrl) {
        var url = romUrl || ROM_URL;
        if (!url) {
            console.error(
                "[PokemonAgent] No ROM URL set.  " +
                "Pass a path to boot(), or set PokemonAgent.ROM_URL first."
            );
            return;
        }

        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        // Force binary mode so high bytes in the ROM are not mangled by text-encoding conversion.
        xhr.overrideMimeType("text/plain; charset=x-user-defined");

        xhr.onload = function () {
            if (xhr.status === 200) {
                var canvas = document.getElementById("mainCanvas");
                // Hide the title overlay exactly as the normal file-open path does.
                if (typeof initPlayer === "function") initPlayer();
                start(canvas, xhr.responseText);
                console.log("[PokemonAgent] ROM booted.");
            } else {
                console.error("[PokemonAgent] Failed to fetch ROM — HTTP " + xhr.status);
            }
        };
        xhr.onerror = function () {
            console.error("[PokemonAgent] Network error while fetching ROM.");
        };

        xhr.send();
    }

    // -------------------------------------------------------------------------
    // Start / stop
    // -------------------------------------------------------------------------

    /** Begin the automation loop.  Also enables background-tab running. */
    function startAgent() {
        if (_running) return;

        // agentMode is declared in GameBoyIO.js.  Setting it to true makes the
        // emulator run loop continue even when document.hidden is true, so the
        // game progresses while you work in another tab or window.
        agentMode = true;
        _running  = true;

        _tickTimer = setInterval(_tick, TICK_MS);

        if (AUTO_SAVE_INTERVAL_S > 0) {
            _saveTimer = setInterval(function () {
                // saveSRAM() is declared in GameBoyIO.js.
                if (GameBoyEmulatorInitialized()) saveSRAM();
            }, AUTO_SAVE_INTERVAL_S * 1000);
        }

        console.log("[PokemonAgent] Agent started (tick every " + TICK_MS + " ms).");
    }

    /** Pause the automation loop and restore normal (foreground-only) running. */
    function stopAgent() {
        _running = false;
        if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
        if (_saveTimer) { clearInterval(_saveTimer); _saveTimer = null; }
        agentMode = false;
        console.log("[PokemonAgent] Agent stopped.");
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    return {
        /**
         * Path/URL to the ROM.  Set before calling boot() if not passing the
         * URL as an argument.
         * @type {string}
         */
        ROM_URL: ROM_URL,

        /** Key WRAM address constants for direct memory inspection. */
        ADDR: ADDR,

        /** Button code constants that match GameBoyIO.js button ordering. */
        BTN: BTN,

        /**
         * Fetch the ROM and start the emulator.
         * @param {string} [romUrl]  Path/URL of the ROM (overrides ROM_URL).
         */
        boot: boot,

        /** Begin the automation loop (enables background running). */
        start: startAgent,

        /** Pause the automation loop (restores foreground-only running). */
        stop: stopAgent,

        /** True while the agent tick loop is active. */
        get running() { return _running; },

        // Low-level helpers — useful for experimenting in the browser console.

        /** Read one byte from the emulator's memory map. */
        readByte: _byte,

        /** Read a big-endian 16-bit word from the emulator's memory map. */
        readWord: _word,

        /** True while a battle is active. */
        inBattle: inBattle,

        /** Press a button for durationMs milliseconds. */
        press: _press,

        /** Tap a button with an 80 ms press. */
        tap: _tap,

        /** Current HP of the active battle Pokémon as a fraction (0–1). */
        playerHPFraction: playerHPFraction,
    };

}());
