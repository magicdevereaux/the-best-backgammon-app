import { getAccessToken, refreshAccessToken } from "./authApi";
import { apiUrl } from "./config";

export async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = apiUrl(path);
  let res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(url, { ...options, headers });
    }
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && data.error) || `API error: ${res.status}`;
    throw new Error(message);
  }
  return data;
}
