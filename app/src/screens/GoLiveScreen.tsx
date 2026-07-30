import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  ApiError,
  applyCreator,
  endLive,
  quoteLiveFloor,
  scheduleLive,
  startLive,
  type LiveEvent,
} from "../api";
import { useAuth } from "../auth";
import LiveStage from "../components/LiveStage";
import { colors, ugx } from "../theme";

const DURATION_PRESETS = [15, 30, 60, 120];

/**
 * GoLiveScreen — the creator's broadcast flow. Three phases:
 *   form  → set title / duration / ticket price (with the §3.3 floor quoted live)
 *   ready → the event is scheduled; a big button starts the broadcast
 *   live  → the LiveStage control room (chat, viewers, reactions) + End
 *
 * Video is a labelled placeholder in Phase A; the camera broadcast drops into
 * the same `videoSlot` in Phase B.
 */
export default function GoLiveScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<"form" | "ready" | "live">("form");
  const [event, setEvent] = useState<LiveEvent | null>(null);

  const [title, setTitle] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [price, setPrice] = useState("");
  const [floor, setFloor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);

  // Quote the duration-scaled price floor as the duration changes (debounced).
  const quoteSeq = useRef(0);
  useEffect(() => {
    const mine = ++quoteSeq.current;
    const t = setTimeout(async () => {
      try {
        const { floor: f } = await quoteLiveFloor(durationMin);
        if (mine === quoteSeq.current) setFloor(f);
      } catch {
        // leave the last known floor; the server still enforces at schedule
      }
    }, 350);
    return () => clearTimeout(t);
  }, [durationMin]);

  const schedule = async () => {
    const ticketPriceUgx = Math.round(Number(price));
    if (!Number.isFinite(ticketPriceUgx) || ticketPriceUgx <= 0) {
      Alert.alert("Set a ticket price", "Enter the price viewers pay to watch, in UGX.");
      return;
    }
    if (floor != null && ticketPriceUgx < floor) {
      Alert.alert("Price too low", `A ${durationMin}-minute live must cost at least ${ugx(floor)}.`);
      return;
    }
    setBusy(true);
    try {
      const doSchedule = () =>
        scheduleLive({
          title: title.trim() || undefined,
          declaredDurationMin: durationMin,
          ticketPriceUgx,
        });
      let r;
      try {
        r = await doSchedule();
      } catch (e) {
        // Not a creator yet? Become one (instant, open-signup) and retry once.
        if (e instanceof ApiError && (e.status === 403 || e.code === "forbidden")) {
          await applyCreator().catch(() => {});
          r = await doSchedule();
        } else {
          throw e;
        }
      }
      setEvent(r.live);
      setPhase("ready");
    } catch (e) {
      if (e instanceof ApiError && e.code === "below_live_price_floor") {
        Alert.alert("Price too low", e.message);
      } else {
        Alert.alert("Couldn't schedule", e instanceof Error ? e.message : "Try again");
      }
    } finally {
      setBusy(false);
    }
  };

  const goLive = async () => {
    if (!event) return;
    setBusy(true);
    try {
      const r = await startLive(event.id);
      setEvent(r.live);
      setPhase("live");
    } catch (e) {
      Alert.alert("Couldn't go live", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  };

  const end = () => {
    if (!event) return;
    Alert.alert("End broadcast?", "This stops the live for everyone.", [
      { text: "Keep live", style: "cancel" },
      {
        text: "End",
        style: "destructive",
        onPress: async () => {
          setEnding(true);
          try {
            await endLive(event.id);
          } catch {
            // even if the call fails, leave the room; cron also auto-terminates
          } finally {
            navigation.goBack();
          }
        },
      },
    ]);
  };

  if (phase === "live" && event) {
    return (
      <LiveStage
        liveId={event.id}
        connected
        title={event.title}
        creatorHandle={user?.handle ?? "you"}
        roleBadge="YOU'RE LIVE"
        headerRight={
          <TouchableOpacity style={s.endBtn} onPress={end} disabled={ending}>
            {ending ? <ActivityIndicator color="#fff" /> : <Text style={s.endText}>End</Text>}
          </TouchableOpacity>
        }
        videoSlot={
          <Placeholder
            emoji="📷"
            title="Your camera preview goes here"
            body="Live video streaming is being switched on. Chat, reactions and viewer counts are already live — this is the broadcaster control room."
          />
        }
      />
    );
  }

  if (phase === "ready" && event) {
    return (
      <View style={s.readyRoot}>
        <Text style={s.readyKicker}>Ready to broadcast</Text>
        <Text style={s.readyTitle}>{event.title || "Your live"}</Text>
        <View style={s.readyCard}>
          <Row label="Duration" value={`${event.declaredDurationMin} min`} />
          <Row label="Ticket price" value={ugx(event.ticketPriceUgx)} />
          <Row label="Price floor applied" value={ugx(event.priceFloorAppliedUgx)} />
        </View>
        <Text style={s.readyNote}>
          Viewers pay the ticket once to join. The stream auto-ends at{" "}
          {event.declaredDurationMin} minutes.
        </Text>
        <TouchableOpacity style={s.goLiveBtn} onPress={goLive} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={s.goLiveText}>Go live now</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.cancelBtn}>
          <Text style={s.cancelText}>Not now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Go Live</Text>
        <Text style={s.sub}>Set up a ticketed live broadcast.</Text>

        <Text style={s.label}>Title (optional)</Text>
        <TextInput
          style={s.field}
          placeholder="e.g. Friday night Q&A"
          placeholderTextColor={colors.dim}
          value={title}
          onChangeText={setTitle}
          maxLength={80}
        />

        <Text style={s.label}>Planned duration</Text>
        <View style={s.presetRow}>
          {DURATION_PRESETS.map((m) => (
            <TouchableOpacity
              key={m}
              style={[s.preset, durationMin === m && s.presetOn]}
              onPress={() => setDurationMin(m)}
            >
              <Text style={[s.presetText, durationMin === m && s.presetTextOn]}>{m}m</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.label}>Ticket price (UGX)</Text>
        <TextInput
          style={s.field}
          placeholder={floor ? `Min ${floor}` : "Amount"}
          placeholderTextColor={colors.dim}
          value={price}
          onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
        />
        {floor != null ? (
          <Text style={s.floorHint}>
            Minimum for {durationMin} min: <Text style={s.floorVal}>{ugx(floor)}</Text>
          </Text>
        ) : null}

        <TouchableOpacity style={s.scheduleBtn} onPress={schedule} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={s.scheduleText}>Set up broadcast</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

/** Shared labelled stand-in for the video surface (Phase A). */
export function Placeholder({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <View style={s.ph}>
      <Text style={s.phEmoji}>{emoji}</Text>
      <Text style={s.phTitle}>{title}</Text>
      <Text style={s.phBody}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  formContent: { padding: 20, paddingTop: 60 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "900" },
  sub: { color: colors.dim, marginTop: 4, marginBottom: 20 },
  label: { color: colors.text, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  field: {
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  presetRow: { flexDirection: "row", gap: 10 },
  preset: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  presetOn: { backgroundColor: colors.accent },
  presetText: { color: colors.text, fontWeight: "700" },
  presetTextOn: { color: "#000" },
  floorHint: { color: colors.dim, marginTop: 8, fontSize: 13 },
  floorVal: { color: colors.accent, fontWeight: "800" },
  scheduleBtn: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 28,
  },
  scheduleText: { color: "#000", fontWeight: "900", fontSize: 16 },

  readyRoot: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" },
  readyKicker: { color: colors.accent, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  readyTitle: { color: colors.text, fontSize: 28, fontWeight: "900", marginTop: 6, marginBottom: 20 },
  readyCard: { backgroundColor: colors.card, borderRadius: 16, padding: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  rowLabel: { color: colors.dim, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  readyNote: { color: colors.dim, marginTop: 16, lineHeight: 20 },
  goLiveBtn: {
    backgroundColor: colors.accent,
    borderRadius: 26,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 28,
  },
  goLiveText: { color: "#000", fontWeight: "900", fontSize: 17 },
  cancelBtn: { alignItems: "center", marginTop: 16 },
  cancelText: { color: colors.dim, fontWeight: "700" },

  endBtn: {
    backgroundColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 56,
    alignItems: "center",
  },
  endText: { color: "#fff", fontWeight: "900", fontSize: 14 },

  ph: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#0c0c0c" },
  phEmoji: { fontSize: 54, marginBottom: 14 },
  phTitle: { color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  phBody: { color: colors.dim, textAlign: "center", marginTop: 10, lineHeight: 20 },
});
