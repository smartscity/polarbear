# Polarbear（北极熊）

[English](README.md) | [简体中文](README-zh.md)

> 一个本地优先、面向写作者与开发者的 Markdown 编辑器和知识工作台。

> Current status, 2026-10-14: see the [v0.9.3 verification record](docs/releases/v0.9.3.md)
> and [documentation index](docs/README.md). Desktop now bundles offline Bergamot
> translation; iPhone has a separate experimental reader and native reading tools.
> Release and both quality workflows passed for `66eec710`. The release is an
> intentional draft with DMG/EXE assets; installed-device and Lark/Word mixed-paste
> acceptance still have no recorded pass. New corrections are in English under the
> repository language policy; existing localized overview content is retained.

Polarbear 使用 Rust、Tauri、React 和 TypeScript 构建，专注于流畅写作、实时预览、Mermaid/PlantUML 图表以及 GitHub/GitLab 云同步。

当前平台状态：

- macOS 桌面应用：支持，CI 会构建安装包
- Windows 桌面应用：发布流程会构建安装包
- iPhone: a separate experimental Tauri/React reader exists in `apps/ios`; physical-device/provider acceptance and signed distribution remain separate gates

---

## 为什么选择 Polarbear？

Polarbear 面向技术文档、工程笔记、产品规格、架构图和代码仓库知识库等场景。它希望提供一个清爽、本地优先的写作环境：

- Rust 与 Tauri 提供的原生桌面体验
- Markdown 源码编辑、实时编辑和只读预览
- Mermaid 与 PlantUML 图表渲染
- SVG、PNG 图表导出
- GitHub 与 GitLab 工作区同步
- 清晰、可长期维护的模块边界

本地写作，清晰预览，需要时再同步到云端。

---

## 功能

### Markdown 编辑

- 打开和保存本地 Markdown 文件
- 文件夹工作区与文件树
- 多标签页
- 源码模式、实时编辑、分屏和预览模式
- 未保存状态提示与关闭确认
- 表格、代码块、任务列表、公式和图片

### 图表

- Mermaid fenced code block 渲染
- PlantUML fenced code block 渲染
- Flowchart、State、ER、Gantt、Pie 等 Mermaid 图表
- 图表源码查看
- SVG 与 PNG 导出
- 深色/浅色主题下保持可读配色

### 云同步

- 使用个人访问令牌连接 GitHub 或 GitLab
- 将本地工作区关联到仓库和远端目录
- 上传本地新增、修改与删除
- 下载远端变化
- 基于 commit SHA 的增量检查
- 同步冲突提示
- 后台进度显示，不阻塞编辑器

Polarbear 使用服务商 REST API 完成同步，不要求用户安装或学习本地 Git 命令。

### Reading and rich-copy status

- Desktop English-to-Chinese translation bundles verified Bergamot/model assets; no Apple language pack, first-run download or cloud fallback is required.
- Vocab owns dictionary senses/IPA and vocabulary membership; macOS favorites use a durable delivery queue. Neural output can mistranslate acronyms such as OEMS.
- The iPhone reader uses its own installed-only Apple translation path, speech, dictionary and explicit capture-file handoff.
- Whole-document copy provides rich content and readable text; use Copy Markdown Source for raw Markdown. Native receiver checks do not establish Lark/Word mixed-paste compatibility.

See [Desktop reading](docs/planning/desktop-vocab-reading.md),
[iPhone reading](docs/planning/iphone-reading-assistant.md) and
[rich document copy](docs/planning/desktop-rich-document-copy.md).

### 扩展边界

Mermaid、PlantUML、云同步和导出目前都是内置 Feature。Polarbear 暂不提供运行时插件 API；只有在权限、版本化协议与沙箱边界明确后才会考虑插件系统。

---

## 技术栈

- Rust
- Tauri v2
- React
- TypeScript
- Vite
- CodeMirror 6
- Mermaid
- GitHub / GitLab REST API

---

## 项目结构

