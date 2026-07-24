import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
} from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import * as VideoThumbnails from "expo-video-thumbnails";
import {
  ApiError,
  applyCreator,
  createContent,
  publishContent,
  uploadMedia,
  uploadThumbnail,
} from "../api";
import OverlayEditor from "../components/OverlayEditor";
import { colors } from "../theme";
import { FILTER_GROUPS, NONE, type Filter, type FilterGroup } from "../studio/filters";
import { bakeFilterIntoPhoto } from "../studio/skiaFilter";
import { type TextOverlay } from "../api";

const MAX_SECONDS = 300; // §4.3 five-minute clip cap

interface Capture {
  uri: string;
  kind: "photo" | "video";
  filtered: boolean;
}

type CreateMode = "camera" | "text";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Grab a JPEG first-frame from a local video for the post cover. Best-effort. */
async function makeVideoThumbnail(videoUri: string): Promise<string | null> {
  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 300, quality: 0.7 });
    return uri;
  } catch {
    return null;
  }
}

export default function StudioScreen({ navigation }: { navigation: any }) {
  const [camPerm, requestCam] = useCameraPermissions();
  const [, requestMic] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);

  const [createMode, setCreateMode] = useState<CreateMode>("camera");
  const [facing, setFacing] = useState<CameraType>("back");
  const [mode, setMode] = useState<"picture" | "video">("picture");
  const [group, setGroup] = useState<FilterGroup>("aesthetic");
  const [filter, setFilter] = useState<Filter>(NONE);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const [capture, setCapture] = useState<Capture | null>(null);
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [textBody, setTextBody] = useState("");
  const [paid, setPaid] = useState(false);
  const priceUgx = 5000;

  const groupFilters = useMemo(
    () => FILTER_GROUPS.find((g) => g.group === group)?.filters ?? [],
    [group],
  );

  // Live recording timer — the missing feedback that made capture feel dead.
  useEffect(() => {
    if (!recording) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  if (!camPerm) return <View style={s.root} />;
  if (!camPerm.granted && createMode === "camera") {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.permText}>Camera access is needed to record and film posts.</Text>
        <TouchableOpacity style={s.primaryBtn} onPress={requestCam}>
          <Text style={s.primaryBtnText}>Grant camera access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.secondaryBtn, { marginTop: 12 }]} onPress={() => setCreateMode("text")}>
          <Text style={s.secondaryBtnText}>Write a text post instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Open a fresh review with no leftover overlays from a previous take.
  const openCapture = (c: Capture) => {
    setOverlays([]);
    setCapture(c);
  };
  const closeReview = () => {
    setCapture(null);
    setOverlays([]);
  };

  const takePhoto = async () => {
    if (!ready) {
      Alert.alert("Camera not ready", "Give it a moment and try again.");
      return;
    }
    try {
      setBusy("Capturing…");
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
      if (!shot?.uri) throw new Error("Camera returned no image");
      const baked = await bakeFilterIntoPhoto(shot.uri, filter);
      openCapture({ uri: baked.uri, kind: "photo", filtered: baked.filtered });
    } catch (e) {
      Alert.alert("Couldn't take photo", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(null);
    }
  };

  const toggleRecord = async () => {
    if (recording) {
      cameraRef.current?.stopRecording();
      return;
    }
    if (!ready) {
      Alert.alert("Camera not ready", "Give it a moment and try again.");
      return;
    }
    const mic = await requestMic();
    if (!mic.granted) {
      Alert.alert("Microphone needed", "Allow microphone access to record video with sound.");
      return;
    }
    setRecording(true);
    try {
      const rec = await cameraRef.current?.recordAsync({ maxDuration: MAX_SECONDS });
      if (rec?.uri) openCapture({ uri: rec.uri, kind: "video", filtered: false });
      else Alert.alert("Recording failed", "No video was produced. Try again.");
    } catch (e) {
      Alert.alert("Recording failed", e instanceof Error ? e.message : "Try again");
    } finally {
      setRecording(false);
    }
  };

  const pickFromGallery = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to upload from your phone.");
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos", "images"],
        videoMaxDuration: MAX_SECONDS,
      });
      if (!r.canceled && r.assets[0]) {
        const a = r.assets[0];
        openCapture({
          uri: a.uri,
          kind: a.type === "image" ? "photo" : "video",
          filtered: false,
        });
      }
    } catch (e) {
      Alert.alert("Couldn't open gallery", e instanceof Error ? e.message : "Try again");
    }
  };

  const ensureCreator = async () => {
    try {
      await applyCreator();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "already_creator")) throw e;
    }
  };

  const postMedia = async () => {
    if (!capture) return;
    try {
      setBusy("Setting up your profile…");
      await ensureCreator();
      setBusy("Creating post…");
      const { content } = await createContent({
        kind: capture.kind,
        title: filter.id === "none" ? "New post" : `${filter.name} post`,
        pricing: paid ? "paid" : "free",
        ...(paid ? { priceUgx } : {}),
        ...(overlays.length ? { overlays } : {}),
      });
      setBusy("Uploading…");
      await uploadMedia(
        content.id,
        capture.uri,
        capture.kind === "photo" ? "image/jpeg" : "video/mp4",
      );
      // Cover thumbnail: a photo is its own cover; a video gets its first frame.
      const thumbUri =
        capture.kind === "photo" ? capture.uri : await makeVideoThumbnail(capture.uri);
      if (thumbUri) await uploadThumbnail(content.id, thumbUri);
      setBusy("Publishing…");
      await publishContent(content.id);
      setBusy(null);
      closeReview();
      Alert.alert("Published!", "Your post is live on the feed.");
      navigation.navigate("FeedTab");
    } catch (e) {
      setBusy(null);
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again");
    }
  };

  const postText = async () => {
    const body = textBody.trim();
    if (!body) {
      Alert.alert("Nothing to post", "Write something first.");
      return;
    }
    try {
      setBusy("Setting up your profile…");
      await ensureCreator();
      setBusy("Posting…");
      const { content } = await createContent({
        kind: "text",
        title: body.slice(0, 60),
        description: body,
        pricing: paid ? "paid" : "free",
        ...(paid ? { priceUgx } : {}),
      });
      await publishContent(content.id);
      setBusy(null);
      setTextBody("");
      setCreateMode("camera");
      Alert.alert("Posted!", "Your text post is live on the feed.");
      navigation.navigate("FeedTab");
    } catch (e) {
      setBusy(null);
      Alert.alert("Post failed", e instanceof Error ? e.message : "Try again");
    }
  };

  const modeStrip = (
    <View style={s.modeStrip}>
      {([
        ["camera", "📷", "Camera"],
        ["upload", "🖼", "Upload"],
        ["text", "✍️", "Text"],
      ] as const).map(([key, icon, label]) => {
        const active = key === "upload" ? false : createMode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[s.modeItem, active && s.modeItemActive]}
            onPress={() => {
              if (key === "upload") pickFromGallery();
              else setCreateMode(key);
            }}
          >
            <Text style={s.modeIcon}>{icon}</Text>
            <Text style={[s.modeLabel, active && s.modeLabelActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // --- Text composer mode ---
  if (createMode === "text") {
    return (
      <KeyboardAvoidingView
        style={s.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.textHeader}>
          <Text style={s.textTitle}>Write a post</Text>
        </View>
        <TextInput
          style={s.textInput}
          placeholder="What do you want to share?"
          placeholderTextColor={colors.dim}
          multiline
          value={textBody}
          onChangeText={setTextBody}
          maxLength={1000}
          autoFocus
        />
        <Text style={s.counter}>{textBody.length}/1000</Text>
        <View style={[s.priceRow, s.composerPad]}>
          <TouchableOpacity style={[s.toggle, !paid && s.toggleActive]} onPress={() => setPaid(false)}>
            <Text style={[s.toggleText, !paid && s.toggleTextActive]}>Free</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.toggle, paid && s.toggleActive]} onPress={() => setPaid(true)}>
            <Text style={[s.toggleText, paid && s.toggleTextActive]}>Paid · 5,000 UGX</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[s.primaryBtn, s.composerPost]}
          onPress={postText}
          disabled={!!busy}
        >
          {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Post</Text>}
        </TouchableOpacity>
        {modeStrip}
      </KeyboardAvoidingView>
    );
  }

  // --- Camera mode ---
  return (
    <View style={s.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode={mode}
        onCameraReady={() => setReady(true)}
      />

      <View style={s.topBar}>
        <TouchableOpacity onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}>
          <Text style={s.topIcon}>🔄</Text>
        </TouchableOpacity>
        <View style={s.captureToggle}>
          {(["picture", "video"] as const).map((m) => (
            <TouchableOpacity key={m} onPress={() => !recording && setMode(m)}>
              <Text style={[s.modeText, mode === m && s.modeTextActive]}>
                {m === "picture" ? "Photo" : "Video"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ width: 26 }} />
      </View>

      {/* Recording indicator + timer */}
      {recording ? (
        <View style={s.recBadge}>
          <View style={s.recDot} />
          <Text style={s.recText}>
            {mmss(elapsed)} / {mmss(MAX_SECONDS)}
          </Text>
        </View>
      ) : !ready ? (
        <Text style={s.devNote}>Starting camera…</Text>
      ) : null}

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
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.shutterRow}>
          <Text style={s.activeFilter}>{filter.id === "none" ? "" : filter.name}</Text>
          <TouchableOpacity
            style={[s.shutter, recording && s.shutterRec, !ready && s.shutterDisabled]}
            onPress={mode === "picture" ? takePhoto : toggleRecord}
            disabled={!ready || !!busy}
          >
            <View style={[s.shutterInner, recording && s.shutterInnerRec]} />
          </TouchableOpacity>
          <View style={{ width: 60 }} />
        </View>

        {modeStrip}
      </View>

      {busy ? (
        <View style={s.busyOverlay}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={s.busyText}>{busy}</Text>
        </View>
      ) : null}

      {/* Review + post — full-bleed editor (add/drag text) above the post bar. */}
      <Modal visible={!!capture} animationType="slide" onRequestClose={closeReview}>
        <View style={s.reviewRoot}>
          {capture ? (
            <OverlayEditor
              uri={capture.uri}
              kind={capture.kind}
              overlays={overlays}
              onChange={setOverlays}
            />
          ) : null}

          <View style={s.reviewBar}>
            <View style={s.priceRow}>
              <TouchableOpacity style={[s.toggle, !paid && s.toggleActive]} onPress={() => setPaid(false)}>
                <Text style={[s.toggleText, !paid && s.toggleTextActive]}>Free</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.toggle, paid && s.toggleActive]} onPress={() => setPaid(true)}>
                <Text style={[s.toggleText, paid && s.toggleTextActive]}>Paid · 5,000 UGX</Text>
              </TouchableOpacity>
            </View>

            <View style={s.reviewActions}>
              <TouchableOpacity style={s.secondaryBtn} onPress={closeReview} disabled={!!busy}>
                <Text style={s.secondaryBtnText}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.primaryBtn} onPress={postMedia} disabled={!!busy}>
                {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryBtnText}>Post</Text>}
              </TouchableOpacity>
            </View>
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
  captureToggle: {
    flexDirection: "row",
    gap: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  modeText: { color: colors.dim, fontWeight: "700" },
  modeTextActive: { color: colors.accent },
  recBadge: {
    position: "absolute",
    top: 96,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  recText: { color: "#fff", fontWeight: "800", fontVariant: ["tabular-nums"] },
  devNote: {
    position: "absolute",
    top: 96,
    alignSelf: "center",
    color: colors.dim,
    fontSize: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  filterBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 10,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  groupTabs: { flexDirection: "row", justifyContent: "center", gap: 22, marginBottom: 8, marginTop: 10 },
  groupTab: { color: colors.dim, fontWeight: "700", fontSize: 13 },
  groupTabActive: { color: colors.accent },
  chips: { paddingHorizontal: 14, gap: 8, alignItems: "center" },
  chip: {
    backgroundColor: "rgba(30,30,30,0.85)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#000" },
  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 30,
    marginTop: 12,
  },
  activeFilter: { color: colors.text, width: 60, fontSize: 11 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterDisabled: { opacity: 0.4 },
  shutterRec: { borderColor: colors.danger },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#fff" },
  shutterInnerRec: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.danger },
  modeStrip: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  modeItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(30,30,30,0.85)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeItemActive: { borderColor: colors.accent },
  modeIcon: { fontSize: 15 },
  modeLabel: { color: colors.dim, fontWeight: "700", fontSize: 12 },
  modeLabelActive: { color: colors.accent },
  busyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  busyText: { color: colors.text, marginTop: 12 },
  reviewRoot: { flex: 1, backgroundColor: "#000" },
  reviewBar: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, backgroundColor: colors.bg },
  priceRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  toggle: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  toggleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleText: { color: colors.dim, fontWeight: "700" },
  toggleTextActive: { color: "#000" },
  reviewActions: { flexDirection: "row", gap: 12, marginTop: 18, marginBottom: 30 },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: 16,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#000", fontWeight: "800", fontSize: 16 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: colors.text, fontWeight: "700" },
  textHeader: { paddingTop: 60, paddingHorizontal: 20 },
  textTitle: { color: colors.text, fontSize: 24, fontWeight: "800" },
  textInput: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    padding: 20,
    textAlignVertical: "top",
  },
  counter: { color: colors.dim, fontSize: 12, textAlign: "right", paddingHorizontal: 20 },
  composerPad: { paddingHorizontal: 20 },
  // The shared primaryBtn is flex:1 for the side-by-side review row; as a
  // standalone in the composer it must NOT grow to fill the column.
  composerPost: { flex: 0, marginHorizontal: 20, marginTop: 12 },
});
