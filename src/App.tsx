import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  BarChart3,
  Check,
  ChevronRight,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AeoKitApi,
  initialSettings,
  isValidApiUrl,
  normalizeApiUrl,
  type ClientSettings,
} from "./api";
import { capabilities, defaultPrompts } from "./prompts";
import type {
  AeoKitAction,
  AgentPermissionRequest,
  ChatBackend,
  ChatMessage,
  ChatSession,
  Project,
  VisualizationArtifact,
} from "./types";
import { parseActions } from "./actions";
import { agentModes, type AgentMode } from "../shared/agent-experience";
import { parseContentBlocks, serializeContentForClipboard } from "./artifacts";
import type { AgentStreamEvent } from "../shared/streaming";
import type { DesktopUpdateStatus } from "../shared/electron-api";

const selectedProjectKey = "aeokit-agent-project";
const dismissedUpdateKey = "aeokit-agent-dismissed-update";
const chartColors = ["#5263d8", "#d96b3d", "#3a9b78", "#9a5bc4", "#c49a32"];
const seriesColor = (index: number, color?: string) =>
  color || chartColors[index % chartColors.length];
const safeLink = (href?: string) =>
  href && /^https:\/\//i.test(href) ? href : undefined;
const linkHostname = (href: string) => {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "Invalid link";
  }
};

function Logo() {
  return (
    <div className="logo" aria-label="AeoKit Agent">
      <img className="logo-mark" src="./aeokit-app-icon.svg" alt="" />
      <span>aeokit</span>
      <span className="logo-agent">Agent</span>
    </div>
  );
}

