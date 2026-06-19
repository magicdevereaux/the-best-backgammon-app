import { API_BASE_URL } from "./config";
import { request } from "./client";
import { setTokens, clearTokens, getAccessToken } from "./tokenStore";

// register/login hit the auth endpoints directly (no bearer token yet), then
// persist the returned JWT pair to SecureStore.

export async function register(username, password) {
  const res = await fetch(`${API_BASE_URL}/api/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data?.username?.[0] ||
      data?.password?.[0] ||
      data?.detail ||
      "Registration failed.";
    throw new Error(msg);
  }
  await setTokens(data.access, data.refresh);
  return data.user;
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE_URL}/api/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error("Invalid username or password.");
  await setTokens(data.access, data.refresh);
  return fetchMe();
}

export async function fetchMe() {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    return await request("/api/auth/me/");
  } catch {
    return null;
  }
}

export async function logout() {
  await clearTokens();
}
