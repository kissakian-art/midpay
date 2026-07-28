import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type ViewToken,
} from "react-native";
import { feed, type FeedItem } from "../api";
import CommentsSheet from "../components/CommentsSheet";
import FeedItemView from "../components/FeedItemView";
import { colors } from "../theme";

export default function FeedScreen({ navigation }: { navigation: any }) {
  const { height } = useWindowDimensions();
  // The feed lives inside the tab navigator; the list height is the window
  // minus the tab bar, which RN gives us via the FlatList container instead —
  // use full-cell paging by measuring the list itself.
  const [listHeight, setListHeight] = useState(height);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const [commentsFor, setCommentsFor] = useState<FeedItem | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await feed();
      setItems(r.feed);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActiveIndex(first.index);
  });

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={s.center}>
        <Text style={s.emptyTitle}>Nothing here yet</Text>
        <Text style={s.emptyText}>Be the first — upload a video from the + tab.</Text>
        <TouchableOpacity style={s.reloadBtn} onPress={() => { setLoading(true); load(); }}>
          <Text style={s.reloadText}>Reload</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={({ item, index }) => (
          <FeedItemView
            item={item}
            active={index === activeIndex}
            height={listHeight}
            onOpenComments={setCommentsFor}
            onMessageCreator={(it) =>
              navigation.navigate("Conversation", {
                userId: it.creatorUserId,
                title: `@${it.creatorHandle}`,
              })
            }
            onOpenProfile={(it) =>
              navigation.navigate("UserProfile", { userId: it.creatorUserId })
            }
            onUseSound={(it) =>
              navigation.navigate("UploadTab", {
                reuseSound: {
                  id: it.musicTrackId,
                  title: it.musicTitle ?? "Original sound",
                  artist: it.musicArtist ?? null,
                  source: it.musicSource ?? "catalog",
                  durationSeconds: it.musicDurationSeconds ?? null,
                },
              })
            }
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={listHeight}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: listHeight, offset: listHeight * index, index })}
        onViewableItemsChanged={onViewable.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        // Keep only a few full-screen cells mounted — each holds a video (and
        // maybe audio) codec, so an unbounded window OOMs the app.
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.accent}
          />
        }
      />

      {/* Search shortcut (top-right, TikTok-style). */}
      <TouchableOpacity style={s.searchBtn} onPress={() => navigation.navigate("Search")} hitSlop={10}>
        <Text style={s.searchIcon}>🔍</Text>
      </TouchableOpacity>

      <CommentsSheet item={commentsFor} onClose={() => setCommentsFor(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  emptyText: { color: colors.dim, marginTop: 6, textAlign: "center" },
  reloadBtn: { marginTop: 16, backgroundColor: colors.card, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 24 },
  reloadText: { color: colors.accent, fontWeight: "700" },
  searchBtn: {
    position: "absolute",
    top: 52,
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchIcon: { fontSize: 20 },
});
