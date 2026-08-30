import { describe, expect, it } from "vitest";
import { buildAgentPrompt, cleanAgentAnswer } from "./agent-experience";

describe("buildAgentPrompt", () => {
  it("requires claims to preserve the dimensions of supplied evidence", () => {
    const prompt = buildAgentPrompt({
      context: JSON.stringify({
        providers: [{ name: "Gemini", score: 37 }],
        prompts: [{ text: "Best platform", score: 20 }],
      }),
      history: [],
      prompt: "Where is this prompt weakest?",
    });

    expect(prompt).toContain("Preserve the dimensions of every measurement");
    expect(prompt).toContain(
      "do not attribute a prompt's overall score to a particular provider",
    );
    expect(prompt).toContain("Label plausible explanations as hypotheses");
  });

  it("keeps tool narration out of the final answer", () => {
    const prompt = buildAgentPrompt({
      context: "Local workspace",
      history: [],
      prompt: "Research current citation behavior",
      mode: "research",
    });

    expect(prompt).toContain(
      "Use tools without narrating planned tool use in the answer",
    );
    expect(prompt).toContain("Start the answer with the finding");
    expect(prompt).toContain(
      "external sources may add current context but must never be presented as project measurements",
    );
  });

  it("removes leading tool narration without hiding genuine limitations", () => {
    expect(
      cleanAgentAnswer(
        "I’ll verify current reporting first.The citation rate changed.",
      ),
    ).toBe("The citation rate changed.");
    expect(
      cleanAgentAnswer(
        "Let me research that. I’ll compare the sources. The finding is clear.",
      ),
    ).toBe("The finding is clear.");
    expect(
      cleanAgentAnswer(
        "I’m checking current reporting against the project score.ChatGPT citations changed.",
      ),
    ).toBe("ChatGPT citations changed.");
    expect(cleanAgentAnswer("I’m unable to verify that claim.")).toBe(
      "I’m unable to verify that claim.",
    );
  });
});
