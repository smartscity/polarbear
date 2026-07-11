import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type AppLanguage = "en" | "zh-CN";

type I18nContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const STORAGE_KEY = "polarbear-language";

const messages: Record<AppLanguage, Record<string, string>> = {
  en: {
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.connect": "Connect",
    "common.create": "Create",
    "common.insert": "Insert",
    "common.ok": "OK",
    "common.sync": "Sync",
    "menu.about": "About Polarbear",
    "menu.quit": "Quit",
    "menu.file": "File",
    "menu.edit": "Edit",
    "menu.paragraph": "Paragraph",
    "menu.format": "Format",
    "menu.view": "View",
    "menu.themes": "Themes",
    "menu.cloudSync": "Cloud Sync",
    "menu.newWindow": "New Window",
    "menu.new": "New",
    "menu.open": "Open...",
    "menu.save": "Save",
    "menu.saveAs": "Save As...",
    "menu.close": "Close",
    "menu.rename": "Rename...",
    "menu.find": "Find",
    "menu.findNext": "Find Next",
    "menu.findPrevious": "Find Previous",
    "menu.insertTable": "Insert Table...",
    "menu.insertCodeFence": "Insert Code Fence...",
    "menu.mathBlock": "Math Block",
    "menu.heading": "Heading {level}",
    "menu.quote": "Quote",
    "menu.orderedList": "Ordered List",
    "menu.unorderedList": "Unordered List",
    "menu.taskList": "Task List",
    "menu.bold": "Bold",
    "menu.italic": "Italic",
    "menu.underline": "Underline",
    "menu.inlineCode": "Inline Code",
    "menu.link": "Link",
    "menu.clearFormat": "Clear Format",
    "menu.codeFence": "Code Fence",
    "menu.insertImage": "Insert Image...",
    "menu.sourceMode": "Source Code Mode",
    "menu.liveMode": "Live Edit Mode",
    "menu.splitMode": "Split Mode",
    "menu.previewMode": "Preview Mode",
    "menu.toggleSidebar": "Toggle Sidebar",
    "menu.fileTree": "File Tree",
    "menu.actualSize": "Actual Size",
    "menu.zoomIn": "Zoom In",
    "menu.zoomOut": "Zoom Out",
    "menu.light": "Light",
    "menu.dark": "Dark",
    "cloud.connect": "Connect Cloud Sync...",
    "cloud.updateToken": "Update Cloud Sync Token...",
    "cloud.disconnect": "Disconnect Cloud Sync",
    "cloud.settings": "Sync Settings...",
    "cloud.syncNow": "Sync Now",
    "cloud.connectedAs": "Connected to {provider} as {account}",
    "tree.files": "FILES",
    "tree.openFolder": "OPEN A FOLDER",
    "tree.newFile": "New File",
    "tree.newFolder": "New Folder",
    "tree.rename": "Rename",
    "tree.duplicate": "Duplicate",
    "tree.deleteFile": "Delete File",
    "tree.deleteFolder": "Delete Folder",
    "tree.refresh": "Refresh",
    "tree.collapseAll": "Collapse All",
    "tree.reveal": "Reveal in Finder",
    "tree.copyWorkspacePath": "Copy Workspace Path",
    "tree.copyFolderPath": "Copy Folder Path",
    "tree.copyFilePath": "Copy File Path",
    "status.saved": "Saved",
    "status.unsaved": "Unsaved",
    "status.characters": "{count} characters",
    "status.syncNow": "Sync now",
    "status.language": "Language",
    "top.openFiles": "Open files",
    "top.untitled": "Untitled",
    "top.newTab": "New tab",
    "top.closeTab": "Close {name}",
    "top.viewToggles": "View toggles",
    "top.structure": "Document Structure",
    "top.fileTree": "File Tree",
    "structure.title": "STRUCTURE",
    "structure.label": "Document structure",
    "structure.empty": "No headings",
    "sidebar.close": "Close sidebar",
    "tree.emptyTitle": "No Markdown files yet",
    "tree.emptyHint": "Use File / New File to start this workspace.",
    "tree.unsavedChanges": "Unsaved changes",
    "editor.insertCodeTitle": "Insert Code Fence",
    "editor.insertCodeDescription": "Choose a language for the fenced code block.",
    "editor.language": "Language",
    "editor.insertTableTitle": "Insert Table",
    "editor.insertTableDescription": "Rows are body rows and do not include the header.",
    "editor.columns": "Columns",
    "editor.rows": "Rows",
    "empty.startDescription": "A local-first Markdown editor. Open a folder to start writing with your local Markdown files.",
    "empty.startHint": "Use File / Open... or File / New.",
    "empty.workspaceTitle": "This workspace has no Markdown files.",
    "empty.workspaceHint": "Use the File menu or right-click the file tree to create one.",
    "about.version": "Version 0.1.0",
    "about.tagline": "a minimal Markdown editor and reader",
    "cloud.connectTitle": "Connect Cloud Sync",
    "cloud.connectDescription": "Connect GitHub or GitLab with a personal access token.",
    "cloud.githubRepositoryAccess": "Repository access: select at least one repository",
    "cloud.githubContentsPermission": "Repository permissions → Contents: Read and write",
    "cloud.githubMetadataPermission": "Metadata: Read",
    "cloud.gitlabTokenScope": "Token scope: api",
    "cloud.gitlabProjectRole": "Project role must allow repository writes",
    "cloud.provider": "Provider",
    "cloud.token": "{provider} token",
    "cloud.settingsTitle": "Cloud Sync Settings",
    "cloud.account": "Account",
    "cloud.repository": "Repository",
    "cloud.branch": "Branch",
    "cloud.remoteFolder": "Remote Folder",
    "cloud.lastSync": "Last Sync",
    "cloud.localChanges": "Local Changes",
    "cloud.remoteChanged": "Remote Changed",
    "cloud.conflicts": "Conflicts",
    "cloud.yes": "Yes",
    "cloud.no": "No",
    "cloud.notLinked": "Not linked",
    "cloud.notConnected": "Not connected",
    "cloud.loadingRepositories": "Loading repositories...",
    "cloud.noRepositories": "No repositories are available for this account.",
    "cloud.saveSettings": "Save Settings",
    "cloud.statusTitle": "Cloud Sync Status",
    "create.fileTitle": "Create Markdown file",
    "create.folderTitle": "Create folder",
    "create.fileDescription": "Create a .md file in the current workspace.",
    "create.folderDescription": "Create a directory in the current workspace.",
    "create.name": "Name"
  },
  "zh-CN": {
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.connect": "连接",
    "common.create": "创建",
    "common.insert": "插入",
    "common.ok": "确定",
    "common.sync": "同步",
    "menu.about": "关于 Polarbear",
    "menu.quit": "退出",
    "menu.file": "文件",
    "menu.edit": "编辑",
    "menu.paragraph": "段落",
    "menu.format": "格式",
    "menu.view": "视图",
    "menu.themes": "主题",
    "menu.cloudSync": "云同步",
    "menu.newWindow": "新建窗口",
    "menu.new": "新建",
    "menu.open": "打开...",
    "menu.save": "保存",
    "menu.saveAs": "另存为...",
    "menu.close": "关闭",
    "menu.rename": "重命名...",
    "menu.find": "查找",
    "menu.findNext": "查找下一个",
    "menu.findPrevious": "查找上一个",
    "menu.insertTable": "插入表格...",
    "menu.insertCodeFence": "插入代码块...",
    "menu.mathBlock": "数学公式块",
    "menu.heading": "{level} 级标题",
    "menu.quote": "引用",
    "menu.orderedList": "有序列表",
    "menu.unorderedList": "无序列表",
    "menu.taskList": "任务列表",
    "menu.bold": "加粗",
    "menu.italic": "斜体",
    "menu.underline": "下划线",
    "menu.inlineCode": "行内代码",
    "menu.link": "链接",
    "menu.clearFormat": "清除格式",
    "menu.codeFence": "代码块",
    "menu.insertImage": "插入图片...",
    "menu.sourceMode": "源码模式",
    "menu.liveMode": "实时编辑模式",
    "menu.splitMode": "分屏模式",
    "menu.previewMode": "预览模式",
    "menu.toggleSidebar": "切换侧边栏",
    "menu.fileTree": "文件树",
    "menu.actualSize": "实际大小",
    "menu.zoomIn": "放大",
    "menu.zoomOut": "缩小",
    "menu.light": "浅色",
    "menu.dark": "深色",
    "cloud.connect": "连接云同步...",
    "cloud.updateToken": "更新云同步令牌...",
    "cloud.disconnect": "断开云同步",
    "cloud.settings": "同步设置...",
    "cloud.syncNow": "立即同步",
    "cloud.connectedAs": "已连接 {provider} 账号 {account}",
    "tree.files": "文件",
    "tree.openFolder": "打开文件夹",
    "tree.newFile": "新建文件",
    "tree.newFolder": "新建文件夹",
    "tree.rename": "重命名",
    "tree.duplicate": "创建副本",
    "tree.deleteFile": "删除文件",
    "tree.deleteFolder": "删除文件夹",
    "tree.refresh": "刷新",
    "tree.collapseAll": "全部折叠",
    "tree.reveal": "在访达中显示",
    "tree.copyWorkspacePath": "复制工作区路径",
    "tree.copyFolderPath": "复制文件夹路径",
    "tree.copyFilePath": "复制文件路径",
    "status.saved": "已保存",
    "status.unsaved": "未保存",
    "status.characters": "{count} 个字符",
    "status.syncNow": "立即同步",
    "status.language": "语言",
    "top.openFiles": "已打开文件",
    "top.untitled": "未命名",
    "top.newTab": "新建标签页",
    "top.closeTab": "关闭 {name}",
    "top.viewToggles": "视图开关",
    "top.structure": "文档结构",
    "top.fileTree": "文件树",
    "structure.title": "文档结构",
    "structure.label": "文档结构",
    "structure.empty": "暂无标题",
    "sidebar.close": "关闭侧边栏",
    "tree.emptyTitle": "暂无 Markdown 文件",
    "tree.emptyHint": "使用 文件 / 新建文件 开始编辑。",
    "tree.unsavedChanges": "未保存的更改",
    "editor.insertCodeTitle": "插入代码块",
    "editor.insertCodeDescription": "选择代码块使用的语言。",
    "editor.language": "语言",
    "editor.insertTableTitle": "插入表格",
    "editor.insertTableDescription": "行数仅包含正文行，不包含表头。",
    "editor.columns": "列数",
    "editor.rows": "行数",
    "empty.startDescription": "本地优先的 Markdown 编辑器。打开文件夹即可开始编辑本地 Markdown 文件。",
    "empty.startHint": "使用 文件 / 打开... 或 文件 / 新建。",
    "empty.workspaceTitle": "当前工作区没有 Markdown 文件。",
    "empty.workspaceHint": "使用文件菜单或右键文件树创建文件。",
    "about.version": "版本 0.1.0",
    "about.tagline": "简洁的 Markdown 编辑器与阅读器",
    "cloud.connectTitle": "连接云同步",
    "cloud.connectDescription": "使用个人访问令牌连接 GitHub 或 GitLab。",
    "cloud.githubRepositoryAccess": "仓库访问：至少选择一个仓库",
    "cloud.githubContentsPermission": "仓库权限 → Contents：读写",
    "cloud.githubMetadataPermission": "Metadata：只读",
    "cloud.gitlabTokenScope": "令牌权限：api",
    "cloud.gitlabProjectRole": "项目角色必须允许写入仓库",
    "cloud.provider": "服务商",
    "cloud.token": "{provider} 令牌",
    "cloud.settingsTitle": "云同步设置",
    "cloud.account": "账号",
    "cloud.repository": "仓库",
    "cloud.branch": "分支",
    "cloud.remoteFolder": "远端文件夹",
    "cloud.lastSync": "上次同步",
    "cloud.localChanges": "本地变化",
    "cloud.remoteChanged": "远端有变化",
    "cloud.conflicts": "冲突",
    "cloud.yes": "是",
    "cloud.no": "否",
    "cloud.notLinked": "未关联",
    "cloud.notConnected": "未连接",
    "cloud.loadingRepositories": "正在加载仓库...",
    "cloud.noRepositories": "该账号没有可用仓库。",
    "cloud.saveSettings": "保存设置",
    "cloud.statusTitle": "云同步状态",
    "create.fileTitle": "新建 Markdown 文件",
    "create.folderTitle": "新建文件夹",
    "create.fileDescription": "在当前工作区创建 .md 文件。",
    "create.folderDescription": "在当前工作区创建文件夹。",
    "create.name": "名称"
  }
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLanguage(): AppLanguage {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh-CN") {
      return stored;
    }
  } catch {
    // Storage can be unavailable in hardened WebViews; system language still works.
  }

  const systemLanguages = navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
  return systemLanguages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    } catch {
      // Keep the active session switch working even if persistence is blocked.
    }
    setLanguageState(nextLanguage);
  }, []);
  const t = useCallback(
    (key: string, values: Record<string, string | number> = {}) => {
      let message = messages[language][key] ?? messages.en[key] ?? key;
      Object.entries(values).forEach(([name, value]) => {
        message = message.replaceAll(`{${name}}`, String(value));
      });
      return message;
    },
    [language]
  );
  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
