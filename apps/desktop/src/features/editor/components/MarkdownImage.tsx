import { useEffect, useMemo, useState } from "react";
import {
  resolveMarkdownAsset,
  type ResolveMarkdownAssetResponse
} from "../../workspace/tauriWorkspaceAdapter";
import { ImageViewer } from "./ImageViewer";

type MarkdownImageProps = {
  activeFileId: string;
  alt: string;
  markdown: string;
  src: string;
  title?: string;
  workspaceRoot: string;
  onDelete?: (markdown: string) => void;
};

type ImageState =
  | { status: "loading" }
  | { status: "ready"; src: string; mimeType?: string | null }
  | { status: "error"; message: string };

export function MarkdownImage({
  activeFileId,
  alt,
  markdown,
  src,
  title,
  workspaceRoot,
  onDelete
}: MarkdownImageProps) {
  const [imageState, setImageState] = useState<ImageState>({ status: "loading" });
  const [isSelected, setIsSelected] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const directSource = useMemo(() => isDirectImageSource(src), [src]);

  useEffect(() => {
    let isMounted = true;

    async function resolveImage() {
      if (!src.trim()) {
        setImageState({ status: "error", message: "Image source is empty." });
        return;
      }

      if (directSource) {
        setImageState({ status: "ready", src });
        return;
      }

      if (!workspaceRoot || !activeFileId) {
        setImageState({
          status: "error",
          message: "Open a saved workspace file to preview local images."
        });
        return;
      }

      setImageState({ status: "loading" });

      try {
        const response: ResolveMarkdownAssetResponse = await resolveMarkdownAsset({
          workspaceRef: workspaceRoot,
          markdownRelativePath: activeFileId,
          assetSrc: src
        });

        if (!isMounted) {
          return;
        }

        if (!response.exists || !response.assetUrl) {
          setImageState({
            status: "error",
            message: response.error ?? `Image not found: ${src}`
          });
          return;
        }

        setImageState({
          status: "ready",
          src: response.assetUrl,
          mimeType: response.mimeType
        });
      } catch (error) {
        if (isMounted) {
          setImageState({
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    void resolveImage();

    return () => {
      isMounted = false;
    };
  }, [activeFileId, directSource, src, workspaceRoot]);

  if (imageState.status === "loading") {
    return (
      <figure className="markdown-image-card markdown-image-loading">
        <span>Loading image: {src}</span>
      </figure>
    );
  }

  if (imageState.status === "error") {
    return (
      <figure className="markdown-image-card markdown-image-error">
        <strong>{imageState.message}</strong>
        <code>{src}</code>
      </figure>
    );
  }

  return (
    <figure
      className={`markdown-image-card ${isSelected ? "selected" : ""}`}
      tabIndex={onDelete ? 0 : undefined}
      onBlur={() => setIsSelected(false)}
      onClick={(event) => {
        if (onDelete) {
          event.currentTarget.focus();
          setIsSelected(true);
          return;
        }

        setIsViewerOpen(true);
      }}
      onDoubleClick={() => setIsViewerOpen(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setIsViewerOpen(true);
          return;
        }

        if (!onDelete || !isSelected) {
          return;
        }

        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onDelete(markdown);
        }
      }}
    >
      <img src={imageState.src} alt={alt} title={title} />
      {alt ? <figcaption>{alt}</figcaption> : null}
      {onDelete ? (
        <button
          type="button"
          className="markdown-image-delete"
          onClick={() => onDelete(markdown)}
        >
          Delete Reference
        </button>
      ) : null}
      {isViewerOpen ? (
        <ImageViewer
          alt={alt}
          src={imageState.src}
          title={title}
          onClose={() => setIsViewerOpen(false)}
        />
      ) : null}
    </figure>
  );
}

function isDirectImageSource(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:")
  );
}
