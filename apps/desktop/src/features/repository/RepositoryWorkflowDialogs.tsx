import { ConnectRepositoryDialog, LinkRepositoryWorkspaceDialog, RepositoryOperationDialog, RepositorySyncStatusDialog } from "./RepositoryDialogs";
import type { useRepositoryWorkflow } from "./useRepositoryWorkflow";

export function RepositoryWorkflowDialogs({ workflow }: { workflow: ReturnType<typeof useRepositoryWorkflow> }) {
  const {
    repositoryDialog, repositoryError, isRepositoryBusy, closeDialog, connectRepository,
    repositoryAccount, repositoryBinding, repositories, linkWorkspaceRoot, linkCurrentWorkspace,
    repositorySyncStatus, runRepositorySyncAction, repositoryOperation,
  } = workflow;
  return <>
      {repositoryDialog === "connect" ? (
        <ConnectRepositoryDialog
          errorMessage={repositoryError}
          isBusy={isRepositoryBusy}
          onCancel={closeDialog}
          onConnect={(params) => void connectRepository(params)}
        />
      ) : null}
      {repositoryDialog === "link" && repositoryAccount ? (
        <LinkRepositoryWorkspaceDialog
          account={repositoryAccount}
          binding={repositoryBinding}
          errorMessage={repositoryError}
          isBusy={isRepositoryBusy}
          repositories={repositories}
          workspaceRoot={linkWorkspaceRoot}
          onCancel={closeDialog}
          onLink={(params) => void linkCurrentWorkspace(params)}
        />
      ) : null}
      {repositoryDialog === "status" && repositorySyncStatus ? (
        <RepositorySyncStatusDialog
          status={repositorySyncStatus}
          onClose={closeDialog}
          onSync={() => void runRepositorySyncAction("sync")}
        />
      ) : null}
      {repositoryDialog === "operation" ? (
        <RepositoryOperationDialog
          isBusy={repositoryOperation.isBusy}
          message={repositoryOperation.message}
          title={repositoryOperation.title}
          onClose={closeDialog}
        />
      ) : null}
  </>;
}
