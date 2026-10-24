import { EditorState, Prec, StateField, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";
import type { KeybindingOverrides } from "../../shared/settings/userSettings";
import { platformNavigationKeyBindings } from "./components/platformNavigationKeymap";
import { executeMarkdownFormatCommand } from "./editorCommandAdapter";
import { createEditorCommandBindings } from "./editorCommandKeymap";
import { completeFenceBlockOnEnter, exitFenceBlock } from "./markdown/codeFenceCommands";
import { findClosingFenceLine } from "./markdown/codeFenceState";
import { isFrontmatterDelimiter, isTableLine, parseCodeFenceLine } from "./markdown/liveMarkdownSyntax";
import { InlineMathWidget, ListMarkerWidget, TaskListMarkerWidget } from "./widgets/inlineMarkdownWidgets";
import { MermaidPreviewWidget, PlantUmlPreviewWidget, type DiagramPreviewBlock } from "./widgets/diagramPreviewWidgets";
import { CodeFenceLanguageWidget } from "./widgets/codeFenceLanguageWidget";
import { collectPreviewBlocks, findFrontmatterClosingLine, type PreviewBlock } from "./markdown/previewBlocks";
import { TablePreviewWidget } from "./table/tablePreviewWidget";
import { HorizontalRuleWidget, MathBlockPreviewWidget, CalloutPreviewWidget, HtmlImagePreviewWidget, HiddenCodeFenceWidget, MarkdownImagePreviewWidget } from "./widgets/blockPreviewWidgets";

type TyporaDecorationRange = Range<Decoration>;

const headingLineDecorations = Array.from({ length: 6 }, (_, index) =>
  Decoration.line({
    attributes: {
      class: `cm-typora-heading-line cm-typora-heading-${index + 1}`,
    },
  }),
);

const hiddenMarkdownMarkerDecoration = Decoration.replace({});

const boldDecoration = Decoration.mark({
  class: "cm-typora-bold",
});

const italicDecoration = Decoration.mark({
  class: "cm-typora-italic",
});

const underlineDecoration = Decoration.mark({
  class: "cm-typora-underline",
});

const strikeDecoration = Decoration.mark({
  class: "cm-typora-strike",
});

const inlineCodeDecoration = Decoration.mark({
  class: "cm-typora-inline-code",
});

const markDecoration = Decoration.mark({
  class: "cm-typora-mark",
});

const linkDecoration = Decoration.mark({
  class: "cm-typora-link",
});

const kbdDecoration = Decoration.mark({
  class: "cm-typora-kbd",
});

const frontmatterLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-frontmatter-line",
  },
});

const frontmatterDelimiterLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-frontmatter-line cm-typora-frontmatter-delimiter-line",
  },
});

const blockquoteLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-blockquote-line",
  },
});

const unorderedListLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-list-line cm-typora-unordered-list-line",
  },
});

const orderedListLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-list-line cm-typora-ordered-list-line",
  },
});

const taskListLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-list-line cm-typora-task-list-line",
  },
});

const tableLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-table-line",
  },
});

const collapsedMarkdownMarkerDecoration = Decoration.mark({
  class: "cm-typora-markdown-marker-hidden",
});

const collapsedHeadingMarkerDecoration = Decoration.replace({});

const hiddenCodeFenceLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-code-fence-line-hidden",
  },
});

const imageLineDecoration = Decoration.line({
  attributes: {
    class: "cm-typora-image-line",
  },
});

type CodeLineEdge = "first" | "last" | "middle" | "single";

const codeLineDecorationCache = new Map<string, Decoration>();

const codeTokenDecorations = {
  attr: Decoration.mark({ class: "cm-typora-code-token-attr" }),
  boolean: Decoration.mark({ class: "cm-typora-code-token-boolean" }),
  comment: Decoration.mark({ class: "cm-typora-code-token-comment" }),
  keyword: Decoration.mark({ class: "cm-typora-code-token-keyword" }),
  number: Decoration.mark({ class: "cm-typora-code-token-number" }),
  property: Decoration.mark({ class: "cm-typora-code-token-property" }),
  string: Decoration.mark({ class: "cm-typora-code-token-string" }),
  tag: Decoration.mark({ class: "cm-typora-code-token-tag" }),
};

