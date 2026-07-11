import { useEffect } from "react";
import type { WorkspaceItem } from "./workspaceModel";
import {
  listWorkspaceFiles,
  refreshWorkspaceSyncIndex,
} from "./tauriWorkspaceAdapter";
import { WORKSPACE_CONFIG } from "./workspaceConfig";

type WorkspaceFileTreeRefreshOptions = {
  workspaceRoot: string;
  onRefresh: (workspaceRoot: string, items: WorkspaceItem[]) => void;
};

export function useWorkspaceFileTreeRefresh({
  workspaceRoot,
  onRefresh,
}: WorkspaceFileTreeRefreshOptions): void {
  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    let disposed = false;
    let refreshInProgress = false;
    const refreshFileTree = async () => {
      if (disposed || refreshInProgress || document.visibilityState !== "visible") {
        return;
      }
      refreshInProgress = true;
      try {
        const [items] = await Promise.all([
          listWorkspaceFiles(workspaceRoot),
          refreshWorkspaceSyncIndex(workspaceRoot),
        ]);
        if (!disposed) {
          onRefresh(workspaceRoot, items);
        }
      } catch {
        // A transient filesystem change is retried on the next focus/poll cycle.
      } finally {
        refreshInProgress = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshFileTree();
      }
    };
    const intervalId = window.setInterval(
      () => void refreshFileTree(),
      WORKSPACE_CONFIG.fileTreeRefreshIntervalMs,
    );

    void refreshFileTree();
    window.addEventListener("focus", refreshFileTree);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshFileTree);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onRefresh, workspaceRoot]);
}
