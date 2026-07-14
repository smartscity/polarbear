export const DIAGRAM_CONFIG = {
  export: {
    background: "#ffffff",
    fallbackHeight: 600,
    fallbackWidth: 800,
    pngScale: 2
  },
  plantUml: {
    renderTimeoutMs: 15_000,
    serverUrl: "https://www.plantuml.com/plantuml/svg/"
  }
} as const;