function normalizeCodeLanguage(language: string | undefined): string {
  const normalized = (language ?? "text").trim().toLowerCase();
  if (!normalized) {
    return "text";
  }

  if (normalized === "js") {
    return "javascript";
  }

  if (normalized === "ts") {
    return "typescript";
  }

  if (normalized === "sh") {
    return "bash";
  }

  if (normalized === "yml") {
    return "yaml";
  }

  if (normalized === "puml" || normalized === "uml") {
    return "plantuml";
  }

  return normalized.replace(/[^a-z0-9_-]/g, "-");
}

function codeLineDecorationForLanguage(
  language: string,
  edge: CodeLineEdge,
): Decoration {
  const normalized = normalizeCodeLanguage(language);
  const cacheKey = `${normalized}:${edge}`;
  const cached = codeLineDecorationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const decoration = Decoration.line({
    attributes: {
      class: `cm-typora-code-line cm-typora-code-line-${normalized} cm-typora-code-line-${edge}`,
    },
  });
  codeLineDecorationCache.set(cacheKey, decoration);
  return decoration;
}


export function typoraLiveKeymap(keybindingOverrides: KeybindingOverrides) {
  const configurableBindings = createEditorCommandBindings({
    keybindingOverrides,
    runMarkdownFormatCommand: executeMarkdownFormatCommand,
  });

  return Prec.highest(keymap.of([
    ...platformNavigationKeyBindings(),
    {
      key: "Mod-Enter",
      preventDefault: true,
      run: exitFenceBlock,
    },
    {
      key: "Enter",
      run: completeFenceBlockOnEnter,
    },
    ...configurableBindings,
  ]));
}

export function typoraLiveDecorations(params: {
  activeFileId: string;
  keybindingOverrides: KeybindingOverrides;
  workspaceRoot: string;
}) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildTyporaDecorations(state, params);
    },

    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildTyporaDecorations(transaction.state, params);
      }

      return decorations;
    },

    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

function addDecorationRange(
  ranges: TyporaDecorationRange[],
  from: number,
  to: number,
  decoration: Decoration,
) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return;
  }

  if (from < 0 || to < from) {
    return;
  }

  ranges.push(decoration.range(from, to));
}

function buildTyporaDecorations(
  state: EditorState,
  params: {
    activeFileId: string;
    keybindingOverrides: KeybindingOverrides;
    workspaceRoot: string;
  },
): DecorationSet {
  const ranges: TyporaDecorationRange[] = [];
  const previewBlocks = collectPreviewBlocks(state);
  const frontmatterClosingLineNumber =
    state.doc.lines >= 2 && isFrontmatterDelimiter(state.doc.line(1).text)
      ? findFrontmatterClosingLine(state)?.number ?? 0
      : 0;
  let previewBlockIndex = 0;
  let inCodeFence = false;
  let fenceMarker = "";
  let currentCodeLanguage = "text";
  let codeFenceClosingLineNumber = 0;
  let isFirstCodeBodyLine = false;

  let position = 0;

  while (position <= state.doc.length) {
    const previewBlock = previewBlocks[previewBlockIndex];
    if (previewBlock && position === previewBlock.from) {
      if (
        previewBlock.type === "table" ||
        !isSelectionInsideRange(state, previewBlock.from, previewBlock.to)
      ) {
        addDecorationRange(
          ranges,
          previewBlock.from,
          previewBlock.to,
          Decoration.replace({
            block: true,
            widget: previewWidgetForBlock(previewBlock, params),
          }),
        );
        position = previewBlock.to + 1;
        previewBlockIndex += 1;
        continue;
      } else {
        previewBlockIndex += 1;
      }
    }

      const line = state.doc.lineAt(position);
      const lineText = line.text;
      const codeFence = parseCodeFenceLine(line.from, line.to, lineText);

      if (frontmatterClosingLineNumber > 0 && line.number <= frontmatterClosingLineNumber) {
        if (isFrontmatterDelimiter(lineText)) {
          addDecorationRange(ranges, line.from, line.from, frontmatterDelimiterLineDecoration);
          addDecorationRange(ranges, line.from, line.to, collapsedMarkdownMarkerDecoration);
        } else {
          addDecorationRange(ranges, line.from, line.from, frontmatterLineDecoration);
        }
        decorateInlineMarkup(ranges, line.from, lineText);
        if (line.to >= state.doc.length) {
          break;
        }
        position = line.to + 1;
        continue;
      }

      if (codeFence && !inCodeFence) {
        const closingFence = findClosingFenceLine(state, line.number, lineText);

        if (closingFence && !isSelectionInsideRange(state, line.from, line.to)) {
          currentCodeLanguage = normalizeCodeLanguage(codeFence.language);
          addDecorationRange(
            ranges,
            line.from,
            line.to,
            Decoration.replace({
              block: true,
              widget: new CodeFenceLanguageWidget(codeFence),
            }),
          );
          inCodeFence = true;
          fenceMarker = lineText.trimStart().startsWith("~~~") ? "~~~" : "```";
          codeFenceClosingLineNumber = closingFence.number;
          isFirstCodeBodyLine = true;
        } else {
          decorateMarkdownLine(ranges, line.from, lineText);
        }
      } else if (inCodeFence) {
        if (lineText.trimStart().startsWith(fenceMarker)) {
          addDecorationRange(ranges, line.from, line.from, hiddenCodeFenceLineDecoration);
          addDecorationRange(
            ranges,
            line.from,
            line.to,
            Decoration.replace({
              block: true,
              widget: new HiddenCodeFenceWidget(),
            }),
          );
          inCodeFence = false;
          fenceMarker = "";
          currentCodeLanguage = "text";
          codeFenceClosingLineNumber = 0;
          isFirstCodeBodyLine = false;
        } else {
          const isLastCodeBodyLine = line.number + 1 === codeFenceClosingLineNumber;
          const codeLineEdge: CodeLineEdge = isFirstCodeBodyLine && isLastCodeBodyLine
            ? "single"
            : isFirstCodeBodyLine
              ? "first"
              : isLastCodeBodyLine
                ? "last"
                : "middle";
          addDecorationRange(
            ranges,
            line.from,
            line.from,
            codeLineDecorationForLanguage(currentCodeLanguage, codeLineEdge),
          );
          decorateCodeSyntax(ranges, line.from, lineText, currentCodeLanguage);
          isFirstCodeBodyLine = false;
        }
      } else {
        decorateMarkdownLine(ranges, line.from, lineText);
      }

      if (line.to >= state.doc.length) {
        break;
      }
      position = line.to + 1;
  }

  return Decoration.set(ranges, true);
}

