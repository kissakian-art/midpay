import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
} from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ApiError, applyCreator, createContent, publishContent, uploadMedia } from "../api";
import { colors } from "../theme";
import { FILTER_GROUPS, NONE, type Filter, type FilterGroup } from "../studio/filters";
import { bakeFilterIntoPhoto, isSkiaAvailable } from "../studio/skiaFilter";

interface Capture {
  uri: string;
  kind: "photo" | "video";
  filtered: boolean;
}

export default function StudioScreen({ navigation }: { navigation: any }) {
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);

  const [facing, setFacing] = useState<CameraType>("back");
  const [mode, setMode] = useState<"picture" | "video">("picture");
  const [group, setGroup] = useState<FilterGroup>("aesthetic");
  const [filter, setFilter] = useState<Filter>(NONE);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [capture, setCapture] = useState<Capture | null>(null);
  const [paid, setPaid] = useState(false);
  const [priceUgx, setPriceUgx] = useState(5000);

  const groupFilters = useMemo(
    () => FILTER_GROUPS.find((g) => g.group === group)?.filters ?? [],
    [group],
  );

  if (!camPerm) return <View style={s.root} />;
  if (!camPerm.granted) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.permText}>Camera access is needed to record and apply filters.</Text>
        <TouchableOpacity style={s.primaryBtn} onPress={requestCam}>
          <Text style={s.primaryBtnText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const takePhoto = async () => {
    const shot = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
    if (!shot) return;
    setBusy("Applying filter…");
    const baked = await bakeFilterIntoPhoto(shot.uri, filter);
    setBusy(null);
    setCapture({ uri: baked.uri, kind: "photo", filtered: baked.filtered });
  };

  const toggleRecord = async () => {
    if (recording) {
      cameraRef.current?.stopRecording();
      return;
    }
    if (!micPerm?.granted) {
      const r = await requestMic();
      if (!r.granted) {
        Alert.alert("Microphone needed", "Allow microphone access to record video with sound.");
        return;
      }
    }
    setRecording(true);
    try {
      const rec = await cameraRef.current?.recordAsync({ maxDuration: 300 });
      if (rec?.uri) setCapture({ uri: rec.uri, kind: "video", filtered: false });
    } finally {
      setRecording(false);
    }
  };

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 300,
    });
    if (!r.canceled && r.assets[0]) {
      setCapture({ uri: r.assets[0].uri, kind: "video", filtered: false });
    }
  };

  const post = async () => {
    if (!capture) return;
    try {
      setBusy("Setting up creator profile…");
      try {
        await applyCreator();
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "already_creator")) throw e;
      }
      setBusy("Creating post…");
      const { content } = await createContent({
        kind: capture.kind,
        title: filter.id === "none" ? "New post" : `${filter.name} post`,
        pricing: paid ? "paid" : "free",
        ...(paid ? { priceUgx } : {}),
      });
      setBusy("Uploading…");
      const contentType = capture.kind === "photo" ? "image/jpeg" : "video/mp4";
      await uploadMedia(content.id, capture.uri, contentType);
      setBusy("Publishing…");
      await publishContent(content.id);
      setBusy(null);
      setCapture(null);
      Alert.alert("Published!", "Your post is live on the feed.");
      navigation.navigate("FeedTab");
    } catch (e) {
      setBusy(null);
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again");
    }
  };

  return (
    <View style={s.root}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode={mode} />

      {/* Top controls */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}>
          <Text style={s.topIcon}>🔄</Text>
        </TouchableOpacity>
        <View style={s.modeToggle}>
          {(["picture", "video"] as const).map((m) => (
            <TouchableOpacity key={m} onPress={() => setMode(m)}>
              <Text style={[s.modeText, mode === m && s.modeTextActive]}>
                {m === "picture" ? "Photo" : "Video"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={pickFromGallery}>
          <Text style={s.topIcon}>🖼</Text>
        </TouchableOpacity>
      </View>

      {!isSkiaAvailable() ? (
        <Text style={s.devNote}>Filters preview here; they bake into the file in the installed app.</Text>
      ) : null}

      {/* Filter carousel */}
      <View style={s.filterBar}>
        <View style={s.groupTabs}>
          {FILTER_GROUPS.map((g) => (
            <TouchableOpacity key={g.group} onPress={() => setGroup(g.group)}>
              <Text style={[s.groupTab, group === g.group && s.groupTabActive]}>{g.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {groupFilters.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[s.chip, filter.id === f.id && s.chipActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[s.chipText, filter.id === f.id && s.chipTextActive]}>{f.name}</Text>
              {"approximate" in f && f.approximate ? <Text style={s.approxDot}>~</Text> : null}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Shutter */}
        <View style={s.shutterRow}>
          <Text style={s.activeFilter}>{filter.name}</Text>
          <TouchableOpacity
            style={[s.shutter, recording && s.shutterRec]}
            onPress={mode === "picture" ? takePhoto : toggleRecord}
          >
            <View style={[s.shutterInner, recording && s.shutterInnerRec]} />
          </TouchableOpacity>
          <View style={{ width: 60 }} />
        </View>
      </View>

      {busy ? (
        <View style={s.busyOverlay}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={s.busyText}>{busy}</Text>
        </View>
      ) : null}

      {/* Review + post */}
      <Modal visible={!!capture} animationType="slide" onRequestClose={() => setCapture(null)}>
        <View style={s.review}>
          {capture?.kind === "photo" ? (
            <Image source={{ uri: capture.uri }} style={s.reviewMedia} resizeMode="contain" />
          ) : (
            <View style={[s.reviewMedia, s.center]}>
              <Text style={s.videoIcon}>🎞</Text>
              <Text style={s.reviewNote}>Video ready to post</Text>
            </View>
          )}
          {capture && !capture.filtered && filter.id !== "none" ? (
            <Text style={s.reviewWarn}>
              Filter “{filter.name}” selected — it bakes in on the installed app build.
            </Text>
          ) : null}

          <View style={s.priceRow}>
            <TouchableOpacity style={[s.toggle, !paid && s.toggleActive]} onPress={() => setPaid(false)}>
              <Text style={[s.toggleText, !paid && s.toggleTextActive]}>Free</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.toggle, paid && s.toggleActive]} onPress={() => setPaid(true)}>
              <Text style={[s.toggleText, paid && s.toggleTextActive]}>Paid · 5,000 UGX</Text>
            </TouchableOpacity>
          </View>

          <View style={s.reviewActions}>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => setCapture(null)}>
              <Text style={s.secondaryBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={post} disabled={!!busy}>
              {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Post</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  permText: { color: colors.text, textAlign: "center", marginBottom: 20 },
  topBar: {
    position: "absolute",
    top: 50,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  topIcon: { fontSize: 26 },
  modeToggle: { flexDirection: "row", gap: 18, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  modeText: { color: colors.dim, fontWeight: "700" },
  modeTextActive: { color: colors.accent },
  devNote: {
    position: "absolute",
    top: 92,
    alignSelf: "center",
    color: colors.dim,
    fontSize: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  filterBar: { position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: 24, backgroundColor: "rgba(0,0,0,0.35)" },
  groupTabs: { flexDirection: "row", justifyContent: "center", gap: 22, marginBottom: 8, marginTop: 10 },
  groupTab: { color: colors.dim, fontWeight: "700", fontSize: 13 },
  groupTabActive: { color: colors.accent },
  chips: { paddingHorizontal: 14, gap: 8, alignItems: "center" },
  chip: {
    flexDirection: "row",
    backgroundColor: "rgba(30,30,30,0.8)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#000" },
  approxDot: { color: colors.dim, marginLeft: 3, fontSize: 12 },
  shutterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 30, marginTop: 14 },
  activeFilter: { color: colors.text, width: 60, fontSize: 11 },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterRec: { borderColor: colors.danger },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#fff" },
  shutterInnerRec: { width: 30, height: 30, borderRadius: 6, backgroundColor: colors.danger },
  busyOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  busyText: { color: colors.text, marginTop: 12 },
  review: { flex: 1, backgroundColor: colors.bg, paddingTop: 50, paddingHorizontal: 20 },
  reviewMedia: { flex: 1, borderRadius: 14, backgroundColor: colors.surface },
  videoIcon: { fontSize: 60 },
  reviewNote: { color: colors.dim, marginTop: 8 },
  reviewWarn: { color: colors.dim, fontSize: 12, textAlign: "center", marginTop: 10 },
  priceRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  toggle: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  toggleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleText: { color: colors.dim, fontWeight: "700" },
  toggleTextActive: { color: "#000" },
  reviewActions: { flexDirection: "row", gap: 12, marginTop: 18, marginBottom: 30 },
  primaryBtn: { flex: 1, backgroundColor: colors.accent, borderRadius: 12, padding: 16, alignItems: "center" },
  primaryBtnText: { color: "#000", fontWeight: "800", fontSize: 16 },
  secondaryBtn: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 16, alignItems: "center" },
  secondaryBtnText: { color: colors.text, fontWeight: "700" },
});
