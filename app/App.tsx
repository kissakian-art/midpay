import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { setAudioModeAsync } from "expo-audio";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/auth";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import AdminScreen from "./src/screens/AdminScreen";
import ConversationScreen from "./src/screens/ConversationScreen";
import CreatorAnalyticsScreen from "./src/screens/CreatorAnalyticsScreen";
import FeedScreen from "./src/screens/FeedScreen";
import GoLiveScreen from "./src/screens/GoLiveScreen";
import InboxScreen from "./src/screens/InboxScreen";
import LiveDiscoveryScreen from "./src/screens/LiveDiscoveryScreen";
import LiveViewerScreen from "./src/screens/LiveViewerScreen";
import LoginScreen from "./src/screens/LoginScreen";
import PostViewerScreen from "./src/screens/PostViewerScreen";
import SearchScreen from "./src/screens/SearchScreen";
import StudioScreen from "./src/screens/StudioScreen";
import UserProfileScreen from "./src/screens/UserProfileScreen";
import { colors } from "./src/theme";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Every tab icon lives in an identical fixed-height, centred box so the emoji
// glyphs and the boxed "+" share the same vertical centre and line up in a row.
const ICON_BOX = {
  height: 32,
  alignItems: "center",
  justifyContent: "center",
} as const;

function tabIcon(label: string) {
  // Inactive icons stay near full brightness: the monochrome 👤 (profile) glyph
  // was washing out against the black bar at 0.5. Active vs inactive is carried
  // by the label colour (white vs grey), so the icons can stay clearly visible.
  return ({ focused }: { focused: boolean }) => (
    <View style={ICON_BOX}>
      <Text style={{ fontSize: 26, opacity: focused ? 1 : 0.9 }}>{label}</Text>
    </View>
  );
}

/** The centre "create" button — boxed like TikTok's, aligned with the row. */
function createIcon() {
  return () => (
    <View style={ICON_BOX}>
      <View
        style={{
          width: 46,
          height: 30,
          borderRadius: 9,
          backgroundColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "900", color: "#000", lineHeight: 25 }}>+</Text>
      </View>
    </View>
  );
}

function Tabs() {
  // Respect the device's bottom safe area (gesture pill / nav buttons) so the
  // bar sits ABOVE the system navigation instead of colliding with it.
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Taller bar with real contrast — the slim default was hard to read.
        tabBarStyle: {
          backgroundColor: "#000",
          borderTopColor: "#222",
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 10),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: 2 },
        tabBarActiveTintColor: "#fff",
        tabBarInactiveTintColor: "#8A8A8A",
      }}
    >
      <Tab.Screen name="FeedTab" component={FeedScreen} options={{ title: "Home", tabBarIcon: tabIcon("🏠") }} />
      <Tab.Screen
        name="UploadTab"
        component={StudioScreen}
        options={{ title: "", tabBarIcon: createIcon() }}
      />
      <Tab.Screen name="InboxTab" component={InboxScreen} options={{ title: "Inbox", tabBarIcon: tabIcon("💬") }} />
      <Tab.Screen name="ProfileTab" component={UserProfileScreen} options={{ title: "Profile", tabBarIcon: tabIcon("👤") }} />
    </Tab.Navigator>
  );
}

function Root() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  return (
    <Stack.Navigator>
      {user ? (
        <>
          <Stack.Screen name="Main" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen
            name="UserProfile"
            component={UserProfileScreen}
            options={{
              title: "",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
            }}
          />
          <Stack.Screen
            name="PostViewer"
            component={PostViewerScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Search"
            component={SearchScreen}
            options={{
              title: "Search",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
            }}
          />
          <Stack.Screen
            name="Admin"
            component={AdminScreen}
            options={{
              title: "Admin",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
            }}
          />
          <Stack.Screen
            name="CreatorAnalytics"
            component={CreatorAnalyticsScreen}
            options={{
              title: "Your earnings",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
            }}
          />
          <Stack.Screen
            name="Conversation"
            component={ConversationScreen}
            options={({ route }) => ({
              title: (route.params as { title?: string } | undefined)?.title ?? "Chat",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
            })}
          />
          <Stack.Screen
            name="LiveDiscovery"
            component={LiveDiscoveryScreen}
            options={{
              title: "Live now",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
            }}
          />
          <Stack.Screen name="GoLive" component={GoLiveScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="LiveViewer"
            component={LiveViewerScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  // Play a video's own audio even when the ringer is off (iOS silent switch).
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <NavigationContainer
        theme={{
          ...DarkTheme,
          colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.accent },
        }}
      >
          <StatusBar style="light" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </ErrorBoundary>
  );
}
