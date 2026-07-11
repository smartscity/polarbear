import DOMPurify from "dompurify";

export function sanitizeDiagramSvg(svgContent: string): string {
  return DOMPurify.sanitize(svgContent, {
    ADD_ATTR: [
      "dominant-baseline",
      "preserveAspectRatio",
      "text-anchor",
      "viewBox",
      "xmlns",
      "xmlns:xlink",
    ],
    // Mermaid uses sanitized XHTML labels inside foreignObject for flowchart,
    // state, and ER diagrams. Removing the wrapper makes every label vanish.
    ADD_TAGS: ["foreignObject", "foreignobject"],
    FORBID_TAGS: ["embed", "iframe", "object", "script"],
    HTML_INTEGRATION_POINTS: {
      foreignobject: true,
    },
    USE_PROFILES: {
      html: true,
      svg: true,
      svgFilters: true
    },
  });
}
