import { useEffect, useState, type RefObject } from "react";
import { selectionInArticle, type ReadingSelection } from "./readingModel";

export function useReadingSelection(article: RefObject<HTMLElement | null>, title: string) {
  const [selection, setSelection] = useState<ReadingSelection | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.activeElement?.closest(".reading-assistant, .reader-sheet")) return;
        const next = article.current ? selectionInArticle(article.current, title) : null;
        setSelection((previous) => next?.text === previous?.text && next?.sentence === previous?.sentence ? previous : next);
      }, 250);
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest(".reading-assistant, .reader-sheet")) return;
      if (!article.current?.contains(event.target)) setSelection(null);
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("pointerdown", outside);
    return () => { clearTimeout(timer); document.removeEventListener("selectionchange", update); document.removeEventListener("pointerdown", outside); };
  }, [article, title]);
  return { selection, setSelection };
}
