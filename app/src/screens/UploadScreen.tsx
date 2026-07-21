import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ApiError, applyCreator, createContent, publishContent, uploadMedia } from "../api";
import { colors } from "../theme";

export default function UploadScreen({ navigation }: { navigation: any }) {
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [title, setTitle] = useState("");
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState("5000");
  const [busy, setBusy] = useState<string | null>(null);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to pick a video.");
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: false,
      videoMaxDuration: 300, // §4.3 clip cap
    });
    if (!r.canceled && r.assets[0]) setAsset(r.assets[0]);
  };

  const submit = async () => {
    if (!asset) return;
    try {
      // 1. Ensure creator profile (instant, open-signup).
      setBusy("Setting up your creator profile…");
      try {
        await applyCreator();
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "already_creator")) throw e;
      }

      // 2. Create the content record (server validates price floor & clip cap).
      setBusy("Creating post…");
      const durationSeconds = asset.duration ? Math.round(asset.duration / 1000) : undefined;
      const { content } = await createContent({
        kind: "video",
        title: title.trim() || "Untitled",
        pricing: paid ? "paid" : "free",
        ...(paid ? { priceUgx: parseInt(price, 10) || 0 } : {}),
        ...(durationSeconds ? { durationSeconds } : {}),
      });

      // 3. Upload the media bytes to R2 through the API.
      setBusy("Uploading video…");
      await uploadMedia(content.id, asset.uri, asset.mimeType ?? "video/mp4");

      // 4. Publish.
      setBusy("Publishing…");
      await publishContent(content.id);

      setAsset(null);
      setTitle("");
      setPaid(false);
      Alert.alert("Published!", "Your video is live on the feed.");
      navigation.navigate("FeedTab");
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.h1}>New video</Text>

      <TouchableOpacity style={s.pickBox} onPress={pick}>
        {asset ? (
          <Text style={s.pickedText}>
            🎞 Video selected{asset.duration ? ` · ${Math.round(asset.duration / 1000)}s` : ""}
          </Text>
        ) : (
          <Text style={s.pickText}>＋ Pick a video (max 5 min)</Text>
        )}
      </TouchableOpacity>

      <TextInput
        style={s.input}
        placeholder="Title"
        placeholderTextColor={colors.dim}
        value={title}
        onChangeText={setTitle}
      />

      <View style={s.priceRow}>
        <TouchableOpacity
          style={[s.toggle, !paid && s.toggleActive]}
          onPress={() => setPaid(false)}
        >
          <Text style={[s.toggleText, !paid && s.toggleTextActive]}>Free</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggle, paid && s.toggleActive]}
          onPress={() => setPaid(true)}
        >
          <Text style={[s.toggleText, paid && s.toggleTextActive]}>Paid</Text>
        </TouchableOpacity>
      </View>

      {paid ? (
        <View>
          <TextInput
            style={s.input}
            placeholder="Price in UGX (min 5,000)"
            placeholderTextColor={colors.dim}
            keyboardType="number-pad"
            value={price}
            onChangeText={setPrice}
          />
          <Text style={s.note}>You keep 70% of every sale. Minimum price is 5,000 UGX.</Text>
        </View>
      ) : (
        <Text style={s.note}>Free videos can be downloaded and shared — great for reach.</Text>
      )}

      <TouchableOpacity
        style={[s.publishBtn, (!asset || !!busy) && { opacity: 0.4 }]}
        disabled={!asset || !!busy}
        onPress={submit}
      >
        {busy ? (
          <View style={s.busyRow}>
            <ActivityIndicator color="#000" />
            <Text style={s.publishText}> {busy}</Text>
          </View>
        ) : (
          <Text style={s.publishText}>Publish</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "800", marginBottom: 20 },
  pickBox: {
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: 14,
    padding: 36,
    alignItems: "center",
    marginBottom: 16,
  },
  pickText: { color: colors.accent, fontSize: 16, fontWeight: "700" },
  pickedText: { color: colors.success, fontSize: 16, fontWeight: "700" },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priceRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  toggle: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  toggleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleText: { color: colors.dim, fontWeight: "700" },
  toggleTextActive: { color: "#000" },
  note: { color: colors.dim, fontSize: 12, marginBottom: 16 },
  publishBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  publishText: { color: "#000", fontWeight: "800", fontSize: 16 },
  busyRow: { flexDirection: "row", alignItems: "center" },
});