export function App() {
  const isMacDesktop = window.aeokitDesktop?.platform === "darwin";
  const [settings, setSettings] = useState(initialSettings);
  const api = useMemo(() => new AeoKitApi(settings), [settings]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(
    () => localStorage.getItem(selectedProjectKey) || "",
  );
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [backends, setBackends] = useState<ChatBackend[]>([]);
  const [backend, setBackend] = useState<ChatBackend["id"] | undefined>();
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<AgentMode>("optimize");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historySearchRef = useRef<HTMLInputElement>(null);
  const autoScrollRef = useRef(true);
  const activeTurnRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!window.aeokitDesktop) return;
    void window.aeokitDesktop.loadSettings().then((saved) => {
      if (saved) setSettings(saved);
    });
  }, []);

  useEffect(() => {
    if (!window.aeokitDesktop) return;
    const showUpdate = (status: DesktopUpdateStatus) => {
      if (
        status.latestVersion &&
        localStorage.getItem(dismissedUpdateKey) === status.latestVersion
      )
        return;
      setUpdateStatus(status);
    };
    const unsubscribe = window.aeokitDesktop.onUpdateStatus(showUpdate);
    void window.aeokitDesktop.checkForUpdate().then(showUpdate);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    const closeHistory = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", closeHistory);
    return () => window.removeEventListener("keydown", closeHistory);
  }, [historyOpen]);

  useEffect(() => {
    const focusHistorySearch = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]"))
        return;
      if (sessions.length <= 6) return;
      event.preventDefault();
      setHistoryOpen(true);
      requestAnimationFrame(() => historySearchRef.current?.focus());
    };
    window.addEventListener("keydown", focusHistorySearch);
    return () => window.removeEventListener("keydown", focusHistorySearch);
  }, [sessions.length]);

  const project = projects.find((item) => item.id === projectId);
  const activeSession = sessions.find((item) => item.id === sessionId);
  const visibleSessions = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    return query
      ? sessions.filter((item) =>
          item.title.toLocaleLowerCase().includes(query),
        )
      : sessions;
  }, [historyQuery, sessions]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    Promise.allSettled([api.projects(), api.backends(), api.acpBackends()])
      .then(([projectResult, runtimeResult, acpResult]) => {
        if (!live) return;
        const nextProjects =
          projectResult.status === "fulfilled" && projectResult.value.length
            ? projectResult.value
            : [{ id: "local-workspace", name: "Local workspace", website: "" }];
        const nextBackends = [
          ...(acpResult.status === "fulfilled" ? acpResult.value : []),
          ...(runtimeResult.status === "fulfilled" ? runtimeResult.value : []),
        ];
        setProjects(nextProjects);
        setBackends(nextBackends);
        setBackend(nextBackends[0]?.id);
        setModel(nextBackends[0]?.model || "");
        const saved = localStorage.getItem(selectedProjectKey);
        const nextId = nextProjects.some((item) => item.id === saved)
          ? saved!
          : nextProjects[0]?.id || "";
        setProjectId(nextId);
        if (!nextBackends.length)
          setError("No local ACP or AeoKit chat backend is available");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [api]);

  const selectBackend = (id: ChatBackend["id"]) => {
    setBackend(id);
    const selected = backends.find((item) => item.id === id);
    setModel(selected?.model || "");
  };

  useEffect(() => {
    if (!projectId) {
      setSessions([]);
      setSessionId(null);
      return;
    }
    setHistoryQuery("");
    localStorage.setItem(selectedProjectKey, projectId);
    if (projectId === "local-workspace") {
      setSessions([]);
      setSessionId(null);
      setMessages([]);
      return;
    }
    setLoading(true);
    api
      .sessions(projectId)
      .then((items) => {
        setSessions(items);
        setSessionId(null);
        setMessages([]);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [api, projectId]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    if (sessionId.startsWith("acp-")) return;
    setLoading(true);
    api
      .messages(sessionId)
      .then(setMessages)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [api, sessionId]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, sending]);

  async function send(content: string) {
    const prompt = content.trim();
    if (!prompt || sending || !projectId) return;
    autoScrollRef.current = true;
    setError("");
    setSending(true);
    setActivity([]);
    const turnController = new AbortController();
    activeTurnRef.current = turnController;
    try {
      const isAcp = backend === "codex" || backend === "claude";
      let targetId = sessionId;
      if (!targetId) {
        const now = new Date().toISOString();
        const created: ChatSession = isAcp
          ? {
              id: `acp-${crypto.randomUUID()}`,
              projectId,
              title: prompt.length > 52 ? `${prompt.slice(0, 51)}…` : prompt,
              createdAt: now,
              updatedAt: now,
            }
          : await api.createSession(projectId);
        targetId = created.id;
        setSessions((items) => [created, ...items]);
        setSessionId(created.id);
      }
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        sessionId: targetId,
        role: "user",
        content: prompt,
        citations: [],
        model: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((items) => [...items, optimistic]);
      if (isAcp) {
        let turnActivity = ["Loading project data from AeoKit"];
        const addActivity = (label: string) => {
          if (turnActivity.at(-1) !== label)
            turnActivity = [...turnActivity, label];
          setActivity(turnActivity);
        };
        setActivity(turnActivity);
        const context = await api.agentContext(
          projectId,
          project?.name || "Local workspace",
          projects,
          prompt,
          addActivity,
        );
        const assistantId = crypto.randomUUID();
        const assistantModel = `${backends.find((item) => item.id === backend)?.label || backend} · ${model}`;
        const streamingAssistant: ChatMessage = {
          id: assistantId,
          sessionId: targetId,
          role: "assistant",
          content: "",
          citations: [],
          model: assistantModel,
          createdAt: new Date().toISOString(),
          activity: turnActivity,
          toolCalls: [],
          streaming: true,
        };
        setMessages((items) => [...items, streamingAssistant]);
        const handleStreamEvent = (event: AgentStreamEvent) => {
          if (event.type === "activity") {
            addActivity(event.label);
            setMessages((items) =>
              items.map((item) =>
                item.id === assistantId
                  ? { ...item, activity: turnActivity }
                  : item,
              ),
            );
            return;
          }
          if (event.type === "error") return;
          setMessages((items) =>
            items.map((item) => {
              if (item.id !== assistantId) return item;
              if (event.type === "permission_request")
                return {
                  ...item,
                  permissions: [
                    ...(item.permissions || []).filter(
                      (value) => value.id !== event.id,
                    ),
                    { ...event, requestId: event.requestId },
                  ],
                };
              if (event.type === "text_delta")
                return { ...item, content: item.content + event.delta };
              if (event.type === "done")
                return {
                  ...item,
                  content: event.answer,
                  activity: turnActivity,
                  streaming: false,
                };
              if (event.type === "tool_call") {
                const tool = {
                  id: event.id,
                  name: event.name,
                  label: event.label,
                  status: event.status,
                  ...(event.summary ? { summary: event.summary } : {}),
                };
                return {
                  ...item,
                  toolCalls: [
                    ...(item.toolCalls || []).filter(
                      (value) => value.id !== event.id,
                    ),
                    tool,
                  ],
                };
              }
              return item;
            }),
          );
        };
        const answer = await api.acpSend(
          backend,
          model,
          context,
          messages.map(({ role, content: value }) => ({
            role,
            content: value,
          })),
          prompt,
          mode,
          handleStreamEvent,
          turnController.signal,
        );
        const parsed = parseActions(answer);
        setMessages((items) =>
          items.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content: parsed.content,
                  actions: parsed.actions,
                  activity: turnActivity,
                  streaming: false,
                }
              : item,
          ),
        );
        return;
      }
      const response = await api.send(targetId, prompt, backend);
      const parsedResponse = parseActions(response.assistantMessage.content);
      response.assistantMessage = {
        ...response.assistantMessage,
        content: parsedResponse.content,
        actions: parsedResponse.actions,
      };
      setMessages((items) => [
        ...items.filter((item) => item.id !== optimistic.id),
        response.userMessage,
        response.assistantMessage,
      ]);
      if (response.uiActions?.length) {
        setMessages((items) =>
          items.map((item) =>
            item.id === response.assistantMessage.id
              ? { ...item, uiActions: response.uiActions }
              : item,
          ),
        );
      }
      setSessions((items) => [
        response.session,
        ...items.filter((item) => item.id !== response.session.id),
      ]);
    } catch (reason) {
      if (turnController.signal.aborted) {
        setMessages((items) =>
          items.map((item) =>
            item.streaming ? { ...item, streaming: false } : item,
          ),
        );
        return;
      }
      setMessages((items) =>
        items.filter((item) => !item.id.startsWith("local-")),
      );
      setError(reason instanceof Error ? reason.message : "The request failed");
    } finally {
      if (activeTurnRef.current === turnController)
        activeTurnRef.current = null;
      setSending(false);
      setActivity([]);
    }
  }

  const stopGenerating = () => activeTurnRef.current?.abort();

  async function removeSession(id: string) {
    try {
      if (!id.startsWith("acp-")) await api.deleteSession(id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The chat could not be deleted",
      );
      return;
    }
    setSessions((items) => items.filter((item) => item.id !== id));
    if (sessionId === id) {
      setSessionId(null);
      setMessages([]);
    }
  }

  async function saveSettings(next: ClientSettings) {
    const normalized = { ...next, apiUrl: normalizeApiUrl(next.apiUrl) };
    await window.aeokitDesktop?.saveSettings(normalized);
    localStorage.setItem("aeokit-agent-settings", JSON.stringify(normalized));
    setSettings(normalized);
    setSettingsOpen(false);
  }

  const startNew = () => {
    autoScrollRef.current = true;
    setPendingDeleteId(null);
    setSessionId(null);
    setMessages([]);
    setHistoryOpen(false);
  };
  const showWelcome = !sessionId && messages.length === 0;
  const hasStreamingMessage = messages.some((message) => message.streaming);
  const connectionState = loading
    ? { label: "Connecting to agent runtimes…", className: "is-loading" }
    : backends.length
      ? { label: "Agent runtime available", className: "is-connected" }
      : { label: "Runtime unavailable — configure", className: "is-offline" };

  return (
    <div className={`app-shell ${isMacDesktop ? "macos-desktop" : ""}`}>
      <header className="topbar">
        <div className="topbar-left">
          <Logo />
          <span className="divider" />
          <label className="project-picker">
            <span className="project-dot" />
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              aria-label="Project"
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        <div className="top-actions">
          <button
            className="icon-button mobile-only"
            onClick={() => setHistoryOpen(true)}
            aria-label="Open history"
            aria-controls="chat-history"
            aria-expanded={historyOpen}
          >
            <Menu size={18} />
          </button>
          <button className="secondary-button" onClick={startNew}>
            <Plus size={15} /> New chat
          </button>
          <button
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Connection settings"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {updateStatus &&
        ["available", "downloading", "downloaded", "error"].includes(
          updateStatus.state,
        ) && (
          <UpdateBanner
            update={updateStatus}
            onInstall={() => void window.aeokitDesktop?.installUpdate()}
            onDismiss={() => {
              if (updateStatus.latestVersion)
                localStorage.setItem(
                  dismissedUpdateKey,
                  updateStatus.latestVersion,
                );
              setUpdateStatus(null);
            }}
          />
        )}

      <div className="workspace">
        <aside
          id="chat-history"
          className={`history ${historyOpen ? "history-open" : ""}`}
        >
          <div className="history-head">
            <span>Chats</span>
            <button
              className="icon-button mobile-only"
              onClick={() => setHistoryOpen(false)}
              aria-label="Close history"
            >
              <X size={16} />
            </button>
          </div>
          <button
            className={`history-item ${!sessionId ? "active" : ""}`}
            onClick={startNew}
          >
            <span className="history-icon">
              <Plus size={14} />
            </span>
            <span>New chat</span>
          </button>
          {sessions.length > 6 && (
            <label className="history-search">
              <Search size={13} />
              <input
                ref={historySearchRef}
                type="search"
                value={historyQuery}
                onChange={(event) => {
                  setHistoryQuery(event.target.value);
                  setPendingDeleteId(null);
                }}
                placeholder="Search chats"
                aria-label="Search chats"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  if (historyQuery) {
                    event.stopPropagation();
                    setHistoryQuery("");
                  } else setHistoryOpen(false);
                }}
              />
              {historyQuery && (
                <button
                  type="button"
                  onClick={() => setHistoryQuery("")}
                  aria-label="Clear chat search"
                >
                  <X size={12} />
                </button>
              )}
              {!historyQuery && <kbd>/</kbd>}
            </label>
          )}
          <div className="history-label">
            <span>
              <Clock3 size={12} /> {historyQuery ? "Results" : "Recent"}
            </span>
            <small
              role="status"
              aria-live="polite"
              aria-label={`${visibleSessions.length} ${visibleSessions.length === 1 ? "chat" : "chats"}`}
            >
              {visibleSessions.length}
            </small>
          </div>
          <div className="history-list">
            {!visibleSessions.length && !loading && (
              <div className="history-empty">
                <MessageSquare size={16} />
                <span>
                  {historyQuery ? "No matching chats" : "No recent chats yet"}
                </span>
                <small>
                  {historyQuery
                    ? "Try another search."
                    : "Your conversations will appear here."}
                </small>
              </div>
            )}
            {visibleSessions.map((session) => (
              <div
                className={`history-row ${session.id === sessionId ? "active" : ""}`}
                key={session.id}
              >
                <button
                  onClick={() => {
                    autoScrollRef.current = true;
                    setPendingDeleteId(null);
                    setSessionId(session.id);
                    setHistoryOpen(false);
                  }}
                  aria-current={session.id === sessionId ? "page" : undefined}
                  title={session.title}
                >
                  <MessageSquare size={14} />
                  <span>{session.title}</span>
                </button>
                <button
                  className={`delete-chat ${pendingDeleteId === session.id ? "confirm-delete" : ""}`}
                  onClick={() => {
                    if (pendingDeleteId !== session.id) {
                      setPendingDeleteId(session.id);
                      return;
                    }
                    void removeSession(session.id).finally(() =>
                      setPendingDeleteId(null),
                    );
                  }}
                  onBlur={() =>
                    pendingDeleteId === session.id && setPendingDeleteId(null)
                  }
                  aria-label={
                    pendingDeleteId === session.id
                      ? `Confirm delete ${session.title}`
                      : `Delete ${session.title}`
                  }
                >
                  {pendingDeleteId === session.id ? (
                    <>
                      <Check size={12} /> Confirm
                    </>
                  ) : (
                    <Trash2 size={13} />
                  )}
                </button>
              </div>
            ))}
          </div>
          <button
            className={`history-footer ${connectionState.className}`}
            onClick={() => !backends.length && setSettingsOpen(true)}
            disabled={loading || !!backends.length}
            aria-label={connectionState.label}
          >
            <span className="status-dot" />
            <span role="status" aria-live="polite">
              {connectionState.label}
            </span>
          </button>
        </aside>

        <main
          className="chat"
          onScroll={(event) => {
            const container = event.currentTarget;
            autoScrollRef.current =
              container.scrollHeight -
                container.scrollTop -
                container.clientHeight <
              120;
          }}
        >
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={14} />
              </button>
            </div>
          )}
          {loading && !messages.length ? (
            <div className="center-loader">
              <LoaderCircle className="spin" />
            </div>
          ) : showWelcome ? (
            <Welcome
              project={project}
              onSend={send}
              disabled={!projects.length || !backends.length}
              backends={backends}
              backend={backend}
              model={model}
              onBackendChange={selectBackend}
              onModelChange={setModel}
              mode={mode}
              onModeChange={setMode}
            />
          ) : (
            <div className="thread-wrap">
              <div className="thread-header">
                <div>
                  <span className="eyebrow">AeoKit Agent</span>
                  <h1 title={activeSession?.title || "New chat"}>
                    {activeSession?.title || "New chat"}
                  </h1>
                </div>
                {backends.length > 1 && (
                  <BackendPicker
                    backends={backends}
                    value={backend}
                    onChange={selectBackend}
                    model={model}
                    onModelChange={setModel}
                  />
                )}
              </div>
              <div className="messages">
                {messages.map((message) => (
                  <Message key={message.id} message={message} api={api} />
                ))}
                {sending && !hasStreamingMessage && (
                  <Thinking activity={activity} />
                )}
                <div ref={bottomRef} />
              </div>
              <Composer
                onSend={send}
                sending={sending}
                backend={backends.find((item) => item.id === backend)}
                model={model}
                backends={backends}
                onBackendChange={selectBackend}
                onModelChange={setModel}
                mode={mode}
                onModeChange={setMode}
                onStop={
                  backend === "codex" || backend === "claude"
                    ? stopGenerating
                    : undefined
                }
              />
            </div>
          )}
        </main>
      </div>
      {historyOpen && (
        <button
          className="scrim"
          onClick={() => setHistoryOpen(false)}
          aria-label="Close history"
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

export function UpdateBanner({
  update,
  onInstall,
  onDismiss,
}: {
  update: DesktopUpdateStatus;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const version = update.latestVersion || "new version";
  const downloaded = update.state === "downloaded";
  const downloading = update.state === "downloading";
  return (
    <div className="update-banner" role="status">
      <div>
        <strong>
          {downloaded
            ? `AeoKit Agent ${version} is ready`
            : downloading
              ? `Downloading AeoKit Agent ${version}`
              : update.state === "error"
                ? "Automatic update paused"
                : `AeoKit Agent ${version} is available`}
        </strong>
        <span>
          {downloaded
            ? "Restart to finish installing."
            : downloading
              ? `${update.percent ?? 0}% complete`
              : update.message || `You’re using ${update.currentVersion}.`}
        </span>
      </div>
      <div className="update-actions">
        {downloaded && <button onClick={onInstall}>Restart and update</button>}
        <button onClick={onDismiss} aria-label="Dismiss update">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function Welcome({
  project,
  onSend,
  disabled,
  backends,
  backend,
  model,
  onBackendChange,
  onModelChange,
  mode,
  onModeChange,
}: {
  project?: Project;
  onSend: (value: string) => void;
  disabled: boolean;
  backends: ChatBackend[];
  backend?: ChatBackend["id"];
  model: string;
  onBackendChange: (value: ChatBackend["id"]) => void;
  onModelChange: (value: string) => void;
  mode: AgentMode;
  onModeChange: (value: AgentMode) => void;
}) {
  const [active, setActive] = useState(capabilities[0].key);
  const capability = capabilities.find((item) => item.key === active)!;
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <Sparkles size={23} />
      </div>
      <h1>What can I help you with?</h1>
      <p>
        Explore {project?.name || "your brand"}’s AI visibility, research
        competitors, and turn evidence into action.
      </p>
      <Composer
        onSend={onSend}
        disabled={disabled}
        large
        autoFocus
        backend={backends.find((item) => item.id === backend)}
        model={model}
        backends={backends}
        onBackendChange={onBackendChange}
        onModelChange={onModelChange}
        mode={mode}
        onModeChange={onModeChange}
      />
      <div className="try-label">Try AeoKit Agent for…</div>
      <div className="capability-tabs">
        {capabilities.map(({ key, label, icon: Icon }) => (
          <button
            className={active === key ? "active" : ""}
            onClick={() => setActive(key)}
            key={key}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="prompt-grid">
        {(capability?.prompts || defaultPrompts).map((prompt) => (
          <button key={prompt.title} onClick={() => onSend(prompt.content)}>
            <span className="prompt-icon">
              <capability.icon size={15} />
            </span>
            <span>
              <strong>{prompt.title}</strong>
              <small>{prompt.description}</small>
            </span>
          </button>
        ))}
      </div>
      <p className="ai-notice">
        AeoKit Agent can make mistakes. Check important information.
      </p>
    </div>
  );
}

export function Composer({
  onSend,
  sending = false,
  disabled = false,
  large = false,
  autoFocus = false,
  backend,
  model,
  backends = [],
  onBackendChange,
  onModelChange,
  mode = "product_analytics",
  onModeChange,
  onStop,
}: {
  onSend: (value: string) => void;
  sending?: boolean;
  disabled?: boolean;
  large?: boolean;
  autoFocus?: boolean;
  backend?: ChatBackend;
  model?: string;
  backends?: ChatBackend[];
  onBackendChange?: (value: ChatBackend["id"]) => void;
  onModelChange?: (value: string) => void;
  mode?: AgentMode;
  onModeChange?: (value: AgentMode) => void;
  onStop?: () => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (value.trim() && !sending && !disabled) {
      onSend(value);
      setValue("");
      requestAnimationFrame(resizeTextarea);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <form
      className={`composer ${large ? "composer-large" : ""}`}
      onSubmit={submit}
    >
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          requestAnimationFrame(resizeTextarea);
        }}
        onKeyDown={keyDown}
        placeholder="Ask AeoKit anything…"
        aria-label="Message"
        rows={large ? 2 : 1}
        disabled={disabled}
      />
      <div className="composer-bottom">
        <div className="composer-controls">
          {onModeChange && (
            <label className="mode-picker" title="Agent mode">
              <Sparkles size={12} />
              <select
                value={mode}
                onChange={(event) =>
                  onModeChange(event.target.value as AgentMode)
                }
                aria-label="Agent mode"
              >
                {agentModes.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={11} />
            </label>
          )}
          {backend && onBackendChange && onModelChange ? (
            <BackendPicker
              backends={backends}
              value={backend.id}
              onChange={onBackendChange}
              model={model || backend.model}
              onModelChange={onModelChange}
              compact
            />
          ) : (
            <span>Project data + web research</span>
          )}
        </div>
        <span className="composer-hint">
          Enter to send · Shift+Enter for new line
        </span>
        <button
          type={sending && onStop ? "button" : "submit"}
          onClick={sending && onStop ? onStop : undefined}
          disabled={sending ? !onStop : !value.trim() || disabled}
          aria-label={sending && onStop ? "Stop generating" : "Send message"}
          className={sending && onStop ? "stop-button" : undefined}
        >
          {sending && onStop ? (
            <Square size={13} fill="currentColor" />
          ) : sending ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <ArrowUp size={17} />
          )}
        </button>
      </div>
    </form>
  );
}

export function Message({
  message,
  api,
}: {
  message: ChatMessage;
  api?: AeoKitApi;
}) {
  if (message.role === "user")
    return (
      <div className="message user-message">
        <div>{message.content}</div>
      </div>
    );
  const contentBlocks = parseContentBlocks(message.content);
  return (
    <article className="message assistant-message">
      <div className="assistant-avatar">
        <Sparkles size={14} />
      </div>
      <div className="assistant-body">
        {!!message.activity?.length &&
          (message.streaming ? (
            <LiveActivity steps={message.activity} />
          ) : (
            <ActivityTrace steps={message.activity} />
          ))}
        {contentBlocks.map((block, index) =>
          block.type === "markdown" ? (
            <ReactMarkdown
              key={`markdown-${index}`}
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  const url = safeLink(href);
                  return url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ) : (
                    <span>{children}</span>
                  );
                },
              }}
            >
              {block.content}
            </ReactMarkdown>
          ) : (
            <VisualizationCard
              artifact={block.artifact}
              key={`artifact-${index}`}
            />
          ),
        )}
        {message.toolCalls?.map((tool) => (
          <div className={`tool-call ${tool.status}`} key={tool.id}>
            {tool.status === "completed" ? (
              <Check size={13} />
            ) : (
              <LoaderCircle className="spin" size={13} />
            )}
            <span>
              <strong>{tool.label}</strong>
              {tool.summary && <small>{tool.summary}</small>}
            </span>
          </div>
        ))}
        {(message.artifacts || []).map((artifact, index) => (
          <VisualizationCard
            artifact={artifact}
            key={`${message.id}-artifact-${index}`}
          />
        ))}
        {!!message.uiActions?.length && (
          <div className="ui-actions">
            {message.uiActions.map((action, index) => (
              <button
                key={`${action.type}-${index}`}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("aeokit:ui-action", { detail: action }),
                  );
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        {message.approval && <ApprovalCard approval={message.approval} />}
        {!!message.actions?.length && api && (
          <div className="action-list">
            {message.actions.map((action) => (
              <ActionCard action={action} api={api} key={action.id} />
            ))}
          </div>
        )}
        {!!message.permissions?.length && (
          <div className="action-list">
            {message.permissions.map((permission) => (
              <PermissionCard permission={permission} key={permission.id} />
            ))}
          </div>
        )}
        {message.citations?.length > 0 && (
          <div className="sources">
            <span>Sources</span>
            <div>
              {message.citations.map((citation, index) =>
                (() => {
                  const url = safeLink(citation.url);
                  const label = citation.title || citation.domain;
                  const contents = (
                    <>
                      <span className="source-number">{index + 1}</span>
                      <span className="source-copy">
                        <strong title={label}>{label}</strong>
                        <small>{linkHostname(citation.url)}</small>
                      </span>
                      {url && <ExternalLink size={11} />}
                    </>
                  );
                  return url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      key={`${citation.url}-${index}`}
                    >
                      {contents}
                    </a>
                  ) : (
                    <span
                      className="source-disabled"
                      key={`${citation.url}-${index}`}
                      title="This citation has an invalid destination"
                    >
                      {contents}
                    </span>
                  );
                })(),
              )}
            </div>
          </div>
        )}
        {message.model && !message.streaming && (
          <div className="model-label">
            Answered by {message.model.replace(/:online$/, "")}
          </div>
        )}
        {!message.streaming && (
          <MessageActions
            messageId={message.id}
            content={serializeContentForClipboard(message.content)}
          />
        )}
      </div>
    </article>
  );
}

export function PermissionCard({
  permission,
}: {
  permission: AgentPermissionRequest;
}) {
  const [status, setStatus] = useState<"pending" | "allowed" | "rejected">(
    "pending",
  );
  const choose = async (optionId: string) => {
    const option = permission.options.find(
      (value) => value.optionId === optionId,
    );
    const accepted = await window.aeokitDesktop?.resolvePermission(
      permission.requestId,
      permission.id,
      optionId,
    );
    if (accepted)
      setStatus(option?.kind.startsWith("allow") ? "allowed" : "rejected");
  };
  return (
    <section className="approval-card medium">
      <div>
        <strong>{permission.title}</strong>
        <p>{permission.name}</p>
        {permission.input !== undefined && (
          <pre>{JSON.stringify(permission.input, null, 2)}</pre>
        )}
      </div>
      {status === "pending" ? (
        <div className="approval-actions">
          {permission.options.map((option) => (
            <button
              className={option.kind === "allow_once" ? "approve" : undefined}
              key={option.optionId}
              onClick={() => void choose(option.optionId)}
            >
              {option.name}
            </button>
          ))}
        </div>
      ) : (
        <div className={`approval-status ${status}`} role="status">
          <strong>{status === "allowed" ? "Approved" : "Rejected"}</strong>
        </div>
      )}
    </section>
  );
}

export function ActionCard({
  action,
  api,
}: {
  action: AeoKitAction;
  api: AeoKitApi;
}) {
  const storageKey = `aeokit-action-${action.id}`;
  const [status, setStatus] = useState<
    "pending" | "running" | "completed" | "rejected" | "failed"
  >(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === "completed" || stored === "rejected" ? stored : "pending";
  });
  const [detail, setDetail] = useState("");
  const run = async () => {
    setStatus("running");
    setDetail("");
    try {
      const result = await api.executeAction(
        action.method,
        action.path,
        action.body,
      );
      localStorage.setItem(storageKey, "completed");
      setStatus("completed");
      setDetail(
        result && typeof result === "object"
          ? JSON.stringify(result).slice(0, 500)
          : "AeoKit accepted the action.",
      );
    } catch (reason) {
      setStatus("failed");
      setDetail(reason instanceof Error ? reason.message : "The action failed");
    }
  };
  const reject = () => {
    localStorage.setItem(storageKey, "rejected");
    setStatus("rejected");
  };
  return (
    <section className={`approval-card ${action.risk}`}>
      <div>
        <strong>{action.title}</strong>
        <p>{action.description}</p>
        <code>
          {action.method} {action.path}
        </code>
      </div>
      {status === "pending" ? (
        <div className="approval-actions">
          <button onClick={reject}>Reject</button>
          <button className="approve" onClick={() => void run()}>
            Approve and run
          </button>
        </div>
      ) : (
        <div className={`approval-status ${status}`} role="status">
          <strong>
            {status === "running"
              ? "Running…"
              : status === "completed"
                ? "Completed"
                : status === "rejected"
                  ? "Rejected"
                  : "Failed"}
          </strong>
          {detail && <small>{detail}</small>}
          {status === "failed" && (
            <button onClick={() => void run()}>Try again</button>
          )}
        </div>
      )}
    </section>
  );
}

export function VisualizationCard({
  artifact,
}: {
  artifact: VisualizationArtifact;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = useId();
  const xKey = artifact.xKey || "label";
  const numericValues = artifact.data.flatMap((row) =>
    artifact.series.map((series) => Number(row[series.key]) || 0),
  );
  const minimum = Math.min(0, ...numericValues);
  const maximum = Math.max(0, ...numericValues);
  const maximumMagnitude = Math.max(1, ...numericValues.map(Math.abs));
  return (
    <section className="visualization-card">
      <header>
        <span className="visualization-icon">
          <BarChart3 size={15} />
        </span>
        <span>
          <strong>{artifact.title}</strong>
          {artifact.description && <small>{artifact.description}</small>}
        </span>
        <button
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand chart" : "Collapse chart"}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
        >
          <ChevronRight className={collapsed ? "" : "expanded"} size={15} />
        </button>
      </header>
      {!collapsed && (
        <div className="visualization-body" id={bodyId}>
          {artifact.type === "metric" ? (
            <div className="metric-value">
              {String(artifact.data[0]?.[artifact.series[0]?.key] ?? "–")}
              {artifact.unit || ""}
            </div>
          ) : artifact.type === "table" ? (
            <div className="artifact-table-wrap">
              <table>
                <caption className="sr-only">{artifact.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{xKey}</th>
                    {artifact.series.map((series) => (
                      <th scope="col" key={series.key}>
                        {series.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {artifact.data.map((row, index) => (
                    <tr key={index}>
                      <th scope="row">{String(row[xKey] ?? "")}</th>
                      {artifact.series.map((series) => (
                        <td key={series.key}>
                          {String(row[series.key] ?? "–")}
                          {artifact.unit || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : artifact.type === "bar" ? (
            <div className="bar-chart">
              {artifact.data.map((row, index) => (
                <div className="bar-group" key={index}>
                  <span className="bar-label">{String(row[xKey] ?? "")}</span>
                  <div className="bar-series">
                    {artifact.series.map((series, seriesIndex) => {
                      const value = Number(row[series.key]) || 0;
                      return (
                        <div
                          className={`bar-row ${value < 0 ? "negative" : ""}`}
                          key={series.key}
                          title={`${series.label}: ${value}${artifact.unit || ""}`}
                          aria-label={`${series.label}: ${value}${artifact.unit || ""}`}
                          role="img"
                        >
                          <i
                            style={{
                              width: `${Math.max(2, (Math.abs(value) / maximumMagnitude) * 100)}%`,
                              background:
                                value < 0
                                  ? "#c55454"
                                  : seriesColor(seriesIndex, series.color),
                            }}
                          />
                          <em>
                            {value}
                            {artifact.unit || ""}
                          </em>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <LineChart
              artifact={artifact}
              minimum={minimum}
              maximum={maximum}
            />
          )}
          {artifact.series.length > 1 && (
            <div className="chart-legend">
              {artifact.series.map((series, seriesIndex) => (
                <span key={series.key}>
                  <i
                    style={{
                      background: seriesColor(seriesIndex, series.color),
                    }}
                  />
                  {series.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ApprovalCard({
  approval,
}: {
  approval: NonNullable<ChatMessage["approval"]>;
}) {
  const storageKey = `aeokit-approval-${approval.id}`;
  const [status, setStatus] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === "approved" || stored === "rejected"
      ? stored
      : approval.status;
  });
  const decide = (decision: "approved" | "rejected") => {
    localStorage.setItem(storageKey, decision);
    setStatus(decision);
  };
  return (
    <section className={`approval-card ${approval.risk}`}>
      <div>
        <strong>{approval.title}</strong>
        <p>{approval.description}</p>
      </div>
      {status === "pending" ? (
        <div>
          <p className="approval-note">
            Saves your decision locally; no external action will run.
          </p>
          <div className="approval-actions">
            <button onClick={() => decide("rejected")}>Mark rejected</button>
            <button className="approve" onClick={() => decide("approved")}>
              Mark approved
            </button>
          </div>
        </div>
      ) : (
        <div className={`approval-status ${status}`} role="status">
          <strong>
            {status === "approved" ? "Approved locally" : "Rejected locally"}
          </strong>
          <small>Saved on this device; no external action was run.</small>
        </div>
      )}
    </section>
  );
}

function LineChart({
  artifact,
  minimum,
  maximum,
}: {
  artifact: VisualizationArtifact;
  minimum: number;
  maximum: number;
}) {
  const width = 640;
  const height = 220;
  const padding = 24;
  const xKey = artifact.xKey || "label";
  const denominator = Math.max(1, artifact.data.length - 1);
  const range = Math.max(1, maximum - minimum);
  const tickEvery = Math.max(1, Math.ceil(artifact.data.length / 6));
  const descriptionId = useId();
  return (
    <div className="line-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={artifact.title}
        aria-describedby={descriptionId}
      >
        {[0, 0.5, 1].map((point) => (
          <line
            key={point}
            x1={padding}
            x2={width - padding}
            y1={padding + point * (height - padding * 2)}
            y2={padding + point * (height - padding * 2)}
          />
        ))}
        {artifact.series.map((series, seriesIndex) => {
          const points = artifact.data
            .map((row, index) => {
              const x = padding + (index / denominator) * (width - padding * 2);
              const y =
                height -
                padding -
                (((Number(row[series.key]) || 0) - minimum) / range) *
                  (height - padding * 2);
              return `${x},${y}`;
            })
            .join(" ");
          return (
            <polyline
              key={series.key}
              points={points}
              style={{ stroke: seriesColor(seriesIndex, series.color) }}
            />
          );
        })}
        {artifact.data.map((row, index) =>
          index % tickEvery === 0 || index === artifact.data.length - 1 ? (
            <text
              key={index}
              x={padding + (index / denominator) * (width - padding * 2)}
              y={height - 5}
            >
              {String(row[xKey] ?? "")}
            </text>
          ) : null,
        )}
      </svg>
      <table className="sr-only" id={descriptionId}>
        <caption>{artifact.title}</caption>
        <thead>
          <tr>
            <th scope="col">{xKey}</th>
            {artifact.series.map((series) => (
              <th scope="col" key={series.key}>
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {artifact.data.map((row, index) => (
            <tr key={index}>
              <th scope="row">{String(row[xKey] ?? "")}</th>
              {artifact.series.map((series) => (
                <td key={series.key}>
                  {String(row[series.key] ?? "–")}
                  {artifact.unit || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTrace({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className={`activity-trace ${open ? "open" : ""}`}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailsId}
      >
        <ChevronRight size={12} />
        <span>{steps.length} activities</span>
        <small>Completed</small>
      </button>
      {open && (
        <div className="activity-trace-list" id={detailsId}>
          {steps.map((step, index) => (
            <div key={`${step}-${index}`}>
              <Check size={11} />
              <span>{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveActivity({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const current = steps.at(-1) || "Thinking";
  return (
    <div className={`live-activity ${open ? "open" : ""}`}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailsId}
      >
        <LoaderCircle className="spin" size={13} />
        <span>{current}</span>
        {steps.length > 1 && <small>{steps.length} activities</small>}
        <ChevronRight size={11} />
      </button>
      {open && (
        <div className="live-activity-details" id={detailsId}>
          {steps.slice(0, -1).map((step, index) => (
            <div key={`${step}-${index}`}>
              <Check size={10} />
              <span>{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageActions({
  messageId,
  content,
}: {
  messageId: string;
  content: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const ratingKey = `aeokit-rating-${messageId}`;
  const [rating, setRating] = useState<"up" | "down" | null>(() => {
    const stored = localStorage.getItem(ratingKey);
    return stored === "up" || stored === "down" ? stored : null;
  });
  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  };
  const rateAnswer = (next: "up" | "down") => {
    const value = rating === next ? null : next;
    if (value) localStorage.setItem(ratingKey, value);
    else localStorage.removeItem(ratingKey);
    setRating(value);
  };
  return (
    <div className="message-actions">
      <button
        aria-label={
          copyState === "copied"
            ? "Answer copied"
            : copyState === "error"
              ? "Copy failed"
              : "Copy answer"
        }
        title="Copy answer"
        onClick={() => void copyAnswer()}
      >
        {copyState === "copied" ? (
          <Check size={12} />
        ) : copyState === "error" ? (
          <X size={12} />
        ) : (
          <Copy size={12} />
        )}
      </button>
      {copyState !== "idle" && (
        <span className={`copy-status ${copyState}`} role="status">
          {copyState === "copied" ? "Copied" : "Copy failed"}
        </span>
      )}
      <button
        className={rating === "up" ? "selected" : ""}
        aria-label="Helpful answer"
        aria-pressed={rating === "up"}
        title="Save helpful rating on this device"
        onClick={() => rateAnswer("up")}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        className={rating === "down" ? "selected" : ""}
        aria-label="Unhelpful answer"
        aria-pressed={rating === "down"}
        title="Save unhelpful rating on this device"
        onClick={() => rateAnswer("down")}
      >
        <ThumbsDown size={12} />
      </button>
      {rating && (
        <span className="rating-status" role="status">
          Saved locally
        </span>
      )}
    </div>
  );
}

function Thinking({ activity }: { activity: string[] }) {
  const steps = activity.length ? activity : ["Preparing your request"];
  return (
    <div className="message assistant-message">
      <div className="assistant-avatar">
        <Sparkles size={14} />
      </div>
      <div className="assistant-body" aria-live="polite">
        <LiveActivity steps={steps} />
      </div>
    </div>
  );
}

function BackendPicker({
  backends,
  value,
  onChange,
  model,
  onModelChange,
  compact = false,
}: {
  backends: ChatBackend[];
  value?: ChatBackend["id"];
  onChange: (value: ChatBackend["id"]) => void;
  model: string;
  onModelChange: (value: string) => void;
  compact?: boolean;
}) {
  const selected = backends.find((item) => item.id === value);
  const models = selected?.models?.length
    ? selected.models
    : selected
      ? [{ id: selected.model, label: selected.model }]
      : [];
  return (
    <div className={`agent-selectors ${compact ? "compact" : ""}`}>
      <label className="backend-picker">
        <span className="sr-only">Provider</span>
        <select
          aria-label="Provider"
          value={value}
          onChange={(event) =>
            onChange(event.target.value as ChatBackend["id"])
          }
        >
          {backends.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </label>
      <label className="backend-picker model-picker">
        <span className="sr-only">Model</span>
        <select
          aria-label="Model"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
        >
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </label>
    </div>
  );
}

export function SettingsDialog({
  settings,
  onSave,
  onClose,
}: {
  settings: ClientSettings;
  onSave: (value: ClientSettings) => void | Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [validationError, setValidationError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const apiUrlRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    apiUrlRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!saving) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onKeyDown={handleDialogKeyDown}
    >
      <button
        className="modal-scrim"
        onClick={onClose}
        aria-label="Close connection settings"
        tabIndex={-1}
        disabled={saving}
      />
      <form
        ref={dialogRef}
        className="settings-card"
        aria-busy={saving}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!isValidApiUrl(draft.apiUrl)) {
            setValidationError(
              "Use HTTPS, a local HTTP address, or a path such as /api.",
            );
            apiUrlRef.current?.focus();
            return;
          }
          setSaving(true);
          setSaveError("");
          try {
            await onSave(draft);
          } catch (reason) {
            setSaveError(
              reason instanceof Error
                ? reason.message
                : "Settings could not be saved. Try again.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="settings-title">
          <div>
            <h2 id="settings-title">Connection settings</h2>
            <p>Connect this client to an AeoKit API runtime.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close connection settings"
            disabled={saving}
          >
            <X size={17} />
          </button>
        </div>
        <label>
          API URL
          <input
            ref={apiUrlRef}
            value={draft.apiUrl}
            onChange={(event) => {
              setDraft({ ...draft, apiUrl: event.target.value });
              setValidationError("");
            }}
            placeholder="http://localhost:3000/api"
            spellCheck={false}
            aria-invalid={!!validationError}
            aria-describedby={validationError ? "api-url-error" : undefined}
            required
          />
          {validationError && (
            <small className="field-error" id="api-url-error" role="alert">
              {validationError}
            </small>
          )}
        </label>
        <label>
          Bearer token <span>optional for self-hosted</span>
          <div className="secret-input">
            <input
              type={tokenVisible ? "text" : "password"}
              value={draft.token}
              onChange={(event) =>
                setDraft({ ...draft, token: event.target.value })
              }
              placeholder="Paste a runtime token"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setTokenVisible((value) => !value)}
              aria-label={
                tokenVisible ? "Hide bearer token" : "Show bearer token"
              }
              title={tokenVisible ? "Hide token" : "Show token"}
            >
              {tokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>
        <p className="storage-note">
          Settings are stored locally on this device.
        </p>
        {saveError && (
          <p className="settings-save-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Check size={15} />
            )}
            {saving ? "Saving…" : "Save and reconnect"}
          </button>
        </div>
      </form>
    </div>
  );
}
