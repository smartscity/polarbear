import type { AppCommand, ExecuteAppCommand } from "../../../shared/commands/appCommandTypes";
import { titleForCommand } from "../../../commands/appCommandRegistry";
import type { WorkspaceItem } from "../workspaceModel";
import {
  useI18n,
  type MessageKey,
} from "../../../shared/i18n/I18nProvider";

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
  labelKey?: MessageKey;
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
  const { t } = useI18n();
  const targetPath = menu.target.type === "item" ? menu.target.item.id : "";
  const items = getContextMenuItems(menu.target);

  return (
    <div
      className="file-tree-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        const label = item.command
          ? item.labelKey
            ? t(item.labelKey)
            : titleForCommand(item.command, t)
          : "";

        return item.type === "separator" ? (
          <span
            className="menu-separator"
            aria-hidden="true"
            key={`context-separator-${index}`}
          />
        ) : (
          <button
            type="button"
            disabled={item.disabled}
            key={item.command ?? `context-item-${index}`}
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
            {label}
          </button>
        );
      })}
    </div>
  );
}

function getContextMenuItems(
  target: FileTreeContextMenuTarget,
): ContextMenuItem[] {
  if (target.type === "blank") {
    return [
      { command: "file.newFile" },
      { command: "file.newFolder" },
      { type: "separator" },
      { command: "view.fileTree" },
      { type: "separator" },
      { command: "file.openFolder" },
      { command: "workspace.refresh" },
      { command: "workspace.collapseAll" },
      { command: "file.revealInFinder" },
      { command: "file.copyPath" }
    ];
  }

  if (target.item.type === "folder") {
    return [
      { command: "file.newFile" },
      { command: "file.newFolder" },
      { command: "file.rename" },
      { command: "file.duplicate" },
      { command: "file.delete", labelKey: "tree.deleteFolder" },
      { type: "separator" },
      { command: "file.revealInFinder" },
      { command: "file.copyPath" }
    ];
  }

  return [
    { command: "file.openFile" },
    { command: "file.rename" },
    { command: "file.duplicate" },
    { command: "file.delete", labelKey: "tree.deleteFile" },
    { type: "separator" },
    { command: "file.revealInFinder" },
    { command: "file.copyPath" }
  ];
}
