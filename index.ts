import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RamblyManager } from "./src/manager.ts";
import type { RamblyPluginConfig } from "./src/types.ts";

// Voice command patterns
const COMMANDS = {
  followMe: /^(?:follow me|come here|come with me|follow|come)$/i,
  followName: /^follow\s+(\w+)$/i,
  stopFollow: /^(?:stop following|unfollow|stop|stay here|stay)$/i,
  leave: /^(?:leave|go away|bye|goodbye|disconnect)$/i,
};

const execFileAsync = promisify(execFile);
const DEFAULT_AGENT_ID = "main";
const PLUGIN_ID = "openclaw-plugin-rambly";

export default {
  id: PLUGIN_ID,
  name: "Rambly Spatial Voice",

  configSchema: {
    type: "object",
    properties: {
      hearingRadius: { type: "number", default: 150 },
      followDistance: { type: "number", default: 40 },
      followStepSize: { type: "number", default: 20 },
      daemonCommand: {
        type: "string",
        default: "npx tsx /home/dguttman/play/web/rambly/.worktrees/cli-client/cli/bin/rambly-client.ts",
      },
      defaultName: { type: "string", default: "Agent" },
      voice: { type: "string", default: "nova" },
    },
  },

  register(api: any) {
    const pluginEntries = api.config?.plugins?.entries || {};
    const pluginConfig: Partial<RamblyPluginConfig> =
      pluginEntries[PLUGIN_ID]?.config || pluginEntries.rambly?.config || {};
    const manager = new RamblyManager(pluginConfig);
    const logger = api.logger;
    
    type TranscriptItem = {
      name: string;
      text: string;
      roomName: string;
    };

    const transcriptQueue: TranscriptItem[] = [];
    let processingQueue = false;

    manager.setErrorHandler((err) => {
      logger?.error(`[Rambly] Daemon error: ${err.message}`);
    });

    // Try to handle voice command, returns response text if handled
    async function handleVoiceCommand(speakerName: string, text: string): Promise<string | undefined> {
      const trimmed = text.trim();
      
      // "follow me" or "come here"
      if (COMMANDS.followMe.test(trimmed)) {
        const result = await manager.follow(speakerName);
        if (result.startsWith("Now following")) {
          return "On my way!";
        }
        return result;
      }
      
      // "follow [name]"
      const followMatch = trimmed.match(COMMANDS.followName);
      if (followMatch) {
        const targetName = followMatch[1];
        if (targetName.toLowerCase() !== "me") {
          const result = await manager.follow(targetName);
          if (result.startsWith("Now following")) {
            return `Following ${targetName}.`;
          }
          return result;
        }
      }
      
      // "stop following" or "stay"
      if (COMMANDS.stopFollow.test(trimmed)) {
        const result = await manager.unfollow();
        if (result.startsWith("Stopped following")) {
          return "Okay, I'll stay here.";
        } else if (result === "Not following anyone.") {
          return "I wasn't following anyone.";
        }
        return result;
      }
      
      // "leave" or "go away"
      if (COMMANDS.leave.test(trimmed)) {
        await manager.speak("Goodbye!");
        await new Promise(r => setTimeout(r, 1500)); // Let TTS finish
        await manager.leave();
        return ""; // Don't speak after leaving, but treat as handled
      }
      
      return undefined; // Not a command
    }

    async function processQueue() {
      if (processingQueue) return;
      processingQueue = true;
      try {
        while (transcriptQueue.length > 0) {
          const item = transcriptQueue.shift()!;
          const currentRoom = manager.getRoom();
          if (!currentRoom || currentRoom !== item.roomName) {
            if (!currentRoom) {
              transcriptQueue.length = 0;
            }
            continue;
          }

          const { name, text, roomName } = item;
          const cmdResponse = await handleVoiceCommand(name, text);
          if (cmdResponse !== undefined) {
            if (cmdResponse) {
              logger?.info(`[Rambly] Command response: "${cmdResponse}"`);
              await manager.speak(cmdResponse);
            }
          } else {
            const prompt = `[Rambly voice chat, room: ${roomName}] ${name} says: "${text}". Respond briefly (1-2 sentences) as if speaking aloud. Do not use markdown or formatting. respond using the rambly_room tool speak command.`;

            try {
              logger?.info(`[Rambly] Getting agent response...`);
              const sessionId = `agent:${DEFAULT_AGENT_ID}:rambly:room:${roomName}`;
              await execFileAsync(
                "openclaw",
                ["agent", "--session-id", sessionId, "--message", prompt],
                { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
              );
            } catch (err) {
              logger?.error(`[Rambly] Agent call failed: ${err}`);
            }
          }

          if (!manager.getRoom()) {
            transcriptQueue.length = 0;
            break;
          }
        }
      } catch (err) {
        logger?.error(`[Rambly] Queue processing failed: ${err}`);
      } finally {
        processingQueue = false;
        if (transcriptQueue.length > 0) {
          void processQueue();
        }
      }
    }

    // Transcript handler with voice commands
    manager.setTranscriptHandler((_from, name, text, _distance) => {
      logger?.info(`[Rambly] Heard: ${name}: "${text}"`);
      const roomName = manager.getRoom();
      if (!roomName) {
        return;
      }
      transcriptQueue.push({ name, text, roomName });
      void processQueue();
    });

    // Register tool
    api.registerTool(
      {
        name: "rambly_room",
        description: "Interact with Rambly spatial voice chat rooms. Actions: join, leave, speak, move, follow, unfollow, status, list.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["join", "leave", "speak", "move", "follow", "unfollow", "status", "list"] },
            room: { type: "string" },
            name: { type: "string" },
            text: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["action"],
        },
        async execute(_id: string, params: any) {
          let result: string;
          switch (params.action) {
            case "join":
              result = params.room ? await manager.join(params.room, params.name) : "Error: room required";
              break;
            case "leave":
              result = await manager.leave();
              break;
            case "speak":
              result = params.text ? await manager.speak(params.text) : "Error: text required";
              break;
            case "move":
              result = (params.x != null && params.y != null) ? await manager.move(params.x, params.y) : "Error: x,y required";
              break;
            case "follow":
              result = params.name ? await manager.follow(params.name) : "Error: name required";
              break;
            case "unfollow":
              result = await manager.unfollow();
              break;
            case "status":
            case "list":
              result = await manager.status();
              break;
            default:
              result = `Unknown action: ${params.action}`;
          }
          return { content: [{ type: "text", text: result }] };
        },
      },
      { optional: false },
    );

    api.registerService({
      id: "rambly-lifecycle",
      name: "Rambly Lifecycle",
      async start() {},
      async stop() { await manager.leave(); },
    });
  },
};
