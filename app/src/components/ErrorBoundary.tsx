import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../theme";

interface State {
  error: Error | null;
}

/**
 * App-wide error boundary. In a release/preview build a thrown React error would
 * otherwise close the app with no message ("keeps stopping"); this catches it
 * and shows the error text so it can be read back and fixed. Native crashes
 * (e.g. a broken native module) can't be caught here — but JS errors can.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={s.root}>
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.sub}>This screen hit an error. Details:</Text>
        <ScrollView style={s.box}>
          <Text style={s.msg}>{this.state.error.message}</Text>
          {this.state.error.stack ? <Text style={s.stack}>{this.state.error.stack}</Text> : null}
        </ScrollView>
        <TouchableOpacity style={s.btn} onPress={() => this.setState({ error: null })}>
          <Text style={s.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 24, paddingTop: 70 },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.dim, marginTop: 6, marginBottom: 14 },
  box: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 14 },
  msg: { color: colors.danger, fontWeight: "700", marginBottom: 10 },
  stack: { color: colors.dim, fontSize: 11, fontFamily: "monospace" },
  btn: { backgroundColor: colors.accent, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 16 },
  btnText: { color: "#000", fontWeight: "800" },
});
