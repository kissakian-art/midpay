import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";

/**
 * Renders a text post's background: a linear gradient for 2+ colour stops, or a
 * solid fill for one. Shared by the composer (WYSIWYG) and the feed.
 */
export default function TextBackground({
  bg,
  style,
  children,
}: {
  bg: string[];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  if (!bg || bg.length < 2) {
    return <View style={[{ backgroundColor: bg?.[0] ?? "#111111" }, style]}>{children}</View>;
  }
  return (
    <LinearGradient
      colors={bg as [string, string, ...string[]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
