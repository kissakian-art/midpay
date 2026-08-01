import React, { useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type ViewToken,
} from "react-native";
import { type FeedItem } from "../api";
import CommentsSheet from "../components/CommentsSheet";
import FeedItemView from "../components/FeedItemView";
import { colors } from "../theme";

// Hold a decoder for the active cell + the next one (mirrors FeedScreen).
const PRELOAD_AHEAD = 1;
const PRELOAD_BEHIND = 0;

/**
 * Full-screen post viewer — opened by tapping a post in a profile grid (or a
 * search result). It's a vertical paging feed just like the home feed, so a
 * swipe moves to the next post *of that set* instead of dead-ending on one.
 *
 * Params: `{ items, index }` (a list + the tapped position) — or a single
 * `{ item }` for callers that only have one (wrapped into a one-item feed).
 */
export default function PostViewerScreen({ route, navigation }: any) {
  const { height } = useWindowDimensions();
  const params = route.params ?? {};
  const items: FeedItem[] = params.items ?? (params.item ? [params.item] : []);
  const initialIndex: number =
    typeof params.index === "number" && params.index >= 0 && params.index < items.length
      ? params.index
      : 0;

  const [listHeight, setListHeight] = useState(height);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [commentsFor, setCommentsFor] = useState<FeedItem | null>(null);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActiveIndex(first.index);
  });

  return (
    <View style={s.root} onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={({ item, index }) => (
          <FeedItemView
            item={item}
            active={index === activeIndex}
            preload={index >= activeIndex - PRELOAD_BEHIND && index <= activeIndex + PRELOAD_AHEAD}
            height={listHeight}
            onOpenComments={setCommentsFor}
            onMessageCreator={(it) =>
              navigation.navigate("Conversation", {
                userId: it.creatorUserId,
                title: `@${it.creatorHandle}`,
              })
            }
            onOpenProfile={(it) => navigation.navigate("UserProfile", { userId: it.creatorUserId })}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={listHeight}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: listHeight, offset: listHeight * index, index })}
        initialScrollIndex={initialIndex}
        onViewableItemsChanged={onViewable.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        // Same decoder-safe windowing as the feed (removeClippedSubviews OFF —
        // it detaches SurfaceView-backed video cells and crashes on Android).
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        removeClippedSubviews={false}
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
