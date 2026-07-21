import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { AuthProvider, useAuth } from "./src/auth";
import ConversationScreen from "./src/screens/ConversationScreen";
import FeedScreen from "./src/screens/FeedScreen";
import InboxScreen from "./src/screens/InboxScreen";
import LoginScreen from "./src/screens/LoginScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import UploadScreen from "./src/screens/UploadScreen";
import { colors } from "./src/theme";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function tabIcon(label: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{label}</Text>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.dim,
      }}
    >
      <Tab.Screen name="FeedTab" component={FeedScreen} options={{ title: "Feed", tabBarIcon: tabIcon("🎬") }} />
      <Tab.Screen name="UploadTab" component={UploadScreen} options={{ title: "Create", tabBarIcon: tabIcon("➕") }} />
      <Tab.Screen name="InboxTab" component={InboxScreen} options={{ title: "Inbox", tabBarIcon: tabIcon("💬") }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: "Me", tabBarIcon: tabIcon("👤") }} />
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
  );
}
