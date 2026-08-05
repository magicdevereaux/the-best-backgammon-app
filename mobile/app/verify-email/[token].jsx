import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { confirmEmailVerification } from "../../src/api/auth";
import { colors } from "../../src/theme";

/*
 * The in-app landing screen for an address-confirmation link. Mirrors the web
 * client's VerifyEmailPage, and the path shape is not ours to choose: the server
 * mails `{FRONTEND_BASE_URL}/verify-email/{token}`, so this file lives at exactly
 * `verify-email/[token]` and expo-router turns that into the matching route for
 * free.
 *
 * **How anyone actually gets here, stated honestly.** Today this route is
 * reachable two ways: the custom scheme (`backgammon://verify-email/<token>`,
 * declared in app.json), and the web client handing a token off to the app. It
 * is *not* reachable by tapping the link in an email — mail clients will not
 * follow a custom scheme, and the URL the server mails is an `https://` web one
 * regardless. Making the emailed link open the app needs universal links / App
 * Links, which need a real domain and signing credentials this project does not
 * have yet. This screen is what that config will point at once it does; until
 * then a mobile player who taps the mail still finishes in a browser, and the
 * copy in EmailSection says so.
 *
 * The token *is* the credential, so nothing is asked for and there is no button
 * to press: the screen posts on mount and reports what happened. Making someone
 * confirm that yes, they did open the link they just opened, would only add a
 * way to fail.
 *
 * `posted` guards a second POST. The server is idempotent — the same token twice
 * is 200 both times — so a repeat is harmless *to the server*, but a remount or
 * a params re-read would flash the outcome twice, and a ref is one line. The
 * cancelled flag is the other half: an unmount mid-flight must not set state.
 *
 * Nothing here is a gate. An unconfirmed address costs the account exactly one
 * thing — turn-reminder mail, which the server refuses to send unconfirmed — so
 * even the failure branch is a nudge toward Resend on the profile, never a dead
 * end or a demand to fix this before playing.
 */
export default function VerifyEmailScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams();
  // "pending" | "confirmed" | "failed"
  const [state, setState] = useState("pending");
  const [message, setMessage] = useState(null);
  const posted = useRef(false);

  useEffect(() => {
    if (posted.current) return;
    posted.current = true;

    let cancelled = false;
    confirmEmailVerification(token)
      .then((data) => {
        if (cancelled) return;
        setState("confirmed");
        setMessage(data?.detail || "Your email address is confirmed.");
      })
      .catch((err) => {
        if (cancelled) return;
        setState("failed");
        // The server's own wording: "This verification link is invalid or has
        // expired." A dead link and an expired one are one outcome as far as
        // anyone reading this cares, and the server keeps them that way.
        setMessage(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.content}>
        <Text style={styles.h1}>Confirm your email</Text>

        {state === "pending" && (
          <View style={styles.pending}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.body}>Checking your link…</Text>
          </View>
        )}

        {state === "confirmed" && (
          <>
            <Text style={styles.notice}>{message}</Text>
            <Text style={styles.body}>
              Turn reminders can now reach you, so you'll get a warning before an
              online game runs out of time on its 48-hour clock.
            </Text>
            <Pressable
              onPress={() => router.replace("/profile")}
              style={styles.primaryBtn}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>Go to your profile</Text>
            </Pressable>
          </>
        )}

        {state === "failed" && (
          <>
            <Text style={styles.error}>{message}</Text>
            <Text style={styles.body}>
              Nothing is locked — your account works exactly as before. The one
              thing an unconfirmed address costs you is turn reminders, the only
              warning you get before an opponent can claim a game you've run out
              of time on. Send yourself a fresh link with "Resend confirmation"
              on your profile.
            </Text>
            <Pressable
              onPress={() => router.replace("/profile")}
              style={styles.primaryBtn}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>Go to your profile</Text>
            </Pressable>
          </>
        )}

        <Pressable onPress={() => router.replace("/")}>
          <Text style={styles.switch}>Back to the lobby</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 12 },
  h1: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: 8 },
  pending: { flexDirection: "row", alignItems: "center", gap: 12 },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  notice: { color: colors.gold, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  primaryBtnText: { color: colors.goldText, fontWeight: "700", fontSize: 15 },
  switch: { color: colors.gold, textAlign: "center", marginTop: 8, fontSize: 14 },
});
