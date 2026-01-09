import { useState, useEffect } from "react";
import { apiFetch } from "./api";

export default function App() {
  const [text, setText] = useState("");
  const [log, setLog] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem("session_id") || ""
  );

  useEffect(() => {
    const v = localStorage.getItem("session_id");
    if (v === "undefined" || v === "null") {
      localStorage.removeItem("session_id");
      setSessionId("");
      return;
    }

    loadHistory(v).catch((err) => {
      console.error("loadHistory failed:", err.code, err.message);

      // 如果 session 在后端不存在（比如你清库了），就清掉本地 session
      if (err.status === 404) {
        localStorage.removeItem("session_id");
        setSessionId("");
        setLog([]);
      }
    });
  }, []); // 只在页面首次加载时执行一次

  async function loadHistory(id) {
    setLoadingHistory(true);
    try {
      const data = await apiFetch(
        `http://127.0.0.1:8000/api/sessions/${id}/messages`
      );
      setLog(data.messages.map((m) => ({ role: m.role, text: m.content })));
    } finally {
      setLoadingHistory(false);
    }
  }

  async function send() {
    if (!text.trim()) return;

    const userMsg = { role: "user", text };
    setLog((l) => [...l, userMsg]);
    setText("");

    try {
      const data = await apiFetch("http://127.0.0.1:8000/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: userMsg.text,
          session_id: sessionId || null,
        }),
      });

      setSessionId(data.session_id);
      localStorage.setItem("session_id", data.session_id);

      setLog((l) => [...l, { role: "assistant", text: data.reply }]);
    } catch (err) {
      console.error("API error:", err.code, err.message);

      setLog((l) => [
        ...l,
        {
          role: "assistant",
          text: `❌ Error (${err.code}): ${err.message}`,
        },
      ]);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 720 }}>
      <h2>AI Support (MVP)</h2>

      <div style={{ border: "1px solid #ddd", padding: 12, minHeight: 240 }}>
        {log.map((m, i) => (
          <div key={i} style={{ margin: "8px 0" }}>
            <b>{m.role}:</b> {m.text}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {loadingHistory && <div>Loading history...</div>}
        <input
          style={{ flex: 1, padding: 8 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send}>Send</button>
      </div>
    </div>
  );
}
