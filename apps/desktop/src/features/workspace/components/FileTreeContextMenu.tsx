import type { AppCommand, ExecuteAppCommand } from "../../../shared/commands/appCommandTypes";
import type { WorkspaceItem } from "../workspaceModel";
import { useI18n, type Translate } from "../../../shared/i18n/I18nProvider";

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
  const { t } = useI18n();
  const targetPath = menu.target.type === "item" ? menu.target.item.id : "";
  const items = getContextMenuItems(menu.target, t);

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
  target: FileTreeContextMenuTarget,
  t: Translate
): ContextMenuItem[] {
  if (target.type === "blank") {
    return [
      { label: t("tree.newFile"), command: "file.newFile" },
      { label: t("tree.newFolder"), command: "file.newFolder" },
      { type: "separator" },
      { label: t("top.fileTree"), command: "view.fileTree" },
      { type: "separator" },
      { label: t("tree.openFolder"), command: "file.openFolder" },
      { label: t("tree.refresh"), command: "workspace.refresh" },
      { label: t("tree.collapseAll"), command: "workspace.collapseAll" },
      { label: t("tree.reveal"), command: "file.revealInFinder" },
      { label: t("tree.copyWorkspacePath"), command: "file.copyPath" }
    ];
  }

  if (target.item.type === "folder") {
    return [
      { label: t("tree.newFile"), command: "file.newFile" },
      { label: t("tree.newFolder"), command: "file.newFolder" },
      { label: t("tree.rename"), command: "file.rename" },
      { label: t("tree.duplicate"), command: "file.duplicate" },
      { label: t("tree.deleteFolder"), command: "file.delete" },
      { type: "separator" },
      { label: t("tree.reveal"), command: "file.revealInFinder" },
      { label: t("tree.copyFolderPath"), command: "file.copyPath" }
    ];
  }

  return [
    { label: t("menu.open"), command: "file.openFile" },
    { label: t("tree.rename"), command: "file.rename" },
    { label: t("tree.duplicate"), command: "file.duplicate" },
    { label: t("tree.deleteFile"), command: "file.delete" },
    { type: "separator" },
    { label: t("tree.reveal"), command: "file.revealInFinder" },
    { label: t("tree.copyFilePath"), command: "file.copyPath" }
  ];
}
