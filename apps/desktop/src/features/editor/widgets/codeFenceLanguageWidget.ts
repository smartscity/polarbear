import { EditorView, WidgetType } from "@codemirror/view";
import { translateCurrent } from "../../../shared/i18n/translate";
import {
  parseCodeFenceLine,
  type CodeFenceInfo,
} from "../markdown/liveMarkdownSyntax";

const SUPPORTED_CODE_LANGUAGES = [
  "text",
  "markdown",
  "json",
  "java",
  "yaml",
  "typescript",
  "tsx",
  "javascript",
  "sql",
  "rust",
  "bash",
  "shell",
  "xml",
  "html",
  "css",
  "python",
  "go",
  "kotlin",
  "properties",
  "mermaid",
  "plantuml",
] as const;

/** A CodeMirror widget for changing only a fenced block's language marker. */
export class CodeFenceLanguageWidget extends WidgetType {
  constructor(private readonly fenceInfo: CodeFenceInfo) {
    super();
  }

  eq(other: CodeFenceLanguageWidget): boolean {
    return (
      other.fenceInfo.lineFrom === this.fenceInfo.lineFrom &&
      other.fenceInfo.language === this.fenceInfo.language
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-code-language";

    const listId = `polarbear-code-languages-${this.fenceInfo.lineFrom}`;
    const input = document.createElement("input");
    input.className = "cm-typora-code-language-input";
    input.setAttribute("aria-label", translateCurrent("editor.codeBlockLanguage"));
    input.setAttribute("list", listId);
    input.spellcheck = false;
    input.value = this.fenceInfo.language || "text";

    const dataList = document.createElement("datalist");
    dataList.id = listId;
    for (const language of SUPPORTED_CODE_LANGUAGES) {
      const option = document.createElement("option");
      option.value = language;
      dataList.append(option);
    }

    const commitLanguage = () => {
      const view = EditorView.findFromDOM(wrapper);
      if (!view) {
        return;
      }

      const rawLanguage = input.value.trim();
      const nextLanguage = rawLanguage === "text" ? "" : rawLanguage;
      const currentLine = view.state.doc.lineAt(this.fenceInfo.lineFrom);
      const currentFence = parseCodeFenceLine(
        currentLine.from,
        currentLine.to,
        currentLine.text,
      );
      if (!currentFence || currentFence.language === nextLanguage) {
        return;
      }

      const scrollDOM = view.scrollDOM;
      const scrollTop = scrollDOM.scrollTop;
      const scrollLeft = scrollDOM.scrollLeft;
      const restoreScroll = () => {
        scrollDOM.scrollTop = scrollTop;
        scrollDOM.scrollLeft = scrollLeft;
      };
      const marker = view.state.sliceDoc(
        currentFence.lineFrom,
        currentFence.markerTo,
      );
      view.dispatch({
        changes: {
          from: currentFence.lineFrom,
          to: currentFence.lineTo,
          insert: `${marker}${nextLanguage}`,
        },
        scrollIntoView: false,
      });
      restoreScroll();
      window.requestAnimationFrame(() => {
        view.focus();
        restoreScroll();
        window.requestAnimationFrame(restoreScroll);
      });
    };

    wrapper.addEventListener("mousedown", (event) => event.stopPropagation());
    wrapper.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", commitLanguage);
    input.addEventListener("blur", commitLanguage);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitLanguage();
        input.blur();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        input.value = this.fenceInfo.language || "text";
        input.blur();
      }
    });

    wrapper.append(input, dataList);
    return wrapper;
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof HTMLElement && Boolean(
      target.closest("input, button, select, .cm-typora-code-language"),
    );
  }
}
