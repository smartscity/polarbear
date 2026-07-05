import { useEffect, useMemo, useState } from "react";
import type {
  GithubRepository,
  RepositoryAccount,
  RepositoryBinding,
  RepositorySyncStatus
} from "./repositoryApi";

export function ConnectGithubDialog({
  isBusy,
  onCancel,
  onConnect
}: {
  isBusy: boolean;
  onCancel: () => void;
  onConnect: (token: string) => void;
}) {
  const [token, setToken] = useState("");

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <form
        className="create-dialog repository-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConnect(token);
        }}
      >
        <header>
          <h2>Connect GitHub</h2>
          <p>Use a fine-grained GitHub personal access token.</p>
          <ul>
            <li>Repository metadata: read</li>
            <li>Repository contents: read and write</li>
          </ul>
        </header>
        <label>
          Token
          <input
            autoFocus
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <footer>
          <button type="button" disabled={isBusy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={isBusy || !token.trim()}>
            Connect
          </button>
        </footer>
      </form>
    </section>
  );
}

export function LinkGithubWorkspaceDialog({
  account,
  isBusy,
  repositories,
  workspaceRoot,
  onCancel,
  onLink
}: {
  account: RepositoryAccount;
  isBusy: boolean;
  repositories: GithubRepository[];
  workspaceRoot: string;
  onCancel: () => void;
  onLink: (params: {
    owner: string;
    repo: string;
    branch: string;
    remotePath: string;
  }) => void;
}) {
  const [selectedFullName, setSelectedFullName] = useState(
    repositories[0]?.fullName ?? ""
  );
  const selectedRepository = useMemo(
    () => repositories.find((repo) => repo.fullName === selectedFullName),
    [repositories, selectedFullName]
  );
  const [branch, setBranch] = useState(selectedRepository?.defaultBranch ?? "main");
  const [remotePath, setRemotePath] = useState("/");

  useEffect(() => {
    if (selectedRepository) {
      setBranch(selectedRepository.defaultBranch);
    }
  }, [selectedRepository]);

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <form
        className="create-dialog repository-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (selectedRepository) {
            onLink({
              owner: selectedRepository.owner,
              repo: selectedRepository.name,
              branch,
              remotePath
            });
          }
        }}
      >
        <header>
          <h2>Link Workspace to GitHub</h2>
          <p>Account: {account.login}</p>
          <p className="repository-workspace-path">{workspaceRoot}</p>
        </header>
        <label>
          Repository
          <select
            autoFocus
            value={selectedFullName}
            onChange={(event) => setSelectedFullName(event.target.value)}
          >
            {repositories.map((repo) => (
              <option key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
        </label>
        <label>
          Remote Path
          <input
            value={remotePath}
            onChange={(event) => setRemotePath(event.target.value)}
          />
        </label>
        <footer>
          <button type="button" disabled={isBusy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={isBusy || !selectedRepository || !branch.trim()}
          >
            Link
          </button>
        </footer>
      </form>
    </section>
  );
}

export function RepositorySyncStatusDialog({
  status,
  onClose,
  onPull,
  onPush,
  onSync
}: {
  status: RepositorySyncStatus;
  onClose: () => void;
  onPull: () => void;
  onPush: () => void;
  onSync: () => void;
}) {
  const binding = status.binding;

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <div className="create-dialog repository-dialog">
        <header>
          <h2>Repository Sync Status</h2>
          <p>Provider: {binding?.provider ?? "Not linked"}</p>
        </header>
        <dl className="repository-status-grid">
          <dt>Account</dt>
          <dd>{status.account?.login ?? "Not connected"}</dd>
          <dt>Repository</dt>
          <dd>{binding ? `${binding.owner}/${binding.repo}` : "Not linked"}</dd>
          <dt>Branch</dt>
          <dd>{binding?.branch ?? "-"}</dd>
          <dt>Remote Path</dt>
          <dd>{binding?.remotePath ?? "-"}</dd>
          <dt>Last Sync</dt>
          <dd>{formatSyncTime(binding?.lastSyncAt)}</dd>
          <dt>Local Changes</dt>
          <dd>{status.localChanges}</dd>
          <dt>Remote Changed</dt>
          <dd>{status.remoteChanged ? "Yes" : "No"}</dd>
          <dt>Conflicts</dt>
          <dd>{status.conflicts.length}</dd>
        </dl>
        {status.conflicts.length > 0 ? (
          <ul className="repository-conflicts">
            {status.conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        ) : null}
        <footer>
          {binding ? (
            <>
              <button type="button" onClick={onPull}>
                Pull
              </button>
              <button type="button" onClick={onPush}>
                Push
              </button>
              <button type="button" onClick={onSync}>
                Sync Now
              </button>
            </>
          ) : null}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </section>
  );
}

function formatSyncTime(timestamp?: number | null): string {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp * 1000).toLocaleString();
}
