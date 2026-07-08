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
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  MarkdownEditor,
  type MarkdownEditorView,
} from "./components/editor/MarkdownEditor";
import { InsertCodeFenceDialog } from "./components/editor/InsertCodeFenceDialog";
import { InsertTableDialog } from "./components/editor/InsertTableDialog";
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { TyporaLiveEditor } from "./components/editor/TyporaLiveEditor";
import {
  AppShell,
  type DocumentStructureItem,
} from "./components/layout/AppShell";
import { AboutPolarbearDialog } from "./components/layout/AboutPolarbearDialog";
import {
  CreateItemDialog,
  type CreateItemType,
} from "./components/workspace/CreateItemDialog";
import { useAppShortcuts } from "./commands/useAppShortcuts";
import { useNativeAppMenu } from "./commands/useNativeAppMenu";
import { applyMarkdownFormat } from "./markdown/applyMarkdownFormat";
import type { AppCommand, AppCommandPayload } from "./model/AppCommand";
import type { ViewMode } from "./model/ViewMode";
import {
  applyThemeTokens,
  readStoredTheme,
  storeTheme,
  type ThemeName,
} from "./theme/themeTokens";
import {
  ConnectGithubDialog,
  LinkGithubWorkspaceDialog,
  RepositorySyncStatusDialog,
} from "./repository/RepositoryDialogs";
import {
  disconnectGithub,
  getRepositoryAccount,
  getRepositorySyncStatus,
  getWorkspaceRepositoryBinding,
  linkWorkspaceToGithub,
  listGithubRepositories,
  pullWorkspace,
  pushWorkspace,
  syncWorkspaceNow,
  validateGithubToken,
  type GithubRepository,
  type RepositoryAccount,
  type RepositoryBinding,
  type RepositorySyncStatus,
} from "./repository/repositoryApi";
import {
  findWorkspaceItem,
  type WorkspaceDocumentMap,
  type WorkspaceItem,
} from "./model/WorkspaceFile";
import {
  chooseMarkdownFile,
  chooseMarkdownSavePath,
  chooseImageFile,
  chooseWorkspaceFolder,
  copyImageAsset,
  createMarkdownFile,
  createWorkspaceDirectory,
  listWorkspaceFiles,
  loadMarkdownFile,
  moveEntry,
  openMarkdownFile,
  renameEntry,
  revealInFileManager,
  saveMarkdownFile,
  saveImageAsset,
  writeMarkdownFile,
} from "./tauri/workspaceCommands";
import { openNewAppWindow } from "./tauri/windowCommands";

const initialWorkspace: WorkspaceItem[] = [];

const initialDocuments: WorkspaceDocumentMap = {
  "untitled:1": "",
};

const initialDocumentTitles: Record<string, string> = {
  "untitled:1": "Untitled",
};

const NORMAL_APP_ZOOM = 1;
const MIN_COMMITTED_APP_ZOOM = 1;
const MIN_INTERACTION_APP_ZOOM = 0.82;
const MAX_APP_ZOOM = 3;
const APP_ZOOM_STEP = 0.1;
const ZOOM_SETTLE_DELAY_MS = 320;
const ZOOM_SNAP_DURATION_MS = 120;
const APP_ZOOM_SCROLL_LOCK_MS = 520;
const WHEEL_ZOOM_DELTA_LIMIT = 80;
const WHEEL_ZOOM_SENSITIVITY = 0.0045;
const NATIVE_PINCH_ZOOM_SENSITIVITY = 2.35;
const NATIVE_PINCH_SCALE_SENSITIVITY = 1.35;
const NATIVE_GESTURE_WHEEL_SUPPRESS_MS = 160;
const APP_CANVAS_ZOOM_ENABLED = true;

function clampInteractionZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return NORMAL_APP_ZOOM;
  }

  return Math.max(MIN_INTERACTION_APP_ZOOM, Math.min(MAX_APP_ZOOM, value));
}

function clampCommittedZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return NORMAL_APP_ZOOM;
  }

  return Math.max(MIN_COMMITTED_APP_ZOOM, Math.min(MAX_APP_ZOOM, value));
}

function isAppZoomWheelEvent(event: WheelEvent): boolean {
  return (event.metaKey || event.ctrlKey) && Math.abs(event.deltaY) > Math.abs(event.deltaX);
}

