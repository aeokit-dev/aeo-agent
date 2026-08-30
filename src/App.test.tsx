import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalCard,
  Composer,
  Message,
  MessageActions,
  SettingsDialog,
  VisualizationCard,
} from "./App";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Composer", () => {
  it("sends with Enter but not while an IME composition is active", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const message = screen.getByRole("textbox", { name: "Message" });

    fireEvent.change(message, { target: { value: "分析して" } });
    fireEvent.keyDown(message, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(message, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("分析して");
  });

  it("keeps Shift+Enter available for multiline prompts", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const message = screen.getByRole("textbox", { name: "Message" });

    fireEvent.change(message, { target: { value: "First line" } });
    fireEvent.keyDown(message, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("SettingsDialog", () => {
  it("has an accessible name, focuses the URL, and closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <SettingsDialog
        settings={{ apiUrl: "/api", token: "" }}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Connection settings" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("API URL")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps keyboard focus inside the dialog", () => {
    render(
      <SettingsDialog
        settings={{ apiUrl: "/api", token: "" }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const close = screen
      .getAllByRole("button", { name: "Close connection settings" })
      .find((button) => button.getAttribute("tabindex") !== "-1")!;
    const save = screen.getByRole("button", { name: "Save and reconnect" });

    save.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
  });

  it("rejects malformed API URLs before saving", () => {
    const onSave = vi.fn();
    render(
      <SettingsDialog
        settings={{ apiUrl: "/api", token: "" }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const apiUrl = screen.getByLabelText("API URL");
    fireEvent.change(apiUrl, { target: { value: "not a url" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Use HTTPS");
    expect(apiUrl).toHaveAttribute("aria-invalid", "true");
    expect(apiUrl).toHaveFocus();
  });

  it("lets users verify and re-hide a pasted bearer token", () => {
    render(
      <SettingsDialog
        settings={{ apiUrl: "/api", token: "secret" }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const token = screen.getByDisplayValue("secret");
    expect(token).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Show bearer token" }));
    expect(token).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide bearer token" }));
    expect(token).toHaveAttribute("type", "password");
  });

  it("keeps settings open and reports persistence failures", async () => {
    render(
      <SettingsDialog
        settings={{ apiUrl: "/api", token: "" }}
        onSave={vi.fn().mockRejectedValue(new Error("Disk unavailable"))}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Disk unavailable",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save and reconnect" }),
    ).toBeEnabled();
  });

  it("keeps the dialog stable while settings are being saved", async () => {
    let finishSave!: () => void;
    const onClose = vi.fn();
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    render(
      <SettingsDialog
        settings={{ apiUrl: "/api", token: "" }}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("dialog").querySelector("form")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    finishSave();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save and reconnect" }),
      ).toBeEnabled(),
    );
  });
});

describe("MessageActions", () => {
  it("shows confirmation only after clipboard writing succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<MessageActions messageId="message-1" content="Useful answer" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Useful answer"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("reports clipboard failures instead of claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<MessageActions messageId="message-2" content="Useful answer" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Copy failed");
  });

  it("persists answer ratings locally and labels them honestly", () => {
    const { unmount } = render(
      <MessageActions messageId="message-rating" content="Useful answer" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Helpful answer" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved locally");
    expect(localStorage.getItem("aeokit-rating-message-rating")).toBe("up");

    unmount();
    render(
      <MessageActions messageId="message-rating" content="Useful answer" />,
    );
    expect(
      screen.getByRole("button", { name: "Helpful answer" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ApprovalCard", () => {
  it("states that a locally recorded approval did not run an action", () => {
    render(
      <ApprovalCard
        approval={{
          id: "approval-1",
          title: "Publish report",
          description: "Makes the report visible.",
          risk: "high",
          status: "pending",
        }}
      />,
    );

    expect(
      screen.getByText(/no external action will run/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark approved" }));
    expect(screen.getByRole("status")).toHaveTextContent("Approved locally");
    expect(screen.getByRole("status")).toHaveTextContent(
      "no external action was run",
    );
    expect(localStorage.getItem("aeokit-approval-approval-1")).toBe("approved");
  });
});

describe("VisualizationCard", () => {
  it("uses distinct default colors and marks negative bars clearly", () => {
    const { container } = render(
      <VisualizationCard
        artifact={{
          type: "bar",
          title: "Change by engine",
          xKey: "engine",
          series: [
            { key: "mentions", label: "Mentions" },
            { key: "citations", label: "Citations" },
          ],
          data: [{ engine: "ChatGPT", mentions: 20, citations: -5 }],
          unit: "%",
        }}
      />,
    );

    const bars = [...container.querySelectorAll<HTMLElement>(".bar-row i")];
    expect(bars[0].style.background).not.toBe(bars[1].style.background);
    expect(container.querySelector(".bar-row.negative")).toHaveAttribute(
      "aria-label",
      "Citations: -5%",
    );
  });

  it("links table data to accessible captions and scoped headers", () => {
    const { container } = render(
      <VisualizationCard
        artifact={{
          type: "table",
          title: "Engine visibility",
          xKey: "engine",
          series: [{ key: "mentions", label: "Mentions" }],
          data: [{ engine: "ChatGPT", mentions: 20 }],
        }}
      />,
    );

    expect(
      screen.getByText("Engine visibility", { selector: "caption" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Mentions" }),
    ).toHaveAttribute("scope", "col");
    expect(screen.getByRole("rowheader", { name: "ChatGPT" })).toHaveAttribute(
      "scope",
      "row",
    );
    expect(
      screen.getByRole("button", { name: "Collapse chart" }),
    ).toHaveAttribute(
      "aria-controls",
      container.querySelector(".visualization-body")?.id,
    );
  });

  it("keeps dense negative line data in bounds while exposing every value", () => {
    const data = Array.from({ length: 12 }, (_, index) => ({
      month: `M${index + 1}`,
      change: index - 6,
    }));
    const { container } = render(
      <VisualizationCard
        artifact={{
          type: "line",
          title: "Monthly change",
          xKey: "month",
          series: [{ key: "change", label: "Change" }],
          data,
          unit: "%",
        }}
      />,
    );

    const points = container.querySelector("polyline")!.getAttribute("points")!;
    const yValues = points
      .split(" ")
      .map((point) => Number(point.split(",")[1]));
    expect(yValues.every((value) => value >= 24 && value <= 196)).toBe(true);
    expect(
      container.querySelectorAll(".line-chart svg text").length,
    ).toBeLessThanOrEqual(7);
    expect(screen.getAllByRole("rowheader")).toHaveLength(12);
  });
});

describe("Message links", () => {
  const baseMessage = {
    id: "assistant-1",
    sessionId: "session-1",
    role: "assistant" as const,
    model: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("opens safe answer links externally and neutralizes unsafe schemes", () => {
    render(
      <Message
        message={{
          ...baseMessage,
          content:
            "[Safe](https://example.com/report) and [Unsafe](javascript:alert(1))",
          citations: [],
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Safe" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByText("Unsafe")).not.toHaveAttribute("href");
  });

  it("shows citation hostnames and disables invalid destinations", () => {
    render(
      <Message
        message={{
          ...baseMessage,
          content: "Evidence",
          citations: [
            {
              url: "https://www.example.com/report",
              domain: "Provided label",
              title: "Quarterly report",
              position: 1,
            },
            {
              url: "javascript:alert(1)",
              domain: "Invalid source",
              position: 2,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Quarterly report/ }),
    ).toHaveAttribute("href", "https://www.example.com/report");
    expect(
      screen.getByText("Invalid source").closest(".source-disabled"),
    ).toBeInTheDocument();
  });
});
