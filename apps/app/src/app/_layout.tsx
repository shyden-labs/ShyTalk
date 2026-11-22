import { Stack } from 'expo-router';

/** The app's root: one stack of screens with no header bar; plan 6.1 Task 6 draws them from the UI document. */
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
