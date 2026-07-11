import type { AppCommandId } from "./appCommandIds";

export type AppCommand = AppCommandId;

export type AppCommandPayload = {
  commandSource?: "menu" | "shortcut";
  sourcePath?: string;
  targetParentPath?: string | null;
  targetPath?: string;
  workspaceCreate?: boolean;
};

export type ExecuteAppCommand = (
  command: AppCommand,
  payload?: AppCommandPayload
) => void;
