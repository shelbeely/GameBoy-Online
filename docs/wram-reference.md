# Pokémon Silver WRAM Address Reference

This page lists all WRAM addresses currently used by `js/agent.js`, along with
additional addresses that are useful for building more sophisticated automation.

All values are read from `gameboy.memory[addr]` — the emulator's flat 64 KB
memory array.  The addresses are in the GBC's 16-bit address space.

**Source:** [pret/pokegold disassembly](https://github.com/pret/pokegold)  
Verify addresses against your specific ROM revision before relying on them.

---

## How to read memory

```js
// Read one byte (unsigned, 0–255)
var value = PokemonAgent.readByte(0xD22D);

// Read a big-endian 16-bit word (e.g. HP values)
var hp = PokemonAgent.readWord(0xD015);

// Direct access (also works):
var raw = gameboy.memory[0xD22D] & 0xFF;
```

---

## Battle state

| Address | Width | Symbol | Description |
|---|---|---|---|
| `0xD22D` | 1 byte | `wIsInBattle` | `0` = not in battle, `1` = wild encounter, `2` = trainer battle |
| `0xCC5B` | 1 byte | `wBattleMenuCursor` | Root battle-menu cursor: `0`=FIGHT `1`=ITEM `2`=PKMN `3`=RUN |
| `0xCC2B` | 1 byte | `wCurMoveNum` | Highlighted move slot in FIGHT submenu (`0`–`3`) |
| `0xCC8A` | 1 byte | `wJoypadBlock` | Non-zero while the game is processing a script and ignoring joypad input |

---

## Active battle mon (player side)

These values reflect the **currently active** Pokémon sent out in battle, not
necessarily the Pokémon in party slot 1.

| Address | Width | Symbol | Description |
|---|---|---|---|
| `0xD015`–`0xD016` | 2 bytes (BE) | `wPlayerMonHP` | Current HP of the active player mon |
| `0xD023`–`0xD024` | 2 bytes (BE) | `wPlayerMonMaxHP` | Maximum HP of the active player mon |

---

## Active battle mon (enemy side)

| Address | Width | Symbol | Description |
|---|---|---|---|
| `0xCFE6`–`0xCFE7` | 2 bytes (BE) | `wEnemyMonHP` | Current HP of the enemy mon |

---

## Party data — slot 1

Party data in Pokémon Silver is stored in a fixed-layout block.  The values
below cover the first party slot only.  Add the following per-slot offset to
reach subsequent slots (the per-slot struct size is approximately `0x30` bytes;
consult the disassembly for the exact layout).

| Address | Width | Symbol | Description |
|---|---|---|---|
| `0xDCE0`–`0xDCE1` | 2 bytes (BE) | `wPartyMon1HP` | Current HP of party mon 1 |
| `0xDCF9`–`0xDCFA` | 2 bytes (BE) | `wPartyMon1MaxHP` | Maximum HP of party mon 1 |
| `0xDCDF` | 1 byte | `wPartyMon1PP1` | PP remaining for move slot 1 |
| `0xDCDF+1` | 1 byte | `wPartyMon1PP2` | PP remaining for move slot 2 |
| `0xDCDF+2` | 1 byte | `wPartyMon1PP3` | PP remaining for move slot 3 |
| `0xDCDF+3` | 1 byte | `wPartyMon1PP4` | PP remaining for move slot 4 |

---

## Useful overworld / progress addresses

These are not currently used by `agent.js` but are helpful for building more
advanced automation.

| Address | Width | Symbol | Description |
|---|---|---|---|
| `0xD57C` | 1 byte | `wObtainedBadges` | Bitmask of Johto badges obtained (`bit 0` = Zephyr, etc.) |
| `0xD148` | 1 byte | `wMapGroup` | Current map group ID |
| `0xD149` | 1 byte | `wMapNumber` | Current map number within the group |
| `0xD4B1` | 1 byte | `wPlayerMoney` (high) | Player's money, byte 2 of 3 (BCD) |
| `0xD34A` | 1 byte | `wPartyCount` | Number of Pokémon in the player's party (0–6) |

---

## Reading party count and checking party health

```js
// How many party members do we have?
var partySize = PokemonAgent.readByte(0xD34A);

// Is mon 1 still alive?
var mon1HP = PokemonAgent.readWord(PokemonAgent.ADDR.wPartyMon1HP);
console.log("Slot 1 HP:", mon1HP);
```

---

## Adding new addresses

1. Look up the symbol in the [pret/pokegold `constants/wram_constants.asm`](https://github.com/pret/pokegold/blob/master/constants/wram_constants.asm) or the `wram.asm` files.
2. Convert the symbolic bank-relative address to the flat GBC address if needed
   (WRAM bank 0 maps to `0xC000`–`0xCFFF`; WRAM bank 1–7 map to `0xD000`–`0xDFFF`
   with GBC bank switching, but the emulator exposes the switched bank at its
   logical address).
3. Add the constant to the `ADDR` object in `js/agent.js` for use in your
   automation code.
