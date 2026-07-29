import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import {
  checkHandle,
  deleteContent,
  follow,
  thumbnailUrl,
  profile as fetchProfile,
  unfollow,
  updateProfile,
  uploadAvatar,
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

  // Edit-profile state
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [draftHandle, setDraftHandle] = useState("");
  const [handleState, setHandleState] = useState<
    { status: "idle" | "checking" | "ok" | "bad"; reason?: string }
  >({ status: "idle" });
  const [saving, setSaving] = useState<string | null>(null);

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

  // Creators manage their own catalog: long-press a post to delete it.
  const confirmDelete = (item: FeedItem) => {
    Alert.alert(
      "Delete this post?",
      "It's removed permanently, and anyone who bought it loses access. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const prev = posts;
            setPosts((p) => p.filter((x) => x.id !== item.id)); // optimistic
            setProf((pr) => (pr && pr.posts != null ? { ...pr, posts: Math.max(0, pr.posts - 1) } : pr));
            try {
              await deleteContent(item.id);
            } catch (e) {
              setPosts(prev); // revert
              Alert.alert("Couldn't delete", e instanceof Error ? e.message : "Try again");
            }
          },
        },
      ],
    );
  };

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

  const openEditor = () => {
    setDraftName(prof?.displayName ?? "");
    setDraftBio(prof?.bio ?? "");
    setDraftHandle(prof?.handle ?? "");
    setHandleState({ status: "idle" });
    setEditing(true);
  };

  // Debounced username availability check while typing.
  useEffect(() => {
    if (!editing) return;
    const wanted = draftHandle.trim().toLowerCase();
    if (!wanted || wanted === prof?.handle) {
      setHandleState({ status: "idle" });
      return;
    }
    setHandleState({ status: "checking" });
    const t = setTimeout(async () => {
      try {
        const r = await checkHandle(wanted);
        setHandleState(
          r.available ? { status: "ok" } : { status: "bad", reason: r.reason },
        );
      } catch {
        setHandleState({ status: "idle" });
      }
    }, 450);
    return () => clearTimeout(t);
  }, [draftHandle, editing, prof?.handle]);

  const changePhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to pick a profile picture.");
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (r.canceled || !r.assets[0]) return;
      setSaving("Uploading photo…");
      const asset = r.assets[0];
      await uploadAvatar(asset.uri, asset.mimeType ?? "image/jpeg");
      await load();
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again");
    } finally {
      setSaving(null);
    }
  };

  const saveProfile = async () => {
    const wantedHandle = draftHandle.trim().toLowerCase();
    const handleChanged = !!wantedHandle && wantedHandle !== prof?.handle;
    if (handleChanged && handleState.status === "bad") {
      Alert.alert("Username unavailable", handleState.reason ?? "Pick another username");
      return;
    }
    try {
      setSaving("Saving…");
      await updateProfile({
        displayName: draftName.trim(),
        bio: draftBio.trim(),
        ...(handleChanged ? { handle: wantedHandle } : {}),
      });
      setEditing(false);
      await load();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again");
    } finally {
      setSaving(null);
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
      <TouchableOpacity onPress={isSelf ? changePhoto : undefined} activeOpacity={isSelf ? 0.7 : 1}>
        <Avatar
          handle={prof?.handle}
          displayName={prof?.displayName}
          userId={prof?.id}
          avatarKey={prof?.avatarR2Key}
          size={96}
        />
        {isSelf ? <Text style={s.changePhoto}>Change photo</Text> : null}
      </TouchableOpacity>
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
            {/* No "become creator" button: posting auto-creates the creator
                profile, so it was redundant and crowded the row. */}
            <TouchableOpacity style={s.primaryBtn} onPress={openEditor}>
              <Text style={s.primaryBtnText} numberOfLines={1}>
                Edit profile
              </Text>
            </TouchableOpacity>
            {user?.isAdmin ? (
              <TouchableOpacity style={s.iconBtn} onPress={() => navigation.navigate("Admin")}>
                <Text style={s.iconBtnText} numberOfLines={1}>
                  Admin
                </Text>
              </TouchableOpacity>
            ) : null}
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

      {isSelf ? (
        <TouchableOpacity
          style={s.earningsBtn}
          onPress={() => navigation.navigate("CreatorAnalytics")}
          activeOpacity={0.85}
        >
          <Text style={s.earningsBtnText}>📊  Your earnings &amp; stats</Text>
        </TouchableOpacity>
      ) : null}

      {prof?.bio ? <Text style={s.bio}>{prof.bio}</Text> : null}

      <View style={s.tabRow}>
        <Text style={s.tabActive}>
          ▦ Posts{prof?.posts != null ? ` · ${prof.posts}` : ""}
        </Text>
      </View>
      {isSelf && posts.length > 0 ? (
        <Text style={s.manageHint}>Long-press a post to delete it</Text>
      ) : null}
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
          <TouchableOpacity
            style={[s.gridCell, { width: cell, height: cell * 1.4 }]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate("PostViewer", { item })}
            onLongPress={isSelf ? () => confirmDelete(item) : undefined}
          >
            {item.thumbnailR2Key ? (
              <Image
                source={{ uri: thumbnailUrl(item.id, item.thumbnailR2Key) }}
                style={s.gridImage}
                resizeMode="cover"
              />
            ) : (
              <View style={s.gridInner}>
                <Text style={s.gridKind}>
                  {item.kind === "text" ? "✍️" : item.kind === "photo" ? "🖼" : "🎬"}
                </Text>
                <Text style={s.gridTitle} numberOfLines={3}>
                  {item.kind === "text"
                    ? item.description ?? item.title
                    : item.title ?? "Untitled"}
                </Text>
              </View>
            )}
            {item.kind === "video" ? <Text style={s.gridPlay}>▶</Text> : null}
            {item.pricing === "paid" ? (
              <Text style={s.gridPrice}>{ugx(item.priceUgx)}</Text>
            ) : null}
            <Text style={s.gridLikes}>♥ {compact(item.likeCount)}</Text>
          </TouchableOpacity>
        )}
      />

      {saving ? (
        <View style={s.savingOverlay}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={s.savingText}>{saving}</Text>
        </View>
      ) : null}

      {/* Edit profile */}
      <Modal visible={editing} animationType="slide" onRequestClose={() => setEditing(false)}>
        <KeyboardAvoidingView
          style={s.editRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Text style={s.editTitle}>Edit profile</Text>

          <TouchableOpacity style={s.editAvatarRow} onPress={changePhoto}>
            <Avatar
              handle={prof?.handle}
              displayName={prof?.displayName}
              userId={prof?.id}
              avatarKey={prof?.avatarR2Key}
              size={72}
            />
            <Text style={s.editAvatarLabel}>Tap to change photo</Text>
          </TouchableOpacity>

          <Text style={s.label}>Username</Text>
          <View style={s.handleRow}>
            <Text style={s.handleAt}>@</Text>
            <TextInput
              style={s.handleInput}
              value={draftHandle}
              onChangeText={(t) => setDraftHandle(t.replace(/[^A-Za-z0-9._]/g, "").toLowerCase())}
              placeholder="yourname"
              placeholderTextColor={colors.dim}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
            />
            {handleState.status === "checking" ? (
              <ActivityIndicator size="small" color={colors.dim} />
            ) : handleState.status === "ok" ? (
              <Text style={s.handleOk}>✓</Text>
            ) : handleState.status === "bad" ? (
              <Text style={s.handleBad}>✕</Text>
            ) : null}
          </View>
          <Text style={[s.hint, handleState.status === "bad" && s.hintBad]}>
            {handleState.status === "bad"
              ? handleState.reason
              : handleState.status === "ok"
                ? "Available"
                : "Letters, numbers, . and _ — this is your unique @name"}
          </Text>

          <Text style={s.label}>Display name</Text>
          <TextInput
            style={s.input}
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Your name"
            placeholderTextColor={colors.dim}
            maxLength={40}
          />
          <Text style={s.hint}>{draftName.length}/40</Text>

          <Text style={s.label}>Bio</Text>
          <TextInput
            style={[s.input, s.bioInput]}
            value={draftBio}
            onChangeText={setDraftBio}
            placeholder="Tell people what you do"
            placeholderTextColor={colors.dim}
            multiline
            maxLength={200}
          />
          <Text style={s.hint}>{draftBio.length}/200</Text>

          <View style={s.editActions}>
            <TouchableOpacity style={s.iconBtn} onPress={() => setEditing(false)}>
              <Text style={s.iconBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={saveProfile} disabled={!!saving}>
              <Text style={s.primaryBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  earningsBtn: {
    marginTop: 12,
    width: "100%",
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  earningsBtnText: { color: colors.text, fontWeight: "800", fontSize: 14 },
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
  manageHint: { color: colors.dim, fontSize: 11, textAlign: "center", marginTop: 8 },
  empty: { color: colors.dim, textAlign: "center", marginTop: 40 },
  gridCell: { padding: 1, backgroundColor: colors.bg },
  gridImage: { flex: 1, backgroundColor: colors.surface },
  gridPlay: { position: "absolute", top: 8, left: 8, color: "#fff", fontSize: 13, textShadowColor: "rgba(0,0,0,0.7)", textShadowOffset: {width:0,height:1}, textShadowRadius: 2 },
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
  changePhoto: { color: colors.accent, fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 6 },
  savingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  savingText: { color: colors.text, marginTop: 12 },
  editRoot: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  editTitle: { color: colors.text, fontSize: 24, fontWeight: "800", marginBottom: 20 },
  editAvatarRow: { alignItems: "center", marginBottom: 22 },
  editAvatarLabel: { color: colors.accent, fontWeight: "700", marginTop: 8, fontSize: 13 },
  label: { color: colors.dim, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bioInput: { height: 96, textAlignVertical: "top" },
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  handleAt: { color: colors.dim, fontSize: 16, fontWeight: "700" },
  handleInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12, paddingLeft: 2 },
  handleOk: { color: "#3BB273", fontSize: 18, fontWeight: "900" },
  handleBad: { color: colors.danger, fontSize: 18, fontWeight: "900" },
  hintBad: { color: colors.danger },
  hint: { color: colors.dim, fontSize: 11, textAlign: "right", marginTop: 4, marginBottom: 14 },
  editActions: { flexDirection: "row", gap: 12, marginTop: 10 },
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
