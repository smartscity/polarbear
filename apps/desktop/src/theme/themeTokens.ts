export type ThemeName = "light" | "dark";

export type ThemeTokens = {
  name: ThemeName;
  colors: {
    appBackground: string;
    editorBackground: string;
    sidebarBackground: string;
    previewBackground: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    divider: string;
    selectionBackground: string;
    hoverBackground: string;
    activeBackground: string;
    accent: string;
    accentText: string;
    codeBackground: string;
    codeText: string;
    tableBorder: string;
    tableHeaderBackground: string;
    blockquoteBorder: string;
    blockquoteText: string;
    danger: string;
    warning: string;
    success: string;
  };
  typography: {
    editorFontFamily: string;
    previewFontFamily: string;
    codeFontFamily: string;
    baseFontSize: string;
    lineHeight: string;
  };
  radius: {
    small: string;
    medium: string;
    large: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
  };
};

const sharedTypography = {
  editorFontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
  previewFontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  codeFontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
  baseFontSize: "14px",
  lineHeight: "1.72"
};

const sharedRadius = {
  small: "5px",
  medium: "8px",
  large: "10px"
};

const sharedSpacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "18px"
};

export const themeTokens: Record<ThemeName, ThemeTokens> = {
  light: {
    name: "light",
    colors: {
      appBackground: "#ffffff",
      editorBackground: "#ffffff",
      sidebarBackground: "#f7f7f7",
      previewBackground: "#ffffff",
      textPrimary: "#2f3437",
      textSecondary: "#5f666d",
      textMuted: "#8a8f98",
      border: "#e5e7eb",
      divider: "#eceff3",
      selectionBackground: "#dbeafe",
      hoverBackground: "#f0f2f5",
      activeBackground: "#eaeaea",
      accent: "#2f80ed",
      accentText: "#ffffff",
      codeBackground: "#f6f8fa",
      codeText: "#24292f",
      tableBorder: "#d8dee4",
      tableHeaderBackground: "#f6f8fa",
      blockquoteBorder: "#d0d7de",
      blockquoteText: "#57606a",
      danger: "#d1242f",
      warning: "#9a6700",
      success: "#1a7f37"
    },
    typography: sharedTypography,
    radius: sharedRadius,
    spacing: sharedSpacing
  },
  dark: {
    name: "dark",
    colors: {
      appBackground: "#0f1115",
      editorBackground: "#151922",
      sidebarBackground: "#11141a",
      previewBackground: "#151922",
      textPrimary: "#e6e8ee",
      textSecondary: "#aeb4c0",
      textMuted: "#7d8594",
      border: "#2a3040",
      divider: "#202634",
      selectionBackground: "#1f4f7a",
      hoverBackground: "#1a202b",
      activeBackground: "#1d2633",
      accent: "#5aa9ff",
      accentText: "#06111f",
      codeBackground: "#10141c",
      codeText: "#dbeafe",
      tableBorder: "#2f3747",
      tableHeaderBackground: "#1a202b",
      blockquoteBorder: "#5aa9ff",
      blockquoteText: "#aeb4c0",
      danger: "#fb7185",
      warning: "#fbbf24",
      success: "#4ade80"
    },
    typography: sharedTypography,
    radius: sharedRadius,
    spacing: sharedSpacing
  }
};

export function applyThemeTokens(themeName: ThemeName): void {
  const theme = themeTokens[themeName];
  const root = document.documentElement;

  root.dataset.theme = theme.name;
  for (const [name, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--color-${toKebabCase(name)}`, value);
  }

  for (const [name, value] of Object.entries(theme.typography)) {
    root.style.setProperty(`--type-${toKebabCase(name)}`, value);
  }

  for (const [name, value] of Object.entries(theme.radius)) {
    root.style.setProperty(`--radius-${toKebabCase(name)}`, value);
  }

  for (const [name, value] of Object.entries(theme.spacing)) {
    root.style.setProperty(`--space-${toKebabCase(name)}`, value);
  }
}

export function readStoredTheme(): ThemeName {
  const storedTheme = window.localStorage.getItem("polarbear.theme");
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
}

export function storeTheme(themeName: ThemeName): void {
  window.localStorage.setItem("polarbear.theme", themeName);
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
