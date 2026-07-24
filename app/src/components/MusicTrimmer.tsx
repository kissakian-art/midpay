import { useAudioPlayer } from "expo-audio";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { musicAudioUrl } from "../api";
import { colors } from "../theme";

const DEFAULT_SEG = 15; // default segment length (s) when none is set yet
const MIN_SEG = 1; // minimum segment length (s)

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

interface Props {
  trackId: string;
  startMs: number;
  endMs: number | null;
  onChange: (startMs: number, endMs: number) => void;
}

/**
 * Pick which slice of a song plays on a photo/text post — the segment length is
 * the post's play duration (e.g. drag from 0:45 → 0:55 for a 10s post). Drag the
 * two handles; ▶ previews the selected slice on loop.
 */
export default function MusicTrimmer({ trackId, startMs, endMs, onChange }: Props) {
  const { width } = useWindowDimensions();
  const trackW = width - 40;

  const player = useAudioPlayer({ uri: musicAudioUrl(trackId) });
  const [total, setTotal] = useState(0);
  const [seg, setSeg] = useState({
    start: (startMs || 0) / 1000,
    end: endMs != null ? endMs / 1000 : 0,
  });
  const [previewing, setPreviewing] = useState(false);
  const inited = useRef(false);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const commit = useCallback((start: number, end: number) => {
    setSeg({ start, end });
    onChangeRef.current(Math.round(start * 1000), Math.round(end * 1000));
  }, []);

  const latest = useRef({ total, trackW, seg });
  latest.current = { total, trackW, seg };
  const dragBase = useRef(0);

  // Wait for the track's duration, then seed a sensible default segment.
  useEffect(() => {
    const id = setInterval(() => {
      let d = 0;
      try {
        d = player.duration || 0;
      } catch {
        d = 0;
      }
      if (d > 0) {
        clearInterval(id);
        setTotal(d);
        if (!inited.current) {
          inited.current = true;
          const start = Math.min(latest.current.seg.start, Math.max(0, d - MIN_SEG));
          const end =
            latest.current.seg.end > start
              ? Math.min(latest.current.seg.end, d)
              : Math.min(start + DEFAULT_SEG, d);
          commit(start, end);
        }
      }
    }, 200);
    return () => clearInterval(id);
  }, [player, commit]);

  // Preview: loop just the selected slice.
  useEffect(() => {
    if (!previewing || total <= 0) return;
    try {
      player.loop = true;
      player.seekTo(latest.current.seg.start).catch(() => {});
      player.play();
    } catch {
      // not ready
    }
    const id = setInterval(() => {
      try {
        const { seg } = latest.current;
        if ((player.currentTime || 0) >= seg.end) player.seekTo(seg.start).catch(() => {});
      } catch {
        // ignore
      }
    }, 120);
    return () => {
      clearInterval(id);
      try {
        player.pause();
      } catch {
        // ignore
      }
    };
  }, [previewing, total, player]);

  const makeHandle = (which: "start" | "end") =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragBase.current = which === "start" ? latest.current.seg.start : latest.current.seg.end;
      },
      onPanResponderMove: (_e, g) => {
        const { total: tot, trackW: tw, seg: sg } = latest.current;
        if (tot <= 0) return;
        const delta = (g.dx / tw) * tot;
        if (which === "start") {
          const start = Math.min(Math.max(0, dragBase.current + delta), sg.end - MIN_SEG);
          commit(start, sg.end);
        } else {
          const end = Math.max(Math.min(tot, dragBase.current + delta), sg.start + MIN_SEG);
          commit(sg.start, end);
        }
      },
    });
  const startPan = useRef(makeHandle("start")).current;
  const endPan = useRef(makeHandle("end")).current;

  const sFrac = total ? seg.start / total : 0;
  const eFrac = total ? seg.end / total : 0;

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <TouchableOpacity style={s.previewBtn} onPress={() => setPreviewing((p) => !p)}>
          <Text style={s.previewText}>{previewing ? "⏸" : "▶"}</Text>
        </TouchableOpacity>
        <Text style={s.times}>
          {total > 0
            ? `${mmss(seg.start)} – ${mmss(seg.end)} · ${Math.max(0, Math.round(seg.end - seg.start))}s`
            : "Loading sound…"}
        </Text>
      </View>

      <View style={[s.timeline, { width: trackW }]}>
        <View style={[s.window, { left: sFrac * trackW, width: Math.max(0, (eFrac - sFrac) * trackW) }]} />
        <View style={[s.handle, { left: sFrac * trackW - 9 }]} {...startPan.panHandlers} />
        <View style={[s.handle, { left: eFrac * trackW - 9 }]} {...endPan.panHandlers} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  previewBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewText: { color: colors.accent, fontSize: 15, fontWeight: "800" },
  times: { color: colors.text, fontWeight: "700", fontVariant: ["tabular-nums"] },
  timeline: {
    height: 34,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
  },
  window: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,193,7,0.25)",
    borderColor: colors.accent,
    borderLeftWidth: 2,
    borderRightWidth: 2,
  },
  handle: {
    position: "absolute",
    top: 3,
    width: 18,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
});
