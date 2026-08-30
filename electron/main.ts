import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentProviders,
  runAcpTurn,
  type ProviderId,
} from "../server/acp-bridge";

const directory = path.dirname(fileURLToPath(import.meta.url));
const activeTurns = new Map<string, AbortController>();
process.env.AEOKIT_AGENT_ELECTRON = "1";
process.env.AEOKIT_AGENT_APP_ROOT = app.getAppPath();

function validSender(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (!url) return false;
  if (url.startsWith("file://")) return true;
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!devUrl) return false;
  try {
    return new URL(url).origin === new URL(devUrl).origin;
  } catch {
    return false;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    title: "AeoKit Agent",
    backgroundColor: "#ffffff",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(directory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (!url.startsWith("file://") && (!devUrl || !url.startsWith(devUrl))) {
      event.preventDefault();
    }
  });
  if (process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(directory, "../renderer/index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle(
    "runtime:request",
    async (
      event,
      input: {
        apiUrl: string;
        token: string;
        path: string;
        method: string;
        body?: string;
      },
    ) => {
      if (!validSender(event)) throw new Error("Invalid IPC sender");
      if (
        !input.path?.startsWith("/") ||
        !["GET", "POST", "DELETE"].includes(input.method)
      ) {
        throw new Error("Invalid runtime request");
      }
      const base = input.apiUrl.startsWith("/")
        ? `http://127.0.0.1:3000${input.apiUrl}`
        : input.apiUrl;
      const baseUrl = new URL(base);
      if (!["http:", "https:"].includes(baseUrl.protocol))
        throw new Error("Invalid API URL");
      const response = await fetch(`${base.replace(/\/+$/, "")}${input.path}`, {
        method: input.method,
        headers: {
          ...(input.body ? { "Content-Type": "application/json" } : {}),
          ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        },
        ...(input.body ? { body: input.body } : {}),
      });
      return {
        status: response.status,
        body:
          response.status === 204
            ? null
            : await response.json().catch(() => null),
      };
    },
  );
  ipcMain.handle("agents:list", (event) => {
    if (!validSender(event)) throw new Error("Invalid IPC sender");
    return agentProviders();
  });
  ipcMain.handle(
    "agents:prompt",
    async (
      event,
      input: {
        requestId: string;
        provider: ProviderId;
        model: string;
        context: string;
        history: Array<{ role: string; content: string }>;
        prompt: string;
      },
    ) => {
      if (!validSender(event)) throw new Error("Invalid IPC sender");
      if (!input || !["codex", "claude"].includes(input.provider))
        throw new Error("Invalid provider");
      if (!input.prompt?.trim() || input.prompt.length > 100_000)
        throw new Error("Invalid prompt");
      const provider = agentProviders().find(
        (item) => item.id === input.provider,
      )!;
      if (!provider.models.some((item) => item.id === input.model))
        throw new Error("Invalid model");
      const controller = new AbortController();
      activeTurns.set(input.requestId, controller);
      try {
        const transcript = input.history
          .slice(-20)
          .map(
            (message) =>
              `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`,
          )
          .join("\n\n");
        return await runAcpTurn(
          input.provider,
          input.model,
          `You are AeoKit Agent, an AEO analyst. Use the supplied AeoKit runtime evidence. Be concise, evidence-led, and never invent metrics. Do not inspect or modify files or run commands.\n\nAeoKit runtime context:\n${input.context}\n\nConversation:\n${transcript || "No earlier messages."}\n\nUser: ${input.prompt}`,
          controller.signal,
          (label) =>
            event.sender.send("agents:progress", {
              requestId: input.requestId,
              label,
            }),
        );
      } finally {
        activeTurns.delete(input.requestId);
      }
    },
  );
  ipcMain.handle("agents:cancel", (event, requestId: string) => {
    if (!validSender(event)) throw new Error("Invalid IPC sender");
    const active = activeTurns.get(requestId);
    if (!active) return false;
    active.abort();
    return true;
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
