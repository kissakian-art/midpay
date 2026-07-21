import * as ScreenCapture from "expo-screen-capture";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ApiError, authHeaders, checkout, devSettle, like, mediaUrl, unlike, type FeedItem } from "../api";
import { colors, ugx } from "../theme";

interface Props {
  item: FeedItem;
  active: boolean;
  height: number;
  onOpenComments: (item: FeedItem) => void;
  onMessageCreator: (item: FeedItem) => void;
}

/**
 * One full-screen feed cell: video (free = plays immediately; paid = locked
 * behind a buy overlay), with the right-rail actions (like/comment/DM).
 */
export default function FeedItemView({ item, active, height, onOpenComments, onMessageCreator }: Props) {
  const [unlocked, setUnlocked] = useState(item.pricing === "free");
  const [buying, setBuying] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(item.likeCount);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    if (!unlocked) return;
    const source: VideoSource = { uri: mediaUrl(item.id), headers: authHeaders() };
    player.replaceAsync(source).catch(() => {});
  }, [unlocked, item.id, player]);

  useEffect(() => {
    if (active && unlocked) player.play();
    else player.pause();
  }, [active, unlocked, player]);

  // §4.4 content protection: while a PAID video is on screen, block screen
  // capture (FLAG_SECURE on Android / capture detection on iOS). Free content
  // stays capturable by design — it's the shareable marketing surface.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (item.pricing !== "paid" || !unlocked || !active) return;
    const tag = `paid-${item.id}`;
    ScreenCapture.preventScreenCaptureAsync(tag).catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync(tag).catch(() => {});
    };
  }, [item.pricing, item.id, unlocked, active]);

  const buy = async () => {
    setBuying(true);
    try {
      const r = await checkout("video_unlock", item.id);
      if (r.simulated) {
        // Dev mode: settle instantly via the webhook (no real money moves).
        await devSettle(r.txRef, item.priceUgx ?? 0);
        setUnlocked(true);
      } else {
        Alert.alert(
          "Check your phone",
          "Approve the Mobile Money prompt, then tap Unlock again to start watching.",
        );
      }
    } catch (e) {
      if (e instanceof ApiError && (e.code === "already_owned" || e.code === "already_paid")) {
        setUnlocked(true);
      } else {
        Alert.alert("Purchase failed", e instanceof Error ? e.message : "Try again");
      }
    } finally {
      setBuying(false);
    }
  };

  const toggleLike = async () => {
    try {
      if (liked) {
        setLiked(false);
        setLikeCount((n) => Math.max(0, n - 1));
        await unlike(item.id);
      } else {
        setLiked(true);
        setLikeCount((n) => n + 1);
        await like(item.id);
      }
    } catch {
      // revert on failure
      setLiked((v) => !v);
    }
  };

  return (
    <View style={[s.cell, { height }]}>
      {unlocked ? (
        <VideoView player={player} style={s.video} contentFit="cover" nativeControls={false} />
      ) : (
        <View style={s.locked}>
          <Text style={s.lockIcon}>🔒</Text>
          <Text style={s.lockTitle}>{item.title ?? "Premium video"}</Text>
          <Text style={s.lockPrice}>{ugx(item.priceUgx)}</Text>
          <TouchableOpacity style={s.buyBtn} onPress={buy} disabled={buying}>
            {buying ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={s.buyText}>Unlock · {ugx(item.priceUgx)}</Text>
            )}
          </TouchableOpacity>
          <Text style={s.lockNote}>Pay with Mobile Money</Text>
        </View>
      )}

      {/* Bottom-left: creator + title */}
      <View style={s.meta}>
        <Text style={s.handle}>@{item.creatorHandle}</Text>
        {item.title ? <Text style={s.title}>{item.title}</Text> : null}
        {item.pricing === "paid" && unlocked ? (
          <Text style={s.ownedBadge}>Purchased ✓</Text>
        ) : null}
      </View>

      {/* Right rail: actions */}
      <View style={s.rail}>
        <TouchableOpacity style={s.action} onPress={toggleLike}>
          <Text style={[s.actionIcon, liked && { color: colors.danger }]}>
            {liked ? "♥" : "♡"}
          </Text>
          <Text style={s.actionLabel}>{likeCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.action} onPress={() => onOpenComments(item)}>
          <Text style={s.actionIcon}>💬</Text>
          <Text style={s.actionLabel}>{item.commentCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.action} onPress={() => onMessageCreator(item)}>
          <Text style={s.actionIcon}>✉️</Text>
          <Text style={s.actionLabel}>DM</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  cell: { width: "100%", backgroundColor: colors.bg },
  video: { flex: 1 },
  locked: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    padding: 24,
  },
  lockIcon: { fontSize: 52, marginBottom: 12 },
  lockTitle: { color: colors.text, fontSize: 20, fontWeight: "700", textAlign: "center" },
  lockPrice: { color: colors.accent, fontSize: 17, marginTop: 6, fontWeight: "600" },
  buyBtn: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 20,
    minWidth: 200,
    alignItems: "center",
  },
  buyText: { color: "#000", fontWeight: "800", fontSize: 15 },
  lockNote: { color: colors.dim, marginTop: 10, fontSize: 12 },
  meta: { position: "absolute", left: 14, bottom: 28, right: 90 },
  handle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  title: { color: colors.text, marginTop: 4 },
  ownedBadge: { color: colors.success, marginTop: 6, fontWeight: "700", fontSize: 12 },
  rail: { position: "absolute", right: 10, bottom: 40, alignItems: "center", gap: 18 },
  action: { alignItems: "center" },
  actionIcon: { fontSize: 30, color: colors.text },
  actionLabel: { color: colors.text, fontSize: 12, marginTop: 2 },
});
