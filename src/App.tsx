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
import type { ChatBackend, ChatMessage, ChatSession, Project } from "./types";

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
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
          addActivity,
        );
        const answer = await api.acpSend(
          backend,
          model,
          context,
          messages.map(({ role, content: value }) => ({
            role,
            content: value,
          })),
          prompt,
          addActivity,
        );
        const assistant: ChatMessage = {
          id: crypto.randomUUID(),
          sessionId: targetId,
          role: "assistant",
          content: answer,
          citations: [],
          model: `${backends.find((item) => item.id === backend)?.label || backend} · ${model}`,
          createdAt: new Date().toISOString(),
          activity: turnActivity,
        };
        setMessages((items) => [...items, assistant]);
        return;
      }
      const response = await api.send(targetId, prompt, backend);
      setMessages((items) => [
        ...items.filter((item) => item.id !== optimistic.id),
        response.userMessage,
        response.assistantMessage,
      ]);
      setSessions((items) => [
        response.session,
        ...items.filter((item) => item.id !== response.session.id),
      ]);
    } catch (reason) {
      setMessages((items) =>
        items.filter((item) => !item.id.startsWith("local-")),
      );
      setError(reason instanceof Error ? reason.message : "The request failed");
    } finally {
      setSending(false);
      setActivity([]);
    }
  }

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
    setSettings(normalized);
    setSettingsOpen(false);
  }

  const startNew = () => {
    setSessionId(null);
    setMessages([]);
    setHistoryOpen(false);
  };
  const showWelcome = !sessionId && messages.length === 0;

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
                {sending && <Thinking activity={activity} />}
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
}: {
  project?: Project;
  onSend: (value: string) => void;
  disabled: boolean;
  backends: ChatBackend[];
  backend?: ChatBackend["id"];
  model: string;
  onBackendChange: (value: ChatBackend["id"]) => void;
  onModelChange: (value: string) => void;
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
        <button
          type="submit"
          disabled={!value.trim() || sending || disabled}
          aria-label="Send message"
        >
          {sending ? (
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
  return (
    <article className="message assistant-message">
      <div className="assistant-avatar">
        <Sparkles size={14} />
      </div>
      <div className="assistant-body">
        {!!message.activity?.length && (
          <ActivityTrace steps={message.activity} />
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
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
        {message.model && (
          <div className="model-label">
            Answered by {message.model.replace(/:online$/, "")}
          </div>
        )}
        <MessageActions content={message.content} />
      </div>
    </article>
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
      <div className="activity-panel" aria-live="polite">
        <div className="activity-title">
          <span className="activity-pulse" /> Working on it
        </div>
        <div className="activity-steps">
          {steps.map((step, index) => {
            const active = index === steps.length - 1;
            return (
              <div
                className={active ? "active" : "complete"}
                key={`${step}-${index}`}
              >
                <span>{active ? "" : "✓"}</span>
                <em>{step}</em>
              </div>
            );
          })}
        </div>
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
