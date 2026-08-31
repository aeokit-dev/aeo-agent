export interface DesktopBackend {
  id: "codex" | "claude";
  label: string;
  model: string;
  models?: Array<{ id: string; label: string }>;
}

export interface AgentPromptInput {
  requestId: string;
  provider: "codex" | "claude";
  model: string;
  context: string;
  history: Array<{ role: string; content: string }>;
  prompt: string;
  mode?: "product_analytics" | "research" | "sql" | "prompts";
}

export interface DesktopUpdateStatus {
  state:
    "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  message?: string;
}

export interface AgentDesktopApi {
  platform: string;
  listAgents(): Promise<DesktopBackend[]>;
  prompt(
    input: AgentPromptInput,
  ): Promise<{ answer: string; stopReason: string }>;
  cancel(requestId: string): Promise<boolean>;
  onProgress(
    listener: (event: { requestId: string; event: AgentStreamEvent }) => void,
  ): () => void;
  loadSettings(): Promise<{ apiUrl: string; token: string } | null>;
  saveSettings(settings: { apiUrl: string; token: string }): Promise<void>;
  runtimeRequest(input: {
    apiUrl: string;
    token: string;
    path: string;
    method: string;
    body?: string;
  }): Promise<{ status: number; body: unknown }>;
  checkForUpdate(): Promise<DesktopUpdateStatus>;
  installUpdate(): Promise<boolean>;
  onUpdateStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
}
import type { AgentStreamEvent } from "./streaming";
