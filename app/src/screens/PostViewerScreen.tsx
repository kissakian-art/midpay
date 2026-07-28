import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { type FeedItem } from "../api";
import CommentsSheet from "../components/CommentsSheet";
import FeedItemView from "../components/FeedItemView";
import { colors } from "../theme";

/**
 * Full-screen single-post viewer — opened by tapping a post in a profile grid.
 * Reuses FeedItemView so playback, the buy-gate, likes, and DM behave exactly
 * like the main feed. `active` is always true so the video autoplays.
 */
export default function PostViewerScreen({ route, navigation }: any) {
  const item = route.params.item as FeedItem;
  const { height } = useWindowDimensions();
  const [commentsFor, setCommentsFor] = useState<FeedItem | null>(null);

  return (
    <View style={s.root}>
      <FeedItemView
        item={item}
        active
        height={height}
        onOpenComments={setCommentsFor}
        onMessageCreator={(it) =>
          navigation.navigate("Conversation", {
            userId: it.creatorUserId,
            title: `@${it.creatorHandle}`,
          })
        }
        onOpenProfile={(it) => navigation.navigate("UserProfile", { userId: it.creatorUserId })}
      />

      <TouchableOpacity style={s.back} onPress={() => navigation.goBack()}>
        <Text style={s.backText}>‹</Text>
      </TouchableOpacity>

      <CommentsSheet item={commentsFor} onClose={() => setCommentsFor(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  back: {
    position: "absolute",
    top: 46,
    left: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: -4 },
});
