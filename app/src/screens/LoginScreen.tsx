import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { TERMS_SECTIONS } from "../terms";
import { colors } from "../theme";

export default function LoginScreen() {
  const { login, signup } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const canSubmit =
    phone.trim().length >= 4 &&
    password.length >= 6 &&
    (mode === "login" || agreed) &&
    !busy;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") await signup(phone.trim(), password);
      else await login(phone.trim(), password);
    } catch (e) {
      // "no_password" legacy accounts should sign up to set a password.
      if (e instanceof ApiError && e.code === "no_password") {
        setMode("signup");
        setError("No password yet for this number — set one to continue.");
      } else {
        setError(e instanceof ApiError ? e.message : "Network error — try again");
      }
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={s.logo}>MidPay</Text>
      <Text style={s.tag}>Watch. Create. Earn.</Text>

      <TextInput
        style={s.input}
        placeholder="Mobile number (e.g. 0770 123 456)"
        placeholderTextColor={colors.dim}
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        autoFocus
      />
      <TextInput
        style={s.input}
        placeholder="Password"
        placeholderTextColor={colors.dim}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {mode === "signup" ? (
        <TouchableOpacity
          style={s.agreeRow}
          activeOpacity={0.8}
          onPress={() => setAgreed((a) => !a)}
        >
          <View style={[s.checkbox, agreed && s.checkboxOn]}>
            {agreed ? <Text style={s.checkboxTick}>✓</Text> : null}
          </View>
          <Text style={s.agreeText}>
            I agree to the{" "}
            <Text
              style={s.agreeLink}
              onPress={() => {
                setTermsOpen(true);
              }}
            >
              Terms &amp; Conditions
            </Text>
            {" "}(earnings, charges, and content rules).
          </Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={[s.btn, !canSubmit && s.btnDisabled]} disabled={!canSubmit} onPress={submit}>
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={s.btnText}>{mode === "signup" ? "Create account" : "Log in"}</Text>
        )}
      </TouchableOpacity>

      <Modal visible={termsOpen} animationType="slide" onRequestClose={() => setTermsOpen(false)}>
        <View style={s.termsRoot}>
          <Text style={s.termsTitle}>MidPay Terms &amp; Conditions</Text>
          <ScrollView style={s.termsScroll} contentContainerStyle={{ paddingBottom: 24 }}>
            {TERMS_SECTIONS.map((sec) => (
              <View key={sec.heading} style={{ marginBottom: 16 }}>
                <Text style={s.termsHeading}>{sec.heading}</Text>
                <Text style={s.termsBody}>{sec.body}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={[s.termsActions, { paddingBottom: insets.bottom + 14 }]}>
            <TouchableOpacity style={s.termsClose} onPress={() => setTermsOpen(false)}>
              <Text style={s.termsCloseText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, { flex: 1 }]}
              onPress={() => {
                setAgreed(true);
                setTermsOpen(false);
              }}
            >
              <Text style={s.btnText}>I agree</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TouchableOpacity
        onPress={() => {
          setError(null);
          setMode((m) => (m === "login" ? "signup" : "login"));
        }}
      >
        <Text style={s.link}>
          {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}
        </Text>
      </TouchableOpacity>

      {mode === "signup" ? (
        <Text style={s.fine}>Use at least 6 characters for your password.</Text>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 28 },
  logo: { color: colors.accent, fontSize: 44, fontWeight: "900", textAlign: "center" },
  tag: { color: colors.dim, textAlign: "center", marginBottom: 36, marginTop: 4 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btn: { backgroundColor: colors.accent, borderRadius: 12, padding: 16, alignItems: "center" },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontWeight: "700", fontSize: 16, color: "#000" },
  link: { color: colors.accent, textAlign: "center", marginTop: 18 },
  fine: { color: colors.dim, textAlign: "center", marginTop: 12, fontSize: 12 },
  error: { color: colors.danger, textAlign: "center", marginTop: 14 },
  // T&C acceptance
  agreeRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 16 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkboxTick: { color: "#000", fontSize: 14, fontWeight: "900", lineHeight: 16 },
  agreeText: { color: colors.text, flex: 1, fontSize: 13, lineHeight: 19 },
  agreeLink: { color: colors.accent, fontWeight: "700" },
  // Terms modal
  termsRoot: { flex: 1, backgroundColor: colors.bg, paddingTop: 54, paddingHorizontal: 20 },
  termsTitle: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: 12 },
  termsScroll: { flex: 1 },
  termsHeading: { color: colors.text, fontSize: 15, fontWeight: "800", marginBottom: 4 },
  termsBody: { color: colors.dim, fontSize: 14, lineHeight: 21 },
  termsActions: { flexDirection: "row", gap: 12, paddingVertical: 14 },
  termsClose: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  termsCloseText: { color: colors.text, fontWeight: "700", fontSize: 16 },
});
