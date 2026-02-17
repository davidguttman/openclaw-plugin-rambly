import { RamblyManager } from "./src/manager.ts";
import type { RamblyPluginConfig } from "./src/types.ts";

export default {
  id: "rambly",
  name: "Rambly Spatial Voice",

  configSchema: {
    type: "object",
    properties: {
      hearingRadius: {
        type: "number",
        default: 150,
        description: "Distance (in map units) within which the agent can hear peer speech",
      },
      followDistance: {
        type: "number",
        default: 40,
        description: "How close the agent stops when following a peer",
      },
      followStepSize: {
        type: "number",
        default: 20,
        description: "How many units the agent moves per follow tick",
      },
      daemonCommand: {
        type: "string",
        default: "npx tsx /home/dguttman/play/web/rambly/.worktrees/cli-client/cli/bin/rambly-client.ts",
        description: "Command to spawn the rambly-client daemon",
      },
      defaultName: {
        type: "string",
        default: "Agent",
        description: "Default display name when joining a room",
      },
    },
  },

  register(api: any) {
    const pluginConfig: Partial<RamblyPluginConfig> = api.config?.plugins?.entries?.rambly?.config || {};
    const manager = new RamblyManager(pluginConfig);

    // Wire up transcript handler to inject messages into agent
    manager.setTranscriptHandler((from, name, text, distance) => {
      const distLabel = distance > 0 ? ` (${distance} units away)` : "";
      const prompt = `[Rambly] ${name}${distLabel}: ${text}`;

      // Use gateway method to inject as user context if available,
      // otherwise the transcript is available via status
      if (api.runEmbeddedPiAgent) {
        api.runEmbeddedPiAgent({
          prompt,
          timeoutMs: 30000,
        }).catch(() => {
          // Agent invocation failed, transcript still logged
        });
      }
    });

    // Register the rambly_room tool
    api.registerTool(
      {
        name: "rambly_room",
        description: [
          "Interact with Rambly spatial voice chat rooms.",
          "Actions: join, leave, speak, move, follow, unfollow, status, list.",
          "Join a room to speak via TTS and hear nearby peers.",
          "Use follow to track a user's position. Proximity determines what you can hear.",
        ].join(" "),
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["join", "leave", "speak", "move", "follow", "unfollow", "status", "list"],
              description: "The action to perform",
            },
            room: {
              type: "string",
              description: "Room to join (e.g. forest:my-room). Required for 'join'.",
            },
            name: {
              type: "string",
              description: "Display name when joining. Optional for 'join', required for 'follow'.",
            },
            text: {
              type: "string",
              description: "Text to speak via TTS. Required for 'speak'.",
            },
            x: {
              type: "number",
              description: "X coordinate. Required for 'move'.",
            },
            y: {
              type: "number",
              description: "Y coordinate. Required for 'move'.",
            },
          },
          required: ["action"],
        },
        async execute(_id: string, params: any) {
          let result: string;

          switch (params.action) {
            case "join":
              if (!params.room) {
                result = "Error: 'room' parameter is required for join (e.g. forest:my-room).";
              } else {
                result = await manager.join(params.room, params.name);
              }
              break;

            case "leave":
              result = await manager.leave();
              break;

            case "speak":
              if (!params.text) {
                result = "Error: 'text' parameter is required for speak.";
              } else {
                result = await manager.speak(params.text);
              }
              break;

            case "move":
              if (params.x == null || params.y == null) {
                result = "Error: 'x' and 'y' parameters are required for move.";
              } else {
                result = await manager.move(params.x, params.y);
              }
              break;

            case "follow":
              if (!params.name) {
                result = "Error: 'name' parameter is required for follow.";
              } else {
                result = await manager.follow(params.name);
              }
              break;

            case "unfollow":
              result = await manager.unfollow();
              break;

            case "status":
            case "list":
              result = await manager.status();
              break;

            default:
              result = `Unknown action: ${params.action}. Use: join, leave, speak, move, follow, unfollow, status, list.`;
          }

          return { content: [{ type: "text", text: result }] };
        },
      },
      { optional: false },
    );

    // Register cleanup service
    api.registerService({
      id: "rambly-lifecycle",
      name: "Rambly Lifecycle",
      async start() {
        // Nothing to start proactively - daemon starts on join
      },
      async stop() {
        await manager.leave();
      },
    });
  },
};
