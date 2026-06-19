import Constants from "expo-constants";
import { Platform } from "react-native";

// Port the Django dev server listens on.
const DJANGO_PORT = 8000;

// Set this to a fixed URL (e.g. "http://192.168.1.50:8000") to override the
// auto-detected host below. Useful for physical devices on a different network
// or when pointing at a deployed backend.
const MANUAL_OVERRIDE = null;

// In development, Metro exposes the dev-machine host (LAN IP) so we can reach
// the Django server running on the same machine without hardcoding an IP.
// Falls back to platform-specific loopback addresses.
function devHost() {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost ||
    null;
  if (hostUri) return hostUri.split(":")[0];
  // Android emulator maps 10.0.2.2 -> host loopback; iOS sim uses localhost.
  return Platform.OS === "android" ? "10.0.2.2" : "localhost";
}

export const API_BASE_URL =
  MANUAL_OVERRIDE || `http://${devHost()}:${DJANGO_PORT}`;
