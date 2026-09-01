import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{ name?: string; in?: string; required?: boolean }>;
  requestBody?: unknown;
  "x-aeokit-mcp"?: {
    confirmation?: string;
    cost?: boolean;
    destructive?: boolean;
  };
};

type CatalogOperation = OpenApiOperation & { method: string; path: string };
const methods = ["get", "post", "put", "patch", "delete"];
const runtimeUrl = (process.env.AEOKIT_URL || "http://127.0.0.1:3000").replace(
  /\/+$/,
  "",
);
const token = process.env.AEOKIT_API_KEY || "";

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${runtimeUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `AeoKit request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent:
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : { value },
  };
}

async function main() {
  const document = (await request("/openapi.json")) as {
    paths?: Record<string, Record<string, OpenApiOperation>>;
  };
  const catalog = new Map<string, CatalogOperation>();
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!path.startsWith("/api/")) continue;
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation?.operationId) continue;
      catalog.set(operation.operationId, { ...operation, method, path });
    }
  }

  const server = new McpServer(
    { name: "aeokit", version: "0.1.0" },
    {
      instructions:
        "AeoKit is the system of record. Call aeokit_api_catalog before aeokit_api_call. Read before writing, and obtain explicit authorization for writes, destructive operations, and cost-bearing runs.",
    },
  );
  server.registerTool(
    "aeokit_api_catalog",
    {
      description:
        "List every documented operation supported by the connected AeoKit runtime, including safety metadata.",
      inputSchema: z.object({ query: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const needles = query?.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const operations = [...catalog.values()]
        .filter((operation) => {
          if (!needles?.length) return true;
          const searchable = [
            operation.operationId,
            operation.summary,
            operation.path,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return needles.some((needle) => searchable.includes(needle));
        })
        .map((operation) => ({
          operationId: operation.operationId,
          method: operation.method.toUpperCase(),
          path: operation.path,
          summary: operation.summary || operation.description,
          parameters: operation.parameters,
          requestBody: operation.requestBody,
          safety: operation["x-aeokit-mcp"],
        }));
      return result({ operations });
    },
  );
  server.registerTool(
    "aeokit_api_call",
    {
      description:
        "Execute one operation returned by aeokit_api_catalog. Path and query parameters are supplied by name; JSON bodies use body.",
      inputSchema: z.object({
        operationId: z.string(),
        parameters: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional(),
        body: z.unknown().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ operationId, parameters = {}, body }) => {
      const operation = catalog.get(operationId);
      if (!operation)
        throw new Error(`Unknown AeoKit operation '${operationId}'`);
      let path = operation.path;
      const query = new URLSearchParams();
      for (const parameter of operation.parameters ?? []) {
        if (!parameter.name) continue;
        const value = parameters[parameter.name];
        if (parameter.required && value === undefined)
          throw new Error(`Missing required parameter '${parameter.name}'`);
        if (value === undefined) continue;
        if (parameter.in === "path")
          path = path.replace(
            `{${parameter.name}}`,
            encodeURIComponent(String(value)),
          );
        else if (parameter.in === "query")
          query.set(parameter.name, String(value));
      }
      if (/\{[^}]+\}/.test(path))
        throw new Error("One or more required path parameters are missing");
      const encodedQuery = query.toString();
      return result(
        await request(encodedQuery ? `${path}?${encodedQuery}` : path, {
          method: operation.method.toUpperCase(),
          ...(operation.requestBody
            ? { body: JSON.stringify(body ?? {}) }
            : {}),
        }),
      );
    },
  );
  await serveStdio(() => server);
}

await main();
