import { WidgetType } from "@codemirror/view";
import { translateCurrent } from "../../../shared/i18n/translate";
import { errorMessage } from "../../../shared/tauri/invokeTauri";
import { resolveMarkdownAsset } from "../../workspace/tauriWorkspaceAdapter";
import { allowEditorVerticalScroll, markMarkdownPreviewBlock, revealMarkdownBlockSource, scheduleEditorMeasureFromDom } from "../widgets/markdownBlockDom";
import { renderMathText } from "../markdown/mathText";
import { isRemoteOrDataImage, parseHtmlAttributes } from "../markdown/liveMarkdownSyntax";
import type { PreviewBlock } from "../markdown/previewBlocks";

export class HorizontalRuleWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: HorizontalRuleWidget): boolean {
    return other.block.id === this.block.id;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-horizontal-rule";
    markMarkdownPreviewBlock(wrapper, this.block);
    const rule = document.createElement("hr");
    wrapper.append(rule);
    return wrapper;
  }
}

export class MathBlockPreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: MathBlockPreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.source === this.block.source;
  }

  get estimatedHeight(): number {
    const lineCount = Math.max(1, this.block.source.split(/\r?\n/).length);
    if (/\\begin\{cases\}/.test(this.block.source)) {
      return Math.max(132, lineCount * 28);
    }
    return Math.max(76, lineCount * 28);
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-math-block";
    markMarkdownPreviewBlock(wrapper, this.block, "markdown-math-block");
    wrapper.title = translateCurrent("diagram.formulaEditHint");
    wrapper.addEventListener("click", () => revealMarkdownBlockSource(wrapper, this.block.from));
    wrapper.addEventListener("dblclick", () => revealMarkdownBlockSource(wrapper, this.block.from));
    renderMathBlockDom(wrapper, this.block.source);
    allowEditorVerticalScroll(wrapper);
    scheduleEditorMeasureFromDom(wrapper);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function renderMathBlockDom(wrapper: HTMLElement, source: string) {
  const normalized = source.trim();
  const casesMatch = /([\s\S]*?)=\s*\\begin\{cases\}([\s\S]*?)\\end\{cases\}/.exec(normalized);

  if (casesMatch) {
    const formula = document.createElement("div");
    formula.className = "cm-typora-math-cases";

    const left = document.createElement("span");
    left.className = "cm-typora-math-left";
    left.textContent = `${renderMathText(casesMatch[1].trim())} =`;

    const brace = document.createElement("span");
    brace.className = "cm-typora-math-brace";
    brace.textContent = "{";

    const rows = document.createElement("span");
    rows.className = "cm-typora-math-case-rows";
    casesMatch[2]
      .split(/\\\\/)
      .map((row) => row.trim())
      .filter(Boolean)
      .forEach((row) => {
        const [value = "", condition = ""] = row.split("&");
        const rowElement = document.createElement("span");
        rowElement.className = "cm-typora-math-case-row";

        const valueElement = document.createElement("span");
        valueElement.className = "cm-typora-math-case-value";
        valueElement.textContent = renderMathText(value.replace(/,\s*$/, "").trim());

        const conditionElement = document.createElement("span");
        conditionElement.className = "cm-typora-math-case-condition";
        conditionElement.textContent = renderMathText(condition.trim());

        rowElement.append(valueElement, conditionElement);
        rows.append(rowElement);
      });

    formula.append(left, brace, rows);
    wrapper.append(formula);
    return;
  }

  const formula = document.createElement("div");
  formula.className = "cm-typora-math-equation";
  formula.textContent = renderMathText(normalized);
  wrapper.append(formula);
}

export class CalloutPreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: CalloutPreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.raw === this.block.raw;
  }

  toDOM(): HTMLElement {
    const lines = this.block.raw.split(/\r?\n/).map((line) =>
      line.replace(/^\s*>\s?/, ""),
    );
    const firstLine = lines[0] ?? "";
    const typeMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)]\s*(.*)$/i.exec(firstLine);
    const type = (typeMatch?.[1] ?? "NOTE").toLowerCase();
    const titleText = typeMatch?.[2]?.trim() || type.toUpperCase();
    const bodyLines = [titleText, ...lines.slice(1)].filter((line, index) =>
      index === 0 || line.trim().length > 0,
    );

    const wrapper = document.createElement("aside");
    wrapper.className = `cm-typora-callout cm-typora-callout-${type}`;
    markMarkdownPreviewBlock(wrapper, this.block, "markdown-callout-block");
    const title = document.createElement("div");
    title.className = "cm-typora-callout-title";
    title.textContent = titleText;
    const body = document.createElement("div");
    body.className = "cm-typora-callout-body";
    bodyLines.slice(1).forEach((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      body.append(paragraph);
    });
    wrapper.append(title, body);
    allowEditorVerticalScroll(wrapper);
    scheduleEditorMeasureFromDom(wrapper);
    return wrapper;
  }
}

