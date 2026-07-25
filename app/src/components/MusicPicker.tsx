import { useAudioPlayer } from "expo-audio";
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
import { createTrack, listTracks, musicAudioUrl, uploadTrackAudio, type Track } from "../api";
import { colors } from "../theme";

interface Props {
  visible: boolean;
  currentTrackId: string | null;
  onSelect: (track: Track | null) => void;
  onClose: () => void;
}

/**
 * Music picker: browse the shared track library (search) or upload a sound from
 * the device. Tapping a library track PREVIEWS it (plays immediately) so the
 * creator hears it before posting; "Use this sound" attaches it to the post.
 */
export default function MusicPicker({ visible, currentTrackId, onSelect, onClose }: Props) {
  const [q, setQ] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Preview: one shared player; `playingId` is the track currently sounding,
  // `chosen` is the track "Use this sound" will attach.
  const player = useAudioPlayer(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Track | null>(null);

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

  // Stop any preview when the sheet closes.
  useEffect(() => {
    if (!visible) stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function stopPreview() {
    try {
      player.pause();
    } catch {
      // released
    }
    setPlayingId(null);
  }

  // Tap a track → toggle its preview and mark it as the chosen sound.
  function togglePreview(track: Track) {
    setChosen(track);
    if (playingId === track.id) {
      stopPreview();
      return;
    }
    try {
      player.replace({ uri: musicAudioUrl(track.id) });
      player.volume = 1;
      player.seekTo(0).catch(() => {});
      player.play();
      setPlayingId(track.id);
    } catch {
      // player not ready
    }
  }

  function useChosen() {
    stopPreview();
    onSelect(chosen);
    onClose();
  }

  function chooseNone() {
    stopPreview();
    onSelect(null);
    onClose();
  }

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
      stopPreview();
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

          <TouchableOpacity style={[s.row, !currentTrackId && s.rowActive]} onPress={chooseNone}>
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
              renderItem={({ item }) => {
                const isPlaying = playingId === item.id;
                const isChosen = chosen?.id === item.id || (!chosen && currentTrackId === item.id);
                return (
                  <TouchableOpacity
                    style={[s.row, isChosen && s.rowActive]}
                    onPress={() => togglePreview(item)}
                  >
                    <Text style={[s.rowIcon, isPlaying && { color: colors.accent }]}>
                      {isPlaying ? "⏸" : "▶"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={s.rowSub} numberOfLines={1}>
                        {isPlaying ? "Playing…" : item.artist || "Tap to preview"}
                      </Text>
                    </View>
                    {isChosen ? <Text style={s.check}>✓</Text> : null}
                  </TouchableOpacity>
                );
              }}
            />
          )}

          <TouchableOpacity
            style={[s.useBtn, !chosen && s.useBtnDisabled]}
            onPress={useChosen}
            disabled={!chosen}
          >
            <Text style={[s.useBtnText, !chosen && { color: colors.dim }]}>
              {chosen ? `Use “${chosen.title}”` : "Tap a sound to preview"}
            </Text>
          </TouchableOpacity>
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
  rowIcon: { fontSize: 18, color: colors.text, width: 22, textAlign: "center" },
  rowTitle: { color: colors.text, fontWeight: "700", fontSize: 15 },
  rowSub: { color: colors.dim, fontSize: 12, marginTop: 1 },
  check: { color: colors.accent, fontWeight: "900", fontSize: 16 },
  empty: { color: colors.dim, textAlign: "center", marginTop: 24 },
  useBtn: {
    marginTop: 12,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  useBtnDisabled: { backgroundColor: colors.card },
  useBtnText: { color: "#000", fontWeight: "800", fontSize: 15 },
});
