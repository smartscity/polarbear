export const READING_LIMITS = { text: 2000, term: 80, title: 300, captures: 100 } as const;

export interface ReadingSelection { text: string; sentence: string; title: string; heading: string; dock?: "top" | "bottom" }
export interface ReadingCapture {
  requestId: string; selectedText: string; senseUid: null; sentence: string;
  title: string; heading: string; filePath: null; line: null;
}
export interface ReadingTransfer { schemaVersion: 1; captures: ReadingCapture[] }

export function readingText(value: string): string | null {
  const text = value.trim();
  return text.length > 0 && text.length <= READING_LIMITS.text && /[a-z]/i.test(text)
    && !Array.from(text).some((char) => char.charCodeAt(0) < 32 && !"\t\n\r".includes(char)) ? text : null;
}

export function readingTerm(value: string): string | null {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= READING_LIMITS.term && /^[a-z][a-z '\u2019-]*$/i.test(text) ? text : null;
}

export function captureSelection(selection: ReadingSelection, term: string, includeSource: boolean): ReadingCapture {
  const selectedText = readingTerm(term);
  if (!selectedText) throw new Error("invalidTerm");
  return {
    requestId: crypto.randomUUID(), selectedText, senseUid: null, filePath: null, line: null,
    sentence: includeSource ? selection.sentence.slice(0, READING_LIMITS.text) : "",
    title: includeSource ? selection.title.slice(0, READING_LIMITS.title) : "",
    heading: includeSource ? selection.heading.slice(0, READING_LIMITS.title) : "",
  };
}

export function selectionInArticle(article: HTMLElement, title: string): ReadingSelection | null {
  const selection = article.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !article.contains(selection.anchorNode) || !article.contains(selection.focusNode)) return null;
  const text = readingText(selection.toString());
  if (!text) return null;
  const node = selection.getRangeAt(0).startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const paragraph = element?.closest("p,li,td,th,blockquote");
  const headings = Array.from(article.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  const heading = headings.filter((h) => h.contains(node) || !!(h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const dock = rect.bottom > window.innerHeight * 0.6 ? "top" : "bottom";
  return { text, sentence: (paragraph?.textContent ?? text).trim().slice(0, READING_LIMITS.text), title, heading: heading?.textContent ?? "", dock };
}
