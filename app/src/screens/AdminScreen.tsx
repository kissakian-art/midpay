import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  backgroundImageUrl,
  createBackground,
  createTrack,
  deleteBackground,
  listBackgrounds,
  uploadBackgroundImage,
  uploadTrackAudio,
} from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";

/**
 * In-app admin (owner only, users.isAdmin): seed the shared catalogs — curated
 * sounds and text-post backgrounds — that every creator can use.
 */
export default function AdminScreen() {
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [soundTitle, setSoundTitle] = useState("");
  const [bgs, setBgs] = useState<string[]>([]);

  const loadBgs = () =>
    listBackgrounds().then((r) => setBgs(r.backgrounds.map((b) => b.id))).catch(() => {});
  useEffect(() => {
    loadBgs();
  }, []);

  if (!user?.isAdmin) {
    return (
      <View style={s.center}>
        <Text style={s.denied}>Admin access only.</Text>
      </View>
    );
  }

  const uploadSound = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setBusy("Uploading sound…");
      const title = soundTitle.trim() || (a.name || "Catalog sound").replace(/\.[^/.]+$/, "").slice(0, 120);
      const { track } = await createTrack({ title, source: "catalog" });
      await uploadTrackAudio(track.id, a.uri, a.mimeType || "audio/mpeg");
      setSoundTitle("");
      Alert.alert("Added", "Catalog sound is now available to all creators.");
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(null);
    }
  };

  const uploadBackground = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to upload a background.");
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (r.canceled || !r.assets[0]) return;
      setBusy("Uploading background…");
      const { background } = await createBackground();
      await uploadBackgroundImage(background.id, r.assets[0].uri, r.assets[0].mimeType || "image/jpeg");
      await loadBgs();
      Alert.alert("Added", "Background is now available to all creators.");
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(null);
    }
  };

  const removeBg = (id: string) =>
    Alert.alert("Remove background?", "Creators will no longer see it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => deleteBackground(id).then(loadBgs).catch(() => {}),
      },
    ]);

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      <Text style={s.section}>Catalog sound</Text>
      <Text style={s.hint}>Upload official sounds every creator can add to their posts.</Text>
      <TextInput
        style={s.input}
        placeholder="Title (optional)"
        placeholderTextColor={colors.dim}
        value={soundTitle}
        onChangeText={setSoundTitle}
      />
      <TouchableOpacity style={s.btn} onPress={uploadSound} disabled={!!busy}>
        <Text style={s.btnText}>⬆  Upload sound</Text>
      </TouchableOpacity>

      <Text style={[s.section, { marginTop: 26 }]}>Text backgrounds</Text>
      <Text style={s.hint}>Upload image backgrounds for text posts, available to all creators.</Text>
      <TouchableOpacity style={s.btn} onPress={uploadBackground} disabled={!!busy}>
        <Text style={s.btnText}>⬆  Upload background</Text>
      </TouchableOpacity>

      <View style={s.grid}>
        {bgs.map((id) => (
          <TouchableOpacity key={id} onLongPress={() => removeBg(id)}>
            <Image source={{ uri: backgroundImageUrl(id) }} style={s.bgThumb} />
          </TouchableOpacity>
        ))}
      </View>
      {bgs.length > 0 ? <Text style={s.hint}>Long-press a background to remove it.</Text> : null}

      {busy ? (
        <View style={s.busy}>
          <ActivityIndicator color={colors.accent} />
          <Text style={s.busyText}>{busy}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  denied: { color: colors.dim },
  section: { color: colors.text, fontWeight: "800", fontSize: 16 },
  hint: { color: colors.dim, fontSize: 13, marginTop: 4, marginBottom: 10 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnText: { color: "#000", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  bgThumb: { width: 76, height: 100, borderRadius: 10, backgroundColor: colors.card },
  busy: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 20, justifyContent: "center" },
  busyText: { color: colors.text },
});
