import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { ImageBackground, StyleProp, View, ViewStyle } from "react-native";
import { backgroundImageUrl } from "../api";

/**
 * Renders a text post's background: an admin-catalog image (if `bgImage`), else a
 * linear gradient for 2+ colour stops, or a solid fill for one. Shared by the
 * composer (WYSIWYG) and the feed.
 */
export default function TextBackground({
  bg,
  bgImage,
  style,
  children,
}: {
  bg: string[];
  bgImage?: string | null;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  if (bgImage) {
    return (
      <ImageBackground source={{ uri: backgroundImageUrl(bgImage) }} style={style} resizeMode="cover">
        {children}
      </ImageBackground>
    );
  }
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