function previewWidgetForBlock(
  block: PreviewBlock,
  params: {
    activeFileId: string;
    keybindingOverrides: KeybindingOverrides;
    workspaceRoot: string;
  },
): WidgetType {
  if (block.type === "hr") {
    return new HorizontalRuleWidget(block);
  }

  if (block.type === "math") {
    return new MathBlockPreviewWidget(block);
  }

  if (block.type === "blockquoteCallout") {
    return new CalloutPreviewWidget(block);
  }

  if (block.type === "table") {
    return new TablePreviewWidget(block, params.keybindingOverrides, JSON.stringify([params.workspaceRoot, params.activeFileId]));
  }

  if (block.type === "image") {
    const imageMatch = /!\[([^\]]*)\]\(([^)]+)\)/.exec(block.raw);
    return new MarkdownImagePreviewWidget({
      activeFileId: params.activeFileId,
      alt: imageMatch?.[1] ?? "",
      blockId: block.id,
      from: block.from,
      src: imageMatch?.[2] ?? "",
      to: block.to,
      workspaceRoot: params.workspaceRoot,
    });
  }

  if (block.type === "htmlImage") {
    return new HtmlImagePreviewWidget(block);
  }

  if (block.type === "plantuml") {
    return new PlantUmlPreviewWidget(toDiagramPreviewBlock(block, "plantuml"));
  }

  return new MermaidPreviewWidget(toDiagramPreviewBlock(block, "mermaid"));
}

function toDiagramPreviewBlock(
  block: PreviewBlock,
  type: DiagramPreviewBlock["type"],
): DiagramPreviewBlock {
  return {
    from: block.from,
    id: block.id,
    source: block.source,
    to: block.to,
    type,
  };
}

function isSelectionInsideRange(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    return range.from >= from && range.to <= to;
  });
}

