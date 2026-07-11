import { useEffect, useMemo, useState } from "react";
import type {
  RepositoryAccount,
  RepositoryBinding,
  RepositoryInfo,
  RepositoryProvider,
  RepositorySyncStatus
} from "./repositoryApi";
import { repositoryProviderLabel } from "./repositoryApi";
import { useI18n } from "../../shared/i18n/I18nProvider";

export function ConnectRepositoryDialog({
  isBusy,
  errorMessage,
  onCancel,
  onConnect
}: {
  isBusy: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onConnect: (params: {
    provider: RepositoryProvider;
    token: string;
    baseUrl?: string;
  }) => void;
}) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<RepositoryProvider>("github");
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://gitlab.com");
  const providerLabel = repositoryProviderLabel(provider);

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <form
        className="create-dialog repository-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConnect({
            provider,
            token,
            baseUrl: provider === "gitlab" ? baseUrl : undefined
          });
        }}
      >
        <header>
          <h2>{t("cloud.connectTitle")}</h2>
          <p>{t("cloud.connectDescription")}</p>
          {provider === "github" ? (
            <ul>
              <li>{t("cloud.githubRepositoryAccess")}</li>
              <li>{t("cloud.githubContentsPermission")}</li>
              <li>{t("cloud.githubMetadataPermission")}</li>
            </ul>
          ) : (
            <ul>
              <li>{t("cloud.gitlabTokenScope")}</li>
              <li>{t("cloud.gitlabProjectRole")}</li>
            </ul>
          )}
        </header>
        <label>
          {t("cloud.provider")}
          <select
            autoFocus
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as RepositoryProvider)
            }
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
        </label>
        {provider === "gitlab" ? (
          <label>
            GitLab URL
            <input
              value={baseUrl}
              placeholder="https://gitlab.com"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          {t("cloud.token", { provider: providerLabel })}
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {errorMessage ? (
          <p className="repository-dialog-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <footer>
          <button type="button" disabled={isBusy} onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={isBusy || !token.trim()}>
            {t("common.connect")}
          </button>
        </footer>
      </form>
    </section>
  );
}

export function LinkRepositoryWorkspaceDialog({
  account,
  binding,
  isBusy,
  errorMessage,
  repositories,
  workspaceRoot,
  onCancel,
  onLink
}: {
  account: RepositoryAccount;
  binding?: RepositoryBinding | null;
  isBusy: boolean;
  errorMessage?: string;
  repositories: RepositoryInfo[];
  workspaceRoot: string;
  onCancel: () => void;
  onLink: (params: {
    provider: RepositoryProvider;
    owner: string;
    repo: string;
    branch: string;
    remotePath: string;
    baseUrl?: string | null;
  }) => void;
}) {
  const { t } = useI18n();
  const [selectedFullName, setSelectedFullName] = useState(
    binding ? `${binding.owner}/${binding.repo}` : repositories[0]?.fullName ?? ""
  );
  const selectedRepository = useMemo(
    () => repositories.find((repo) => repo.fullName === selectedFullName),
    [repositories, selectedFullName]
  );
  const [branch, setBranch] = useState(
    binding?.branch ?? selectedRepository?.defaultBranch ?? "main"
  );
  const [remotePath, setRemotePath] = useState(binding?.remotePath ?? "/");

  useEffect(() => {
    if (
      repositories.length > 0 &&
      !repositories.some((repo) => repo.fullName === selectedFullName)
    ) {
      const boundFullName = binding ? `${binding.owner}/${binding.repo}` : "";
      setSelectedFullName(
        repositories.some((repo) => repo.fullName === boundFullName)
          ? boundFullName
          : repositories[0].fullName
      );
    }
  }, [binding, repositories, selectedFullName]);

  useEffect(() => {
    if (selectedRepository) {
      if (
        binding &&
        selectedRepository.owner === binding.owner &&
        selectedRepository.name === binding.repo
      ) {
        setBranch(binding.branch);
      } else {
        setBranch(selectedRepository.defaultBranch);
      }
    }
  }, [binding, selectedRepository]);

  useEffect(() => {
    if (binding) {
      setRemotePath(binding.remotePath);
    }
  }, [binding]);

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <form
        className="create-dialog repository-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (selectedRepository) {
            onLink({
              provider: account.provider,
              owner: selectedRepository.owner,
              repo: selectedRepository.name,
              branch,
              remotePath,
              baseUrl: account.baseUrl
            });
          }
        }}
      >
        <header>
          <h2>{t("cloud.settingsTitle")}</h2>
          <p>
            {repositoryProviderLabel(account.provider)} account: {account.login}
          </p>
          <p className="repository-workspace-path">{workspaceRoot}</p>
        </header>
        <label>
          {t("cloud.repository")}
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
        {isBusy && repositories.length === 0 ? (
          <p className="repository-dialog-note">{t("cloud.loadingRepositories")}</p>
        ) : null}
        {!isBusy && repositories.length === 0 ? (
          <p className="repository-dialog-error" role="alert">
            {errorMessage || t("cloud.noRepositories")}
          </p>
        ) : errorMessage ? (
          <p className="repository-dialog-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <label>
          {t("cloud.branch")}
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
        </label>
        <label>
          {t("cloud.remoteFolder")}
          <input
            value={remotePath}
            placeholder="/"
            onChange={(event) => setRemotePath(event.target.value)}
          />
        </label>
        <footer>
          <button type="button" disabled={isBusy} onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={isBusy || !selectedRepository || !branch.trim()}
          >
            {t("cloud.saveSettings")}
          </button>
        </footer>
      </form>
    </section>
  );
}

