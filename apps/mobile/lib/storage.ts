import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function canUseWebStorage() {
  return Platform.OS === "web" && typeof window !== "undefined";
}

export async function getItemAsync(key: string) {
  if (canUseWebStorage()) {
    return window.localStorage.getItem(key);
  }

  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string) {
  if (canUseWebStorage()) {
    window.localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string) {
  if (canUseWebStorage()) {
    window.localStorage.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}
