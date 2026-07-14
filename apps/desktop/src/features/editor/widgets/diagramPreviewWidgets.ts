import { WidgetType } from "@codemirror/view";
import {
  exportSvgElementAsPng,
  exportSvgElementAsSvg,
  findRenderedSvg,
} from "../../diagram/diagramExport";
import { renderMermaidSvg } from "../../diagram/mermaidRenderer";
import {
  renderPlantUmlSvg,
} from "../../diagram/plantUmlRenderer";
import { describePlantUmlRenderError } from "../../diagram/plantUmlRenderError";
import { translateCurrent } from "../../../shared/i18n/translate";
import { errorMessage } from "../../../shared/tauri/invokeTauri";
import {
  allowEditorVerticalScroll,
  markMarkdownPreviewBlock,
  revealMarkdownBlockSource,
  scheduleEditorMeasureFromDom,
} from "./markdownBlockDom";

export type DiagramPreviewBlock = {
  from: number;
  id: string;
  source: string;
  to: number;
  type: "mermaid" | "plantuml";
};

type DiagramRenderResult = {
  error?: string;
  svgContent?: string;
};

const mermaidRenderCache = new Map<string, DiagramRenderResult>();
const plantUmlRenderCache = new Map<string, DiagramRenderResult>();

export class MermaidPreviewWidget extends WidgetType {
  constructor(private readonly block: DiagramPreviewBlock) {
    super();
  }

