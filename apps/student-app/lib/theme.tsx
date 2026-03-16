import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { Colors } from "@/constants/colors";
import { getItemAsync, setItemAsync } from "./storage";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  mode: ThemeMode;
  isDark: boolean;
  colors: typeof Colors.light | typeof Colors.dark;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>(null!);
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    getItemAsync("theme_mode").then((saved) => {
      if (saved === "light" || saved === "dark" || saved === "system") setModeState(saved);
    });
  }, []);

  const isDark = mode === "system" ? systemScheme === "dark" : mode === "dark";
  const colors = isDark ? Colors.dark : Colors.light;

  function setMode(m: ThemeMode) {
    setModeState(m);
    setItemAsync("theme_mode", m);
  }

  return (
    <ThemeContext.Provider value={{ mode, isDark, colors, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
