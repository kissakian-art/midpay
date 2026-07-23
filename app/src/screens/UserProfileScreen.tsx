import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ApiError,
  applyCreator,
  follow,
  profile as fetchProfile,
  unfollow,
  userContent,
  type FeedItem,
  type PublicProfile,
} from "../api";
import Avatar from "../components/Avatar";
import { useAuth } from "../auth";
import { colors, ugx } from "../theme";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/**
 * Rich profile (TikTok-style): avatar, name/handle, Following · Followers ·
 * Likes stats, bio, action buttons, and a 3-column grid of their posts.
 * Serves both "my profile" (the Me tab) and any other user's.
 */
export default function UserProfileScreen({ route, navigation }: any) {
  const { user, logout } = useAuth();
  const targetId: string = route?.params?.userId ?? user?.id;
  const { width } = useWindowDimensions();
  const cell = (width - 4) / 3;

  const [prof, setProf] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [following, setFollowing] = useState(false);

  const load = useCallback(async () => {
    if (!targetId) return;
    try {
      const [p, c] = await Promise.all([
        fetchProfile(targetId),
        userContent(targetId).catch(() => ({ content: [] as FeedItem[] })),
      ]);
      setProf(p.profile);
      setFollowing(!!p.profile.isFollowing);
      setPosts(c.content ?? []);
    } catch {
      // leave whatever we have
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetId]);

  useEffect(() => {
    load();
  }, [load]);

  const isSelf = prof?.isSelf ?? targetId === user?.id;

  const toggleFollow = async () => {
    const next = !following;
    setFollowing(next);
    setProf((p) => (p ? { ...p, followers: Math.max(0, p.followers + (next ? 1 : -1)) } : p));
    try {
      if (next) await follow(targetId);
      else await unfollow(targetId);
    } catch {
      setFollowing(!next);
      load();
    }
  };

  const becomeCreator = async () => {
    try {
      await applyCreator();
      Alert.alert("You're a creator!", "Create your first post from the + tab.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "already_creator") {
        Alert.alert("Already a creator", "Create posts from the + tab.");
      } else {
        Alert.alert("Failed", e instanceof Error ? e.message : "Try again");
      }
    }
  };

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const header = (
    <View style={s.header}>
      <Avatar handle={prof?.handle} displayName={prof?.displayName} size={96} />
      <Text style={s.name}>{prof?.displayName || prof?.handle || "—"}</Text>
      <Text style={s.handle}>@{prof?.handle}</Text>

      <View style={s.stats}>
        <Stat value={prof?.following ?? 0} label="Following" />
        <Stat value={prof?.followers ?? 0} label="Followers" />
        <Stat value={prof?.likes ?? 0} label="Likes" />
      </View>

      <View style={s.actions}>
        {isSelf ? (
          <>
            <TouchableOpacity style={s.primaryBtn} onPress={becomeCreator}>
              <Text style={s.primaryBtnText} numberOfLines={1}>
                Become creator
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={logout}>
              <Text style={s.iconBtnText} numberOfLines={1}>
                Log out
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[s.primaryBtn, following && s.followingBtn]}
              onPress={toggleFollow}
            >
              <Text style={[s.primaryBtnText, following && s.followingBtnText]}>
                {following ? "Following" : "Follow"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() =>
                navigation.navigate("Conversation", {
                  userId: targetId,
                  title: `@${prof?.handle}`,
                })
              }
            >
              <Text style={s.iconBtnText}>Message</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {prof?.bio ? <Text style={s.bio}>{prof.bio}</Text> : null}

      <View style={s.tabRow}>
        <Text style={s.tabActive}>
          ▦ Posts{prof?.posts != null ? ` · ${prof.posts}` : ""}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <FlatList
        data={posts}
        keyExtractor={(i) => i.id}
        numColumns={3}
        ListHeaderComponent={header}
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
        ListEmptyComponent={<Text style={s.empty}>No posts yet</Text>}
        renderItem={({ item }) => (
          <View style={[s.gridCell, { width: cell, height: cell * 1.4 }]}>
            <View style={s.gridInner}>
              <Text style={s.gridKind}>
                {item.kind === "text" ? "✍️" : item.kind === "photo" ? "🖼" : "🎬"}
              </Text>
              <Text style={s.gridTitle} numberOfLines={2}>
                {item.kind === "text" ? item.description ?? item.title : item.title ?? "Untitled"}
              </Text>
            </View>
            {item.pricing === "paid" ? (
              <Text style={s.gridPrice}>{ugx(item.priceUgx)}</Text>
            ) : null}
            <Text style={s.gridLikes}>♥ {compact(item.likeCount)}</Text>
          </View>
        )}
      />
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{compact(value)}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  header: { alignItems: "center", paddingTop: 50, paddingHorizontal: 20, paddingBottom: 6 },
  name: { color: colors.text, fontSize: 22, fontWeight: "800", marginTop: 12 },
  handle: { color: colors.dim, fontSize: 14, marginTop: 2 },
  stats: { flexDirection: "row", gap: 34, marginTop: 18 },
  stat: { alignItems: "center" },
  statValue: { color: colors.text, fontSize: 18, fontWeight: "800" },
  statLabel: { color: colors.dim, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", gap: 10, marginTop: 18, width: "100%" },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#000", fontWeight: "800", fontSize: 14 },
  followingBtn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  followingBtnText: { color: colors.text },
  iconBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtnText: { color: colors.text, fontWeight: "700", fontSize: 14 },
  bio: { color: colors.text, textAlign: "center", marginTop: 16, lineHeight: 20 },
  tabRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    width: "100%",
    paddingBottom: 10,
  },
  tabActive: { color: colors.text, fontWeight: "700" },
  empty: { color: colors.dim, textAlign: "center", marginTop: 40 },
  gridCell: { padding: 1, backgroundColor: colors.bg },
  gridInner: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  gridKind: { fontSize: 26, marginBottom: 6 },
  gridTitle: { color: colors.dim, fontSize: 11, textAlign: "center" },
  gridPrice: {
    position: "absolute",
    top: 6,
    right: 6,
    color: "#000",
    backgroundColor: colors.accent,
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  gridLikes: {
    position: "absolute",
    bottom: 6,
    left: 8,
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
