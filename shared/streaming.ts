export type AgentStreamEvent =
  | { type: "activity"; label: string }
  | { type: "text_delta"; delta: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      label: string;
      status: "pending" | "running" | "completed" | "failed";
      summary?: string;
    }
  | { type: "done"; answer: string; stopReason: string }
  | { type: "error"; message: string };
