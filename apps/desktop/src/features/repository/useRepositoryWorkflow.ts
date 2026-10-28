import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { errorMessage } from "../../shared/tauri/invokeTauri";
import { chooseWorkspaceFolder } from "../workspace/tauriWorkspaceAdapter";
import { useRepositoryIdentity } from "./useRepositoryIdentity";
import { useRepositorySyncProgress } from "./useRepositorySyncProgress";
import {
  connectRepositoryProvider, disconnectRepositoryProvider, getRepositoryAccount,
  getRepositorySyncStatus, getWorkspaceRepositoryBinding, linkWorkspaceToRepository,
  listRepositories, pullWorkspace, pushWorkspace, repositoryProviderLabel,
  syncWorkspaceNow, isRepositoryCleanupPending,
  type RepositoryAccount, type RepositoryInfo, type RepositoryProvider, type RepositorySyncStatus,
} from "./repositoryApi";

type RepositoryWorkflowOptions = {
  workspaceRoot: string;
  onStatus: Dispatch<SetStateAction<string>>;
  openWorkspace: (root: string) => Promise<boolean>;
  documents: {
    dirtyIds: (root: string) => string[];
    saveDirty: (root: string) => Promise<boolean>;
    reload: (root: string) => Promise<boolean>;
  };
};

