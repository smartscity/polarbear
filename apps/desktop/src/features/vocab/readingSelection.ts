export const MAX_TERM_LENGTH = 80;
export const MAX_SENTENCE_LENGTH = 2000;

export function normalizeReadingSelection(text: string): string | null {
  const selection = text.trim();
  if (!selection || selection.length > MAX_SENTENCE_LENGTH || !/[a-z]/iu.test(selection)
    || Array.from(selection).some((char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)))) return null;
  return selection;
}

export function normalizeReadingTerm(text: string): string | null {
  const term = text.trim().replace(/\s+/gu, " ");
  if (!term || term.length > MAX_TERM_LENGTH || !/[a-z]/iu.test(term)
    || !/^[a-z\s'’-]+$/iu.test(term)) return null;
  return term;
}

export function readingContext(text: string, from: number, to: number) {
  const start = Math.max(0, Math.min(from, text.length));
  const end = Math.max(start, Math.min(to, text.length));
  const preceding = text.slice(Math.max(0, start - MAX_SENTENCE_LENGTH), start);
  const following = text.slice(end, end + MAX_SENTENCE_LENGTH);
  const left = Math.max(preceding.lastIndexOf("\n"), preceding.search(/[.!?][^.!?]*$/u));
  const right = following.search(/[.!?\n]/u);
  const sentence = (preceding.slice(left + 1) + text.slice(start, end)
    + following.slice(0, right < 0 ? following.length : right + 1)).trim().slice(0, MAX_SENTENCE_LENGTH);
  const headings = [...text.slice(0, start).matchAll(/^#{1,6}\s+(.+)$/gmu)];
  return {
    sentence,
    heading: (headings.at(-1)?.[1] ?? "").slice(0, 300),
    line: text.slice(0, start).split("\n").length,
  };
}
