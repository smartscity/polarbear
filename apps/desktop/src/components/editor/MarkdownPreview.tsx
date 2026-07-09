import { useMemo, type MouseEvent } from "react";
import MarkdownIt from "markdown-it";
import { MarkdownImage } from "./MarkdownImage";
import { MermaidBlock } from "../diagrams/MermaidBlock";
import { PlantUmlBlock } from "../diagrams/PlantUmlBlock";
import { splitMarkdownIntoSegments } from "../../markdown/splitMarkdownIntoSegments";

type MarkdownPreviewProps = {
  activeFileId: string;
  markdownContent: string;
  workspaceRoot: string;
};

export function MarkdownPreview({
  activeFileId,
  markdownContent,
  workspaceRoot
}: MarkdownPreviewProps) {
  const markdownRenderer = useMemo(
    () => {
      const renderer = new MarkdownIt({
        html: false,
        linkify: true,
        typographer: true
      });

      renderer.renderer.rules.fence = (tokens, index) => {
        const token = tokens[index];
        const language = token.info.trim().split(/\s+/)[0] || "text";
        const highlightedCode = highlightCode(
          renderer.utils.escapeHtml(token.content),
          language
        );
        const encodedCode = encodeURIComponent(token.content);

        return [
          `<figure class="code-block">`,
          `<figcaption><span>${renderer.utils.escapeHtml(language)}</span><button type="button" class="code-copy-button" data-code="${encodedCode}">Copy</button></figcaption>`,
          `<pre><code class="language-${renderer.utils.escapeHtml(language)}">${highlightedCode}</code></pre>`,
          `</figure>`
        ].join("");
      };

      renderer.core.ruler.after("inline", "polarbear-task-list", (state) => {
        for (let index = 0; index < state.tokens.length; index += 1) {
          const token = state.tokens[index];

          if (token.type !== "inline" || !token.children?.length) {
            continue;
          }

          const firstChild = token.children[0];
          const markerMatch = firstChild.content.match(/^\[([ xX])]\s+/);

          if (!markerMatch) {
            continue;
          }

          firstChild.content = firstChild.content.slice(markerMatch[0].length);
          const checkbox = new state.Token("html_inline", "", 0);
          checkbox.content = `<input class="task-list-item-checkbox" type="checkbox" disabled${
            markerMatch[1].toLowerCase() === "x" ? " checked" : ""
          } /> `;
          token.children.unshift(checkbox);
        }
      });

      return renderer;
    },
    []
  );

  const segments = useMemo(
    () => splitMarkdownIntoSegments(markdownContent),
    [markdownContent]
  );

  return (
    <section className="preview-pane">
      <article
        className="markdown-preview"
        data-editor-document-host="true"
        data-editor-document-mode="preview"
        onClick={handlePreviewClick}
      >
        <div
          className="markdown-preview-surface"
          data-editor-document-surface="true"
        >
          {segments.map((segment, index) => {
            if (segment.type === "mermaid") {
              return (
                <MermaidBlock
                  key={segment.id}
                  source={segment.content}
                  diagramId={segment.id}
                />
              );
            }

            if (segment.type === "plantuml") {
              return (
                <PlantUmlBlock
                  key={segment.id}
                  diagramId={segment.id}
                  source={segment.content}
                />
              );
            }

            if (segment.type === "image") {
              return (
                <MarkdownImage
                  activeFileId={activeFileId}
                  alt={segment.alt}
                  key={segment.id}
                  markdown={segment.content}
                  src={segment.src}
                  title={segment.title}
                  workspaceRoot={workspaceRoot}
                />
              );
            }

            return (
              <div
                key={`markdown-${index}`}
                className="markdown-preview-segment"
                dangerouslySetInnerHTML={{
                  __html: markdownRenderer.render(segment.content)
                }}
              />
            );
          })}
        </div>
      </article>
    </section>
  );
}

function highlightCode(escapedCode: string, language: string): string {
  const normalizedLanguage = language.toLowerCase();
  const keywordGroups: Record<string, string[]> = {
    rust: ["fn", "let", "mut", "pub", "struct", "enum", "impl", "trait", "use", "mod", "match", "if", "else", "return", "async", "await"],
    typescript: ["const", "let", "type", "interface", "function", "return", "import", "export", "from", "async", "await", "if", "else"],
    javascript: ["const", "let", "var", "function", "return", "import", "export", "from", "async", "await", "if", "else"],
    java: ["public", "private", "class", "interface", "return", "new", "void", "static", "final", "if", "else"],
    python: ["def", "class", "return", "import", "from", "if", "else", "elif", "for", "while", "async", "await"],
    bash: ["if", "then", "else", "fi", "for", "do", "done", "case", "esac", "export"],
    sql: ["select", "from", "where", "insert", "update", "delete", "join", "left", "right", "group", "order", "by", "limit"]
  };
  const aliases: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    shell: "bash",
    sh: "bash"
  };
  const keywords =
    keywordGroups[normalizedLanguage] ??
    keywordGroups[aliases[normalizedLanguage] ?? ""] ??
    [];

  if (keywords.length === 0) {
    return escapedCode;
  }

  const keywordPattern = new RegExp(`\\b(${keywords.join("|")})\\b`, "g");
  return escapedCode.replace(
    keywordPattern,
    '<span class="syntax-keyword">$1</span>'
  );
}

function handlePreviewClick(event: MouseEvent<HTMLElement>) {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const copyButton = target.closest<HTMLButtonElement>(".code-copy-button");
  if (!copyButton) {
    return;
  }

  const encodedCode = copyButton.dataset.code ?? "";
  void navigator.clipboard.writeText(decodeURIComponent(encodedCode)).then(
    () => {
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1400);
    },
    () => {
      copyButton.textContent = "Copy failed";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1800);
    }
  );
}
