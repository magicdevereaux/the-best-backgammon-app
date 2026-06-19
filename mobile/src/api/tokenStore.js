import * as SecureStore from "expo-secure-store";

// SecureStore keys must be alphanumeric / ._- only.
const ACCESS_KEY = "bg_access";
const REFRESH_KEY = "bg_refresh";

export async function getAccessToken() {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function setTokens(access, refresh) {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  if (refresh) await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function setAccessToken(access) {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
