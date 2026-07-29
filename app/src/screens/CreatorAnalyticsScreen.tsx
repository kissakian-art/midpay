import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { getMyAnalytics, type CreatorAnalytics } from "../api";
import { colors, ugx } from "../theme";

type Range = "day" | "week" | "all";
const RANGES: { key: Range; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All time" },
];

function kindIcon(kind: string): string {
  return kind === "text" ? "✍️" : kind === "photo" ? "🖼" : "🎬";
}

/**
 * "Your earnings" — a creator's own dashboard: money earned over a window,
 * per-post performance, and live-session reach. Opened from the profile.
 */
export default function CreatorAnalyticsScreen() {
  const [range, setRange] = useState<Range>("week");
  const [data, setData] = useState<CreatorAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getMyAnalytics(range));
    } catch {
      // keep whatever we had
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? "";

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
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
    >
      <View style={s.rangeRow}>
        {RANGES.map((r) => (
          <TouchableOpacity
            key={r.key}
            style={[s.rangePill, range === r.key && s.rangePillActive]}
            onPress={() => setRange(r.key)}
          >
            <Text style={[s.rangeText, range === r.key && s.rangeTextActive]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !data ? (
        <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: 60 }} />
      ) : !data ? (
        <Text style={s.empty}>Couldn't load your analytics. Pull to retry.</Text>
      ) : (
        <>
          {/* Earnings hero */}
          <View style={s.hero}>
            <Text style={s.heroLabel}>Earned · {rangeLabel.toLowerCase()}</Text>
            <Text style={s.heroValue}>{ugx(data.earnings.rangeUgx)}</Text>
            <Text style={s.heroSub}>
              {data.earnings.salesCount} sale{data.earnings.salesCount === 1 ? "" : "s"}
            </Text>
          </View>

          <View style={s.walletRow}>
            <Wallet label="Available now" value={data.earnings.availableUgx} highlight />
            <Wallet label="On hold" value={data.earnings.heldUgx} />
            <Wallet label="Lifetime" value={data.earnings.lifetimeUgx} />
          </View>

          {/* Engagement totals */}
          <View style={s.totalsRow}>
            <Total label="Posts" value={data.totals.posts} />
            <Total label="Likes" value={data.totals.likes} />
            <Total label="Comments" value={data.totals.comments} />
          </View>

          {/* Live sessions */}
          {data.liveSessions.length > 0 ? (
            <>
              <Text style={s.section}>Live sessions · {rangeLabel.toLowerCase()}</Text>
              {data.liveSessions.map((l) => (
                <View key={l.id} style={s.rowCard}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    🔴 {l.title || "Live session"}
                  </Text>
                  <Text style={s.rowStat}>👥 {l.peakViewers} peak</Text>
                </View>
              ))}
            </>
          ) : null}

          {/* Per-post performance */}
          <Text style={s.section}>Your posts</Text>
          {data.perPost.length === 0 ? (
            <Text style={s.empty}>No posts yet.</Text>
          ) : (
            data.perPost.map((p) => (
              <View key={p.id} style={s.rowCard}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {kindIcon(p.kind)}  {p.title || "Untitled"}
                </Text>
                <View style={s.rowStatsWrap}>
                  <Text style={s.rowStat}>♥ {p.likes}</Text>
                  <Text style={s.rowStat}>💬 {p.comments}</Text>
                  {p.pricing === "paid" ? (
                    <Text style={s.rowStat}>
                      🛒 {p.sales} · {ugx(p.earningsUgx)}
                    </Text>
                  ) : (
                    <Text style={s.rowStatFree}>Free</Text>
                  )}
                </View>
              </View>
            ))
          )}

          <Text style={s.footnote}>
            Earnings are your share after the platform fee. Per-post sales and earnings reflect the
            selected window.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function Wallet({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={s.walletCard}>
      <Text style={[s.walletValue, highlight && s.walletValueHi]}>{ugx(value)}</Text>
      <Text style={s.walletLabel}>{label}</Text>
    </View>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.total}>
      <Text style={s.totalValue}>{value}</Text>
      <Text style={s.totalLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  rangeRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  rangePill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  rangePillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  rangeText: { color: colors.dim, fontWeight: "700", fontSize: 13 },
  rangeTextActive: { color: "#000" },
  hero: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroLabel: { color: colors.dim, fontSize: 13, fontWeight: "700" },
  heroValue: { color: colors.text, fontSize: 34, fontWeight: "900", marginTop: 6 },
  heroSub: { color: colors.dim, fontSize: 13, marginTop: 4 },
  walletRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  walletCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  walletValue: { color: colors.text, fontSize: 14, fontWeight: "800" },
  walletValueHi: { color: colors.accent },
  walletLabel: { color: colors.dim, fontSize: 11, marginTop: 4, textAlign: "center" },
  totalsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  total: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  totalValue: { color: colors.text, fontSize: 20, fontWeight: "900" },
  totalLabel: { color: colors.dim, fontSize: 12, marginTop: 2 },
  section: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 26, marginBottom: 10 },
  rowCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowTitle: { color: colors.text, fontWeight: "700", fontSize: 14 },
  rowStatsWrap: { flexDirection: "row", gap: 16, marginTop: 8, flexWrap: "wrap" },
  rowStat: { color: colors.dim, fontSize: 13, fontWeight: "600" },
  rowStatFree: { color: colors.dim, fontSize: 13, fontWeight: "700" },
  empty: { color: colors.dim, textAlign: "center", marginTop: 20 },
  footnote: { color: colors.dim, fontSize: 11, marginTop: 20, lineHeight: 16 },
});