export class HtmlImagePreviewWidget extends WidgetType {
  constructor(private readonly block: PreviewBlock) {
    super();
  }

  eq(other: HtmlImagePreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.raw === this.block.raw;
  }

  toDOM(): HTMLElement {
    const attributes = parseHtmlAttributes(this.block.raw);
    const figure = document.createElement("figure");
    figure.className = "cm-typora-image-preview cm-typora-html-image-preview";
    markMarkdownPreviewBlock(figure, this.block, "markdown-image-block");
    allowEditorVerticalScroll(figure);

    const src = attributes.src ?? "";
    if (!src) {
      figure.classList.add("cm-typora-image-error");
      const caption = document.createElement("figcaption");
      caption.textContent = translateCurrent("diagram.imageSourceMissing");
      figure.append(caption);
      return figure;
    }

    const image = document.createElement("img");
    image.src = src;
    image.alt = attributes.alt ?? "";
    if (attributes.width) {
      image.style.width = /^\d+$/.test(attributes.width)
        ? `${attributes.width}px`
        : attributes.width;
    }
    if (attributes.height) {
      image.style.height = /^\d+$/.test(attributes.height)
        ? `${attributes.height}px`
        : attributes.height;
    }
    figure.append(image);
    if (attributes.alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = attributes.alt;
      figure.append(caption);
    }
    scheduleEditorMeasureFromDom(figure);
    return figure;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class HiddenCodeFenceWidget extends WidgetType {
  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-typora-code-fence-closing-hidden";
    return element;
  }
}

export class MarkdownImagePreviewWidget extends WidgetType {
  constructor(
    private readonly params: {
      activeFileId: string;
      alt: string;
      blockId: string;
      from: number;
      src: string;
      to: number;
      workspaceRoot: string;
    },
  ) {
    super();
  }

  eq(other: MarkdownImagePreviewWidget): boolean {
    return (
      other.params.src === this.params.src &&
      other.params.alt === this.params.alt &&
      other.params.activeFileId === this.params.activeFileId &&
      other.params.blockId === this.params.blockId &&
      other.params.from === this.params.from &&
      other.params.to === this.params.to &&
      other.params.workspaceRoot === this.params.workspaceRoot
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("figure");
    wrapper.className = "cm-typora-image-preview";
    wrapper.dataset.markdownBlockId = this.params.blockId;
    wrapper.dataset.markdownBlockType = "image";
    wrapper.classList.add("markdown-image-block");
    wrapper.title = translateCurrent("diagram.imageEditHint");
    allowEditorVerticalScroll(wrapper);
    wrapper.addEventListener("mousedown", (event) => {
      event.preventDefault();
      revealMarkdownBlockSource(wrapper, this.params.from);
    });

    const image = document.createElement("img");
    image.alt = this.params.alt || translateCurrent("diagram.imageAlt");
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("load", () => scheduleEditorMeasureFromDom(wrapper));
    image.addEventListener("error", () => scheduleEditorMeasureFromDom(wrapper));

    const caption = document.createElement("figcaption");
    caption.textContent = this.params.src;

    wrapper.append(image, caption);

    if (isRemoteOrDataImage(this.params.src)) {
      image.src = this.params.src;
      scheduleEditorMeasureFromDom(wrapper);
      return wrapper;
    }

    if (!this.params.workspaceRoot || !this.params.activeFileId) {
      wrapper.classList.add("cm-typora-image-error");
      caption.textContent = translateCurrent("diagram.imageNeedsSavedFile", {
        source: this.params.src,
      });
      scheduleEditorMeasureFromDom(wrapper);
      return wrapper;
    }

    void resolveMarkdownAsset({
      workspaceRef: this.params.workspaceRoot,
      markdownRelativePath: this.params.activeFileId,
      assetSrc: this.params.src,
    })
      .then((asset) => {
        if (!asset.exists || !asset.assetUrl) {
          wrapper.classList.add("cm-typora-image-error");
          caption.textContent = asset.error || translateCurrent("diagram.imageNotFound", {
            source: this.params.src,
          });
          scheduleEditorMeasureFromDom(wrapper);
          return;
        }

        image.src = asset.assetUrl;
        caption.textContent = this.params.alt || this.params.src;
        scheduleEditorMeasureFromDom(wrapper);
      })
      .catch((error: unknown) => {
        wrapper.classList.add("cm-typora-image-error");
        caption.textContent = errorMessage(error);
        scheduleEditorMeasureFromDom(wrapper);
      });

    scheduleEditorMeasureFromDom(wrapper);
    return wrapper;
  }
}