export function RepositoryOperationDialog({
  title,
  message,
  isBusy,
  onClose
}: {
  title: string;
  message: string;
  isBusy: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (isBusy) {
    return (
      <aside className="repository-operation-toast" role="status" aria-live="polite">
        <strong>{title}</strong>
        <span className="repository-operation-message">{message}</span>
        <div className="repository-operation-progress" aria-hidden="true" />
      </aside>
    );
  }

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <div className="create-dialog repository-dialog repository-operation-dialog">
        <header>
          <h2>{title}</h2>
          <p role="alert">{message}</p>
        </header>
        <footer>
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </footer>
      </div>
    </section>
  );
}

export function RepositorySyncStatusDialog({
  status,
  onClose,
  onSync
}: {
  status: RepositorySyncStatus;
  onClose: () => void;
  onSync: () => void;
}) {
  const { t } = useI18n();
  const binding = status.binding;

  return (
    <section className="create-dialog-overlay" role="dialog" aria-modal="true">
      <div className="create-dialog repository-dialog">
        <header>
          <h2>{t("cloud.statusTitle")}</h2>
          <p>
            {t("cloud.provider")}: {binding ? repositoryProviderLabel(binding.provider) : t("cloud.notLinked")}
          </p>
        </header>
        <dl className="repository-status-grid">
          <dt>{t("cloud.account")}</dt>
          <dd>{status.account?.login ?? t("cloud.notConnected")}</dd>
          <dt>{t("cloud.repository")}</dt>
          <dd>{binding ? `${binding.owner}/${binding.repo}` : t("cloud.notLinked")}</dd>
          <dt>{t("cloud.branch")}</dt>
          <dd>{binding?.branch ?? "-"}</dd>
          <dt>{t("cloud.remoteFolder")}</dt>
          <dd>{binding?.remotePath ?? "-"}</dd>
          <dt>{t("cloud.lastSync")}</dt>
          <dd>{formatSyncTime(binding?.lastSyncAt)}</dd>
          <dt>{t("cloud.localChanges")}</dt>
          <dd>{status.localChanges}</dd>
          <dt>{t("cloud.remoteChanged")}</dt>
          <dd>{status.remoteChanged ? t("cloud.yes") : t("cloud.no")}</dd>
          <dt>{t("cloud.conflicts")}</dt>
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
            <button type="button" onClick={onSync}>
              {t("common.sync")}
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            {t("common.close")}
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
