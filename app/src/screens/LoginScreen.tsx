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
import { ApiError, requestOtp } from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPhone = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await requestOtp(phone);
      if (r.bypass) {
        // Verification disabled (dev config) — log straight in.
        await login(phone, "000000");
        return;
      }
      setDevCode(r.devCode);
      setStage("code");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Network error — try again");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError(null);
    setBusy(true);
    try {
      await login(phone, code);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Network error — try again");
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={s.logo}>MidPay</Text>
      <Text style={s.tag}>Watch. Create. Earn.</Text>

      {stage === "phone" ? (
        <>
          <TextInput
            style={s.input}
            placeholder="Phone number (e.g. 0700 123 456)"
            placeholderTextColor={colors.dim}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            autoFocus
          />
          <TouchableOpacity
            style={[s.btn, (!phone || busy) && s.btnDisabled]}
            disabled={!phone || busy}
            onPress={submitPhone}
          >
            {busy ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>Continue</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={s.hint}>Enter the 6-digit code sent to {phone}</Text>
          {devCode ? <Text style={s.devCode}>DEV code: {devCode}</Text> : null}
          <TextInput
            style={s.input}
            placeholder="6-digit code"
            placeholderTextColor={colors.dim}
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            autoFocus
          />
          <TouchableOpacity
            style={[s.btn, (code.length !== 6 || busy) && s.btnDisabled]}
            disabled={code.length !== 6 || busy}
            onPress={submitCode}
          >
            {busy ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>Verify</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStage("phone")}>
            <Text style={s.link}>Change number</Text>
          </TouchableOpacity>
        </>
      )}

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
  hint: { color: colors.text, marginBottom: 8, textAlign: "center" },
  devCode: { color: colors.success, textAlign: "center", marginBottom: 10, fontWeight: "700" },
  link: { color: colors.accent, textAlign: "center", marginTop: 16 },
  error: { color: colors.danger, textAlign: "center", marginTop: 14 },
});
