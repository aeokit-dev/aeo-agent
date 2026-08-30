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
      api.acpSend("codex", "gpt-5.6-sol", "Acme", [], "What changed?"),
    ).resolves.toBe("Grounded answer");
    expect(fetchMock).toHaveBeenCalledWith(
      "/__acp/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
