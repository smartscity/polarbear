import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { type CreateItemType } from "../../features/workspace/components/CreateItemDialog";
import { DocumentReadRequests, type DocumentReadSnapshot, type DocumentReloadResult } from "../../features/workspace/documentReadRequests";
import { useEventCallback } from "../../shared/hooks/useEventCallback";
import { quitApp } from "../../shared/tauri/quitApp";
import { deriveDefaultMarkdownFileName, displayNameForDocumentId, documentRelativePathForId, documentWorkspaceRootForId, findOpenDocumentIdForWorkspaceFile, isUntitledDocument, makeWorkspaceDocumentId, parentFolderIdOf } from "../../features/editor/documentModel";
import { findWorkspaceItem, workspaceTreesEqual, type WorkspaceDocumentMap, type WorkspaceItem } from "../../features/workspace/workspaceModel";
import { useWorkspaceDocumentRevision, type WorkspaceDocumentRevisionTarget } from "../../features/workspace/useWorkspaceDocumentRevision";
import { ensureMarkdownFilePath, fileNameOf, findFirstFile, joinWorkspacePath, normalizeMarkdownFileName, normalizeWorkspacePath, parentPathOf, remapPath } from "../../features/workspace/workspacePaths";
import { WorkspacePathMutations, remapWorkspaceDocumentPaths, remapWorkspaceTree } from "./workspacePathMutations";
import { chooseMarkdownFile, chooseMarkdownSavePath, chooseWorkspaceFolder, createMarkdownFile, createWorkspaceDirectory, deleteWorkspaceEntry, duplicateWorkspaceEntry, listWorkspaceFiles, loadMarkdownFile, moveEntry, openMarkdownFile, renameEntry, saveMarkdownFile, takePendingOpenFiles, writeMarkdownFile, type MarkdownSaveResult } from "../../features/workspace/tauriWorkspaceAdapter";
import { workspaceDocumentSaveConflict, workspaceSaveFailureKey } from "../../features/workspace/workspaceSaveError";
import { saveWorkspaceDocuments } from "../../features/workspace/saveWorkspaceDocuments";
import { DocumentNavigation } from "../../features/workspace/documentNavigation";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { useWorkspaceFileTreeRefresh } from "../../features/workspace/useWorkspaceFileTreeRefresh";
import { APP_EVENTS } from "../../shared/events/appEvents";
import { recentDocumentStore, documentHistoryPath } from "../../features/workspace/recentDocuments";
import type { Dispatch, SetStateAction } from "react";

const initialWorkspace: WorkspaceItem[] = [];

const initialDocuments: WorkspaceDocumentMap = {
  "untitled:1": "",
};

type ExternalDocumentChange = WorkspaceDocumentRevisionTarget & {
  reason: "changed" | "deleted";
};

type ExternalDocumentReference = Pick<
  WorkspaceDocumentRevisionTarget,
  "fileId" | "relativePath" | "workspaceRoot"
>;

type DocumentSessionOptions = {
  onStatus: Dispatch<SetStateAction<string>>;
  onDocumentOpened: () => void;
  onSessionEmpty: () => void;
  onReload: () => void;
};

