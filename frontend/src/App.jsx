import { useState } from "react";

export default function App() {
  const [text, setText] = useState("");
  const [log, setLog] = useState([]);

  async function send() {
    if (!text.trim()) return;
    const userMsg = { role: "user", text };
    setLog((l) => [...l, userMsg]);
    setText("");

    const resp = await fetch("http://127.0.0.1:8000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMsg.text }),
    });

    const data = await resp.json();
    setLog((l) => [...l, { role: "assistant", text: data.reply }]);
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
