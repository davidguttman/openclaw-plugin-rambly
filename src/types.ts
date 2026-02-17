// Daemon commands (stdin)
export type DaemonCommand =
  | { action: "speak"; text: string }
  | { action: "move"; x: number; y: number }
  | { action: "peers" }
  | { action: "status" }
  | { action: "leave" };

// Daemon events (stdout)
export type DaemonEvent =
  | { event: "joined"; room: string; peerId: string }
  | { event: "transcript"; from: string; name: string; text: string; position?: { x: number; y: number } }
  | { event: "peer_join"; id: string; name: string; position?: { x: number; y: number } }
  | { event: "peer_leave"; id: string; name?: string }
  | { event: "peer_moved"; id: string; name: string; position?: { x: number; y: number } }
  | { event: "spoke"; text?: string }
  | { event: "moved"; x: number; y: number }
  | { event: "peers"; peers: PeerInfo[] }
  | { event: "status"; room: string; position: { x: number; y: number }; peers: PeerInfo[] }
  | { event: "left" }
  | { event: "error"; message: string };

export interface PeerInfo {
  id: string;
  name: string;
  position?: { x: number; y: number };
}

export interface RamblyState {
  connected: boolean;
  room: string | null;
  peerId: string | null;
  position: { x: number; y: number };
  peers: Map<string, PeerInfo>;
  followTarget: string | null;
  followBreadcrumbs: Array<{ x: number; y: number }>;
}

export interface RamblyPluginConfig {
  hearingRadius: number;
  followDistance: number;
  followStepSize: number;
  daemonCommand: string;
  defaultName: string;
  voice: string;
}

export const DEFAULT_CONFIG: RamblyPluginConfig = {
  hearingRadius: 150,
  followDistance: 40,
  followStepSize: 20,
  daemonCommand: "npx tsx /home/dguttman/play/web/rambly/.worktrees/cli-client/cli/bin/rambly-client.ts",
  defaultName: "Agent",
  voice: "nova",
};
