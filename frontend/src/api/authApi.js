const BASE_URL = "/api/auth/";

export function getAccessToken() {
  return localStorage.getItem("access");
}

export function getRefreshToken() {
  return localStorage.getItem("refresh");
}

export function setTokens(access, refresh) {
  localStorage.setItem("access", access);
  localStorage.setItem("refresh", refresh);
}

export function clearTokens() {
  localStorage.removeItem("access");
  localStorage.removeItem("refresh");
}

export async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const res = await fetch(BASE_URL + "refresh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const data = await res.json();
  localStorage.setItem("access", data.access);
  return data.access;
}

export async function register(username, password) {
  const res = await fetch(BASE_URL + "register/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.username?.[0] || data?.password?.[0] || data?.detail || "Registration failed.";
    throw new Error(msg);
  }
  setTokens(data.access, data.refresh);
  return data.user;
}

export async function login(username, password) {
  const res = await fetch(BASE_URL + "login/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Invalid username or password.");
  setTokens(data.access, data.refresh);
  return fetchMe();
}

export async function fetchMe() {
  const token = getAccessToken();
  if (!token) return null;
  const res = await fetch(BASE_URL + "me/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export function logout() {
  clearTokens();
}
