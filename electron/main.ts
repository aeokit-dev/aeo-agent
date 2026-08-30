import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  agentProviders,
  runAcpTurn,
  type ProviderId,
} from "../server/acp-bridge";
import { buildAgentPrompt, type AgentMode } from "../shared/agent-experience";

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
  const developmentIcon = path.join(app.getAppPath(), "build", "icon.icns");
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    title: "AeoKit Agent",
    backgroundColor: "#ffffff",
    ...(!app.isPackaged ? { icon: developmentIcon } : {}),
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
  if (!app.isPackaged && process.platform === "darwin") {
    const icon = nativeImage.createFromPath(
      path.join(app.getAppPath(), "build", "icon.icns"),
    );
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
  const settingsPath = path.join(
    app.getPath("userData"),
    "connection-settings.json",
  );
  ipcMain.handle("settings:load", async (event) => {
    if (!validSender(event)) throw new Error("Invalid IPC sender");
    try {
      const value = JSON.parse(await readFile(settingsPath, "utf8")) as {
        apiUrl?: unknown;
        token?: unknown;
      };
      if (typeof value.apiUrl !== "string" || typeof value.token !== "string")
        return null;
      return { apiUrl: value.apiUrl, token: value.token };
    } catch {
      return null;
    }
  });
  ipcMain.handle(
    "settings:save",
    async (event, settings: { apiUrl?: unknown; token?: unknown }) => {
      if (!validSender(event)) throw new Error("Invalid IPC sender");
      if (
        typeof settings?.apiUrl !== "string" ||
        settings.apiUrl.length > 2_000 ||
        typeof settings.token !== "string" ||
        settings.token.length > 20_000
      )
        throw new Error("Invalid settings");
      await writeFile(
        settingsPath,
        JSON.stringify({ apiUrl: settings.apiUrl, token: settings.token }),
        { mode: 0o600 },
      );
    },
  );
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
        mode?: AgentMode;
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
        return await runAcpTurn(
          input.provider,
          input.model,
          buildAgentPrompt({
            context: input.context,
            history: input.history,
            prompt: input.prompt,
            mode: input.mode,
          }),
          controller.signal,
          (streamEvent) =>
            event.sender.send("agents:progress", {
              requestId: input.requestId,
              event: streamEvent,
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