function consumeAppZoomWheelEvent(event: WheelEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function consumeAppZoomPointerEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function isAppZoomDebugOverlayEnabled(): boolean {
  try {
    return window.localStorage.getItem("polarbear.liveDebugScroll") === "1";
  } catch {
    return false;
  }
}

function readStoredDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem("polarbear.debug") === "1";
  } catch {
    return false;
  }
}

function writeAppZoomDebugOverlay(note: string): void {
  if (!isAppZoomDebugOverlayEnabled()) {
    return;
  }

  const overlayId = "polarbear-app-zoom-debug-overlay";
  let overlay = document.getElementById(overlayId) as HTMLDivElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.dataset.polarbearDebugOverlay = "true";
    overlay.style.position = "fixed";
    overlay.style.right = "12px";
    overlay.style.bottom = "12px";
    overlay.style.zIndex = "2147483647";
    overlay.style.maxWidth = "760px";
    overlay.style.maxHeight = "38vh";
    overlay.style.margin = "0";
    overlay.style.padding = "10px 12px";
    overlay.style.overflow = "auto";
    overlay.style.border = "1px solid rgba(148, 163, 184, 0.45)";
    overlay.style.borderRadius = "8px";
    overlay.style.background = "rgba(15, 23, 42, 0.92)";
    overlay.style.color = "#e5edf8";
    overlay.style.font = "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace";
    overlay.style.pointerEvents = "none";
    overlay.style.whiteSpace = "pre-wrap";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.debugCopy = "true";
    button.textContent = "Copy";
    button.style.float = "right";
    button.style.margin = "0 0 8px 12px";
    button.style.pointerEvents = "auto";
    button.style.cursor = "pointer";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = overlay?.querySelector("pre")?.textContent ?? "";
      void copyDebugText(text);
    });

    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.font = "inherit";
    overlay.append(button, pre);
    document.body.appendChild(overlay);
  }

  const pre = overlay.querySelector("pre");
  if (pre) {
    pre.textContent = `APP ZOOM DEBUG\n${note}`;
  }
}

async function copyDebugText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Debug copy is best-effort and must never take the app down.
  }
}

function removePolarbearDebugOverlays(): void {
  document.getElementById("polarbear-app-zoom-debug-overlay")?.remove();
  document.getElementById("polarbear-live-debug-overlay")?.remove();
  document
    .querySelectorAll("[data-polarbear-debug-overlay='true'], .typora-live-debug-panel")
    .forEach((element) => element.remove());
}

