import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { activeLives, type LiveEventWithCreator } from "../api";
import Avatar from "../components/Avatar";
import { colors, ugx } from "../theme";

const POLL_MS = 10000;

/**
 * LiveDiscoveryScreen — the "who's live now" list. Polls GET /live/active so the
 * list stays fresh while it's open, and taps through to the viewer (which gates
 * on the ticket). Entry point: the LIVE pill on the feed.
 */
export default function LiveDiscoveryScreen({ navigation }: { navigation: any }) {
  const [lives, setLives] = useState<LiveEventWithCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await activeLives();
      setLives(r.lives);
    } catch {
      // keep the last list; the poll will retry
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={lives.length === 0 ? s.emptyWrap : s.listContent}
      data={lives}
      keyExtractor={(l) => l.id}
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
      ListEmptyComponent={
        <View style={s.center}>
          <Text style={s.emptyEmoji}>📡</Text>
          <Text style={s.emptyTitle}>No one is live right now</Text>
          <Text style={s.emptyText}>Check back soon — or start your own from your profile.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={s.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("LiveViewer", { liveId: item.id })}
        >
          <Avatar
            handle={item.creatorHandle}
            displayName={item.creatorDisplayName}
            userId={item.creatorUserId}
            avatarKey={item.creatorAvatarR2Key}
            size={52}
          />
          <View style={s.cardBody}>
            <Text style={s.cardTitle} numberOfLines={1}>
              {item.title || `@${item.creatorHandle} is live`}
            </Text>
            <Text style={s.cardHandle} numberOfLines={1}>
              @{item.creatorHandle}
            </Text>
          </View>
          <View style={s.cardRight}>
            <View style={s.liveBadge}>
              <View style={s.liveDot} />
              <Text style={s.liveBadgeText}>LIVE</Text>
            </View>
            <Text style={s.cardPrice}>{ugx(item.ticketPriceUgx)}</Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  listContent: { padding: 14 },
  emptyWrap: { flexGrow: 1 },
  emptyEmoji: { fontSize: 46, marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  emptyText: { color: colors.dim, marginTop: 8, textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  cardBody: { flex: 1, marginLeft: 12 },
  cardTitle: { color: colors.text, fontWeight: "800", fontSize: 15 },
  cardHandle: { color: colors.dim, marginTop: 3, fontSize: 13 },
  cardRight: { alignItems: "flex-end", gap: 6 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.danger,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveBadgeText: { color: "#fff", fontWeight: "900", fontSize: 10, letterSpacing: 0.5 },
  cardPrice: { color: colors.accent, fontWeight: "800", fontSize: 13 },
});
