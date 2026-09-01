import { contextBridge, ipcRenderer } from "electron";
import type { AgentDesktopApi } from "../shared/electron-api";

const api: AgentDesktopApi = {
  platform: process.platform,
  listAgents: () => ipcRenderer.invoke("agents:list"),
  prompt: (input) => ipcRenderer.invoke("agents:prompt", input),
  cancel: (requestId) => ipcRenderer.invoke("agents:cancel", requestId),
  resolvePermission: (requestId, permissionId, optionId) =>
    ipcRenderer.invoke(
      "agents:resolve-permission",
      requestId,
      permissionId,
      optionId,
    ),
  onProgress: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<Parameters<AgentDesktopApi["onProgress"]>[0]>[0],
    ) => listener(value);
    ipcRenderer.on("agents:progress", handler);
    return () => ipcRenderer.removeListener("agents:progress", handler);
  },
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  runtimeRequest: (input) => ipcRenderer.invoke("runtime:request", input),
  checkForUpdate: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateStatus: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<Parameters<AgentDesktopApi["onUpdateStatus"]>[0]>[0],
    ) => listener(value);
    ipcRenderer.on("updates:status", handler);
    return () => ipcRenderer.removeListener("updates:status", handler);
  },
};

contextBridge.exposeInMainWorld("aeokitDesktop", api);
