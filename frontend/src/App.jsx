import { useState } from "react";
import Login from "./login";
import Chat from "./Chat";

export default function App() {
  // 直接在初始化时读 localStorage，不用 useEffect
  const [authed, setAuthed] = useState(() => {
    return !!localStorage.getItem("access_token");
  });

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  return <Chat onLogout={() => setAuthed(false)} />;
}
