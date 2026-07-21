import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { markRead, messagesIn, sendMessage, type Message } from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";

interface Params {
  conversationId?: string;
  userId: string; // the other participant
  title?: string;
}

export default function ConversationScreen({ route }: any) {
  const params = route.params as Params;
  const { user } = useAuth();
  const [conversationId, setConversationId] = useState(params.conversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!conversationId) return;
    const r = await messagesIn(conversationId);
    setMessages(r.messages);
    markRead(conversationId).catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await sendMessage(params.userId, body);
      setText("");
      if (!conversationId) setConversationId(r.message.conversationId);
      else await load();
      setMessages((m) => (conversationId ? m : [...m, r.message]));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderItem={({ item }) => {
          const mine = item.senderId === user?.id;
          return (
            <View style={[s.bubble, mine ? s.mine : s.theirs]}>
              <Text style={[s.bubbleText, mine && { color: "#000" }]}>{item.body}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={s.empty}>Say hello 👋</Text>}
      />
      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          placeholder="Message…"
          placeholderTextColor={colors.dim}
          value={text}
          onChangeText={setText}
          multiline
        />
        <TouchableOpacity onPress={send} disabled={sending || !text.trim()}>
          <Text style={[s.send, (sending || !text.trim()) && { opacity: 0.4 }]}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bubble: { maxWidth: "78%", borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.accent },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.card },
  bubbleText: { color: colors.text, fontSize: 15 },
  empty: { color: colors.dim, textAlign: "center", marginTop: 40 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 110,
  },
  send: { color: colors.accent, fontWeight: "800", paddingBottom: 12 },
});
