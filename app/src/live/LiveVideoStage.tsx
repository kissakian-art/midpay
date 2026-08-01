import {
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  useTracks,
  VideoTrack,
} from "@livekit/react-native";
import { useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { Track } from "livekit-client";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { liveToken } from "../api";
import { colors } from "../theme";

type Mode = "broadcast" | "watch";

/**
 * LiveVideoStage — the real WebRTC video for a live event (Phase B), rendered
 * inside LiveStage's `videoSlot`. It fetches a scoped LiveKit token from our
 * backend, joins the room, and shows the relevant camera track:
 *   broadcast → publish + show the LOCAL camera (the broadcaster's own feed)
 *   watch     → subscribe + show the REMOTE camera (the broadcaster's feed)
 *
 * If no token comes back — LiveKit keys not set yet, or any error — it quietly
 * falls back to `fallback` (the placeholder), so the room (chat/reactions) still
 * works and the same build behaves before and after the keys are configured.
 */
export default function LiveVideoStage({
  liveId,
  mode,
  creatorHandle,
  fallback,
}: {
  liveId: string;
  mode: Mode;
  creatorHandle: string;
  fallback: React.ReactNode;
}) {
  const isBroadcast = mode === "broadcast";
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
  const [failed, setFailed] = useState(false);

  // A broadcaster needs camera + mic before publishing.
  useEffect(() => {
    if (!isBroadcast) return;
    if (camPerm && !camPerm.granted && camPerm.canAskAgain) requestCam();
    if (micPerm && !micPerm.granted && micPerm.canAskAgain) requestMic();
  }, [isBroadcast, camPerm, micPerm, requestCam, requestMic]);

  // Get a room token scoped to this user's role (publish vs subscribe).
  useEffect(() => {
    let alive = true;
    liveToken(liveId)
      .then((r) => alive && setConn({ url: r.url, token: r.token }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [liveId]);

  // Manage the OS audio session for the duration of the room.
  useEffect(() => {
    AudioSession.startAudioSession().catch(() => {});
    return () => {
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, []);

  if (failed) return <>{fallback}</>;
  if (!conn) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={s.label}>Connecting to live…</Text>
      </Centered>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio={isBroadcast}
      video={isBroadcast}
      onError={() => setFailed(true)}
    >
      <RoomStage mode={mode} creatorHandle={creatorHandle} />
    </LiveKitRoom>
  );
}

/** Picks the right camera track from the room and renders it full-bleed. */
function RoomStage({ mode, creatorHandle }: { mode: Mode; creatorHandle: string }) {
  const tracks = useTracks([Track.Source.Camera]);
  const wantLocal = mode === "broadcast";
  const ref = tracks.find((t) => (wantLocal ? t.participant.isLocal : !t.participant.isLocal));

  if (ref && isTrackReference(ref)) {
    return (
      <VideoTrack
        trackRef={ref}
        style={StyleSheet.absoluteFill}
        objectFit="cover"
        mirror={wantLocal}
      />
    );
  }

  return (
    <Centered>
      <Text style={s.emoji}>{mode === "broadcast" ? "📷" : "📺"}</Text>
      <Text style={s.label}>
        {mode === "broadcast"
          ? "Starting your camera…"
          : `Waiting for @${creatorHandle}'s video…`}
      </Text>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={s.center}>{children}</View>;
}

const s = StyleSheet.create({
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#0c0c0c",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12,
  },
  emoji: { fontSize: 48 },
  label: { color: colors.dim, fontSize: 15, textAlign: "center" },
});