  eq(other: MermaidPreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.source === this.block.source;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-diagram-preview";
    markMarkdownPreviewBlock(wrapper, this.block, "mermaid-block");
    allowEditorVerticalScroll(wrapper);

    const toolbar = document.createElement("div");
    toolbar.className = "cm-typora-diagram-toolbar";

    const title = document.createElement("span");
    title.className = "cm-typora-diagram-title";
    title.textContent = translateCurrent("diagram.mermaid");
    const actionStatus = document.createElement("output");
    actionStatus.className = "cm-typora-diagram-action-status";
    actionStatus.setAttribute("aria-live", "polite");

    const editButton = createDiagramIconButton(
      translateCurrent("diagram.editSource"),
      "M4 14.25V17h2.75L15.1 8.65l-2.75-2.75L4 14.25Zm12.35-8.85a.95.95 0 0 0 0-1.35l-1.4-1.4a.95.95 0 0 0-1.35 0l-1.1 1.1 2.75 2.75 1.1-1.1Z",
    );
    editButton.addEventListener("click", () => revealMarkdownBlockSource(wrapper, this.block.from));

    const pngButton = createDiagramIconButton(
      translateCurrent("diagram.exportPng"),
      "M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11ZM7.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5.5 14.5l2.8-3.5a.75.75 0 0 1 1.15-.03L11 12.75l1.8-2.25a.75.75 0 0 1 1.17.02L15.5 13v1.5h-10Z",
    );
    pngButton.addEventListener("click", () => {
      void exportDiagramAsPng(content, this.block.id, actionStatus);
    });
    const svgButton = createDiagramIconButton(
      translateCurrent("diagram.exportSvg"),
      "M5 3.5h10A1.5 1.5 0 0 1 16.5 5v10A1.5 1.5 0 0 1 15 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5Zm2 4.25h6V9H7V7.75Zm0 3h6V12H7v-1.25Zm0 3h4V15H7v-1.25Z",
    );
    svgButton.addEventListener("click", () => {
      void exportDiagramAsSvg(content, this.block.id, actionStatus);
    });
    const copyButton = createDiagramIconButton(
      translateCurrent("diagram.copySource"),
      "M6 5.5A1.5 1.5 0 0 1 7.5 4h7A1.5 1.5 0 0 1 16 5.5v7A1.5 1.5 0 0 1 14.5 14h-7A1.5 1.5 0 0 1 6 12.5v-7ZM3 8.5A1.5 1.5 0 0 1 4.5 7H5v5.5A2.5 2.5 0 0 0 7.5 15H13v.5A1.5 1.5 0 0 1 11.5 17h-7A1.5 1.5 0 0 1 3 15.5v-7Z",
    );
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.block.source).then(
        () => showDiagramActionStatus(actionStatus, translateCurrent("common.copied")),
        (error: unknown) => showDiagramActionStatus(actionStatus, errorMessage(error)),
      );
    });

    toolbar.append(title, actionStatus, editButton, pngButton, svgButton, copyButton);

    const content = document.createElement("div");
    content.className = "cm-typora-diagram-content";
    content.textContent = translateCurrent("diagram.renderingMermaid");

    wrapper.append(toolbar, content);
    scheduleEditorMeasureFromDom(wrapper);
    void renderMermaidPreview(this.block.source, content);

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class PlantUmlPreviewWidget extends WidgetType {
  constructor(private readonly block: DiagramPreviewBlock) {
    super();
  }

  eq(other: PlantUmlPreviewWidget): boolean {
    return other.block.id === this.block.id && other.block.source === this.block.source;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-typora-diagram-preview cm-typora-plantuml-preview";
    markMarkdownPreviewBlock(wrapper, this.block, "plantuml-block");
    allowEditorVerticalScroll(wrapper);

    const toolbar = document.createElement("div");
    toolbar.className = "cm-typora-diagram-toolbar";

    const title = document.createElement("span");
    title.className = "cm-typora-diagram-title";
    title.textContent = translateCurrent("diagram.plantUml");
    const actionStatus = document.createElement("output");
    actionStatus.className = "cm-typora-diagram-action-status";
    actionStatus.setAttribute("aria-live", "polite");

    const editButton = createDiagramIconButton(
      translateCurrent("diagram.editSource"),
      "M4 14.25V17h2.75L15.1 8.65l-2.75-2.75L4 14.25Zm12.35-8.85a.95.95 0 0 0 0-1.35l-1.4-1.4a.95.95 0 0 0-1.35 0l-1.1 1.1 2.75 2.75 1.1-1.1Z",
    );
    editButton.addEventListener("click", () => revealMarkdownBlockSource(wrapper, this.block.from));

    const pngButton = createDiagramIconButton(
      translateCurrent("diagram.exportPng"),
      "M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11ZM7.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5.5 14.5l2.8-3.5a.75.75 0 0 1 1.15-.03L11 12.75l1.8-2.25a.75.75 0 0 1 1.17.02L15.5 13v1.5h-10Z",
    );
    pngButton.addEventListener("click", () => {
      void exportDiagramAsPng(content, this.block.id, actionStatus);
    });
    const svgButton = createDiagramIconButton(
      translateCurrent("diagram.exportSvg"),
      "M5 3.5h10A1.5 1.5 0 0 1 16.5 5v10A1.5 1.5 0 0 1 15 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5Zm2 4.25h6V9H7V7.75Zm0 3h6V12H7v-1.25Zm0 3h4V15H7v-1.25Z",
    );
    svgButton.addEventListener("click", () => {
      void exportDiagramAsSvg(content, this.block.id, actionStatus);
    });
    const copyButton = createDiagramIconButton(
      translateCurrent("diagram.copySource"),
      "M6 5.5A1.5 1.5 0 0 1 7.5 4h7A1.5 1.5 0 0 1 16 5.5v7A1.5 1.5 0 0 1 14.5 14h-7A1.5 1.5 0 0 1 6 12.5v-7ZM3 8.5A1.5 1.5 0 0 1 4.5 7H5v5.5A2.5 2.5 0 0 0 7.5 15H13v.5A1.5 1.5 0 0 1 11.5 17h-7A1.5 1.5 0 0 1 3 15.5v-7Z",
    );
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.block.source).then(
        () => showDiagramActionStatus(actionStatus, translateCurrent("common.copied")),
        (error: unknown) => showDiagramActionStatus(actionStatus, errorMessage(error)),
      );
    });

    toolbar.append(title, actionStatus, editButton, pngButton, svgButton, copyButton);

    const content = document.createElement("div");
    content.className = "cm-typora-diagram-content";

    const consent = document.createElement("div");
    consent.className = "plantuml-remote-consent";
    const consentText = document.createElement("span");
    consentText.textContent = translateCurrent("diagram.plantUmlRemoteDisabled");
    const renderButton = document.createElement("button");
    renderButton.type = "button";
    renderButton.textContent = translateCurrent("diagram.plantUmlRenderRemotely");
    renderButton.addEventListener("click", () => {
      consent.remove();
      content.textContent = translateCurrent("diagram.renderingPlantUml");
      void renderPlantUmlPreview(this.block.source, content);
    });
    consent.append(consentText, renderButton);
    content.append(consent);

    const privacyNote = document.createElement("p");
    privacyNote.textContent = translateCurrent("diagram.plantUmlPrivacy");

    wrapper.append(toolbar, content, privacyNote);
    scheduleEditorMeasureFromDom(wrapper);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function createDiagramIconButton(label: string, pathData: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-typora-diagram-icon-button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 20 20"><path d="${pathData}"/></svg>`;
  return button;
}

