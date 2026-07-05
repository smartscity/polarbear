import { invoke } from "@tauri-apps/api/core";

export type RepositoryAccount = {
  provider: string;
  accountId: string;
  login: string;
  avatarUrl?: string | null;
  connectedAt: number;
};

export type GithubRepository = {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

export type RepositoryBinding = {
  workspaceRef: string;
  provider: string;
  owner: string;
  repo: string;
  branch: string;
  remotePath: string;
  lastSyncCommitSha?: string | null;
  lastSyncAt?: number | null;
  manifest: Record<string, string>;
};

export type RepositorySyncStatus = {
  account?: RepositoryAccount | null;
  binding?: RepositoryBinding | null;
  localChanges: number;
  remoteChanged: boolean;
  conflicts: string[];
};

export async function validateGithubToken(
  token: string
): Promise<RepositoryAccount> {
  return invoke<RepositoryAccount>("repository_validate_github_token", {
    request: { token }
  });
}

export async function disconnectGithub(): Promise<void> {
  await invoke("repository_disconnect_github");
}

export async function getRepositoryAccount(): Promise<RepositoryAccount | null> {
  return invoke<RepositoryAccount | null>("repository_get_account");
}

export async function listGithubRepositories(): Promise<GithubRepository[]> {
  return invoke<GithubRepository[]>("repository_list_github_repositories");
}

export async function linkWorkspaceToGithub(params: {
  workspaceRef: string;
  owner: string;
  repo: string;
  branch: string;
  remotePath: string;
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
