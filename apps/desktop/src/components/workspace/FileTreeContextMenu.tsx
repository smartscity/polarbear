import type { AppCommand, ExecuteAppCommand } from "../../model/AppCommand";
import type { WorkspaceItem } from "../../model/WorkspaceFile";

export type FileTreeContextMenuTarget =
  | { type: "blank" }
  | { type: "item"; item: WorkspaceItem };

export type FileTreeContextMenuState = {
  target: FileTreeContextMenuTarget;
  x: number;
  y: number;
};

type ContextMenuItem = {
  command?: AppCommand;
  disabled?: boolean;
  label?: string;
  type?: "separator";
};

type FileTreeContextMenuProps = {
  menu: FileTreeContextMenuState;
  executeCommand: ExecuteAppCommand;
  onClose: () => void;
};

export function FileTreeContextMenu({
  menu,
  executeCommand,
  onClose
}: FileTreeContextMenuProps) {
  const targetPath = menu.target.type === "item" ? menu.target.item.id : "";
  const items = getContextMenuItems(menu.target);

  return (
    <div
      className="file-tree-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item.type === "separator" ? (
          <span
            className="menu-separator"
            aria-hidden="true"
            key={`context-separator-${index}`}
          />
        ) : (
          <button
            type="button"
            disabled={item.disabled}
            key={item.label}
            onClick={() => {
              if (item.command) {
                executeCommand(item.command, {
                  targetPath,
                  workspaceCreate:
                    item.command === "file.newFile" ||
                    item.command === "file.newFolder"
                });
              }
              onClose();
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

function getContextMenuItems(
  target: FileTreeContextMenuTarget
): ContextMenuItem[] {
  if (target.type === "blank") {
    return [
      { label: "New File", command: "file.newFile" },
      { label: "New Folder", command: "file.newFolder" },
      { type: "separator" },
      { label: "File Tree (Tree View)", command: "view.fileTree" },
      { type: "separator" },
      { label: "Open Folder...", command: "file.openFolder" },
      { label: "Refresh", command: "workspace.refresh" },
      { label: "Collapse All", command: "workspace.collapseAll" },
      { label: "Reveal in Finder", command: "file.revealInFinder" },
      { label: "Copy Workspace Path", command: "file.copyPath" }
    ];
  }

  if (target.item.type === "folder") {
    return [
      { label: "New File", command: "file.newFile" },
      { label: "New Folder", command: "file.newFolder" },
      { label: "Rename", command: "file.rename" },
      { type: "separator" },
      { label: "Reveal in Finder", command: "file.revealInFinder" },
      { label: "Copy Folder Path", command: "file.copyPath" }
    ];
  }

  return [
    { label: "Open", command: "file.openFile" },
    { label: "Rename", command: "file.rename" },
    { label: "Reveal in Finder", command: "file.revealInFinder" },
    { label: "Copy File Path", command: "file.copyPath" }
  ];
}
