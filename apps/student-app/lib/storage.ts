import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function canUseWebStorage() {
  return Platform.OS === "web" && typeof window !== "undefined";
}

export async function getItemAsync(key: string) {
  if (canUseWebStorage()) return window.sessionStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string) {
  if (canUseWebStorage()) { window.sessionStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string) {
  if (canUseWebStorage()) { window.sessionStorage.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
}
