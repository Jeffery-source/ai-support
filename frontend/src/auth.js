export function saveSessionId(id) {
  if (!id || id === "null" || id === "undefined") {
    localStorage.removeItem("session_id");
  } else {
    localStorage.setItem("session_id", id);
  }
}

export function getSessionId() {
  const v = localStorage.getItem("session_id");
  if (!v || v === "null" || v === "undefined") return "";
  return v;
}

export function clearSessionId() {
  localStorage.removeItem("session_id");
}
