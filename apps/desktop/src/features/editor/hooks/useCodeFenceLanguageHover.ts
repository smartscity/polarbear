import { useEffect, type RefObject } from "react";

/** Keeps the compact code-language selector visible for the hovered fence. */
export function useCodeFenceLanguageHover(
  paneRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return undefined;
    }

    let activeLanguageWidget: HTMLElement | null = null;
    const setActiveLanguageWidget = (nextWidget: HTMLElement | null) => {
      if (activeLanguageWidget === nextWidget) {
        return;
      }

      activeLanguageWidget?.classList.remove("cm-typora-code-language-visible");
      activeLanguageWidget = nextWidget;
      activeLanguageWidget?.classList.add("cm-typora-code-language-visible");
    };
    const findLanguageWidgetForCodeLine = (line: Element): HTMLElement | null => {
      let sibling = line.previousElementSibling;

      while (sibling) {
        if (
          sibling instanceof HTMLElement &&
          sibling.classList.contains("cm-typora-code-language")
        ) {
          return sibling;
        }
        if (
          sibling.classList.contains("cm-line") &&
          sibling.classList.contains("cm-typora-code-line")
        ) {
          sibling = sibling.previousElementSibling;
          continue;
        }
        return null;
      }

      return null;
    };
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setActiveLanguageWidget(null);
        return;
      }

      const languageWidget = target.closest(".cm-typora-code-language");
      if (languageWidget instanceof HTMLElement) {
        setActiveLanguageWidget(languageWidget);
        return;
      }

      const codeLine = target.closest(".cm-line.cm-typora-code-line");
      setActiveLanguageWidget(
        codeLine ? findLanguageWidgetForCodeLine(codeLine) : null,
      );
    };
    const handlePointerLeave = () => setActiveLanguageWidget(null);

    pane.addEventListener("pointermove", handlePointerMove);
    pane.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      pane.removeEventListener("pointermove", handlePointerMove);
      pane.removeEventListener("pointerleave", handlePointerLeave);
      activeLanguageWidget?.classList.remove("cm-typora-code-language-visible");
    };
  }, [paneRef]);
}
