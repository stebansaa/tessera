/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--color-bg)",
          header: "var(--color-bg-header)",
          active: "var(--color-bg-active)",
          footer: "var(--color-bg-footer)",
        },
        divider: "var(--color-divider)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        fg: {
          DEFAULT: "var(--color-fg)",
          dim: "var(--color-fg-dim)",
          muted: "var(--color-fg-muted)",
          bright: "var(--color-fg-bright)",
          button: "var(--color-fg-button)",
        },
        dot: {
          on: "var(--color-dot-on)",
          off: "var(--color-dot-off)",
          llm: "var(--color-dot-llm)",
          web: "var(--color-dot-web)",
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
