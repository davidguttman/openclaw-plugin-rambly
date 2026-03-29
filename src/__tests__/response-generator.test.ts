import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDeps = vi.hoisted(() => ({
  resolveStorePath: vi.fn().mockReturnValue("/tmp/store"),
  resolveAgentDir: vi.fn().mockReturnValue("/tmp/agent"),
  resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/tmp/workspace"),
  ensureAgentWorkspace: vi.fn().mockResolvedValue(undefined),
  loadSessionStore: vi.fn().mockReturnValue({}),
  saveSessionStore: vi.fn().mockResolvedValue(undefined),
  resolveSessionFilePath: vi.fn().mockReturnValue("/tmp/session.json"),
  resolveAgentIdentity: vi.fn().mockReturnValue({ name: "TestBot" }),
  resolveThinkingDefault: vi.fn().mockReturnValue("off"),
  resolveAgentTimeoutMs: vi.fn().mockReturnValue(30000),
  runEmbeddedPiAgent: vi.fn().mockResolvedValue({
    payloads: [{ text: "Hello there!", isError: false }],
    meta: {},
  }),
  DEFAULT_MODEL: "test-model",
  DEFAULT_PROVIDER: "test-provider",
}));

vi.mock("../core-bridge.ts", () => ({
  loadCoreAgentDeps: vi.fn().mockResolvedValue(mockDeps),
}));

import { generateRamblyResponse } from "../response-generator.ts";
import type { RamblyResponseParams } from "../response-generator.ts";
import { loadCoreAgentDeps } from "../core-bridge.ts";

const baseCoreConfig = { session: { store: "/tmp" } };

function makeParams(overrides: Partial<RamblyResponseParams> = {}): RamblyResponseParams {
  return {
    coreConfig: baseCoreConfig as any,
    roomName: "test-room",
    userMessage: "hello",
    userName: "Alice",
    ...overrides,
  };
}

describe("generateRamblyResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeps.runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: "Hello there!", isError: false }],
      meta: {},
    });
    (loadCoreAgentDeps as any).mockResolvedValue(mockDeps);
  });

  it("returns error when coreConfig is falsy", async () => {
    const result = await generateRamblyResponse(makeParams({ coreConfig: null as any }));
    expect(result.text).toBeNull();
    expect(result.error).toContain("Core config unavailable");
  });

  it("returns error when loadCoreAgentDeps throws", async () => {
    (loadCoreAgentDeps as any).mockRejectedValue(new Error("deps failed"));
    const result = await generateRamblyResponse(makeParams());
    expect(result.text).toBeNull();
    expect(result.error).toContain("deps failed");
  });

  it("returns text from successful agent run", async () => {
    const result = await generateRamblyResponse(makeParams());
    expect(result.text).toBe("Hello there!");
    expect(result.error).toBeUndefined();
  });

  it("returns null text when agent returns empty payloads", async () => {
    mockDeps.runEmbeddedPiAgent.mockResolvedValue({ payloads: [], meta: {} });
    const result = await generateRamblyResponse(makeParams());
    expect(result.text).toBeNull();
  });

  it("returns error when response is aborted with no text", async () => {
    mockDeps.runEmbeddedPiAgent.mockResolvedValue({
      payloads: [],
      meta: { aborted: true },
    });
    const result = await generateRamblyResponse(makeParams());
    expect(result.text).toBeNull();
    expect(result.error).toContain("aborted");
  });

  it("filters out error payloads", async () => {
    mockDeps.runEmbeddedPiAgent.mockResolvedValue({
      payloads: [
        { text: "good", isError: false },
        { text: "bad", isError: true },
        { text: "also good", isError: false },
      ],
      meta: {},
    });
    const result = await generateRamblyResponse(makeParams());
    expect(result.text).toBe("good also good");
  });

  it("passes room and user info in system prompt", async () => {
    await generateRamblyResponse(makeParams({ roomName: "lobby", userName: "Bob" }));
    const call = mockDeps.runEmbeddedPiAgent.mock.calls[0][0];
    expect(call.extraSystemPrompt).toContain("lobby");
    expect(call.extraSystemPrompt).toContain("Bob");
    expect(call.prompt).toContain("[Bob]");
  });
});
