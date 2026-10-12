/** Resolve only paths inside an imported document collection. */
export function resolveDocumentPath(documentPath: string, reference: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(reference.split(/[?#]/)[0]); } catch { return null; }
  if (!decoded || /^[a-z][a-z\d+.-]*:/i.test(decoded) || /^[\\/]/.test(decoded)
    || /[\u0000-\u001f\\]/.test(decoded)) return null;
  const parts = documentPath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/") || null;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
