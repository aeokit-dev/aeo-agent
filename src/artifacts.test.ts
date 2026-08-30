import { describe, expect, it } from "vitest";
import { parseArtifacts, parseContentBlocks } from "./artifacts";

describe("parseArtifacts", () => {
  it("extracts valid chart blocks from assistant prose", () => {
    const result = parseArtifacts(
      'The visibility split is below.\n\n```aeokit-chart\n{"type":"bar","title":"Visibility","xKey":"label","series":[{"key":"value","label":"Mentions"}],"data":[{"label":"ChatGPT","value":42}],"unit":"%"}\n```',
    );
    expect(result.markdown).toBe("The visibility split is below.");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].data[0].value).toBe(42);
  });

  it("leaves invalid artifact blocks visible", () => {
    const content = "```aeokit-chart\nnot-json\n```";
    expect(parseArtifacts(content)).toEqual({
      markdown: content,
      artifacts: [],
    });
  });

  it("preserves charts mixed between narrative sections", () => {
    const content =
      'Before\n```aeokit-chart\n{"type":"metric","title":"Rate","series":[{"key":"value","label":"Rate"}],"data":[{"value":42}],"unit":"%"}\n```\nAfter';
    expect(parseContentBlocks(content).map((block) => block.type)).toEqual([
      "markdown",
      "visualization",
      "markdown",
    ]);
  });
});
