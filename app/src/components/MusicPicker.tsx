import * as DocumentPicker from "expo-document-picker";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { createTrack, listTracks, uploadTrackAudio, type Track } from "../api";
import { colors } from "../theme";

interface Props {
  visible: boolean;
  currentTrackId: string | null;
  onSelect: (track: Track | null) => void;
  onClose: () => void;
}

/**
 * Music picker: browse the shared track library (search) or upload a sound from
 * the device. Selecting attaches the track to the post; it plays over the media
 * in the feed. (Admin-curated catalog + "original sound" extraction are later.)
 */
export default function MusicPicker({ visible, currentTrackId, onSelect, onClose }: Props) {
  const [q, setQ] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    listTracks(q)
      .then((r) => alive && setTracks(r.tracks))
      .catch(() => alive && setTracks([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [visible, q]);

  const pickFromDevice = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setBusy(true);
      const title = (a.name || "My sound").replace(/\.[^/.]+$/, "").slice(0, 120);
      const { track } = await createTrack({ title });
      await uploadTrackAudio(track.id, a.uri, a.mimeType || "audio/mpeg");
      onSelect(track); // auto-attach the freshly uploaded sound
      onClose();
    } catch (e) {
      Alert.alert("Couldn't add audio", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Add music</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={s.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={s.search}
            placeholder="Search sounds"
            placeholderTextColor={colors.dim}
            value={q}
            onChangeText={setQ}
          />

          <TouchableOpacity style={s.upload} onPress={pickFromDevice} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={s.uploadText}>⬆  Upload from device</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.row, !currentTrackId && s.rowActive]}
            onPress={() => {
              onSelect(null);
              onClose();
            }}
          >
            <Text style={s.rowIcon}>🚫</Text>
            <Text style={s.rowTitle}>No music</Text>
          </TouchableOpacity>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={tracks}
              keyExtractor={(t) => t.id}
              style={s.list}
              ListEmptyComponent={<Text style={s.empty}>No sounds yet — upload one above.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.row, currentTrackId === item.id && s.rowActive]}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <Text style={s.rowIcon}>🎵</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.artist ? (
                      <Text style={s.rowSub} numberOfLines={1}>
                        {item.artist}
                      </Text>
                    ) : null}
                  </View>
                  {currentTrackId === item.id ? <Text style={s.check}>✓</Text> : null}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    maxHeight: "80%",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  close: { color: colors.dim, fontSize: 20, fontWeight: "700", paddingHorizontal: 6 },
  search: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  upload: {
    marginTop: 10,
    marginBottom: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: "center",
  },
  uploadText: { color: colors.accent, fontWeight: "800" },
  list: { marginTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  rowActive: { backgroundColor: colors.card },
  rowIcon: { fontSize: 18 },
  rowTitle: { color: colors.text, fontWeight: "700", fontSize: 15 },
  rowSub: { color: colors.dim, fontSize: 12, marginTop: 1 },
  check: { color: colors.accent, fontWeight: "900", fontSize: 16 },
  empty: { color: colors.dim, textAlign: "center", marginTop: 24 },
});
