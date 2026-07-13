import { useEffect, useRef } from "react";
import { getMarkdownFileRevision } from "./tauriWorkspaceAdapter";
import { WORKSPACE_CONFIG } from "./workspaceConfig";

export type WorkspaceDocumentRevisionTarget = {
  fileId: string;
  relativePath: string;
  /** Resets the metadata watch baseline after Polarbear saves or reloads the file. */
  revision: string;
  workspaceRoot: string;
};

type WorkspaceDocumentRevisionOptions = {
  document: WorkspaceDocumentRevisionTarget | null;
  onChanged: (document: WorkspaceDocumentRevisionTarget) => void;
  onMissing: (document: WorkspaceDocumentRevisionTarget) => void;
};

export function useWorkspaceDocumentRevision({
  document: target,
  onChanged,
  onMissing,
}: WorkspaceDocumentRevisionOptions): void {
  const onChangedRef = useRef(onChanged);
  const onMissingRef = useRef(onMissing);
  onChangedRef.current = onChanged;
  onMissingRef.current = onMissing;

  useEffect(() => {
    if (!target) {
      return;
    }

    let disposed = false;
    let checking = false;
    let missingReported = false;
    let observedWatchToken: string | null = null;
    const checkRevision = async () => {
      if (disposed || checking || window.document.visibilityState !== "visible") {
        return;
      }

      checking = true;
      try {
        const fileState = await getMarkdownFileRevision({
          workspaceRoot: target.workspaceRoot,
          relativePath: target.relativePath,
        });
        if (!fileState.exists) {
          if (!missingReported) {
            missingReported = true;
            onMissingRef.current(target);
          }
          return;
        }

        missingReported = false;
        const watchToken = fileState.watchToken;
        if (!watchToken) {
          return;
        }

        if (!observedWatchToken) {
          observedWatchToken = watchToken;
          return;
        }

        if (watchToken !== observedWatchToken) {
          observedWatchToken = watchToken;
          onChangedRef.current(target);
        }
      } catch {
        // The save contract still protects content if an external delete or permission change occurs.
      } finally {
        checking = false;
      }
    };

    void checkRevision();
    const intervalId = window.setInterval(
      () => void checkRevision(),
      WORKSPACE_CONFIG.documentRevisionCheckIntervalMs,
    );

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [target]);
}
