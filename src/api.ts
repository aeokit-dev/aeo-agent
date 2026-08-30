import type {
  ChatBackend,
  ChatMessage,
  ChatSession,
  Project,
  SendResponse,
} from "./types";
import type { AgentMode } from "../shared/agent-experience";
import type { AgentStreamEvent } from "../shared/streaming";

const fallbackBase = "/api";

export type ClientSettings = { apiUrl: string; token: string };

export function initialSettings(): ClientSettings {
  const stored =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem("aeokit-agent-settings");
  if (stored) {
    try {
      const settings = JSON.parse(stored) as ClientSettings;
      if (
        /^http:\/\/(localhost|127\.0\.0\.1):3000\/api\/?$/.test(settings.apiUrl)
      ) {
        return { ...settings, apiUrl: "/api" };
      }
      return settings;
    } catch {
      // Ignore malformed local state.
    }
  }
  return {
    apiUrl: import.meta.env.VITE_AEOKIT_API_URL || fallbackBase,
    token: import.meta.env.VITE_AEOKIT_API_TOKEN || "",
  };
}

export function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function requestsPortfolioContext(prompt: string): boolean {
  return /\b(projects|portfolio|cross[- ]project)\b/i.test(prompt);
}

export class AeoKitApi {
  constructor(private settings: ClientSettings) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (window.aeokitDesktop) {
      const result = await window.aeokitDesktop.runtimeRequest({
        apiUrl: normalizeApiUrl(this.settings.apiUrl),
        token: this.settings.token,
        path,
        method: init?.method || "GET",
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      if (result.status < 200 || result.status >= 300) {
        const payload = result.body as {
          error?: string | { message?: string };
        } | null;
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : payload?.error?.message;
        throw new Error(message || `AeoKit API returned ${result.status}`);
      }
      return result.body as T;
    }
    const response = await fetch(
      `${normalizeApiUrl(this.settings.apiUrl)}${path}`,
      {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(this.settings.token
            ? { Authorization: `Bearer ${this.settings.token}` }
            : {}),
          ...init?.headers,
        },
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string | { message?: string };
      };
      const message =
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message;
      throw new Error(message || `AeoKit API returned ${response.status}`);
    }
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }

  projects = async () =>
    (await this.request<{ projects: Project[] }>("/projects")).projects;
  backends = async () =>
    (await this.request<{ backends: ChatBackend[] }>("/ai-chat/backends"))
      .backends;
  acpBackends = async () => {
    if (window.aeokitDesktop) return window.aeokitDesktop.listAgents();
    const response = await fetch("/__acp/providers");
    if (!response.ok) return [];
    return ((await response.json()) as { providers: ChatBackend[] }).providers;
  };
  acpSend = async (
    provider: "codex" | "claude",
    model: string,
    context: string,
    history: Array<Pick<ChatMessage, "role" | "content">>,
    prompt: string,
    mode: AgentMode,
    onEvent?: (event: AgentStreamEvent) => void,
  ) => {
    if (window.aeokitDesktop) {
      const requestId = crypto.randomUUID();
      const unsubscribe = window.aeokitDesktop.onProgress((event) => {
        if (event.requestId === requestId) onEvent?.(event.event);
      });
      try {
        const result = await window.aeokitDesktop.prompt({
          requestId,
          provider,
          model,
          context,
          history,
          prompt,
          mode,
        });
        return result.answer;
      } finally {
        unsubscribe();
      }
    }
    const response = await fetch("/__acp/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model,
        project: context,
        history,
        prompt,
        mode,
      }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(data.error || "Local ACP agent failed");
    }
    if (
      response.headers
        ?.get("content-type")
        ?.includes("application/x-ndjson") !== true
    ) {
      const data = (await response.json()) as {
        answer?: string;
        error?: string;
      };
      if (!data.answer) throw new Error(data.error || "Local ACP agent failed");
      return data.answer;
    }
    if (!response.body) throw new Error("Local ACP stream was unavailable");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as AgentStreamEvent;
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "text_delta") answer += event.delta;
        if (event.type === "done") answer = event.answer;
        onEvent?.(event);
      }
      if (done) break;
    }
    return answer;
  };
  agentContext = async (
    projectId: string,
    projectName: string,
    projects: Project[],
    prompt: string,
    onProgress?: (label: string) => void,
  ) => {
    if (projectId === "local-workspace")
      return JSON.stringify({ project: projectName, projectCatalog: projects });

    const allProjects = projects.filter(
      (item) => item.id !== "local-workspace",
    );
    const selected =
      allProjects.find((item) => item.id === projectId) ||
      ({ id: projectId, name: projectName, website: "" } satisfies Project);
    const targets = requestsPortfolioContext(prompt) ? allProjects : [selected];
    const evidence = await Promise.all(
      targets.map(async (target) => {
        const base = `/projects/${encodeURIComponent(target.id)}`;
        const paths = {
          project: base,
          dashboard: `${base}/dashboard`,
          visibility: `${base}/visibility`,
          prompts: `${base}/prompts`,
          citations: `${base}/citations`,
        };
        const values = await Promise.allSettled(
          Object.values(paths).map((path) => this.request<unknown>(path)),
        );
        onProgress?.(`Reading evidence for ${target.name}`);
        return {
          project: target,
          evidence: Object.fromEntries(
            Object.keys(paths).map((key, index) => [
              key,
              values[index].status === "fulfilled"
                ? values[index].value
                : { unavailable: true },
            ]),
          ),
        };
      }),
    );
    return JSON.stringify({
      scope: targets.length > 1 ? "all-projects" : "selected-project",
      selectedProjectId: projectId,
      projectCatalog: allProjects,
      projects: evidence,
    }).slice(0, 120_000);
  };
  sessions = async (projectId: string) =>
    (
      await this.request<{ sessions: ChatSession[] }>(
        `/projects/${projectId}/ai-chat/sessions`,
      )
    ).sessions;
  messages = async (sessionId: string) =>
    (
      await this.request<{ messages: ChatMessage[] }>(
        `/ai-chat/sessions/${sessionId}/messages`,
      )
    ).messages;
  createSession = async (projectId: string) =>
    (
      await this.request<{ session: ChatSession }>(
        `/projects/${projectId}/ai-chat/sessions`,
        { method: "POST" },
      )
    ).session;
  deleteSession = async (sessionId: string) =>
    this.request<void>(`/ai-chat/sessions/${sessionId}`, { method: "DELETE" });
  send = async (
    sessionId: string,
    content: string,
    backend?: ChatBackend["id"],
  ) =>
    this.request<SendResponse>(`/ai-chat/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, ...(backend ? { backend } : {}) }),
    });
}
