/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#15161a",
          header: "#0f1014",
          active: "#272a31",
          footer: "#10131a",
        },
        divider: "#2d2f37",
        accent: "#5fb3fa",
        fg: {
          DEFAULT: "#dee0e8",
          dim: "#9a9ea7",
          muted: "#6b6f78",
          bright: "#f9faff",
          button: "#73baf7",
        },
        dot: {
          on: "#59db89",
          off: "#73767e",
          llm: "#bb80f2",
          web: "#73c4f5",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
