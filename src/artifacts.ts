import type { VisualizationArtifact } from "./types";

const chartBlock = /```aeokit-chart\s*([\s\S]*?)```/gi;

export type AssistantContentBlock =
  | { type: "markdown"; content: string }
  | { type: "visualization"; artifact: VisualizationArtifact };

function isArtifact(value: unknown): value is VisualizationArtifact {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<VisualizationArtifact>;
  if (
    !["bar", "line", "table", "metric"].includes(item.type || "") ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    !Array.isArray(item.series) ||
    !Array.isArray(item.data) ||
    item.data.length < 1 ||
    item.data.length > 40 ||
    item.series.length < 1 ||
    item.series.length > 5 ||
    (item.description !== undefined && typeof item.description !== "string") ||
    (item.unit !== undefined && typeof item.unit !== "string") ||
    (item.xKey !== undefined &&
      (typeof item.xKey !== "string" || !item.xKey.trim()))
  )
    return false;

  const seriesKeys = new Set<string>();
  for (const series of item.series) {
    if (
      !series ||
      typeof series !== "object" ||
      typeof series.key !== "string" ||
      !series.key.trim() ||
      typeof series.label !== "string" ||
      !series.label.trim() ||
      (series.color !== undefined && typeof series.color !== "string") ||
      seriesKeys.has(series.key)
    )
      return false;
    seriesKeys.add(series.key);
  }

  const xKey = item.xKey || "label";
  return item.data.every((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    if (item.type !== "metric" && row[xKey] == null) return false;
    if (item.type === "table") return true;
    return item.series!.every((series) => {
      const value = row[series.key];
      return value !== null && value !== "" && Number.isFinite(Number(value));
    });
  });
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

export function serializeContentForClipboard(content: string): string {
  return parseContentBlocks(content)
    .map((block) => {
      if (block.type === "markdown") return block.content;
      const { artifact } = block;
      const xKey = artifact.xKey || "label";
      const rows = artifact.data.map((row) => {
        const label = row[xKey] == null ? "" : `${String(row[xKey])}: `;
        const values = artifact.series
          .map(
            (series) =>
              `${series.label}: ${String(row[series.key] ?? "–")}${artifact.unit || ""}`,
          )
          .join(", ");
        return `${label}${values}`;
      });
      return [artifact.title, artifact.description, ...rows]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n")
    .trim();
}
