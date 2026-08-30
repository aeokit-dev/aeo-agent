import { describe, expect, it } from "vitest";
import {
  parseArtifacts,
  parseContentBlocks,
  serializeContentForClipboard,
} from "./artifacts";

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

  it("rejects empty and structurally misleading artifacts", () => {
    const empty =
      '```aeokit-chart\n{"type":"bar","title":"Empty","series":[],"data":[]}\n```';
    const missingValues =
      '```aeokit-chart\n{"type":"line","title":"Broken","series":[{"key":"value","label":"Value"}],"data":[{"label":"Now"}]}\n```';

    expect(parseContentBlocks(empty)).toEqual([
      { type: "markdown", content: empty },
    ]);
    expect(parseContentBlocks(missingValues)).toEqual([
      { type: "markdown", content: missingValues },
    ]);
  });

  it("rejects optional display fields that could crash rendering", () => {
    const unsafeDescription =
      '```aeokit-chart\n{"type":"metric","title":"Rate","description":{"unexpected":true},"series":[{"key":"value","label":"Rate"}],"data":[{"value":42}]}\n```';
    const unsafeUnit =
      '```aeokit-chart\n{"type":"bar","title":"Rate","unit":{"unexpected":true},"series":[{"key":"value","label":"Rate"}],"data":[{"label":"Now","value":42}]}\n```';

    expect(parseArtifacts(unsafeDescription).artifacts).toHaveLength(0);
    expect(parseArtifacts(unsafeUnit).artifacts).toHaveLength(0);
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

  it("serializes charts as readable values for clipboard copy", () => {
    const content =
      'Summary\n```aeokit-chart\n{"type":"bar","title":"Visibility","xKey":"engine","series":[{"key":"value","label":"Mentions"}],"data":[{"engine":"ChatGPT","value":42}],"unit":"%"}\n```';

    expect(serializeContentForClipboard(content)).toBe(
      "Summary\n\nVisibility\nChatGPT: Mentions: 42%",
    );
    expect(serializeContentForClipboard(content)).not.toContain("aeokit-chart");
  });
});
