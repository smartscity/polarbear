import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  findNext,
  findPrevious,
  openSearchPanel,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  MarkdownEditor,
  type MarkdownEditorView,
} from "./features/editor/components/MarkdownEditor";
import { InsertCodeFenceDialog } from "./features/editor/components/InsertCodeFenceDialog";
import { InsertTableDialog } from "./features/editor/components/InsertTableDialog";
import { MarkdownPreview } from "./features/editor/components/MarkdownPreview";
import { TyporaLiveEditor } from "./features/editor/components/TyporaLiveEditor";
import { AppShell } from "./app/layout/AppShell";
import { AboutPolarbearDialog } from "./app/layout/AboutPolarbearDialog";
import {
  CreateItemDialog,
  type CreateItemType,
} from "./features/workspace/components/CreateItemDialog";
import { useAppShortcuts } from "./commands/useAppShortcuts";
import { useNativeAppMenu } from "./commands/useNativeAppMenu";
import { applyMarkdownFormat } from "./features/editor/markdown/applyMarkdownFormat";
import { codeFenceTemplate } from "./features/editor/markdown/markdownTemplates";
import {
  deriveDefaultMarkdownFileName,
  displayNameForDocumentId,
  documentRelativePathForId,
  documentWorkspaceRootForId,
  extractDocumentStructure,
  findOpenDocumentIdForWorkspaceFile,
  isUntitledDocument,
  makeWorkspaceDocumentId,
  parentFolderIdOf,
} from "./features/editor/documentModel";
import type {
  AppCommand,
  AppCommandPayload,
  ExecuteAppCommand,
} from "./shared/commands/appCommandTypes";
import type { ViewMode } from "./features/editor/viewMode";
import {
  applyThemeTokens,
  readStoredTheme,
  storeTheme,
  type ThemeName,
} from "./features/theme/themeTokens";
import {
  ConnectRepositoryDialog,
  LinkRepositoryWorkspaceDialog,
  RepositoryOperationDialog,
  RepositorySyncStatusDialog,
} from "./features/repository/RepositoryDialogs";
import {
  connectRepositoryProvider,
  disconnectRepositoryProvider,
  getRepositoryAccount,
  getRepositorySyncStatus,
  getWorkspaceRepositoryBinding,
  linkWorkspaceToRepository,
  listRepositories,
  pullWorkspace,
  pushWorkspace,
  repositoryProviderLabel,
  syncWorkspaceNow,
  type RepositoryAccount,
  type RepositoryBinding,
  type RepositoryInfo,
  type RepositoryProvider,
  type RepositorySyncStatus,
} from "./features/repository/repositoryApi";
import {
  findWorkspaceItem,
  type WorkspaceDocumentMap,
  type WorkspaceItem,
} from "./features/workspace/workspaceModel";
import {
  ensureMarkdownFilePath,
  fileNameOf,
  findFirstFile,
  joinWorkspacePath,
  normalizeMarkdownFileName,
  normalizeWorkspacePath,
  parentPathOf,
  remapDirtyFileIds,
  remapDocumentMetadataKeys,
  remapDocumentMetadataPaths,
  remapDocumentPaths,
  remapPath,
  targetAffectsDirtyFile,
  timestampForFileName,
} from "./features/workspace/workspacePaths";
import {
  chooseMarkdownFile,
  chooseMarkdownSavePath,
  chooseImageFile,
  chooseWorkspaceFolder,
  copyImageAsset,
  createMarkdownFile,
  createWorkspaceDirectory,
  deleteWorkspaceEntry,
  duplicateWorkspaceEntry,
  listWorkspaceFiles,
  loadMarkdownFile,
  moveEntry,
  openMarkdownFile,
  renameEntry,
  revealInFileManager,
  saveMarkdownFile,
  saveImageAsset,
  writeMarkdownFile,
} from "./features/workspace/tauriWorkspaceAdapter";
import { openNewAppWindow } from "./shared/tauri/openNewAppWindow";
import { useI18n } from "./shared/i18n/I18nProvider";
import {
  APP_CANVAS_ZOOM_ENABLED,
  APP_ZOOM_SCROLL_LOCK_MS,
  APP_ZOOM_STEP,
  MIN_COMMITTED_APP_ZOOM,
  NATIVE_GESTURE_WHEEL_SUPPRESS_MS,
  NATIVE_PINCH_SCALE_SENSITIVITY,
  NATIVE_PINCH_ZOOM_SENSITIVITY,
  NORMAL_APP_ZOOM,
  WHEEL_ZOOM_DELTA_LIMIT,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_SETTLE_DELAY_MS,
  ZOOM_SNAP_DURATION_MS,
  clampCommittedZoom,
  clampInteractionZoom,
  consumeAppZoomPointerEvent,
  consumeAppZoomWheelEvent,
  dispatchAppZoomDebug,
  isAppZoomPointerLikeEvent,
  isAppZoomWheelEvent,
  isNativePinchEndPhase,
  measureAppCanvasSize,
  readAppCanvasSize,
  readStoredDebugEnabled,
  removePolarbearDebugOverlays,
  resolveScrollableElementFromTarget,
  setAppCanvasZoomingDataset,
  shouldIgnoreAppZoomEditorPointerTarget,
  shouldIgnoreAppZoomEvent,
  shouldLetEditorHandleWheel,
  syncAppCanvasZoomDataset,
  type AppCanvasPlacement,
  type AppCanvasSize,
  type AppCanvasTransform,
  type AppZoomCursorPlacementDebug,
  type AppZoomPointerLikeEvent,
  type InnerScrollLock,
  type NativePinchPayload,
  type ZoomAnchor,
} from "./features/zoom/appZoomRuntime";
import { useRepositorySyncProgress } from "./features/repository/useRepositorySyncProgress";
import { useWorkspaceFileTreeRefresh } from "./features/workspace/useWorkspaceFileTreeRefresh";
import { STORAGE_KEYS } from "./shared/constants/storageKeys";
import { APP_EVENTS } from "./shared/events/appEvents";
import { TAURI_COMMANDS } from "./shared/tauri/commandIds";
import { invokeTauri } from "./shared/tauri/invokeTauri";
import { PRODUCT_CONFIG } from "./shared/config/productConfig";

const initialWorkspace: WorkspaceItem[] = [];

const initialDocuments: WorkspaceDocumentMap = {
  "untitled:1": "",
};

const initialDocumentTitles: Record<string, string> = {
  "untitled:1": "Untitled",
};

