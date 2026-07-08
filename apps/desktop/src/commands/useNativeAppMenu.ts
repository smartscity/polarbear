import { useEffect } from "react";
import { acceleratorForCommand } from "./appCommandRegistry";
import type { ExecuteAppCommand } from "../model/AppCommand";
import type {
  RepositoryAccount,
  RepositoryBinding
} from "../repository/repositoryApi";

type NativeAppMenuState = {
  repositoryAccount: RepositoryAccount | null;
  repositoryBinding: RepositoryBinding | null;
};

export function useNativeAppMenu(
  executeCommand: ExecuteAppCommand,
  state: NativeAppMenuState
): void {
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
                  text: "About Polarbear",
                  action: () => executeCommand("app.about")
                },
                { item: "Separator" },
                {
                  id: "app.newWindow",
                  text: "New Window",
                  accelerator: acceleratorForCommand("app.newWindow"),
                  action: () => executeCommand("app.newWindow")
                }
              ]
            },
            {
              id: "file",
              text: "File",
              items: [
                {
                  id: "file.newWindow",
                  text: "New Window",
                  accelerator: acceleratorForCommand("app.newWindow"),
                  action: () => executeCommand("app.newWindow")
                },
                { item: "Separator" },
                {
                  id: "file.newFile",
                  text: "New",
                  accelerator: acceleratorForCommand("file.newFile"),
                  action: () => executeCommand("file.newFile")
                },
                { item: "Separator" },
                {
                  id: "file.openFile",
                  text: "Open...",
                  accelerator: acceleratorForCommand("file.openFile"),
                  action: () => executeCommand("file.openFile")
                },
                { item: "Separator" },
                {
                  id: "file.save",
                  text: "Save",
                  accelerator: acceleratorForCommand("file.save"),
                  action: () => executeCommand("file.save")
                },
                {
                  id: "file.saveAs",
                  text: "Save As...",
                  accelerator: acceleratorForCommand("file.saveAs"),
                  action: () => executeCommand("file.saveAs")
                },
                {
                  id: "file.close",
                  text: "Close",
                  accelerator: acceleratorForCommand("file.close"),
                  action: () => executeCommand("file.close")
                },
                {
                  id: "file.rename",
                  text: "Rename...",
                  action: () => executeCommand("file.rename")
                }
              ]
            },
            {
              id: "edit",
              text: "Edit",
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
                  text: "Find",
                  accelerator: acceleratorForCommand("edit.find"),
                  action: () => executeCommand("edit.find")
                },
                {
                  text: "Find Next",
                  accelerator: acceleratorForCommand("edit.findNext"),
                  action: () => executeCommand("edit.findNext")
                },
                {
                  text: "Find Previous",
                  accelerator: acceleratorForCommand("edit.findPrevious"),
                  action: () => executeCommand("edit.findPrevious")
                }
              ]
            },
            {
              id: "paragraph",
              text: "Paragraph",
              items: [
                {
                  text: "Paragraph",
                  action: () => executeCommand("format.paragraph")
                },
                { item: "Separator" },
                {
                  text: "Insert Table...",
                  accelerator: acceleratorForCommand("editor.insertTable"),
                  action: () => executeCommand("editor.insertTable")
                },
                {
                  text: "Insert Code Fence...",
                  action: () => executeCommand("editor.insertCodeFence")
                },
                {
                  text: "Math Block",
                  accelerator: acceleratorForCommand("format.mathBlock"),
                  action: () => executeCommand("format.mathBlock")
                },
                { item: "Separator" },
                {
                  text: "Heading 1",
                  accelerator: acceleratorForCommand("format.heading1"),
                  action: () => executeCommand("format.heading1")
                },
                {
                  text: "Heading 2",
                  accelerator: acceleratorForCommand("format.heading2"),
                  action: () => executeCommand("format.heading2")
                },
                {
                  text: "Heading 3",
                  accelerator: acceleratorForCommand("format.heading3"),
                  action: () => executeCommand("format.heading3")
                },
                {
                  text: "Heading 4",
                  accelerator: acceleratorForCommand("format.heading4"),
                  action: () => executeCommand("format.heading4")
                },
                {
                  text: "Heading 5",
                  accelerator: acceleratorForCommand("format.heading5"),
                  action: () => executeCommand("format.heading5")
                },
                {
                  text: "Heading 6",
                  accelerator: acceleratorForCommand("format.heading6"),
                  action: () => executeCommand("format.heading6")
                },
                { item: "Separator" },
                {
                  text: "Quote",
                  action: () => executeCommand("format.quote")
                },
                {
                  text: "Ordered List",
                  action: () => executeCommand("format.orderedList")
                },
                {
                  text: "Unordered List",
                  action: () => executeCommand("format.unorderedList")
                },
                {
                  text: "Task List",
                  action: () => executeCommand("format.taskList")
                }
              ]
            },
            {
              id: "format",
              text: "Format",
              items: [
                {
                  text: "Bold",
                  accelerator: acceleratorForCommand("format.bold"),
                  action: () => executeCommand("format.bold")
                },
                {
                  text: "Italic",
                  accelerator: acceleratorForCommand("format.italic"),
                  action: () => executeCommand("format.italic")
                },
                {
                  text: "Underline",
                  accelerator: acceleratorForCommand("format.underline"),
                  action: () => executeCommand("format.underline")
                },
                {
                  text: "Inline Code",
                  action: () => executeCommand("format.code")
                },
                {
                  text: "Link",
                  accelerator: acceleratorForCommand("format.link"),
                  action: () => executeCommand("format.link")
                },
                {
                  text: "Clear Format",
                  action: () => executeCommand("format.clearFormat")
                },
                { item: "Separator" },
                {
                  text: "Code Fence",
                  accelerator: acceleratorForCommand("format.codeFence"),
                  action: () => executeCommand("format.codeFence")
                },
                {
                  text: "Insert Image...",
                  accelerator: acceleratorForCommand("format.insertImage"),
                  action: () => executeCommand("format.insertImage")
                }
              ]
            },
            {
              id: "view",
              text: "View",
              items: [
                {
                  text: "Source Code Mode",
                  accelerator: acceleratorForCommand("view.sourceCode"),
                  action: () => executeCommand("view.sourceCode")
                },
                {
                  text: "Live Edit Mode",
                  action: () => executeCommand("view.liveEdit")
                },
                { item: "Separator" },
                {
                  text: "Split Mode",
                  accelerator: acceleratorForCommand("view.split"),
                  action: () => executeCommand("view.split")
                },
                {
                  text: "Preview Mode",
                  accelerator: acceleratorForCommand("view.preview"),
                  action: () => executeCommand("view.preview")
                },
                { item: "Separator" },
                {
                  text: "Toggle Sidebar",
                  accelerator: acceleratorForCommand("view.toggleSidebar"),
                  action: () => executeCommand("view.toggleSidebar")
                },
                {
                  text: "File Tree",
                  action: () => executeCommand("view.fileTree")
                },
                { item: "Separator" },
                {
                  text: "Actual Size",
                  accelerator: acceleratorForCommand("view.resetZoom"),
                  action: () => executeCommand("view.resetZoom", { commandSource: "menu" })
                },
                {
                  text: "Zoom In",
                  accelerator: acceleratorForCommand("view.zoomIn"),
                  action: () => executeCommand("view.zoomIn", { commandSource: "menu" })
                },
                {
                  text: "Zoom Out",
                  accelerator: acceleratorForCommand("view.zoomOut"),
                  action: () => executeCommand("view.zoomOut", { commandSource: "menu" })
                },
                { item: "Separator" },
                { item: "Fullscreen" }
              ]
            },
            {
              id: "themes",
              text: "Themes",
              items: [
                {
                  text: "Light",
                  action: () => executeCommand("theme.light")
                },
                {
                  text: "Dark",
                  action: () => executeCommand("theme.dark")
                }
              ]
            },
            {
              id: "repository",
              text: "Repository",
              items: repositoryMenuItems({
                executeCommand,
                repositoryAccount: state.repositoryAccount,
                repositoryBinding: state.repositoryBinding
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
  }, [executeCommand, state.repositoryAccount, state.repositoryBinding]);
}

