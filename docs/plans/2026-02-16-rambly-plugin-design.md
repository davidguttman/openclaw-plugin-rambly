# OpenClaw Plugin: Rambly Spatial Voice

**Date:** 2026-02-16  
**Status:** Approved

## Goal

Create an OpenClaw plugin that lets the agent join Rambly spatial voice rooms, speak via TTS, and listen/respond to nearby users.

---

## Part 1: Daemon Enhancements

Changes to existing CLI client at `/home/dguttman/play/web/rambly/.worktrees/cli-client/cli/`

### 1.1 Add position to existing events

**peer_join:**
```json
{"event":"peer_join", "id":"abc", "name":"David", "x":200, "y":150}
```

**transcript:**
```json
{"event":"transcript", "from":"abc", "name":"David", "text":"Hey", "x":200, "y":150}
```

### 1.2 Add new peer_moved event

Emitted when a peer's position changes (from presence updates):
```json
{"event":"peer_moved", "id":"abc", "name":"David", "x":210, "y":160}
```

Debounce: emit only when position changes by >5 units, or max every 500ms per peer.

### 1.3 Add status action

Request:
```json
{"action":"status"}
```

Response:
```json
{"event":"status", "room":"forest:haku-test", "x":750, "y":333, "peers":[{"id":"abc", "name":"David", "x":200, "y":150}]}
```

### 1.4 Add voice flag

Add `--voice <voice>` flag to daemon command for TTS voice selection (alloy/echo/fable/onyx/nova/shimmer).

---

## Part 2: Plugin Architecture

```
~/play/js/openclaw-plugin-rambly/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Plugin entry, exports tools + config schema
│   ├── daemon.ts         # Spawns/manages rambly-client daemon process
│   ├── tools.ts          # rambly_room tool implementation
│   ├── proximity.ts      # Distance calc, hearing radius filter
│   ├── follow.ts         # Follow mode logic (path tracking)
│   └── types.ts
└── skills/
    └── rambly/
        └── SKILL.md      # Agent skill doc
```

### 2.1 Daemon management (daemon.ts)

- Spawns `npx tsx bin/rambly-client.ts daemon <room> --name <name> --voice <voice> --json`
- JSON-lines communication over stdin/stdout
- Auto-reconnects on crash
- One daemon per room (multiple rooms = multiple daemons)
- Cleans up on leave or plugin shutdown

### 2.2 State tracked in plugin

- Current room, agent position
- Peer map: `{id, name, x, y, lastSeen}`
- Follow target (if any)
- Path history for follow mode

### 2.3 Config schema

```ts
{
  hearingRadius: 150,        // units - only hear peers within this distance
  defaultName: "Haku",       // display name in room
  defaultCharacter: "king",  // sprite character
  followDistance: 50,        // stay this far from follow target
  followStepSize: 20,        // max units per move when following
  voice: "nova",             // OpenAI TTS voice
}
```

---

## Part 3: Tool Definition

Tool name: `rambly_room`

| Action     | Params                        | Returns                                           |
|------------|-------------------------------|---------------------------------------------------|
| `join`     | `room` (required), `name?`, `character?` | `{ok, room, x, y}`                     |
| `leave`    | —                             | `{ok}`                                            |
| `speak`    | `text`                        | `{ok, text}` (after spoke event)                  |
| `move`     | `x`, `y`                      | `{ok, x, y}`                                      |
| `follow`   | `name`                        | `{ok, target, x, y}` or `{error}` if not found    |
| `unfollow` | —                             | `{ok}`                                            |
| `status`   | —                             | `{room, x, y, peers: [{name, x, y, distance}], following?}` |
| `list`     | —                             | `{rooms: [...]}` (available/known rooms)          |

### Behavior notes

- **join**: If already in a room, leaves first. Spawns daemon, waits for `joined` event.
- **speak**: Blocks until `spoke` event (so agent knows when speech finished).
- **follow**: Starts tracking target. Movement happens automatically in background.
- **status**: Returns current state including distances to all peers.

### Error cases

- `join` with invalid room format → error
- `speak` when not in room → error  
- `follow` when target not in room → error with list of available peers

---

## Part 4: Proximity Logic

### 4.1 Hearing radius filter

- Agent has configurable `hearingRadius` (default 150 units)
- When `transcript` event arrives, calculate distance to speaker
- Only inject transcription if `distance <= hearingRadius`
- Ignored transcriptions are silently dropped

### 4.2 Distance calculation

```ts
distance = Math.sqrt((peer.x - agent.x) ** 2 + (peer.y - agent.y) ** 2)
```

### 4.3 Injection format

Simple format (no distance shown):
```
[Rambly forest:haku-test] David: Hey Haku, what's up?
```

Distance is available via `status` action if agent needs it.

### 4.4 Edge case

If agent moves while someone is talking, use position at time of transcription (captured in event).

---

## Part 5: Follow Mode

### 5.1 Core behavior

- `follow(name)` starts tracking a peer
- Agent moves toward target, staying within hearing range but not too close
- Target zone: `followDistance` (50) to `hearingRadius` (150) units from target

### 5.2 Path tracking (collision-safe)

- Record target's position history as breadcrumbs: `[{x, y, timestamp}, ...]`
- Agent follows the breadcrumb trail, not direct line to target
- This ensures agent walks where target walked (avoiding obstacles)
- Clear old breadcrumbs once agent passes them

### 5.3 Movement cadence

- On each `peer_moved` event for target, append to breadcrumbs
- Every 500ms, if agent has breadcrumbs to follow:
  - Move toward oldest unvisited breadcrumb
  - Step size: `followStepSize` (20 units) per move
  - Once within `followDistance` of target's current position, stop moving

### 5.4 Stopping conditions

- `unfollow()` called
- Target leaves room (`peer_leave`)
- Agent explicitly moves (`move` action) — cancels follow

### 5.5 Edge case

If target teleports (position jumps >200 units), clear breadcrumbs and move directly (they probably used a portal).

---

## Part 6: Event Injection

### 6.1 Transcriptions → Agent session

- Nearby transcriptions inject as user messages into current session
- Format: `[Rambly forest:haku-test] David: Hey Haku, what's up?`
- Uses OpenClaw's session injection API

### 6.2 Agent responses

Agent explicitly uses `rambly_room(action="speak", text="...")` to talk. No auto-speak magic.

### 6.3 Other events

- `peer_join`/`peer_leave` — not injected (avoid noise)
- Available via `status` if agent wants to check

### 6.4 Session context

Plugin can add room context: "You are in Rambly room forest:haku-test at position (750, 333). Nearby: David (32 units away)."

Updated on join, move, and periodically.

---

## Implementation Order

1. **Daemon enhancements** (Part 1) — changes to rambly CLI client
2. **Plugin skeleton** (Part 2) — project setup, config schema, daemon spawn
3. **Core tools** (Part 3) — join/leave/speak/move/status
4. **Proximity** (Part 4) — hearing radius, transcription injection
5. **Follow mode** (Part 5) — path tracking, auto-movement
6. **Skill doc** — SKILL.md for agent usage

---

## References

- CLI client: `/home/dguttman/play/web/rambly/.worktrees/cli-client/cli/`
- Voice Call plugin pattern: https://docs.openclaw.ai/plugins/voice-call
- OpenClaw plugin docs: https://docs.openclaw.ai/plugins
