import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  ApiError,
  checkout,
  devSettle,
  getLive,
  type LiveEventForViewer,
} from "../api";
import Avatar from "../components/Avatar";
import LiveStage from "../components/LiveStage";
import { Placeholder } from "./GoLiveScreen";
import { colors, ugx } from "../theme";

/**
 * LiveViewerScreen — watch a creator's live. If the viewer doesn't hold a ticket
 * it shows the paywall (Mobile Money checkout, mirroring the video unlock flow);
 * once owned it enters the LiveStage room (chat + reactions + viewer count) with
 * the video surface as a Phase-A placeholder.
 */
export default function LiveViewerScreen({ route, navigation }: { route: any; navigation: any }) {
  const liveId: string = route.params.liveId;
  const [event, setEvent] = useState<LiveEventForViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getLive(liveId);
      setEvent(r.live);
      if (r.live.owned) setUnlocked(true);
    } catch (e) {
      Alert.alert("Couldn't open live", e instanceof Error ? e.message : "Try again", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [liveId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const buy = async () => {
    if (!event) return;
    setBuying(true);
    try {
      const r = await checkout("live_ticket", event.id);
      if (r.simulated) {
        await devSettle(r.txRef, event.ticketPriceUgx);
        setUnlocked(true);
      } else {
        Alert.alert(
          "Check your phone",
          "Approve the Mobile Money prompt, then tap Join again to enter the live.",
        );
      }
    } catch (e) {
      if (e instanceof ApiError && (e.code === "already_owned" || e.code === "already_paid")) {
        setUnlocked(true);
      } else {
        Alert.alert("Purchase failed", e instanceof Error ? e.message : "Try again");
      }
    } finally {
      setBuying(false);
    }
  };

  if (loading || !event) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // The broadcast is over (or never made it live).
  if (event.status !== "live" && !event.isOwner) {
    return (
      <View style={s.center}>
        <Text style={s.overTitle}>This live has ended</Text>
        <Text style={s.overSub}>@{event.creatorHandle} isn't broadcasting right now.</Text>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Paywall — not the owner and no ticket yet.
  if (!unlocked && !event.isOwner) {
    return (
      <View style={s.center}>
        <Avatar
          handle={event.creatorHandle}
          displayName={event.creatorDisplayName}
          userId={event.creatorUserId}
          avatarKey={event.creatorAvatarR2Key}
          size={84}
        />
        <View style={s.liveTag}>
          <View style={s.liveDot} />
          <Text style={s.liveTagText}>LIVE NOW</Text>
        </View>
        <Text style={s.payTitle}>{event.title || `@${event.creatorHandle} is live`}</Text>
        <Text style={s.payHandle}>@{event.creatorHandle}</Text>
        <Text style={s.payPrice}>{ugx(event.ticketPriceUgx)}</Text>
        <TouchableOpacity style={s.joinBtn} onPress={buy} disabled={buying}>
          {buying ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={s.joinText}>Buy ticket · {ugx(event.ticketPriceUgx)}</Text>
          )}
        </TouchableOpacity>
        <Text style={s.payNote}>One ticket · Pay with Mobile Money</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.payCancel}>
          <Text style={s.payCancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <LiveStage
      liveId={event.id}
      connected
      title={event.title}
      creatorHandle={event.creatorHandle}
      videoSlot={
        <Placeholder
          emoji="📺"
          title={`@${event.creatorHandle}'s video will appear here`}
          body="Live video is being switched on. You're in the room — chat, reactions and the live viewer count are working now."
        />
      }
    />
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  overTitle: { color: colors.text, fontSize: 22, fontWeight: "800" },
  overSub: { color: colors.dim, marginTop: 8, textAlign: "center" },
  backBtn: {
    marginTop: 22,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 30,
  },
  backText: { color: colors.accent, fontWeight: "800" },
  liveTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.danger,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 18,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  liveTagText: { color: "#fff", fontWeight: "900", fontSize: 11, letterSpacing: 0.5 },
  payTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginTop: 16,
    textAlign: "center",
  },
  payHandle: { color: colors.dim, marginTop: 4 },
  payPrice: { color: colors.accent, fontSize: 20, fontWeight: "800", marginTop: 14 },
  joinBtn: {
    backgroundColor: colors.accent,
    borderRadius: 26,
    paddingVertical: 14,
    paddingHorizontal: 34,
    marginTop: 18,
    minWidth: 230,
    alignItems: "center",
  },
  joinText: { color: "#000", fontWeight: "900", fontSize: 16 },
  payNote: { color: colors.dim, marginTop: 12, fontSize: 12 },
  payCancel: { marginTop: 20 },
  payCancelText: { color: colors.dim, fontWeight: "700" },
});