function decorateMarkdownLine(
  ranges: TyporaDecorationRange[],
  lineFrom: number,
  lineText: string,
) {
  const headingMatch = /^(#{1,6})(\s+)(.*)$/.exec(lineText);
  if (headingMatch) {
    const level = headingMatch[1].length;
    addDecorationRange(ranges, lineFrom, lineFrom, headingLineDecorations[level - 1]);
    addDecorationRange(
      ranges,
      lineFrom,
      lineFrom + headingMatch[1].length + headingMatch[2].length,
      collapsedHeadingMarkerDecoration,
    );
  }

  const blockquoteMatch = /^(\s*)>(\s?)/.exec(lineText);
  if (blockquoteMatch) {
    const markerFrom = lineFrom + blockquoteMatch[1].length;
    const markerTo = markerFrom + 1 + blockquoteMatch[2].length;
    addDecorationRange(ranges, lineFrom, lineFrom, blockquoteLineDecoration);
    addDecorationRange(ranges, markerFrom, markerTo, collapsedMarkdownMarkerDecoration);
  }

  const taskMatch = /^(\s*)(?:([-*+])\s+)?\[([ xX])]\s+/.exec(lineText);
  if (taskMatch) {
    const markerFrom = lineFrom + taskMatch[1].length;
    const bulletLength = taskMatch[2] ? taskMatch[2].length + 1 : 0;
    const markerTo = markerFrom + bulletLength + 4;
    addDecorationRange(ranges, lineFrom, lineFrom, taskListLineDecoration);
    addDecorationRange(
      ranges,
      markerFrom,
      markerTo,
      Decoration.replace({
        widget: new TaskListMarkerWidget(
          taskMatch[3].toLowerCase() === "x",
          markerFrom + bulletLength + 1,
        ),
      }),
    );
  } else {
    const unorderedListMatch = /^(\s*)([-*+])\s+/.exec(lineText);
    if (unorderedListMatch) {
      const markerFrom = lineFrom + unorderedListMatch[1].length;
      const markerTo = markerFrom + unorderedListMatch[2].length + 1;
      addDecorationRange(ranges, lineFrom, lineFrom, unorderedListLineDecoration);
      addDecorationRange(
        ranges,
        markerFrom,
        markerTo,
        Decoration.replace({
          widget: new ListMarkerWidget("•"),
        }),
      );
    }
  }

  const orderedListMatch = /^(\s*)(\d+[.)])\s+/.exec(lineText);
  if (orderedListMatch) {
    const markerFrom = lineFrom + orderedListMatch[1].length;
    const markerTo = markerFrom + orderedListMatch[2].length + 1;
    addDecorationRange(ranges, lineFrom, lineFrom, orderedListLineDecoration);
    addDecorationRange(
      ranges,
      markerFrom,
      markerTo,
      Decoration.replace({
        widget: new ListMarkerWidget(orderedListMatch[2]),
      }),
    );
  }

  if (isTableLine(lineText)) {
    addDecorationRange(ranges, lineFrom, lineFrom, tableLineDecoration);
  }

  const imageMatch = /!\[([^\]]*)\]\(([^)]+)\)/.exec(lineText);
  if (imageMatch) {
    addDecorationRange(ranges, lineFrom, lineFrom, imageLineDecoration);
  }

  decorateInlineMarkup(ranges, lineFrom, lineText);
}

function decorateInlineMarkup(
  ranges: TyporaDecorationRange[],
  lineFrom: number,
  lineText: string,
) {
  const consumedMarkerRanges: Array<{ from: number; to: number }> = [];

  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /\*\*\*([^*\n]+)\*\*\*/g,
    3,
    [boldDecoration, italicDecoration],
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /___([^_\n]+)___/g,
    3,
    [boldDecoration, italicDecoration],
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /\*\*([^*\n]+)\*\*/g,
    2,
    boldDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /~~([^~\n]+)~~/g,
    2,
    strikeDecoration,
  );
  decorateInlineCode(ranges, consumedMarkerRanges, lineFrom, lineText);
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /<mark>(.*?)<\/mark>/g,
    { closeLength: 7, openLength: 6 },
    markDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /<kbd>(.*?)<\/kbd>/g,
    { closeLength: 6, openLength: 5 },
    kbdDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /__([^_\n]+)__/g,
    2,
    boldDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /<u>(.*?)<\/u>/g,
    { closeLength: 4, openLength: 3 },
    underlineDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /(^|[^*])\*([^*\n]+)\*/g,
    {
      closeLength: 1,
      contentGroup: 2,
      openLength: 1,
      prefixGroup: 1,
    },
    italicDecoration,
  );
  decorateInlineWrapper(
    ranges,
    consumedMarkerRanges,
    lineFrom,
    lineText,
    /(^|[^_])_([^_\n]+)_/g,
    {
      closeLength: 1,
      contentGroup: 2,
      openLength: 1,
      prefixGroup: 1,
    },
    italicDecoration,
  );
  decorateInlineMath(ranges, consumedMarkerRanges, lineFrom, lineText);
  decorateMarkdownLinks(ranges, consumedMarkerRanges, lineFrom, lineText);
}

