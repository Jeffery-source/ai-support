export async function apiFetch(url, options = {}) {
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
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
