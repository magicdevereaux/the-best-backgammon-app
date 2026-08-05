import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/context/AuthContext";
import { hydrateSeats } from "../src/game/seatRegistry";
import { colors } from "../src/theme";

export default function RootLayout() {
  // Load persisted seat-ownership so online-vs-guest gating survives a restart.
  useEffect(() => { hydrateSeats(); }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: "700" },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: "Backgammon" }} />
          <Stack.Screen name="login" options={{ title: "Sign in" }} />
          <Stack.Screen name="profile" options={{ title: "Profile" }} />
          <Stack.Screen name="game/[id]" options={{ title: "Game" }} />
          {/* The two link-landing screens. Their paths are not a design choice —
              they mirror the URLs the backend mails
              (`/verify-email/{token}`, `/reset-password/{uid}/{token}`) so the
              same path resolves whether it arrives over the custom scheme, as a
              hand-off from the web client, or, once a domain exists, as a
              universal link. Registered here for titles only; expo-router would
              route to them regardless. */}
          <Stack.Screen name="verify-email/[token]" options={{ title: "Confirm email" }} />
          <Stack.Screen name="reset-password/[uid]/[token]" options={{ title: "New password" }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
