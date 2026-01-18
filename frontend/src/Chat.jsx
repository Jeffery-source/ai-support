import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "./api";
import { saveSessionId, getSessionId } from "./auth";

/**
 * 你需要提供的 apiFetch：
 * - 自动带 Authorization: Bearer <token>
 * - 遇到非 2xx 抛出 error，至少包含 err.status / err.message
 *
 * 示例（你已有的话忽略）：
 *   const apiFetch = async (url, options={}) => {...}
 */

export default function Chat({ onLogout }) {
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(() => getSessionId());
  const [log, setLog] = useState([]);

  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);

  const [input, setInput] = useState("");
  const [errorText, setErrorText] = useState("");

  // React 18 StrictMode 开发环境双 mount：避免重复 init
  const didInitRef = useRef(false);
  const chatScrollRef = useRef(null);
  const typingTimerRef = useRef(null);

  // 防止旧请求覆盖新状态
  const historyReqSeq = useRef(0);
  const sessionsReqSeq = useRef(0);
  const sendReqSeq = useRef(0);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("session_id");
    setSessions([]);
    setSessionId("");
    setLog([]);
    setInput("");
    setErrorText("");
    onLogout?.();
  }, [onLogout]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [log]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, []);

  const loadHistory = useCallback(
    async (sid) => {
      if (!sid) {
        setLog([]);
        return;
      }

      const seq = ++historyReqSeq.current;
      setLoadingHistory(true);
      setErrorText("");

      try {
        // 🔧 按你后端对齐：获取历史
        const history = await apiFetch(`/api/sessions/${sid}/messages`);

        if (seq !== historyReqSeq.current) return;

        const items = Array.isArray(history)
          ? history
          : history?.messages || [];

        const normalized = items.map((m) => ({
          role: m.role ?? m.sender ?? m.type ?? "unknown",
          content: m.content ?? m.message ?? m.text ?? "",
        }));

        setLog(normalized);
      } catch (err) {
        if (seq !== historyReqSeq.current) return;

        console.error("loadHistory failed:", err);

        if (err?.status === 401) {
          handleLogout();
          return;
        }

        if (err?.status === 404) {
          saveSessionId("");
          setSessionId("");
          setLog([]);
          setErrorText("This session no longer exists.");
          return;
        }

        setErrorText(err?.message || "Failed to load history.");
      } finally {
        if (seq === historyReqSeq.current) setLoadingHistory(false);
      }
    },
    [handleLogout]
  );

  const loadSessions = useCallback(async () => {
    const seq = ++sessionsReqSeq.current;
    setLoadingSessions(true);
    setErrorText("");

    try {
      const list = await apiFetch("/api/chat/sessions");
      if (seq !== sessionsReqSeq.current) return;

      const safeList = Array.isArray(list) ? list : [];
      setSessions(safeList);

      let nextSessionId = getSessionId();
      if (nextSessionId && !safeList.some((s) => s.id === nextSessionId)) {
        nextSessionId = "";
        saveSessionId("");
      }
      if (!nextSessionId && safeList.length > 0) {
        nextSessionId = safeList[0].id; // 默认最新
      }

      if (nextSessionId !== sessionId) {
        setSessionId(nextSessionId);
        saveSessionId(nextSessionId);
      }

      if (nextSessionId) {
        setLog([]); // 切换视觉：先清屏
        await loadHistory(nextSessionId);
      } else {
        setLog([]);
      }
    } catch (err) {
      if (seq !== sessionsReqSeq.current) return;

      console.error("loadSessions failed:", err);

      if (err?.status === 401) {
        handleLogout();
        return;
      }

      setErrorText(err?.message || "Failed to load sessions.");
    } finally {
      if (seq === sessionsReqSeq.current) setLoadingSessions(false);
    }
  }, [handleLogout, loadHistory, sessionId]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadSessions();
  }, [loadSessions]);

  const handleSelectSession = useCallback(
    async (sid) => {

      // 切会话：立刻清屏 + 取消发送状态
      setSessionId(sid);
      saveSessionId(sid);
      setLog([]);
      setErrorText("");
      setSending(false);

      await loadHistory(sid);
    },
    [loadHistory]
  );

  const handleNewChat = useCallback(async () => {
    setErrorText("");
    try {
      // 🔧 按你后端对齐：创建 session
      const res = await apiFetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { title: "New chat" },
      });

      const newId = res?.id;
      if (!newId) {
        setErrorText("Server did not return a session id.");
        return;
      }

      setSessions((prev) => [
        { id: newId, title: "New chat" },
        ...(prev || []),
      ]);
      setSessionId(newId);
      saveSessionId(newId);
      setLog([]);
      setInput("");
    } catch (err) {
      console.error("create session failed:", err);
      if (err?.status === 401) {
        handleLogout();
        return;
      }
      setErrorText(err?.message || "Failed to create a new chat.");
    }
  }, [handleLogout]);

  const canSend = !!sessionId && !sending && input.trim().length > 0;

  const sendMessage = useCallback(
    async (text) => {
      const content = text.trim();
      if (!content) return;
      if (!sessionId) {
        setErrorText("Please select a session first.");
        return;
      }

      const seq = ++sendReqSeq.current;
      setSending(true);
      setErrorText("");

      // 先把用户消息乐观更新到 UI
      setLog((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", content },
      ]);
      setInput("");

      try {
        // 🔧 按你后端对齐：发送消息拿回复
        const res = await apiFetch(`/api/chat/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: { message: content },
        });

        // 切 session 后回来旧响应：丢弃
        if (seq !== sendReqSeq.current) return;

        // 兼容两种返回：
        // A) { reply: "..." }
        // B) { role: "assistant", content: "..." }
        const assistantText = res?.content ?? res?.reply ?? "";
        if (!assistantText) {
          setErrorText("Empty reply from server.");
          return;
        }

        const msgId = `a-${Date.now()}`;
        setLog((prev) => [...prev, { id: msgId, role: "assistant", content: "" }]);

        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
        }

        let index = 0;
        const step = 3;
        typingTimerRef.current = setInterval(() => {
          index = Math.min(index + step, assistantText.length);
          const slice = assistantText.slice(0, index);
          setLog((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, content: slice } : m))
          );
          if (index >= assistantText.length) {
            clearInterval(typingTimerRef.current);
            typingTimerRef.current = null;
          }
        }, 24);
      } catch (err) {
        if (seq !== sendReqSeq.current) return;

        console.error("sendMessage failed:", err);

        if (err?.status === 401) {
          handleLogout();
          return;
        }

        setErrorText(err?.message || "Failed to send message.");

        // 可选：失败时把消息标注一下（这里简单做，不回滚）
        setLog((prev) => [
          ...prev,
          { id: `s-${Date.now()}`, role: "system", content: "Message failed to send." },
        ]);
      } finally {
        if (seq === sendReqSeq.current) setSending(false);
      }
    },
    [handleLogout, sessionId]
  );

  const handleSendClick = useCallback(() => {
    if (!canSend) return;
    sendMessage(input);
  }, [canSend, input, sendMessage]);

  const handleInputKeyDown = useCallback(
    (e) => {
      // Enter 发送，Shift+Enter 换行
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (canSend) sendMessage(input);
      }
    },
    [canSend, input, sendMessage]
  );

  return (
    <div className="chat-page">
      <style>{`
        @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap");

        :root {
          color-scheme: light;
        }

        html,
        body,
        #root {
          height: 100%;
        }

        body {
          margin: 0;
          overflow: hidden;
          font-family: "Space Grotesk", "Segoe UI", sans-serif;
        }

        .chat-page {
          --ink: #0b1f2a;
          --muted: #4d616f;
          --paper: #f5f4ef;
          --accent: #0d7c7b;
          --accent-dark: #0f4f4f;
          --stroke: rgba(15, 44, 58, 0.12);
          --surface: rgba(255, 255, 255, 0.9);
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          background:
            radial-gradient(1100px 500px at 10% -20%, rgba(208, 177, 95, 0.25), transparent 60%),
            radial-gradient(900px 400px at 100% 0%, rgba(13, 124, 123, 0.2), transparent 55%),
            linear-gradient(130deg, #f0ede6 0%, #f7f9fb 55%, #eff3f7 100%);
          color: var(--ink);
        }

        .chat-shell {
          height: 100%;
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 20px;
          padding: 22px;
          box-sizing: border-box;
        }

        .chat-sidebar {
          background: var(--surface);
          border: 1px solid var(--stroke);
          border-radius: 26px;
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: 0 24px 50px rgba(15, 44, 58, 0.12);
          backdrop-filter: blur(12px);
          animation: slide-in 700ms ease-out;
        }

        .brand-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-mark {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: linear-gradient(135deg, var(--accent), #0f3b3b);
          color: #fff;
          font-weight: 700;
          display: grid;
          place-items: center;
          letter-spacing: 1px;
        }

        .brand-name {
          font-weight: 700;
        }

        .brand-tag {
          font-size: 12px;
          color: var(--muted);
        }

        .primary-btn {
          height: 44px;
          border-radius: 14px;
          border: none;
          background: linear-gradient(135deg, var(--accent), var(--accent-dark));
          color: #fff;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 14px 30px rgba(13, 124, 123, 0.25);
          transition: transform 200ms ease, box-shadow 200ms ease;
        }

        .primary-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 18px 36px rgba(13, 124, 123, 0.28);
        }

        .sidebar-title {
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--muted);
          margin-top: 6px;
        }

        .session-list {
          display: grid;
          gap: 10px;
          height: 420px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .session-card {
          border: 1px solid var(--stroke);
          background: #fff;
          border-radius: 16px;
          padding: 12px 14px;
          font-size: 14px;
          text-align: left;
          cursor: pointer;
          transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;
        }

        .session-card.active {
          border-color: rgba(13, 124, 123, 0.5);
          box-shadow: 0 14px 30px rgba(13, 124, 123, 0.18);
          transform: translateY(-1px);
        }

        .session-meta {
          font-size: 12px;
          color: var(--muted);
          margin-top: 4px;
        }

        .ghost-btn {
          height: 40px;
          border-radius: 12px;
          border: 1px solid var(--stroke);
          background: transparent;
          color: var(--muted);
          font-weight: 600;
          cursor: pointer;
        }

        .chat-main {
          background: var(--surface);
          border: 1px solid var(--stroke);
          border-radius: 28px;
          padding: 18px 22px 22px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          height: calc(100vh - 44px);
          overflow-y: auto;
          box-shadow: 0 28px 60px rgba(15, 44, 58, 0.12);
          backdrop-filter: blur(12px);
          animation: fade-in 800ms ease-out;
        }

        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }

        .session-select {
          height: 40px;
          border-radius: 12px;
          border: 1px solid var(--stroke);
          padding: 0 12px;
          font-size: 14px;
          min-width: 240px;
          background: #fff;
        }

        .status-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(13, 124, 123, 0.1);
          color: var(--accent);
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #1dbf8d;
        }

        .error-banner {
          background: rgba(175, 40, 25, 0.12);
          color: #aa2418;
          border: 1px solid rgba(175, 40, 25, 0.2);
          padding: 10px 12px;
          border-radius: 12px;
          font-size: 13px;
        }

        .chat-body {
          flex: 1;
          min-height: 0;
          display: flex;
        }

        .chat-scroll {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding-right: 8px;
        }

        .empty-state {
          color: var(--muted);
          font-size: 14px;
          margin-top: 40px;
          text-align: center;
        }

        .message {
          max-width: 72%;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid var(--stroke);
          background: #fff;
          box-shadow: 0 10px 24px rgba(15, 44, 58, 0.08);
          white-space: pre-wrap;
          line-height: 1.45;
          font-size: 14px;
        }

        .message.user {
          align-self: flex-end;
          background: linear-gradient(135deg, rgba(13, 124, 123, 0.12), rgba(13, 124, 123, 0.04));
          border-color: rgba(13, 124, 123, 0.25);
        }

        .message.assistant {
          align-self: flex-start;
        }

        .message.system {
          align-self: center;
          background: rgba(15, 44, 58, 0.08);
          border-color: rgba(15, 44, 58, 0.12);
          color: var(--muted);
        }

        .message-role {
          font-size: 11px;
          color: var(--muted);
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        .composer {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          margin-top: auto;
        }

        .composer textarea {
          flex: 1;
          min-height: 70px;
          max-height: 160px;
          resize: none;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid var(--stroke);
          font-size: 14px;
          line-height: 1.5;
          font-family: inherit;
          background: #fff;
        }

        .composer textarea:focus {
          outline: none;
          border-color: rgba(13, 124, 123, 0.5);
          box-shadow: 0 0 0 3px rgba(13, 124, 123, 0.15);
        }

        .send-btn {
          min-width: 120px;
          height: 44px;
          border-radius: 14px;
          border: none;
          background: var(--accent);
          color: #fff;
          font-weight: 600;
          cursor: pointer;
        }

        .send-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @keyframes slide-in {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes fade-in {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 980px) {
          .chat-shell {
            grid-template-columns: 1fr;
            padding: 18px;
          }
          .chat-sidebar {
            order: 2;
          }
          .chat-main {
            order: 1;
          }
        }

        @media (max-width: 640px) {
          .chat-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .session-select {
            width: 100%;
          }
          .message {
            max-width: 100%;
          }
          .composer {
            flex-direction: column;
            align-items: stretch;
          }
          .send-btn {
            width: 100%;
          }
        }
      `}</style>

      <div className="chat-shell">
        <aside className="chat-sidebar">
          <div className="brand-row">
            <div className="brand-mark">A</div>
            <div>
              <div className="brand-name">Auralis</div>
              <div className="brand-tag">AI Support Console</div>
            </div>
          </div>

          <button className="primary-btn" onClick={handleNewChat}>
            New chat
          </button>

          <div className="sidebar-title">Conversations</div>
          <div className="session-list">
            {loadingSessions ? (
              <div className="session-card">Loading sessions...</div>
            ) : sessions.length === 0 ? (
              <div className="session-card">No sessions yet.</div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`session-card ${s.id === sessionId ? "active" : ""}`}
                  onClick={() => handleSelectSession(s.id)}
                >
                  <div>{s.title ?? s.id}</div>
                  <div className="session-meta">{s.id}</div>
                </button>
              ))
            )}
          </div>

          <button className="ghost-btn" onClick={handleLogout}>
            Logout
          </button>
        </aside>

        <section className="chat-main">
          <div className="chat-header">
            <select
              value={sessionId}
              onChange={(e) => handleSelectSession(e.target.value)}
              disabled={loadingSessions || sessions.length === 0}
              className="session-select"
            >
              <option value="" disabled>
                {loadingSessions ? "Loading sessions..." : "Select a session"}
              </option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title ?? s.id}
                </option>
              ))}
            </select>
            <div className="status-chip">
              <span className="status-dot" />
              Secure workspace
            </div>
          </div>

          {errorText ? <div className="error-banner">{errorText}</div> : null}

          <div className="chat-body">
            <div className="chat-scroll" ref={chatScrollRef}>
              {loadingHistory ? <div>Loading history...</div> : null}

              {!loadingHistory && !sessionId ? (
                <div className="empty-state">
                  No session selected. Create a new chat or pick one from the
                  list.
                </div>
              ) : null}

              {log.map((m, i) => (
                <div
                  key={i}
                  className={`message ${m.role === "user" ? "user" : ""} ${
                    m.role === "assistant" ? "assistant" : ""
                  } ${m.role === "system" ? "system" : ""}`}
                >
                  <div className="message-role">{m.role}</div>
                  <div>{m.content}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={
                sessionId ? "Type a message..." : "Select a session first..."
              }
              disabled={!sessionId || sending}
              rows={3}
            />
            <button
              className="send-btn"
              onClick={handleSendClick}
              disabled={!canSend}
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );

}
