module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: "#fefcf9",
          card: "#ffffff",
          surface: "#f8f0e5",
          "surface-light": "#faf5ed",
          accent: "#d4a574",
          "text-primary": "#2d2d2d",
          "text-secondary": "#6b5a45",
          "text-muted": "#a08060",
          border: "#f0e6d8",
          destructive: "#c87070",
          success: "#5da37e",
          "dark-bg": "#1a1a2e",
          "dark-card": "#16213e",
          "dark-surface": "#0f3460",
          "dark-accent": "#e94560",
          "dark-border": "#2a2a4a",
        },
      },
    },
  },
  plugins: [],
};
