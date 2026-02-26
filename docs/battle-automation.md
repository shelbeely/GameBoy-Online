# Battle Automation

This document covers how the agent detects and handles battles, the default
"always press A" strategy, and how to write more sophisticated logic.

---

## How battles are detected

Every tick the agent reads a single byte from the emulator's memory:

```js
// js/agent.js
function inBattle() {
    return _byte(ADDR.wIsInBattle) !== 0;
}
```

`ADDR.wIsInBattle` is `0xD22D`, the Pokémon Silver WRAM flag that the game
itself uses to track battle state:

| Value | Meaning |
|---|---|
| `0` | Not in a battle |
| `1` | Wild Pokémon encounter |
| `2` | Trainer battle |

When this byte is non-zero, `_handleBattle()` is called instead of the default
A-tap.

---

## The default strategy — "always press A"

```js
// js/agent.js
function _handleBattle() {
    _tap(BTN.A);
}
```

This works because of how Pokémon Silver's battle menu is structured:

```
Root menu   →  FIGHT (cursor default, index 0)
                │
                └─ Move select  →  Move 1 (cursor default, index 0)
                                        │
                                        └─ Result text / level-up screens
```

Each `A` press advances through one step of that chain.  Since both the root
menu and the move submenu default to their first option, repeatedly pressing A
will:

1. Choose **FIGHT** on the root menu.
2. Use **Move 1** on the move-select screen.
3. Advance through all result text, experience, and level-up popups.
4. Start the next turn's root menu, and repeat.

Outside of battle, the tick also taps A to dismiss Pokémon Center prompts, NPC
dialogue, and any other blocking text boxes.

---

## Joypad blocking guard

The agent checks `wJoypadBlock` (`0xCC8A`) before sending any input:

```js
function _tick() {
    if (joypadBlocked()) return;   // game is running a script — wait
    ...
}
```

This prevents inputs from being dropped during screen transitions, move
animations, or scripted sequences where the game temporarily ignores the joypad.

---

## Writing smarter battle logic

`_handleBattle()` in `js/agent.js` is the single extension point.  All internal
helpers are available inside that function.

### HP-based item use

```js
function _handleBattle() {
    var hpFrac = playerHPFraction();

    if (hpFrac < 0.20) {
        // Navigate from FIGHT (0) down one step to ITEM (1), then open the bag.
        // On the next tick the bag is open and A will select the first item.
        _tap(BTN.DOWN);
        return;
    }

    _tap(BTN.A);   // default: FIGHT → Move 1
}
```

> **Note:** The bag cursor starts at its last position.  If the agent has
> already used items in this session, the cursor may not be pointing at a
> Potion.  A more robust implementation tracks the menu cursor position with
> `wBattleMenuCursor` and moves it explicitly.

### Selecting a specific move

```js
function _handleBattle() {
    var cursor = _byte(ADDR.wBattleMenuCursor);   // 0=FIGHT 1=ITEM 2=PKMN 3=RUN

    if (cursor === 0) {
        // Root menu: press A to enter FIGHT submenu
        _tap(BTN.A);
        return;
    }

    // Inside FIGHT submenu — navigate to move slot 1 (index 1, i.e. the second move)
    var moveNum = _byte(ADDR.wCurMoveNum);  // 0–3
    if (moveNum < 1) {
        _tap(BTN.DOWN);    // move cursor down to slot 1
    } else if (moveNum > 1) {
        _tap(BTN.UP);      // move cursor back up
    } else {
        _tap(BTN.A);       // use Move 2
    }
}
```

### Switching a fainted Pokémon

When `wPlayerMonHP` reaches zero the active Pokémon has fainted.  The game
automatically opens the party screen to force a switch.

```js
function _handleBattle() {
    var playerHP = _word(ADDR.wPlayerMonHP);

    if (playerHP === 0) {
        // Party screen is open — press A to select the next slot, then A again
        // to confirm.  A simple implementation just keeps pressing A.
        _tap(BTN.A);
        return;
    }

    _tap(BTN.A);
}
```

