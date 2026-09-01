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
  | {
      type: "permission_request";
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
  | { type: "error"; message: string };
