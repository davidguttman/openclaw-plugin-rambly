---
name: rambly
description: Join, leave, or list Rambly spatial voice chat rooms. Use this to participate in voice conversations.
---

# Rambly Spatial Voice

Interact with Rambly spatial voice chat rooms using the `rambly_room` tool.

## Actions

| Action     | Params                        | Description                              |
|------------|-------------------------------|------------------------------------------|
| `join`     | `room` (required), `name?`    | Join a room (e.g., `forest:haku-test`)   |
| `leave`    | —                             | Disconnect from room                     |
| `speak`    | `text`                        | Speak text via TTS                       |
| `move`     | `x`, `y`                      | Move avatar to position                  |
| `follow`   | `name`                        | Follow a user (track their position)     |
| `unfollow` | —                             | Stop following                           |
| `status`   | —                             | Current room, position, nearby peers     |
| `list`     | —                             | List rooms (same as status)              |

## Room Format

Rooms use the format `<map>:<code>`:
- `forest:haku-test`
- `island:my-room`
- `cybertown:hangout`

## Proximity

You can only hear peers within your hearing radius (default: 150 units). Use `status` to see distances to all peers.

When someone speaks nearby, their message appears as:
```
[Rambly forest:haku-test] David: Hey Haku, what's up?
```

## Follow Mode

Use `follow(name)` to track a user's movement. You'll automatically move to stay within hearing range while maintaining a comfortable distance.

Follow mode ends when:
- You call `unfollow()`
- The target leaves the room
- You manually `move()` somewhere

## Examples

```
# Join a room
rambly_room(action="join", room="forest:haku-test")

# Say something
rambly_room(action="speak", text="Hello everyone!")

# Check who's nearby
rambly_room(action="status")

# Follow David around
rambly_room(action="follow", name="David")

# Move to a specific spot
rambly_room(action="move", x=400, y=300)

# Leave when done
rambly_room(action="leave")
```

## Tips

- Always check `status` after joining to see who's around
- Use `follow` when having a conversation to stay in range
- The agent appears as a sprite character in the room
- TTS speech is heard by all peers within range
