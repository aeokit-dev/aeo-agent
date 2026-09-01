import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import {
  aeokitMcpServer,
  agentProviders,
  runAcpTurn,
  type ProviderId,
} from "../server/acp-bridge";
import { buildAgentPrompt, type AgentMode } from "../shared/agent-experience";
import type { DesktopUpdateStatus } from "../shared/electron-api";

const { autoUpdater } = electronUpdater;

const directory = path.dirname(fileURLToPath(import.meta.url));
const activeTurns = new Map<string, AbortController>();
const pendingPermissions = new Map<
  string,
  { requestId: string; resolve: (optionId?: string) => void }
>();
const updateCheckIntervalMs = 15 * 60 * 1000;
let updateStatus: DesktopUpdateStatus = {
  state: "idle",
  currentVersion: app.getVersion(),
};
let updateCheck: Promise<unknown> | null = null;
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

function validNavigation(url: string) {
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
    if (!validNavigation(url)) event.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(directory, "../renderer/index.html"));
}

function publishUpdateStatus(status: DesktopUpdateStatus) {
  updateStatus = status;
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send("updates:status", status);
}

function checkForUpdates() {
  if (!app.isPackaged || updateStatus.state === "downloaded")
    return Promise.resolve();
  if (updateCheck) return updateCheck;
  publishUpdateStatus({
    state: "checking",
    currentVersion: app.getVersion(),
  });
  updateCheck = autoUpdater.checkForUpdates().finally(() => {
    updateCheck = null;
  });
  return updateCheck;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    publishUpdateStatus({
      state: "available",
      currentVersion: app.getVersion(),
      latestVersion: info.version,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    publishUpdateStatus({
      state: "downloading",
      currentVersion: app.getVersion(),
      latestVersion: updateStatus.latestVersion,
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishUpdateStatus({
      state: "downloaded",
      currentVersion: app.getVersion(),
      latestVersion: info.version,
    });
  });
  autoUpdater.on("update-not-available", () => {
    publishUpdateStatus({
      state: "idle",
      currentVersion: app.getVersion(),
    });
  });
  autoUpdater.on("error", () => {
    publishUpdateStatus({
      state: "error",
      currentVersion: app.getVersion(),
      message: "Automatic update failed. It will try again later.",
    });
  });
  void checkForUpdates().catch(() => undefined);
  setInterval(
    () => void checkForUpdates().catch(() => undefined),
    updateCheckIntervalMs,
  );
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
        !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(input.method)
      ) {
        throw new Error("Invalid runtime request");
      }
      const base = input.apiUrl.startsWith("/")
        ? `http://127.0.0.1:3000${input.apiUrl}`
        : input.apiUrl;
      const baseUrl = new URL(base);
      if (!["http:", "https:"].includes(baseUrl.protocol))
        throw new Error("Invalid API URL");
      if (
        baseUrl.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)
      )
        throw new Error("Remote API URLs must use HTTPS");
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
        apiUrl: string;
        token: string;
      },
    ) => {
      if (!validSender(event)) throw new Error("Invalid IPC sender");
      if (!input || !["codex", "claude"].includes(input.provider))
        throw new Error("Invalid provider");
      if (!input.prompt?.trim() || input.prompt.length > 100_000)
        throw new Error("Invalid prompt");
      if (
        typeof input.apiUrl !== "string" ||
        input.apiUrl.length > 2_000 ||
        typeof input.token !== "string" ||
        input.token.length > 20_000
      )
        throw new Error("Invalid AeoKit connection");
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
          {
            mcpServer: aeokitMcpServer(input.apiUrl, input.token),
            onPermission: (permission) =>
              new Promise<string | undefined>((resolve) => {
                let settled = false;
                const finish = (optionId?: string) => {
                  if (settled) return;
                  settled = true;
                  controller.signal.removeEventListener("abort", cancel);
                  resolve(optionId);
                };
                const cancel = () => finish();
                controller.signal.addEventListener("abort", cancel, {
                  once: true,
                });
                pendingPermissions.set(permission.id, {
                  requestId: input.requestId,
                  resolve: finish,
                });
                event.sender.send("agents:progress", {
                  requestId: input.requestId,
                  event: {
                    type: "permission_request",
                    requestId: input.requestId,
                    ...permission,
                  },
                });
              }),
          },
        );
      } finally {
        for (const [id, pending] of pendingPermissions) {
          if (pending.requestId !== input.requestId) continue;
          pending.resolve();
          pendingPermissions.delete(id);
        }
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
  ipcMain.handle(
    "agents:resolve-permission",
    (event, requestId: string, permissionId: string, optionId: string) => {
      if (!validSender(event)) throw new Error("Invalid IPC sender");
      const pending = pendingPermissions.get(permissionId);
      if (!pending || pending.requestId !== requestId) return false;
      pendingPermissions.delete(permissionId);
      pending.resolve(optionId);
      return true;
    },
  );
  ipcMain.handle("updates:check", async (event) => {
    if (!validSender(event)) throw new Error("Invalid IPC sender");
    void checkForUpdates().catch(() => undefined);
    return updateStatus;
  });
  ipcMain.handle("updates:install", (event) => {
    if (!validSender(event)) throw new Error("Invalid IPC sender");
    if (updateStatus.state !== "downloaded") return false;
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
  });
  createWindow();
  configureAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
