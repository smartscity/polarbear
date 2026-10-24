import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { errorMessage } from "../../shared/tauri/invokeTauri";
import {
  getRepositoryAccount, getWorkspaceRepositoryBinding, isRepositoryCleanupPending,
  type RepositoryAccount, type RepositoryBinding,
} from "./repositoryApi";

/** Owns the UI projection, not provider credentials or native binding storage. */
export function useRepositoryIdentity(workspaceRoot: string, onError: (message: string) => void) {
  const [identity, storeIdentity] = useState<{ account: RepositoryAccount | null; cleanupPending: boolean }>({ account: null, cleanupPending: false });
  const [binding, storeBinding] = useState<{ owner: object; value: RepositoryBinding | null } | null>(null);
  const owner = useMemo(() => ({ workspaceRoot, active: false, revision: 0 }), [workspaceRoot]);
  const reportError = useEventCallback(onError);

  useLayoutEffect(() => {
    owner.active = true;
    return () => { owner.active = false; owner.revision += 1; };
  }, [owner]);

  const setRepositoryAccount = useCallback((account: RepositoryAccount | null) => {
    if (!owner.active) return;
    owner.revision += 1;
    storeIdentity({ account, cleanupPending: false });
  }, [owner]);

  const markRepositoryCleanupPending = useCallback(() => {
    if (!owner.active) return;
    owner.revision += 1;
    storeIdentity({ account: null, cleanupPending: true });
    storeBinding(null);
  }, [owner]);

  const setRepositoryBinding = useCallback((value: RepositoryBinding | null) => {
    if (!owner.active) return;
    owner.revision += 1;
    storeBinding({ owner, value });
  }, [owner]);

  useEffect(() => {
    const revision = ++owner.revision;
    const current = () => owner.active && owner.revision === revision;
    void (async () => {
      try {
        const account = await getRepositoryAccount();
        if (!current()) return;
        const value = owner.workspaceRoot ? await getWorkspaceRepositoryBinding(owner.workspaceRoot) : null;
        if (!current()) return;
        storeIdentity({ account, cleanupPending: false });
        storeBinding({ owner, value });
      } catch (error) {
        if (current()) {
          if (isRepositoryCleanupPending(error)) markRepositoryCleanupPending();
          reportError(errorMessage(error));
        }
      }
    })();
    return () => { owner.revision += 1; };
  }, [owner, reportError, markRepositoryCleanupPending]);

  return {
    repositoryAccount: identity.account,
    repositoryCleanupPending: identity.cleanupPending,
    markRepositoryCleanupPending,
    repositoryBinding: binding?.owner === owner ? binding.value : null,
    setRepositoryAccount,
    setRepositoryBinding,
  };
}
