import { useEffect } from "react";
import { acceleratorForCommand } from "./appCommandRegistry";
import type { ExecuteAppCommand } from "../model/AppCommand";
import type {
  RepositoryAccount,
  RepositoryBinding
} from "../repository/repositoryApi";
import { repositoryProviderLabel } from "../repository/repositoryApi";
import { useI18n } from "../i18n/I18nProvider";

type NativeAppMenuState = {
  repositoryAccount: RepositoryAccount | null;
  repositoryBinding: RepositoryBinding | null;
};

export function useNativeAppMenu(
  executeCommand: ExecuteAppCommand,
  state: NativeAppMenuState
): void {
  const { language, t } = useI18n();

  useEffect(() => {
    let isDisposed = false;

    async function installMenu() {
      try {
        const { Menu } = await import("@tauri-apps/api/menu");
        const menu = await Menu.new({
          items: [
            {
              id: "app",
              text: "Polarbear",
              items: [
                {
                  id: "app.about",
                  text: t("menu.about"),
                  action: () => executeCommand("app.about")
                },
                { item: "Separator" },
                { item: "Quit" }
              ]
            },
            {
              id: "file",
              text: t("menu.file"),
              items: [
                {
                  id: "file.newWindow",
                  text: t("menu.newWindow"),
                  accelerator: acceleratorForCommand("app.newWindow"),
                  action: () => executeCommand("app.newWindow")
                },
                { item: "Separator" },
                {
                  id: "file.newFile",
                  text: t("menu.new"),
                  accelerator: acceleratorForCommand("file.newFile"),
                  action: () => executeCommand("file.newFile")
                },
                { item: "Separator" },
                {
                  id: "file.openFile",
                  text: t("menu.open"),
                  accelerator: acceleratorForCommand("file.openFile"),
                  action: () => executeCommand("file.openFile")
                },
                { item: "Separator" },
                {
                  id: "file.save",
                  text: t("menu.save"),
                  accelerator: acceleratorForCommand("file.save"),
                  action: () => executeCommand("file.save")
                },
                {
                  id: "file.saveAs",
                  text: t("menu.saveAs"),
                  accelerator: acceleratorForCommand("file.saveAs"),
                  action: () => executeCommand("file.saveAs")
                },
                {
                  id: "file.close",
                  text: t("menu.close"),
                  accelerator: acceleratorForCommand("file.close"),
                  action: () => executeCommand("file.close")
                },
                {
                  id: "file.rename",
                  text: t("menu.rename"),
                  action: () => executeCommand("file.rename")
                }
              ]
            },
            {
              id: "edit",
              text: t("menu.edit"),
              items: [
                { item: "Undo" },
                { item: "Redo" },
                { item: "Separator" },
                { item: "Cut" },
                { item: "Copy" },
                { item: "Paste" },
                { item: "SelectAll" },
                { item: "Separator" },
                {
                  text: t("menu.find"),
                  accelerator: acceleratorForCommand("edit.find"),
                  action: () => executeCommand("edit.find")
                },
                {
                  text: t("menu.findNext"),
                  accelerator: acceleratorForCommand("edit.findNext"),
                  action: () => executeCommand("edit.findNext")
                },
                {
                  text: t("menu.findPrevious"),
                  accelerator: acceleratorForCommand("edit.findPrevious"),
                  action: () => executeCommand("edit.findPrevious")
                }
              ]
            },
            {
              id: "paragraph",
              text: t("menu.paragraph"),
              items: [
                {
                  text: t("menu.paragraph"),
                  action: () => executeCommand("format.paragraph")
                },
                { item: "Separator" },
                {
                  text: t("menu.insertTable"),
                  accelerator: acceleratorForCommand("editor.insertTable"),
                  action: () => executeCommand("editor.insertTable")
                },
                {
                  text: t("menu.insertCodeFence"),
                  action: () => executeCommand("editor.insertCodeFence")
                },
                {
                  text: t("menu.mathBlock"),
                  accelerator: acceleratorForCommand("format.mathBlock"),
                  action: () => executeCommand("format.mathBlock")
                },
                { item: "Separator" },
                {
                  text: t("menu.heading", { level: 1 }),
                  accelerator: acceleratorForCommand("format.heading1"),
                  action: () => executeCommand("format.heading1")
                },
                {
                  text: t("menu.heading", { level: 2 }),
                  accelerator: acceleratorForCommand("format.heading2"),
                  action: () => executeCommand("format.heading2")
                },
                {
                  text: t("menu.heading", { level: 3 }),
                  accelerator: acceleratorForCommand("format.heading3"),
                  action: () => executeCommand("format.heading3")
                },
                {
                  text: t("menu.heading", { level: 4 }),
                  accelerator: acceleratorForCommand("format.heading4"),
                  action: () => executeCommand("format.heading4")
                },
                {
                  text: t("menu.heading", { level: 5 }),
                  accelerator: acceleratorForCommand("format.heading5"),
                  action: () => executeCommand("format.heading5")
                },
                {
                  text: t("menu.heading", { level: 6 }),
                  accelerator: acceleratorForCommand("format.heading6"),
                  action: () => executeCommand("format.heading6")
                },
                { item: "Separator" },
                {
                  text: t("menu.quote"),
                  action: () => executeCommand("format.quote")
                },
                {
                  text: t("menu.orderedList"),
                  action: () => executeCommand("format.orderedList")
                },
                {
                  text: t("menu.unorderedList"),
                  action: () => executeCommand("format.unorderedList")
                },
                {
                  text: t("menu.taskList"),
                  action: () => executeCommand("format.taskList")
                }
              ]
            },
            {
              id: "format",
              text: t("menu.format"),
              items: [
                {
                  text: t("menu.bold"),
                  accelerator: acceleratorForCommand("format.bold"),
                  action: () => executeCommand("format.bold")
                },
                {
                  text: t("menu.italic"),
                  accelerator: acceleratorForCommand("format.italic"),
                  action: () => executeCommand("format.italic")
                },
                {
                  text: t("menu.underline"),
                  accelerator: acceleratorForCommand("format.underline"),
                  action: () => executeCommand("format.underline")
                },
                {
                  text: t("menu.inlineCode"),
                  action: () => executeCommand("format.code")
                },
                {
                  text: t("menu.link"),
                  accelerator: acceleratorForCommand("format.link"),
                  action: () => executeCommand("format.link")
                },
                {
                  text: t("menu.clearFormat"),
                  action: () => executeCommand("format.clearFormat")
                },
                { item: "Separator" },
                {
                  text: t("menu.codeFence"),
                  accelerator: acceleratorForCommand("format.codeFence"),
                  action: () => executeCommand("format.codeFence")
                },
                {
                  text: t("menu.insertImage"),
                  accelerator: acceleratorForCommand("format.insertImage"),
                  action: () => executeCommand("format.insertImage")
                }
              ]
            },
            {
              id: "view",
              text: t("menu.view"),
              items: [
                {
                  text: t("menu.sourceMode"),
                  accelerator: acceleratorForCommand("view.sourceCode"),
                  action: () => executeCommand("view.sourceCode")
                },
                {
                  text: t("menu.liveMode"),
                  action: () => executeCommand("view.liveEdit")
                },
                { item: "Separator" },
                {
                  text: t("menu.splitMode"),
                  accelerator: acceleratorForCommand("view.split"),
                  action: () => executeCommand("view.split")
                },
                {
                  text: t("menu.previewMode"),
                  accelerator: acceleratorForCommand("view.preview"),
                  action: () => executeCommand("view.preview")
                },
                { item: "Separator" },
                {
                  text: t("menu.toggleSidebar"),
                  accelerator: acceleratorForCommand("view.toggleSidebar"),
                  action: () => executeCommand("view.toggleSidebar")
                },
                {
                  text: t("menu.fileTree"),
                  action: () => executeCommand("view.fileTree")
                },
                { item: "Separator" },
                {
                  text: t("menu.actualSize"),
                  accelerator: acceleratorForCommand("view.resetZoom"),
                  action: () => executeCommand("view.resetZoom", { commandSource: "menu" })
                },
                {
                  text: t("menu.zoomIn"),
                  accelerator: acceleratorForCommand("view.zoomIn"),
                  action: () => executeCommand("view.zoomIn", { commandSource: "menu" })
                },
                {
                  text: t("menu.zoomOut"),
                  accelerator: acceleratorForCommand("view.zoomOut"),
                  action: () => executeCommand("view.zoomOut", { commandSource: "menu" })
                },
                { item: "Separator" },
                { item: "Fullscreen" }
              ]
            },
            {
              id: "themes",
              text: t("menu.themes"),
              items: [
                {
                  text: t("menu.light"),
                  action: () => executeCommand("theme.light")
                },
                {
                  text: t("menu.dark"),
                  action: () => executeCommand("theme.dark")
                }
              ]
            },
            {
              id: "repository",
              text: t("menu.cloudSync"),
              items: repositoryMenuItems({
                executeCommand,
                repositoryAccount: state.repositoryAccount,
                repositoryBinding: state.repositoryBinding,
                t
              })
            }
          ]
        });

        if (!isDisposed) {
          await menu.setAsAppMenu();
        }
      } catch (error) {
        console.info("Native menu is unavailable in this environment.", error);
      }
    }

    void installMenu();

    return () => {
      isDisposed = true;
    };
  }, [executeCommand, language, state.repositoryAccount, state.repositoryBinding, t]);
}

