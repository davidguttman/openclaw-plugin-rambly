import { describe, it, expect, vi, beforeEach } from "vitest";

describe("core-bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENCLAW_ROOT;
  });

  it("loadCoreAgentDeps throws when extensionAPI.js is missing", async () => {
    process.env.OPENCLAW_ROOT = "/tmp/fake-openclaw";
    const { loadCoreAgentDeps } = await import("../core-bridge.ts");
    await expect(loadCoreAgentDeps()).rejects.toThrow(/Missing core module/);
  });

  it("loadCoreAgentDeps returns consistent results on repeated calls", async () => {
    process.env.OPENCLAW_ROOT = "/tmp/fake-openclaw";
    const { loadCoreAgentDeps } = await import("../core-bridge.ts");
    const [r1, r2] = await Promise.allSettled([loadCoreAgentDeps(), loadCoreAgentDeps()]);
    expect(r1.status).toBe("rejected");
    expect(r2.status).toBe("rejected");
    if (r1.status === "rejected" && r2.status === "rejected") {
      expect(r1.reason.message).toBe(r2.reason.message);
    }
  });

  it("uses OPENCLAW_ROOT env when set", async () => {
    const testRoot = "/tmp/test-openclaw-root";
    process.env.OPENCLAW_ROOT = testRoot;
    const { loadCoreAgentDeps } = await import("../core-bridge.ts");
    const result = await loadCoreAgentDeps().catch((e) => e);
    expect(result.message).toContain(testRoot);
  });
});
