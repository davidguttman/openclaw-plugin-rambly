/**
 * Rambly response generator — uses the embedded Pi agent for tool support.
 */

import crypto from "node:crypto";
import { loadCoreAgentDeps, type CoreConfig } from "./core-bridge.ts";

export type RamblyResponseParams = {
  coreConfig: CoreConfig;
  roomName: string;
  userMessage: string;
  userName: string;
};

export type RamblyResponseResult = {
  text: string | null;
  error?: string;
};

/**
 * Generate a response using the embedded Pi agent.
 */
export async function generateRamblyResponse(
  params: RamblyResponseParams,
): Promise<RamblyResponseResult> {
  const { coreConfig, roomName, userMessage, userName } = params;

  if (!coreConfig) {
    return { text: null, error: "Core config unavailable" };
  }

  let deps: Awaited<ReturnType<typeof loadCoreAgentDeps>>;
  try {
    deps = await loadCoreAgentDeps();
  } catch (err) {
    return {
      text: null,
      error: err instanceof Error ? err.message : "Unable to load core agent dependencies",
    };
  }

  const cfg = coreConfig;
  const sessionKey = `rambly:room:${roomName}`;
  const agentId = "main";

  const storePath = deps.resolveStorePath(cfg.session?.store, { agentId });
  const agentDir = deps.resolveAgentDir(cfg, agentId);
  const workspaceDir = deps.resolveAgentWorkspaceDir(cfg, agentId);

  await deps.ensureAgentWorkspace({ dir: workspaceDir });

  const sessionStore = deps.loadSessionStore(storePath);
  const now = Date.now();
  let sessionEntry = sessionStore[sessionKey] as { sessionId: string; updatedAt: number } | undefined;

  if (!sessionEntry) {
    sessionEntry = {
      sessionId: crypto.randomUUID(),
      updatedAt: now,
    };
    sessionStore[sessionKey] = sessionEntry;
    await deps.saveSessionStore(storePath, sessionStore);
  }

  const sessionId = sessionEntry.sessionId;
  const sessionFile = deps.resolveSessionFilePath(sessionId, sessionEntry, { agentId });

  const modelRef = `${deps.DEFAULT_PROVIDER}/${deps.DEFAULT_MODEL}`;
  const slashIndex = modelRef.indexOf("/");
  const provider = slashIndex === -1 ? deps.DEFAULT_PROVIDER : modelRef.slice(0, slashIndex);
  const model = slashIndex === -1 ? modelRef : modelRef.slice(slashIndex + 1);

  const thinkLevel = deps.resolveThinkingDefault({ cfg, provider, model });
  const identity = deps.resolveAgentIdentity(cfg, agentId);
  const agentName = identity?.name?.trim() || "Haku";

  const extraSystemPrompt = `You are ${agentName}, in a Rambly spatial voice chat room called "${roomName}". Keep responses brief and conversational (1-3 sentences). Be natural and friendly. ${userName} is speaking to you.`;

  const timeoutMs = deps.resolveAgentTimeoutMs({ cfg });
  const runId = `rambly:${roomName}:${Date.now()}`;

  try {
    const result = await deps.runEmbeddedPiAgent({
      sessionId,
      sessionKey,
      messageProvider: "rambly",
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: `[${userName}]: ${userMessage}`,
      provider,
      model,
      thinkLevel,
      verboseLevel: "off",
      timeoutMs,
      runId,
      lane: "rambly",
      extraSystemPrompt,
      agentDir,
    });

    const texts = (result.payloads ?? [])
      .filter((p) => p.text && !p.isError)
      .map((p) => p.text?.trim())
      .filter(Boolean);

    const text = texts.join(" ") || null;

    if (!text && result.meta?.aborted) {
      return { text: null, error: "Response generation was aborted" };
    }

    return { text };
  } catch (err) {
    return { text: null, error: String(err) };
  }
}
