import { TAURI_COMMANDS } from "../../shared/tauri/commandIds";
import { invokeTauri } from "../../shared/tauri/invokeTauri";

export type RepositoryProvider = "github" | "gitlab";

export type RepositoryAccount = {
  provider: RepositoryProvider;
  accountId: string;
  login: string;
  avatarUrl?: string | null;
  baseUrl?: string | null;
  connectedAt: number;
};

export type RepositoryInfo = {
  provider: RepositoryProvider;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

export type RepositoryBinding = {
  workspaceRef: string;
  provider: RepositoryProvider;
  owner: string;
  repo: string;
  branch: string;
  remotePath: string;
  baseUrl?: string | null;
  lastSyncCommitSha?: string | null;
  lastSyncAt?: number | null;
  hasSynced?: boolean;
  manifest: Record<string, string>;
};

export type RepositorySyncStatus = {
  account?: RepositoryAccount | null;
  binding?: RepositoryBinding | null;
  localChanges: number;
  remoteChanged: boolean;
  conflicts: string[];
};

export type RepositorySyncProgress = {
  phase: string;
  message: string;
  current?: number | null;
  total?: number | null;
};

export async function connectRepositoryProvider(params: {
  provider: RepositoryProvider;
  token: string;
  baseUrl?: string;
}): Promise<RepositoryAccount> {
  return invokeTauri<RepositoryAccount>(TAURI_COMMANDS.repositoryConnectProvider, {
    request: params
  });
}

export async function disconnectRepositoryProvider(): Promise<void> {
  await invokeTauri(TAURI_COMMANDS.repositoryDisconnectProvider);
}

export async function getRepositoryAccount(): Promise<RepositoryAccount | null> {
  return invokeTauri<RepositoryAccount | null>(TAURI_COMMANDS.repositoryGetAccount);
}

export async function listRepositories(): Promise<RepositoryInfo[]> {
  return invokeTauri<RepositoryInfo[]>(TAURI_COMMANDS.repositoryListRepositories);
}

export async function linkWorkspaceToRepository(params: {
  workspaceRef: string;
  provider: RepositoryProvider;
  owner: string;
  repo: string;
  branch: string;
  remotePath: string;
  baseUrl?: string | null;
}): Promise<RepositoryBinding> {
  return invokeTauri<RepositoryBinding>(TAURI_COMMANDS.repositoryLinkWorkspace, {
    request: params
  });
}

export async function getWorkspaceRepositoryBinding(
  workspaceRef: string
): Promise<RepositoryBinding | null> {
  return invokeTauri<RepositoryBinding | null>(TAURI_COMMANDS.repositoryGetWorkspaceBinding, {
    workspaceRef
  });
}

export async function getRepositorySyncStatus(params: {
  workspaceRef: string;
  dirty: boolean;
}): Promise<RepositorySyncStatus> {
  return invokeTauri<RepositorySyncStatus>(TAURI_COMMANDS.repositoryGetSyncStatus, {
    request: params
  });
}

export async function pushWorkspace(params: {
  workspaceRef: string;
  dirty: boolean;
}): Promise<RepositorySyncStatus> {
  return invokeTauri<RepositorySyncStatus>(TAURI_COMMANDS.repositoryPushWorkspace, {
    request: params
  });
}

export async function pullWorkspace(params: {
  workspaceRef: string;
  dirty: boolean;
}): Promise<RepositorySyncStatus> {
  return invokeTauri<RepositorySyncStatus>(TAURI_COMMANDS.repositoryPullWorkspace, {
    request: params
  });
}

export async function syncWorkspaceNow(params: {
  workspaceRef: string;
  dirty: boolean;
}): Promise<RepositorySyncStatus> {
  return invokeTauri<RepositorySyncStatus>(TAURI_COMMANDS.repositorySyncNow, {
    request: params
  });
}

export function repositoryProviderLabel(provider?: string | null): string {
  return provider === "gitlab" ? "GitLab" : "GitHub";
}