function repositoryMenuItems(params: {
  executeCommand: ExecuteAppCommand;
  repositoryAccount: RepositoryAccount | null;
  repositoryBinding: RepositoryBinding | null;
}) {
  const { executeCommand, repositoryAccount, repositoryBinding } = params;
  const separator = { item: "Separator" as const };

  if (!repositoryAccount) {
    return [
      {
        text: "Connect GitHub...",
        action: () => executeCommand("repository.connectGithub")
      },
      separator,
      {
        text: "View Sync Status",
        action: () => executeCommand("repository.viewSyncStatus")
      },
      {
        text: "Reveal Repository in Finder",
        action: () => executeCommand("file.revealInFinder")
      }
    ];
  }

  const connectedItems = [
    { text: `Connected as ${repositoryAccount.login}`, enabled: false },
    {
      text: "Disconnect GitHub",
      action: () => executeCommand("repository.disconnectGithub")
    },
    separator,
    {
      text: "Link Current Workspace to GitHub Repository...",
      action: () => executeCommand("repository.linkWorkspace")
    }
  ];

  if (!repositoryBinding) {
    return [
      ...connectedItems,
      {
        text: "View Sync Status",
        action: () => executeCommand("repository.viewSyncStatus")
      },
      {
        text: "Reveal Repository in Finder",
        action: () => executeCommand("file.revealInFinder")
      }
    ];
  }

  return [
    ...connectedItems,
    { text: "Repository Settings...", action: () => executeCommand("repository.linkWorkspace") },
    separator,
    {
      text: "Push Workspace",
      action: () => executeCommand("repository.pushWorkspace")
    },
    {
      text: "Pull from Repository",
      action: () => executeCommand("repository.pullWorkspace")
    },
    {
      text: "Sync Now",
      action: () => executeCommand("repository.syncNow")
    },
    separator,
    {
      text: "View Sync Status",
      action: () => executeCommand("repository.viewSyncStatus")
    },
    {
      text: "Reveal Repository in Finder",
      action: () => executeCommand("file.revealInFinder")
    }
  ];
}
