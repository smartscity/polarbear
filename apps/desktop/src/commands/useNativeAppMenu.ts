import { useEffect } from "react";
import { getCommandState, type CommandRuntimeContext } from "./commandState";
import {
  titleForCommand,
} from "./appCommandRegistry";
import { effectiveAcceleratorForCommand } from "./keybindingResolver";
import type { AppCommand, ExecuteAppCommand } from "../shared/commands/appCommandTypes";
import type {
  RepositoryAccount,
  RepositoryBinding
} from "../features/repository/repositoryApi";
import { repositoryProviderLabel } from "../features/repository/repositoryApi";
import { useI18n, type Translate } from "../shared/i18n/I18nProvider";
import { useUserSettings } from "../shared/settings/useUserSettings";
import type { KeybindingOverrides } from "../shared/settings/userSettings";

type NativeAppMenuState = {
  commandContext: CommandRuntimeContext;
  repositoryAccount: RepositoryAccount | null;
  repositoryBinding: RepositoryBinding | null;
};

export function useNativeAppMenu(
  executeCommand: ExecuteAppCommand,
  state: NativeAppMenuState
): void {
  const { language, t } = useI18n();
  const userSettings = useUserSettings();

  useEffect(() => {
    let isDisposed = false;
    const commandTitle = (command: AppCommand) => titleForCommand(command, t);
    const commandState = (command: AppCommand) =>
      getCommandState(command, state.commandContext);
    const accelerator = (command: AppCommand) =>
      effectiveAcceleratorForCommand(command, userSettings.keybindings);

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
                  text: commandTitle("app.about"),
                  enabled: commandState("app.about").enabled,
                  action: () => executeCommand("app.about")
                },
                { item: "Separator" },
                {
                  id: "app.quit",
                  text: commandTitle("app.quit"),
                  accelerator: accelerator("app.quit"),
                  enabled: commandState("app.quit").enabled,
                  action: () => executeCommand("app.quit"),
                }
              ]
            },
            {
              id: "file",
              text: t("menu.file"),
              items: [
                {
                  id: "file.newWindow",
                  text: commandTitle("app.newWindow"),
                  accelerator: accelerator("app.newWindow"),
                  enabled: commandState("app.newWindow").enabled,
                  action: () => executeCommand("app.newWindow")
                },
                { item: "Separator" },
                {
                  id: "file.newFile",
                  text: commandTitle("file.newFile"),
                  accelerator: accelerator("file.newFile"),
                  enabled: commandState("file.newFile").enabled,
                  action: () => executeCommand("file.newFile")
                },
                { item: "Separator" },
                {
                  id: "file.openFile",
                  text: commandTitle("file.openFile"),
                  accelerator: accelerator("file.openFile"),
                  enabled: commandState("file.openFile").enabled,
                  action: () => executeCommand("file.openFile")
                },
                { item: "Separator" },
                {
                  id: "file.save",
                  text: commandTitle("file.save"),
                  accelerator: accelerator("file.save"),
                  enabled: commandState("file.save").enabled,
                  action: () => executeCommand("file.save")
                },
                {
                  id: "file.saveAs",
                  text: commandTitle("file.saveAs"),
                  accelerator: accelerator("file.saveAs"),
                  enabled: commandState("file.saveAs").enabled,
                  action: () => executeCommand("file.saveAs")
                },
                {
                  id: "file.close",
                  text: commandTitle("file.close"),
                  accelerator: accelerator("file.close"),
                  enabled: commandState("file.close").enabled,
                  action: () => executeCommand("file.close")
                },
                {
                  id: "file.rename",
                  text: commandTitle("file.rename"),
                  enabled: commandState("file.rename").enabled,
                  action: () => executeCommand("file.rename")
                }
              ]
            },
            {
              id: "edit",
              text: t("menu.edit"),
              items: [
                { item: "Undo", text: commandTitle("edit.undo") },
                { item: "Redo", text: commandTitle("edit.redo") },
                { item: "Separator" },
                { item: "Cut", text: commandTitle("edit.cut") },
                { item: "Copy", text: commandTitle("edit.copy") },
                { item: "Paste", text: commandTitle("edit.paste") },
                { item: "SelectAll", text: commandTitle("edit.selectAll") },
                { item: "Separator" },
                {
                  text: commandTitle("edit.find"),
                  accelerator: accelerator("edit.find"),
                  enabled: commandState("edit.find").enabled,
                  action: () => executeCommand("edit.find")
                },
                {
                  text: commandTitle("edit.findNext"),
                  accelerator: accelerator("edit.findNext"),
                  enabled: commandState("edit.findNext").enabled,
                  action: () => executeCommand("edit.findNext")
                },
                {
                  text: commandTitle("edit.findPrevious"),
                  accelerator: accelerator("edit.findPrevious"),
                  enabled: commandState("edit.findPrevious").enabled,
                  action: () => executeCommand("edit.findPrevious")
                }
              ]
            },
            {
              id: "paragraph",
              text: t("menu.paragraph"),
              items: [
                {
                  text: commandTitle("format.paragraph"),
                  action: () => executeCommand("format.paragraph")
                },
                { item: "Separator" },
                {
                  text: commandTitle("editor.insertTable"),
                  accelerator: accelerator("editor.insertTable"),
                  enabled: commandState("editor.insertTable").enabled,
                  action: () => executeCommand("editor.insertTable")
                },
                {
                  text: commandTitle("editor.insertCodeFence"),
                  enabled: commandState("editor.insertCodeFence").enabled,
                  action: () => executeCommand("editor.insertCodeFence")
                },
                {
                  text: commandTitle("format.mathBlock"),
                  accelerator: accelerator("format.mathBlock"),
                  enabled: commandState("format.mathBlock").enabled,
                  action: () => executeCommand("format.mathBlock")
                },
                { item: "Separator" },
                {
                  text: commandTitle("format.heading1"),
                  accelerator: accelerator("format.heading1"),
                  action: () => executeCommand("format.heading1")
                },
                {
                  text: commandTitle("format.heading2"),
                  accelerator: accelerator("format.heading2"),
                  action: () => executeCommand("format.heading2")
                },
                {
                  text: commandTitle("format.heading3"),
                  accelerator: accelerator("format.heading3"),
                  action: () => executeCommand("format.heading3")
                },
                {
                  text: commandTitle("format.heading4"),
                  accelerator: accelerator("format.heading4"),
                  action: () => executeCommand("format.heading4")
                },
                {
                  text: commandTitle("format.heading5"),
                  accelerator: accelerator("format.heading5"),
                  action: () => executeCommand("format.heading5")
                },
                {
                  text: commandTitle("format.heading6"),
                  accelerator: accelerator("format.heading6"),
                  action: () => executeCommand("format.heading6")
                },
                { item: "Separator" },
                {
                  text: commandTitle("format.quote"),
                  action: () => executeCommand("format.quote")
                },
                {
                  text: commandTitle("format.orderedList"),
                  action: () => executeCommand("format.orderedList")
                },
                {
                  text: commandTitle("format.unorderedList"),
                  action: () => executeCommand("format.unorderedList")
                },
                {
                  text: commandTitle("format.taskList"),
                  action: () => executeCommand("format.taskList")
                }
              ]
            },
            {
              id: "format",
              text: t("menu.format"),
              items: [
                {
                  text: commandTitle("format.bold"),
                  accelerator: accelerator("format.bold"),
                  enabled: commandState("format.bold").enabled,
                  action: () => executeCommand("format.bold")
                },
                {
                  text: commandTitle("format.italic"),
                  accelerator: accelerator("format.italic"),
                  enabled: commandState("format.italic").enabled,
                  action: () => executeCommand("format.italic")
                },
                {
                  text: commandTitle("format.underline"),
                  accelerator: accelerator("format.underline"),
                  enabled: commandState("format.underline").enabled,
                  action: () => executeCommand("format.underline")
                },
                {
                  text: commandTitle("format.code"),
                  enabled: commandState("format.code").enabled,
                  action: () => executeCommand("format.code")
                },
                {
                  text: commandTitle("format.link"),
                  accelerator: accelerator("format.link"),
                  enabled: commandState("format.link").enabled,
                  action: () => executeCommand("format.link")
                },
                {
                  text: commandTitle("format.clearFormat"),
                  enabled: commandState("format.clearFormat").enabled,
                  action: () => executeCommand("format.clearFormat")
                },
                { item: "Separator" },
                {
                  text: commandTitle("format.codeFence"),
                  accelerator: accelerator("format.codeFence"),
                  enabled: commandState("format.codeFence").enabled,
                  action: () => executeCommand("format.codeFence")
                },
                {
                  text: commandTitle("format.insertImage"),
                  accelerator: accelerator("format.insertImage"),
                  enabled: commandState("format.insertImage").enabled,
                  action: () => executeCommand("format.insertImage")
                }
              ]
            },
            {
              id: "view",
              text: t("menu.view"),
              items: [
                {
                  text: commandTitle("view.sourceCode"),
                  accelerator: accelerator("view.sourceCode"),
                  action: () => executeCommand("view.sourceCode")
                },
                {
                  text: commandTitle("view.liveEdit"),
                  action: () => executeCommand("view.liveEdit")
                },
                { item: "Separator" },
                {
                  text: commandTitle("view.split"),
                  accelerator: accelerator("view.split"),
                  action: () => executeCommand("view.split")
                },
                {
                  text: commandTitle("view.preview"),
                  accelerator: accelerator("view.preview"),
                  action: () => executeCommand("view.preview")
                },
                { item: "Separator" },
                {
                  text: commandTitle("view.toggleSidebar"),
                  accelerator: accelerator("view.toggleSidebar"),
                  action: () => executeCommand("view.toggleSidebar")
                },
                {
                  text: commandTitle("view.fileTree"),
                  action: () => executeCommand("view.fileTree")
                },
                { item: "Separator" },
                {
                  text: commandTitle("view.resetZoom"),
                  accelerator: accelerator("view.resetZoom"),
                  action: () => executeCommand("view.resetZoom", { commandSource: "menu" })
                },
                {
                  text: commandTitle("view.zoomIn"),
                  accelerator: accelerator("view.zoomIn"),
                  action: () => executeCommand("view.zoomIn", { commandSource: "menu" })
                },
                {
                  text: commandTitle("view.zoomOut"),
                  accelerator: accelerator("view.zoomOut"),
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
                  text: commandTitle("theme.light"),
                  action: () => executeCommand("theme.light")
                },
                {
                  text: commandTitle("theme.dark"),
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
                keybindingOverrides: userSettings.keybindings,
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
  }, [executeCommand, language, state.commandContext, state.repositoryAccount, state.repositoryBinding, t, userSettings.keybindings]);
}

function repositoryMenuItems(params: {
  executeCommand: ExecuteAppCommand;
  repositoryAccount: RepositoryAccount | null;
  repositoryBinding: RepositoryBinding | null;
  keybindingOverrides: KeybindingOverrides;
  t: Translate;
}) {
  const {
    executeCommand,
    keybindingOverrides,
    repositoryAccount,
    repositoryBinding,
    t,
  } = params;

  if (!repositoryAccount) {
    return [
      {
        id: "repository.connectCloudSync",
        text: titleForCommand("repository.connectGithub", t),
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
        text: titleForCommand("repository.linkWorkspace", t),
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
      text: titleForCommand("repository.syncNow", t),
      accelerator: effectiveAcceleratorForCommand("repository.syncNow", keybindingOverrides),
      action: () => executeCommand("repository.syncNow")
    }
  ];
}