function decorateInlineMath(
  ranges: TyporaDecorationRange[],
  consumedMarkerRanges: Array<{ from: number; to: number }>,
  lineFrom: number,
  lineText: string,
) {
  for (const match of lineText.matchAll(/(^|[^$])\$([^\s$][^$\n]*?)\$(?!\$)/g)) {
    if (match.index === undefined) {
      continue;
    }

    const prefixLength = match[1].length;
    const source = match[2];
    const from = lineFrom + match.index + prefixLength;
    const to = from + source.length + 2;
    if (isRangeConsumed(consumedMarkerRanges, from, to)) {
      continue;
    }
    consumedMarkerRanges.push({ from, to });
    addDecorationRange(
      ranges,
      from,
      to,
      Decoration.replace({
        widget: new InlineMathWidget(source),
      }),
    );
  }
}

function decorateInlineCode(
  ranges: TyporaDecorationRange[],
  consumedMarkerRanges: Array<{ from: number; to: number }>,
  lineFrom: number,
  lineText: string,
) {
  for (const match of lineText.matchAll(/`([^`\n]+)`/g)) {
    if (match.index === undefined) {
      continue;
    }

    const from = lineFrom + match.index;
    const contentFrom = from + 1;
    const contentTo = contentFrom + match[1].length;
    const to = contentTo + 1;
    if (isRangeConsumed(consumedMarkerRanges, from, to)) {
      continue;
    }

    consumedMarkerRanges.push({ from, to });
    addDecorationRange(ranges, from, contentFrom, hiddenMarkdownMarkerDecoration);
    addDecorationRange(ranges, contentFrom, contentTo, inlineCodeDecoration);
    addDecorationRange(ranges, contentTo, to, hiddenMarkdownMarkerDecoration);
  }
}

function decorateInlineWrapper(
  ranges: TyporaDecorationRange[],
  consumedMarkerRanges: Array<{ from: number; to: number }>,
  lineFrom: number,
  lineText: string,
  regex: RegExp,
  markerConfig:
    | number
    | {
        closeLength: number;
        contentGroup?: number;
        openLength: number;
        prefixGroup?: number;
      },
  contentDecoration: Decoration | Decoration[],
) {
  for (const match of lineText.matchAll(regex)) {
    if (match.index === undefined) {
      continue;
    }

    const contentGroup =
      typeof markerConfig === "number"
        ? 1
        : markerConfig.contentGroup ?? 1;
    const prefixLength =
      typeof markerConfig === "number"
        ? 0
        : markerConfig.prefixGroup
          ? match[markerConfig.prefixGroup].length
          : 0;
    const openLength =
      typeof markerConfig === "number"
        ? markerConfig
        : markerConfig.openLength;
    const closeLength =
      typeof markerConfig === "number"
        ? markerConfig
        : markerConfig.closeLength;
    const content = match[contentGroup];
    const from = lineFrom + match.index + prefixLength;
    const contentFrom = from + openLength;
    const contentTo = contentFrom + content.length;
    const to = contentTo + closeLength;

    if (
      isRangeConsumed(consumedMarkerRanges, from, contentFrom) ||
      isRangeConsumed(consumedMarkerRanges, contentTo, to)
    ) {
      continue;
    }

    consumedMarkerRanges.push(
      { from, to: contentFrom },
      { from: contentTo, to },
    );
    addDecorationRange(ranges, from, contentFrom, hiddenMarkdownMarkerDecoration);
    const contentDecorations = Array.isArray(contentDecoration)
      ? contentDecoration
      : [contentDecoration];
    for (const decoration of contentDecorations) {
      addDecorationRange(ranges, contentFrom, contentTo, decoration);
    }
    addDecorationRange(ranges, contentTo, to, hiddenMarkdownMarkerDecoration);
  }
}

function decorateMarkdownLinks(
  ranges: TyporaDecorationRange[],
  consumedMarkerRanges: Array<{ from: number; to: number }>,
  lineFrom: number,
  lineText: string,
) {
  for (const match of lineText.matchAll(/(?<!!)\[([^\]\n]+)]\(([^)\n]+)\)/g)) {
    if (match.index === undefined) {
      continue;
    }

    const label = match[1];
    const from = lineFrom + match.index;
    const labelFrom = from + 1;
    const labelTo = labelFrom + label.length;
    const to = from + match[0].length;

    if (
      isRangeConsumed(consumedMarkerRanges, from, labelFrom) ||
      isRangeConsumed(consumedMarkerRanges, labelTo, to)
    ) {
      continue;
    }

    consumedMarkerRanges.push(
      { from, to: labelFrom },
      { from: labelTo, to },
    );
    addDecorationRange(ranges, from, labelFrom, hiddenMarkdownMarkerDecoration);
    addDecorationRange(ranges, labelFrom, labelTo, linkDecoration);
    addDecorationRange(ranges, labelTo, to, hiddenMarkdownMarkerDecoration);
  }
}

function isRangeConsumed(
  consumedRanges: Array<{ from: number; to: number }>,
  from: number,
  to: number,
): boolean {
  return consumedRanges.some((range) => from < range.to && to > range.from);
}

function decorateCodeSyntax(
  ranges: TyporaDecorationRange[],
  lineFrom: number,
  lineText: string,
  language: string,
) {
  const tokens: Array<{ from: number; to: number; decoration: Decoration }> = [];
  const normalized = normalizeCodeLanguage(language);

  const addMatches = (regex: RegExp, decoration: Decoration, groupIndex = 0) => {
    for (const match of lineText.matchAll(regex)) {
      if (match.index === undefined) {
        continue;
      }

      const value = match[groupIndex];
      if (!value) {
        continue;
      }

      const prefix = lineText.slice(match.index, match.index + match[0].length).indexOf(value);
      const from = lineFrom + match.index + Math.max(0, prefix);
      tokens.push({
        from,
        to: from + value.length,
        decoration,
      });
    }
  };

  if (["json", "javascript", "typescript", "tsx", "java", "rust", "go", "kotlin", "yaml", "sql", "bash", "shell", "xml", "html", "css", "python", "properties"].includes(normalized)) {
    addMatches(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, codeTokenDecorations.string);
    addMatches(/(^|[^\w.])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, codeTokenDecorations.number, 2);
  }

  if (normalized === "json") {
    addMatches(/"(?:\\.|[^"\\])*"(?=\s*:)/g, codeTokenDecorations.property);
    addMatches(/\b(true|false)\b/g, codeTokenDecorations.boolean, 1);
    addMatches(/\bnull\b/g, codeTokenDecorations.keyword);
  }

  if (["javascript", "typescript", "tsx", "java", "rust", "go", "kotlin", "python"].includes(normalized)) {
    addMatches(/\/\/.*$/g, codeTokenDecorations.comment);
    addMatches(/\b(const|let|var|function|return|if|else|for|while|class|interface|type|enum|import|export|from|new|try|catch|finally|throw|async|await|public|private|protected|static|final|void|int|long|double|float|boolean|String|record|sealed|extends|implements|package|use|fn|struct|impl|trait|mut|val|fun|def|self|None|True|False)\b/g, codeTokenDecorations.keyword, 1);
  }

  if (["bash", "shell", "yaml", "properties", "python"].includes(normalized)) {
    addMatches(/#.*/g, codeTokenDecorations.comment);
  }

  if (normalized === "sql") {
    addMatches(/--.*$/g, codeTokenDecorations.comment);
    addMatches(/\b(select|from|where|insert|update|delete|create|alter|drop|join|left|right|inner|outer|on|group|by|order|limit|offset|and|or|not|null|is|in|exists|case|when|then|else|end|as|index|table|primary|key|unique)\b/gi, codeTokenDecorations.keyword, 1);
  }

  if (["xml", "html"].includes(normalized)) {
    addMatches(/<!--.*?-->/g, codeTokenDecorations.comment);
    addMatches(/<\/?[A-Za-z][A-Za-z0-9:-]*/g, codeTokenDecorations.tag);
    addMatches(/\s([A-Za-z_:][A-Za-z0-9_.:-]*)(?==)/g, codeTokenDecorations.attr, 1);
  }

  if (normalized === "css") {
    addMatches(/\/\*.*?\*\//g, codeTokenDecorations.comment);
    addMatches(/(^|[{};])\s*([A-Za-z-]+)(?=\s*:)/g, codeTokenDecorations.property, 2);
  }

  tokens.sort((left, right) => left.from - right.from || left.to - right.to);

  let lastTo = lineFrom;
  for (const token of tokens) {
    if (token.from < lastTo || token.from >= token.to) {
      continue;
    }

    addDecorationRange(ranges, token.from, token.to, token.decoration);
    lastTo = token.to;
  }
}
