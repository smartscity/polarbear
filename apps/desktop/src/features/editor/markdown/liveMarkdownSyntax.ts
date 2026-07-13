export type CodeFenceInfo = {
  lineFrom: number;
  lineTo: number;
  markerTo: number;
  languageFrom: number;
  languageTo: number;
  language: string;
};

export function parseCodeFenceLine(
  lineFrom: number,
  lineTo: number,
  lineText: string,
): CodeFenceInfo | null {
  const match = /^(\s*)(`{3,}|~{3,})([^\s`]*)?/.exec(lineText);
  if (!match) {
    return null;
  }

  const markerTo = lineFrom + match[1].length + match[2].length;
  const language = match[3] ?? "";
  const languageFrom = markerTo;
  const languageTo = Math.min(lineTo, languageFrom + language.length);

  return {
    lineFrom,
    lineTo,
    markerTo,
    languageFrom,
    languageTo,
    language,
  };
}

export function isTableLine(lineText: string): boolean {
  return /^\s*\|.+\|\s*$/.test(lineText) || /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lineText);
}

export function isTableRowLine(lineText: string): boolean {
  return /^\s*\|.+\|\s*$/.test(lineText);
}

export function isTableSeparatorLine(lineText: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lineText);
}

export function isImageOnlyLine(lineText: string): boolean {
  return /^\s*!\[[^\]]*]\([^)]+\)\s*$/.test(lineText);
}

export function isHtmlImageOnlyLine(lineText: string): boolean {
  return /^\s*<img\b[^>]*>\s*$/i.test(lineText);
}

export function isFrontmatterDelimiter(lineText: string): boolean {
  return /^\s*---\s*$/.test(lineText);
}

export function isHorizontalRuleLine(lineText: string): boolean {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lineText);
}

export function isMathFenceLine(lineText: string): boolean {
  return /^\s*\$\$\s*$/.test(lineText);
}

export function isCalloutStartLine(lineText: string): boolean {
  return /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)]/i.test(lineText);
}

export function isRemoteOrDataImage(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || /^data:image\//i.test(src);
}

export function parseHtmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/\s([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name) {
      attributes[name] = value;
    }
  }
  return attributes;
}
