import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import type { ExecuteAppCommand } from "../../model/AppCommand";
import type { WorkspaceItem } from "../../model/WorkspaceFile";
import {
  FileTreeContextMenu,
  type FileTreeContextMenuState
} from "./FileTreeContextMenu";

type FileTreeProps = {
  activeFileId: string;
  collapseVersion: number;
  dirtyFileIds: Set<string>;
  executeCommand: ExecuteAppCommand;
  folderRevealRequest: { folderId: string; version: number } | null;
  items: WorkspaceItem[];
  renameItemId: string | null;
  selectedTreeItemId: string;
  onRenameCancel: () => void;
  onRenameConfirm: (item: WorkspaceItem, nextName: string) => void;
  onSelectFile: (fileId: string) => void;
  onSelectTreeItem: (itemId: string) => void;
};

export function FileTree({
  activeFileId,
  collapseVersion,
  dirtyFileIds,
  executeCommand,
  folderRevealRequest,
  items,
  renameItemId,
  selectedTreeItemId,
  onRenameCancel,
  onRenameConfirm,
  onSelectFile,
  onSelectTreeItem
}: FileTreeProps) {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    new Set()
  );
  const [contextMenu, setContextMenu] =
    useState<FileTreeContextMenuState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const autoExpandTimerRef = useRef<number | null>(null);
  const draggedPathRef = useRef("");

  useEffect(() => {
    if (collapseVersion > 0) {
      setCollapsedFolderIds(new Set(findFolderIds(items)));
    }
  }, [collapseVersion]);

  useEffect(() => {
    if (!folderRevealRequest?.folderId) {
      return;
    }

    setCollapsedFolderIds((currentFolderIds) => {
      const nextFolderIds = new Set(currentFolderIds);
      nextFolderIds.delete(folderRevealRequest.folderId);
      return nextFolderIds;
    });
  }, [folderRevealRequest]);

  useEffect(() => {
    function closeContextMenu(event: PointerEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest(".file-tree-context-menu")
      ) {
        return;
      }

      setContextMenu(null);
    }

    function handleKeyDown() {
      setContextMenu(null);
    }

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const toggleFolder = (folderId: string) => {
    setCollapsedFolderIds((currentFolderIds) => {
      const nextFolderIds = new Set(currentFolderIds);

      if (nextFolderIds.has(folderId)) {
        nextFolderIds.delete(folderId);
      } else {
        nextFolderIds.add(folderId);
      }

      return nextFolderIds;
    });
  };

  const openContextMenu = (
    event: MouseEvent,
    menu: FileTreeContextMenuState
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(menu);

    if (menu.target.type === "item") {
      onSelectTreeItem(menu.target.item.id);
    }
  };

  const clearAutoExpandTimer = () => {
    if (autoExpandTimerRef.current !== null) {
      window.clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
  };

  const getDraggedPath = (event: DragEvent): string => {
    return (
      event.dataTransfer.getData("application/x-polarbear-path") ||
      event.dataTransfer.getData("text/plain") ||
      draggedPathRef.current
    );
  };

  const moveDraggedItem = (sourcePath: string, targetParentPath: string | null) => {
    if (!sourcePath || sourcePath === targetParentPath) {
      return;
    }

    executeCommand("file.move", {
      sourcePath,
      targetParentPath
    });
  };

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".tree-item")
    ) {
      return;
    }

    const sourcePath = getDraggedPath(event);

    if (!sourcePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearAutoExpandTimer();
    setDropTargetId(null);
    draggedPathRef.current = "";
    moveDraggedItem(sourcePath, null);
  };

  if (items.length === 0) {
    return (
      <div
        className={`workspace-empty ${dropTargetId === "" ? "drop-target" : ""}`}
        onContextMenu={(event) =>
          openContextMenu(event, {
            target: { type: "blank" },
            x: event.clientX,
            y: event.clientY
          })
        }
        onDragOver={(event) => {
          if (getDraggedPath(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTargetId("");
          }
        }}
        onDragLeave={() => setDropTargetId(null)}
        onDrop={handleRootDrop}
      >
        <strong>No Markdown files yet</strong>
        <span>Use File / New File to start this workspace.</span>
        {contextMenu ? (
          <FileTreeContextMenu
            executeCommand={executeCommand}
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`workspace-tree-shell ${dropTargetId === "" ? "drop-target" : ""}`}
      onContextMenu={(event) =>
        openContextMenu(event, {
          target: { type: "blank" },
          x: event.clientX,
          y: event.clientY
        })
      }
      onKeyDown={(event) => {
        if ((event.key === "F2" || event.key === "Enter") && selectedTreeItemId) {
          event.preventDefault();
          executeCommand("file.rename", { targetPath: selectedTreeItemId });
        }
      }}
      onDragOver={(event) => {
        if (
          getDraggedPath(event) &&
          event.target instanceof Element &&
          !event.target.closest(".tree-item")
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTargetId("");
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDropTargetId(null);
        }
      }}
      onDrop={handleRootDrop}
      tabIndex={0}
    >
      <ul className="workspace-tree">{renderItems(items)}</ul>
      {contextMenu ? (
        <FileTreeContextMenu
          executeCommand={executeCommand}
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );

  function renderItems(workspaceItems: WorkspaceItem[]) {
    return workspaceItems.map((item) => {
      const isCollapsed = collapsedFolderIds.has(item.id);
      const isRenaming = renameItemId === item.id;
      const isSelected = selectedTreeItemId === item.id;
      const handleRenameKeyDown = (event: KeyboardEvent) => {
        if (event.key === "F2" || event.key === "Enter") {
          event.preventDefault();
          executeCommand("file.rename", { targetPath: item.id });
        }
      };

      return (
        <li key={item.id}>
          {item.type === "folder" ? (
            <>
              <button
                type="button"
                className={`tree-item folder-item ${isSelected ? "selected" : ""} ${
                  dropTargetId === item.id ? "drop-target" : ""
                }`}
                draggable={!isRenaming}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    "application/x-polarbear-path",
                    item.id
                  );
                  event.dataTransfer.setData("text/plain", item.id);
                  draggedPathRef.current = item.id;
                }}
                onDragEnd={() => {
                  clearAutoExpandTimer();
                  setDropTargetId(null);
                  draggedPathRef.current = "";
                }}
                onDragOver={(event) => {
                  const sourcePath = getDraggedPath(event);

                  if (
                    !sourcePath ||
                    sourcePath === item.id ||
                    item.id.startsWith(`${sourcePath}/`)
                  ) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDropTargetId(item.id);

                  if (
                    collapsedFolderIds.has(item.id) &&
                    autoExpandTimerRef.current === null
                  ) {
                    autoExpandTimerRef.current = window.setTimeout(() => {
                      setCollapsedFolderIds((currentFolderIds) => {
                        const nextFolderIds = new Set(currentFolderIds);
                        nextFolderIds.delete(item.id);
                        return nextFolderIds;
                      });
                      autoExpandTimerRef.current = null;
                    }, 600);
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    event.relatedTarget instanceof Node &&
                    event.currentTarget.contains(event.relatedTarget)
                  ) {
                    return;
                  }

                  clearAutoExpandTimer();
                  setDropTargetId((currentDropTargetId) =>
                    currentDropTargetId === item.id ? null : currentDropTargetId
                  );
                }}
                onDrop={(event) => {
                  const sourcePath = getDraggedPath(event);

                  if (!sourcePath) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  clearAutoExpandTimer();
                  setDropTargetId(null);
                  draggedPathRef.current = "";
                  moveDraggedItem(sourcePath, item.id);
                }}
                onClick={() => {
                  onSelectTreeItem(item.id);
                  toggleFolder(item.id);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  executeCommand("file.rename", { targetPath: item.id });
                }}
                onKeyDown={handleRenameKeyDown}
                onContextMenu={(event) =>
                  openContextMenu(event, {
                    target: { type: "item", item },
                    x: event.clientX,
                    y: event.clientY
                  })
                }
              >
                <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                {isRenaming ? (
                  <RenameInput
                    item={item}
                    onCancel={onRenameCancel}
                    onConfirm={onRenameConfirm}
                  />
                ) : (
                  <span>{item.name}</span>
                )}
              </button>
              {!isCollapsed && item.children ? (
                <ul className="workspace-tree">{renderItems(item.children)}</ul>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className={`tree-item file-item ${
                item.id === activeFileId || isSelected ? "selected" : ""
              }`}
              draggable={!isRenaming}
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    "application/x-polarbear-path",
                    item.id
                  );
                  event.dataTransfer.setData("text/plain", item.id);
                  draggedPathRef.current = item.id;
                }}
              onDragEnd={() => {
                setDropTargetId(null);
                draggedPathRef.current = "";
              }}
              onClick={(event) => {
                if (selectedTreeItemId === item.id && event.detail === 1) {
                  executeCommand("file.rename", { targetPath: item.id });
                  return;
                }

                onSelectTreeItem(item.id);
                onSelectFile(item.id);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                executeCommand("file.rename", { targetPath: item.id });
              }}
              onKeyDown={handleRenameKeyDown}
              onContextMenu={(event) =>
                openContextMenu(event, {
                  target: { type: "item", item },
                  x: event.clientX,
                  y: event.clientY
                })
              }
            >
              <span aria-hidden="true">#</span>
              {isRenaming ? (
                <RenameInput
                  item={item}
                  onCancel={onRenameCancel}
                  onConfirm={onRenameConfirm}
                />
              ) : (
                <>
                  <span>{item.name}</span>
                  {dirtyFileIds.has(item.id) ? (
                    <span className="dirty-dot" aria-label="Unsaved changes">
                      •
                    </span>
                  ) : null}
                </>
              )}
            </button>
          )}
        </li>
      );
    });
  }
}

type RenameInputProps = {
  item: WorkspaceItem;
  onCancel: () => void;
  onConfirm: (item: WorkspaceItem, nextName: string) => void;
};

function RenameInput({ item, onCancel, onConfirm }: RenameInputProps) {
  const [name, setName] = useState(item.name);
  const didSubmitRef = useRef(false);

  const confirmRename = () => {
    if (didSubmitRef.current) {
      return;
    }

    didSubmitRef.current = true;
    onConfirm(item, name);
  };

  return (
    <input
      className="rename-input"
      autoFocus
      value={name}
      onBlur={confirmRename}
      onChange={(event) => setName(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();

        if (event.key === "Escape") {
          event.preventDefault();
          didSubmitRef.current = true;
          onCancel();
        }

        if (event.key === "Enter") {
          event.preventDefault();
          confirmRename();
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}

function findFolderIds(items: WorkspaceItem[]): string[] {
  return items.flatMap((item) => {
    if (item.type !== "folder") {
      return [];
    }

    return [item.id, ...findFolderIds(item.children ?? [])];
  });
}
