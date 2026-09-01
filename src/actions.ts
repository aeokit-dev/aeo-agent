import type { AeoKitAction } from "./types";

const actionBlock = /```aeokit-action\s*([\s\S]*?)```/gi;
const mutationRoutes: Array<{ method: AeoKitAction["method"]; path: RegExp }> =
  [
    { method: "POST", path: /^\/projects$/ },
    { method: "PATCH", path: /^\/projects\/[^/]+$/ },
    { method: "POST", path: /^\/projects\/[^/]+\/(?:archive|unarchive)$/ },
    { method: "PUT", path: /^\/projects\/[^/]+\/public-report$/ },
    { method: "POST", path: /^\/projects\/[^/]+\/competitors$/ },
    { method: "DELETE", path: /^\/competitors\/[^/]+$/ },
    {
      method: "POST",
      path: /^\/projects\/[^/]+\/competitor-suggestions\/(?:reanalyze|approve)$/,
    },
    {
      method: "POST",
      path: /^\/projects\/[^/]+\/competitor-suggestions\/[^/]+\/dismiss$/,
    },
    {
      method: "POST",
      path: /^\/projects\/[^/]+\/prompt-suggestions(?:\/approve)?$/,
    },
    { method: "POST", path: /^\/projects\/[^/]+\/prompts$/ },
    { method: "PATCH", path: /^\/prompts\/[^/]+$/ },
    { method: "DELETE", path: /^\/prompts\/[^/]+$/ },
    { method: "POST", path: /^\/prompts\/[^/]+\/run$/ },
    { method: "PATCH", path: /^\/opportunities\/[^/]+$/ },
    { method: "POST", path: /^\/projects\/[^/]+\/experiments$/ },
    { method: "PATCH", path: /^\/experiments\/[^/]+$/ },
    { method: "POST", path: /^\/run-monitor\/(?:cancel|retry)$/ },
  ];

export function isAllowedAction(action: AeoKitAction): boolean {
  return (
    mutationRoutes.some(
      (route) => route.method === action.method && route.path.test(action.path),
    ) &&
    !action.path.includes("..") &&
    !action.path.includes("?")
  );
}

function parseAction(value: unknown): AeoKitAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<AeoKitAction>;
  const action: AeoKitAction = {
    id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
    method: item.method as AeoKitAction["method"],
    path: typeof item.path === "string" ? item.path : "",
    title: typeof item.title === "string" ? item.title : "",
    description: typeof item.description === "string" ? item.description : "",
    risk: item.risk as AeoKitAction["risk"],
    ...(item.body && typeof item.body === "object" && !Array.isArray(item.body)
      ? { body: item.body }
      : {}),
  };
  if (
    !["POST", "PATCH", "PUT", "DELETE"].includes(action.method) ||
    !["low", "medium", "high"].includes(action.risk) ||
    !action.title.trim() ||
    !action.description.trim() ||
    !isAllowedAction(action)
  )
    return null;
  return action;
}

export function parseActions(content: string): {
  content: string;
  actions: AeoKitAction[];
} {
  const actions: AeoKitAction[] = [];
  const visible = content.replace(actionBlock, (block, json: string) => {
    try {
      const value = JSON.parse(json.trim()) as unknown;
      const values = Array.isArray(value) ? value : [value];
      const parsed = values.map(parseAction);
      if (parsed.every(Boolean)) {
        actions.push(...(parsed as AeoKitAction[]));
        return "";
      }
    } catch {
      // Preserve malformed or unsupported actions for inspection.
    }
    return block;
  });
  return { content: visible.trim(), actions };
}
