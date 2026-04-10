/**
 * Full color schemes for the entire UI — sidebar, tabs, status bar, panels,
 * and the xterm terminal. Adding a new scheme is just adding an entry here.
 *
 * Naming: each scheme has a `key` (persisted in settings) and a `label`
 * (shown in the Appearance panel).
 */

export interface ColorScheme {
  key: string;
  label: string;
  /** UI chrome colors */
  ui: {
    bg: string;
    bgHeader: string;
    bgActive: string;
    bgFooter: string;
    divider: string;
    fg: string;
    fgDim: string;
    fgMuted: string;
    fgBright: string;
    fgButton: string;
    dotOn: string;
    dotOff: string;
    dotLlm: string;
    dotWeb: string;
  };
  /** xterm terminal palette */
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    key: "dark",
    label: "Dark",
    ui: {
      bg: "#15161a",
      bgHeader: "#0f1014",
      bgActive: "#272a31",
      bgFooter: "#10131a",
      divider: "#2d2f37",
      fg: "#dee0e8",
      fgDim: "#9a9ea7",
      fgMuted: "#6b6f78",
      fgBright: "#f9faff",
      fgButton: "#73baf7",
      dotOn: "#59db89",
      dotOff: "#73767e",
      dotLlm: "#bb80f2",
      dotWeb: "#73c4f5",
    },
    terminal: {
      background: "#15161a",
      foreground: "#dee0e8",
      cursor: "#73baf7",
      cursorAccent: "#15161a",
      selectionBackground: "#5fb3fa55",
      black: "#1c1d22",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#dee0e8",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#f9faff",
    },
  },
  {
    key: "midnight",
    label: "Midnight",
    ui: {
      bg: "#0b0d14",
      bgHeader: "#070810",
      bgActive: "#1a1d28",
      bgFooter: "#080a10",
      divider: "#1e2130",
      fg: "#c8cad8",
      fgDim: "#8388a0",
      fgMuted: "#555a70",
      fgBright: "#eef0ff",
      fgButton: "#6aa8f0",
      dotOn: "#4dd890",
      dotOff: "#555a70",
      dotLlm: "#a875e8",
      dotWeb: "#60b8f0",
    },
    terminal: {
      background: "#0b0d14",
      foreground: "#c8cad8",
      cursor: "#6aa8f0",
      cursorAccent: "#0b0d14",
      selectionBackground: "#5090e055",
      black: "#121420",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#d4a94e",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#c8cad8",
      brightBlack: "#4a4e60",
      brightRed: "#e88890",
      brightGreen: "#a8d488",
      brightYellow: "#e5c880",
      brightBlue: "#79bff8",
      brightMagenta: "#d090ee",
      brightCyan: "#70ccd8",
      brightWhite: "#eef0ff",
    },
  },
  {
    key: "nord",
    label: "Nord",
    ui: {
      bg: "#2e3440",
      bgHeader: "#272c36",
      bgActive: "#3b4252",
      bgFooter: "#272c36",
      divider: "#434c5e",
      fg: "#d8dee9",
      fgDim: "#9aa3b4",
      fgMuted: "#6b7489",
      fgBright: "#eceff4",
      fgButton: "#88c0d0",
      dotOn: "#a3be8c",
      dotOff: "#6b7489",
      dotLlm: "#b48ead",
      dotWeb: "#81a1c1",
    },
    terminal: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#88c0d0",
      cursorAccent: "#2e3440",
      selectionBackground: "#88c0d055",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    key: "solarized-dark",
    label: "Solarized Dark",
    ui: {
      bg: "#002b36",
      bgHeader: "#00242e",
      bgActive: "#073642",
      bgFooter: "#00242e",
      divider: "#094a58",
      fg: "#93a1a1",
      fgDim: "#748484",
      fgMuted: "#586e75",
      fgBright: "#fdf6e3",
      fgButton: "#268bd2",
      dotOn: "#859900",
      dotOff: "#586e75",
      dotLlm: "#6c71c4",
      dotWeb: "#2aa198",
    },
    terminal: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#268bd2",
      cursorAccent: "#002b36",
      selectionBackground: "#268bd255",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#859900",
      brightYellow: "#b58900",
      brightBlue: "#268bd2",
      brightMagenta: "#6c71c4",
      brightCyan: "#2aa198",
      brightWhite: "#fdf6e3",
    },
  },
  {
    key: "solarized-light",
    label: "Solarized Light",
    ui: {
      bg: "#fdf6e3",
      bgHeader: "#eee8d5",
      bgActive: "#e6dfcc",
      bgFooter: "#eee8d5",
      divider: "#d3cbb7",
      fg: "#586e75",
      fgDim: "#768a8f",
      fgMuted: "#93a1a1",
      fgBright: "#073642",
      fgButton: "#268bd2",
      dotOn: "#859900",
      dotOff: "#93a1a1",
      dotLlm: "#6c71c4",
      dotWeb: "#2aa198",
    },
    terminal: {
      background: "#fdf6e3",
      foreground: "#657b83",
      cursor: "#268bd2",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#268bd244",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#859900",
      brightYellow: "#b58900",
      brightBlue: "#268bd2",
      brightMagenta: "#6c71c4",
      brightCyan: "#2aa198",
      brightWhite: "#fdf6e3",
    },
  },
  {
    key: "monokai",
    label: "Monokai",
    ui: {
      bg: "#272822",
      bgHeader: "#1e1f1a",
      bgActive: "#3e3d32",
      bgFooter: "#1e1f1a",
      divider: "#49483e",
      fg: "#f8f8f2",
      fgDim: "#b0b0a8",
      fgMuted: "#75715e",
      fgBright: "#ffffff",
      fgButton: "#66d9ef",
      dotOn: "#a6e22e",
      dotOff: "#75715e",
      dotLlm: "#ae81ff",
      dotWeb: "#66d9ef",
    },
    terminal: {
      background: "#272822",
      foreground: "#f8f8f2",
      cursor: "#f8f8f0",
      cursorAccent: "#272822",
      selectionBackground: "#66d9ef44",
      black: "#272822",
      red: "#f92672",
      green: "#a6e22e",
      yellow: "#f4bf75",
      blue: "#66d9ef",
      magenta: "#ae81ff",
      cyan: "#a1efe4",
      white: "#f8f8f2",
      brightBlack: "#75715e",
      brightRed: "#f92672",
      brightGreen: "#a6e22e",
      brightYellow: "#f4bf75",
      brightBlue: "#66d9ef",
      brightMagenta: "#ae81ff",
      brightCyan: "#a1efe4",
      brightWhite: "#f9f8f5",
    },
  },
  {
    key: "rosepine",
    label: "Rosé Pine",
    ui: {
      bg: "#191724",
      bgHeader: "#13111e",
      bgActive: "#26233a",
      bgFooter: "#13111e",
      divider: "#2a2740",
      fg: "#e0def4",
      fgDim: "#908caa",
      fgMuted: "#6e6a86",
      fgBright: "#f0efff",
      fgButton: "#9ccfd8",
      dotOn: "#31748f",
      dotOff: "#6e6a86",
      dotLlm: "#c4a7e7",
      dotWeb: "#9ccfd8",
    },
    terminal: {
      background: "#191724",
      foreground: "#e0def4",
      cursor: "#524f67",
      cursorAccent: "#e0def4",
      selectionBackground: "#403d5244",
      black: "#26233a",
      red: "#eb6f92",
      green: "#31748f",
      yellow: "#f6c177",
      blue: "#9ccfd8",
      magenta: "#c4a7e7",
      cyan: "#ebbcba",
      white: "#e0def4",
      brightBlack: "#6e6a86",
      brightRed: "#eb6f92",
      brightGreen: "#31748f",
      brightYellow: "#f6c177",
      brightBlue: "#9ccfd8",
      brightMagenta: "#c4a7e7",
      brightCyan: "#ebbcba",
      brightWhite: "#f0efff",
    },
  },
  {
    key: "light",
    label: "Light",
    ui: {
      bg: "#ffffff",
      bgHeader: "#f0f1f3",
      bgActive: "#e4e5e8",
      bgFooter: "#f0f1f3",
      divider: "#d4d5d9",
      fg: "#3b3f4a",
      fgDim: "#6b7080",
      fgMuted: "#9a9ea8",
      fgBright: "#1a1c22",
      fgButton: "#2070c0",
      dotOn: "#2a9d5c",
      dotOff: "#9a9ea8",
      dotLlm: "#8050c0",
      dotWeb: "#2080b0",
    },
    terminal: {
      background: "#ffffff",
      foreground: "#3b3f4a",
      cursor: "#2070c0",
      cursorAccent: "#ffffff",
      selectionBackground: "#2070c044",
      black: "#1a1c22",
      red: "#c02020",
      green: "#287830",
      yellow: "#956d00",
      blue: "#2070c0",
      magenta: "#8050c0",
      cyan: "#107090",
      white: "#d4d5d9",
      brightBlack: "#6b7080",
      brightRed: "#d03030",
      brightGreen: "#309840",
      brightYellow: "#a08000",
      brightBlue: "#3080d0",
      brightMagenta: "#9060d0",
      brightCyan: "#2080a0",
      brightWhite: "#ffffff",
    },
  },
];

export function getScheme(key: string): ColorScheme {
  return COLOR_SCHEMES.find((s) => s.key === key) ?? COLOR_SCHEMES[0];
}
