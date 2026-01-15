import { useState } from "react";
import { apiFetch } from "./api";

export default function Login({ onLogin }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    const path = mode === "login" ? "/api/auth/login" : "/api/auth/signup";

    try {
      const data = await apiFetch(path, {
        method: "POST",
        body: { email, password },
      });

      localStorage.setItem("access_token", data.access_token);
      onLogin();
    } catch (e) {
      setErr(e.message || "Login failed");
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 420 }}>
      <h2>{mode === "login" ? "Login" : "Sign up"}</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setMode("login")} disabled={mode === "login"}>
          Login
        </button>
        <button onClick={() => setMode("signup")} disabled={mode === "signup"}>
          Sign up
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          type="password"
        />
        <button onClick={submit}>
          {mode === "login" ? "Login" : "Create account"}
        </button>
        {err && <div style={{ color: "crimson" }}>{err}</div>}
      </div>
    </div>
  );
}
