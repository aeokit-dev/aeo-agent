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
}

export interface AgentDesktopApi {
  platform: string;
  listAgents(): Promise<DesktopBackend[]>;
  prompt(
    input: AgentPromptInput,
  ): Promise<{ answer: string; stopReason: string }>;
  cancel(requestId: string): Promise<boolean>;
  onProgress(
    listener: (event: { requestId: string; label: string }) => void,
  ): () => void;
  runtimeRequest(input: {
    apiUrl: string;
    token: string;
    path: string;
    method: string;
    body?: string;
  }): Promise<{ status: number; body: unknown }>;
}