function dispatchAppZoomDebug(
  phase: string,
  params: {
    canvas?: HTMLElement | null;
    canvasSize?: HTMLElement | null;
    extra?: Record<string, boolean | number | string | null | undefined>;
    prepared?: boolean;
    viewport?: HTMLElement | null;
    zoom?: number;
  } = {},
): void {
  const viewport = params.viewport ?? null;
  const canvasSize = params.canvasSize ?? null;
  const canvas = params.canvas ?? null;
  const liveScroller = document.querySelector(".typora-live-editor-pane .cm-scroller");
  const liveScrollerElement = liveScroller instanceof HTMLElement ? liveScroller : null;
  const extraNote = params.extra
    ? Object.entries(params.extra)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${String(value)}`)
    : [];
  const note = [
    `phase=${phase}`,
    `zoom=${Number((params.zoom ?? 1).toFixed(4))}`,
    `prepared=${params.prepared ? 1 : 0}`,
    `viewportScroll=${viewport ? `${Math.round(viewport.scrollLeft)},${Math.round(viewport.scrollTop)}` : "n/a"}`,
    `viewportClient=${viewport ? `${viewport.clientWidth}x${viewport.clientHeight}` : "n/a"}`,
    `viewportScrollSize=${viewport ? `${viewport.scrollWidth}x${viewport.scrollHeight}` : "n/a"}`,
    `spacerClient=${canvasSize ? `${canvasSize.clientWidth}x${canvasSize.clientHeight}` : "n/a"}`,
    `spacerScroll=${canvasSize ? `${canvasSize.scrollWidth}x${canvasSize.scrollHeight}` : "n/a"}`,
    `canvasOffset=${canvas ? `${canvas.offsetLeft},${canvas.offsetTop}` : "n/a"}`,
    `canvasSize=${canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : "n/a"}`,
    `transform=${canvas?.style.transform || "n/a"}`,
    `liveScroll=${liveScrollerElement ? `${Math.round(liveScrollerElement.scrollLeft)},${Math.round(liveScrollerElement.scrollTop)}` : "n/a"}`,
    ...extraNote,
  ].join(" ");

  writeAppZoomDebugOverlay(note);
}

function setAppCanvasZoomDataset(zoom: number): void {
  document.documentElement.dataset.appCanvasZoom = Number.isFinite(zoom)
    ? zoom.toFixed(6)
    : "1.000000";
}

function setAppCanvasZoomingDataset(isZooming: boolean): void {
  if (isZooming) {
    document.documentElement.dataset.appCanvasZooming = "true";
    return;
  }

  delete document.documentElement.dataset.appCanvasZooming;
}

function syncAppCanvasZoomDataset(zoom: number, forceZooming = false): void {
  setAppCanvasZoomDataset(zoom);
  setAppCanvasZoomingDataset(forceZooming || zoom > NORMAL_APP_ZOOM + 0.0005);
}

function shouldIgnoreAppZoomEvent(event: Event): boolean {
  if (document.querySelector(".image-viewer-overlay")) {
    return true;
  }

  const target = event.target;
  return target instanceof Element && Boolean(target.closest(
    ".image-viewer-overlay",
  ));
}

function resolveScrollableElementFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const scroller =
    target.closest(".cm-scroller") ??
    target.closest(".markdown-preview") ??
    target.closest(".workspace-tree-shell");

  return scroller instanceof HTMLElement ? scroller : null;
}

function shouldIgnoreAppZoomEditorPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  if (target.closest(".cm-content, .cm-line")) {
    return false;
  }

  return Boolean(target.closest(
    "button, input, select, textarea, [contenteditable='true'], .cm-typora-diagram-preview, .cm-typora-table-preview, .cm-typora-image-preview",
  ));
}

type AppZoomPointerLikeEvent = Event & {
  button?: number;
  clientX: number;
  clientY: number;
  shiftKey?: boolean;
};

function isAppZoomPointerLikeEvent(event: Event): event is AppZoomPointerLikeEvent {
  const pointer = event as Partial<AppZoomPointerLikeEvent>;
  return (
    typeof pointer.clientX === "number" &&
    Number.isFinite(pointer.clientX) &&
    typeof pointer.clientY === "number" &&
    Number.isFinite(pointer.clientY)
  );
}

function shouldLetEditorHandleWheel(event: WheelEvent): boolean {
  if (isAppZoomWheelEvent(event)) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  const scroller =
    target.closest(".cm-scroller") ??
    target.closest(".typora-live-editor-pane, .editor-pane")?.querySelector(".cm-scroller");
  if (!(scroller instanceof HTMLElement)) {
    return false;
  }

  return Math.abs(event.deltaY) >= Math.abs(event.deltaX);
}

type NativePinchEventLike = CustomEvent<{
  delta?: number;
  magnification?: number;
  phase?: number | string;
  scale?: number;
  state?: number | string;
  x?: number;
  y?: number;
}>;
type NativePinchPayload = NativePinchEventLike["detail"];

type AppCanvasSize = {
  width: number;
  height: number;
};

type AppCanvasTransform = {
  scale: number;
  x: number;
  y: number;
};

type AppCanvasPlacement = {
  canvasHeight: number;
  canvasWidth: number;
  offsetLeft: number;
  offsetTop: number;
};

type ZoomAnchor = {
  pointerX: number;
  pointerY: number;
  canvasX: number;
  canvasY: number;
};

type InnerScrollLock = {
  left: number;
  top: number;
};

type AppZoomCursorPlacementDebug = {
  adjustedClientX: number;
  adjustedClientY: number;
  afterDispatchScrollLeft: number;
  afterDispatchScrollTop: number;
  beforeScrollLeft: number;
  beforeScrollTop: number;
  cursorPos: number;
  eventType: string;
  rawClientX: number;
  rawClientY: number;
  transformScale: number;
  transformX: number;
  transformY: number;
  viewportLeft: number | null;
  viewportTop: number | null;
  when: number;
};

function readAppCanvasSize(): AppCanvasSize {
  return {
    width: Math.max(320, Math.floor(window.visualViewport?.width ?? window.innerWidth)),
    height: Math.max(320, Math.floor(window.visualViewport?.height ?? window.innerHeight)),
  };
}

function measureAppCanvasSize(canvas: HTMLElement | null): AppCanvasSize {
  const viewportSize = readAppCanvasSize();
  if (!canvas) {
    return viewportSize;
  }

  const content = canvas.firstElementChild instanceof HTMLElement
    ? canvas.firstElementChild
    : canvas;
  const width = Math.max(
    viewportSize.width,
    content.scrollWidth,
    content.clientWidth,
    canvas.scrollWidth,
    canvas.clientWidth,
  );
  const height = Math.max(
    viewportSize.height,
    content.scrollHeight,
    content.clientHeight,
    canvas.scrollHeight,
    canvas.clientHeight,
  );

  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
  };
}

function isNativePinchEndPhase(phase: unknown): boolean {
  if (typeof phase === "number") {
    // NSEventPhaseEnded = 8, NSEventPhaseCancelled = 16.
    return (phase & 8) !== 0 || (phase & 16) !== 0;
  }

  return typeof phase === "string" && [
    "ended",
    "end",
    "cancelled",
    "canceled",
    "failed",
  ].includes(phase.toLowerCase());
}

export function App() {
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
  const [githubRepositories, setGithubRepositories] = useState<
    GithubRepository[]
  >([]);
  const [repositorySyncStatus, setRepositorySyncStatus] =
    useState<RepositorySyncStatus | null>(null);
  const [repositoryDialog, setRepositoryDialog] = useState<
    "connect" | "link" | "status" | null
  >(null);
  const [isRepositoryBusy, setIsRepositoryBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [debugEnabled, setDebugEnabled] = useState(readStoredDebugEnabled);

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
      window.localStorage.setItem("polarbear.debug", value);
      window.localStorage.setItem("polarbear.liveDebug", value);
      window.localStorage.setItem("polarbear.liveDebugScroll", value);
      window.localStorage.setItem("polarbear.liveDebugPanel", debugEnabled ? "1" : "0");
    } catch {
      // Ignore storage errors; the toggle still reflects the current session.
    }

    if (!debugEnabled) {
      removePolarbearDebugOverlays();
    }

    window.dispatchEvent(new CustomEvent("polarbear-debug-changed"));
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
        window.dispatchEvent(new CustomEvent("polarbear-app-canvas-zoom-settled"));
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

  const zoomAtViewportCenter = useCallback((nextZoom: number) => {
    if (!APP_CANVAS_ZOOM_ENABLED) {
      commitZoom(NORMAL_APP_ZOOM);
      return;
    }

    const viewport = zoomViewportRef.current;
    if (!viewport) {
      applyCanvasZoom(nextZoom);
      commitZoom(nextZoom);
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const anchor = getAnchorCanvasPoint(viewport, appZoomRef.current, clientX, clientY);
    const zoom = clampInteractionZoom(nextZoom);

    cancelZoomSnapAnimation();

    if (zoom < MIN_COMMITTED_APP_ZOOM) {
      animateZoomTo(NORMAL_APP_ZOOM, anchor);
      return;
    }

    applyZoomAtAnchor(zoom, anchor, false);
    commitZoom(zoom);
  }, [
    animateZoomTo,
    applyCanvasZoom,
    applyZoomAtAnchor,
    cancelZoomSnapAnimation,
    commitZoom,
    getAnchorCanvasPoint,
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

    window.localStorage.removeItem("polarbear.appZoom");
    void invoke("set_app_zoom", { zoom: NORMAL_APP_ZOOM });
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
    void listen<NativePinchPayload>("polarbear-native-pinch", (event) => {
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

    const handleScrollCapture = (event: Event) => {
      if (!isInnerScrollFrozen()) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        zoomInnerScrollLocksRef.current.has(target)
      ) {
        restoreInnerScrollLocks();
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

  useEffect(() => {
    void refreshRepositoryState();
  }, [workspaceRoot]);

  const updateActiveDocument = (value: string) => {
    if (!activeFileId) {
      setStatusMessage("Create or select a Markdown file before writing.");
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

    setStatusMessage(`App zoom ${Math.round(zoom * 100)}%.`);
  }, [
    applyCanvasZoom,
    applyZoomAtAnchor,
    cancelZoomSnapAnimation,
    commitZoom,
    captureInnerScrollLocks,
    getAnchorCanvasPoint,
    releaseInnerScrollLocks,
    restoreInnerScrollLocks,
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
      setStatusMessage(`Opened workspace: ${nextWorkspaceRoot}`);

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
        setStatusMessage("Open workspace cancelled.");
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
        setStatusMessage("Open file cancelled.");
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
      setStatusMessage(`Opened ${openedFile.relativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshRepositoryState = async () => {
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
  };

  const connectGithub = async (token: string) => {
    setIsRepositoryBusy(true);

    try {
      const account = await validateGithubToken(token);
      setRepositoryAccount(account);
      setRepositoryDialog(null);
      setStatusMessage(`Connected GitHub as ${account.login}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const disconnectGithubAccount = async () => {
    setIsRepositoryBusy(true);

    try {
      await disconnectGithub();
      setRepositoryAccount(null);
      setRepositoryBinding(null);
      setRepositoryDialog(null);
      setStatusMessage("Disconnected GitHub.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const openLinkWorkspaceDialog = async () => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before linking a repository.");
      return;
    }

    if (!repositoryAccount) {
      setRepositoryDialog("connect");
      return;
    }

    setIsRepositoryBusy(true);

    try {
      const repositories = await listGithubRepositories();
      setGithubRepositories(repositories);
      setRepositoryDialog("link");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const linkCurrentWorkspace = async (params: {
    owner: string;
    repo: string;
    branch: string;
    remotePath: string;
  }) => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before linking a repository.");
      return;
    }

    setIsRepositoryBusy(true);

    try {
      const binding = await linkWorkspaceToGithub({
        workspaceRef: workspaceRoot,
        ...params,
      });
      setRepositoryBinding(binding);
      setRepositoryDialog(null);
      setStatusMessage(`Linked workspace to ${binding.owner}/${binding.repo}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const refreshSyncStatus = async () => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before viewing sync status.");
      return;
    }

    setIsRepositoryBusy(true);

    try {
      const status = await getRepositorySyncStatus({
        workspaceRef: workspaceRoot,
        dirty: dirtyFileIds.size > 0,
      });
      setRepositorySyncStatus(status);
      setRepositoryAccount(status.account ?? null);
      setRepositoryBinding(status.binding ?? null);
      setRepositoryDialog("status");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRepositoryBusy(false);
    }
  };

  const runRepositorySyncAction = async (action: "pull" | "push" | "sync") => {
    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before syncing.");
      return;
    }

    setIsRepositoryBusy(true);

    try {
      const params = {
        workspaceRef: workspaceRoot,
        dirty: dirtyFileIds.size > 0,
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
        const items = await listWorkspaceFiles(workspaceRoot);
        setWorkspaceItems(items);
        setWorkspaceItemsByRoot((currentTrees) => ({
          ...currentTrees,
          [workspaceRoot]: items,
        }));
      }
      setStatusMessage(`Repository ${action} completed.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
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
    setStatusMessage(`Created ${title}`);
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
      setStatusMessage(`Loaded ${fileId}`);
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
      setStatusMessage(`Loaded ${nextRelativePath}`);
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
        setStatusMessage("Save cancelled.");
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
      setStatusMessage(`Saved ${relativePath}`);
      return nextDocumentId;
    }

    const tabWorkspaceRoot = documentWorkspaceRootForId(
      fileId,
      documentWorkspaceRoots,
      workspaceRoot,
    );
    const tabRelativePath = documentRelativePathForId(fileId, documentRelativePaths);

    if (!tabWorkspaceRoot) {
      setStatusMessage("Open a local workspace before saving to disk.");
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
    setStatusMessage(`Saved ${tabRelativePath}`);
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
      const shouldSave = window.confirm(`Save changes to ${tabName} before closing?`);
      if (!shouldSave) {
        return;
      }

      lastSavedFileIdRef.current = null;
      let savedFileId: string | null = null;
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

    setStatusMessage(`Closed ${tabName}`);
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
      setStatusMessage("Open a local workspace before saving to disk.");
      return false;
    }

    if (!activeFileId) {
      setStatusMessage("Create or select a Markdown file before saving.");
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
      setStatusMessage(`Saved ${saveRelativePath}`);
      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const saveActiveFileAs = async (): Promise<boolean> => {
    if (!activeFileId) {
      setStatusMessage("Create or select a Markdown file before saving.");
      return false;
    }

    try {
      const defaultFileName = deriveDefaultMarkdownFileName(
        markdownContent,
        activeFileName,
      );
      const selectedPath = await chooseMarkdownSavePath(defaultFileName);

      if (!selectedPath) {
        setStatusMessage("Save cancelled.");
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
      setStatusMessage(`Saved ${relativePath}`);
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
      setStatusMessage("File name cannot be empty.");
      return;
    }

    if (!workspaceRoot) {
      setStatusMessage("Open a local workspace before creating files.");
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
      setStatusMessage(`Created ${relativePath}`);
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
      setStatusMessage("Folder name cannot be empty.");
      return;
    }

    if (!workspaceRoot) {
      setStatusMessage("Open a local workspace before creating folders.");
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
      setStatusMessage(`Created folder ${relativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openCreateDialog = async (
    itemType: CreateItemType,
    parentPath?: string,
  ) => {
    if (!workspaceRoot) {
      setStatusMessage("Choose a local workspace folder first.");

      try {
        const selectedFolder = await chooseWorkspaceFolder();

        if (!selectedFolder) {
          setStatusMessage("Create cancelled. No workspace folder selected.");
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
      setStatusMessage("Select a file or folder before renaming.");
      return;
    }

    if (targetAffectsDirtyFile(targetItem.id, dirtyFileIds)) {
      setStatusMessage("Save the current file before renaming.");
      return;
    }

    setRenameItemId(targetItem.id);
  };

  const confirmRename = async (item: WorkspaceItem, nextName: string) => {
    if (!workspaceRoot) {
      return;
    }

    if (targetAffectsDirtyFile(item.id, dirtyFileIds)) {
      setStatusMessage("Save the current file before renaming.");
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
      setStatusMessage("Open a workspace before moving files.");
      return;
    }

    if (targetAffectsDirtyFile(sourcePath, dirtyFileIds)) {
      setStatusMessage("Save the current file before moving it.");
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
      setStatusMessage("Focus the Markdown editor before formatting.");
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
      setStatusMessage("Open a Markdown document before inserting content.");
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
      setStatusMessage("Focus the Markdown editor before searching.");
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
      setStatusMessage("Search is unavailable in this editor state.");
    }
  };

  const ensureSavedMarkdownAssetTarget = async (): Promise<boolean> => {
    if (!activeFileId || isUntitledDocument(activeFileId)) {
      setStatusMessage("Save this document before inserting images.");
      return false;
    }

    if (!workspaceRoot) {
      setStatusMessage("Open a workspace before inserting images.");
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
      setStatusMessage(`Inserted ${asset.assetRelativePath}`);
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
      setStatusMessage(`Inserted ${asset.assetRelativePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const executeCommand = useCallback(
    (command: AppCommand, payload?: AppCommandPayload) => {
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

      if (command === "window.selectTab") {
        const tabIndex = payload?.tabIndex;
        if (typeof tabIndex !== "number") {
          return;
        }

        const tabId = openFileIds[tabIndex];
        if (!tabId) {
          return;
        }

        void activateTab(tabId);
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

      if (command === "file.move") {
        const sourcePath = payload?.sourcePath;
        const targetParentPath = payload?.targetParentPath ?? null;

        if (!sourcePath) {
          setStatusMessage("Select a file or folder before moving.");
          return;
        }

        void moveWorkspaceEntry(sourcePath, targetParentPath);
        return;
      }

      if (command === "file.revealInFinder") {
        if (!workspaceRoot) {
          setStatusMessage("Open a workspace before revealing it.");
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
          .then(() => setStatusMessage("Copied path."))
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
        setStatusMessage("Theme changed to Light.");
        return;
      }

      if (command === "theme.dark") {
        setThemeName("dark");
        setStatusMessage("Theme changed to Dark.");
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
        void disconnectGithubAccount();
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
        `${command} is reserved for a future Polarbear version.`,
      );
    },
    [
      activeFileId,
      activeFileName,
      dirtyFileIds,
      markdownContent,
      openFileIds,
      repositoryAccount,
      repositoryBinding,
      runAppZoomCommand,
      selectedTreeItemId,
      untitledCounter,
      workspaceItems,
      workspaceRoot,
    ],
  );

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
              onToggleDocumentStructure={() =>
                setIsDocumentStructureOpen((isOpen) => !isOpen)
              }
              onToggleSidebar={() => setSidebarOpen((isOpen) => !isOpen)}
            >
              <section className={`editor-workspace editor-workspace-${viewMode}`}>
                {!activeFileId && !workspaceRoot ? (
                  <section className="editor-empty-state">
                    <h1>Polarbear</h1>
                    <p>
                      A local-first Markdown editor. Open a folder to start writing
                      with your local Markdown files.
                    </p>
                    <p className="empty-state-hint">
                      Use File / Open... or File / New.
                    </p>
                  </section>
                ) : workspaceRoot && !activeFileId ? (
                  <section className="editor-empty-state">
                    <h2>This workspace has no Markdown files.</h2>
                    <p>
                      Use the File menu or right-click the file tree to create one.
                    </p>
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
        <ConnectGithubDialog
          isBusy={isRepositoryBusy}
          onCancel={() => setRepositoryDialog(null)}
          onConnect={(token) => void connectGithub(token)}
        />
      ) : null}
      {repositoryDialog === "link" && repositoryAccount ? (
        <LinkGithubWorkspaceDialog
          account={repositoryAccount}
          isBusy={isRepositoryBusy}
          repositories={githubRepositories}
          workspaceRoot={workspaceRoot}
          onCancel={() => setRepositoryDialog(null)}
          onLink={(params) => void linkCurrentWorkspace(params)}
        />
      ) : null}
      {repositoryDialog === "status" && repositorySyncStatus ? (
        <RepositorySyncStatusDialog
          status={repositorySyncStatus}
          onClose={() => setRepositoryDialog(null)}
          onPull={() => void runRepositorySyncAction("pull")}
          onPush={() => void runRepositorySyncAction("push")}
          onSync={() => void runRepositorySyncAction("sync")}
        />
      ) : null}
      {isAboutDialogOpen ? (
        <AboutPolarbearDialog onClose={() => setIsAboutDialogOpen(false)} />
      ) : null}
    </>
  );
}

function findFirstFile(items: WorkspaceItem[]): WorkspaceItem | null {
  for (const item of items) {
    if (item.type === "file") {
      return item;
    }

    if (item.children) {
      const firstFile = findFirstFile(item.children);
      if (firstFile) {
        return firstFile;
      }
    }
  }

  return null;
}

function normalizeWorkspacePath(rawPath: string): string {
  return rawPath
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .map((pathPart) => pathPart.trim())
    .filter(Boolean)
    .join("/");
}

function normalizeMarkdownFileName(rawFileName: string): string {
  const relativePath = normalizeWorkspacePath(rawFileName);

  if (!relativePath) {
    return "";
  }

  return /\.(md|markdown)$/i.test(relativePath)
    ? relativePath
    : `${relativePath}.md`;
}

function joinWorkspacePath(
  parentPath: string | null,
  childPath: string,
): string {
  const normalizedParentPath = normalizeWorkspacePath(parentPath ?? "");
  const normalizedChildPath = normalizeWorkspacePath(childPath);

  if (!normalizedParentPath) {
    return normalizedChildPath;
  }

  if (!normalizedChildPath) {
    return normalizedParentPath;
  }

  return `${normalizedParentPath}/${normalizedChildPath}`;
}

function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) {
    return newPath;
  }

  if (path.startsWith(`${oldPath}/`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }

  return path;
}

function remapDocumentPaths(
  documents: WorkspaceDocumentMap,
  oldPath: string,
  newPath: string,
): WorkspaceDocumentMap {
  return Object.fromEntries(
    Object.entries(documents).map(([path, content]) => [
      remapPath(path, oldPath, newPath),
      content,
    ]),
  );
}

function remapDirtyFileIds(
  dirtyFileIds: Set<string>,
  oldPath: string,
  newPath: string,
): Set<string> {
  return new Set(
    [...dirtyFileIds].map((dirtyFileId) =>
      remapPath(dirtyFileId, oldPath, newPath),
    ),
  );
}

function remapDocumentMetadataKeys(
  metadata: Record<string, string>,
  oldPath: string,
  newPath: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([documentId, value]) => [
      remapPath(documentId, oldPath, newPath),
      value,
    ]),
  );
}

function remapDocumentMetadataPaths(
  metadata: Record<string, string>,
  oldPath: string,
  newPath: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([documentId, relativePath]) => [
      remapPath(documentId, oldPath, newPath),
      remapPath(relativePath, oldPath, newPath),
    ]),
  );
}

function targetAffectsDirtyFile(
  targetPath: string,
  dirtyFileIds: Set<string>,
): boolean {
  return [...dirtyFileIds].some((dirtyFileId) => {
    return (
      dirtyFileId === targetPath || dirtyFileId.startsWith(`${targetPath}/`)
    );
  });
}

function isUntitledDocument(documentId: string): boolean {
  return documentId.startsWith("untitled:");
}

function displayNameForDocumentId(
  documentId: string,
  workspaceItems: WorkspaceItem[],
  documentTitles: Record<string, string>,
  documentRelativePaths: Record<string, string>,
): string {
  if (!documentId) {
    return "Untitled";
  }

  if (isUntitledDocument(documentId)) {
    return documentTitles[documentId] ?? "Untitled";
  }

  const relativePath = documentRelativePathForId(documentId, documentRelativePaths);

  return findWorkspaceItem(workspaceItems, relativePath)?.name ?? fileNameOf(relativePath);
}

function documentRelativePathForId(
  documentId: string,
  documentRelativePaths: Record<string, string>,
): string {
  return documentRelativePaths[documentId] ?? documentId;
}

function documentWorkspaceRootForId(
  documentId: string,
  documentWorkspaceRoots: Record<string, string>,
  fallbackWorkspaceRoot: string,
): string {
  if (isUntitledDocument(documentId)) {
    return "";
  }

  return documentWorkspaceRoots[documentId] ?? fallbackWorkspaceRoot;
}

function findOpenDocumentIdForWorkspaceFile(
  openFileIds: string[],
  documentWorkspaceRoots: Record<string, string>,
  documentRelativePaths: Record<string, string>,
  workspaceRoot: string,
  relativePath: string,
): string | null {
  return openFileIds.find((documentId) => {
    return (
      documentWorkspaceRootForId(documentId, documentWorkspaceRoots, workspaceRoot) === workspaceRoot &&
      documentRelativePathForId(documentId, documentRelativePaths) === relativePath
    );
  }) ?? null;
}

function makeWorkspaceDocumentId(params: {
  currentDocumentIds: Set<string>;
  currentWorkspaceRoot: string;
  relativePath: string;
  workspaceRoot: string;
}): string {
  const { currentDocumentIds, currentWorkspaceRoot, relativePath, workspaceRoot } = params;
  if (workspaceRoot === currentWorkspaceRoot && !currentDocumentIds.has(relativePath)) {
    return relativePath;
  }

  const baseId = `${workspaceRoot}::${relativePath}`;
  let documentId = baseId;
  let suffix = 2;
  while (currentDocumentIds.has(documentId)) {
    documentId = `${baseId}#${suffix}`;
    suffix += 1;
  }

  return documentId;
}

function parentFolderIdOf(documentId: string): string | null {
  if (!documentId || isUntitledDocument(documentId)) {
    return null;
  }

  const pathParts = normalizeWorkspacePath(documentId).split("/");
  pathParts.pop();
  const parentId = pathParts.join("/");

  return parentId || null;
}

function extractDocumentStructure(markdownContent: string): DocumentStructureItem[] {
  const items: DocumentStructureItem[] = [];
  let offset = 0;

  markdownContent.split("\n").forEach((line, index) => {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const label = headingMatch[2].trim();
      if (label) {
        items.push({
          id: `heading-${index}-${offset}`,
          label,
          level: headingMatch[1].length,
          position: offset,
        });
      }
    }

    offset += line.length + 1;
  });

  return items;
}

function deriveDefaultMarkdownFileName(
  markdownContent: string,
  fallbackTitle: string,
): string {
  const firstHeading = markdownContent
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .find(Boolean);
  const rawTitle = firstHeading || fallbackTitle || "Untitled";
  const safeTitle = rawTitle.replace(/[\\/:*?"<>|]/g, " ").trim() || "Untitled";

  return /\.(md|markdown)$/i.test(safeTitle) ? safeTitle : `${safeTitle}.md`;
}

function ensureMarkdownFilePath(filePath: string): string {
  return /\.(md|markdown)$/i.test(filePath) ? filePath : `${filePath}.md`;
}

function parentPathOf(filePath: string): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const pathParts = normalizedPath.split("/");
  pathParts.pop();

  return pathParts.join("/") || "/";
}

function fileNameOf(filePath: string): string {
  return filePath.replaceAll("\\", "/").split("/").at(-1) ?? "Untitled.md";
}

function codeFenceTemplate(language: string): string {
  if (language === "mermaid") {
    return "\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n";
  }

  if (language === "plantuml") {
    return "\n```plantuml\n@startuml\nAlice -> Bob: Hello\n@enduml\n```\n";
  }

  return `\n\`\`\`${language}\n\n\`\`\`\n`;
}

function timestampForFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}