/** Owns repository UI actions; document mutations remain with the workspace owner. */
export function useRepositoryWorkflow({
  workspaceRoot, onStatus: setStatusMessage, openWorkspace: loadWorkspace, documents,
}: RepositoryWorkflowOptions) {
  const { t } = useI18n();
  const dirtyDocumentIdsForWorkspace = documents.dirtyIds;
  const saveDirtyDocumentsForWorkspace = documents.saveDirty;
  const reloadWorkspaceAfterDownload = documents.reload;
  const [repositories, setRepositories] = useState<RepositoryInfo[]>([]);
  const [repositorySyncStatus, setRepositorySyncStatus] =
    useState<RepositorySyncStatus | null>(null);
  const [repositoryDialog, setRepositoryDialog] = useState<
    "connect" | "link" | "status" | "operation" | null
  >(null);
  const [repositoryLinkWorkspaceRoot, setRepositoryLinkWorkspaceRoot] =
    useState("");
  const [repositoryError, setRepositoryError] = useState("");
  const [repositoryOperation, setRepositoryOperation] = useState<{
    title: string;
    message: string;
    isBusy: boolean;
    status: "idle" | "busy" | "success" | "error";
  }>({
    title: t("status.cloudSync"),
    message: "",
    isBusy: false,
    status: "idle",
  });
  const [isRepositoryBusy, setIsRepositoryBusy] = useState(false);
  const repositoryBusyRef = useRef(false);
  const statusScope = useMemo(() => ({ workspaceRoot, active: false }), [workspaceRoot]);
  const statusRequestRef = useRef<typeof statusScope | null>(null);
  useLayoutEffect(() => {
    statusScope.active = true;
    setRepositoryDialog((current) => current === "status" || current === "operation" ? null : current);
    setRepositorySyncStatus(null);
    if (!repositoryBusyRef.current && statusRequestRef.current && statusRequestRef.current !== statusScope) {
      setIsRepositoryBusy(false);
      setRepositoryOperation((current) => ({ ...current, message: "", isBusy: false, status: "idle" }));
    }
    return () => { statusScope.active = false; };
  }, [statusScope]);
  const { repositoryAccount, repositoryBinding, repositoryCleanupPending, markRepositoryCleanupPending, setRepositoryAccount, setRepositoryBinding } =
    useRepositoryIdentity(workspaceRoot, setStatusMessage);
  const handleRepositorySyncProgress = useCallback((payload: {
    phase: string;
    message: string;
    current?: number | null;
    total?: number | null;
  }) => {
    const count =
      payload.current != null && payload.total != null && payload.total > 0
        ? ` (${payload.current}/${payload.total})`
        : "";
    setRepositoryOperation((current) => ({
      ...current,
      message: `${payload.message}${count} [${payload.phase}]`,
      isBusy: true,
      status: "busy",
    }));
  }, []);
  const handleRepositoryProgressError = useEventCallback(() => {
    setStatusMessage(t("status.syncProgressUnavailable"));
  });
  useRepositorySyncProgress({
    busyRef: repositoryBusyRef,
    onProgress: handleRepositorySyncProgress,
    onError: handleRepositoryProgressError,
  });

  const repositoryErrorMessage = errorMessage;

  const isRepositoryAuthenticationError = (message: string): boolean =>
    /credentials are missing|connect (github|gitlab).*before|\b(401|403)\b/i.test(
      message,
    );

  const showRepositoryOperation = (
    title: string,
    message: string,
    isBusy: boolean,
  ) => {
    setRepositoryOperation({
      title,
      message,
      isBusy,
      status: isBusy ? "busy" : "error",
    });
    if (isBusy) {
      setRepositoryDialog((current) =>
        current === "operation" ? null : current,
      );
    } else {
      setRepositoryDialog("operation");
    }
  };

  const openLinkWorkspaceDialog = async (
    accountOverride?: RepositoryAccount,
    workspaceRootOverride?: string,
  ) => {
    let targetWorkspaceRoot = workspaceRootOverride || workspaceRoot;
    setRepositoryError("");

    if (!accountOverride && !repositoryAccount) {
      setRepositoryLinkWorkspaceRoot(targetWorkspaceRoot);
      setRepositoryDialog("connect");
      return;
    }

    if (!targetWorkspaceRoot) {
      const selectedFolder = await chooseWorkspaceFolder();
      if (!selectedFolder) {
        setStatusMessage(t("status.chooseWorkspaceBeforeCloud"));
        setRepositoryDialog(null);
        return;
      }

      const didOpenWorkspace = await loadWorkspace(selectedFolder);
      if (!didOpenWorkspace) {
        setRepositoryDialog(null);
        return;
      }
      targetWorkspaceRoot = selectedFolder;
    }

    setRepositories([]);
    setRepositoryLinkWorkspaceRoot(targetWorkspaceRoot);
    setRepositoryDialog("link");
    setIsRepositoryBusy(true);

    try {
      const [repositories, binding] = await Promise.all([
        listRepositories(),
        getWorkspaceRepositoryBinding(targetWorkspaceRoot),
      ]);
      setRepositories(repositories);
      setRepositoryBinding(binding);
      if (repositories.length === 0) {
        setRepositoryError(t("cloud.noVisibleRepositoriesMessage"));
      }
    } catch (error) {
      const message = repositoryErrorMessage(error);
      if (isRepositoryAuthenticationError(message)) {
        setRepositoryAccount(null);
        setRepositoryBinding(null);
        setRepositories([]);
        setRepositoryError(t("cloud.credentialsUnavailable"));
        setRepositoryDialog("connect");
      } else {
        setRepositoryError(message);
      }
      setStatusMessage(message);
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const connectRepository = async (params: {
    provider: RepositoryProvider;
    token: string;
    baseUrl?: string;
  }) => {
    setRepositoryError("");
    setIsRepositoryBusy(true);

    try {
      const account = await connectRepositoryProvider(params);
      setRepositoryAccount(account);
      setStatusMessage(t("cloud.connectedAsStatus", {
        account: account.login,
        provider: repositoryProviderLabel(account.provider),
      }));
      await openLinkWorkspaceDialog(account);
    } catch (error) {
      const message = repositoryErrorMessage(error);
      setRepositoryError(message);
      setRepositoryDialog("connect");
      setStatusMessage(message);
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const disconnectRepositoryAccount = async () => {
    setIsRepositoryBusy(true);

    try {
      await disconnectRepositoryProvider();
      setRepositoryAccount(null);
      setRepositoryBinding(null);
      setRepositoryLinkWorkspaceRoot("");
      setRepositoryError("");
      setRepositoryDialog(null);
      setStatusMessage(t("status.cloudDisconnected"));
    } catch (error) {
      if (isRepositoryCleanupPending(error)) markRepositoryCleanupPending();
      const message = repositoryErrorMessage(error);
      showRepositoryOperation(t("status.cloudSync"), message, false);
      setStatusMessage(message);
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const linkCurrentWorkspace = async (params: {
    provider: RepositoryProvider;
    owner: string;
    repo: string;
    branch: string;
    remotePath: string;
    baseUrl?: string | null;
  }) => {
    const syncWorkspaceRoot = repositoryLinkWorkspaceRoot || workspaceRoot;
    if (!syncWorkspaceRoot) {
      setStatusMessage(t("status.openWorkspaceBeforeCloud"));
      return;
    }

    setRepositoryError("");
    setIsRepositoryBusy(true);

    try {
      const binding = await linkWorkspaceToRepository({
        workspaceRef: syncWorkspaceRoot,
        ...params,
      });
      setRepositoryBinding(binding);
      setRepositoryLinkWorkspaceRoot("");
      const status = await getRepositorySyncStatus({
        workspaceRef: syncWorkspaceRoot,
        dirty: false,
      });
      setRepositorySyncStatus(status);
      setRepositoryDialog("status");
      setStatusMessage(t("status.cloudReady", {
        repository: `${binding.owner}/${binding.repo}`,
      }));
    } catch (error) {
      const message = repositoryErrorMessage(error);
      setRepositoryError(message);
      setRepositoryDialog("link");
      setStatusMessage(message);
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const resolveRepositoryContext = async () => {
    const account = await getRepositoryAccount();
    if (!statusScope.active) return null;
    setRepositoryAccount(account);
    if (!account) {
      setRepositoryError("");
      setRepositoryDialog("connect");
      return null;
    }

    if (!workspaceRoot) {
      await openLinkWorkspaceDialog(account);
      return null;
    }

    const binding = await getWorkspaceRepositoryBinding(statusScope.workspaceRoot);
    if (!statusScope.active) return null;
    setRepositoryBinding(binding);
    if (!binding) {
      await openLinkWorkspaceDialog(account, workspaceRoot);
      return null;
    }

    return { account, binding, workspaceRoot };
  };

  const refreshSyncStatus = async () => {
    statusRequestRef.current = statusScope;
    showRepositoryOperation(
      t("status.checkingCloudSyncTitle"),
      t("status.checkingCloudSyncMessage"),
      true,
    );
    setIsRepositoryBusy(true);

    try {
      const context = await resolveRepositoryContext();
      if (!context) {
        return;
      }
      const status = await getRepositorySyncStatus({
        workspaceRef: context.workspaceRoot,
        dirty: dirtyDocumentIdsForWorkspace(context.workspaceRoot).length > 0,
      });
      if (!statusScope.active) return;
      setRepositorySyncStatus(status);
      setRepositoryAccount(status.account ?? null);
      setRepositoryBinding(status.binding ?? null);
      setRepositoryDialog("status");
    } catch (error) {
      if (!statusScope.active) return;
      const message = repositoryErrorMessage(error);
      showRepositoryOperation(t("cloud.statusTitle"), message, false);
      setStatusMessage(message);
    } finally {
      if (statusScope.active) {
        setIsRepositoryBusy(false);
        setRepositoryOperation((current) => current.isBusy
          ? { ...current, message: "", isBusy: false, status: "idle" }
          : current);
      }
      if (statusRequestRef.current === statusScope) statusRequestRef.current = null;
    }
  };

  const runRepositorySyncAction = async (action: "pull" | "push" | "sync") => {
    if (repositoryBusyRef.current) {
      setStatusMessage(t("status.cloudBusy"));
      return;
    }
    const operation =
      action === "push"
        ? { title: t("status.syncUploadingTitle"), message: t("status.syncUploadingMessage") }
        : action === "pull"
          ? { title: t("status.syncDownloadingTitle"), message: t("status.syncDownloadingMessage") }
          : { title: t("status.syncingTitle"), message: t("status.syncingMessage") };
    showRepositoryOperation(operation.title, operation.message, true);
    repositoryBusyRef.current = true;
    setIsRepositoryBusy(true);

    try {
      const context = await resolveRepositoryContext();
      if (!context) {
        return;
      }
      showRepositoryOperation(operation.title, operation.message, true);
      if (!await saveDirtyDocumentsForWorkspace(context.workspaceRoot)) {
        const message = t("status.syncPausedUnsaved");
        setRepositoryOperation({ title: operation.title, message, isBusy: false, status: "error" });
        setStatusMessage((current) => `${message} ${current}`);
        return;
      }
      const params = {
        workspaceRef: context.workspaceRoot,
        dirty: false,
      };
      const status =
        action === "pull"
          ? await pullWorkspace(params)
          : action === "push"
            ? await pushWorkspace(params)
            : await syncWorkspaceNow(params);

      setRepositorySyncStatus(status);
      setRepositoryAccount(status.account ?? null);
      setRepositoryBinding(status.binding ?? null);
      const localConflict = (action === "pull" || action === "sync")
        ? await reloadWorkspaceAfterDownload(context.workspaceRoot)
        : false;
      setRepositoryDialog(status.conflicts.length > 0 || status.remoteChanged ? "status" : null);
      setRepositoryOperation({
        title: operation.title,
        message:
          localConflict
            ? t("status.syncReloadPreserved")
            : status.conflicts.length > 0
            ? t("status.syncConflicts", { count: status.conflicts.length })
            : status.remoteChanged ? t("status.syncPendingConfirmation")
            : t("status.operationCompleted", { operation: operation.title }),
        isBusy: false,
        status: localConflict || status.conflicts.length > 0 ? "error" : "success",
      });
      setStatusMessage(
        localConflict
          ? t("status.syncReloadPreserved")
          : status.conflicts.length > 0
          ? t("status.syncConflicts", { count: status.conflicts.length })
          : status.remoteChanged ? t("status.syncPendingConfirmation")
          : t("status.operationCompleted", { operation: operation.title }),
      );
    } catch (error) {
      const message = repositoryErrorMessage(error);
      setRepositoryOperation({
        title: operation.title,
        message,
        isBusy: false,
        status: "error",
      });
      setRepositoryDialog(null);
      setStatusMessage(message);
    } finally {
      repositoryBusyRef.current = false;
      setIsRepositoryBusy(false);
    }
  };

  const closeDialog = () => {
    setRepositoryLinkWorkspaceRoot("");
    setRepositoryError("");
    setRepositoryDialog(null);
  };

  return {
    repositoryAccount, repositoryBinding, repositoryCleanupPending, repositoryOperation,
    isRepositoryBusy, repositoryDialog, repositoryError, repositorySyncStatus, repositories,
    linkWorkspaceRoot: repositoryLinkWorkspaceRoot || workspaceRoot,
    openConnectDialog: () => { setRepositoryError(""); setRepositoryDialog("connect"); },
    closeDialog, connectRepository, disconnectRepositoryAccount, linkCurrentWorkspace,
    openLinkWorkspaceDialog, refreshSyncStatus, runRepositorySyncAction,
  };
}
