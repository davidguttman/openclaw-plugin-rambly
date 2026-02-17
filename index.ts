import { execSync } from "node:child_process";
import { RamblyManager } from "./src/manager.ts";
import type { RamblyPluginConfig } from "./src/types.ts";

// Voice command patterns
const COMMANDS = {
  followMe: /^(?:follow me|come here|come with me|follow|come)$/i,
  followName: /^follow\s+(\w+)$/i,
  stopFollow: /^(?:stop following|unfollow|stop|stay here|stay)$/i,
  leave: /^(?:leave|go away|bye|goodbye|disconnect)$/i,
};

export default {
  id: "rambly",
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
    const pluginConfig: Partial<RamblyPluginConfig> = api.config?.plugins?.entries?.rambly?.config || {};
    const manager = new RamblyManager(pluginConfig);
    const logger = api.logger;
    
    let responding = false;

    // Try to handle voice command, returns response text if handled
    async function handleVoiceCommand(speakerName: string, text: string): Promise<string | null> {
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
        return null; // Don't speak after leaving
      }
      
      return null; // Not a command
    }

    // Transcript handler with voice commands
    manager.setTranscriptHandler((from, name, text, distance) => {
      logger?.info(`[Rambly] Heard: ${name}: "${text}"`);
      
      if (responding) {
        logger?.info(`[Rambly] Skipping (already responding)`);
        return;
      }
      
      responding = true;
      
      const roomName = manager.getRoom();
      if (!roomName) {
        responding = false;
        return;
      }

      // Try voice command first
      handleVoiceCommand(name, text).then(async (cmdResponse) => {
        if (cmdResponse !== null) {
          // Command was handled
          if (cmdResponse) {
            logger?.info(`[Rambly] Command response: "${cmdResponse}"`);
            await manager.speak(cmdResponse);
          }
          return;
        }
        
        // Not a command - generate chat response
        const prompt = `[Rambly voice chat, room: ${roomName}] ${name} says: "${text}". Respond briefly (1-2 sentences) as if speaking aloud. Do not use markdown or formatting.`;
        
        try {
          logger?.info(`[Rambly] Getting agent response...`);
          const response = execSync(
            `openclaw agent --message "${prompt.replace(/"/g, '\\"')}" --no-deliver 2>/dev/null`,
            { encoding: 'utf8', timeout: 30000 }
          ).trim();
          
          if (response) {
            logger?.info(`[Rambly] Speaking: "${response}"`);
            await manager.speak(response);
          }
        } catch (err) {
          logger?.error(`[Rambly] Agent call failed: ${err}`);
        }
      }).catch(err => {
        logger?.error(`[Rambly] Command failed: ${err}`);
      }).finally(() => {
        responding = false;
      });
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
