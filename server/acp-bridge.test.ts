import { afterEach, describe, expect, it, vi } from "vitest";
import { aeokitMcpServer, verifyAeokitMcpCapabilities } from "./acp-bridge";

afterEach(() => vi.unstubAllGlobals());

describe("AeoKit MCP configuration", () => {
  it("maps the local API base to its MCP endpoint", () => {
    const connection = aeokitMcpServer("/api", "secret");
    expect(connection.openApiUrl).toBe("http://127.0.0.1:3000/openapi.json");
    expect(connection.server.env).toEqual(
      expect.arrayContaining([
        { name: "AEOKIT_URL", value: "http://127.0.0.1:3000" },
        { name: "AEOKIT_API_KEY", value: "secret" },
      ]),
    );
    expect(connection.server.args.at(-1)).toMatch(/out\/main\/aeokit-mcp\.js$/);
  });

  it("allows HTTPS runtimes and rejects remote plaintext HTTP", () => {
    expect(
      aeokitMcpServer("https://cloud.aeokit.dev/api/", "").openApiUrl,
    ).toBe("https://cloud.aeokit.dev/openapi.json");
    expect(() => aeokitMcpServer("http://example.com/api", "")).toThrow(
      "Invalid AeoKit MCP URL",
    );
  });

  it("verifies prompt creation before starting an agent turn", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          paths: {
            "/api/projects/{projectId}/prompts": {
              post: { operationId: "postProjectsByProjectIdPrompts" },
            },
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyAeokitMcpCapabilities(aeokitMcpServer("/api", "secret")),
    ).resolves.toContain("aeokit_postProjectsByProjectIdPrompts");
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/openapi.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
  });

  it("fails clearly when prompt creation is not exposed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            paths: { "/api/health": { get: { operationId: "getHealth" } } },
          }),
        ),
      ),
    );

    await expect(
      verifyAeokitMcpCapabilities(aeokitMcpServer("/api", "")),
    ).rejects.toThrow(
      "AeoKit runtime is missing required operations: aeokit_postProjectsByProjectIdPrompts",
    );
  });
});
