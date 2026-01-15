export async function apiFetch(path, { method = "GET", body } = {}) {
  const token = localStorage.getItem("access_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`http://127.0.0.1:8000${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await resp.json();

  if (!resp.ok) {
    // 把后端的 error 抛出来
    const err = new Error(data?.error?.message || "Request failed");
    err.code = data?.error?.code || "UNKNOWN_ERROR";
    throw err;
  }

  return data;
}
