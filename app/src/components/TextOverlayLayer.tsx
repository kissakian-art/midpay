import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { type TextOverlay } from "../api";

/**
 * Read-only renderer for creator text overlays, drawn over the media in the
 * player. Positions are normalized (0..1) to the given media rectangle so a post
 * looks the same in the editor, the feed, and the profile viewer. Purely
 * presentational + `pointerEvents="none"` so it never blocks taps on the media.
 */
export default function TextOverlayLayer({
  overlays,
  width,
  height,
}: {
  overlays?: TextOverlay[] | null;
  width: number;
  height: number;
}) {
  if (!overlays?.length || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {overlays.map((o, i) => (
        <OverlayText key={i} overlay={o} width={width} height={height} />
      ))}
    </View>
  );
}

/** One overlay box. Exported so the editor can render an identical visual. */
export function OverlayText({
  overlay: o,
  width,
  height,
}: {
  overlay: TextOverlay;
  width: number;
  height: number;
}) {
  const fontSize = Math.max(11, o.size * width);
  const hasBg = !!o.bg;
  return (
    <View
      style={[
        s.box,
        {
          left: o.x * width,
          top: o.y * height,
          maxWidth: width * 0.9,
          backgroundColor: hasBg ? (o.bg as string) : "transparent",
          paddingHorizontal: hasBg ? fontSize * 0.4 : 0,
          paddingVertical: hasBg ? fontSize * 0.22 : 0,
          borderRadius: hasBg ? fontSize * 0.4 : 0,
        },
      ]}
    >
      <Text
        style={[
          s.text,
          {
            color: o.color,
            fontSize,
            lineHeight: fontSize * 1.2,
          },
          // No shape → lean on a shadow so light text stays legible on any media.
          hasBg ? null : s.shadow,
        ]}
      >
        {o.text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { position: "absolute" },
  text: { fontWeight: "800" },
  shadow: {
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
