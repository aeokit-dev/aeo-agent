import { describe, expect, it, vi } from "vitest";
import {
  AeoKitApi,
  initialSettings,
  isValidApiUrl,
  normalizeApiUrl,
  requestsPortfolioContext,
} from "./api";

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

  it("accepts supported API locations and rejects malformed URLs", () => {
    expect(isValidApiUrl("/api")).toBe(true);
    expect(isValidApiUrl("http://localhost:3000/api")).toBe(true);
    expect(isValidApiUrl("https://api.example.com/v1")).toBe(true);
    expect(isValidApiUrl("http://api.example.com/v1")).toBe(false);
    expect(isValidApiUrl("javascript:alert(1)")).toBe(false);
    expect(isValidApiUrl("not a url")).toBe(false);
    expect(isValidApiUrl("//example.com/api")).toBe(false);
    expect(isValidApiUrl("/")).toBe(false);
  });

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

  it("cancels an active desktop agent turn and removes its listener", async () => {
    const controller = new AbortController();
    const cancel = vi.fn().mockResolvedValue(true);
    const unsubscribe = vi.fn();
    let requestId = "";
    let rejectPrompt!: (reason: unknown) => void;
    const prompt = vi.fn((input: { requestId: string }) => {
      requestId = input.requestId;
      return new Promise<{ answer: string; stopReason: string }>(
        (_resolve, reject) => {
          rejectPrompt = reject;
        },
      );
    });
    window.aeokitDesktop = {
      platform: "darwin",
      listAgents: vi.fn(),
      prompt,
      cancel,
      onProgress: vi.fn(() => unsubscribe),
      loadSettings: vi.fn(),
      saveSettings: vi.fn(),
      runtimeRequest: vi.fn(),
      checkForUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateStatus: vi.fn(() => vi.fn()),
    };
    const api = new AeoKitApi({ apiUrl: "/api", token: "" });
    const turn = api.acpSend(
      "codex",
      "gpt-5.6-sol",
      "Acme",
      [],
      "Hello",
      "product_analytics",
      undefined,
      controller.signal,
    );

    controller.abort();
    expect(cancel).toHaveBeenCalledWith(requestId);
    rejectPrompt(new DOMException("cancelled", "AbortError"));
    await expect(turn).rejects.toMatchObject({ name: "AbortError" });
    expect(unsubscribe).toHaveBeenCalledOnce();
    delete window.aeokitDesktop;
  });

  it("recognizes requests that need evidence from every project", () => {
    expect(requestsPortfolioContext("check all projects")).toBe(true);
    expect(requestsPortfolioContext("what about my other projects?")).toBe(
      true,
    );
    expect(requestsPortfolioContext("summarize this dashboard")).toBe(false);
  });

  it("loads evidence for all projects for portfolio questions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ score: 42 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = new AeoKitApi({ apiUrl: "https://example.com/api", token: "" });
    const projects = [
      { id: "one", name: "One", website: "https://one.test" },
      { id: "two", name: "Two", website: "https://two.test" },
    ];

    const context = JSON.parse(
      await api.agentContext("one", "One", projects, "compare all projects"),
    );

    expect(context.scope).toBe("all-projects");
    expect(context.projects).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/projects/two/dashboard",
      expect.any(Object),
    );
  });

  it("keeps single-project questions scoped to the selected project", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = new AeoKitApi({ apiUrl: "https://example.com/api", token: "" });
    const projects = [
      { id: "one", name: "One", website: "" },
      { id: "two", name: "Two", website: "" },
    ];

    const context = JSON.parse(
      await api.agentContext("one", "One", projects, "summarize visibility"),
    );

    expect(context.scope).toBe("selected-project");
    expect(context.projectCatalog).toHaveLength(2);
    expect(context.projects).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
