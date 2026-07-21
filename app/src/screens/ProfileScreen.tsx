import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ApiError, applyCreator, profile } from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [counts, setCounts] = useState<{ followers: number; following: number } | null>(null);
  const [isCreator, setIsCreator] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    profile(user.id)
      .then((r) => setCounts({ followers: r.profile.followers, following: r.profile.following }))
      .catch(() => {});
  }, [user]);

  const becomeCreator = async () => {
    try {
      await applyCreator();
      setIsCreator(true);
      Alert.alert("You're a creator!", "Upload your first video from the + tab.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "already_creator") {
        setIsCreator(true);
        Alert.alert("Already a creator", "Upload from the + tab.");
      } else {
        Alert.alert("Failed", e instanceof Error ? e.message : "Try again");
      }
    }
  };

  return (
    <View style={s.root}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{user?.handle?.slice(5, 7).toUpperCase() ?? "?"}</Text>
      </View>
      <Text style={s.handle}>@{user?.handle}</Text>
      <Text style={s.phone}>{user?.phone}</Text>

      <View style={s.stats}>
        <View style={s.stat}>
          <Text style={s.statNum}>{counts?.followers ?? "–"}</Text>
          <Text style={s.statLabel}>Followers</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statNum}>{counts?.following ?? "–"}</Text>
          <Text style={s.statLabel}>Following</Text>
        </View>
      </View>

      <Text style={s.payoutNote}>
        💰 Earnings are paid to {user?.phone} — the number you registered with.
      </Text>

      {!isCreator ? (
        <TouchableOpacity style={s.creatorBtn} onPress={becomeCreator}>
          <Text style={s.creatorBtnText}>Become a creator</Text>
        </TouchableOpacity>
      ) : (
        <Text style={s.creatorBadge}>🎬 Creator</Text>
      )}

      <TouchableOpacity style={s.logoutBtn} onPress={logout}>
        <Text style={s.logoutText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: "center", paddingTop: 90 },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.accent,
  },
  avatarText: { color: colors.accent, fontSize: 30, fontWeight: "900" },
  handle: { color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 12 },
  phone: { color: colors.dim, marginTop: 4 },
  stats: { flexDirection: "row", gap: 40, marginTop: 24 },
  stat: { alignItems: "center" },
  statNum: { color: colors.text, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.dim, fontSize: 12, marginTop: 2 },
  payoutNote: {
    color: colors.dim,
    fontSize: 12,
    marginTop: 28,
    marginHorizontal: 40,
    textAlign: "center",
  },
  creatorBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 36,
    marginTop: 24,
  },
  creatorBtnText: { color: "#000", fontWeight: "800" },
  creatorBadge: { color: colors.success, fontWeight: "800", marginTop: 24, fontSize: 16 },
  logoutBtn: { marginTop: 40 },
  logoutText: { color: colors.danger, fontWeight: "700" },
});
