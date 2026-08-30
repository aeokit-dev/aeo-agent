import {
  FormEvent,
  KeyboardEvent,
  useEffect,
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
  LoaderCircle,
  Menu,
  MessageSquare,
  Plus,
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
  normalizeApiUrl,
  type ClientSettings,
} from "./api";
import { capabilities, defaultPrompts } from "./prompts";
import type {
  ChatBackend,
  ChatMessage,
  ChatSession,
  Project,
  VisualizationArtifact,
} from "./types";
import { agentModes, type AgentMode } from "../shared/agent-experience";
import { parseContentBlocks } from "./artifacts";
import type { AgentStreamEvent } from "../shared/streaming";

const selectedProjectKey = "aeokit-agent-project";

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
  const [mode, setMode] = useState<AgentMode>("product_analytics");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeTurnRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!window.aeokitDesktop) return;
    void window.aeokitDesktop.loadSettings().then((saved) => {
      if (saved) setSettings(saved);
    });
  }, []);

  const project = projects.find((item) => item.id === projectId);
  const activeSession = sessions.find((item) => item.id === sessionId);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send(content: string) {
    const prompt = content.trim();
    if (!prompt || sending || !projectId) return;
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
        setMessages((items) =>
          items.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content: answer,
                  activity: turnActivity,
                  streaming: false,
                }
              : item,
          ),
        );
        return;
      }
      const response = await api.send(targetId, prompt, backend);
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
    if (!id.startsWith("acp-")) await api.deleteSession(id);
    setSessions((items) => items.filter((item) => item.id !== id));
    if (sessionId === id) {
      setSessionId(null);
      setMessages([]);
    }
  }

  function saveSettings(next: ClientSettings) {
    const normalized = { ...next, apiUrl: normalizeApiUrl(next.apiUrl) };
    localStorage.setItem("aeokit-agent-settings", JSON.stringify(normalized));
    void window.aeokitDesktop?.saveSettings(normalized);
    setSettings(normalized);
    setSettingsOpen(false);
  }

  const startNew = () => {
    setSessionId(null);
    setMessages([]);
    setHistoryOpen(false);
  };
  const showWelcome = !sessionId && messages.length === 0;
  const hasStreamingMessage = messages.some((message) => message.streaming);

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

      <div className="workspace">
        <aside className={`history ${historyOpen ? "history-open" : ""}`}>
          <div className="history-head">
            <span>Chats</span>
            <button
              className="icon-button mobile-only"
              onClick={() => setHistoryOpen(false)}
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
          <div className="history-label">
            <Clock3 size={12} /> Recent
          </div>
          <div className="history-list">
            {sessions.map((session) => (
              <div
                className={`history-row ${session.id === sessionId ? "active" : ""}`}
                key={session.id}
              >
                <button
                  onClick={() => {
                    setSessionId(session.id);
                    setHistoryOpen(false);
                  }}
                >
                  <MessageSquare size={14} />
                  <span>{session.title}</span>
                </button>
                <button
                  className="delete-chat"
                  onClick={() => void removeSession(session.id)}
                  aria-label={`Delete ${session.title}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="history-footer">
            <span className="status-dot" />
            <span>Connected to AeoKit runtime</span>
          </div>
        </aside>

        <main className="chat">
          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError("")}>
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
                  <h1>{activeSession?.title || "New chat"}</h1>
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
                  <Message key={message.id} message={message} />
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

function Composer({
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
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (value.trim() && !sending && !disabled) {
      onSend(value);
      setValue("");
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
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
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={keyDown}
        placeholder="Ask AeoKit anything…"
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

function Message({ message }: { message: ChatMessage }) {
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
        {message.citations?.length > 0 && (
          <div className="sources">
            <span>Sources</span>
            <div>
              {message.citations.map((citation, index) => (
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  key={`${citation.url}-${index}`}
                >
                  <span>{index + 1}</span>
                  {citation.title || citation.domain}
                  <ExternalLink size={11} />
                </a>
              ))}
            </div>
          </div>
        )}
        {message.model && !message.streaming && (
          <div className="model-label">
            Answered by {message.model.replace(/:online$/, "")}
          </div>
        )}
        {!message.streaming && <MessageActions content={message.content} />}
      </div>
    </article>
  );
}

function VisualizationCard({ artifact }: { artifact: VisualizationArtifact }) {
  const [collapsed, setCollapsed] = useState(false);
  const xKey = artifact.xKey || "label";
  const numericValues = artifact.data.flatMap((row) =>
    artifact.series.map((series) => Number(row[series.key]) || 0),
  );
  const maximum = Math.max(1, ...numericValues);
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
        >
          <ChevronRight className={collapsed ? "" : "expanded"} size={15} />
        </button>
      </header>
      {!collapsed && (
        <div className="visualization-body">
          {artifact.type === "metric" ? (
            <div className="metric-value">
              {String(artifact.data[0]?.[artifact.series[0]?.key] ?? "–")}
              {artifact.unit || ""}
            </div>
          ) : artifact.type === "table" ? (
            <div className="artifact-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{xKey}</th>
                    {artifact.series.map((series) => (
                      <th key={series.key}>{series.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {artifact.data.map((row, index) => (
                    <tr key={index}>
                      <td>{String(row[xKey] ?? "")}</td>
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
                    {artifact.series.map((series) => {
                      const value = Number(row[series.key]) || 0;
                      return (
                        <div
                          className="bar-row"
                          key={series.key}
                          title={`${series.label}: ${value}${artifact.unit || ""}`}
                        >
                          <i
                            style={{
                              width: `${Math.max(2, (value / maximum) * 100)}%`,
                              background: series.color || "#5263d8",
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
            <LineChart artifact={artifact} maximum={maximum} />
          )}
          {artifact.series.length > 1 && (
            <div className="chart-legend">
              {artifact.series.map((series) => (
                <span key={series.key}>
                  <i style={{ background: series.color || "#5263d8" }} />
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

function ApprovalCard({
  approval,
}: {
  approval: NonNullable<ChatMessage["approval"]>;
}) {
  const [status, setStatus] = useState(approval.status);
  return (
    <section className={`approval-card ${approval.risk}`}>
      <div>
        <strong>{approval.title}</strong>
        <p>{approval.description}</p>
      </div>
      {status === "pending" ? (
        <div className="approval-actions">
          <button onClick={() => setStatus("rejected")}>Reject</button>
          <button className="approve" onClick={() => setStatus("approved")}>
            Approve
          </button>
        </div>
      ) : (
        <span className={`approval-status ${status}`}>
          {status === "approved" ? "Approved" : "Rejected"}
        </span>
      )}
    </section>
  );
}

function LineChart({
  artifact,
  maximum,
}: {
  artifact: VisualizationArtifact;
  maximum: number;
}) {
  const width = 640;
  const height = 220;
  const padding = 24;
  const xKey = artifact.xKey || "label";
  const denominator = Math.max(1, artifact.data.length - 1);
  return (
    <div className="line-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={artifact.title}
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
        {artifact.series.map((series) => {
          const points = artifact.data
            .map((row, index) => {
              const x = padding + (index / denominator) * (width - padding * 2);
              const y =
                height -
                padding -
                ((Number(row[series.key]) || 0) / maximum) *
                  (height - padding * 2);
              return `${x},${y}`;
            })
            .join(" ");
          return (
            <polyline
              key={series.key}
              points={points}
              style={{ stroke: series.color || "#5263d8" }}
            />
          );
        })}
        {artifact.data.map((row, index) => (
          <text
            key={index}
            x={padding + (index / denominator) * (width - padding * 2)}
            y={height - 5}
          >
            {String(row[xKey] ?? "")}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ActivityTrace({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`activity-trace ${open ? "open" : ""}`}>
      <button onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={12} />
        <span>{steps.length} activities</span>
        <small>Completed</small>
      </button>
      {open && (
        <div className="activity-trace-list">
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
  const current = steps.at(-1) || "Thinking";
  return (
    <div className={`live-activity ${open ? "open" : ""}`}>
      <button onClick={() => setOpen((value) => !value)}>
        <LoaderCircle className="spin" size={13} />
        <span>{current}</span>
        {steps.length > 1 && <small>{steps.length} activities</small>}
        <ChevronRight size={11} />
      </button>
      {open && (
        <div className="live-activity-details">
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

function MessageActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  return (
    <div className="message-actions">
      <button
        aria-label="Copy answer"
        title="Copy answer"
        onClick={() => {
          void navigator.clipboard.writeText(content);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <button
        className={rating === "up" ? "selected" : ""}
        aria-label="Helpful answer"
        title="Helpful"
        onClick={() => setRating(rating === "up" ? null : "up")}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        className={rating === "down" ? "selected" : ""}
        aria-label="Unhelpful answer"
        title="Not helpful"
        onClick={() => setRating(rating === "down" ? null : "down")}
      >
        <ThumbsDown size={12} />
      </button>
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

function SettingsDialog({
  settings,
  onSave,
  onClose,
}: {
  settings: ClientSettings;
  onSave: (value: ClientSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Connection settings"
    >
      <button className="modal-scrim" onClick={onClose} />
      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <div className="settings-title">
          <div>
            <h2>Connection settings</h2>
            <p>Connect this client to an AeoKit API runtime.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <label>
          API URL
          <input
            value={draft.apiUrl}
            onChange={(event) =>
              setDraft({ ...draft, apiUrl: event.target.value })
            }
            placeholder="http://localhost:3000/api"
            required
          />
        </label>
        <label>
          Bearer token <span>optional for self-hosted</span>
          <input
            type="password"
            value={draft.token}
            onChange={(event) =>
              setDraft({ ...draft, token: event.target.value })
            }
            placeholder="Paste a runtime token"
          />
        </label>
        <p className="storage-note">
          Settings are stored only in this browser.
        </p>
        <div className="settings-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button">
            <Check size={15} /> Save and reconnect
          </button>
        </div>
      </form>
    </div>
  );
}
