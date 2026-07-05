import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import { macNavigationKeymap } from "./macNavigationKeymap";

export type MarkdownEditorView = {
  focus: () => void;
  dispatch: (transaction: {
    changes?: { from: number; to: number; insert: string };
    selection?: { anchor: number; head?: number };
    scrollIntoView?: boolean;
  }) => void;
  state: {
    doc: {
      toString: () => string;
    };
    selection: {
      main: {
        from: number;
        to: number;
      };
    };
  };
};

type DroppedFile = File & {
  path?: string;
};

type MarkdownEditorProps = {
  activeFileName: string;
  markdownContent: string;
  onImageDrop: (filePaths: string[]) => void;
  onImagePaste: (items: DataTransferItemList) => void;
  onEditorReady: (editorView: MarkdownEditorView) => void;
  onMarkdownChange: (markdownContent: string) => void;
};

export function MarkdownEditor({
  activeFileName,
  markdownContent,
  onImageDrop,
  onImagePaste,
  onEditorReady,
  onMarkdownChange
}: MarkdownEditorProps) {
  return (
    <section
      className="editor-pane"
      data-editor-document-host="true"
      data-editor-document-mode="source"
      data-editor-document-surface="true"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => (file as DroppedFile).path ?? "")
          .filter(Boolean);

        if (paths.length > 0) {
          event.preventDefault();
          onImageDrop(paths);
        }
      }}
      onPaste={(event) => {
        const hasImage = Array.from(event.clipboardData.items).some((item) =>
          item.type.startsWith("image/")
        );

        if (hasImage) {
          event.preventDefault();
          onImagePaste(event.clipboardData.items);
        }
      }}
    >
      <div className="pane-title">
        <span>Markdown Editor</span>
        <span>{activeFileName}</span>
      </div>
      <CodeMirror
        value={markdownContent}
        height="100%"
        extensions={[macNavigationKeymap(), markdown(), search({ top: true })]}
        onCreateEditor={(editorView) => onEditorReady(editorView)}
        onChange={onMarkdownChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true
        }}
      />
    </section>
  );
}
