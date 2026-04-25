import { Stack } from "expo-router";

import { AppProviders } from "../src/providers/AppProviders";

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#f4efe5" },
        }}
      />
    </AppProviders>
  );
}
