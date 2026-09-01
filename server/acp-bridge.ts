import { spawn } from "node:child_process";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Connect, Plugin } from "vite";
import {
  buildAgentPrompt,
  cleanAgentAnswer,
  type AgentMode,
} from "../shared/agent-experience";
import type { AgentStreamEvent } from "../shared/streaming";

export type ProviderId = "codex" | "claude";
const providers = {
  codex: {
    label: "Codex",
    binary: "codex-acp",
    model: "gpt-5.6-sol",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
      { id: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
      { id: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    ],
  },
  claude: {
    label: "Claude Code",
    binary: "claude-agent-acp",
    model: "sonnet",
    models: [
      { id: "sonnet", label: "Sonnet 5" },
      { id: "claude-fable-5[1m]", label: "Fable 5" },
      { id: "opus", label: "Opus 5" },
      { id: "haiku", label: "Haiku 4.5" },
    ],
  },
};

export const agentProviders = () =>
  (
    Object.entries(providers) as Array<
      [ProviderId, (typeof providers)[ProviderId]]
    >
  ).map(([id, provider]) => ({
    id,
    label: provider.label,
    model: provider.model,
    models: provider.models,
  }));

export function aeokitMcpServer(apiUrl: string, token: string) {
  const normalized = apiUrl.trim().replace(/\/+$/, "");
  const base = normalized.startsWith("/")
    ? `http://127.0.0.1:3000${normalized}`
    : normalized;
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("Invalid AeoKit MCP URL");
  return {
    url: `${base}/mcp`,
    headers: [
      { name: "Accept", value: "application/json, text/event-stream" },
      ...(token ? [{ name: "Authorization", value: `Bearer ${token}` }] : []),
    ],
  };
}

const binaryPath = (name: string) =>
  path.join(process.cwd(), "node_modules", ".bin", name);

function adapterSpawn(providerId: ProviderId) {
  if (process.env.AEOKIT_AGENT_ELECTRON === "1") {
    const root = (process.env.AEOKIT_AGENT_APP_ROOT || process.cwd()).replace(
      "app.asar",
      "app.asar.unpacked",
    );
    const packageName =
      providerId === "codex" ? "codex-acp" : "claude-agent-acp";
    return {
      command: process.execPath,
      args: [
        path.join(
          root,
          "node_modules",
          "@agentclientprotocol",
          packageName,
          "dist",
          "index.js",
        ),
      ],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return {
    command: binaryPath(providers[providerId].binary),
    args: [] as string[],
    env: { ...process.env },
  };
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Request is too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function localOrigin(req: Connect.IncomingMessage) {
  if (!req.headers.origin) return true;
  try {
    return ["127.0.0.1", "localhost"].includes(
      new URL(req.headers.origin).hostname,
    );
  } catch {
    return false;
  }
}

function systemPrompt(
  project: string,
  history: Array<{ role: string; content: string }>,
  prompt: string,
  mode?: AgentMode,
) {
  return buildAgentPrompt({ context: project, history, prompt, mode });
}

export async function runAcpTurn(
  providerId: ProviderId,
  model: string,
  prompt: string,
  signal: AbortSignal,
  onEvent?: (event: AgentStreamEvent) => void,
  options?: {
    mcpServer?: {
      url: string;
      headers: Array<{ name: string; value: string }>;
    };
    onPermission?: (request: {
      id: string;
      toolCallId: string;
      title: string;
      name: string;
      input?: unknown;
      options: Array<{
        optionId: string;
        name: string;
        kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
      }>;
    }) => Promise<string | undefined>;
  },
) {
  onEvent?.({
    type: "activity",
    label: `Connecting to ${providers[providerId].label}`,
  });
  const adapter = adapterSpawn(providerId);
  const child = spawn(adapter.command, adapter.args, {
    cwd: process.cwd(),
    env: adapter.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-8_000);
  });
  const stop = () => child.kill("SIGTERM");
  signal.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(stop, 300_000);
  try {
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    return await acp
      .client({ name: "aeokit-agent" })
      .onRequest(
        acp.methods.client.session.requestPermission,
        async ({ params }) => {
          const reject =
            params.options.find((option) => option.kind === "reject_once")
              ?.optionId ?? params.options.at(-1)?.optionId;
          if (!options?.onPermission)
            return reject
              ? { outcome: { outcome: "selected" as const, optionId: reject } }
              : { outcome: { outcome: "cancelled" as const } };
          const id = crypto.randomUUID();
          const selected = await options.onPermission({
            id,
            toolCallId: params.toolCall.toolCallId,
            title: params.toolCall.title || "AeoKit action",
            name: params.toolCall.name || params.toolCall.kind || "tool",
            ...(params.toolCall.rawInput !== undefined
              ? { input: params.toolCall.rawInput }
              : {}),
            options: params.options,
          });
          return selected
            ? {
                outcome: {
                  outcome: "selected" as const,
                  optionId: selected,
                },
              }
            : { outcome: { outcome: "cancelled" as const } };
        },
      )
      .onRequest(acp.methods.client.fs.readTextFile, () => {
        throw new Error("File access is disabled");
      })
      .onRequest(acp.methods.client.fs.writeTextFile, () => {
        throw new Error("File access is disabled");
      })
      .connectWith(stream, async (context) => {
        await context.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
          },
        });
        onEvent?.({ type: "activity", label: "Starting a local ACP session" });
        let sessionBuilder = context.buildSession(process.cwd());
        if (options?.mcpServer)
          sessionBuilder = sessionBuilder.withMcpServer({
            type: "http",
            name: "aeokit",
            url: options.mcpServer.url,
            headers: options.mcpServer.headers,
          });
        return sessionBuilder.withSession(async (session) => {
          const modelOption = session.newSessionResponse.configOptions?.find(
            (option) => option.category === "model" || option.id === "model",
          );
          if (modelOption) {
            await context.request(acp.methods.agent.session.setConfigOption, {
              sessionId: session.sessionId,
              configId: modelOption.id,
              value: model,
            });
          } else if (model !== providers[providerId].model) {
            throw new Error(
              `${providers[providerId].label} does not support model selection`,
            );
          }
          onEvent?.({ type: "activity", label: `Using ${model}` });
          onEvent?.({
            type: "activity",
            label: "Analyzing your AeoKit evidence",
          });
          void session.prompt(prompt);
          let answer = "";
          for (;;) {
            const message = await session.nextUpdate();
            if (message.kind === "stop") {
              const result = {
                answer: cleanAgentAnswer(answer),
                stopReason: message.stopReason,
              };
              onEvent?.({ type: "done", ...result });
              return result;
            }
            const update = message.update;
            if (
              update.sessionUpdate === "agent_message_chunk" &&
              update.content.type === "text"
            ) {
              answer += update.content.text;
              onEvent?.({ type: "text_delta", delta: update.content.text });
            } else if (
              update.sessionUpdate === "tool_call" ||
              update.sessionUpdate === "tool_call_update"
            ) {
              const status =
                update.status === "in_progress"
                  ? "running"
                  : update.status || "pending";
              onEvent?.({
                type: "tool_call",
                id: update.toolCallId,
                name: update.name || update.kind || "tool",
                label: update.title || update.name || "Using a tool",
                status,
                ...(update.rawOutput !== undefined
                  ? {
                      summary: JSON.stringify(update.rawOutput).slice(0, 300),
                    }
                  : {}),
              });
            } else if (update.sessionUpdate === "agent_thought_chunk") {
              onEvent?.({
                type: "activity",
                label: "Reasoning through the evidence",
              });
            }
          }
        });
      });
  } catch (error) {
    throw new Error(
      stderr.trim().split("\n").at(-1) ||
        (error instanceof Error ? error.message : "ACP agent failed"),
    );
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", stop);
    stop();
  }
}

