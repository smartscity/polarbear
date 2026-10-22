export const DIAGRAM_CONFIG = {
  cache: { entries: 32, codeUnits: 4_000_000 },
  export: {
    background: "#ffffff",
    fallbackHeight: 600,
    fallbackWidth: 800,
    maxDimension: 8192,
    maxPixels: 16_777_216,
    pngScale: 2
  },
  plantUml: {
    renderTimeoutMs: 15_000,
    serverUrl: "https://www.plantuml.com/plantuml/svg/"
  }
} as const;
