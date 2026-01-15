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
    async (e) => {
      const sid = e.target.value;

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
      setLog((prev) => [...prev, { role: "user", content }]);
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
        const assistantMsg = res?.content
          ? { role: res.role || "assistant", content: res.content }
          : { role: "assistant", content: res?.reply ?? "" };

        if (!assistantMsg.content) {
          setErrorText("Empty reply from server.");
          return;
        }

        setLog((prev) => [...prev, assistantMsg]);
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
          { role: "system", content: "⚠️ Message failed to send." },
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
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      {/* 顶部：会话选择 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={sessionId}
          onChange={handleSelectSession}
          disabled={loadingSessions || sessions.length === 0}
          style={{ minWidth: 280 }}
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

        <button onClick={handleNewChat}>New Chat</button>
        <button onClick={handleLogout}>Logout</button>
      </div>

      {errorText ? (
        <div style={{ marginTop: 10, color: "crimson" }}>{errorText}</div>
      ) : null}

      {/* 聊天记录区 */}
      <div
        style={{
          marginTop: 12,
          border: "1px solid #ddd",
          borderRadius: 10,
          padding: 12,
          height: 420,
          overflowY: "auto",
          background: "#1e1212",
        }}
      >
        {loadingHistory ? <div>Loading history...</div> : null}

        {!loadingHistory && !sessionId ? (
          <div style={{ opacity: 0.7 }}>
            No session selected. Create a new chat or pick one from the list.
          </div>
        ) : null}

        {log.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, whiteSpace: "pre-wrap" }}>
            <b>{m.role}:</b> {m.content}
          </div>
        ))}
      </div>

      {/* 输入框 */}
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={
            sessionId ? "Type a message..." : "Select a session first..."
          }
          disabled={!sessionId || sending}
          rows={3}
          style={{
            flex: 1,
            resize: "none",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
            outline: "none",
          }}
        />
        <button
          onClick={handleSendClick}
          disabled={!canSend}
          style={{ width: 110 }}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
