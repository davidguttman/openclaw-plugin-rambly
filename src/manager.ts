import { RamblyDaemon } from "./daemon.ts";
import type {
  RamblyState,
  RamblyPluginConfig,
  PeerInfo,
  DaemonEvent,
} from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";

export class RamblyManager {
  private daemon: RamblyDaemon;
  private config: RamblyPluginConfig;
  private state: RamblyState;
  private followInterval: ReturnType<typeof setInterval> | null = null;
  private onTranscript: ((from: string, name: string, text: string, distance: number) => void) | null = null;

  constructor(config: Partial<RamblyPluginConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.daemon = new RamblyDaemon();
    this.state = {
      connected: false,
      room: null,
      peerId: null,
      agentName: null,
      position: { x: 250, y: 230 },
      peers: new Map(),
      followTarget: null,
      followBreadcrumbs: [],
      pendingTranscripts: [],
    };

    this.daemon.on("event", (ev: DaemonEvent) => this.handleEvent(ev));
  }

  setTranscriptHandler(handler: (from: string, name: string, text: string, distance: number) => void) {
    this.onTranscript = handler;
  }

  private handleEvent(ev: DaemonEvent) {
    switch (ev.event) {
      case "joined":
        this.state.connected = true;
        this.state.room = ev.room;
        this.state.peerId = ev.peerId;
        break;

      case "peer_join":
        this.state.peers.set(ev.id, { id: ev.id, name: ev.name, position: ev.position });
        break;

      case "peer_moved": {
        const peer = this.state.peers.get(ev.id);
        if (peer && ev.position) {
          peer.position = ev.position;
        }
        // Record breadcrumb if we're following this peer
        if (this.state.followTarget && ev.position) {
          const target = this.findPeerByName(this.state.followTarget);
          if (target && target.id === ev.id) {
            const crumbs = this.state.followBreadcrumbs;
            const lastCrumb = crumbs[crumbs.length - 1];
            if (!lastCrumb || this.distance(lastCrumb, ev.position) > 5) {
              crumbs.push({ ...ev.position });
              if (crumbs.length > 100) crumbs.shift();
            }
          }
        }
        break;
      }

      case "peer_leave":
        this.state.peers.delete(ev.id);
        if (this.state.followTarget) {
          const target = this.findPeerByName(this.state.followTarget);
          if (!target) {
            this.stopFollow();
          }
        }
        break;

      case "peers":
        this.state.peers.clear();
        for (const p of ev.peers) {
          this.state.peers.set(p.id, p);
        }
        break;

      case "status":
        this.state.room = ev.room;
        this.state.position = ev.position;
        this.state.peers.clear();
        for (const p of ev.peers) {
          this.state.peers.set(p.id, p);
        }
        break;

      case "moved":
        this.state.position = { x: ev.x, y: ev.y };
        break;

      case "transcript":
        this.handleTranscript(ev);
        break;

      case "left":
        this.cleanup();
        break;
    }
  }

  private handleTranscript(ev: DaemonEvent & { event: "transcript" }) {
    // Ignore own transcripts (prevents feedback loop)
    if (this.state.agentName && ev.name.toLowerCase() === this.state.agentName.toLowerCase()) {
      return;
    }

    let dist = 0;
    if (ev.position) {
      dist = this.distance(this.state.position, ev.position);
      if (dist > this.config.hearingRadius) {
        // Too far away, ignore
        return;
      }
    }
    
    // Store transcript for later retrieval
    this.state.pendingTranscripts.push({
      name: ev.name,
      text: ev.text,
      time: Date.now(),
    });
    // Keep only last 10 transcripts
    if (this.state.pendingTranscripts.length > 10) {
      this.state.pendingTranscripts.shift();
    }
    
    this.onTranscript?.(ev.from, ev.name, ev.text, Math.round(dist));
  }

  private distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  private findPeerByName(name: string): PeerInfo | undefined {
    for (const peer of this.state.peers.values()) {
      if (peer.name.toLowerCase() === name.toLowerCase()) return peer;
    }
    return undefined;
  }

  // --- Public API ---

  async join(room: string, name?: string): Promise<string> {
    // Idempotent: if already in this room, just return success
    if (this.state.connected && this.state.room === room) {
      return `Already in room "${room}".`;
    }
    if (this.state.connected) {
      return `Already connected to ${this.state.room}. Leave first.`;
    }

    const agentName = name || this.config.defaultName;
    this.state.agentName = agentName;
    try {
      await this.daemon.spawn(room, {
        name: agentName,
        command: this.config.daemonCommand,
        voice: this.config.voice,
      });
      // Request initial peer list
      this.daemon.send({ action: "peers" });
      return `Joined room "${room}" as "${agentName}".`;
    } catch (err: any) {
      return `Failed to join: ${err.message}`;
    }
  }

  async leave(): Promise<string> {
    if (!this.state.connected) {
      return "Not connected to any room.";
    }
    this.stopFollow();
    this.daemon.kill();
    this.cleanup();
    return "Left the room.";
  }

  async speak(text: string): Promise<string> {
    if (!this.state.connected) {
      return "Not connected. Join a room first.";
    }
    this.daemon.send({ action: "speak", text });
    return `Speaking: "${text}"`;
  }

