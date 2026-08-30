import type { AgentDesktopApi } from "../shared/electron-api";

declare global {
  interface Window {
    aeokitDesktop?: AgentDesktopApi;
  }
}

export {};