### Catching wild Pokémon

```js
function _handleBattle() {
    var isBattle = _byte(ADDR.wIsInBattle);
    var enemyHP  = _word(ADDR.wEnemyMonHP);

    // Only try to catch wild Pokémon (value 1, not trainer battle value 2)
    if (isBattle === 1 && enemyHP < 20) {
        // Navigate root menu to ITEM, then select a Poké Ball
        var cursor = _byte(ADDR.wBattleMenuCursor);
        if (cursor !== 1) {
            // Move cursor toward ITEM slot (index 1)
            _tap(cursor < 1 ? BTN.DOWN : BTN.UP);
        } else {
            _tap(BTN.A);   // open bag / confirm Poké Ball
        }
        return;
    }

    _tap(BTN.A);   // default: fight
}
```

---

## Encounter rate farming

To keep gaining experience, the agent needs to trigger wild encounters.  The
simplest approach outside of battle is to walk in a specific direction into tall
grass rather than just tapping A.

Replace the outside-battle tap in `_tick()`:

```js
function _tick() {
    if (!GameBoyEmulatorInitialized() || !GameBoyEmulatorPlaying()) return;
    if (joypadBlocked()) return;

    if (inBattle()) {
        _handleBattle();
    } else {
        _wander();   // custom movement logic
    }
}

var _wanderDir = BTN.RIGHT;
var _wanderSteps = 0;

function _wander() {
    // Walk right for 4 taps, then left for 4 taps, alternating.
    _tap(_wanderDir);
    _wanderSteps++;
    if (_wanderSteps >= 4) {
        _wanderDir = (_wanderDir === BTN.RIGHT) ? BTN.LEFT : BTN.RIGHT;
        _wanderSteps = 0;
    }
}
```

---

## PP awareness

Move PP bytes for party slot 1 start at approximately `0xDCDF` in WRAM (each
move entry is 1 byte of PP).  Check before fighting to avoid struggling:

```js
var ADDR_MON1_PP = [0xDCDF, 0xDCE0, 0xDCE1, 0xDCE2];   // PP for moves 1–4

function _chooseMove() {
    for (var i = 0; i < 4; i++) {
        if (_byte(ADDR_MON1_PP[i]) > 0) return i;
    }
    return 0;   // all out of PP — Struggle
}
```

---

## Healing at the Pokémon Center

A common idle-game pattern is to detect low party HP and navigate to a
Pokémon Center.  The cleanest approach for a browser-based emulator is to use
freeze states as checkpoints:

1. Walk the player to the entrance of the nearest Pokémon Center and save a
   freeze state using `save()` from the browser console.
2. In `_tick()`, when party HP is critically low, call `openState()` to restore
   that checkpoint.  The game will be standing outside the Pokémon Center with
   full HP after the Center heal is completed — but a simpler shortcut is to
   save the state **after** walking out of the Center.

```js
var HEAL_CHECKPOINT_KEY = "FREEZE_POKEMON_SLVAAXE_0";   // created with save()

function _healIfNeeded() {
    var hp    = _word(ADDR.wPartyMon1HP);
    var maxHP = _word(ADDR.wPartyMon1MaxHP);
    if (maxHP > 0 && hp / maxHP < 0.15) {
        openState(HEAL_CHECKPOINT_KEY, document.getElementById("mainCanvas"));
    }
}
```

---

## Further ideas

| Feature | Approach |
|---|---|
| **Type-based move selection** | Map enemy species ID to type, choose a super-effective move slot |
| **Trainer skip** | Detect trainer-visible areas and route around them |
| **Item management** | Track bag inventory by reading item data in WRAM |
| **Egg hatching** | Walk step counter and check party egg flag |
| **Badge progression** | Read badge byte (`0xD57C`) to trigger new areas automatically |