  async move(x: number, y: number): Promise<string> {
    if (!this.state.connected) {
      return "Not connected. Join a room first.";
    }
    this.daemon.send({ action: "move", x, y });
    this.state.position = { x, y };
    return `Moved to (${x}, ${y}).`;
  }

  async follow(name: string): Promise<string> {
    if (!this.state.connected) {
      return "Not connected. Join a room first.";
    }

    const peer = this.findPeerByName(name);
    if (!peer) {
      return `No peer named "${name}" found in the room.`;
    }

    this.state.followTarget = name;
    this.state.followBreadcrumbs = [];

    if (peer.position) {
      this.state.followBreadcrumbs.push({ ...peer.position });
    }

    this.startFollowLoop();
    return `Now following "${name}".`;
  }

  async unfollow(): Promise<string> {
    if (!this.state.followTarget) {
      return "Not following anyone.";
    }
    const was = this.state.followTarget;
    this.stopFollow();
    return `Stopped following "${was}".`;
  }

  async status(): Promise<string> {
    if (!this.state.connected) {
      return "Not connected to any room.";
    }

    // Refresh state from daemon
    this.daemon.send({ action: "status" });
    // Small delay for response
    await new Promise((r) => setTimeout(r, 300));

    const nearbyPeers: string[] = [];
    for (const peer of this.state.peers.values()) {
      if (peer.position) {
        const dist = Math.round(this.distance(this.state.position, peer.position));
        const inRange = dist <= this.config.hearingRadius ? "  [in hearing range]" : "";
        nearbyPeers.push(`  ${peer.name} at (${peer.position.x}, ${peer.position.y}) - ${dist} units away${inRange}`);
      } else {
        nearbyPeers.push(`  ${peer.name} (position unknown)`);
      }
    }

    const lines = [
      `Room: ${this.state.room}`,
      `Position: (${this.state.position.x}, ${this.state.position.y})`,
      `Hearing radius: ${this.config.hearingRadius}`,
      `Following: ${this.state.followTarget || "nobody"}`,
      `Peers (${this.state.peers.size}):`,
      ...nearbyPeers,
    ];

    // Add recent transcripts
    if (this.state.pendingTranscripts.length > 0) {
      lines.push(`Recent transcripts:`);
      for (const t of this.state.pendingTranscripts) {
        lines.push(`  ${t.name}: "${t.text}"`);
      }
    }

    return lines.join("\n");
  }
  
  clearTranscripts(): void {
    this.state.pendingTranscripts = [];
  }
  
  getRoom(): string | null {
    return this.state.room;
  }

  // --- Follow Mode ---

  private startFollowLoop() {
    this.stopFollowLoop();

    this.followInterval = setInterval(() => {
      if (!this.state.followTarget || !this.state.connected) {
        this.stopFollowLoop();
        return;
      }

      const target = this.findPeerByName(this.state.followTarget);
      if (!target?.position) return;

      // Record breadcrumb if target moved
      const crumbs = this.state.followBreadcrumbs;
      const lastCrumb = crumbs[crumbs.length - 1];
      if (!lastCrumb || this.distance(lastCrumb, target.position) > 5) {
        crumbs.push({ ...target.position });
        // Keep breadcrumb trail manageable
        if (crumbs.length > 100) crumbs.shift();
      }

      const dist = this.distance(this.state.position, target.position);

      // Already close enough - stop walking animation
      if (dist <= this.config.followDistance) {
        // Send step=0 to stop walking animation
        this.daemon.send({ action: "move", x: this.state.position.x, y: this.state.position.y, step: 0 });
        return;
      }

      // Move toward the oldest breadcrumb we haven't reached yet
      let nextPoint = crumbs[0] || target.position;

      // Pop breadcrumbs we've already reached
      while (crumbs.length > 1 && this.distance(this.state.position, crumbs[0]) < this.config.followStepSize) {
        crumbs.shift();
        nextPoint = crumbs[0] || target.position;
      }

      // Step toward next point
      const dx = nextPoint.x - this.state.position.x;
      const dy = nextPoint.y - this.state.position.y;
      const stepDist = Math.sqrt(dx * dx + dy * dy);

      if (stepDist < 1) return;

      // Calculate theta (angle pointing toward target)
      const theta = Math.atan2(dy, dx);
      
      const stepSize = Math.min(this.config.followStepSize, stepDist);
      const nx = Math.round(this.state.position.x + (dx / stepDist) * stepSize);
      const ny = Math.round(this.state.position.y + (dy / stepDist) * stepSize);

      // Send move with theta and step=1 for walking animation
      this.daemon.send({ action: "move", x: nx, y: ny, theta, step: 1 });
      this.state.position = { x: nx, y: ny };
    }, 100); // Faster updates (100ms instead of 500ms)
  }

  private stopFollowLoop() {
    if (this.followInterval) {
      clearInterval(this.followInterval);
      this.followInterval = null;
    }
  }

  private stopFollow() {
    this.state.followTarget = null;
    this.state.followBreadcrumbs = [];
    this.stopFollowLoop();
  }

  private cleanup() {
    this.stopFollow();
    this.state.connected = false;
    this.state.room = null;
    this.state.peerId = null;
    this.state.peers.clear();
  }
}
