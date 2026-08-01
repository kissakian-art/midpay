import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  getCard,
  search,
  thumbnailUrl,
  type FeedItem,
  type SearchResults,
} from "../api";
import Avatar from "../components/Avatar";
import { colors } from "../theme";

const KIND_ICON: Record<FeedItem["kind"], string> = { video: "🎬", photo: "🖼", text: "📝" };

export default function SearchScreen({ navigation }: { navigation: any }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      search(term)
        .then(setResults)
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const openPost = (index: number) =>
    navigation.navigate("PostViewer", { items: results?.posts ?? [], index });
  const openComment = async (contentId: string) => {
    try {
      const { item } = await getCard(contentId);
      navigation.navigate("PostViewer", { item });
    } catch {
      // post gone
    }
  };

  const empty =
    results &&
    !results.creators.length &&
    !results.posts.length &&
    !results.sounds.length &&
    !results.comments.length;

  return (
    <View style={s.root}>
      <View style={s.searchBar}>
        <Text style={s.searchIcon}>🔍</Text>
        <TextInput
          style={s.input}
          placeholder="Search creators, sounds, posts, comments"
          placeholderTextColor={colors.dim}
          value={q}
          onChangeText={setQ}
          autoFocus
          autoCapitalize="none"
          returnKeyType="search"
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ("")} hitSlop={8}>
            <Text style={s.clear}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} /> : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        {q.trim().length < 2 ? (
          <Text style={s.hint}>Type at least 2 characters to search.</Text>
        ) : empty ? (
          <Text style={s.hint}>No results for “{q.trim()}”.</Text>
        ) : results ? (
          <>
            {results.creators.length > 0 && (
              <Section title="Creators">
                {results.creators.map((cr) => (
                  <TouchableOpacity
                    key={cr.id}
                    style={s.row}
                    onPress={() => navigation.navigate("UserProfile", { userId: cr.id })}
                  >
                    <Avatar
                      handle={cr.handle}
                      displayName={cr.displayName}
                      userId={cr.id}
                      avatarKey={cr.avatarR2Key}
                      size={40}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle}>{cr.displayName ?? `@${cr.handle}`}</Text>
                      <Text style={s.rowSub}>@{cr.handle}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </Section>
            )}

            {results.sounds.length > 0 && (
              <Section title="Sounds">
                {results.sounds.map((so) => (
                  <View key={so.id} style={s.row}>
                    <Text style={s.emojiIcon}>🎵</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {so.title}
                      </Text>
                      {so.artist ? <Text style={s.rowSub}>{so.artist}</Text> : null}
                    </View>
                  </View>
                ))}
              </Section>
            )}

            {results.posts.length > 0 && (
              <Section title="Posts">
                {results.posts.map((p, i) => (
                  <TouchableOpacity key={p.id} style={s.row} onPress={() => openPost(i)}>
                    {p.thumbnailR2Key ? (
                      <Image source={{ uri: thumbnailUrl(p.id, p.thumbnailR2Key) }} style={s.thumb} />
                    ) : (
                      <View style={[s.thumb, s.thumbFallback]}>
                        <Text style={s.emojiIcon}>{KIND_ICON[p.kind]}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle} numberOfLines={2}>
                        {p.title || p.description || "Untitled post"}
                      </Text>
                      <Text style={s.rowSub}>@{p.creatorHandle}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </Section>
            )}

            {results.comments.length > 0 && (
              <Section title="Comments">
                {results.comments.map((cm) => (
                  <TouchableOpacity key={cm.id} style={s.row} onPress={() => openComment(cm.contentId)}>
                    <Text style={s.emojiIcon}>💬</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle} numberOfLines={2}>
                        {cm.body}
                      </Text>
                      <Text style={s.rowSub}>@{cm.authorHandle}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </Section>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 14 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  searchIcon: { fontSize: 15 },
  input: { flex: 1, color: colors.text, fontSize: 15 },
  clear: { color: colors.dim, fontSize: 15, fontWeight: "800" },
  hint: { color: colors.dim, textAlign: "center", marginTop: 30 },
  section: { marginTop: 18 },
  sectionTitle: { color: colors.dim, fontWeight: "800", fontSize: 12, textTransform: "uppercase", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  rowTitle: { color: colors.text, fontWeight: "700", fontSize: 15 },
  rowSub: { color: colors.dim, fontSize: 12, marginTop: 1 },
  emojiIcon: { fontSize: 22, width: 40, textAlign: "center" },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.card },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
});
