/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./lib/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: "#1a1a1a",
          beige: "#f5f0e8",
          accent: "#d4a574",
        },
      },
    },
  },
  plugins: [],
};
