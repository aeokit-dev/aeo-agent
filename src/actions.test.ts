import { describe, expect, it } from "vitest";
import { isAllowedAction, parseActions } from "./actions";

describe("AeoKit actions", () => {
  it("extracts an allowed mutation and hides its protocol block", () => {
    const result = parseActions(`Ready to create it.

\`\`\`aeokit-action
{"id":"one","method":"POST","path":"/projects/project-id/prompts","title":"Create prompt","description":"Adds one tracked prompt.","risk":"low","body":{"value":"What is AeoKit?"}}
\`\`\``);
    expect(result.content).toBe("Ready to create it.");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].path).toBe("/projects/project-id/prompts");
  });

  it("rejects arbitrary paths and path traversal", () => {
    const base = {
      id: "one",
      method: "DELETE" as const,
      title: "Delete",
      description: "Delete data.",
      risk: "high" as const,
    };
    expect(isAllowedAction({ ...base, path: "/users/me" })).toBe(false);
    expect(isAllowedAction({ ...base, path: "/prompts/../projects" })).toBe(
      false,
    );
  });
});
