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
}

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
}
