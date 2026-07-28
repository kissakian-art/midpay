import { useVideoPlayer, VideoView } from "expo-video";
import React, { useRef, useState } from "react";
import {
  Image,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { type TextOverlay } from "../api";
import { colors } from "../theme";

const SIZES: { label: string; value: number }[] = [
  { label: "S", value: 0.045 },
  { label: "M", value: 0.065 },
  { label: "L", value: 0.09 },
];
const COLORS = ["#ffffff", "#000000", colors.accent, "#ff3b30", "#34c759", "#0a84ff"];

/** Rough perceptual lightness of a #rgb/#rrggbb colour, for pill contrast. */
function isLight(hex: string): boolean {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}
/** A contrasting semi-transparent pill for the chosen text colour (8-digit hex). */
const pillFor = (textColor: string): string => (isLight(textColor) ? "#000000B3" : "#ffffffE6");

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface Props {
  uri: string;
  kind: "photo" | "video";
  overlays: TextOverlay[];
  onChange: (o: TextOverlay[]) => void;
}

/**
 * WYSIWYG text-overlay editor over a preview of the captured media, using the
 * same fit the feed uses so positions map 1:1: both photos and videos are
 * CONTAIN (shown whole, letterboxed — no crop/zoom, 16:9 stays 16:9). Overlays
 * are stored as normalized canvas coords; drag moves them, and a bottom bar
 * edits the selected one.
 */
export default function OverlayEditor({ uri, kind, overlays, onChange }: Props) {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) =>
    setDims({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const update = (i: number, patch: Partial<TextOverlay>) =>
    onChange(overlays.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  const addText = () => {
    const next: TextOverlay = { text: "Text", x: 0.22, y: 0.42, size: 0.065, color: "#ffffff", bg: null };
    onChange([...overlays, next]);
    setSelected(overlays.length);
  };

  const remove = (i: number) => {
    onChange(overlays.filter((_, idx) => idx !== i));
    setSelected(null);
  };

  const sel = selected != null ? overlays[selected] : null;

  return (
    <View style={s.root}>
      <Pressable style={s.canvas} onLayout={onLayout} onPress={() => setSelected(null)}>
        {kind === "photo" ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <VideoPreview uri={uri} />
        )}

        {dims.w > 0 &&
          overlays.map((o, i) => (
            <DraggableOverlay
              key={i}
              overlay={o}
              index={i}
              width={dims.w}
              height={dims.h}
              selected={selected === i}
              onSelect={setSelected}
              onMove={(idx, x, y) => update(idx, { x, y })}
            />
          ))}

        {overlays.length === 0 ? (
          <View pointerEvents="none" style={s.hintWrap}>
            <Text style={s.hint}>Add text, then drag it anywhere</Text>
          </View>
        ) : null}
      </Pressable>

      {sel ? (
        <OverlayControls
          overlay={sel}
          onChange={(patch) => update(selected as number, patch)}
          onDelete={() => remove(selected as number)}
          onDone={() => setSelected(null)}
        />
      ) : (
        <TouchableOpacity style={s.addBtn} onPress={addText} activeOpacity={0.85}>
          <Text style={s.addBtnText}>Aa   Add text</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

/** A draggable, selectable overlay box. Uses a latest-ref so the one-time
 *  PanResponder never reads stale props during a drag. */
function DraggableOverlay({
  overlay,
  index,
  width,
  height,
  selected,
  onSelect,
  onMove,
}: {
  overlay: TextOverlay;
  index: number;
  width: number;
  height: number;
  selected: boolean;
  onSelect: (i: number) => void;
  onMove: (i: number, x: number, y: number) => void;
}) {
  const latest = useRef({ overlay, width, height, onSelect, onMove, index });
  latest.current = { overlay, width, height, onSelect, onMove, index };
  const start = useRef({ x: 0, y: 0 });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        const l = latest.current;
        start.current = { x: l.overlay.x, y: l.overlay.y };
        l.onSelect(l.index);
      },
      onPanResponderMove: (_e, g) => {
        const l = latest.current;
        onMoveClamped(l, start.current, g.dx, g.dy);
      },
    }),
  ).current;

  const fontSize = Math.max(11, overlay.size * width);
  const hasBg = !!overlay.bg;
  return (
    <View
      {...pan.panHandlers}
      style={[
        s.box,
        {
          left: overlay.x * width,
          top: overlay.y * height,
          maxWidth: width * 0.9,
          backgroundColor: hasBg ? (overlay.bg as string) : "transparent",
          paddingHorizontal: hasBg ? fontSize * 0.4 : 2,
          paddingVertical: hasBg ? fontSize * 0.22 : 2,
          borderRadius: hasBg ? fontSize * 0.4 : 6,
        },
        selected && s.boxSelected,
      ]}
    >
      <Text
        style={[
          s.boxText,
          { color: overlay.color, fontSize, lineHeight: fontSize * 1.2 },
          hasBg ? null : s.textShadow,
        ]}
      >
        {overlay.text}
      </Text>
    </View>
  );
}

type LatestRef = {
  overlay: TextOverlay;
  width: number;
  height: number;
  onMove: (i: number, x: number, y: number) => void;
  index: number;
};
function onMoveClamped(l: LatestRef, start: { x: number; y: number }, dx: number, dy: number) {
  const x = clamp(start.x + dx / l.width, 0, 0.92);
  const y = clamp(start.y + dy / l.height, 0, 0.94);
  l.onMove(l.index, x, y);
}

function OverlayControls({
  overlay,
  onChange,
  onDelete,
  onDone,
}: {
  overlay: TextOverlay;
  onChange: (patch: Partial<TextOverlay>) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const toggleShape = () => onChange({ bg: overlay.bg ? null : pillFor(overlay.color) });
  return (
    <View style={s.controls}>
      <TextInput
        style={s.input}
        value={overlay.text}
        onChangeText={(t) => onChange({ text: t.slice(0, 200) })}
        placeholder="Type your text"
        placeholderTextColor={colors.dim}
        autoFocus
        multiline
        maxLength={200}
      />

      <View style={s.row}>
        {COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[s.swatch, { backgroundColor: c }, overlay.color === c && s.swatchActive]}
            onPress={() => onChange({ color: c })}
          />
        ))}
      </View>

      <View style={s.row}>
        <TouchableOpacity
          style={[s.pillBtn, overlay.bg ? s.pillBtnOn : null]}
          onPress={toggleShape}
        >
          <Text style={[s.pillBtnText, overlay.bg ? s.pillBtnTextOn : null]}>Shape</Text>
        </TouchableOpacity>

        <View style={s.sizeGroup}>
          {SIZES.map((sz) => (
            <TouchableOpacity
              key={sz.label}
              style={[s.sizeBtn, Math.abs(overlay.size - sz.value) < 0.001 && s.sizeBtnActive]}
              onPress={() => onChange({ size: sz.value })}
            >
              <Text style={s.sizeText}>{sz.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={s.iconBtn} onPress={onDelete}>
          <Text style={s.iconBtnText}>🗑</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.iconBtn, s.doneBtn]} onPress={onDone}>
          <Text style={s.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  canvas: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  box: { position: "absolute" },
  boxSelected: { borderWidth: 1, borderColor: colors.accent, borderStyle: "dashed" },
  boxText: { fontWeight: "800" },
  textShadow: {
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  hintWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600" },
  addBtn: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,10,10,0.92)",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  input: {
    color: "#fff",
    fontSize: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 90,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)" },
  swatchActive: { borderColor: colors.accent, borderWidth: 3 },
  pillBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  pillBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  pillBtnTextOn: { color: "#000" },
  sizeGroup: { flexDirection: "row", gap: 6 },
  sizeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  sizeBtnActive: { backgroundColor: "rgba(255,255,255,0.16)", borderColor: colors.accent },
  sizeText: { color: colors.text, fontWeight: "800", fontSize: 13 },
  iconBtn: {
    marginLeft: "auto",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  iconBtnText: { fontSize: 16 },
  doneBtn: { marginLeft: 8, backgroundColor: colors.accent },
  doneText: { color: "#000", fontWeight: "800", fontSize: 13 },
});