function repositoryMenuItems(params: {
  executeCommand: ExecuteAppCommand;
  repositoryAccount: RepositoryAccount | null;
  repositoryBinding: RepositoryBinding | null;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const { executeCommand, repositoryAccount, repositoryBinding, t } = params;

  if (!repositoryAccount) {
    return [
      {
        id: "repository.connectCloudSync",
        text: t("cloud.connect"),
        action: () => executeCommand("repository.connectGithub")
      }
    ];
  }

  if (!repositoryBinding) {
    return [
      {
        id: "repository.connectionStatus",
        text: t("cloud.connectedAs", {
          provider: repositoryProviderLabel(repositoryAccount.provider),
          account: repositoryAccount.login
        }),
        enabled: false
      },
      {
        id: "repository.syncSettings",
        text: t("cloud.settings"),
        action: () => executeCommand("repository.linkWorkspace")
      }
    ];
  }

  return [
    {
      id: "repository.connectionStatus",
      text: `${repositoryProviderLabel(repositoryAccount.provider)}: ${repositoryBinding.owner}/${repositoryBinding.repo}`,
      enabled: false
    },
    {
      id: "repository.syncNow",
      text: t("common.sync"),
      accelerator: acceleratorForCommand("repository.syncNow"),
      action: () => executeCommand("repository.syncNow")
    }
  ];
}
