import { useAudioPlayer } from "expo-audio";
import * as ScreenCapture from "expo-screen-capture";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ApiError,
  authHeaders,
  checkout,
  devSettle,
  follow,
  like,
  mediaUrl,
  musicAudioUrl,
  unfollow,
  unlike,
  type FeedItem,
} from "../api";
import { useAuth } from "../auth";
import { colors, ugx } from "../theme";
import Avatar from "./Avatar";
import TextBackground from "./TextBackground";
import TextOverlayLayer from "./TextOverlayLayer";

interface Props {
  item: FeedItem;
  active: boolean;
  height: number;
  onOpenComments: (item: FeedItem) => void;
  onMessageCreator: (item: FeedItem) => void;
  onOpenProfile: (item: FeedItem) => void;
}

const SCRUB_MARGIN = 12;

/** Map a touch X to a seek time and update the visible position. */
function scrubTo(
  state: { duration: number; width: number },
  pageX: number,
  seekTarget: React.MutableRefObject<number>,
  setPosition: (n: number) => void,
) {
  const { duration, width } = state;
  if (!duration) return;
  const trackW = width - SCRUB_MARGIN * 2;
  const frac = Math.min(1, Math.max(0, (pageX - SCRUB_MARGIN) / trackW));
  const t = frac * duration;
  seekTarget.current = t;
  setPosition(t);
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

/**
 * One full-screen feed cell: video (free = plays immediately; paid = locked
 * behind a buy overlay), with the right-rail actions (like/comment/DM).
 */
export default function FeedItemView({
  item,
  active,
  height,
  onOpenComments,
  onMessageCreator,
  onOpenProfile,
}: Props) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isSelf = user?.id === item.creatorUserId;
  const [unlocked, setUnlocked] = useState(item.pricing === "free" || item.owned);
  const [buying, setBuying] = useState(false);
  const [liked, setLiked] = useState(false);
  const [following, setFollowing] = useState(false);
  const [likeCount, setLikeCount] = useState(item.likeCount);

  // Playback controls (tap-to-pause + scrubber).
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const scrubbing = useRef(false);
  const seekTarget = useRef(0);
  const lastVideoPos = useRef(0);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
  });

  const isVideo = unlocked && item.kind === "video";
  // Music can back ANY post kind (video / photo / text) — composed at playback.
  const hasMusic = unlocked && !!item.musicTrackId;
  const audio = useAudioPlayer(hasMusic ? { uri: musicAudioUrl(item.musicTrackId as string) } : null);

  // Controls apply to anything playable: a video, OR a photo/text with music.
  const hasControls = isVideo || hasMusic;

  // Music segment [startSec, endSec). For photo/text the segment length is the
  // post's play duration; for video the music is capped to the video length.
  const startSec = (item.musicStartMs ?? 0) / 1000;
  const endSec = item.musicEndMs != null ? item.musicEndMs / 1000 : null;
  const segLen = endSec != null ? Math.max(0.1, endSec - startSec) : 0;

  useEffect(() => {
    if (!unlocked || item.kind !== "video") return;
    const source: VideoSource = { uri: mediaUrl(item.id), headers: authHeaders() };
    player.replaceAsync(source).catch(() => {});
  }, [unlocked, item.id, item.kind, player]);

  useEffect(() => {
    player.muted = hasMusic; // music replaces the original video audio
  }, [player, hasMusic]);

  const playing = active && unlocked && !paused;

  useEffect(() => {
    if (!isVideo) return;
    if (playing) player.play();
    else player.pause();
  }, [playing, isVideo, player]);

  // A cell that scrolls off-screen forgets any manual pause so it autoplays
  // fresh next time it becomes active.
  useEffect(() => {
    if (!active) setPaused(false);
  }, [active]);

  // Seek music to the segment start when the cell first becomes active.
  useEffect(() => {
    if (active && hasMusic) {
      try {
        audio.seekTo(startSec).catch(() => {});
      } catch {
        // not ready
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasMusic]);

  useEffect(() => {
    if (!hasMusic) return;
    // expo-audio releases the player on unmount / source clear, so we never
    // pause in cleanup; all calls are guarded since the shared native object can
    // be released under us as cells recycle.
    try {
      audio.loop = true;
      if (playing) audio.play();
      else audio.pause();
    } catch {
      // already released
    }
  }, [playing, hasMusic, audio]);

  // Poll position for the scrubber and loop the music segment.
  useEffect(() => {
    if (!hasControls || !active) return;
    const id = setInterval(() => {
      if (scrubbing.current) return;
      try {
        if (isVideo) {
          const cur = player.currentTime || 0;
          // On each video loop restart the music so it never runs past the video.
          if (hasMusic && cur + 0.4 < lastVideoPos.current) {
            audio.seekTo(startSec).catch(() => {});
          }
          lastVideoPos.current = cur;
          if (player.duration) setDuration(player.duration);
          setPosition(cur);
        } else if (hasMusic) {
          const cur = audio.currentTime || 0;
          if (endSec != null && cur >= endSec) {
            audio.seekTo(startSec).catch(() => {});
            setPosition(0);
          } else {
            setPosition(Math.max(0, cur - startSec));
          }
          setDuration(segLen || Math.max(0.1, (audio.duration || 0) - startSec));
        }
      } catch {
        // players not ready
      }
    }, 250);
    return () => clearInterval(id);
  }, [hasControls, active, isVideo, hasMusic, player, audio, startSec, endSec, segLen]);

  // Scrubber drag → seek. Latest-ref so the one-time PanResponder isn't stale.
  const scrubState = useRef({ player, audio, isVideo, hasMusic, startSec, duration, width });
  scrubState.current = { player, audio, isVideo, hasMusic, startSec, duration, width };
  const scrub = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        scrubbing.current = true;
        scrubTo(scrubState.current, e.nativeEvent.pageX, seekTarget, setPosition);
      },
      onPanResponderMove: (e) => scrubTo(scrubState.current, e.nativeEvent.pageX, seekTarget, setPosition),
      onPanResponderRelease: () => {
        const st = scrubState.current;
        try {
          if (st.isVideo) st.player.currentTime = seekTarget.current;
          else if (st.hasMusic) st.audio.seekTo(st.startSec + seekTarget.current).catch(() => {});
        } catch {
          // ignore
        }
        scrubbing.current = false;
      },
    }),
  ).current;

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

  const toggleFollow = async () => {
    const next = !following;
    setFollowing(next); // optimistic
    try {
      if (next) await follow(item.creatorUserId);
      else await unfollow(item.creatorUserId);
    } catch {
      setFollowing(!next); // revert
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
      {item.kind === "text" && unlocked ? (
        <TextBackground
          bg={item.textStyle?.bg ?? ["#111111"]}
          bgImage={item.textStyle?.bgImage}
          style={s.textPost}
        >
          <Text
            style={[
              s.textPostBody,
              {
                color: item.textStyle?.color ?? "#fff",
                textAlign: item.textStyle?.align ?? "center",
                fontFamily: item.textStyle?.font ?? undefined,
                fontWeight: item.textStyle?.bold ? "800" : "600",
              },
            ]}
          >
            {item.description ?? item.title}
          </Text>
        </TextBackground>
      ) : unlocked && item.kind === "photo" ? (
        <Image
          source={{ uri: mediaUrl(item.id), headers: authHeaders() }}
          style={s.video}
          resizeMode="cover"
        />
      ) : unlocked ? (
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

      {/* Tap to pause/resume (video or a photo/text with music) + reveal scrubber. */}
      {hasControls ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPaused((p) => !p)} />
      ) : null}

      {/* Creator text overlays — only over real media the viewer can see. */}
      {unlocked && item.kind !== "text" ? (
        <TextOverlayLayer overlays={item.overlays} width={width} height={height} />
      ) : null}

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
        {/* Creator avatar with the TikTok-style follow shortcut */}
        <View style={s.avatarWrap}>
          <TouchableOpacity onPress={() => onOpenProfile(item)} activeOpacity={0.8}>
            <Avatar
              handle={item.creatorHandle}
              displayName={item.creatorDisplayName}
              userId={item.creatorUserId}
              avatarKey={item.creatorAvatarR2Key}
              size={48}
            />
          </TouchableOpacity>
          {!isSelf ? (
            <TouchableOpacity
              style={[s.followBadge, following && s.followBadgeDone]}
              onPress={toggleFollow}
              activeOpacity={0.8}
            >
              <Text style={s.followBadgeText}>{following ? "✓" : "+"}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

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

      {/* Big play glyph while paused. */}
      {hasControls && paused ? (
        <View pointerEvents="none" style={s.playIconWrap}>
          <Text style={s.playIcon}>▶</Text>
        </View>
      ) : null}

      {/* Scrubber — appears on tap (while paused); drag to seek. */}
      {hasControls && paused ? (
        <View style={s.scrubberWrap} {...scrub.panHandlers}>
          <Text style={s.scrubTime}>
            {mmss(position)} / {mmss(duration)}
          </Text>
          <View style={s.scrubTrack}>
            <View
              style={[s.scrubFill, { width: duration ? `${(position / duration) * 100}%` : "0%" }]}
            />
            <View
              style={[
                s.scrubKnob,
                { left: duration ? (position / duration) * (width - SCRUB_MARGIN * 2) - 7 : -7 },
              ]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  cell: { width: "100%", backgroundColor: colors.bg },
  video: { flex: 1 },
  textPost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 90,
  },
  textPostBody: { fontSize: 26, lineHeight: 36 },
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
  // Offsets clear the taller (68px) tab bar so nothing hides behind it.
  meta: { position: "absolute", left: 14, bottom: 90, right: 90 },
  handle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  title: { color: colors.text, marginTop: 4 },
  ownedBadge: { color: colors.success, marginTop: 6, fontWeight: "700", fontSize: 12 },
  rail: { position: "absolute", right: 10, bottom: 100, alignItems: "center", gap: 18 },
  action: { alignItems: "center" },
  actionIcon: {
    fontSize: 32,
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  actionLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Avatar + follow shortcut (TikTok-style: "+" badge overlapping the avatar).
  avatarWrap: { alignItems: "center", marginBottom: 6 },
  followBadge: {
    position: "absolute",
    bottom: -9,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  followBadgeDone: { backgroundColor: colors.accent },
  followBadgeText: { color: "#fff", fontSize: 13, fontWeight: "900", lineHeight: 15 },
  playIconWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 60,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  // Sits just above the tab bar; generous vertical padding = an easy grab target
  // around the thin visible line.
  scrubberWrap: {
    position: "absolute",
    left: SCRUB_MARGIN,
    right: SCRUB_MARGIN,
    bottom: 74,
    paddingVertical: 10,
  },
  scrubTime: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  scrubTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.35)",
    justifyContent: "center",
  },
  scrubFill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
  scrubKnob: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
  },
});
