import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLiveRoom, type LiveReaction } from "../live/useLiveRoom";
import { colors } from "../theme";

const QUICK_REACTIONS = ["❤️", "🔥", "👏", "😂", "😮"];

/**
 * LiveStage — the shared full-screen live surface used by BOTH the broadcaster
 * control room and the viewer screen. It owns the room socket (chat, reactions,
 * viewer count) and lays the overlay (top bar, floating reactions, chat feed,
 * composer) over a `videoSlot` that the caller supplies.
 *
 * Phase A: `videoSlot` is a labelled placeholder. Phase B drops the real
 * broadcaster/viewer video view in there with no change to this component.
 */
export default function LiveStage({
  liveId,
  connected,
  title,
  creatorHandle,
  roleBadge,
  headerRight,
  videoSlot,
}: {
  liveId: string;
  /** Only open the socket once we should be in the room (owner, or ticket held). */
  connected: boolean;
  title: string | null;
  creatorHandle: string;
  /** e.g. "YOU'RE LIVE" for the broadcaster; omitted for viewers. */
  roleBadge?: string;
  /** Right-hand control in the top bar (e.g. the broadcaster's End button). */
  headerRight?: React.ReactNode;
  videoSlot: React.ReactNode;
}) {
  const { messages, viewers, state, reactions, sendChat, sendReaction, clearReaction } =
    useLiveRoom(liveId, connected);
  const [draft, setDraft] = React.useState("");
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length) listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    sendChat(t);
    setDraft("");
  };

  return (
    <View style={s.root}>
      {/* Video (placeholder in Phase A, real stream in Phase B) */}
      <View style={StyleSheet.absoluteFill}>{videoSlot}</View>

      {/* Top bar */}
      <View style={s.topBar}>
        <View style={s.topLeft}>
          <View style={s.liveBadge}>
            <View style={s.liveDot} />
            <Text style={s.liveBadgeText}>{roleBadge ?? "LIVE"}</Text>
          </View>
          <View style={s.viewerPill}>
            <Text style={s.viewerText}>👁 {viewers}</Text>
          </View>
        </View>
        {headerRight ?? null}
      </View>

      <Text style={s.titleLine} numberOfLines={1}>
        @{creatorHandle}
        {title ? ` · ${title}` : ""}
      </Text>

      {/* Floating reactions */}
      <View pointerEvents="none" style={s.reactionLayer}>
        {reactions.map((r) => (
          <FloatingReaction key={r.id} reaction={r} onDone={() => clearReaction(r.id)} />
        ))}
      </View>

      {/* Chat feed + composer */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.bottom}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={s.chatList}
          contentContainerStyle={s.chatContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={s.chatRow}>
              <Text style={s.chatHandle}>@{item.handle} </Text>
              <Text style={s.chatBody}>{item.body}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={s.chatHint}>
              {state === "open" ? "Say hello 👋" : "Connecting to chat…"}
            </Text>
          }
        />

        <View style={s.reactionRow}>
          {QUICK_REACTIONS.map((e) => (
            <TouchableOpacity key={e} onPress={() => sendReaction(e)} style={s.reactBtn}>
              <Text style={s.reactBtnText}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.composer}>
          <TextInput
            style={s.input}
            placeholder="Add a comment…"
            placeholderTextColor={colors.dim}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={send}
            returnKeyType="send"
            maxLength={500}
          />
          <TouchableOpacity style={s.sendBtn} onPress={send} disabled={!draft.trim()}>
            <Text style={[s.sendText, !draft.trim() && { opacity: 0.4 }]}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** One reaction emoji that rises and fades, then removes itself. */
function FloatingReaction({ reaction, onDone }: { reaction: LiveReaction; onDone: () => void }) {
  const anim = useRef(new Animated.Value(0)).current;
  const drift = useRef((Math.random() - 0.5) * 60).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 2600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onDone());
    // onDone/anim are stable for this mounted reaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.Text
      style={[
        s.floatEmoji,
        {
          opacity: anim.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -220] }) },
            { translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, drift] }) },
            { scale: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.6, 1.2, 1] }) },
          ],
        },
      ]}
    >
      {reaction.emoji}
    </Animated.Text>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    position: "absolute",
    top: 52,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 5,
  },
  topLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.danger,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  liveBadgeText: { color: "#fff", fontWeight: "900", fontSize: 11, letterSpacing: 0.5 },
  viewerPill: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  viewerText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  titleLine: {
    position: "absolute",
    top: 88,
    left: 16,
    right: 16,
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    zIndex: 5,
  },
  reactionLayer: { position: "absolute", right: 24, bottom: 180, width: 80, height: 260 },
  floatEmoji: { position: "absolute", bottom: 0, right: 0, fontSize: 30 },
  bottom: { flex: 1, justifyContent: "flex-end", paddingBottom: 16 },
  chatList: { maxHeight: 220, marginBottom: 8 },
  chatContent: { paddingHorizontal: 14, justifyContent: "flex-end", flexGrow: 1 },
  chatRow: { flexDirection: "row", flexWrap: "wrap", marginVertical: 3, paddingRight: 90 },
  chatHandle: {
    color: colors.accent,
    fontWeight: "800",
    fontSize: 13,
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  chatBody: {
    color: "#fff",
    fontSize: 13,
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  chatHint: { color: colors.dim, fontSize: 13, paddingVertical: 6 },
  reactionRow: { flexDirection: "row", gap: 10, paddingHorizontal: 14, marginBottom: 8 },
  reactBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  reactBtnText: { fontSize: 20 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 14,
  },
  sendBtn: { paddingHorizontal: 6 },
  sendText: { color: colors.accent, fontWeight: "800", fontSize: 15 },
});
