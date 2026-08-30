import { describe, expect, it, vi } from "vitest";
import { AeoKitApi, initialSettings, normalizeApiUrl } from "./api";

describe("AeoKitApi", () => {
  it("migrates the old cross-origin local API default to the dev proxy", () => {
    localStorage.setItem(
      "aeokit-agent-settings",
      JSON.stringify({ apiUrl: "http://localhost:3000/api", token: "" }),
    );
    expect(initialSettings().apiUrl).toBe("/api");
    localStorage.clear();
  });

  it("normalizes trailing slashes", () =>
    expect(normalizeApiUrl(" http://localhost:3000/api/// ")).toBe(
      "http://localhost:3000/api",
    ));

  it("uses the runtime chat contract and bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ projects: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = new AeoKitApi({
      apiUrl: "https://example.com/api/",
      token: "secret",
    });
    await api.projects();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/projects",
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    );
  });

  it("sends local agent turns through the ACP bridge", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: "Grounded answer" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = new AeoKitApi({
      apiUrl: "http://localhost:3000/api",
      token: "",
    });
    await expect(
      api.acpSend(
        "codex",
        "gpt-5.6-sol",
        "Acme",
        [],
        "What changed?",
        "product_analytics",
      ),
    ).resolves.toBe("Grounded answer");
    expect(fetchMock).toHaveBeenCalledWith(
      "/__acp/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("streams local ACP text deltas before completion", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      '{"type":"activity","label":"Analyzing"}\n',
      '{"type":"text_delta","delta":"Hello "}\n',
      '{"type":"text_delta","delta":"world"}\n',
      '{"type":"done","answer":"Hello world","stopReason":"end_turn"}\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/x-ndjson" }),
      body: new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const events: string[] = [];
    const api = new AeoKitApi({ apiUrl: "/api", token: "" });
    await expect(
      api.acpSend(
        "codex",
        "gpt-5.6-sol",
        "Acme",
        [],
        "Hello",
        "product_analytics",
        (event) => events.push(event.type),
      ),
    ).resolves.toBe("Hello world");
    expect(events).toEqual(["activity", "text_delta", "text_delta", "done"]);
  });

  it("grounds local agents with the active project and other project summaries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ mentionRate: 42 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = new AeoKitApi({ apiUrl: "/api", token: "" });
    const context = JSON.parse(
      await api.agentContext("picks", "Picks.so", [
        { id: "picks", name: "Picks.so", website: "https://picks.so" },
        { id: "other", name: "Other", website: "https://other.test" },
      ]),
    );
    expect(context.activeProject.name).toBe("Picks.so");
    expect(context.projectCatalog).toHaveLength(2);
    expect(context.otherProjectSummaries[0]).toMatchObject({
      project: { id: "other" },
      dashboard: { mentionRate: 42 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/other/visibility",
      expect.any(Object),
    );
  });
});
