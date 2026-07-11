import { invoke } from "@tauri-apps/api/core";

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
  return invoke<RepositoryAccount>("repository_connect_provider", {
    request: params
  });
}

export async function disconnectRepositoryProvider(): Promise<void> {
  await invoke("repository_disconnect_provider");
}

export async function getRepositoryAccount(): Promise<RepositoryAccount | null> {
  return invoke<RepositoryAccount | null>("repository_get_account");
}

export async function listRepositories(): Promise<RepositoryInfo[]> {
  return invoke<RepositoryInfo[]>("repository_list_repositories");
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
  return invoke<RepositoryBinding>("repository_link_workspace", {
    request: params
  });
}

export async function getWorkspaceRepositoryBinding(
  workspaceRef: string
): Promise<RepositoryBinding | null> {
  return invoke<RepositoryBinding | null>("repository_get_workspace_binding", {
    workspaceRef
  });
}

export async function getRepositorySyncStatus(params: {
  workspaceRef: string;
  dirty: boolean;
}): Promise<RepositorySyncStatus> {
  return invoke<RepositorySyncStatus>("repository_get_sync_status", {
    request: params
  });
}

export async function pushWorkspace(params: {
  workspaceRef: string;
  dirty: boolean;
}): Promise<RepositorySyncStatus> {
  return invoke<RepositorySyncStatus>("repository_push_workspace", {
    request: params
  });
}

export async function pullWorkspace(params: {
  workspaceRef: string;
  dirty: boolean;
}): Promise<RepositorySyncStatus> {
  return invoke<RepositorySyncStatus>("repository_pull_workspace", {
    request: params
  });
}

export async function syncWorkspaceNow(params: {
  workspaceRef: string;
  dirty: boolean;
}): Promise<RepositorySyncStatus> {
  return invoke<RepositorySyncStatus>("repository_sync_now", {
    request: params
  });
}

export function repositoryProviderLabel(provider?: string | null): string {
  return provider === "gitlab" ? "GitLab" : "GitHub";
}