/** Owns document buffers and identities across native IO and workspace navigation. */
export function useDocumentSession({
  onStatus: setStatusMessage, onDocumentOpened, onSessionEmpty, onReload: requestCanvasViewportSync,
}: DocumentSessionOptions) {
  const { t } = useI18n();
  const lastSavedFileIdRef = useRef<string | null>(null);

  const systemOpenQueueRef = useRef<Promise<void>>(Promise.resolve());

  const [workspaceItems, setWorkspaceItems] = useState(initialWorkspace);
  const [workspaceItemsByRoot, setWorkspaceItemsByRoot] = useState<Record<string, WorkspaceItem[]>>({});
  const [documents, setDocuments] = useState(initialDocuments);
  const [documentNavigation] = useState(() => new DocumentNavigation());
  const [documentReads] = useState(() => new DocumentReadRequests());
  useEffect(() => () => documentNavigation.invalidate(), [documentNavigation]);
  const savesInProgressRef = useRef(new Set<string>());
  const [pathMutations] = useState(() => new WorkspacePathMutations());
  const treeReadPermission = useCallback(() => pathMutations.readPermission(), [pathMutations]);
  const rejectDuringPathMutation = () => {
    if (!pathMutations.isBusy()) return false;
    setStatusMessage(t("status.workspaceOperationBusy"));
    return true;
  };
  const getCurrentDocument = useEventCallback((fileId: string) => documents[fileId]);
  const [documentRevisions, setDocumentRevisions] = useState<Record<string, string>>({});
  const [activeFileId, setActiveFileId] = useState("untitled:1");
  const [openFileIds, setOpenFileIds] = useState<string[]>(["untitled:1"]);
  const [documentWorkspaceRoots, setDocumentWorkspaceRoots] = useState<Record<string, string>>({});
  const [documentRelativePaths, setDocumentRelativePaths] = useState<Record<string, string>>({});
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>(
    () => ({ "untitled:1": t("top.untitled") }),
  );
  const [untitledCounter, setUntitledCounter] = useState(1);

  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const workspaceRootRef = useRef(workspaceRoot);
  useLayoutEffect(() => {
    workspaceRootRef.current = workspaceRoot;
  }, [workspaceRoot]);
  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());
  const hasDirtyPath = useEventCallback((root: string, path: string) => [...dirtyFileIds].some((id) =>
    documentWorkspaceRootForId(id, documentWorkspaceRoots, workspaceRoot) === root
    && (documentRelativePathForId(id, documentRelativePaths) === path
      || documentRelativePathForId(id, documentRelativePaths).startsWith(`${path}/`))));
  useLayoutEffect(() => {
    const snapshots = new Map<string, DocumentReadSnapshot>();
    for (const fileId of openFileIds) {
      if (documents[fileId] === undefined || isUntitledDocument(fileId)) continue;
      snapshots.set(fileId, {
        content: documents[fileId],
        revision: documentRevisions[fileId] ?? "",
        workspaceRoot: documentWorkspaceRootForId(fileId, documentWorkspaceRoots, workspaceRoot) ?? "",
        relativePath: documentRelativePathForId(fileId, documentRelativePaths),
      });
    }
    documentReads.reconcile(snapshots);
  }, [documentReads, documents, documentRevisions, documentWorkspaceRoots, documentRelativePaths, openFileIds, workspaceRoot]);
  useLayoutEffect(() => () => documentReads.clear(), [documentReads]);
  const [collapseVersion, setCollapseVersion] = useState(0);
  const [folderRevealRequest, setFolderRevealRequest] = useState<{
    folderId: string;
    version: number;
  } | null>(null);
  const [selectedTreeItemId, setSelectedTreeItemId] = useState("");
  const [createItemType, setCreateItemType] = useState<CreateItemType | null>(
    null,
  );
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const [renameItemId, setRenameItemId] = useState<string | null>(null);
  const [externalDocumentChange, setExternalDocumentChange] =
    useState<ExternalDocumentChange | null>(null);

  const quitRequestedRef = useRef(false);
  const dirtyFileIdsRef = useRef(dirtyFileIds);
  const openFileIdsRef = useRef(openFileIds);
  const activeFileIdRef = useRef(activeFileId);
  useLayoutEffect(() => { activeFileIdRef.current = activeFileId; }, [activeFileId]);

  useEffect(() => {
    dirtyFileIdsRef.current = dirtyFileIds;
  }, [dirtyFileIds]);

  useEffect(() => {
    openFileIdsRef.current = openFileIds;
  }, [openFileIds]);


  const handleWorkspaceFileTreeRefresh = useCallback(
    (refreshedWorkspaceRoot: string, items: WorkspaceItem[]) => {
      if (pathMutations.affects(refreshedWorkspaceRoot) || workspaceRootRef.current !== refreshedWorkspaceRoot) return;
      setWorkspaceItems((currentItems) =>
        workspaceTreesEqual(currentItems, items) ? currentItems : items,
      );
      setWorkspaceItemsByRoot((currentTrees) => {
        const currentItems = currentTrees[refreshedWorkspaceRoot] ?? [];
        return workspaceTreesEqual(currentItems, items)
          ? currentTrees
          : { ...currentTrees, [refreshedWorkspaceRoot]: items };
      });
    },
    [pathMutations],
  );

  const reloadDocumentFromDisk = useEventCallback(
    async (changedDocument: WorkspaceDocumentRevisionTarget, discardAcceptedSnapshot = false): Promise<DocumentReloadResult> => {
      if (pathMutations.affects(changedDocument.workspaceRoot)) return { status: "superseded" };
      const request = documentReads.begin(changedDocument.fileId, {
        ...changedDocument,
        revision: discardAcceptedSnapshot ? undefined : changedDocument.revision,
      });
      if (!request) return { status: "superseded" };

      const reportConflict = () => {
        if (!request.isSameDocument()) return;
        setExternalDocumentChange({ ...changedDocument, reason: "changed" });
        setStatusMessage(
          t("status.externalFileChanged", { path: changedDocument.relativePath }),
        );
      };
      if (!discardAcceptedSnapshot && dirtyFileIdsRef.current.has(changedDocument.fileId)) {
        reportConflict();
        return { status: "conflict" };
      }

      try {
        const reloaded = await loadMarkdownFile({
          workspaceRoot: changedDocument.workspaceRoot,
          relativePath: changedDocument.relativePath,
        });
        if (!request.take()) {
          if (!discardAcceptedSnapshot && request.isSameDocument() && dirtyFileIdsRef.current.has(changedDocument.fileId)) {
            reportConflict();
            return { status: "conflict" };
          }
          return { status: "superseded" };
        }
        setDocuments((currentDocuments) => ({
          ...currentDocuments,
          [changedDocument.fileId]: reloaded.markdownContent,
        }));
        setDocumentRevisions((currentRevisions) => ({
          ...currentRevisions,
          [changedDocument.fileId]: reloaded.revision,
        }));
        requestCanvasViewportSync();
        if (discardAcceptedSnapshot) {
          setDirtyFileIds((current) => {
            const next = new Set(current);
            next.delete(changedDocument.fileId);
            return next;
          });
          setExternalDocumentChange((current) => current?.fileId === changedDocument.fileId ? null : current);
        }
        setStatusMessage(
          t("status.externalFileReloaded", { path: changedDocument.relativePath }),
        );
        return { status: "reloaded" };
      } catch (error) {
        if (!request.take()) return { status: "superseded" };
        setStatusMessage(error instanceof Error ? error.message : String(error));
        return { status: "failed", error };
      }
    },
  );

  const reloadExternalDocumentFromDisk = () => externalDocumentChange
    ? reloadDocumentFromDisk(externalDocumentChange, true)
    : Promise.resolve();

  const keepEditingExternalDocument = () => {
    if (externalDocumentChange) documentReads.invalidate(externalDocumentChange.fileId);
    setExternalDocumentChange(null);
  };

  const handleExternalDocumentMissing = useEventCallback(
    (deletedDocument: WorkspaceDocumentRevisionTarget) => {
      if (pathMutations.affects(deletedDocument.workspaceRoot)) return;
      if (!openFileIds.includes(deletedDocument.fileId)
        || documentRelativePathForId(deletedDocument.fileId, documentRelativePaths) !== deletedDocument.relativePath
        || documentWorkspaceRootForId(deletedDocument.fileId, documentWorkspaceRoots, workspaceRoot) !== deletedDocument.workspaceRoot) return;
      setExternalDocumentChange({ ...deletedDocument, reason: "deleted" });
      setStatusMessage(
        t("status.externalFileDeleted", { path: deletedDocument.relativePath }),
      );
    },
  );

  const reportDocumentSaveError = useCallback(
    (error: unknown, document: ExternalDocumentReference) => {
      const failureKey = workspaceSaveFailureKey(error);
      if (failureKey) {
        setStatusMessage(t(failureKey, { path: document.relativePath }));
        return;
      }
      const reason = workspaceDocumentSaveConflict(error);

      if (reason) {
        if (document.fileId === activeFileId) {
          setExternalDocumentChange({
            ...document,
            reason,
            revision: documentRevisions[document.fileId] ?? "",
          });
        }
        setStatusMessage(
          reason === "changed"
            ? t("status.externalFileChanged", { path: document.relativePath })
            : t("status.externalFileDeleted", { path: document.relativePath }),
        );
        return;
      }

      setStatusMessage(error instanceof Error ? error.message : String(error));
    },
    [activeFileId, documentRevisions, setStatusMessage, t],
  );

  const activeDocumentRevisionTarget = useMemo<WorkspaceDocumentRevisionTarget | null>(() => {
    const activeDocumentWorkspaceRoot = documentWorkspaceRootForId(
      activeFileId,
      documentWorkspaceRoots,
      workspaceRoot,
    );
    const activeDocumentRelativePath = documentRelativePathForId(
      activeFileId,
      documentRelativePaths,
    );
    const revision = documentRevisions[activeFileId];

    if (
      isUntitledDocument(activeFileId) ||
      !activeDocumentWorkspaceRoot ||
      !activeDocumentRelativePath ||
      !revision
    ) {
      return null;
    }

    return {
      fileId: activeFileId,
      relativePath: activeDocumentRelativePath,
      revision,
      workspaceRoot: activeDocumentWorkspaceRoot,
    };
  }, [
    activeFileId,
    documentRelativePaths,
    documentRevisions,
    documentWorkspaceRoots,
    workspaceRoot,
  ]);

  useWorkspaceFileTreeRefresh({
    workspaceRoot,
    onRefresh: handleWorkspaceFileTreeRefresh,
    readPermission: treeReadPermission,
  });
  useWorkspaceDocumentRevision({
    document: activeDocumentRevisionTarget,
    onChanged: reloadDocumentFromDisk,
    onMissing: handleExternalDocumentMissing,
  });

  const markdownContent = documents[activeFileId] ?? "";
  const activeRelativePath = documentRelativePathForId(activeFileId, documentRelativePaths);
  const activeDocumentRoot = documentWorkspaceRootForId(activeFileId, documentWorkspaceRoots, workspaceRoot);
  const activeDocumentLoaded = documents[activeFileId] !== undefined;
  const recordRecentDocument = useEventCallback((path: string) => {
    try { recentDocumentStore().record(path); }
    catch { setStatusMessage(t("recent.storageFailed")); }
  });
  useEffect(() => {
    if (!activeDocumentRoot || !activeDocumentLoaded || isUntitledDocument(activeFileId)) return;
    recordRecentDocument(documentHistoryPath(activeDocumentRoot, activeRelativePath));
  }, [activeFileId, activeDocumentRoot, activeRelativePath, activeDocumentLoaded, recordRecentDocument]);
  const activeFileName = displayNameForDocumentId(
    activeFileId,
    workspaceItems,
    documentTitles,
    documentRelativePaths,
    t("top.untitled"),
  );


  const isDirty = dirtyFileIds.has(activeFileId);
  const dirtyWorkspacePaths = new Set([...dirtyFileIds]
    .filter((id) => documentWorkspaceRootForId(id, documentWorkspaceRoots, workspaceRoot) === workspaceRoot)
    .map((id) => documentRelativePathForId(id, documentRelativePaths)));

  const openTabs = openFileIds
    .filter((fileId) => documents[fileId] !== undefined || findWorkspaceItem(workspaceItems, fileId))
    .map((fileId) => {
      return {
        id: fileId,
        isDirty: dirtyFileIds.has(fileId),
        name: displayNameForDocumentId(
          fileId,
          workspaceItems,
          documentTitles,
          documentRelativePaths,
          t("top.untitled"),
        ),
      };
    });


  const addOpenTab = useCallback((fileId: string) => {
    if (!fileId) {
      return;
    }

    setOpenFileIds((currentFileIds) =>
      currentFileIds.includes(fileId)
        ? currentFileIds
        : [...currentFileIds, fileId],
    );
  }, []);


  const updateActiveDocument = (value: string) => {
    if (!activeFileId) {
      setStatusMessage(t("status.selectDocumentBeforeWriting"));
      return;
    }

    documentReads.invalidate(activeFileId);
    setDocuments((currentDocuments) => ({
      ...currentDocuments,
      [activeFileId]: value,
    }));
    setDirtyFileIds((currentDirtyFileIds) => {
      const nextDirtyFileIds = new Set(currentDirtyFileIds);
      nextDirtyFileIds.add(activeFileId);
      return nextDirtyFileIds;
    });
  };


  const loadWorkspace = async (nextWorkspaceRoot: string): Promise<boolean> => {
    if (rejectDuringPathMutation()) return false;
    const isCurrent = documentNavigation.begin();
    const hasUnsavedDocuments = () => {
      if (dirtyFileIdsRef.current.size === 0) return false;
      setStatusMessage(t("status.workspaceOpenUnsaved"));
      return true;
    };
    if (hasUnsavedDocuments()) return false;
    try {
      const items = await listWorkspaceFiles(nextWorkspaceRoot);
      if (!isCurrent()) return false;
      const firstFile = findFirstFile(items);
      const document = firstFile ? await loadMarkdownFile({
        workspaceRoot: nextWorkspaceRoot,
        relativePath: firstFile.id,
      }) : null;
      if (!isCurrent()) return false;
      if (hasUnsavedDocuments()) return false;

      setWorkspaceRoot(nextWorkspaceRoot);
      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [nextWorkspaceRoot]: items,
      }));
      setDocuments({});
      setDocumentRevisions({});
      setDocumentWorkspaceRoots({});
      setDocumentRelativePaths({});
      setDirtyFileIds(new Set());
      setSelectedTreeItemId("");
      setStatusMessage(t("status.openedWorkspace", { path: nextWorkspaceRoot }));

      if (firstFile && document) {
        setDocuments({ [firstFile.id]: document.markdownContent });
        setDocumentRevisions({ [firstFile.id]: document.revision });
        setDocumentWorkspaceRoots({ [firstFile.id]: nextWorkspaceRoot });
        setDocumentRelativePaths({ [firstFile.id]: firstFile.id });
        setActiveFileId(firstFile.id);
        setOpenFileIds([firstFile.id]);
        setSelectedTreeItemId(firstFile.id);
      } else {
        setActiveFileId("");
        setOpenFileIds([]);
      }

      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const openWorkspace = async () => {
    try {
      const selectedFolder = await chooseWorkspaceFolder();

      if (!selectedFolder) {
        setStatusMessage(t("status.openWorkspaceCancelled"));
        return;
      }

      void loadWorkspace(selectedFolder);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openMarkdownPath = useEventCallback(async (filePath: string) => {
    const isCurrent = documentNavigation.begin();
    try {
      const openedFile = await openMarkdownFile(filePath);
      if (!isCurrent()) return null;
      if (pathMutations.affects(openedFile.workspaceRoot)) { rejectDuringPathMutation(); return null; }
      const openedPath = documentHistoryPath(openedFile.workspaceRoot, openedFile.relativePath);
      const samePathTab = openFileIdsRef.current.find((id) => !isUntitledDocument(id)
        && documentHistoryPath(documentWorkspaceRootForId(id, documentWorkspaceRoots, workspaceRoot), documentRelativePathForId(id, documentRelativePaths)) === openedPath);
      if (samePathTab) {
        onDocumentOpened();
        if (!await activateTab(samePathTab)) return false;
        recordRecentDocument(openedPath);
        return true;
      }

      onDocumentOpened();
      setWorkspaceRoot(openedFile.workspaceRoot);
      setWorkspaceItems(openedFile.tree);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [openedFile.workspaceRoot]: openedFile.tree,
      }));

      const documentId = makeWorkspaceDocumentId({
        currentDocumentIds: new Set([...openFileIdsRef.current, ...Object.keys(documents)]),
        currentWorkspaceRoot: workspaceRoot,
        relativePath: openedFile.relativePath,
        workspaceRoot: openedFile.workspaceRoot,
      });
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        [documentId]: openedFile.markdownContent,
      }));
      setDocumentRevisions((currentRevisions) => ({
        ...currentRevisions,
        [documentId]: openedFile.revision,
      }));
      setDocumentWorkspaceRoots((currentRoots) => ({
        ...currentRoots,
        [documentId]: openedFile.workspaceRoot,
      }));
      setDocumentRelativePaths((currentPaths) => ({
        ...currentPaths,
        [documentId]: openedFile.relativePath,
      }));
      setActiveFileId(documentId);
      addOpenTab(documentId);
      setSelectedTreeItemId(openedFile.relativePath);
      setDirtyFileIds((currentDirtyFileIds) => {
        const nextDirtyFileIds = new Set(currentDirtyFileIds);
        nextDirtyFileIds.delete(documentId);
        return nextDirtyFileIds;
      });
      setStatusMessage(t("status.openedPath", { path: openedFile.relativePath }));
      return true;
    } catch (error) {
      if (!isCurrent()) return null;
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  });

  const openFile = async () => {
    try {
      const selectedFile = await chooseMarkdownFile();

      if (!selectedFile) {
        setStatusMessage(t("status.openFileCancelled"));
        return;
      }

      await openMarkdownPath(selectedFile);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlistenOpenFiles: UnlistenFn | null = null;

    const drainSystemOpenQueue = () => {
      systemOpenQueueRef.current = systemOpenQueueRef.current.then(async () => {
        const filePaths = await takePendingOpenFiles();
        for (const filePath of filePaths) {
          await openMarkdownPath(filePath);
        }
      }).catch((error: unknown) => {
        if (!disposed) {
          setStatusMessage(error instanceof Error ? error.message : String(error));
        }
      });
    };

    void listen(APP_EVENTS.openFilesRequested, drainSystemOpenQueue)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenOpenFiles = unlisten;
        drainSystemOpenQueue();
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setStatusMessage(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      disposed = true;
      unlistenOpenFiles?.();
    };
  }, [openMarkdownPath, setStatusMessage]);

  const dirtyDocumentIdsForWorkspace = useEventCallback((targetWorkspaceRoot: string): string[] =>
    Array.from(dirtyFileIds).filter((fileId) => {
      if (isUntitledDocument(fileId)) {
        return false;
      }
      return (
        documentWorkspaceRootForId(
          fileId,
          documentWorkspaceRoots,
          workspaceRoot,
        ) === targetWorkspaceRoot
      );
    }));

  const saveDirtyDocumentsForWorkspace = (targetWorkspaceRoot: string) =>
    saveWorkspaceDocuments({
      getDirtyDocumentIds: () => dirtyDocumentIdsForWorkspace(targetWorkspaceRoot),
      getContent: getCurrentDocument,
      saveDocument: async (fileId) => Boolean(await saveTab(fileId)),
    });

  const reloadOpenWorkspaceDocuments = useEventCallback(async (targetWorkspaceRoot: string, items: WorkspaceItem[]) => {
    const reloadableDocuments = openFileIds.filter((fileId) => {
      const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
      return (
        !isUntitledDocument(fileId) &&
        documentWorkspaceRootForId(
          fileId,
          documentWorkspaceRoots,
          workspaceRoot,
        ) === targetWorkspaceRoot &&
        Boolean(findWorkspaceItem(items, relativePath))
      );
    });
    const results = await Promise.all(
      reloadableDocuments.map(async (fileId) => {
        const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
        return reloadDocumentFromDisk({
          fileId,
          revision: documentRevisions[fileId] ?? "",
          workspaceRoot: targetWorkspaceRoot,
          relativePath,
        });
      }),
    );
    for (const result of results) {
      if (result.status === "failed") throw result.error;
    }
    return results.some((result) => result.status === "conflict");
  });

  const reloadWorkspaceAfterDownload = async (targetWorkspaceRoot: string) => {
    const items = await listWorkspaceFiles(targetWorkspaceRoot);
    if (targetWorkspaceRoot === workspaceRootRef.current) {
      setWorkspaceItems(items);
    }
    setWorkspaceItemsByRoot((currentTrees) => ({
      ...currentTrees,
      [targetWorkspaceRoot]: items,
    }));
    return reloadOpenWorkspaceDocuments(targetWorkspaceRoot, items);
  };


  const createUntitledDocument = () => {
    documentNavigation.invalidate();
    const nextUntitledNumber = untitledCounter + 1;
    const baseTitle = t("top.untitled");
    const title =
      nextUntitledNumber === 1
        ? baseTitle
        : `${baseTitle} ${nextUntitledNumber}`;
    const documentId = `untitled:${nextUntitledNumber}`;

    setUntitledCounter(nextUntitledNumber);
    setDocuments((currentDocuments) => ({
      ...currentDocuments,
      [documentId]: "",
    }));
    setDocumentTitles((currentTitles) => ({
      ...currentTitles,
      [documentId]: title,
    }));
    setActiveFileId(documentId);
    setOpenFileIds((currentFileIds) => [...currentFileIds, documentId]);
    setDirtyFileIds((currentDirtyFileIds) => {
      const nextDirtyFileIds = new Set(currentDirtyFileIds);
      nextDirtyFileIds.add(documentId);
      return nextDirtyFileIds;
    });
    setStatusMessage(t("status.createdPath", { path: title }));
  };

  const selectFile = async (fileId: string) => {
    if (rejectDuringPathMutation()) return;
    const isCurrent = documentNavigation.begin();
    const documentId = findOpenDocumentIdForWorkspaceFile(
      openFileIds,
      documentWorkspaceRoots,
      documentRelativePaths,
      workspaceRoot,
      fileId,
    ) ?? makeWorkspaceDocumentId({
      currentDocumentIds: new Set([...openFileIds, ...Object.keys(documents)]),
      currentWorkspaceRoot: workspaceRoot,
      relativePath: fileId,
      workspaceRoot,
    });
    try {
      if (workspaceRoot && getCurrentDocument(documentId) === undefined) {
        const document = await loadMarkdownFile({ workspaceRoot, relativePath: fileId });
        if (!isCurrent()) return;
        setDocuments((current) => ({ ...current, [documentId]: document.markdownContent }));
        setDocumentRevisions((current) => ({ ...current, [documentId]: document.revision }));
      }
      if (!isCurrent()) return;
      setDocumentWorkspaceRoots((current) => ({ ...current, [documentId]: workspaceRoot }));
      setDocumentRelativePaths((current) => ({ ...current, [documentId]: fileId }));
      setActiveFileId(documentId);
      setSelectedTreeItemId(findWorkspaceItem(workspaceItems, fileId) ? fileId : "");
      revealFolder(parentFolderIdOf(fileId));
      addOpenTab(documentId);
      setStatusMessage(t("status.loadedPath", { path: fileId }));
    } catch (error) {
      if (!isCurrent()) return;
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };


  const activateTab = async (fileId: string) => {
    const isCurrent = documentNavigation.begin();
    if (!fileId) {
      return false;
    }

    const nextWorkspaceRoot = documentWorkspaceRootForId(
      fileId,
      documentWorkspaceRoots,
      workspaceRoot,
    );
    const nextRelativePath = documentRelativePathForId(fileId, documentRelativePaths);

    if (nextWorkspaceRoot && nextWorkspaceRoot !== workspaceRoot) {
      const cachedItems = workspaceItemsByRoot[nextWorkspaceRoot];
      if (cachedItems) {
        setWorkspaceRoot(nextWorkspaceRoot);
        setWorkspaceItems(cachedItems);
      } else {
        try {
          const items = await listWorkspaceFiles(nextWorkspaceRoot);
          if (!isCurrent()) return false;
          setWorkspaceRoot(nextWorkspaceRoot);
          setWorkspaceItems(items);
          setWorkspaceItemsByRoot((currentTrees) => ({
            ...currentTrees,
            [nextWorkspaceRoot]: items,
          }));
        } catch (error) {
          if (!isCurrent()) return false;
          setStatusMessage(error instanceof Error ? error.message : String(error));
          return false;
        }
      }
    }

    setActiveFileId(fileId);
    setSelectedTreeItemId(isUntitledDocument(fileId) ? "" : nextRelativePath);
    revealFolder(parentFolderIdOf(nextRelativePath));

    if (!nextWorkspaceRoot || documents[fileId] !== undefined || isUntitledDocument(fileId)) {
      return true;
    }

    try {
      const document = await loadMarkdownFile({
        workspaceRoot: nextWorkspaceRoot,
        relativePath: nextRelativePath,
      });
      if (!isCurrent() || !openFileIdsRef.current.includes(fileId)) return false;
      if (getCurrentDocument(fileId) !== undefined) return true;
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        [fileId]: document.markdownContent,
      }));
      setDocumentRevisions((currentRevisions) => ({
        ...currentRevisions,
        [fileId]: document.revision,
      }));
      setStatusMessage(t("status.loadedPath", { path: nextRelativePath }));
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };


  const performSaveTab = async (fileId: string): Promise<string | null> => {
    const content = documents[fileId] ?? "";
    const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
    const tabItem = findWorkspaceItem(workspaceItems, relativePath);
    const tabName = tabItem?.name ?? documentTitles[fileId] ?? fileNameOf(relativePath);

    if (isUntitledDocument(fileId)) {
      const selectedPath = await chooseMarkdownSavePath(
        deriveDefaultMarkdownFileName(content, tabName, t("top.untitled")),
      );
      if (!selectedPath) {
        setStatusMessage(t("status.saveCancelled"));
        return null;
      }

      const markdownFilePath = ensureMarkdownFilePath(selectedPath);
      const saved = await writeMarkdownFile({
        filePath: markdownFilePath,
        markdownContent: content,
      });

      const workspacePath = parentPathOf(markdownFilePath);
      const relativePath = fileNameOf(markdownFilePath);
      const nextDocumentId = makeWorkspaceDocumentId({
        currentDocumentIds: new Set([...openFileIds, ...Object.keys(documents)].filter((id) => id !== fileId)),
        currentWorkspaceRoot: workspacePath,
        relativePath,
        workspaceRoot: workspacePath,
      });
      const items = await listWorkspaceFiles(workspacePath);
      const currentContent = getCurrentDocument(fileId);
      if (currentContent === undefined) return null;
      const stillDirty = currentContent !== content;

      if (activeFileIdRef.current === fileId) {
        setWorkspaceRoot(workspacePath);
        setWorkspaceItems(items);
      }
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspacePath]: items,
      }));
      setDocuments((currentDocuments) => {
        const nextDocuments = { ...currentDocuments };
        delete nextDocuments[fileId];
        nextDocuments[nextDocumentId] = currentDocuments[fileId] ?? currentContent;
        return nextDocuments;
      });
      setDocumentRevisions((currentRevisions) => {
        const nextRevisions = { ...currentRevisions };
        delete nextRevisions[fileId];
        nextRevisions[nextDocumentId] = saved.revision;
        return nextRevisions;
      });
      setDocumentTitles((currentTitles) => {
        const nextTitles = { ...currentTitles };
        delete nextTitles[fileId];
        return nextTitles;
      });
      setOpenFileIds((currentFileIds) =>
        currentFileIds.map((currentFileId) =>
          currentFileId === fileId ? nextDocumentId : currentFileId,
        ),
      );
      setActiveFileId((currentActiveFileId) =>
        currentActiveFileId === fileId ? nextDocumentId : currentActiveFileId,
      );
      setSelectedTreeItemId((currentSelectedItemId) =>
        currentSelectedItemId === fileId ? relativePath : currentSelectedItemId,
      );
      setDocumentWorkspaceRoots((currentRoots) => {
        const nextRoots = { ...currentRoots };
        delete nextRoots[fileId];
        nextRoots[nextDocumentId] = workspacePath;
        return nextRoots;
      });
      setDocumentRelativePaths((currentPaths) => {
        const nextPaths = { ...currentPaths };
        delete nextPaths[fileId];
        nextPaths[nextDocumentId] = relativePath;
        return nextPaths;
      });
      setDirtyFileIds((currentDirtyFileIds) => {
        const nextDirtyFileIds = new Set(currentDirtyFileIds);
        nextDirtyFileIds.delete(fileId);
        if (stillDirty) nextDirtyFileIds.add(nextDocumentId);
        return nextDirtyFileIds;
      });
      lastSavedFileIdRef.current = nextDocumentId;
      setStatusMessage(t(stillDirty ? "status.savedEarlierVersion" : "status.savedPath", { path: relativePath }));
      return stillDirty ? null : nextDocumentId;
    }

    const tabWorkspaceRoot = documentWorkspaceRootForId(
      fileId,
      documentWorkspaceRoots,
      workspaceRoot,
    );
    const tabRelativePath = documentRelativePathForId(fileId, documentRelativePaths);

    if (!tabWorkspaceRoot) {
      setStatusMessage(t("status.openWorkspaceBeforeSave"));
      return null;
    }

    let saved: MarkdownSaveResult;
    try {
      saved = await saveMarkdownFile({
        workspaceRoot: tabWorkspaceRoot,
        relativePath: tabRelativePath,
        markdownContent: content,
        expectedRevision: documentRevisions[fileId],
      });
    } catch (error) {
      reportDocumentSaveError(error, {
        fileId,
        relativePath: tabRelativePath,
        workspaceRoot: tabWorkspaceRoot,
      });
      return null;
    }
    const currentContent = getCurrentDocument(fileId);
    if (currentContent === undefined) return null;
    const stillDirty = currentContent !== content;
    setDocumentRevisions((currentRevisions) => ({
      ...currentRevisions,
      [fileId]: saved.revision,
    }));
    setDirtyFileIds((currentDirtyFileIds) => {
      const nextDirtyFileIds = new Set(currentDirtyFileIds);
      if (stillDirty) nextDirtyFileIds.add(fileId);
      else nextDirtyFileIds.delete(fileId);
      return nextDirtyFileIds;
    });
    lastSavedFileIdRef.current = fileId;
    const message = t(stillDirty ? "status.savedEarlierVersion" : "status.savedPath", { path: tabRelativePath });
    setStatusMessage(saved.warning ? `${message} ${t("status.savedSyncQueueUnavailable")}` : message);
    return stillDirty ? null : fileId;
  };

  const saveTab = useEventCallback(async (fileId: string): Promise<string | null> => {
    if (rejectDuringPathMutation()) return null;
    if (savesInProgressRef.current.has(fileId)) return null;
    savesInProgressRef.current.add(fileId);
    try {
      return await performSaveTab(fileId);
    } catch (error) {
      reportDocumentSaveError(error, {
        fileId,
        relativePath: documentRelativePathForId(fileId, documentRelativePaths),
        workspaceRoot: documentWorkspaceRootForId(fileId, documentWorkspaceRoots, workspaceRoot) ?? "",
      });
      return null;
    } finally {
      savesInProgressRef.current.delete(fileId);
    }
  });

  const closeTab = async (fileId: string) => {
    if (rejectDuringPathMutation()) return;
    documentNavigation.invalidate();
    if (!fileId) {
      return;
    }

    const tabItem = findWorkspaceItem(workspaceItems, fileId);
    const tabName = tabItem?.name ?? documentTitles[fileId] ?? t("top.untitled");
    let fileIdToClose = fileId;

    if (dirtyFileIds.has(fileId)) {
      const shouldSave = await ask(t("dialog.saveBeforeClosing", { name: tabName }), {
        kind: "warning",
        title: t("dialog.closeTabTitle"),
      });

      if (shouldSave) {
        lastSavedFileIdRef.current = null;
        let savedFileId: string | null;
        try {
          savedFileId = await saveTab(fileId);
        } catch (error) {
          setStatusMessage(error instanceof Error ? error.message : String(error));
          return;
        }
        if (!savedFileId) {
          return;
        }

        fileIdToClose = savedFileId;
      }
    }

    if (rejectDuringPathMutation()) return;
    const currentTabIds = openFileIdsRef.current;
    const closeIndex = Math.max(
      0,
      currentTabIds.findIndex((tabId) => tabId === fileId || tabId === fileIdToClose),
    );
    const nextTabIds = currentTabIds.filter(
      (tabId) => tabId !== fileId && tabId !== fileIdToClose,
    );
    const nextActiveFileId =
      activeFileIdRef.current === fileId || activeFileIdRef.current === fileIdToClose
        ? nextTabIds[Math.min(closeIndex, nextTabIds.length - 1)] ?? ""
        : activeFileIdRef.current;

    setOpenFileIds(nextTabIds);
    setDocuments((currentDocuments) => {
      const nextDocuments = { ...currentDocuments };
      delete nextDocuments[fileId];
      delete nextDocuments[fileIdToClose];
      return nextDocuments;
    });
    setDocumentRevisions((currentRevisions) => {
      const nextRevisions = { ...currentRevisions };
      delete nextRevisions[fileId];
      delete nextRevisions[fileIdToClose];
      return nextRevisions;
    });
    setDocumentTitles((currentTitles) => {
      const nextTitles = { ...currentTitles };
      delete nextTitles[fileId];
      delete nextTitles[fileIdToClose];
      return nextTitles;
    });
    setDocumentWorkspaceRoots((currentRoots) => {
      const nextRoots = { ...currentRoots };
      delete nextRoots[fileId];
      delete nextRoots[fileIdToClose];
      return nextRoots;
    });
    setDocumentRelativePaths((currentPaths) => {
      const nextPaths = { ...currentPaths };
      delete nextPaths[fileId];
      delete nextPaths[fileIdToClose];
      return nextPaths;
    });
    setDirtyFileIds((currentDirtyFileIds) => {
      const nextDirtyFileIds = new Set(currentDirtyFileIds);
      nextDirtyFileIds.delete(fileId);
      nextDirtyFileIds.delete(fileIdToClose);
      return nextDirtyFileIds;
    });
    setExternalDocumentChange((currentChange) =>
      currentChange &&
      (currentChange.fileId === fileId || currentChange.fileId === fileIdToClose)
        ? null
        : currentChange,
    );

    if (nextActiveFileId) {
      setActiveFileId(nextActiveFileId);
      void activateTab(nextActiveFileId);
    } else {
      setActiveFileId("");
      setSelectedTreeItemId("");
      onSessionEmpty();
    }

    setStatusMessage(t("status.closedPath", { path: tabName }));
  };

  const requestAppQuit = useEventCallback(async () => {
    if (rejectDuringPathMutation()) return;
    if (quitRequestedRef.current) {
      return;
    }
    quitRequestedRef.current = true;

    try {
      const dirtyDocumentIds = openFileIds.filter((fileId) => dirtyFileIds.has(fileId));
      if (dirtyDocumentIds.length > 0) {
        const shouldSave = await ask(t("dialog.saveBeforeQuitting"), {
          kind: "warning",
          title: t("dialog.quitTitle"),
        });

        if (shouldSave) {
          for (const fileId of dirtyDocumentIds) {
            const savedFileId = await saveTab(fileId);
            if (!savedFileId) {
              quitRequestedRef.current = false;
              return;
            }
          }
        }
      }

      if (rejectDuringPathMutation()) { quitRequestedRef.current = false; return; }
      await quitApp();
    } catch (error) {
      quitRequestedRef.current = false;
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  });

  useEffect(() => {
    let disposed = false;
    let unlistenWindowCloseRequest: UnlistenFn | null = null;

    void listen(APP_EVENTS.windowCloseRequested, () => {
      void requestAppQuit();
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenWindowCloseRequest = unlisten;
    });

    return () => {
      disposed = true;
      unlistenWindowCloseRequest?.();
    };
  }, [requestAppQuit]);

  const saveActiveFile = async (): Promise<boolean> => {
    if (isUntitledDocument(activeFileId)) {
      return saveActiveFileAs();
    }

    if (!activeFileId) {
      setStatusMessage(t("status.selectDocumentBeforeSave"));
      return false;
    }

    return (await saveTab(activeFileId)) !== null;
  };

  const saveActiveFileAs = async (): Promise<boolean> => {
    if (rejectDuringPathMutation()) return false;
    if (!activeFileId) {
      setStatusMessage(t("status.selectDocumentBeforeSave"));
      return false;
    }

    if (savesInProgressRef.current.has(activeFileId)) return false;
    savesInProgressRef.current.add(activeFileId);
    try {
      const defaultFileName = deriveDefaultMarkdownFileName(
        markdownContent,
        activeFileName,
        t("top.untitled"),
      );
      const selectedPath = await chooseMarkdownSavePath(defaultFileName);

      if (!selectedPath) {
        setStatusMessage(t("status.saveCancelled"));
        return false;
      }

      const markdownFilePath = ensureMarkdownFilePath(selectedPath);
      const saved = await writeMarkdownFile({
        filePath: markdownFilePath,
        markdownContent,
      });

      const workspacePath = parentPathOf(markdownFilePath);
      const relativePath = fileNameOf(markdownFilePath);
      const nextDocumentId = makeWorkspaceDocumentId({
        currentDocumentIds: new Set([...openFileIds, ...Object.keys(documents)].filter((id) => id !== activeFileId)),
        currentWorkspaceRoot: workspacePath,
        relativePath,
        workspaceRoot: workspacePath,
      });
      const items = await listWorkspaceFiles(workspacePath);
      const currentContent = getCurrentDocument(activeFileId);
      if (currentContent === undefined) return false;
      const stillDirty = currentContent !== markdownContent;

      if (activeFileIdRef.current === activeFileId) {
        setWorkspaceRoot(workspacePath);
        setWorkspaceItems(items);
      }
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspacePath]: items,
      }));
      setDocuments((currentDocuments) => {
        const nextDocuments = { ...currentDocuments };
        delete nextDocuments[activeFileId];
        nextDocuments[nextDocumentId] = currentDocuments[activeFileId] ?? currentContent;
        return nextDocuments;
      });
      setDocumentRevisions((currentRevisions) => {
        const nextRevisions = { ...currentRevisions };
        delete nextRevisions[activeFileId];
        nextRevisions[nextDocumentId] = saved.revision;
        return nextRevisions;
      });
      setDocumentTitles((currentTitles) => {
        const nextTitles = { ...currentTitles };
        delete nextTitles[activeFileId];
        return nextTitles;
      });
      setActiveFileId((current) => current === activeFileId ? nextDocumentId : current);
      setOpenFileIds((currentFileIds) =>
        currentFileIds.map((fileId) => fileId === activeFileId ? nextDocumentId : fileId),
      );
      if (activeFileIdRef.current === activeFileId) setSelectedTreeItemId(relativePath);
      setDocumentWorkspaceRoots((currentRoots) => {
        const nextRoots = { ...currentRoots };
        delete nextRoots[activeFileId];
        nextRoots[nextDocumentId] = workspacePath;
        return nextRoots;
      });
      setDocumentRelativePaths((currentPaths) => {
        const nextPaths = { ...currentPaths };
        delete nextPaths[activeFileId];
        nextPaths[nextDocumentId] = relativePath;
        return nextPaths;
      });
      setDirtyFileIds((currentDirtyFileIds) => {
        const nextDirtyFileIds = new Set(currentDirtyFileIds);
        nextDirtyFileIds.delete(activeFileId);
        if (stillDirty) nextDirtyFileIds.add(nextDocumentId);
        return nextDirtyFileIds;
      });
      lastSavedFileIdRef.current = nextDocumentId;
      setStatusMessage(t(stillDirty ? "status.savedEarlierVersion" : "status.savedPath", { path: relativePath }));
      return !stillDirty;
    } catch (error) {
      const failureKey = workspaceSaveFailureKey(error);
      setStatusMessage(failureKey ? t(failureKey, { path: activeFileName }) : error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      savesInProgressRef.current.delete(activeFileId);
    }
  };

  const saveDeletedExternalDocumentAs = async () => {
    const didSave = await saveActiveFileAs();
    if (didSave) {
      setExternalDocumentChange(null);
    }
  };

  const revealFolder = (folderId: string | null) => {
    if (!folderId) {
      return;
    }

    setFolderRevealRequest((currentRequest) => ({
      folderId,
      version: (currentRequest?.version ?? 0) + 1,
    }));
  };

  const createFile = async (fileName: string) => {
    const relativePath = joinWorkspacePath(
      createParentPath,
      normalizeMarkdownFileName(fileName),
    );

    if (!relativePath) {
      setStatusMessage(t("status.nameRequired", { item: t("common.file") }));
      return;
    }

    if (!workspaceRoot) {
      setStatusMessage(t("status.openWorkspaceBeforeCreate", { item: t("common.file") }));
      return;
    }

    try {
      await createMarkdownFile({
        workspaceRoot,
        relativePath,
      });
      const items = await listWorkspaceFiles(workspaceRoot);
      const document = await loadMarkdownFile({
        workspaceRoot,
        relativePath,
      });

      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspaceRoot]: items,
      }));
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        [relativePath]: document.markdownContent,
      }));
      setDocumentRevisions((currentRevisions) => ({
        ...currentRevisions,
        [relativePath]: document.revision,
      }));
      setDocumentWorkspaceRoots((currentRoots) => ({
        ...currentRoots,
        [relativePath]: workspaceRoot,
      }));
      setDocumentRelativePaths((currentPaths) => ({
        ...currentPaths,
        [relativePath]: relativePath,
      }));
      setActiveFileId(relativePath);
      addOpenTab(relativePath);
      setSelectedTreeItemId(relativePath);
      revealFolder(createParentPath);
      setStatusMessage(t("status.createdPath", { path: relativePath }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const createFolder = async (folderName: string) => {
    const relativePath = joinWorkspacePath(
      createParentPath,
      normalizeWorkspacePath(folderName),
    );

    if (!relativePath) {
      setStatusMessage(t("status.nameRequired", { item: t("common.folder") }));
      return;
    }

    if (!workspaceRoot) {
      setStatusMessage(t("status.openWorkspaceBeforeCreate", { item: t("common.folder") }));
      return;
    }

    try {
      await createWorkspaceDirectory({
        workspaceRoot,
        relativePath,
      });
      const items = await listWorkspaceFiles(workspaceRoot);
      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspaceRoot]: items,
      }));
      setSelectedTreeItemId(relativePath);
      revealFolder(createParentPath);
      setStatusMessage(t("status.createdFolder", { path: relativePath }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openCreateDialog = async (
    itemType: CreateItemType,
    parentPath?: string,
  ) => {
    if (!workspaceRoot) {
      setStatusMessage(t("status.chooseWorkspaceFirst"));

      try {
        const selectedFolder = await chooseWorkspaceFolder();

        if (!selectedFolder) {
          setStatusMessage(t("status.createCancelledNoWorkspace"));
          return;
        }

        const didOpenWorkspace = await loadWorkspace(selectedFolder);
        if (!didOpenWorkspace) {
          return;
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }

    setCreateParentPath(parentPath ?? null);
    setCreateItemType(itemType);
  };

  const createDefaultName =
    createItemType === "file" ? "example.md" : "New Folder";

  const confirmCreateItem = async (name: string) => {
    if (rejectDuringPathMutation()) return;
    const release = pathMutations.begin(workspaceRoot);
    if (!release) return;
    try {
      const itemType = createItemType;

      setCreateItemType(null);
      setCreateParentPath(null);

      if (itemType === "file") {
        await createFile(name);
      }

      if (itemType === "folder") {
        await createFolder(name);
      }
    } finally { release(); }
  };

  const startRename = (targetPath?: string) => {
    const targetId = targetPath ?? (selectedTreeItemId || activeFileId);
    const targetItem = findWorkspaceItem(workspaceItems, targetId);

    if (!targetItem) {
      setStatusMessage(t("status.selectBeforeRename"));
      return;
    }

    if (hasDirtyPath(workspaceRoot, targetItem.id)) {
      setStatusMessage(t("status.saveBeforeRename"));
      return;
    }

    setRenameItemId(targetItem.id);
  };

  const deleteWorkspaceItem = async (targetPath?: string) => {
    if (rejectDuringPathMutation()) return;
    const targetId = targetPath ?? (selectedTreeItemId || activeFileId);
    const targetItem = findWorkspaceItem(workspaceItems, targetId);
    if (!workspaceRoot || !targetItem) {
      setStatusMessage(t("status.selectBeforeDelete"));
      return;
    }
    const isDeletedPath = (path: string) =>
      path === targetItem.id || path.startsWith(`${targetItem.id}/`);
    const hasDirtyTarget = Array.from(dirtyFileIds).some((fileId) => {
      return (
        documentWorkspaceRootForId(
          fileId,
          documentWorkspaceRoots,
          workspaceRoot,
        ) === workspaceRoot &&
        isDeletedPath(documentRelativePathForId(fileId, documentRelativePaths))
      );
    });
    if (hasDirtyTarget) {
      setStatusMessage(t("status.saveBeforeDelete"));
      return;
    }

    const confirmed = await ask(
      t("dialog.deleteWorkspaceMessage", { name: targetItem.name }),
      { kind: "warning", title: t("dialog.deleteWorkspaceTitle") },
    );
    if (!confirmed) {
      return;
    }

    if (rejectDuringPathMutation()) return;
    if (hasDirtyPath(workspaceRoot, targetItem.id)) { setStatusMessage(t("status.saveBeforeDelete")); return; }
    if (savesInProgressRef.current.size) { setStatusMessage(t("status.workspaceOperationBusy")); return; }
    const release = pathMutations.begin(workspaceRoot);
    if (!release) return;

    try {
      await deleteWorkspaceEntry({
        workspaceRoot,
        relativePath: targetItem.id,
      });
      const items = await listWorkspaceFiles(workspaceRoot);
      const remainingOpenFileIds = openFileIds.filter((fileId) => {
        const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
        const root = documentWorkspaceRootForId(
          fileId,
          documentWorkspaceRoots,
          workspaceRoot,
        );
        return root !== workspaceRoot || !isDeletedPath(relativePath);
      });

      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspaceRoot]: items,
      }));
      setOpenFileIds(remainingOpenFileIds);
      setDocuments((currentDocuments) =>
        Object.fromEntries(
          Object.entries(currentDocuments).filter(([fileId]) => {
            const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
            const root = documentWorkspaceRootForId(
              fileId,
              documentWorkspaceRoots,
              workspaceRoot,
            );
            return root !== workspaceRoot || !isDeletedPath(relativePath);
          }),
        ),
      );
      setDocumentRevisions((currentRevisions) =>
        Object.fromEntries(
          Object.entries(currentRevisions).filter(([fileId]) => {
            const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
            const root = documentWorkspaceRootForId(
              fileId,
              documentWorkspaceRoots,
              workspaceRoot,
            );
            return root !== workspaceRoot || !isDeletedPath(relativePath);
          }),
        ),
      );
      setDirtyFileIds((currentDirtyIds) =>
        new Set(
          Array.from(currentDirtyIds).filter((fileId) => {
            const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
            const root = documentWorkspaceRootForId(
              fileId,
              documentWorkspaceRoots,
              workspaceRoot,
            );
            return root !== workspaceRoot || !isDeletedPath(relativePath);
          }),
        ),
      );
      setExternalDocumentChange((currentChange) =>
        currentChange &&
        currentChange.workspaceRoot === workspaceRoot &&
        isDeletedPath(currentChange.relativePath)
          ? null
          : currentChange,
      );
      setDocumentWorkspaceRoots((currentRoots) =>
        Object.fromEntries(
          Object.entries(currentRoots).filter(([fileId, root]) => {
            const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
            return root !== workspaceRoot || !isDeletedPath(relativePath);
          }),
        ),
      );
      setDocumentRelativePaths((currentPaths) =>
        Object.fromEntries(
          Object.entries(currentPaths).filter(([fileId, relativePath]) => {
            const root = documentWorkspaceRootForId(
              fileId,
              documentWorkspaceRoots,
              workspaceRoot,
            );
            return root !== workspaceRoot || !isDeletedPath(relativePath);
          }),
        ),
      );
      setSelectedTreeItemId("");
      if (isDeletedPath(documentRelativePathForId(activeFileId, documentRelativePaths))) {
        setActiveFileId(remainingOpenFileIds.at(-1) ?? "");
      }
      setStatusMessage(t("status.deletedNeedsSync", { path: targetItem.id }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally { release(); }
  };

  const duplicateWorkspaceItem = async (targetPath?: string) => {
    if (rejectDuringPathMutation()) return;
    const targetId = targetPath ?? (selectedTreeItemId || activeFileId);
    const targetItem = findWorkspaceItem(workspaceItems, targetId);
    if (!workspaceRoot || !targetItem) {
      setStatusMessage(t("status.selectBeforeDuplicate"));
      return;
    }
    const release = pathMutations.begin(workspaceRoot);
    if (!release) return;
    try {
      const result = await duplicateWorkspaceEntry({
        workspaceRoot,
        relativePath: targetItem.id,
      });
      const items = await listWorkspaceFiles(workspaceRoot);
      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspaceRoot]: items,
      }));
      setSelectedTreeItemId(result.newRelativePath);
      revealFolder(parentFolderIdOf(result.newRelativePath));
      setStatusMessage(t("status.duplicatedPath", { path: result.newRelativePath }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally { release(); }
  };

  const applyPathMutation = useEventCallback((root: string, from: string, to: string) => {
    // IDs own buffers/history; only filesystem metadata follows the native rename.
    setDocumentRelativePaths((paths) => remapWorkspaceDocumentPaths(paths, documentWorkspaceRoots, root, from, to));
    setWorkspaceItemsByRoot((trees) => ({ ...trees, [root]: remapWorkspaceTree(trees[root] ?? [], from, to) }));
    setExternalDocumentChange((current) => current?.workspaceRoot === root
      ? { ...current, relativePath: remapPath(current.relativePath, from, to) } : current);
    if (workspaceRootRef.current === root) {
      setWorkspaceItems((items) => remapWorkspaceTree(items, from, to));
      setSelectedTreeItemId((path) => remapPath(path, from, to));
      setRenameItemId(null);
      revealFolder(parentFolderIdOf(to));
    }
    try { recentDocumentStore().remap(root, from, to); }
    catch { setStatusMessage(t("recent.storageFailed")); }
  });

  const runPathMutation = async (
    sourcePath: string, kind: "rename" | "move",
    execute: (root: string) => Promise<{ oldRelativePath: string; newRelativePath: string }>,
  ) => {
    const root = workspaceRoot;
    if (!root) { setStatusMessage(t("status.openWorkspaceBeforeMove")); return; }
    if (hasDirtyPath(root, sourcePath)) {
      setStatusMessage(t(kind === "rename" ? "status.saveBeforeRename" : "status.saveBeforeMove")); return;
    }
    if (savesInProgressRef.current.size || pathMutations.isBusy()) {
      setStatusMessage(t("status.workspaceOperationBusy")); return;
    }
    const release = pathMutations.begin(root);
    if (!release) return;
    documentNavigation.invalidate();
    for (const id of openFileIds) documentReads.invalidate(id);
    try {
      const response = await execute(root);
      applyPathMutation(root, response.oldRelativePath, response.newRelativePath);
      // Refresh is a projection, never the commit point of a successful disk mutation.
      try {
        const items = await listWorkspaceFiles(root);
        setWorkspaceItemsByRoot((trees) => ({ ...trees, [root]: items }));
        if (workspaceRootRef.current === root) {
          setWorkspaceItems(items);
          setStatusMessage(t(kind === "rename" ? "status.renamedPath" : "status.movedPath", {
            from: response.oldRelativePath, to: response.newRelativePath,
          }));
        }
      } catch {
        if (workspaceRootRef.current === root) setStatusMessage(t("status.workspaceRefreshAfterMoveFailed"));
      }
    } catch (error) {
      if (workspaceRootRef.current === root) setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally { release(); }
  };

  const confirmRename = (item: WorkspaceItem, nextName: string) => runPathMutation(item.id, "rename",
    (root) => renameEntry({ workspaceRoot: root, sourceRelativePath: item.id, newName: nextName }));

  const moveWorkspaceEntry = (sourcePath: string, targetParentPath: string | null) => runPathMutation(sourcePath, "move",
    (root) => moveEntry({ workspaceRoot: root, sourceRelativePath: sourcePath, targetParentRelativePath: targetParentPath }));


  return {
    workspaceItems, documents, documentRevisions, documentWorkspaceRoots, documentRelativePaths,
    workspaceRoot, activeFileId, openFileIds, dirtyFileIds, dirtyWorkspacePaths, markdownContent, activeRelativePath,
    activeDocumentRoot, activeFileName, isDirty, openTabs, collapseVersion, folderRevealRequest,
    selectedTreeItemId, createItemType, createDefaultName, renameItemId, externalDocumentChange,
    loadWorkspace, openWorkspace, openMarkdownPath, openFile, createUntitledDocument, selectFile,
    activateTab, updateActiveDocument, saveTab, saveActiveFile, saveActiveFileAs, closeTab, requestAppQuit,
    dirtyDocumentIdsForWorkspace, saveDirtyDocumentsForWorkspace, reloadWorkspaceAfterDownload,
    reloadDocumentFromDisk, reloadExternalDocumentFromDisk, keepEditingExternalDocument, saveDeletedExternalDocumentAs,
    openCreateDialog, confirmCreateItem, startRename, confirmRename, deleteWorkspaceItem,
    duplicateWorkspaceItem, moveWorkspaceEntry,
    currentWorkspaceRoot: () => workspaceRootRef.current,
    selectTreeItem: setSelectedTreeItemId,
    cancelRename: () => setRenameItemId(null),
    collapseFolders: () => setCollapseVersion((version) => version + 1),
    cancelCreate: () => { setCreateItemType(null); setCreateParentPath(null); },
  };
}
