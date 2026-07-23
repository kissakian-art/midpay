import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type ViewToken,
} from "react-native";
import { addComment, feed, listComments, type CommentItem, type FeedItem } from "../api";
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
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);

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

  const openComments = async (item: FeedItem) => {
    setCommentsFor(item);
    setComments([]);
    const r = await listComments(item.id);
    setComments(r.comments);
  };

  const postComment = async () => {
    if (!commentsFor || !commentText.trim()) return;
    setPosting(true);
    try {
      await addComment(commentsFor.id, commentText.trim());
      setCommentText("");
      const r = await listComments(commentsFor.id);
      setComments(r.comments);
    } finally {
      setPosting(false);
    }
  };

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
            onOpenComments={openComments}
            onMessageCreator={(it) =>
              navigation.navigate("Conversation", {
                userId: it.creatorUserId,
                title: `@${it.creatorHandle}`,
              })
            }
            onOpenProfile={(it) =>
              navigation.navigate("UserProfile", { userId: it.creatorUserId })
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

      {/* Comments sheet */}
      <Modal visible={!!commentsFor} animationType="slide" transparent onRequestClose={() => setCommentsFor(null)}>
        <KeyboardAvoidingView
          style={s.sheetWrap}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setCommentsFor(null)} />
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Comments</Text>
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              style={{ maxHeight: 320 }}
              ListEmptyComponent={<Text style={s.emptyText}>No comments yet — say something.</Text>}
              renderItem={({ item: c }) => (
                <View style={s.comment}>
                  <Text style={s.commentAuthor}>@{c.author.handle}</Text>
                  <Text style={s.commentBody}>{c.body}</Text>
                </View>
              )}
            />
            <View style={s.commentRow}>
              <TextInput
                style={s.commentInput}
                placeholder="Add a comment…"
                placeholderTextColor={colors.dim}
                value={commentText}
                onChangeText={setCommentText}
              />
              <TouchableOpacity onPress={postComment} disabled={posting || !commentText.trim()}>
                <Text style={[s.send, (!commentText.trim() || posting) && { opacity: 0.4 }]}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  emptyText: { color: colors.dim, marginTop: 6, textAlign: "center" },
  reloadBtn: { marginTop: 16, backgroundColor: colors.card, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 24 },
  reloadText: { color: colors.accent, fontWeight: "700" },
  sheetWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    paddingBottom: 30,
  },
  sheetTitle: { color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 10, textAlign: "center" },
  comment: { marginBottom: 12 },
  commentAuthor: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  commentBody: { color: colors.text, marginTop: 2 },
  commentRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 },
  commentInput: {
    flex: 1,
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  send: { color: colors.accent, fontWeight: "800" },
});
