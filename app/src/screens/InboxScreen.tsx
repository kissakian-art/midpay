import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { conversations, type ConversationSummary } from "../api";
import { colors } from "../theme";

export default function InboxScreen({ navigation }: { navigation: any }) {
  const [items, setItems] = useState<ConversationSummary[]>([]);

  useFocusEffect(
    useCallback(() => {
      conversations().then((r) => setItems(r.conversations)).catch(() => {});
    }, []),
  );

  return (
    <View style={s.root}>
      <Text style={s.h1}>Inbox</Text>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={
          <Text style={s.empty}>No messages yet. DM a creator from any video.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.row}
            onPress={() =>
              navigation.navigate("Conversation", {
                conversationId: item.id,
                userId: item.otherUserId,
                title: "Chat",
              })
            }
          >
            <View style={s.avatar}>
              <Text style={s.avatarText}>💬</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Conversation</Text>
              <Text style={s.rowSub}>{new Date(item.lastMessageAt).toLocaleString()}</Text>
            </View>
            {item.unreadCount > 0 ? (
              <View style={s.badge}>
                <Text style={s.badgeText}>{item.unreadCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 60, paddingHorizontal: 16 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "800", marginBottom: 16 },
  empty: { color: colors.dim, textAlign: "center", marginTop: 60 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 20 },
  rowTitle: { color: colors.text, fontWeight: "700" },
  rowSub: { color: colors.dim, fontSize: 12, marginTop: 2 },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { color: "#000", fontWeight: "800", fontSize: 12 },
});
