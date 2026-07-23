import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { AuthProvider, useAuth } from "./src/auth";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import ConversationScreen from "./src/screens/ConversationScreen";
import FeedScreen from "./src/screens/FeedScreen";
import InboxScreen from "./src/screens/InboxScreen";
import LoginScreen from "./src/screens/LoginScreen";
import StudioScreen from "./src/screens/StudioScreen";
import UserProfileScreen from "./src/screens/UserProfileScreen";
import { colors } from "./src/theme";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function tabIcon(label: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 26, opacity: focused ? 1 : 0.5 }}>{label}</Text>
  );
}

/** The centre "create" button, raised and boxed like TikTok's. */
function createIcon() {
  return () => (
    <View
      style={{
        width: 46,
        height: 32,
        borderRadius: 9,
        backgroundColor: colors.accent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: "900", color: "#000", lineHeight: 25 }}>+</Text>
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Taller bar with real contrast — the slim default was hard to read.
        tabBarStyle: {
          backgroundColor: "#000",
          borderTopColor: "#222",
          borderTopWidth: 1,
          height: 76,
          paddingTop: 8,
          paddingBottom: 16,
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
            name="Conversation"
            component={ConversationScreen}
            options={({ route }) => ({
              title: (route.params as { title?: string } | undefined)?.title ?? "Chat",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
            })}
          />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
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
