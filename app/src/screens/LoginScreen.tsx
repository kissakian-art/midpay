import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";

export default function LoginScreen() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = phone.trim().length >= 4 && password.length >= 6 && !busy;

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

      <TouchableOpacity style={[s.btn, !canSubmit && s.btnDisabled]} disabled={!canSubmit} onPress={submit}>
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={s.btnText}>{mode === "signup" ? "Create account" : "Log in"}</Text>
        )}
      </TouchableOpacity>

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
});
