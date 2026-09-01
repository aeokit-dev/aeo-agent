export interface Project {
  id: string;
  name: string;
  website: string;
}

export interface ChatSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  url: string;
  domain: string;
  title?: string;
  position: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  model: string | null;
  createdAt: string;
  activity?: string[];
  toolCalls?: ToolCall[];
  artifacts?: VisualizationArtifact[];
  uiActions?: AiChatUiAction[];
  approval?: ApprovalRequest;
  actions?: AeoKitAction[];
  permissions?: AgentPermissionRequest[];
  streaming?: boolean;
}

export interface AgentPermissionRequest {
  id: string;
  requestId: string;
  toolCallId: string;
  title: string;
  name: string;
  input?: unknown;
  options: Array<{
    optionId: string;
    name: string;
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  }>;
}

export interface AeoKitAction {
  id: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  title: string;
  description: string;
  risk: "low" | "medium" | "high";
  body?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  description: string;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected";
}

export interface ToolCall {
  id: string;
  name: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  summary?: string;
}

export interface VisualizationSeries {
  key: string;
  label: string;
  color?: string;
}

export interface VisualizationArtifact {
  type: "bar" | "line" | "table" | "metric";
  title: string;
  description?: string;
  xKey?: string;
  series: VisualizationSeries[];
  data: Array<Record<string, string | number | null>>;
  unit?: string;
}

export type AiChatUiAction =
  | { type: "show_ui_insight"; insightId: string; label: string }
  | {
      type: "open_app_page";
      page: string;
      label: string;
      executeImmediately: boolean;
    };

export interface ChatBackend {
  id: "local" | "openrouter" | "codex" | "claude";
  label: string;
  model: string;
  models?: Array<{ id: string; label: string }>;
}

export interface SendResponse {
  session: ChatSession;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  uiActions?: AiChatUiAction[];
}