```text
polarbear/
  Cargo.toml
  Cargo.lock
  package.json
  package-lock.json
  README.md
  README-zh.md
  ARCHITECTURE.md
  apps/
    desktop/
      package.json
      src/
        app/          # 应用布局和组合
        commands/     # 命令注册、菜单与快捷键
        features/     # Editor、Workspace、Diagram、Sync 等功能
        shared/       # i18n、设置、事件、常量与 Tauri 边界
      src-tauri/
        Cargo.toml
        src/
```

`apps/desktop/src-tauri` is the only member of the root Cargo workspace.
`apps/ios/src-tauri` owns a separate Cargo workspace and reader plugin.
`packages/reader-core` contains portable reader logic; `packages/apple-document-store`
contains a native linked-document foundation whose user-facing editing/sync
integration is not yet delivered. Root npm scripts target Desktop; use explicit
`apps/ios` workspace scripts for the reader.

---

## 架构原则

- 本地优先
- Feature-based 前端模块
- 稳定、类型化的 Tauri IPC 边界
- UI、业务流程和原生 IO 分离
- 用户设置经过版本校验和迁移
- 命令 ID、菜单和快捷键使用同一注册表
- Token 不进入 WebView 日志或普通配置文件
- macOS 专用代码隔离在平台模块中
- 不为目录形式机械创建空层级

详细设计见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 开发

### 环境要求

- Rust stable
- Node.js LTS
- npm
- macOS 上的 Tauri v2 构建依赖
- Native iPhone development requires Xcode and local project generation; see [the reader guide](apps/ios/README.md)

### 安装依赖

```bash
npm ci
```

### 启动 macOS 开发环境

```bash
npm run tauri:dev
```

或：

```bash
npm --workspace apps/desktop run tauri -- dev
```

`tauri:dev` 是仓库根目录的脚本；`apps/desktop/package.json` 中不存在同名脚本，直接使用 workspace 时必须写成上面的 `run tauri -- dev`。

For iPhone, use the separate workspace rather than Desktop's Tauri script:

```bash
npm --workspace apps/ios run dev
npm --workspace apps/ios run ios:init -- --ci
npm --workspace apps/ios run ios:dev
```

The reader preview uses port 1430. Generated Xcode files and signing credentials
are local outputs; browser/simulator checks do not establish signed-device acceptance.
See [the reader guide](apps/ios/README.md) for full checks and limitations.

### 前端检查

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For translation integrity, production Chromium/WebKit inference and clipboard
checks, use the additional commands in the maintained [English development guide](README.md#run-frontend-checks).

### Rust 检查

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
```

### 构建 macOS 安装包

```bash
npm run tauri:build
```

产物通常位于：

```text
target/release/bundle/
```

---

## Release status

Desktop `v*` tags or an explicit existing release tag supplied through manual dispatch
build the macOS universal DMG and Windows x64 NSIS installer. The workflow intentionally
creates a draft release. `ios-v*` milestones use a separate quality channel. Build-local
versions are derived from the selected tag; this documentation correction does not
bump manifest versions, rebuild installers or move tags.

## 云同步令牌安全

- 不在普通配置文件中明文保存 Token
- 不在日志中输出 Token
- Release 构建必须使用系统 Keychain
- 明文 fallback 仅允许在 debug 构建中使用
- 前端只接收账号与仓库元数据，不读取 Token

---

## 路线图

### 当前阶段

- 本地 Markdown 打开、编辑与保存
- 实时编辑和图表预览
- Mermaid / PlantUML 导出
- GitHub / GitLab 增量同步
- macOS 桌面应用

### 下一阶段

- Complete physical-iPhone/provider acceptance and signed distribution for the existing reader
- Record installed Desktop/Tauri WebView and Lark/Word mixed-paste acceptance
- Integrate linked editing before claiming cross-device iCloud synchronization
- PDF / HTML 完整文档导出
- 扩充原生命令和发布打包的集成测试
- 更完善的跨平台适配

### 未来

- AI 辅助写作
- Knowledge / MCP 集成
- 团队知识库与发布能力

---

## License

Cargo 清单当前声明 `MIT OR Apache-2.0`，但仓库在正式分发前仍需补齐对应的许可证正文文件。

Bundled translation assets have separate included third-party notices; those do not
replace the missing root project license texts. See [the asset notice](apps/desktop/public/models/en-zh/README.md).
