import type { VisualizationArtifact } from "./types";

const chartBlock = /```aeokit-chart\s*([\s\S]*?)```/gi;

export type AssistantContentBlock =
  | { type: "markdown"; content: string }
  | { type: "visualization"; artifact: VisualizationArtifact };

function isArtifact(value: unknown): value is VisualizationArtifact {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<VisualizationArtifact>;
  return (
    ["bar", "line", "table", "metric"].includes(item.type || "") &&
    typeof item.title === "string" &&
    Array.isArray(item.series) &&
    Array.isArray(item.data) &&
    item.data.length <= 40 &&
    item.series.length <= 5
  );
}

export function parseArtifacts(content: string): {
  markdown: string;
  artifacts: VisualizationArtifact[];
} {
  const artifacts: VisualizationArtifact[] = [];
  const markdown = content.replace(chartBlock, (_block, json: string) => {
    try {
      const value: unknown = JSON.parse(json.trim());
      if (isArtifact(value)) {
        artifacts.push(value);
        return "";
      }
    } catch {
      // Preserve malformed blocks so the response remains inspectable.
    }
    return _block;
  });
  return { markdown: markdown.trim(), artifacts };
}

export function parseContentBlocks(content: string): AssistantContentBlock[] {
  const blocks: AssistantContentBlock[] = [];
  let cursor = 0;
  chartBlock.lastIndex = 0;
  for (const match of content.matchAll(chartBlock)) {
    const index = match.index ?? 0;
    const markdown = content.slice(cursor, index).trim();
    if (markdown) blocks.push({ type: "markdown", content: markdown });
    try {
      const value: unknown = JSON.parse(match[1].trim());
      if (isArtifact(value)) {
        blocks.push({ type: "visualization", artifact: value });
      } else {
        blocks.push({ type: "markdown", content: match[0] });
      }
    } catch {
      blocks.push({ type: "markdown", content: match[0] });
    }
    cursor = index + match[0].length;
  }
  const tail = content.slice(cursor).trim();
  if (tail) blocks.push({ type: "markdown", content: tail });
  return blocks;
}
