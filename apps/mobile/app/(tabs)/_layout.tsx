import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#9f4d1f",
        tabBarInactiveTintColor: "#7d705d",
        tabBarStyle: {
          backgroundColor: "#fffaf2",
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Inbox" }} />
      <Tabs.Screen name="threads" options={{ title: "Threads" }} />
    </Tabs>
  );
}
