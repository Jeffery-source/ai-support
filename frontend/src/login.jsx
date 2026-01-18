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
    <div className="auth-page">
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
        }

        .auth-page {
          --ink: #0b1f2a;
          --muted: #4d616f;
          --paper: #f7f6f2;
          --accent: #0d7c7b;
          --accent-2: #d0b15f;
          --stroke: rgba(15, 44, 58, 0.12);
          width: 100vw;
          min-height: 100vh;
          max-width: 100%;
          margin: 0;
          padding: 24px 20px 32px;
          overflow: hidden;
          background:
            radial-gradient(1200px 600px at 10% -10%, rgba(208, 177, 95, 0.25), transparent 60%),
            radial-gradient(900px 400px at 90% 0%, rgba(13, 124, 123, 0.25), transparent 55%),
            linear-gradient(135deg, #f2efe8 0%, #f8fafc 45%, #eef2f5 100%);
          font-family: "Space Grotesk", "Segoe UI", sans-serif;
          color: var(--ink);
        }

        .auth-shell {
          max-width: 1180px;
          margin: 0 auto;
          display: grid;
          gap: 32px;
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
          align-items: center;
        }

        .auth-card {
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid var(--stroke);
          box-shadow: 0 30px 60px rgba(15, 44, 58, 0.12);
          border-radius: 28px;
          padding: 30px;
          backdrop-filter: blur(10px);
          animation: float-in 700ms ease-out;
        }

        .auth-brand {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 18px;
        }

        .brand-mark {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: linear-gradient(135deg, var(--accent), #0f3b3b);
          color: #fff;
          font-weight: 700;
          display: grid;
          place-items: center;
          letter-spacing: 1px;
          box-shadow: 0 12px 24px rgba(13, 124, 123, 0.25);
        }

        .brand-name {
          font-size: 18px;
          font-weight: 700;
        }

        .brand-tag {
          font-size: 13px;
          color: var(--muted);
        }

        .auth-title {
          font-size: 28px;
          margin: 6px 0 8px;
        }

        .auth-sub {
          color: var(--muted);
          margin: 0 0 20px;
          font-size: 15px;
        }

        .mode-switch {
          display: inline-flex;
          background: var(--paper);
          border: 1px solid var(--stroke);
          border-radius: 999px;
          padding: 6px;
          gap: 6px;
          margin-bottom: 18px;
        }

        .mode-switch button {
          border: none;
          background: transparent;
          padding: 8px 18px;
          border-radius: 999px;
          font-weight: 600;
          color: var(--muted);
          cursor: pointer;
          transition: all 200ms ease;
        }

        .mode-switch button.active {
          background: #fff;
          color: var(--ink);
          box-shadow: 0 8px 16px rgba(15, 44, 58, 0.12);
        }

        .auth-form {
          display: grid;
          gap: 14px;
        }

        .field {
          display: grid;
          gap: 6px;
          font-size: 13px;
          color: var(--muted);
        }

        .field input {
          height: 46px;
          border-radius: 12px;
          border: 1px solid var(--stroke);
          padding: 0 14px;
          font-size: 15px;
          color: var(--ink);
          background: #fff;
          transition: border-color 200ms ease, box-shadow 200ms ease;
        }

        .field input:focus {
          outline: none;
          border-color: rgba(13, 124, 123, 0.5);
          box-shadow: 0 0 0 3px rgba(13, 124, 123, 0.15);
        }

        .primary {
          height: 48px;
          border-radius: 14px;
          border: none;
          background: linear-gradient(135deg, var(--accent), #0f4f4f);
          color: #fff;
          font-weight: 600;
          font-size: 15px;
          cursor: pointer;
          transition: transform 200ms ease, box-shadow 200ms ease;
          box-shadow: 0 16px 30px rgba(13, 124, 123, 0.28);
        }

        .primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 18px 34px rgba(13, 124, 123, 0.32);
        }

        .assist-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          color: var(--muted);
        }

        .assist-link {
          color: var(--accent);
          text-decoration: none;
          font-weight: 600;
        }

        .error {
          background: rgba(175, 40, 25, 0.12);
          color: #aa2418;
          border: 1px solid rgba(175, 40, 25, 0.2);
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 13px;
        }

        .auth-aside {
          display: grid;
          gap: 18px;
          padding: 10px;
          animation: fade-in 900ms ease-out;
        }

        .stat-card {
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid var(--stroke);
          border-radius: 22px;
          padding: 20px 22px;
          box-shadow: 0 20px 40px rgba(15, 44, 58, 0.1);
        }

        .stat-value {
          font-size: 28px;
          font-weight: 700;
          color: var(--ink);
        }

        .stat-label {
          color: var(--muted);
          font-size: 13px;
          margin-top: 6px;
        }

        .signal-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 12px;
          color: var(--muted);
          font-size: 14px;
        }

        .signal-list li {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .signal-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--accent-2);
          box-shadow: 0 0 0 6px rgba(208, 177, 95, 0.18);
        }

        @keyframes float-in {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes fade-in {
          from { opacity: 0; transform: translateX(18px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @media (max-width: 900px) {
          .auth-shell {
            grid-template-columns: 1fr;
          }
          .auth-aside {
            display: none;
          }
        }
      `}</style>

      <div className="auth-shell">
        <aside className="auth-aside">
          <div className="stat-card">
            <div className="stat-value">4.7x</div>
            <div className="stat-label">
              Faster case resolution with AI triage
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-value">99.95%</div>
            <div className="stat-label">
              Uptime with global failover coverage
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-value">SOC 2</div>
            <div className="stat-label">
              Compliant security posture and audit trails
            </div>
          </div>
          <ul className="signal-list">
            <li>
              <span className="signal-dot" />
              Live escalation routing and SLA tracking
            </li>
            <li>
              <span className="signal-dot" />
              Unified inbox with sentiment scoring
            </li>
            <li>
              <span className="signal-dot" />
              Export-ready analytics for leadership
            </li>
          </ul>
        </aside>

        <section className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark">A</div>
            <div>
              <div className="brand-name">Auralis</div>
              <div className="brand-tag">AI Support Console</div>
            </div>
          </div>

          <h1 className="auth-title">
            {mode === "login" ? "Welcome back" : "Create your workspace"}
          </h1>
          <p className="auth-sub">
            {mode === "login"
              ? "Secure access to your customer intelligence in one place."
              : "Start tracking the conversations that matter in minutes."}
          </p>

          <div className="mode-switch">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </div>

          <div className="auth-form">
            <label className="field">
              <span>Work email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                type="email"
                autoComplete="email"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </label>
            <button className="primary" type="button" onClick={submit}>
              {mode === "login" ? "Access console" : "Create account"}
            </button>
            <div className="assist-row">
              <span>SSO and audit logs available on Enterprise.</span>
              <a className="assist-link" href="#support">
                Contact sales
              </a>
            </div>
            {err && <div className="error">{err}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
