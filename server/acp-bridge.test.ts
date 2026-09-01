import { describe, expect, it } from "vitest";
import { aeokitMcpServer } from "./acp-bridge";

describe("AeoKit MCP configuration", () => {
  it("maps the local API base to its MCP endpoint", () => {
    expect(aeokitMcpServer("/api", "secret")).toEqual({
      url: "http://127.0.0.1:3000/api/mcp",
      headers: [
        { name: "Accept", value: "application/json, text/event-stream" },
        { name: "Authorization", value: "Bearer secret" },
      ],
    });
  });

  it("allows HTTPS runtimes and rejects remote plaintext HTTP", () => {
    expect(aeokitMcpServer("https://cloud.aeokit.dev/api/", "").url).toBe(
      "https://cloud.aeokit.dev/api/mcp",
    );
    expect(() => aeokitMcpServer("http://example.com/api", "")).toThrow(
      "Invalid AeoKit MCP URL",
    );
  });
});
