import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addComment,
  likeComment,
  listComments,
  unlikeComment,
  type CommentItem,
  type FeedItem,
} from "../api";
import { colors } from "../theme";
import Avatar from "./Avatar";

/**
 * Comments bottom-sheet (feed + single-post viewer): threaded replies, per-
 * comment reactions, and an input that clears the phone's navigation bar via the
 * safe-area inset.
 */
export default function CommentsSheet({
  item,
  onClose,
}: {
  item: FeedItem | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; handle: string } | null>(null);

  useEffect(() => {
    if (!item) return;
    setComments([]);
    setReplyTo(null);
    setText("");
    listComments(item.id).then((r) => setComments(r.comments)).catch(() => {});
  }, [item]);

  // Group flat comments into top-level threads + their replies.
  const threads = useMemo(() => {
    const tops = comments.filter((c) => !c.parentId);
    const byParent = new Map<string, CommentItem[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const arr = byParent.get(c.parentId) ?? [];
      arr.push(c);
      byParent.set(c.parentId, arr);
    }
    // Replies read oldest→newest under a parent.
    for (const arr of byParent.values()) arr.reverse();
    return tops.map((t) => ({ top: t, replies: byParent.get(t.id) ?? [] }));
  }, [comments]);

  const post = async () => {
    if (!item || !text.trim()) return;
    setPosting(true);
    try {
      await addComment(item.id, text.trim(), replyTo?.id);
      setText("");
      setReplyTo(null);
      const r = await listComments(item.id);
      setComments(r.comments);
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = (c: CommentItem) => {
    if (!item) return;
    const wasLiked = c.likedByMe;
    setComments((prev) =>
      prev.map((x) =>
        x.id === c.id
          ? { ...x, likedByMe: !wasLiked, likeCount: x.likeCount + (wasLiked ? -1 : 1) }
          : x,
      ),
    );
    (wasLiked ? unlikeComment(item.id, c.id) : likeComment(item.id, c.id)).catch(() => {
      setComments((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, likedByMe: wasLiked, likeCount: c.likeCount } : x)),
      );
    });
  };

  const Row = ({ c, isReply }: { c: CommentItem; isReply?: boolean }) => (
    <View style={[s.comment, isReply && s.reply]}>
      <Avatar
        handle={c.author.handle}
        displayName={c.author.displayName}
        userId={c.author.id}
        avatarKey={c.author.avatarR2Key}
        size={isReply ? 28 : 34}
      />
      <View style={s.commentBody}>
        <Text style={s.author}>@{c.author.handle}</Text>
        <Text style={s.body}>{c.body}</Text>
        <TouchableOpacity onPress={() => setReplyTo({ id: c.id, handle: c.author.handle })}>
          <Text style={s.replyBtn}>Reply</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={s.likeCol} onPress={() => toggleLike(c)} hitSlop={8}>
        <Text style={[s.heart, c.likedByMe && { color: colors.danger }]}>
          {c.likedByMe ? "♥" : "♡"}
        </Text>
        {c.likeCount > 0 ? <Text style={s.likeCount}>{c.likeCount}</Text> : null}
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible={!!item} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
          <Text style={s.title}>Comments</Text>
          <FlatList
            data={threads}
            keyExtractor={(t) => t.top.id}
            style={{ maxHeight: 360 }}
            ListEmptyComponent={<Text style={s.empty}>No comments yet — say something.</Text>}
            renderItem={({ item: t }) => (
              <View>
                <Row c={t.top} />
                {t.replies.map((r) => (
                  <Row key={r.id} c={r} isReply />
                ))}
              </View>
            )}
          />

          {replyTo ? (
            <View style={s.replyBanner}>
              <Text style={s.replyBannerText}>Replying to @{replyTo.handle}</Text>
              <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
                <Text style={s.replyBannerX}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={s.row}>
            <TextInput
              style={s.input}
              placeholder={replyTo ? `Reply to @${replyTo.handle}…` : "Add a comment…"}
              placeholderTextColor={colors.dim}
              value={text}
              onChangeText={setText}
              multiline
            />
            <TouchableOpacity onPress={post} disabled={posting || !text.trim()}>
              <Text style={[s.send, (!text.trim() || posting) && { opacity: 0.4 }]}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  title: { color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 10, textAlign: "center" },
  empty: { color: colors.dim, marginTop: 6, textAlign: "center" },
  comment: { flexDirection: "row", gap: 10, marginBottom: 14, alignItems: "flex-start" },
  reply: { marginLeft: 34, marginBottom: 10 },
  commentBody: { flex: 1 },
  author: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  body: { color: colors.text, marginTop: 2, lineHeight: 19 },
  replyBtn: { color: colors.dim, fontSize: 12, fontWeight: "700", marginTop: 4 },
  likeCol: { alignItems: "center", width: 30 },
  heart: { color: colors.dim, fontSize: 18 },
  likeCount: { color: colors.dim, fontSize: 11, fontWeight: "700" },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  replyBannerText: { color: colors.dim, fontSize: 12, fontWeight: "600" },
  replyBannerX: { color: colors.dim, fontSize: 14, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "flex-end", marginTop: 4, gap: 10 },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
  },
  send: { color: colors.accent, fontWeight: "800", paddingBottom: 10 },
});
