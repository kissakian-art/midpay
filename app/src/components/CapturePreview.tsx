import { useVideoPlayer, VideoView } from "expo-video";
import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { colors } from "../theme";

/**
 * Shows the media you just captured/picked, for real — the video actually
 * plays (looping, muted-ish preview) instead of a placeholder icon, so you can
 * check the take before posting.
 */
export default function CapturePreview({
  uri,
  kind,
}: {
  uri: string;
  kind: "photo" | "video";
}) {
  if (kind === "photo") {
    return <Image source={{ uri }} style={s.media} resizeMode="contain" />;
  }
  return <VideoPreview uri={uri} />;
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <View style={s.media}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
      />
    </View>
  );
}

const s = StyleSheet.create({
  media: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "#000",
    overflow: "hidden",
  },
});