export function acpBridgePlugin(): Plugin {
  return {
    name: "aeokit-acp-bridge",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__acp/")) return next();
        if (!localOrigin(req))
          return json(res, 403, { error: "Untrusted origin" });
        if (req.method === "GET" && req.url === "/__acp/providers") {
          return json(res, 200, {
            providers: agentProviders(),
          });
        }
        if (req.method !== "POST" || req.url !== "/__acp/chat") {
          return json(res, 404, { error: "Not found" });
        }
        const controller = new AbortController();
        req.on("aborted", () => controller.abort());
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        try {
          const input = (await readBody(req)) as {
            provider?: ProviderId;
            model?: string;
            project?: string;
            history?: Array<{ role: string; content: string }>;
            prompt?: string;
            mode?: AgentMode;
            apiUrl?: string;
            token?: string;
          };
          if (!input.provider || !(input.provider in providers)) {
            return json(res, 400, { error: "Invalid provider" });
          }
          if (!input.prompt?.trim())
            return json(res, 400, { error: "Prompt required" });
          const provider = providers[input.provider];
          const model = input.model || provider.model;
          if (!provider.models.some((item) => item.id === model))
            return json(res, 400, { error: "Invalid model" });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/x-ndjson");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("X-Accel-Buffering", "no");
          const emit = (event: AgentStreamEvent) =>
            res.write(`${JSON.stringify(event)}\n`);
          await runAcpTurn(
            input.provider,
            model,
            systemPrompt(
              input.project || "Local workspace",
              input.history || [],
              input.prompt,
              input.mode,
            ),
            controller.signal,
            emit,
            {
              mcpServer: aeokitMcpServer(
                input.apiUrl || "/api",
                input.token || "",
              ),
            },
          );
          return res.end();
        } catch (error) {
          if (res.headersSent) {
            res.write(
              `${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "ACP request failed" })}\n`,
            );
            return res.end();
          }
          return json(res, 502, {
            error:
              error instanceof Error ? error.message : "ACP request failed",
          });
        }
      });
    },
  };
}