export function App() {
  const { t } = useI18n();
  const editorViewRef = useRef<MarkdownEditorView | null>(null);
  const zoomViewportRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasSizeRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasRef = useRef<HTMLDivElement | null>(null);
  const appZoomRef = useRef(1);
  const appCanvasSizeRef = useRef<AppCanvasSize>(readAppCanvasSize());
  const appCanvasTransformRef = useRef<AppCanvasTransform>({
    scale: NORMAL_APP_ZOOM,
    x: 0,
    y: 0,
  });
  const appCanvasPlacementRef = useRef<AppCanvasPlacement | null>(null);
  const appZoomInteractionSurfacePreparedRef = useRef(false);
  const zoomRafRef = useRef(0);
  const pendingZoomRef = useRef(1);
  const pendingAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const activeZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const lastNativeGestureAtRef = useRef(0);
  const lastZoomClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastSavedFileIdRef = useRef<string | null>(null);
  const zoomScrollUnlockTimerRef = useRef<number | null>(null);
  const zoomScrollLockUntilRef = useRef(0);
  const zoomInnerScrollLocksRef = useRef<Map<HTMLElement, InnerScrollLock>>(new Map());
  const lastInnerScrollRestoreDebugAtRef = useRef(0);
  const lastAppZoomCursorPlacementAtRef = useRef(0);
  const lastAppZoomCursorPlacementDebugRef = useRef<AppZoomCursorPlacementDebug | null>(null);
  const zoomSettleTimerRef = useRef<number | null>(null);
  const zoomSnapAnimationRef = useRef(0);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const [workspaceItems, setWorkspaceItems] = useState(initialWorkspace);
  const [workspaceItemsByRoot, setWorkspaceItemsByRoot] = useState<Record<string, WorkspaceItem[]>>({});
  const [documents, setDocuments] = useState(initialDocuments);
  const [activeFileId, setActiveFileId] = useState("untitled:1");
  const [openFileIds, setOpenFileIds] = useState<string[]>(["untitled:1"]);
  const [documentWorkspaceRoots, setDocumentWorkspaceRoots] = useState<Record<string, string>>({});
  const [documentRelativePaths, setDocumentRelativePaths] = useState<Record<string, string>>({});
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>(
    initialDocumentTitles,
  );
  const [untitledCounter, setUntitledCounter] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("live"); // split、live
  const [appCanvasSize, setAppCanvasSize] = useState<AppCanvasSize>(() =>
    appCanvasSizeRef.current,
  );
  const [themeName, setThemeName] = useState<ThemeName>(() =>
    readStoredTheme(),
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDocumentStructureOpen, setIsDocumentStructureOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());
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
  const [isInsertTableDialogOpen, setIsInsertTableDialogOpen] = useState(false);
  const [isInsertCodeFenceDialogOpen, setIsInsertCodeFenceDialogOpen] =
    useState(false);
  const [repositoryAccount, setRepositoryAccount] =
    useState<RepositoryAccount | null>(null);
  const [repositoryBinding, setRepositoryBinding] =
    useState<RepositoryBinding | null>(null);
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
  const dirtyFileIdsRef = useRef(dirtyFileIds);
  const openFileIdsRef = useRef(openFileIds);
  const [statusMessage, setStatusMessage] = useState("");
  const [debugEnabled, setDebugEnabled] = useState(readStoredDebugEnabled);

  useEffect(() => {
    dirtyFileIdsRef.current = dirtyFileIds;
  }, [dirtyFileIds]);

  useEffect(() => {
    openFileIdsRef.current = openFileIds;
  }, [openFileIds]);

  const handleWorkspaceFileTreeRefresh = useCallback(
    (refreshedWorkspaceRoot: string, items: WorkspaceItem[]) => {
      setWorkspaceItems((currentItems) =>
        JSON.stringify(currentItems) === JSON.stringify(items) ? currentItems : items,
      );
      setWorkspaceItemsByRoot((currentTrees) => {
        const currentItems = currentTrees[refreshedWorkspaceRoot] ?? [];
        return JSON.stringify(currentItems) === JSON.stringify(items)
          ? currentTrees
          : { ...currentTrees, [refreshedWorkspaceRoot]: items };
      });
    },
    [],
  );
  useWorkspaceFileTreeRefresh({
    workspaceRoot,
    onRefresh: handleWorkspaceFileTreeRefresh,
  });

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
  useRepositorySyncProgress({
    busyRef: repositoryBusyRef,
    onProgress: handleRepositorySyncProgress,
  });

  const markdownContent = documents[activeFileId] ?? "";
  const activeRelativePath = documentRelativePathForId(activeFileId, documentRelativePaths);
  const activeFileName = displayNameForDocumentId(
    activeFileId,
    workspaceItems,
    documentTitles,
    documentRelativePaths,
  );
  const isDirty = dirtyFileIds.has(activeFileId);
  const documentStructureItems = useMemo(
    () => extractDocumentStructure(markdownContent),
    [markdownContent],
  );
  const openTabs = openFileIds
    .filter((fileId) => documents[fileId] !== undefined || findWorkspaceItem(workspaceItems, fileId))
    .map((fileId) => {
      return {
        id: fileId,
        isDirty: dirtyFileIds.has(fileId),
        name: displayNameForDocumentId(fileId, workspaceItems, documentTitles, documentRelativePaths),
      };
    });

  useEffect(() => {
    try {
      const value = debugEnabled ? "1" : "0";
      window.localStorage.setItem(STORAGE_KEYS.debug, value);
      window.localStorage.setItem(STORAGE_KEYS.liveDebug, value);
      window.localStorage.setItem(STORAGE_KEYS.liveDebugScroll, value);
      window.localStorage.setItem(STORAGE_KEYS.liveDebugPanel, debugEnabled ? "1" : "0");
    } catch {
      // Ignore storage errors; the toggle still reflects the current session.
    }

    if (!debugEnabled) {
      removePolarbearDebugOverlays();
    }

    window.dispatchEvent(new CustomEvent(APP_EVENTS.debugChanged));
  }, [debugEnabled]);

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

  const commitZoom = useCallback((nextZoom: number) => {
    const zoom = clampCommittedZoom(nextZoom);
    appZoomRef.current = zoom;
    syncAppCanvasZoomDataset(zoom);
  }, []);

  const clampCanvasTranslate = useCallback((
    scale: number,
    x: number,
    y: number,
  ): { x: number; y: number } => {
    const viewport = zoomViewportRef.current;
    const size = appCanvasSizeRef.current;
    const viewportWidth = viewport?.clientWidth ?? size.width;
    const viewportHeight = viewport?.clientHeight ?? size.height;
    const scaledWidth = size.width * scale;
    const scaledHeight = size.height * scale;

    const clampAxis = (value: number, viewportSize: number, scaledSize: number) => {
      if (scaledSize <= viewportSize) {
        return Math.max(0, Math.min(viewportSize - scaledSize, value));
      }

      return Math.min(0, Math.max(viewportSize - scaledSize, value));
    };

    return {
      x: clampAxis(x, viewportWidth, scaledWidth),
      y: clampAxis(y, viewportHeight, scaledHeight),
    };
  }, []);

  const applyCanvasTransform = useCallback((
    nextTransform: AppCanvasTransform,
    allowElasticZoom = true,
  ) => {
    const scale = allowElasticZoom
      ? clampInteractionZoom(nextTransform.scale)
      : clampCommittedZoom(nextTransform.scale);
    const resetToNormal = !allowElasticZoom && scale <= NORMAL_APP_ZOOM + 0.0005;
    const nextTranslate = resetToNormal
      ? { x: 0, y: 0 }
      : clampCanvasTranslate(scale, nextTransform.x, nextTransform.y);
    const size = appCanvasSizeRef.current;

    appZoomRef.current = scale;
    appCanvasTransformRef.current = {
      scale,
      x: nextTranslate.x,
      y: nextTranslate.y,
    };
    syncAppCanvasZoomDataset(scale, allowElasticZoom);

    if (!allowElasticZoom) {
      appZoomInteractionSurfacePreparedRef.current = false;
    }

    if (zoomCanvasSizeRef.current) {
      zoomCanvasSizeRef.current.style.width = "100%";
      zoomCanvasSizeRef.current.style.height = "100%";
    }

    appCanvasPlacementRef.current = {
      canvasHeight: size.height,
      canvasWidth: size.width,
      offsetLeft: 0,
      offsetTop: 0,
    };

    if (zoomViewportRef.current) {
      zoomViewportRef.current.scrollLeft = 0;
      zoomViewportRef.current.scrollTop = 0;
    }

    if (zoomCanvasRef.current) {
      zoomCanvasRef.current.style.left = "0px";
      zoomCanvasRef.current.style.top = "0px";
      zoomCanvasRef.current.style.width = `${size.width}px`;
      zoomCanvasRef.current.style.height = `${size.height}px`;
      zoomCanvasRef.current.style.transformOrigin = "top left";
      zoomCanvasRef.current.style.transform =
        `translate3d(${nextTranslate.x}px, ${nextTranslate.y}px, 0) scale(${scale})`;
    }
  }, [clampCanvasTranslate]);

  const applyCanvasZoom = useCallback((nextZoom: number, allowElasticZoom = true) => {
    applyCanvasTransform({
      ...appCanvasTransformRef.current,
      scale: nextZoom,
    }, allowElasticZoom);
  }, [applyCanvasTransform]);

  const prepareAppZoomInteractionSurface = useCallback(() => {
    if (appZoomInteractionSurfacePreparedRef.current) {
      return;
    }

    appZoomInteractionSurfacePreparedRef.current = true;
    const size = appCanvasSizeRef.current;

    if (zoomCanvasSizeRef.current) {
      zoomCanvasSizeRef.current.style.width = "100%";
      zoomCanvasSizeRef.current.style.height = "100%";
    }
    appCanvasPlacementRef.current = {
      canvasHeight: size.height,
      canvasWidth: size.width,
      offsetLeft: 0,
      offsetTop: 0,
    };

    if (zoomCanvasRef.current) {
      zoomCanvasRef.current.style.width = `${size.width}px`;
      zoomCanvasRef.current.style.height = `${size.height}px`;
      zoomCanvasRef.current.style.left = "0px";
      zoomCanvasRef.current.style.top = "0px";
      zoomCanvasRef.current.style.transformOrigin = "top left";
    }
  }, []);

  const getAnchorCanvasPoint = useCallback((
    viewport: HTMLElement,
    zoom: number,
    clientX?: number,
    clientY?: number,
  ): ZoomAnchor => {
    const rect = viewport.getBoundingClientRect();
    const rawPointerX =
      typeof clientX === "number" && Number.isFinite(clientX)
        ? clientX - rect.left
        : viewport.clientWidth / 2;
    const rawPointerY =
      typeof clientY === "number" && Number.isFinite(clientY)
        ? clientY - rect.top
        : viewport.clientHeight / 2;
    const pointerX = Math.max(0, Math.min(rect.width, rawPointerX));
    const pointerY = Math.max(0, Math.min(rect.height, rawPointerY));
    const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : NORMAL_APP_ZOOM;
    const transform = appCanvasTransformRef.current;

    return {
      pointerX,
      pointerY,
      canvasX: (pointerX - transform.x) / safeZoom,
      canvasY: (pointerY - transform.y) / safeZoom,
    };
  }, []);

  const applyVisualZoomAtAnchor = useCallback((nextZoom: number, anchor: ZoomAnchor) => {
    const zoom = clampInteractionZoom(nextZoom);
    prepareAppZoomInteractionSurface();
    applyCanvasTransform({
      scale: zoom,
      x: anchor.pointerX - anchor.canvasX * zoom,
      y: anchor.pointerY - anchor.canvasY * zoom,
    });
  }, [applyCanvasTransform, prepareAppZoomInteractionSurface]);

  const applyZoomAtAnchor = useCallback((
    nextZoom: number,
    anchor: ZoomAnchor,
    allowElasticZoom = true,
  ) => {
    const zoom = allowElasticZoom
      ? clampInteractionZoom(nextZoom)
      : clampCommittedZoom(nextZoom);
    applyCanvasTransform({
      scale: zoom,
      x: anchor.pointerX - anchor.canvasX * zoom,
      y: anchor.pointerY - anchor.canvasY * zoom,
    }, allowElasticZoom);
  }, [applyCanvasTransform]);

  const syncCanvasBaseSizePreservingAnchor = useCallback(() => {
    if (activeZoomAnchorRef.current || zoomRafRef.current || zoomSnapAnimationRef.current) {
      return;
    }

    if (
      APP_CANVAS_ZOOM_ENABLED &&
      Math.abs(appZoomRef.current - NORMAL_APP_ZOOM) > 0.0005
    ) {
      return;
    }

    const viewport = zoomViewportRef.current;
    const currentZoom = appZoomRef.current;
    const anchor = viewport
      ? getAnchorCanvasPoint(viewport, currentZoom)
      : null;
    const nextSize = measureAppCanvasSize(zoomCanvasRef.current);

    appCanvasSizeRef.current = nextSize;
    setAppCanvasSize((currentSize) =>
      currentSize.width === nextSize.width && currentSize.height === nextSize.height
        ? currentSize
        : nextSize,
    );
    if (viewport && anchor) {
      applyZoomAtAnchor(currentZoom, anchor, currentZoom < MIN_COMMITTED_APP_ZOOM);
      return;
    }

    applyCanvasZoom(currentZoom, currentZoom < MIN_COMMITTED_APP_ZOOM);
  }, [applyCanvasZoom, applyZoomAtAnchor, getAnchorCanvasPoint]);

  const zoomAtPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const viewport = zoomViewportRef.current;
    if (!viewport) {
      applyCanvasZoom(nextZoom);
      return;
    }

    const anchor = getAnchorCanvasPoint(viewport, appZoomRef.current, clientX, clientY);
    applyZoomAtAnchor(nextZoom, anchor);
  }, [applyCanvasZoom, applyZoomAtAnchor, getAnchorCanvasPoint]);

  const cancelZoomSnapAnimation = useCallback(() => {
    if (zoomSnapAnimationRef.current) {
      window.cancelAnimationFrame(zoomSnapAnimationRef.current);
      zoomSnapAnimationRef.current = 0;
    }
  }, []);

  const getInnerScrollLockElements = useCallback((): HTMLElement[] => {
    const root = zoomCanvasRef.current;
    if (!root) {
      return [];
    }

    const elements = root.querySelectorAll(
      ".cm-scroller, .markdown-preview, .workspace-tree-shell",
    );
    return Array.from(elements).filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
  }, []);

  const captureInnerScrollLocks = useCallback(() => {
    const locks = zoomInnerScrollLocksRef.current;
    for (const element of Array.from(locks.keys())) {
      if (!element.isConnected) {
        locks.delete(element);
      }
    }

    for (const element of getInnerScrollLockElements()) {
      if (!locks.has(element)) {
        locks.set(element, {
          left: element.scrollLeft,
          top: element.scrollTop,
        });
      }
    }
  }, [getInnerScrollLockElements]);

  const restoreInnerScrollLocks = useCallback(() => {
    const locks = zoomInnerScrollLocksRef.current;
    let restoredCount = 0;
    let liveBefore = "";
    let liveAfter = "";
    for (const [element, position] of Array.from(locks.entries())) {
      if (!element.isConnected) {
        locks.delete(element);
        continue;
      }

      const isLiveScroller = element.matches(".typora-live-editor-pane .cm-scroller");
      if (isLiveScroller) {
        liveBefore = `${Math.round(element.scrollLeft)},${Math.round(element.scrollTop)}`;
      }

      if (Math.abs(element.scrollLeft - position.left) > 0.5) {
        element.scrollLeft = position.left;
        restoredCount += 1;
      }

      if (Math.abs(element.scrollTop - position.top) > 0.5) {
        element.scrollTop = position.top;
        restoredCount += 1;
      }

      if (isLiveScroller) {
        liveAfter = `${Math.round(element.scrollLeft)},${Math.round(element.scrollTop)}`;
      }
    }

    const now = Date.now();
    if (
      restoredCount > 0 &&
      now - lastInnerScrollRestoreDebugAtRef.current > 120
    ) {
      lastInnerScrollRestoreDebugAtRef.current = now;
      dispatchAppZoomDebug("inner-scroll-restore", {
        canvas: zoomCanvasRef.current,
        canvasSize: zoomCanvasSizeRef.current,
        extra: {
          innerLocks: locks.size,
          lastCursorAgeMs: lastAppZoomCursorPlacementDebugRef.current
            ? Math.round(now - lastAppZoomCursorPlacementDebugRef.current.when)
            : "n/a",
          lastCursorEvent: lastAppZoomCursorPlacementDebugRef.current?.eventType ?? "n/a",
          lastCursorPos: lastAppZoomCursorPlacementDebugRef.current?.cursorPos ?? "n/a",
          lastCursorRaw: lastAppZoomCursorPlacementDebugRef.current
            ? `${Math.round(lastAppZoomCursorPlacementDebugRef.current.rawClientX)},${Math.round(lastAppZoomCursorPlacementDebugRef.current.rawClientY)}`
            : "n/a",
          lastCursorAdjusted: lastAppZoomCursorPlacementDebugRef.current
            ? `${Math.round(lastAppZoomCursorPlacementDebugRef.current.adjustedClientX)},${Math.round(lastAppZoomCursorPlacementDebugRef.current.adjustedClientY)}`
            : "n/a",
          lastCursorScrollBefore: lastAppZoomCursorPlacementDebugRef.current
            ? `${Math.round(lastAppZoomCursorPlacementDebugRef.current.beforeScrollLeft)},${Math.round(lastAppZoomCursorPlacementDebugRef.current.beforeScrollTop)}`
            : "n/a",
          lastCursorScrollAfterDispatch: lastAppZoomCursorPlacementDebugRef.current
            ? `${Math.round(lastAppZoomCursorPlacementDebugRef.current.afterDispatchScrollLeft)},${Math.round(lastAppZoomCursorPlacementDebugRef.current.afterDispatchScrollTop)}`
            : "n/a",
          liveAfter,
          liveBefore,
          restoredCount,
          transformScale: appCanvasTransformRef.current.scale.toFixed(4),
        },
        prepared: appZoomInteractionSurfacePreparedRef.current,
        viewport: zoomViewportRef.current,
        zoom: appZoomRef.current,
      });
    }
  }, []);

  const releaseInnerScrollLocks = useCallback(() => {
    zoomInnerScrollLocksRef.current.clear();
  }, []);

  const controlledInnerScroll = useCallback((
    target: EventTarget | null,
    deltaX: number,
    deltaY: number,
  ): boolean => {
    const element = resolveScrollableElementFromTarget(target);
    if (!element) {
      return false;
    }

    const beforeLeft = element.scrollLeft;
    const beforeTop = element.scrollTop;
    element.scrollLeft += deltaX;
    element.scrollTop += deltaY;

    const moved =
      Math.abs(element.scrollLeft - beforeLeft) > 0.5 ||
      Math.abs(element.scrollTop - beforeTop) > 0.5;

    if (moved) {
      zoomInnerScrollLocksRef.current.set(element, {
        left: element.scrollLeft,
        top: element.scrollTop,
      });
    }

    return moved;
  }, []);

  const preserveCurrentInnerScrollPosition = useCallback((target: EventTarget | null): boolean => {
    const element = resolveScrollableElementFromTarget(target);
    if (!element) {
      return false;
    }

    const left = element.scrollLeft;
    const top = element.scrollTop;
    const restore = () => {
      element.scrollLeft = left;
      element.scrollTop = top;
      zoomInnerScrollLocksRef.current.set(element, {
        left,
        top,
      });
    };

    restore();
    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
    return true;
  }, []);

  const placeEditorCursorDuringAppZoom = useCallback((event: AppZoomPointerLikeEvent): boolean => {
    const button = typeof event.button === "number" ? event.button : 0;
    if (button !== 0 || shouldIgnoreAppZoomEditorPointerTarget(event.target)) {
      return false;
    }

    const target = event.target;
    if (!(target instanceof Node) || !zoomCanvasRef.current?.contains(target)) {
      return false;
    }

    const editorView = editorViewRef.current as unknown as EditorView | null;
    if (!editorView?.dom.contains(target)) {
      return false;
    }

    const scrollDOM = editorView.scrollDOM;
    const scrollTop = scrollDOM.scrollTop;
    const scrollLeft = scrollDOM.scrollLeft;
    const viewportRect = zoomViewportRef.current?.getBoundingClientRect() ?? null;
    const transform = appCanvasTransformRef.current;
    const safeScale = Number.isFinite(transform.scale) && transform.scale > 0
      ? transform.scale
      : NORMAL_APP_ZOOM;
    const adjustedClientX = viewportRect
      ? viewportRect.left + ((event.clientX - viewportRect.left - transform.x) / safeScale)
      : event.clientX;
    const adjustedClientY = viewportRect
      ? viewportRect.top + ((event.clientY - viewportRect.top - transform.y) / safeScale)
      : event.clientY;
    const pos = editorView.posAtCoords({
      x: adjustedClientX,
      y: adjustedClientY,
    });

    if (pos === null) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    zoomScrollLockUntilRef.current = Math.max(
      zoomScrollLockUntilRef.current,
      Date.now() + 180,
    );

    const currentSelection = editorView.state.selection.main;
    editorView.dispatch({
      selection: event.shiftKey
        ? {
            anchor: currentSelection.from,
            head: pos,
          }
        : {
            anchor: pos,
          },
      scrollIntoView: false,
    });
    lastAppZoomCursorPlacementAtRef.current = Date.now();
    const afterDispatchScrollTop = scrollDOM.scrollTop;
    const afterDispatchScrollLeft = scrollDOM.scrollLeft;
    lastAppZoomCursorPlacementDebugRef.current = {
      adjustedClientX,
      adjustedClientY,
      afterDispatchScrollLeft,
      afterDispatchScrollTop,
      beforeScrollLeft: scrollLeft,
      beforeScrollTop: scrollTop,
      cursorPos: pos,
      eventType: event.type,
      rawClientX: event.clientX,
      rawClientY: event.clientY,
      transformScale: transform.scale,
      transformX: transform.x,
      transformY: transform.y,
      viewportLeft: viewportRect?.left ?? null,
      viewportTop: viewportRect?.top ?? null,
      when: lastAppZoomCursorPlacementAtRef.current,
    };

    const restoreScroll = () => {
      scrollDOM.scrollTop = scrollTop;
      scrollDOM.scrollLeft = scrollLeft;
      zoomInnerScrollLocksRef.current.set(scrollDOM, {
        left: scrollLeft,
        top: scrollTop,
      });
    };
    editorView.contentDOM.focus({ preventScroll: true });
    restoreScroll();
    window.requestAnimationFrame(() => {
      restoreScroll();
      window.requestAnimationFrame(restoreScroll);
    });
    window.setTimeout(restoreScroll, 0);
    dispatchAppZoomDebug("cursor-place", {
      canvas: zoomCanvasRef.current,
      canvasSize: zoomCanvasSizeRef.current,
      extra: {
        afterDispatchScrollLeft: Math.round(afterDispatchScrollLeft),
        afterDispatchScrollTop: Math.round(afterDispatchScrollTop),
        beforeScrollLeft: Math.round(scrollLeft),
        beforeScrollTop: Math.round(scrollTop),
        cursorPos: pos,
        rawClientX: Math.round(event.clientX),
        rawClientY: Math.round(event.clientY),
        adjustedClientX: Math.round(adjustedClientX),
        adjustedClientY: Math.round(adjustedClientY),
        transformScale: transform.scale.toFixed(4),
        transformX: Math.round(transform.x),
        transformY: Math.round(transform.y),
        viewportLeft: viewportRect ? Math.round(viewportRect.left) : "n/a",
        viewportTop: viewportRect ? Math.round(viewportRect.top) : "n/a",
      },
      prepared: appZoomInteractionSurfacePreparedRef.current,
      viewport: zoomViewportRef.current,
      zoom: appZoomRef.current,
    });

    return true;
  }, []);

  const lockAppZoomScroll = useCallback(() => {
    zoomScrollLockUntilRef.current = Math.max(
      zoomScrollLockUntilRef.current,
      Date.now() + APP_ZOOM_SCROLL_LOCK_MS,
    );
    document.documentElement.dataset.appCanvasZooming = "true";
    captureInnerScrollLocks();
    restoreInnerScrollLocks();

    if (zoomScrollUnlockTimerRef.current !== null) {
      window.clearTimeout(zoomScrollUnlockTimerRef.current);
    }

    zoomScrollUnlockTimerRef.current = window.setTimeout(() => {
      if (Date.now() < zoomScrollLockUntilRef.current) {
        return;
      }

      zoomScrollUnlockTimerRef.current = null;
      const isAtNormalZoom = appZoomRef.current <= NORMAL_APP_ZOOM + 0.0005;
      if (isAtNormalZoom) {
        applyCanvasZoom(NORMAL_APP_ZOOM, false);
        restoreInnerScrollLocks();
        releaseInnerScrollLocks();
      } else {
        setAppCanvasZoomingDataset(true);
        restoreInnerScrollLocks();
      }
      dispatchAppZoomDebug("unlock", {
        canvas: zoomCanvasRef.current,
        canvasSize: zoomCanvasSizeRef.current,
        extra: {
          appCanvasZooming: document.documentElement.dataset.appCanvasZooming ?? "false",
          innerLocks: zoomInnerScrollLocksRef.current.size,
          transformScale: appCanvasTransformRef.current.scale.toFixed(4),
          transformX: Math.round(appCanvasTransformRef.current.x),
          transformY: Math.round(appCanvasTransformRef.current.y),
        },
        prepared: appZoomInteractionSurfacePreparedRef.current,
        viewport: zoomViewportRef.current,
        zoom: appZoomRef.current,
      });
      if (isAtNormalZoom) {
        setAppCanvasZoomingDataset(false);
        window.dispatchEvent(new CustomEvent(APP_EVENTS.appCanvasZoomSettled));
      } else {
        setAppCanvasZoomingDataset(true);
      }
    }, APP_ZOOM_SCROLL_LOCK_MS + 40);
  }, [
    applyCanvasZoom,
    captureInnerScrollLocks,
    releaseInnerScrollLocks,
    restoreInnerScrollLocks,
  ]);

  const animateZoomTo = useCallback((
    targetZoom: number,
    anchor: ZoomAnchor,
  ) => {
    const startZoom = appZoomRef.current;
    const committedTargetZoom = clampCommittedZoom(targetZoom);
    const startTime = performance.now();

    lockAppZoomScroll();
    cancelZoomSnapAnimation();

    const runFrame = (now: number) => {
      lockAppZoomScroll();
      const progress = Math.min(1, (now - startTime) / ZOOM_SNAP_DURATION_MS);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextZoom = startZoom + (committedTargetZoom - startZoom) * easedProgress;

      applyVisualZoomAtAnchor(nextZoom, anchor);

      if (progress < 1) {
        zoomSnapAnimationRef.current = window.requestAnimationFrame(runFrame);
        return;
      }

      zoomSnapAnimationRef.current = 0;
      applyZoomAtAnchor(committedTargetZoom, anchor, false);
      appZoomInteractionSurfacePreparedRef.current = false;
      commitZoom(committedTargetZoom);
    };

    zoomSnapAnimationRef.current = window.requestAnimationFrame(runFrame);
  }, [
    applyZoomAtAnchor,
    applyVisualZoomAtAnchor,
    cancelZoomSnapAnimation,
    commitZoom,
    lockAppZoomScroll,
  ]);

  const settleZoomAfterGesture = useCallback((clientX?: number, clientY?: number) => {
    lockAppZoomScroll();
    const viewport = zoomViewportRef.current;
    if (!viewport) {
      commitZoom(appZoomRef.current);
      activeZoomAnchorRef.current = null;
      appZoomInteractionSurfacePreparedRef.current = false;
      return;
    }

    let flushedPendingFrame = false;
    if (zoomRafRef.current) {
      window.cancelAnimationFrame(zoomRafRef.current);
      zoomRafRef.current = 0;
      flushedPendingFrame = true;
      if (activeZoomAnchorRef.current) {
        applyVisualZoomAtAnchor(pendingZoomRef.current, activeZoomAnchorRef.current);
      } else if (pendingAnchorRef.current) {
        zoomAtPoint(
          pendingZoomRef.current,
          pendingAnchorRef.current.x,
          pendingAnchorRef.current.y,
        );
      }
    }

    const currentZoom = appZoomRef.current;
    const fallbackPoint = lastZoomClientRef.current;
    const anchor = activeZoomAnchorRef.current ?? getAnchorCanvasPoint(
        viewport,
        currentZoom,
        clientX ?? fallbackPoint?.x,
        clientY ?? fallbackPoint?.y,
      );

    if (currentZoom < MIN_COMMITTED_APP_ZOOM) {
      dispatchAppZoomDebug("settle-before-reset", {
        canvas: zoomCanvasRef.current,
        canvasSize: zoomCanvasSizeRef.current,
        extra: {
          flushedPendingFrame,
          innerLocks: zoomInnerScrollLocksRef.current.size,
          pendingZoom: pendingZoomRef.current.toFixed(4),
          transformScale: appCanvasTransformRef.current.scale.toFixed(4),
          transformX: Math.round(appCanvasTransformRef.current.x),
          transformY: Math.round(appCanvasTransformRef.current.y),
        },
        prepared: appZoomInteractionSurfacePreparedRef.current,
        viewport,
        zoom: currentZoom,
      });
      animateZoomTo(NORMAL_APP_ZOOM, anchor);
      activeZoomAnchorRef.current = null;
      return;
    }

    dispatchAppZoomDebug("settle-before", {
      canvas: zoomCanvasRef.current,
      canvasSize: zoomCanvasSizeRef.current,
      extra: {
        flushedPendingFrame,
        innerLocks: zoomInnerScrollLocksRef.current.size,
        keepTransform: true,
        pendingZoom: pendingZoomRef.current.toFixed(4),
        transformScale: appCanvasTransformRef.current.scale.toFixed(4),
        transformX: Math.round(appCanvasTransformRef.current.x),
        transformY: Math.round(appCanvasTransformRef.current.y),
      },
      prepared: appZoomInteractionSurfacePreparedRef.current,
      viewport,
      zoom: currentZoom,
    });
    // Keep the exact transform produced by the last gesture frame. Re-applying
    // it around an anchor at gesture end creates a visible snap when the final
    // wheel/native-pinch frame and the settle timer are not perfectly aligned.
    appZoomInteractionSurfacePreparedRef.current = false;
    if (currentZoom <= NORMAL_APP_ZOOM + 0.0005) {
      applyCanvasZoom(NORMAL_APP_ZOOM, false);
    }
    commitZoom(currentZoom);
    dispatchAppZoomDebug("settle-after", {
      canvas: zoomCanvasRef.current,
      canvasSize: zoomCanvasSizeRef.current,
      extra: {
        innerLocks: zoomInnerScrollLocksRef.current.size,
        keepTransform: true,
        transformScale: appCanvasTransformRef.current.scale.toFixed(4),
        transformX: Math.round(appCanvasTransformRef.current.x),
        transformY: Math.round(appCanvasTransformRef.current.y),
      },
      prepared: appZoomInteractionSurfacePreparedRef.current,
      viewport,
      zoom: currentZoom,
    });
    activeZoomAnchorRef.current = null;
  }, [
    applyCanvasZoom,
    animateZoomTo,
    applyVisualZoomAtAnchor,
    commitZoom,
    getAnchorCanvasPoint,
    lockAppZoomScroll,
    zoomAtPoint,
  ]);

  const scheduleZoomSettle = useCallback((clientX?: number, clientY?: number) => {
    if (zoomSettleTimerRef.current !== null) {
      window.clearTimeout(zoomSettleTimerRef.current);
    }

    zoomSettleTimerRef.current = window.setTimeout(() => {
      zoomSettleTimerRef.current = null;
      settleZoomAfterGesture(clientX, clientY);
    }, ZOOM_SETTLE_DELAY_MS);
  }, [settleZoomAfterGesture]);

  const scheduleZoomAtPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const viewport = zoomViewportRef.current;

    prepareAppZoomInteractionSurface();
    lockAppZoomScroll();
    cancelZoomSnapAnimation();
    pendingZoomRef.current = clampInteractionZoom(nextZoom);
    pendingAnchorRef.current = { x: clientX, y: clientY };
    lastZoomClientRef.current = { x: clientX, y: clientY };

    if (viewport && !activeZoomAnchorRef.current) {
      activeZoomAnchorRef.current = getAnchorCanvasPoint(
        viewport,
        appZoomRef.current,
        clientX,
        clientY,
      );
    }

    if (zoomRafRef.current) {
      return;
    }

    zoomRafRef.current = window.requestAnimationFrame(() => {
      zoomRafRef.current = 0;
      const anchor = pendingAnchorRef.current;
      if (!anchor) {
        return;
      }

      if (activeZoomAnchorRef.current) {
        applyVisualZoomAtAnchor(pendingZoomRef.current, activeZoomAnchorRef.current);
        return;
      }

      zoomAtPoint(pendingZoomRef.current, anchor.x, anchor.y);
    });
  }, [
    applyVisualZoomAtAnchor,
    cancelZoomSnapAnimation,
    getAnchorCanvasPoint,
    lockAppZoomScroll,
    prepareAppZoomInteractionSurface,
    zoomAtPoint,
  ]);

  const panZoomViewport = useCallback((deltaX: number, deltaY: number): boolean => {
    const current = appCanvasTransformRef.current;
    if (current.scale <= NORMAL_APP_ZOOM + 0.0005) {
      return false;
    }

    const nextX = current.x - deltaX;
    const nextY = current.y - deltaY;
    const clamped = clampCanvasTranslate(current.scale, nextX, nextY);
    const moved =
      Math.abs(clamped.x - current.x) > 0.01 ||
      Math.abs(clamped.y - current.y) > 0.01;

    if (!moved) {
      return false;
    }

    applyCanvasTransform({
      scale: current.scale,
      x: clamped.x,
      y: clamped.y,
    });
    return true;
  }, [applyCanvasTransform, clampCanvasTranslate]);

  useLayoutEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return undefined;
    }

    const syncCanvasSize = () => {
      syncCanvasBaseSizePreservingAnchor();
    };

    syncCanvasSize();
    window.addEventListener("resize", syncCanvasSize);
    window.visualViewport?.addEventListener("resize", syncCanvasSize);
    const resizeObserver = new ResizeObserver(syncCanvasSize);
    if (zoomCanvasRef.current?.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(zoomCanvasRef.current.firstElementChild);
    }

    return () => {
      window.removeEventListener("resize", syncCanvasSize);
      window.visualViewport?.removeEventListener("resize", syncCanvasSize);
      resizeObserver.disconnect();
    };
  }, [syncCanvasBaseSizePreservingAnchor]);

  useEffect(() => {
    return () => {
      if (zoomRafRef.current) {
        window.cancelAnimationFrame(zoomRafRef.current);
      }

      if (zoomSettleTimerRef.current !== null) {
        window.clearTimeout(zoomSettleTimerRef.current);
      }

      if (zoomScrollUnlockTimerRef.current !== null) {
        window.clearTimeout(zoomScrollUnlockTimerRef.current);
      }

      if (zoomSnapAnimationRef.current) {
        window.cancelAnimationFrame(zoomSnapAnimationRef.current);
      }

      setAppCanvasZoomingDataset(false);
    };
  }, []);

  useEffect(() => {
    if (viewMode === "preview") {
      editorViewRef.current = null;
    }
  }, [viewMode]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerClientRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
    };
  }, []);

  useEffect(() => {
    applyThemeTokens(themeName);
    storeTheme(themeName);
  }, [themeName]);

  useEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return;
    }

    window.localStorage.removeItem(STORAGE_KEYS.appZoom);
    void invokeTauri(TAURI_COMMANDS.setAppZoom, { zoom: NORMAL_APP_ZOOM });
  }, []);

  useEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return undefined;
    }

    const handleAppZoomWheel = (event: WheelEvent) => {
      if (shouldIgnoreAppZoomEvent(event)) {
        return;
      }

      const isZoomWheel = isAppZoomWheelEvent(event);
      const isNativePinchWheelNoise =
        Date.now() - lastNativeGestureAtRef.current < NATIVE_GESTURE_WHEEL_SUPPRESS_MS;
      const isAppZoomScrollLocked = Date.now() < zoomScrollLockUntilRef.current;
      const isCanvasZoomInProgress =
        Boolean(activeZoomAnchorRef.current) ||
        zoomRafRef.current !== 0 ||
        zoomSettleTimerRef.current !== null ||
        zoomSnapAnimationRef.current !== 0;

      if (
        !isZoomWheel &&
        (isNativePinchWheelNoise || isAppZoomScrollLocked || isCanvasZoomInProgress)
      ) {
        restoreInnerScrollLocks();
        consumeAppZoomWheelEvent(event);
        return;
      }

      if (!isZoomWheel) {
        if (appZoomRef.current > NORMAL_APP_ZOOM + 0.0005) {
          captureInnerScrollLocks();
          const didPanCanvas = panZoomViewport(event.deltaX, event.deltaY);
          if (!didPanCanvas) {
            controlledInnerScroll(event.target, event.deltaX, event.deltaY);
          }
          restoreInnerScrollLocks();
          consumeAppZoomWheelEvent(event);
          return;
        }

        if (shouldLetEditorHandleWheel(event)) {
          return;
        }
        return;
      }

      if (isNativePinchWheelNoise) {
        consumeAppZoomWheelEvent(event);
        return;
      }

      lockAppZoomScroll();
      consumeAppZoomWheelEvent(event);
      const baseZoom = zoomRafRef.current ? pendingZoomRef.current : appZoomRef.current;
      const safeDeltaY = Math.max(
        -WHEEL_ZOOM_DELTA_LIMIT,
        Math.min(WHEEL_ZOOM_DELTA_LIMIT, event.deltaY),
      );
      scheduleZoomAtPoint(
        baseZoom * Math.exp(-safeDeltaY * WHEEL_ZOOM_SENSITIVITY),
        event.clientX,
        event.clientY,
      );
      scheduleZoomSettle(event.clientX, event.clientY);
    };

    const handleNativePinchPayload = (detail: NativePinchPayload) => {
      if (document.querySelector(".image-viewer-overlay")) {
        return;
      }

      lastNativeGestureAtRef.current = Date.now();
      lockAppZoomScroll();

      const delta = typeof detail.delta === "number" && Number.isFinite(detail.delta)
        ? detail.delta
        : typeof detail.magnification === "number" && Number.isFinite(detail.magnification)
          ? detail.magnification
          : 0;
      const scale = typeof detail.scale === "number" && Number.isFinite(detail.scale)
        ? detail.scale
        : null;
      const viewport = zoomViewportRef.current;
      const rect = viewport?.getBoundingClientRect();
      const focusX = typeof detail.x === "number" && Number.isFinite(detail.x)
        ? detail.x
        : rect
          ? rect.left + rect.width / 2
          : window.innerWidth / 2;
      const focusY = typeof detail.y === "number" && Number.isFinite(detail.y)
        ? detail.y
        : rect
          ? rect.top + rect.height / 2
          : window.innerHeight / 2;
      const baseZoom = zoomRafRef.current ? pendingZoomRef.current : appZoomRef.current;
      const nextZoom = Math.abs(delta) > 0.000001
        ? baseZoom * Math.exp(delta * NATIVE_PINCH_ZOOM_SENSITIVITY)
        : scale && scale > 0
          ? baseZoom * Math.pow(scale, NATIVE_PINCH_SCALE_SENSITIVITY)
          : baseZoom;

      if (isNativePinchEndPhase(detail.phase) || isNativePinchEndPhase(detail.state)) {
        scheduleZoomSettle(focusX, focusY);
        return;
      }

      scheduleZoomAtPoint(nextZoom, focusX, focusY);
      scheduleZoomSettle(focusX, focusY);
    };

    window.addEventListener("wheel", handleAppZoomWheel, {
      capture: true,
      passive: false,
    });
    let disposed = false;
    let unlistenNativePinch: UnlistenFn | null = null;
    void listen<NativePinchPayload>(APP_EVENTS.nativePinch, (event) => {
      handleNativePinchPayload(event.payload);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenNativePinch = unlisten;
    });

    return () => {
      disposed = true;
      window.removeEventListener("wheel", handleAppZoomWheel, { capture: true });
      unlistenNativePinch?.();
    };
  }, [
    captureInnerScrollLocks,
    controlledInnerScroll,
    lockAppZoomScroll,
    panZoomViewport,
    restoreInnerScrollLocks,
    scheduleZoomAtPoint,
    scheduleZoomSettle,
  ]);

  useEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return undefined;
    }

    const isInnerScrollFrozen = () =>
      Date.now() < zoomScrollLockUntilRef.current ||
      appZoomRef.current > NORMAL_APP_ZOOM + 0.0005 ||
      Boolean(activeZoomAnchorRef.current) ||
      zoomRafRef.current !== 0 ||
      zoomSettleTimerRef.current !== null ||
      zoomSnapAnimationRef.current !== 0;

    const isTransientZoomScrollLocked = () =>
      Date.now() < zoomScrollLockUntilRef.current ||
      Boolean(activeZoomAnchorRef.current) ||
      zoomRafRef.current !== 0 ||
      zoomSettleTimerRef.current !== null ||
      zoomSnapAnimationRef.current !== 0;

    const handleScrollCapture = (event: Event) => {
      if (!isInnerScrollFrozen()) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        zoomInnerScrollLocksRef.current.has(target)
      ) {
        if (isTransientZoomScrollLocked()) {
          restoreInnerScrollLocks();
          return;
        }

        zoomInnerScrollLocksRef.current.set(target, {
          left: target.scrollLeft,
          top: target.scrollTop,
        });
      }
    };

    document.addEventListener("scroll", handleScrollCapture, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("scroll", handleScrollCapture, { capture: true });
    };
  }, [restoreInnerScrollLocks]);

  useEffect(() => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      return undefined;
    }

    const isAppCanvasInteractionLocked = () =>
      Date.now() < zoomScrollLockUntilRef.current ||
      Boolean(activeZoomAnchorRef.current) ||
      zoomRafRef.current !== 0 ||
      zoomSettleTimerRef.current !== null ||
      zoomSnapAnimationRef.current !== 0;

    const handlePointerCapture = (event: Event) => {
      if (!isAppCanvasInteractionLocked()) {
        if (appZoomRef.current > NORMAL_APP_ZOOM + 0.0005) {
          if (
            isAppZoomPointerLikeEvent(event) &&
            event.type === "mousedown" &&
            Date.now() - lastAppZoomCursorPlacementAtRef.current < 120 &&
            event.target instanceof Node &&
            editorViewRef.current &&
            (editorViewRef.current as unknown as EditorView).dom.contains(event.target)
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
          }

          if (
            isAppZoomPointerLikeEvent(event) &&
            (event.type === "pointerdown" || event.type === "mousedown")
          ) {
            if (placeEditorCursorDuringAppZoom(event)) {
              return;
            }
            if (
              event.target instanceof Node &&
              editorViewRef.current &&
              (editorViewRef.current as unknown as EditorView).dom.contains(event.target)
            ) {
              preserveCurrentInnerScrollPosition(event.target);
              consumeAppZoomPointerEvent(event);
              return;
            }
          }

          if (
            isAppZoomPointerLikeEvent(event) &&
            (event.type === "mouseup" || event.type === "click" || event.type === "dblclick") &&
            event.target instanceof Node &&
            editorViewRef.current &&
            (editorViewRef.current as unknown as EditorView).dom.contains(event.target)
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
          }

          const target = event.target;
          if (
            target instanceof Node &&
            zoomCanvasRef.current?.contains(target)
          ) {
            preserveCurrentInnerScrollPosition(event.target);
          }
        }
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!zoomCanvasRef.current?.contains(target)) {
        return;
      }

      restoreInnerScrollLocks();
      consumeAppZoomPointerEvent(event);
    };

    const eventNames = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "contextmenu",
    ] as const;

    eventNames.forEach((eventName) => {
      window.addEventListener(eventName, handlePointerCapture, {
        capture: true,
        passive: false,
      });
    });

    return () => {
      eventNames.forEach((eventName) => {
        window.removeEventListener(eventName, handlePointerCapture, { capture: true });
      });
    };
  }, [placeEditorCursorDuringAppZoom, preserveCurrentInnerScrollPosition, restoreInnerScrollLocks]);

  const updateActiveDocument = (value: string) => {
    if (!activeFileId) {
      setStatusMessage(t("status.selectDocumentBeforeWriting"));
      return;
    }

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

  const runAppZoomCommand = useCallback((action: "in" | "out" | "reset") => {
    cancelZoomSnapAnimation();

    const viewport = zoomViewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    const fallbackClientX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const fallbackClientY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const clientX = lastPointerClientRef.current?.x ?? fallbackClientX;
    const clientY = lastPointerClientRef.current?.y ?? fallbackClientY;
    const nextZoom =
      action === "in"
        ? appZoomRef.current + APP_ZOOM_STEP
        : action === "out"
          ? appZoomRef.current - APP_ZOOM_STEP
          : NORMAL_APP_ZOOM;
    const zoom = clampCommittedZoom(nextZoom);

    if (!viewport) {
      applyCanvasZoom(zoom, false);
      commitZoom(zoom);
    } else {
      const anchor = getAnchorCanvasPoint(viewport, appZoomRef.current, clientX, clientY);
      applyZoomAtAnchor(zoom, anchor, false);
      commitZoom(zoom);
    }

    if (zoom > NORMAL_APP_ZOOM + 0.0005) {
      setAppCanvasZoomingDataset(true);
      captureInnerScrollLocks();
      restoreInnerScrollLocks();
    } else {
      restoreInnerScrollLocks();
      releaseInnerScrollLocks();
      setAppCanvasZoomingDataset(false);
    }

    setStatusMessage(t("status.zoomPercent", { percent: Math.round(zoom * 100) }));
  }, [
    applyCanvasZoom,
    applyZoomAtAnchor,
    cancelZoomSnapAnimation,
    commitZoom,
    captureInnerScrollLocks,
    getAnchorCanvasPoint,
    releaseInnerScrollLocks,
    restoreInnerScrollLocks,
    t,
  ]);

  const loadWorkspace = async (nextWorkspaceRoot: string): Promise<boolean> => {
    try {
      const items = await listWorkspaceFiles(nextWorkspaceRoot);
      const firstFile = findFirstFile(items);

      setWorkspaceRoot(nextWorkspaceRoot);
      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [nextWorkspaceRoot]: items,
      }));
      setDocuments({});
      setDocumentWorkspaceRoots({});
      setDocumentRelativePaths({});
      setDirtyFileIds(new Set());
      setSelectedTreeItemId("");
      setStatusMessage(t("status.openedWorkspace", { path: nextWorkspaceRoot }));

      if (firstFile) {
        const source = await loadMarkdownFile({
          workspaceRoot: nextWorkspaceRoot,
          relativePath: firstFile.id,
        });
        setDocuments({ [firstFile.id]: source });
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

  const openFile = async () => {
    try {
      const selectedFile = await chooseMarkdownFile();

      if (!selectedFile) {
        setStatusMessage(t("status.openFileCancelled"));
        return;
      }

      const openedFile = await openMarkdownFile(selectedFile);
      const documentId = makeWorkspaceDocumentId({
        currentDocumentIds: new Set([...openFileIds, ...Object.keys(documents)]),
        currentWorkspaceRoot: workspaceRoot,
        relativePath: openedFile.relativePath,
        workspaceRoot: openedFile.workspaceRoot,
      });
      setWorkspaceRoot(openedFile.workspaceRoot);
      setWorkspaceItems(openedFile.tree);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [openedFile.workspaceRoot]: openedFile.tree,
      }));
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        [documentId]: openedFile.markdownContent,
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
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshRepositoryState = useCallback(async () => {
    try {
      const account = await getRepositoryAccount();
      const binding = workspaceRoot
        ? await getWorkspaceRepositoryBinding(workspaceRoot)
        : null;

      setRepositoryAccount(account);
      setRepositoryBinding(binding);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refreshRepositoryState();
  }, [refreshRepositoryState]);

  const repositoryErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

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
        setRepositoryError(
          "No repositories are visible to this token. Give the token access to at least one repository with Metadata read and Contents read/write permissions, then reconnect Cloud Sync.",
        );
      }
    } catch (error) {
      const message = repositoryErrorMessage(error);
      if (isRepositoryAuthenticationError(message)) {
        setRepositoryAccount(null);
        setRepositoryBinding(null);
        setRepositories([]);
        setRepositoryError(
          "Your saved Cloud Sync credentials are no longer available. Connect GitHub again to load your repositories.",
        );
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
      setStatusMessage(
        `Connected ${repositoryProviderLabel(account.provider)} as ${account.login}.`
      );
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

  const dirtyDocumentIdsForWorkspace = (targetWorkspaceRoot: string): string[] =>
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
    });

  const saveDirtyDocumentsForWorkspace = async (targetWorkspaceRoot: string) => {
    const dirtyIds = dirtyDocumentIdsForWorkspace(targetWorkspaceRoot);
    for (const fileId of dirtyIds) {
      const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
      const content = documents[fileId];
      if (!relativePath || content === undefined) {
        continue;
      }
      await saveMarkdownFile({
        workspaceRoot: targetWorkspaceRoot,
        relativePath,
        markdownContent: content,
      });
    }
    if (dirtyIds.length > 0) {
      setDirtyFileIds((currentDirtyFileIds) => {
        const nextDirtyFileIds = new Set(currentDirtyFileIds);
        dirtyIds.forEach((fileId) => nextDirtyFileIds.delete(fileId));
        return nextDirtyFileIds;
      });
    }
  };

  const reloadWorkspaceAfterDownload = async (targetWorkspaceRoot: string) => {
    const items = await listWorkspaceFiles(targetWorkspaceRoot);
    if (targetWorkspaceRoot === workspaceRoot) {
      setWorkspaceItems(items);
    }
    setWorkspaceItemsByRoot((currentTrees) => ({
      ...currentTrees,
      [targetWorkspaceRoot]: items,
    }));

    const reloadableDocuments = openFileIdsRef.current.filter((fileId) => {
      const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
      return (
        !isUntitledDocument(fileId) &&
        !dirtyFileIdsRef.current.has(fileId) &&
        documentWorkspaceRootForId(
          fileId,
          documentWorkspaceRoots,
          workspaceRoot,
        ) === targetWorkspaceRoot &&
        Boolean(findWorkspaceItem(items, relativePath))
      );
    });
    const reloadedEntries = await Promise.all(
      reloadableDocuments.map(async (fileId) => {
        const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
        const content = await loadMarkdownFile({
          workspaceRoot: targetWorkspaceRoot,
          relativePath,
        });
        return [fileId, content] as const;
      }),
    );
    if (reloadedEntries.length > 0) {
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        ...Object.fromEntries(reloadedEntries),
      }));
    }
  };

  const resolveRepositoryContext = async () => {
    const account = await getRepositoryAccount();
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

    const binding = await getWorkspaceRepositoryBinding(workspaceRoot);
    setRepositoryBinding(binding);
    if (!binding) {
      await openLinkWorkspaceDialog(account, workspaceRoot);
      return null;
    }

    return { account, binding, workspaceRoot };
  };

  const refreshSyncStatus = async () => {
    showRepositoryOperation(
      "Checking Cloud Sync",
      "Checking local and remote changes...",
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
      setRepositorySyncStatus(status);
      setRepositoryAccount(status.account ?? null);
      setRepositoryBinding(status.binding ?? null);
      setRepositoryDialog("status");
    } catch (error) {
      const message = repositoryErrorMessage(error);
      showRepositoryOperation(t("cloud.statusTitle"), message, false);
      setStatusMessage(message);
    } finally {
      setIsRepositoryBusy(false);
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
      await saveDirtyDocumentsForWorkspace(context.workspaceRoot);
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
      if (action === "pull" || action === "sync") {
        await reloadWorkspaceAfterDownload(context.workspaceRoot);
      }
      setRepositoryDialog(status.conflicts.length > 0 ? "status" : null);
      setRepositoryOperation({
        title: operation.title,
        message:
          status.conflicts.length > 0
            ? t("status.syncConflicts", { count: status.conflicts.length })
            : t("status.operationCompleted", { operation: operation.title }),
        isBusy: false,
        status: status.conflicts.length > 0 ? "error" : "success",
      });
      setStatusMessage(
        status.conflicts.length > 0
          ? t("status.syncConflicts", { count: status.conflicts.length })
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

  const createUntitledDocument = () => {
    const nextUntitledNumber = untitledCounter + 1;
    const title =
      nextUntitledNumber === 1 ? "Untitled" : `Untitled ${nextUntitledNumber}`;
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
    const documentId = findOpenDocumentIdForWorkspaceFile(
      openFileIds,
      documentWorkspaceRoots,
      documentRelativePaths,
      workspaceRoot,
      fileId,
    ) ?? fileId;

    setDocumentWorkspaceRoots((currentRoots) => ({
      ...currentRoots,
      [documentId]: workspaceRoot,
    }));
    setDocumentRelativePaths((currentPaths) => ({
      ...currentPaths,
      [documentId]: fileId,
    }));
    setActiveFileId(documentId);
    setSelectedTreeItemId(findWorkspaceItem(workspaceItems, fileId) ? fileId : "");
    revealFolder(parentFolderIdOf(fileId));
    addOpenTab(documentId);

    if (!workspaceRoot || documents[documentId] !== undefined) {
      return;
    }

    try {
      const source = await loadMarkdownFile({
        workspaceRoot,
        relativePath: fileId,
      });
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        [documentId]: source,
      }));
      setStatusMessage(t("status.loadedPath", { path: fileId }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const activateTab = async (fileId: string) => {
    if (!fileId) {
      return;
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
          setWorkspaceRoot(nextWorkspaceRoot);
          setWorkspaceItems(items);
          setWorkspaceItemsByRoot((currentTrees) => ({
            ...currentTrees,
            [nextWorkspaceRoot]: items,
          }));
        } catch (error) {
          setStatusMessage(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    }

    setActiveFileId(fileId);
    setSelectedTreeItemId(isUntitledDocument(fileId) ? "" : nextRelativePath);
    revealFolder(parentFolderIdOf(nextRelativePath));

    if (!nextWorkspaceRoot || documents[fileId] !== undefined || isUntitledDocument(fileId)) {
      return;
    }

    try {
      const source = await loadMarkdownFile({
        workspaceRoot: nextWorkspaceRoot,
        relativePath: nextRelativePath,
      });
      setDocuments((currentDocuments) => ({
        ...currentDocuments,
        [fileId]: source,
      }));
      setStatusMessage(t("status.loadedPath", { path: nextRelativePath }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const selectDocumentStructureItem = (position: number) => {
    const editorView = editorViewRef.current;
    if (!editorView) {
      return;
    }

    editorView.focus();
    editorView.dispatch({
      selection: { anchor: position },
      scrollIntoView: true,
    });
  };

  const saveTab = async (fileId: string): Promise<string | null> => {
    const content = documents[fileId] ?? "";
    const relativePath = documentRelativePathForId(fileId, documentRelativePaths);
    const tabItem = findWorkspaceItem(workspaceItems, relativePath);
    const tabName = tabItem?.name ?? documentTitles[fileId] ?? fileNameOf(relativePath);

    if (isUntitledDocument(fileId)) {
      const selectedPath = await chooseMarkdownSavePath(
        deriveDefaultMarkdownFileName(content, tabName),
      );
      if (!selectedPath) {
        setStatusMessage(t("status.saveCancelled"));
        return null;
      }

      const markdownFilePath = ensureMarkdownFilePath(selectedPath);
      await writeMarkdownFile({
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

      setWorkspaceRoot(workspacePath);
      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspacePath]: items,
      }));
      setDocuments((currentDocuments) => {
        const nextDocuments = { ...currentDocuments };
        delete nextDocuments[fileId];
        nextDocuments[nextDocumentId] = content;
        return nextDocuments;
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
        return nextDirtyFileIds;
      });
      lastSavedFileIdRef.current = nextDocumentId;
      setStatusMessage(t("status.savedPath", { path: relativePath }));
      return nextDocumentId;
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

    await saveMarkdownFile({
      workspaceRoot: tabWorkspaceRoot,
      relativePath: tabRelativePath,
      markdownContent: content,
    });
    setDirtyFileIds((currentDirtyFileIds) => {
      const nextDirtyFileIds = new Set(currentDirtyFileIds);
      nextDirtyFileIds.delete(fileId);
      return nextDirtyFileIds;
    });
    lastSavedFileIdRef.current = fileId;
    setStatusMessage(t("status.savedPath", { path: tabRelativePath }));
    return fileId;
  };

  const closeTab = async (fileId: string) => {
    if (!fileId) {
      return;
    }

    const tabItem = findWorkspaceItem(workspaceItems, fileId);
    const tabName = tabItem?.name ?? documentTitles[fileId] ?? "Untitled";
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

    const currentTabIds = openFileIds;
    const closeIndex = Math.max(
      0,
      currentTabIds.findIndex((tabId) => tabId === fileId || tabId === fileIdToClose),
    );
    const nextTabIds = currentTabIds.filter(
      (tabId) => tabId !== fileId && tabId !== fileIdToClose,
    );
    const nextActiveFileId =
      activeFileId === fileId || activeFileId === fileIdToClose
        ? nextTabIds[Math.min(closeIndex, nextTabIds.length - 1)] ?? ""
        : activeFileId;

    setOpenFileIds(nextTabIds);
    setDocuments((currentDocuments) => {
      const nextDocuments = { ...currentDocuments };
      delete nextDocuments[fileId];
      delete nextDocuments[fileIdToClose];
      return nextDocuments;
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

    if (nextActiveFileId) {
      setActiveFileId(nextActiveFileId);
      void activateTab(nextActiveFileId);
    } else {
      setActiveFileId("");
      setSelectedTreeItemId("");
      editorViewRef.current = null;
    }

    setStatusMessage(t("status.closedPath", { path: tabName }));
  };

  const saveActiveFile = async (): Promise<boolean> => {
    if (isUntitledDocument(activeFileId)) {
      return saveActiveFileAs();
    }

    const saveWorkspaceRoot = documentWorkspaceRootForId(
      activeFileId,
      documentWorkspaceRoots,
      workspaceRoot,
    );
    const saveRelativePath = documentRelativePathForId(activeFileId, documentRelativePaths);

    if (!saveWorkspaceRoot) {
      setStatusMessage(t("status.openWorkspaceBeforeSave"));
      return false;
    }

    if (!activeFileId) {
      setStatusMessage(t("status.selectDocumentBeforeSave"));
      return false;
    }

    try {
      await saveMarkdownFile({
        workspaceRoot: saveWorkspaceRoot,
        relativePath: saveRelativePath,
        markdownContent,
      });
      setDirtyFileIds((currentDirtyFileIds) => {
        const nextDirtyFileIds = new Set(currentDirtyFileIds);
        nextDirtyFileIds.delete(activeFileId);
        return nextDirtyFileIds;
      });
      lastSavedFileIdRef.current = activeFileId;
      setStatusMessage(t("status.savedPath", { path: saveRelativePath }));
      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const saveActiveFileAs = async (): Promise<boolean> => {
    if (!activeFileId) {
      setStatusMessage(t("status.selectDocumentBeforeSave"));
      return false;
    }

    try {
      const defaultFileName = deriveDefaultMarkdownFileName(
        markdownContent,
        activeFileName,
      );
      const selectedPath = await chooseMarkdownSavePath(defaultFileName);

      if (!selectedPath) {
        setStatusMessage(t("status.saveCancelled"));
        return false;
      }

      const markdownFilePath = ensureMarkdownFilePath(selectedPath);
      await writeMarkdownFile({
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

      setWorkspaceRoot(workspacePath);
      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspacePath]: items,
      }));
      setDocuments((currentDocuments) => {
        const nextDocuments = { ...currentDocuments };
        delete nextDocuments[activeFileId];
        nextDocuments[nextDocumentId] = markdownContent;
        return nextDocuments;
      });
      setDocumentTitles((currentTitles) => {
        const nextTitles = { ...currentTitles };
        delete nextTitles[activeFileId];
        return nextTitles;
      });
      setActiveFileId(nextDocumentId);
      setOpenFileIds((currentFileIds) =>
        currentFileIds.map((fileId) => fileId === activeFileId ? nextDocumentId : fileId),
      );
      setSelectedTreeItemId(relativePath);
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
        return nextDirtyFileIds;
      });
      lastSavedFileIdRef.current = nextDocumentId;
      setStatusMessage(t("status.savedPath", { path: relativePath }));
      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return false;
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
      const source = await loadMarkdownFile({
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
        [relativePath]: source,
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
    const itemType = createItemType;

    setCreateItemType(null);
    setCreateParentPath(null);

    if (itemType === "file") {
      await createFile(name);
    }

    if (itemType === "folder") {
      await createFolder(name);
    }
  };

  const startRename = (targetPath?: string) => {
    const targetId = targetPath ?? (selectedTreeItemId || activeFileId);
    const targetItem = findWorkspaceItem(workspaceItems, targetId);

    if (!targetItem) {
      setStatusMessage(t("status.selectBeforeRename"));
      return;
    }

    if (targetAffectsDirtyFile(targetItem.id, dirtyFileIds)) {
      setStatusMessage(t("status.saveBeforeRename"));
      return;
    }

    setRenameItemId(targetItem.id);
  };

  const deleteWorkspaceItem = async (targetPath?: string) => {
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
      `Delete ${targetItem.name}? This action cannot be undone.`,
      { kind: "warning", title: t("dialog.deleteWorkspaceTitle") },
    );
    if (!confirmed) {
      return;
    }

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
    }
  };

  const duplicateWorkspaceItem = async (targetPath?: string) => {
    const targetId = targetPath ?? (selectedTreeItemId || activeFileId);
    const targetItem = findWorkspaceItem(workspaceItems, targetId);
    if (!workspaceRoot || !targetItem) {
      setStatusMessage(t("status.selectBeforeDuplicate"));
      return;
    }
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
    }
  };

  const confirmRename = async (item: WorkspaceItem, nextName: string) => {
    if (!workspaceRoot) {
      return;
    }

    if (targetAffectsDirtyFile(item.id, dirtyFileIds)) {
      setStatusMessage(t("status.saveBeforeRename"));
      return;
    }

    try {
      const response = await renameEntry({
        workspaceRoot,
        sourceRelativePath: item.id,
        newName: nextName,
      });
      const items = await listWorkspaceFiles(workspaceRoot);

      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspaceRoot]: items,
      }));
      setRenameItemId(null);
      setDocuments((currentDocuments) =>
        remapDocumentPaths(
          currentDocuments,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setDirtyFileIds((currentDirtyFileIds) =>
        remapDirtyFileIds(
          currentDirtyFileIds,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setActiveFileId((currentActiveFileId) =>
        remapPath(
          currentActiveFileId,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setSelectedTreeItemId((currentSelectedItemId) =>
        remapPath(
          currentSelectedItemId,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setOpenFileIds((currentFileIds) =>
        currentFileIds.map((fileId) =>
          remapPath(fileId, response.oldRelativePath, response.newRelativePath),
        ),
      );
      setDocumentWorkspaceRoots((currentRoots) =>
        remapDocumentMetadataKeys(currentRoots, response.oldRelativePath, response.newRelativePath),
      );
      setDocumentRelativePaths((currentPaths) =>
        remapDocumentMetadataPaths(currentPaths, response.oldRelativePath, response.newRelativePath),
      );
      setStatusMessage(
        `Renamed ${response.oldRelativePath} to ${response.newRelativePath}`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const moveWorkspaceEntry = async (
    sourcePath: string,
    targetParentPath: string | null,
  ) => {
    if (!workspaceRoot) {
      setStatusMessage(t("status.openWorkspaceBeforeMove"));
      return;
    }

    if (targetAffectsDirtyFile(sourcePath, dirtyFileIds)) {
      setStatusMessage(t("status.saveBeforeMove"));
      return;
    }

    try {
      const response = await moveEntry({
        workspaceRoot,
        sourceRelativePath: sourcePath,
        targetParentRelativePath: targetParentPath,
      });
      const items = await listWorkspaceFiles(workspaceRoot);

      setWorkspaceItems(items);
      setWorkspaceItemsByRoot((currentTrees) => ({
        ...currentTrees,
        [workspaceRoot]: items,
      }));
      setDocuments((currentDocuments) =>
        remapDocumentPaths(
          currentDocuments,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setDirtyFileIds((currentDirtyFileIds) =>
        remapDirtyFileIds(
          currentDirtyFileIds,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setActiveFileId((currentActiveFileId) =>
        remapPath(
          currentActiveFileId,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setSelectedTreeItemId((currentSelectedItemId) =>
        remapPath(
          currentSelectedItemId,
          response.oldRelativePath,
          response.newRelativePath,
        ),
      );
      setOpenFileIds((currentFileIds) =>
        currentFileIds.map((fileId) =>
          remapPath(fileId, response.oldRelativePath, response.newRelativePath),
        ),
      );
      setDocumentWorkspaceRoots((currentRoots) =>
        remapDocumentMetadataKeys(currentRoots, response.oldRelativePath, response.newRelativePath),
      );
      setDocumentRelativePaths((currentPaths) =>
        remapDocumentMetadataPaths(currentPaths, response.oldRelativePath, response.newRelativePath),
      );
      revealFolder(targetParentPath);
      setStatusMessage(
        `Moved ${response.oldRelativePath} to ${response.newRelativePath}`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const formatMarkdown = (command: AppCommand) => {
    const editorView = editorViewRef.current;

    if (!editorView) {
      setStatusMessage(t("status.focusBeforeFormat"));
      return;
    }

    const text = editorView.state.doc.toString();
    const selection = editorView.state.selection.main;
    const edit = applyMarkdownFormat(command, text, selection);

    if (!edit) {
      return;
    }

    editorView.dispatch({
      changes: {
        from: 0,
        to: text.length,
        insert: edit.nextText,
      },
      selection: {
        anchor: edit.selectionAnchor,
        head: edit.selectionHead,
      },
      scrollIntoView: false,
    });
    editorView.focus();
  };

  const insertMarkdownAtSelection = (insertText: string) => {
    const editorView = editorViewRef.current;

    if (!activeFileId) {
      setStatusMessage(t("status.openDocumentBeforeInsert"));
      return;
    }

    if (!editorView) {
      const nextMarkdownContent = `${markdownContent.replace(/\s*$/, "\n\n")}${insertText.trimStart()}`;
      updateActiveDocument(nextMarkdownContent);
      return;
    }

    const selection = editorView.state.selection.main;
    editorView.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: insertText,
      },
      selection: {
        anchor: selection.from + insertText.length,
      },
      scrollIntoView: true,
    });
    editorView.focus();
  };

  const insertTable = (columns: number, rows: number) => {
    const header = `| ${Array.from({ length: columns }, (_, index) => `Column ${index + 1}`).join(" | ")} |`;
    const separator = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
    const body = Array.from(
      { length: rows },
      () => `| ${Array.from({ length: columns }, () => " ").join(" | ")} |`,
    ).join("\n");

    insertMarkdownAtSelection(`\n${header}\n${separator}\n${body}\n`);
    setIsInsertTableDialogOpen(false);
  };

  const insertCodeFence = (language: string) => {
    const template = codeFenceTemplate(language);
    insertMarkdownAtSelection(template);
    setIsInsertCodeFenceDialogOpen(false);
  };

  const runEditorSearchCommand = (
    command: "edit.find" | "edit.findNext" | "edit.findPrevious",
  ) => {
    if (!editorViewRef.current) {
      setStatusMessage(t("status.focusBeforeSearch"));
      return;
    }

    const editorView = editorViewRef.current as unknown as EditorView;
    const didRun =
      command === "edit.find"
        ? openSearchPanel(editorView)
        : command === "edit.findNext"
          ? findNext(editorView)
          : findPrevious(editorView);

    if (!didRun) {
      setStatusMessage(t("status.searchUnavailable"));
    }
  };

  const ensureSavedMarkdownAssetTarget = async (): Promise<boolean> => {
    if (!activeFileId || isUntitledDocument(activeFileId)) {
      setStatusMessage(t("status.saveBeforeImage"));
      return false;
    }

    if (!workspaceRoot) {
      setStatusMessage(t("status.openWorkspaceBeforeImage"));
      return false;
    }

    return true;
  };

  const insertImageFromPath = async (sourcePath: string) => {
    if (!(await ensureSavedMarkdownAssetTarget())) {
      return;
    }

    try {
      const asset = await copyImageAsset({
        workspaceRoot,
        markdownRelativePath: activeFileId,
        sourcePath,
      });
      insertMarkdownAtSelection(`${asset.markdownInsertText}\n`);
      setStatusMessage(t("status.insertedPath", { path: asset.assetRelativePath }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const insertImageFromDialog = async () => {
    if (!(await ensureSavedMarkdownAssetTarget())) {
      return;
    }

    try {
      const imagePath = await chooseImageFile();
      if (imagePath) {
        await insertImageFromPath(imagePath);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const pasteImageItems = async (
    items: DataTransferItemList,
    insertMarkdown?: (markdown: string) => void,
  ) => {
    if (!(await ensureSavedMarkdownAssetTarget())) {
      return;
    }

    const imageItem = [...items].find((item) => item.type.startsWith("image/"));
    const imageFile = imageItem?.getAsFile();

    if (!imageFile) {
      return;
    }

    try {
      const bytes = [...new Uint8Array(await imageFile.arrayBuffer())];
      const extension = imageFile.type.split("/").at(-1) ?? "png";
      const asset = await saveImageAsset({
        workspaceRoot,
        markdownRelativePath: activeFileId,
        fileName: `image-${timestampForFileName()}.${extension}`,
        imageBytes: bytes,
        extension,
      });
      const imageMarkdown = `${asset.markdownInsertText}\n`;
      if (insertMarkdown) {
        insertMarkdown(imageMarkdown);
      } else {
        insertMarkdownAtSelection(imageMarkdown);
      }
      setStatusMessage(t("status.insertedPath", { path: asset.assetRelativePath }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const executeCommand: ExecuteAppCommand = (
    command: AppCommand,
    payload?: AppCommandPayload,
  ) => {
      const targetPath = payload?.targetPath;
      const targetItem = targetPath
        ? findWorkspaceItem(workspaceItems, targetPath)
        : null;
      const parentPath = targetItem?.type === "folder" ? targetItem.id : null;
      const commandTargetPath = targetPath ?? activeFileId;

      if (command === "app.about") {
        setIsAboutDialogOpen(true);
        return;
      }

      if (command === "app.newWindow") {
        void openNewAppWindow().catch((error: unknown) => {
          setStatusMessage(error instanceof Error ? error.message : String(error));
        });
        return;
      }

      if (command === "file.newFile") {
        if (payload?.workspaceCreate) {
          void openCreateDialog("file", parentPath ?? undefined);
        } else {
          createUntitledDocument();
        }
        return;
      }

      if (command === "file.newFolder") {
        void openCreateDialog("folder", parentPath ?? undefined);
        return;
      }

      if (command === "file.openFile") {
        if (targetItem?.type === "file") {
          void selectFile(targetItem.id);
        } else {
          void openFile();
        }
        return;
      }

      if (command === "file.openFolder") {
        void openWorkspace();
        return;
      }

      if (command === "file.save") {
        void saveActiveFile();
        return;
      }

      if (command === "file.saveAs") {
        void saveActiveFileAs();
        return;
      }

      if (command === "file.close") {
        void closeTab(activeFileId);
        return;
      }

      if (command === "format.insertImage") {
        void insertImageFromDialog();
        return;
      }

      if (command === "editor.insertTable") {
        setIsInsertTableDialogOpen(true);
        return;
      }

      if (command === "editor.insertCodeFence") {
        setIsInsertCodeFenceDialogOpen(true);
        return;
      }

      if (command === "file.rename") {
        startRename(commandTargetPath);
        return;
      }

      if (command === "file.delete") {
        void deleteWorkspaceItem(commandTargetPath);
        return;
      }

      if (command === "file.duplicate") {
        void duplicateWorkspaceItem(commandTargetPath);
        return;
      }

      if (command === "file.move") {
        const sourcePath = payload?.sourcePath;
        const targetParentPath = payload?.targetParentPath ?? null;

        if (!sourcePath) {
          setStatusMessage(t("status.selectBeforeMove"));
          return;
        }

        void moveWorkspaceEntry(sourcePath, targetParentPath);
        return;
      }

      if (command === "file.revealInFinder") {
        if (!workspaceRoot) {
          setStatusMessage(t("status.openWorkspaceBeforeReveal"));
          return;
        }

        void revealInFileManager({
          workspaceRoot,
          relativePath: commandTargetPath,
        }).catch((error: unknown) =>
          setStatusMessage(
            error instanceof Error ? error.message : String(error),
          ),
        );
        return;
      }

      if (command === "file.copyPath") {
        const pathToCopy = commandTargetPath
          ? `${workspaceRoot.replace(/[\\/]$/, "")}/${commandTargetPath}`
          : workspaceRoot;

        void navigator.clipboard
          .writeText(pathToCopy)
          .then(() => setStatusMessage(t("status.copiedPath")))
          .catch((error: unknown) =>
            setStatusMessage(
              error instanceof Error ? error.message : String(error),
            ),
          );
        return;
      }

      if (command === "workspace.refresh") {
        if (workspaceRoot) {
          void loadWorkspace(workspaceRoot);
        }
        return;
      }

      if (command === "workspace.collapseAll") {
        setCollapseVersion((version) => version + 1);
        return;
      }

      if (command === "view.toggleSidebar") {
        setSidebarOpen((isOpen) => !isOpen);
        return;
      }

      if (command === "view.fileTree") {
        if (!workspaceRoot) {
          void openWorkspace();
        } else {
          setSidebarOpen(true);
        }
        return;
      }

      if (command === "view.edit") {
        setViewMode("edit");
        return;
      }

      if (command === "view.sourceCode") {
        setViewMode("edit");
        return;
      }

      if (command === "view.liveEdit") {
        setViewMode("live");
        return;
      }

      if (command === "view.split") {
        setViewMode("split");
        return;
      }

      if (command === "view.preview") {
        setViewMode("preview");
        return;
      }

      if (command === "view.zoomIn") {
        runAppZoomCommand("in");
        return;
      }

      if (command === "view.zoomOut") {
        runAppZoomCommand("out");
        return;
      }

      if (command === "view.resetZoom") {
        runAppZoomCommand("reset");
        return;
      }

      if (command === "theme.light") {
        setThemeName("light");
        setStatusMessage(t("status.themeChanged", { theme: t("menu.light") }));
        return;
      }

      if (command === "theme.dark") {
        setThemeName("dark");
        setStatusMessage(t("status.themeChanged", { theme: t("menu.dark") }));
        return;
      }

      if (
        command === "edit.find" ||
        command === "edit.findNext" ||
        command === "edit.findPrevious"
      ) {
        runEditorSearchCommand(command);
        return;
      }

      if (command === "repository.connectGithub") {
        setRepositoryDialog("connect");
        return;
      }

      if (command === "repository.disconnectGithub") {
        void disconnectRepositoryAccount();
        return;
      }

      if (command === "repository.linkWorkspace") {
        void openLinkWorkspaceDialog();
        return;
      }

      if (command === "repository.viewSyncStatus") {
        void refreshSyncStatus();
        return;
      }

      if (command === "repository.pushWorkspace") {
        void runRepositorySyncAction("push");
        return;
      }

      if (command === "repository.pullWorkspace") {
        void runRepositorySyncAction("pull");
        return;
      }

      if (command === "repository.syncNow") {
        void runRepositorySyncAction("sync");
        return;
      }

      if (command.startsWith("format.")) {
        formatMarkdown(command);
        return;
      }

      setStatusMessage(
        t("status.commandReserved", { command }),
      );
  };

  useAppShortcuts(executeCommand);
  useNativeAppMenu(executeCommand, {
    repositoryAccount,
    repositoryBinding,
  });

  const shouldUseAppCanvasZoom = APP_CANVAS_ZOOM_ENABLED;
  const renderedAppZoom = shouldUseAppCanvasZoom
    ? appZoomRef.current
    : NORMAL_APP_ZOOM;
  const renderedCanvasPlacement = shouldUseAppCanvasZoom
    ? appCanvasPlacementRef.current
    : null;
  const renderedCanvasTransform = shouldUseAppCanvasZoom
    ? appCanvasTransformRef.current
    : { scale: NORMAL_APP_ZOOM, x: 0, y: 0 };
  const appZoomCanvasSizeStyle = {
    width: "100%",
    height: "100%",
  } satisfies CSSProperties;

  const appZoomCanvasStyle = {
    left: `${renderedCanvasPlacement?.offsetLeft ?? 0}px`,
    top: `${renderedCanvasPlacement?.offsetTop ?? 0}px`,
    width: shouldUseAppCanvasZoom ? `${appCanvasSize.width}px` : "100%",
    height: shouldUseAppCanvasZoom ? `${appCanvasSize.height}px` : "100%",
    transform: shouldUseAppCanvasZoom
      ? `translate3d(${renderedCanvasTransform.x}px, ${renderedCanvasTransform.y}px, 0) scale(${renderedAppZoom})`
      : "none",
  } satisfies CSSProperties;

  return (
    <>
      <div ref={zoomViewportRef} className="app-zoom-viewport">
        <div
          ref={zoomCanvasSizeRef}
          className="app-zoom-canvas-size"
          style={appZoomCanvasSizeStyle}
        >
          <div
            ref={zoomCanvasRef}
            className="app-zoom-canvas"
            style={appZoomCanvasStyle}
          >
            <AppShell
              activeFileId={activeFileId}
              activeFileName={activeFileName}
              characterCount={markdownContent.length}
              collapseVersion={collapseVersion}
              debugEnabled={debugEnabled}
              documentStructureItems={documentStructureItems}
              dirtyFileIds={dirtyFileIds}
              executeCommand={executeCommand}
              folderRevealRequest={folderRevealRequest}
              isDocumentStructureOpen={isDocumentStructureOpen}
              isDirty={isDirty}
              renameItemId={renameItemId}
              selectedTreeItemId={selectedTreeItemId}
              sidebarOpen={sidebarOpen}
              statusMessage={statusMessage}
              syncMessage={
                repositoryOperation.message
                  ? `${repositoryOperation.title}: ${repositoryOperation.message}`
                  : ""
              }
              syncState={repositoryOperation.status}
              tabs={openTabs}
              workspaceRoot={workspaceRoot}
              workspaceItems={workspaceItems}
              onCloseTab={(tabId) => void closeTab(tabId)}
              onDebugToggle={() => setDebugEnabled((isEnabled) => !isEnabled)}
              onNewTab={() => executeCommand("file.newFile")}
              onRenameCancel={() => setRenameItemId(null)}
              onRenameConfirm={(item, nextName) => void confirmRename(item, nextName)}
              onSelectDocumentStructureItem={selectDocumentStructureItem}
              onSelectFile={(fileId) => void selectFile(fileId)}
              onSelectTab={(tabId) => void activateTab(tabId)}
              onSelectTreeItem={setSelectedTreeItemId}
              onSidebarClose={() => setSidebarOpen(false)}
              onSync={() => executeCommand("repository.syncNow")}
              onToggleDocumentStructure={() =>
                setIsDocumentStructureOpen((isOpen) => !isOpen)
              }
              onToggleSidebar={() => setSidebarOpen((isOpen) => !isOpen)}
            >
              <section className={`editor-workspace editor-workspace-${viewMode}`}>
                {!activeFileId && !workspaceRoot ? (
                  <section className="editor-empty-state">
                    <h1>{PRODUCT_CONFIG.name}</h1>
                    <p>{t("empty.startDescription")}</p>
                    <p className="empty-state-hint">{t("empty.startHint")}</p>
                  </section>
                ) : workspaceRoot && !activeFileId ? (
                  <section className="editor-empty-state">
                    <h2>{t("empty.workspaceTitle")}</h2>
                    <p>{t("empty.workspaceHint")}</p>
                  </section>
                ) : (
                  <>
                    {viewMode === "edit" || viewMode === "split" ? (
                      <MarkdownEditor
                        markdownContent={markdownContent}
                        onEditorReady={(editorView) => {
                          editorViewRef.current = editorView;
                        }}
                        onImageDrop={(filePaths) => {
                          filePaths.forEach(
                            (filePath) => void insertImageFromPath(filePath),
                          );
                        }}
                        onImagePaste={(items: DataTransferItemList) => {
                          void pasteImageItems(items);
                        }}
                        onMarkdownChange={updateActiveDocument}
                      />
                    ) : null}
                    {viewMode === "live" ? (
                      <TyporaLiveEditor
                        activeFileId={activeRelativePath}
                        markdownContent={markdownContent}
                        onEditorReady={(editorView) => {
                          editorViewRef.current = editorView;
                        }}
                        onImagePaste={(
                          items: DataTransferItemList,
                          insertMarkdown?: (markdown: string) => void,
                        ) => {
                          void pasteImageItems(items, insertMarkdown);
                        }}
                        onImageDrop={(filePaths) => {
                          filePaths.forEach(
                            (filePath) => void insertImageFromPath(filePath),
                          );
                        }}
                        onMarkdownChange={updateActiveDocument}
                        workspaceRoot={workspaceRoot}
                      />
                    ) : null}
                    {viewMode === "preview" || viewMode === "split" ? (
                      <MarkdownPreview
                        activeFileId={activeRelativePath}
                        markdownContent={markdownContent}
                        workspaceRoot={workspaceRoot}
                      />
                    ) : null}
                  </>
                )}
              </section>
            </AppShell>
          </div>
        </div>
      </div>
      {createItemType ? (
        <CreateItemDialog
          defaultName={createDefaultName}
          itemType={createItemType}
          onCancel={() => {
            setCreateItemType(null);
            setCreateParentPath(null);
          }}
          onConfirm={(name) => void confirmCreateItem(name)}
        />
      ) : null}
      {isInsertTableDialogOpen ? (
        <InsertTableDialog
          onCancel={() => setIsInsertTableDialogOpen(false)}
          onConfirm={insertTable}
        />
      ) : null}
      {isInsertCodeFenceDialogOpen ? (
        <InsertCodeFenceDialog
          onCancel={() => setIsInsertCodeFenceDialogOpen(false)}
          onConfirm={insertCodeFence}
        />
      ) : null}
      {repositoryDialog === "connect" ? (
        <ConnectRepositoryDialog
          errorMessage={repositoryError}
          isBusy={isRepositoryBusy}
          onCancel={() => {
            setRepositoryError("");
            setRepositoryDialog(null);
          }}
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
          workspaceRoot={repositoryLinkWorkspaceRoot || workspaceRoot}
          onCancel={() => {
            setRepositoryLinkWorkspaceRoot("");
            setRepositoryError("");
            setRepositoryDialog(null);
          }}
          onLink={(params) => void linkCurrentWorkspace(params)}
        />
      ) : null}
      {repositoryDialog === "status" && repositorySyncStatus ? (
        <RepositorySyncStatusDialog
          status={repositorySyncStatus}
          onClose={() => setRepositoryDialog(null)}
          onSync={() => void runRepositorySyncAction("sync")}
        />
      ) : null}
      {repositoryDialog === "operation" ? (
        <RepositoryOperationDialog
          isBusy={repositoryOperation.isBusy}
          message={repositoryOperation.message}
          title={repositoryOperation.title}
          onClose={() => setRepositoryDialog(null)}
        />
      ) : null}
      {isAboutDialogOpen ? (
        <AboutPolarbearDialog onClose={() => setIsAboutDialogOpen(false)} />
      ) : null}
    </>
  );
}
