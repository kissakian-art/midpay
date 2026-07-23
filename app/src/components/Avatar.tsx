import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { colors } from "../theme";

/**
 * Initials avatar. Real image avatars need an upload flow (not built yet), so
 * we derive stable initials + a stable colour from the handle — better than a
 * grey blank, and it swaps to an <Image> the moment avatars land.
 */
const PALETTE = ["#E4572E", "#17BEBB", "#FFC914", "#2E86AB", "#A15CC4", "#3BB273", "#F26419"];

export function initialsFor(handleOrName?: string | null): string {
  if (!handleOrName) return "?";
  const raw = handleOrName.replace(/^@/, "");
  // Auto-generated handles (user_3f9a…) have no meaningful initials — a person
  // glyph reads better than random hex until they set a display name.
  if (/^user_[0-9a-f]+$/i.test(raw)) return "👤";
  const clean = raw.replace(/^user_/, "");
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function Avatar({
  handle,
  displayName,
  size = 48,
  style,
}: {
  handle?: string | null;
  displayName?: string | null;
  size?: number;
  style?: ViewStyle;
}) {
  const seed = handle ?? displayName ?? "?";
  return (
    <View
      style={[
        s.root,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colorFor(seed),
        },
        style,
      ]}
    >
      <Text style={[s.text, { fontSize: size * 0.38 }]}>
        {initialsFor(displayName || handle)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  text: { color: "#fff", fontWeight: "800" },
});
