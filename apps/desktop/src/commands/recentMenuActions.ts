import type { Translate } from "../shared/i18n/I18nProvider";
import { RECENT_DOCUMENT_LIMIT } from "../features/workspace/recentDocuments";
import type { RecentDocumentMenuState } from "../features/workspace/useRecentDocumentMenu";
import { fileNameOf } from "../features/workspace/workspacePaths";

/** Two bounded ID banks keep a pending rebuild from retargeting the visible native menu. */
export class RecentMenuActions {
  private active: { bank: number; token: symbol } | null = null;

  prepare(state: RecentDocumentMenuState, t: Translate) {
    const bank = this.active?.bank === 0 ? 1 : 0;
    const token = Symbol();
    const entries = state.entries.slice(0, RECENT_DOCUMENT_LIMIT);
    const names = entries.map((entry) => fileNameOf(entry.path));
    const items = entries.length ? entries.map((entry, index) => ({
      id: `file.recent.${bank}.${index}`,
      text: names.filter((name) => name === names[index]).length > 1
        ? `${names[index]} — ${entry.path.slice(0, entry.path.lastIndexOf("/")) || "/"}`
        : names[index],
      enabled: !state.busy,
      action: () => {
        if (this.active?.token === token) state.open(entry.path);
      },
    })) : [{ id: "file.recent.empty", text: t("recent.empty"), enabled: false }];
    return {
      submenu: {
        id: "file.openRecent",
        text: t("recent.title"),
        items: [...items, { item: "Separator" as const }, {
          id: "file.clearRecent", text: t("recent.clear"), enabled: entries.length > 0 && !state.busy,
          action: state.clear,
        }],
      },
      activate: () => { this.active = { bank, token }; },
    };
  }
}
