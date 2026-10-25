import { useRepositoryWorkflow } from "./features/repository/useRepositoryWorkflow";
import { RepositoryWorkflowDialogs } from "./features/repository/RepositoryWorkflowDialogs";
import { useEffect, useMemo, useRef, useState } from "react";
import { findNext, findPrevious, openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { MarkdownEditor, type MarkdownEditorView } from "./features/editor/components/MarkdownEditor";
import { InsertCodeFenceDialog } from "./features/editor/components/InsertCodeFenceDialog";
import { InsertTableDialog } from "./features/editor/components/InsertTableDialog";
import { MarkdownPreview } from "./features/editor/components/MarkdownPreview";
import { TyporaLiveEditor } from "./features/editor/components/TyporaLiveEditor";
import { AppShell } from "./app/layout/AppShell";
import { useLayoutPreferences } from "./app/layout/useLayoutPreferences";
import { ActivityRail, type AppSurface } from "./app/layout/ActivityRail";
import { AboutPolarbearDialog } from "./app/layout/AboutPolarbearDialog";
import { CreateItemDialog } from "./features/workspace/components/CreateItemDialog";
import { ExternalFileChangedDialog } from "./features/workspace/components/ExternalFileChangedDialog";
import { useAppShortcuts } from "./commands/useAppShortcuts";
import { resolveFileCommandTarget } from "./commands/commandTarget";
import { useNativeAppMenu } from "./commands/useNativeAppMenu";
import { useEventCallback } from "./shared/hooks/useEventCallback";
import { getCommandState, type CommandRuntimeContext } from "./commands/commandState";
import { codeFenceTemplate } from "./features/editor/markdown/markdownTemplates";
import { executeMarkdownFormatCommand, executeStandardEditorCommand, selectEntirePreviewDocument } from "./features/editor/editorCommandAdapter";
import { isMarkdownFormatCommand, type MarkdownFormatCommand } from "./shared/commands/markdownFormatCommands";
import { documentRelativePathForId, documentWorkspaceRootForId, extractDocumentStructure, findOpenDocumentIdForWorkspaceFile, isUntitledDocument } from "./features/editor/documentModel";
import type { AppCommand, AppCommandPayload, ExecuteAppCommand } from "./shared/commands/appCommandTypes";
import type { ViewMode } from "./features/editor/viewMode";
import { applyThemeTokens, readStoredTheme, storeTheme, type ThemeName } from "./features/theme/themeTokens";
import { findWorkspaceItem } from "./features/workspace/workspaceModel";
import { joinWorkspacePath, timestampForFileName } from "./features/workspace/workspacePaths";
import { chooseImageFile, copyImageAsset, revealInFileManager, saveImageAsset } from "./features/workspace/tauriWorkspaceAdapter";
import { openNewAppWindow } from "./shared/tauri/openNewAppWindow";
import { useI18n } from "./shared/i18n/I18nProvider";
import { removePolarbearDebugOverlays } from "./features/zoom/appZoomRuntime";
import { readStoredDebugEnabled, storeDebugEnabled } from "./shared/debug/debugSettings";
import { APP_EVENTS } from "./shared/events/appEvents";
import { PRODUCT_CONFIG } from "./shared/config/productConfig";
import { useVocabReading } from "./features/vocab/useVocabReading";
import { SettingsDialog } from "./app/layout/SettingsDialog";
import { ContextWorkspace } from "./features/memory/context/ContextWorkspace";
import { captureMemoryDocumentContext, snapshotMemoryEditor, type MemoryDocumentContext } from "./features/memory/documentContext";
import { focusMemorySource, isMemorySourceTargetCurrent, type MemorySourceNavigationTarget } from "./features/memory/sourceNavigation";
import { useAppZoom } from "./features/zoom/useAppZoom";
import { useDocumentSession } from "./features/workspace/useDocumentSession";

export function App() {
  const { t } = useI18n();
  const editorViewRef = useRef<MarkdownEditorView | null>(null);
  const pendingMemorySourceRef = useRef<MemorySourceNavigationTarget | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [themeName, setThemeName] = useState<ThemeName>(() =>
    readStoredTheme(),
  );
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [activeSurface, setActiveSurface] = useState<AppSurface>("workspace");
  const [memoryDocumentContext, setMemoryDocumentContext] =
    useState<MemoryDocumentContext | null>(null);
  const [isInsertTableDialogOpen, setIsInsertTableDialogOpen] = useState(false);
  const [isInsertCodeFenceDialogOpen, setIsInsertCodeFenceDialogOpen] =
    useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const layout = useLayoutPreferences(() => setStatusMessage(t("layout.storageFailed")));
  const sidebarOpen = layout.preferences.leftOpen;
  const isDocumentStructureOpen = layout.preferences.rightOpen;
  const setSidebarOpen = layout.setLeftOpen;
  const setIsDocumentStructureOpen = layout.setRightOpen;
  const [debugEnabled, setDebugEnabled] = useState(readStoredDebugEnabled);

  const { zoomViewportRef, zoomCanvasSizeRef, zoomCanvasRef, appZoomCanvasSizeStyle,
    appZoomCanvasStyle, requestCanvasViewportSync, runAppZoomCommand } = useAppZoom({
      editorViewRef, onStatus: setStatusMessage,
    });
  const documentSession = useDocumentSession({
    onStatus: setStatusMessage, onReload: requestCanvasViewportSync,
    onDocumentOpened: () => setActiveSurface("workspace"),
    onSessionEmpty: () => { editorViewRef.current = null; },
  });
  const { workspaceItems, documentRevisions, documentWorkspaceRoots, documentRelativePaths,
    workspaceRoot, activeFileId, openFileIds, dirtyFileIds, dirtyWorkspacePaths, markdownContent, activeRelativePath, activeDocumentRoot,
    activeFileName, isDirty, openTabs, collapseVersion, folderRevealRequest,
    selectedTreeItemId, createItemType, createDefaultName, renameItemId, externalDocumentChange,
    loadWorkspace, openWorkspace, openMarkdownPath, openFile, createUntitledDocument, selectFile,
    activateTab, updateActiveDocument, saveActiveFile, saveActiveFileAs, closeTab, requestAppQuit, sessionClosing,
    dirtyDocumentIdsForWorkspace, saveDirtyDocumentsForWorkspace, reloadWorkspaceAfterDownload,
    reloadDocumentFromDisk, reloadExternalDocumentFromDisk, keepEditingExternalDocument, saveDeletedExternalDocumentAs,
    openCreateDialog, confirmCreateItem, startRename, confirmRename, deleteWorkspaceItem,
    duplicateWorkspaceItem, moveWorkspaceEntry } = documentSession;


  const snapshotActiveMemoryDocument = useEventCallback(() => {
    const activeDocumentWorkspaceRoot = documentWorkspaceRootForId(
      activeFileId,
      documentWorkspaceRoots,
      workspaceRoot,
    );
    const relativePath = documentRelativePathForId(activeFileId, documentRelativePaths);
    setMemoryDocumentContext(captureMemoryDocumentContext({
      fileId: activeFileId,
      workspaceRoot: activeDocumentWorkspaceRoot,
      relativePath,
      editorRevision: documentRevisions[activeFileId] ?? "",
      dirty: dirtyFileIds.has(activeFileId),
      editorSnapshot: snapshotMemoryEditor(editorViewRef.current),
    }));
  });
  const vocab = useVocabReading({
    editor: editorViewRef, markdown: markdownContent, title: activeFileName,
    preview: viewMode === "preview" || viewMode === "split", onStatus: setStatusMessage,
    filePath: isUntitledDocument(activeFileId) ? null : joinWorkspacePath(
      documentWorkspaceRootForId(activeFileId, documentWorkspaceRoots, workspaceRoot), activeRelativePath),
  });
  const documentStructureItems = useMemo(
    () => extractDocumentStructure(markdownContent),
    [markdownContent],
  );
  useEffect(() => {
    storeDebugEnabled(debugEnabled);

    if (!debugEnabled) {
      removePolarbearDebugOverlays();
    }

    window.dispatchEvent(new CustomEvent(APP_EVENTS.debugChanged));
  }, [debugEnabled]);

  useEffect(() => {
    if (viewMode === "preview") {
      editorViewRef.current = null;
    }
  }, [viewMode]);

  useEffect(() => {
    applyThemeTokens(themeName);
  }, [themeName]);

  useEffect(() => {
    const refreshTheme = () => setThemeName(readStoredTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener(APP_EVENTS.settingsChanged, refreshTheme);
    window.addEventListener("storage", refreshTheme);
    media.addEventListener("change", refreshTheme);
    refreshTheme();
    return () => {
      window.removeEventListener(APP_EVENTS.settingsChanged, refreshTheme);
      window.removeEventListener("storage", refreshTheme);
      media.removeEventListener("change", refreshTheme);
    };
  }, []);

  const repository = useRepositoryWorkflow({
    workspaceRoot,
    onStatus: setStatusMessage,
    openWorkspace: loadWorkspace,
    documents: {
      dirtyIds: dirtyDocumentIdsForWorkspace,
      saveDirty: saveDirtyDocumentsForWorkspace,
      reload: reloadWorkspaceAfterDownload,
    },
  });
  const {
    repositoryAccount, repositoryBinding, repositoryCleanupPending, repositoryOperation,
    isRepositoryBusy, disconnectRepositoryAccount, openLinkWorkspaceDialog,
    refreshSyncStatus, runRepositorySyncAction,
  } = repository;

  const openMemorySource = useEventCallback(async (
    target: MemorySourceNavigationTarget,
  ) => {
    if (!isMemorySourceTargetCurrent(target, documentSession.currentWorkspaceRoot())) {
      setStatusMessage(t("context.knowledge.sourceNavigationStale"));
      return;
    }
    const openDocumentId = findOpenDocumentIdForWorkspaceFile(
      openFileIds,
      documentWorkspaceRoots,
      documentRelativePaths,
      workspaceRoot,
      target.relativePath,
    );
    if (openDocumentId && !dirtyFileIds.has(openDocumentId)) {
      const result = await reloadDocumentFromDisk({
        fileId: openDocumentId,
        workspaceRoot,
        relativePath: target.relativePath,
        revision: documentRevisions[openDocumentId],
      });
      if (result.status !== "reloaded") return;
    }
    if (!isMemorySourceTargetCurrent(target, documentSession.currentWorkspaceRoot())) {
      setStatusMessage(t("context.knowledge.sourceNavigationStale"));
      return;
    }
    pendingMemorySourceRef.current = target;
    if (viewMode === "preview") setViewMode("edit");
    setActiveSurface("workspace");
    await selectFile(target.relativePath);
  });

  const handleEditorReady = useEventCallback((editorView: MarkdownEditorView | null) => {
    editorViewRef.current = editorView;
    const target = pendingMemorySourceRef.current;
    if (target && !isMemorySourceTargetCurrent(target, workspaceRoot)) {
      pendingMemorySourceRef.current = null;
      return;
    }
    if (editorView && target && target.relativePath === activeRelativePath) {
      const focused = focusMemorySource(editorView, target);
      pendingMemorySourceRef.current = null;
      if (!focused) setStatusMessage(t("context.knowledge.sourceNavigationStale"));
    }
  });

  useEffect(() => {
    const target = pendingMemorySourceRef.current;
    const editorView = editorViewRef.current;
    if (
      activeSurface === "workspace"
      && target
      && isMemorySourceTargetCurrent(target, workspaceRoot)
      && target.relativePath === activeRelativePath
      && editorView
    ) {
      const focused = focusMemorySource(editorView, target);
      pendingMemorySourceRef.current = null;
      if (!focused) setStatusMessage(t("context.knowledge.sourceNavigationStale"));
    }
  }, [activeRelativePath, activeSurface, markdownContent, t, workspaceRoot]);

  useEffect(() => {
    const target = pendingMemorySourceRef.current;
    if (target && !isMemorySourceTargetCurrent(target, workspaceRoot)) {
      pendingMemorySourceRef.current = null;
    }
  }, [workspaceRoot]);

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

  const formatMarkdown = (command: MarkdownFormatCommand) => {
    const editorView = editorViewRef.current;

    if (!editorView) {
      setStatusMessage(t("status.focusBeforeFormat"));
      return;
    }

    executeMarkdownFormatCommand(editorView, command);
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
        workspaceRoot: activeDocumentRoot,
        markdownRelativePath: activeRelativePath,
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
        workspaceRoot: activeDocumentRoot,
        markdownRelativePath: activeRelativePath,
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

  const commandRuntimeContext = useMemo<CommandRuntimeContext>(() => ({
    activeDocumentId: activeFileId,
    activeViewMode: viewMode,
    repositoryBusy: isRepositoryBusy,
    repositoryConnected: Boolean(repositoryAccount),
    repositoryCleanupPending,
    repositoryLinked: Boolean(repositoryBinding),
    selectedTreeItemId,
    sidebarOpen,
    theme: themeName,
    workspaceOpen: Boolean(workspaceRoot),
  }), [
    activeFileId,
    isRepositoryBusy,
    repositoryCleanupPending,
    repositoryAccount,
    repositoryBinding,
    selectedTreeItemId,
    sidebarOpen,
    themeName,
    viewMode,
    workspaceRoot,
  ]);

  const executeCommand: ExecuteAppCommand = useEventCallback((
    command: AppCommand,
    payload?: AppCommandPayload,
  ) => {
      if (!getCommandState(command, commandRuntimeContext).enabled) {
        return;
      }

      const targetPath = payload?.targetPath;
      if (command === "vocab.lookup") {
        if (activeSurface === "workspace") vocab.open();
        return;
      }
      if (command.startsWith("caption.")) {
        void import("./features/caption/captionCommands").then(({ executeCaptionCommand }) => executeCaptionCommand(command))
          .catch(() => setStatusMessage(t("caption.operationFailed")));
        return;
      }
      if (command === "app.settings") { setIsSettingsDialogOpen(true); return; }
      if (command === "edit.copyMarkdown") {
        const range = editorViewRef.current?.state.selection.main;
        const source = viewMode !== "preview" && range && !range.empty
          ? markdownContent.slice(range.from, range.to) : markdownContent;
        void navigator.clipboard.writeText(source).then(() => setStatusMessage(t("clipboard.markdownCopied")),
          () => setStatusMessage(t("clipboard.sourceCopyFailed")));
        return;
      }
      const targetItem = targetPath
        ? findWorkspaceItem(workspaceItems, targetPath)
        : null;
      const parentPath = targetItem?.type === "folder" ? targetItem.id : null;
      const commandTargetPath = resolveFileCommandTarget({
        activeFileId,
        selectedTreeItemId,
        targetPath,
      });

      if (command === "app.about") {
        setIsAboutDialogOpen(true);
        return;
      }

      if (command === "surface.workspace") {
        setActiveSurface("workspace");
        return;
      }

      if (command === "surface.context") {
        snapshotActiveMemoryDocument();
        setActiveSurface("context");
        return;
      }

      if (command === "app.quit") {
        void requestAppQuit();
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
        setActiveSurface("workspace");
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

      if (
        command === "edit.undo" ||
        command === "edit.redo" ||
        command === "edit.selectAll"
      ) {
        if (command === "edit.selectAll" && viewMode === "preview") {
          selectEntirePreviewDocument();
        } else {
          executeStandardEditorCommand(editorViewRef.current, command);
        }
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
        documentSession.collapseFolders();
        return;
      }

      if (command === "view.toggleSidebar") {
        setSidebarOpen((isOpen) => !isOpen);
        return;
      }

      if (command === "view.resetLayout") {
        layout.reset();
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
        storeTheme("light");
        setThemeName("light");
        setStatusMessage(t("status.themeChanged", { theme: t("menu.light") }));
        return;
      }

      if (command === "theme.dark") {
        storeTheme("dark");
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
        repository.openConnectDialog();
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

      if (isMarkdownFormatCommand(command)) {
        formatMarkdown(command);
        return;
      }

      setStatusMessage(
        t("status.commandReserved", { command }),
      );
  });

  useAppShortcuts(executeCommand, commandRuntimeContext);
  useNativeAppMenu(executeCommand, {
    commandContext: commandRuntimeContext,
    repositoryAccount,
    repositoryBinding,
  });

  return (
    <>
      {vocab.controls()}
      <div ref={zoomViewportRef} className="app-zoom-viewport" inert={sessionClosing}>
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
            <div className="polarbear-root-surface">
            <ActivityRail
              activeSurface={activeSurface}
              contextLabel={t("context.surface")}
              workspaceLabel={t("context.workspace")}
              onSelect={(surface) => executeCommand(surface === "workspace" ? "surface.workspace" : "surface.context")}
            />
            {activeSurface === "workspace" ? <AppShell
              activeFileId={activeFileId}
              layoutPreferences={layout.preferences}
              onLayoutChange={layout.update}
              splitView={viewMode === "split"}
              activeRelativePath={activeRelativePath}
              activeFileName={activeFileName}
              characterCount={markdownContent.length}
              collapseVersion={collapseVersion}
              debugEnabled={debugEnabled}
              documentStructureItems={documentStructureItems}
              dirtyFileIds={dirtyWorkspacePaths}
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
              onRenameCancel={documentSession.cancelRename}
              onRenameConfirm={(item, nextName) => void confirmRename(item, nextName)}
              onSelectDocumentStructureItem={selectDocumentStructureItem}
              onSelectFile={(fileId) => void selectFile(fileId)}
              onOpenRecent={openMarkdownPath}
              onSelectTab={(tabId) => void activateTab(tabId)}
              onSelectTreeItem={documentSession.selectTreeItem}
              onSidebarClose={() => setSidebarOpen(false)}
              onSync={() => executeCommand("repository.syncNow")}
              onToggleDocumentStructure={() =>
                setIsDocumentStructureOpen((isOpen) => !isOpen)
              }
              onToggleSidebar={() => setSidebarOpen((isOpen) => !isOpen)}
            >
              <section className={`editor-workspace editor-workspace-${viewMode}`}
                onPointerDown={vocab.onPointerDown} onPointerUp={vocab.onPointerUp} onScrollCapture={vocab.onScroll}>
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
                        onClipboardStatus={setStatusMessage}
                        onCommand={executeCommand}
                        onEditorReady={handleEditorReady}
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
                        onClipboardStatus={setStatusMessage}
                        markdownContent={markdownContent}
                        onEditorReady={handleEditorReady}
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
                        onClipboardStatus={setStatusMessage}
                        markdownContent={markdownContent}
                        workspaceRoot={workspaceRoot}
                      />
                    ) : null}
                  </>
                )}
              </section>
            </AppShell> : <ContextWorkspace
              key={workspaceRoot}
              documentContext={memoryDocumentContext}
              workspaceRoot={workspaceRoot}
              onOpenSource={(target) => void openMemorySource(target)}
              onOpenWorkspace={() => executeCommand("file.openFolder")}
            />}
            </div>
          </div>
        </div>
      </div>
      {createItemType ? (
        <CreateItemDialog
          defaultName={createDefaultName}
          itemType={createItemType}
          onCancel={documentSession.cancelCreate}
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
      <RepositoryWorkflowDialogs workflow={repository} />
      {externalDocumentChange ? (
        <ExternalFileChangedDialog
          path={externalDocumentChange.relativePath}
          reason={externalDocumentChange.reason}
          onKeepEditing={keepEditingExternalDocument}
          onReloadFromDisk={() => void reloadExternalDocumentFromDisk()}
          onSaveAs={() => void saveDeletedExternalDocumentAs()}
        />
      ) : null}
      {isAboutDialogOpen ? (
        <AboutPolarbearDialog onClose={() => setIsAboutDialogOpen(false)} />
      ) : null}
      {isSettingsDialogOpen && <SettingsDialog onResetLayout={() => executeCommand("view.resetLayout")} onClose={() => setIsSettingsDialogOpen(false)} />}
    </>
  );
}
