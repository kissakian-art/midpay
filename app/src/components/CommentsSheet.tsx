import React, { useEffect, useState } from "react";
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
import { addComment, listComments, type CommentItem, type FeedItem } from "../api";
import { colors } from "../theme";

/**
 * Comments bottom-sheet, shared by the feed and the single-post viewer. Owns
 * its own load/post state so callers just pass the item (or null to hide).
 */
export default function CommentsSheet({
  item,
  onClose,
}: {
  item: FeedItem | null;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!item) return;
    setComments([]);
    listComments(item.id).then((r) => setComments(r.comments)).catch(() => {});
  }, [item]);

  const post = async () => {
    if (!item || !text.trim()) return;
    setPosting(true);
    try {
      await addComment(item.id, text.trim());
      setText("");
      const r = await listComments(item.id);
      setComments(r.comments);
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible={!!item} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.wrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
        <View style={s.sheet}>
          <Text style={s.title}>Comments</Text>
          <FlatList
            data={comments}
            keyExtractor={(c) => c.id}
            style={{ maxHeight: 320 }}
            ListEmptyComponent={<Text style={s.empty}>No comments yet — say something.</Text>}
            renderItem={({ item: c }) => (
              <View style={s.comment}>
                <Text style={s.author}>@{c.author.handle}</Text>
                <Text style={s.body}>{c.body}</Text>
              </View>
            )}
          />
          <View style={s.row}>
            <TextInput
              style={s.input}
              placeholder="Add a comment…"
              placeholderTextColor={colors.dim}
              value={text}
              onChangeText={setText}
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
    padding: 18,
    paddingBottom: 30,
  },
  title: { color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 10, textAlign: "center" },
  empty: { color: colors.dim, marginTop: 6, textAlign: "center" },
  comment: { marginBottom: 12 },
  author: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  body: { color: colors.text, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  send: { color: colors.accent, fontWeight: "800" },
});