async function exportDiagramAsSvg(
  contentElement: HTMLElement,
  diagramId: string,
  actionStatus: HTMLOutputElement,
): Promise<void> {
  const svg = findRenderedSvg(contentElement);
  if (!svg) {
    showDiagramActionStatus(actionStatus, translateCurrent("diagram.exportUnavailable"));
    return;
  }

  try {
    await exportSvgElementAsSvg(svg, diagramId);
  } catch (error) {
    showDiagramActionStatus(
      actionStatus,
      translateCurrent("diagram.exportFailed", { error: errorMessage(error) }),
    );
  }
}

async function exportDiagramAsPng(
  contentElement: HTMLElement,
  diagramId: string,
  actionStatus: HTMLOutputElement,
): Promise<void> {
  const svg = findRenderedSvg(contentElement);
  if (!svg) {
    showDiagramActionStatus(actionStatus, translateCurrent("diagram.exportUnavailable"));
    return;
  }

  try {
    await exportSvgElementAsPng(svg, diagramId);
  } catch (error) {
    showDiagramActionStatus(
      actionStatus,
      translateCurrent("diagram.exportFailed", { error: errorMessage(error) }),
    );
  }
}

function showDiagramActionStatus(actionStatus: HTMLOutputElement, message: string): void {
  const pendingTimer = Number(actionStatus.dataset.dismissTimer ?? "0");
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
  }

  actionStatus.textContent = message;
  const timer = window.setTimeout(() => {
    actionStatus.textContent = "";
    delete actionStatus.dataset.dismissTimer;
  }, 4_000);
  actionStatus.dataset.dismissTimer = String(timer);
}

async function renderPlantUmlPreview(source: string, content: HTMLElement): Promise<void> {
  const cachedResult = plantUmlRenderCache.get(source);
  if (cachedResult?.svgContent) {
    content.innerHTML = cachedResult.svgContent;
    scheduleEditorMeasureFromDom(content);
    return;
  }

  if (cachedResult?.error) {
    content.textContent = cachedResult.error;
    content.classList.add("cm-typora-diagram-error");
    scheduleEditorMeasureFromDom(content);
    return;
  }

  try {
    const svgContent = await renderPlantUmlSvg(source);

    plantUmlRenderCache.set(source, { svgContent });
    content.innerHTML = svgContent;
    scheduleEditorMeasureFromDom(content);
  } catch (error) {
    const message = describePlantUmlRenderError(error, translateCurrent);
    plantUmlRenderCache.set(source, { error: message });
    content.classList.add("cm-typora-diagram-error");
    content.textContent = message;
    scheduleEditorMeasureFromDom(content);
  }
}

async function renderMermaidPreview(source: string, content: HTMLElement): Promise<void> {
  const cachedResult = mermaidRenderCache.get(source);
  if (cachedResult?.svgContent) {
    content.innerHTML = cachedResult.svgContent;
    scheduleEditorMeasureFromDom(content);
    return;
  }

  if (cachedResult?.error) {
    content.textContent = cachedResult.error;
    content.classList.add("cm-typora-diagram-error");
    scheduleEditorMeasureFromDom(content);
    return;
  }

  try {
    const svgContent = await renderMermaidSvg(diagramIdForSource(source), source);
    mermaidRenderCache.set(source, { svgContent });
    content.innerHTML = svgContent;
    scheduleEditorMeasureFromDom(content);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : translateCurrent("diagram.mermaidRenderError", { error: String(error) });
    mermaidRenderCache.set(source, { error: message });
    content.classList.add("cm-typora-diagram-error");
    content.textContent = message;
    scheduleEditorMeasureFromDom(content);
  }
}

function diagramIdForSource(source: string): string {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `polarbear-live-mermaid-${hash}`;
}
