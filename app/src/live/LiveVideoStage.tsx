import {
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  useLocalParticipant,
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
 * inside LiveStage's `videoSlot`.
 *   broadcast → publish + show the LOCAL camera (the broadcaster's own feed)
 *   watch     → subscribe + show the REMOTE camera (the broadcaster's feed)
 *
 * Broadcaster start-up is order-sensitive: we (1) get camera+mic permission
 * BEFORE connecting, and (2) explicitly enable the camera once in the room —
 * relying on the room's auto-publish props alone left it stuck on "starting
 * your camera" on Android. On any failure it falls back to `fallback`.
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

  // Broadcaster: request camera + mic up front, before we ever connect.
  useEffect(() => {
    if (!isBroadcast) return;
    (async () => {
      try {
        if (!camPerm?.granted) await requestCam();
        if (!micPerm?.granted) await requestMic();
      } catch {
        // handled by the gate below
      }
    })();
    // Only needs to run as the (un)granted state resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBroadcast, camPerm?.granted, micPerm?.granted]);

  // Scoped LiveKit token from our backend.
  useEffect(() => {
    let alive = true;
    liveToken(liveId)
      .then((r) => alive && setConn({ url: r.url, token: r.token }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [liveId]);

  // OS audio session for the duration of the room.
  useEffect(() => {
    AudioSession.startAudioSession().catch(() => {});
    return () => {
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, []);

  if (failed) return <>{fallback}</>;

  // A broadcaster must hold camera + mic before we connect with capture on.
  const needsPerms = isBroadcast && !(camPerm?.granted && micPerm?.granted);
  if (!conn || needsPerms) {
    return (
      <Centered>
        {needsPerms ? (
          <>
            <Text style={s.emoji}>🎥</Text>
            <Text style={s.label}>Allow camera and microphone access to go live.</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={s.label}>Connecting to live…</Text>
          </>
        )}
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
      {isBroadcast ? <EnsureCapture /> : null}
      <RoomStage mode={mode} creatorHandle={creatorHandle} />
    </LiveKitRoom>
  );
}

/**
 * Explicitly turn the camera + mic on once we're in the room. The room's
 * audio/video props are supposed to do this on connect, but on Android that
 * wasn't reliable — this makes the broadcaster's capture deterministic.
 * Idempotent, so it's safe alongside the props.
 */
function EnsureCapture() {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    if (!localParticipant) return;
    localParticipant.setCameraEnabled(true).catch(() => {});
    localParticipant.setMicrophoneEnabled(true).catch(() => {});
  }, [localParticipant]);
  return null;
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
