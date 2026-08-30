import { describe, expect, it, vi } from "vitest";
import {
  AeoKitApi,
  initialSettings,
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
      api.acpSend("codex", "gpt-5.6-sol", "Acme", [], "What changed?"),
    ).resolves.toBe("Grounded answer");
    expect(fetchMock).toHaveBeenCalledWith(
      "/__acp/chat",
      expect.objectContaining({ method: "POST" }),
    );
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
