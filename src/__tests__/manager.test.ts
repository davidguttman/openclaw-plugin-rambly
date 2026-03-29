import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Mock daemon module
vi.mock("../daemon.ts", async () => {
  const { EventEmitter } = await import("node:events");
  class MockDaemon extends EventEmitter {
    spawn = vi.fn().mockResolvedValue(undefined);
    send = vi.fn();
    kill = vi.fn();
  }
  return { RamblyDaemon: MockDaemon };
});

import { RamblyManager } from "../manager.ts";
import { RamblyDaemon } from "../daemon.ts";

function getDaemon(mgr: RamblyManager): any {
  return (mgr as any).daemon;
}

function getState(mgr: RamblyManager): any {
  return (mgr as any).state;
}

describe("RamblyManager", () => {
  let mgr: RamblyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new RamblyManager();
  });

  afterEach(() => {
    // clear any follow intervals
    const interval = (mgr as any).followInterval;
    if (interval) clearInterval(interval);
  });

  describe("initial state", () => {
    it("starts disconnected with default position", () => {
      const state = getState(mgr);
      expect(state.connected).toBe(false);
      expect(state.room).toBeNull();
      expect(state.peerId).toBeNull();
      expect(state.position).toEqual({ x: 250, y: 230 });
      expect(state.peers.size).toBe(0);
      expect(state.followTarget).toBeNull();
      expect(state.pendingTranscripts).toEqual([]);
    });
  });

  describe("join()", () => {
    it("joins a room via daemon", async () => {
      const result = await mgr.join("test-room");
      expect(result).toContain("Joined room");
      expect(result).toContain("test-room");
      const daemon = getDaemon(mgr);
      expect(daemon.spawn).toHaveBeenCalledOnce();
      expect(daemon.send).toHaveBeenCalledWith({ action: "peers" });
    });

    it("returns idempotent message when already in same room", async () => {
      const state = getState(mgr);
      state.connected = true;
      state.room = "test-room";
      const result = await mgr.join("test-room");
      expect(result).toContain("Already in room");
    });

    it("refuses to join different room without leaving", async () => {
      const state = getState(mgr);
      state.connected = true;
      state.room = "room-a";
      const result = await mgr.join("room-b");
      expect(result).toContain("Leave first");
    });

    it("returns error when daemon spawn fails", async () => {
      getDaemon(mgr).spawn.mockRejectedValue(new Error("spawn failed"));
      const result = await mgr.join("test-room");
      expect(result).toContain("Failed to join");
    });
  });

  describe("leave()", () => {
    it("returns message when not connected", async () => {
      const result = await mgr.leave();
      expect(result).toContain("Not connected");
    });

    it("leaves when connected", async () => {
      const state = getState(mgr);
      state.connected = true;
      state.room = "test-room";
      const result = await mgr.leave();
      expect(result).toContain("Left the room");
      expect(getDaemon(mgr).kill).toHaveBeenCalled();
    });
  });

  describe("speak()", () => {
    it("returns error when not connected", async () => {
      const result = await mgr.speak("hello");
      expect(result).toContain("Not connected");
    });

    it("sends speak command when connected", async () => {
      getState(mgr).connected = true;
      const result = await mgr.speak("hello world");
      expect(result).toContain("Speaking");
      expect(getDaemon(mgr).send).toHaveBeenCalledWith({ action: "speak", text: "hello world" });
    });
  });

  describe("move()", () => {
    it("returns error when not connected", async () => {
      const result = await mgr.move(100, 200);
      expect(result).toContain("Not connected");
    });

    it("sends move command when connected", async () => {
      getState(mgr).connected = true;
      const result = await mgr.move(100, 200);
      expect(result).toContain("Moved to");
      expect(getState(mgr).position).toEqual({ x: 100, y: 200 });
    });
  });

  describe("follow()", () => {
    it("returns error when not connected", async () => {
      const result = await mgr.follow("alice");
      expect(result).toContain("Not connected");
    });

    it("returns error when peer not found", async () => {
      getState(mgr).connected = true;
      const result = await mgr.follow("alice");
      expect(result).toContain("No peer named");
    });

    it("starts following a found peer", async () => {
      const state = getState(mgr);
      state.connected = true;
      state.peers.set("p1", { id: "p1", name: "Alice", position: { x: 100, y: 100 } });
      const result = await mgr.follow("Alice");
      expect(result).toContain("Now following");
      expect(state.followTarget).toBe("Alice");
    });
  });

  describe("unfollow()", () => {
    it("returns message when not following", async () => {
      const result = await mgr.unfollow();
      expect(result).toContain("Not following");
    });

    it("stops following", async () => {
      const state = getState(mgr);
      state.followTarget = "Alice";
      const result = await mgr.unfollow();
      expect(result).toContain("Stopped following");
      expect(state.followTarget).toBeNull();
    });
  });

  describe("event handling", () => {
    it("handles peer_join event", () => {
      const daemon = getDaemon(mgr);
      daemon.emit("event", { event: "peer_join", id: "p1", name: "Alice", position: { x: 50, y: 50 } });
      expect(getState(mgr).peers.has("p1")).toBe(true);
      expect(getState(mgr).peers.get("p1").name).toBe("Alice");
    });

    it("handles peer_leave event", () => {
      const state = getState(mgr);
      state.peers.set("p1", { id: "p1", name: "Alice" });
      getDaemon(mgr).emit("event", { event: "peer_leave", id: "p1" });
      expect(state.peers.has("p1")).toBe(false);
    });

    it("handles peer_moved event", () => {
      const state = getState(mgr);
      state.peers.set("p1", { id: "p1", name: "Alice", position: { x: 0, y: 0 } });
      getDaemon(mgr).emit("event", { event: "peer_moved", id: "p1", name: "Alice", position: { x: 100, y: 100 } });
      expect(state.peers.get("p1").position).toEqual({ x: 100, y: 100 });
    });

    it("handles joined event", () => {
      getDaemon(mgr).emit("event", { event: "joined", room: "lobby", peerId: "me" });
      const state = getState(mgr);
      expect(state.connected).toBe(true);
      expect(state.room).toBe("lobby");
      expect(state.peerId).toBe("me");
    });

    it("handles left event", () => {
      const state = getState(mgr);
      state.connected = true;
      state.room = "lobby";
      getDaemon(mgr).emit("event", { event: "left" });
      expect(state.connected).toBe(false);
      expect(state.room).toBeNull();
    });
  });

  describe("transcript handling", () => {
    it("stores transcript from nearby peer", () => {
      const state = getState(mgr);
      state.agentName = "Bot";
      const handler = vi.fn();
      mgr.setTranscriptHandler(handler);
      getDaemon(mgr).emit("event", {
        event: "transcript",
        from: "p1",
        name: "Alice",
        text: "hello",
        position: { x: 250, y: 230 },
      });
      expect(state.pendingTranscripts.length).toBe(1);
      expect(state.pendingTranscripts[0].text).toBe("hello");
      expect(handler).toHaveBeenCalledWith("p1", "Alice", "hello", 0);
    });

    it("ignores own transcripts", () => {
      const state = getState(mgr);
      state.agentName = "Bot";
      const handler = vi.fn();
      mgr.setTranscriptHandler(handler);
      getDaemon(mgr).emit("event", {
        event: "transcript",
        from: "me",
        name: "Bot",
        text: "echo",
        position: { x: 250, y: 230 },
      });
      expect(handler).not.toHaveBeenCalled();
      expect(state.pendingTranscripts.length).toBe(0);
    });

    it("ignores transcripts beyond hearing radius", () => {
      const state = getState(mgr);
      state.agentName = "Bot";
      const handler = vi.fn();
      mgr.setTranscriptHandler(handler);
      // Default hearing radius is 150, place peer far away
      getDaemon(mgr).emit("event", {
        event: "transcript",
        from: "p1",
        name: "Alice",
        text: "far away",
        position: { x: 1000, y: 1000 },
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("utility methods", () => {
    it("clearTranscripts empties the list", () => {
      const state = getState(mgr);
      state.pendingTranscripts.push({ name: "Alice", text: "hi", time: Date.now() });
      mgr.clearTranscripts();
      expect(state.pendingTranscripts.length).toBe(0);
    });

    it("getRoom returns current room", () => {
      expect(mgr.getRoom()).toBeNull();
      getState(mgr).room = "lobby";
      expect(mgr.getRoom()).toBe("lobby");
    });
  });
});
