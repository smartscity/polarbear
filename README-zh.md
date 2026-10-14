# Polarbear（北极熊）

[英文](README.md) | [简体中文](README-zh.md)

> 一个本地优先、面向写作者与开发者的 Markdown 编辑器和知识工作台。

> 当前状态（2026-10-14）：参见 [v0.9.3 验证记录](docs/releases/v0.9.3.md)
> 和[文档索引](docs/README.md)。桌面端现已内置 Bergamot 离线翻译；iPhone 具有独立的
> 实验性阅读器和原生阅读工具。`66eec710` 的发布流程及两项质量检查流程均已通过。
> 发布流程按设计保留草稿状态，其中已包含 DMG/EXE 安装包；实际安装后的设备验收，
> 以及 Lark/Word 图文混合粘贴验收，目前仍没有通过记录。缺少记录不代表无人执行过检查。

Polarbear 使用 Rust、Tauri、React 和 TypeScript 构建，专注于流畅写作、实时预览、Mermaid/PlantUML 图表以及 GitHub/GitLab 云同步。

当前平台状态：

- macOS 桌面应用：支持，CI 会构建安装包
- Windows 桌面应用：发布流程会构建安装包
- iPhone：`apps/ios` 中已有独立的实验性 Tauri/React 阅读器；真机、文件提供方和签名分发仍需单独验收

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

- Mermaid 围栏代码块渲染
- PlantUML 围栏代码块渲染
- 流程图、状态图、实体关系图、甘特图、饼图等 Mermaid 图表
- 图表源码查看
- SVG 与 PNG 导出
- 深色/浅色主题下保持可读配色

### 云同步

- 使用个人访问令牌连接 GitHub 或 GitLab
- 将本地工作区关联到仓库和远端目录
- 上传本地新增、修改与删除
- 下载远端变化
- 基于提交 SHA 的增量检查
- 同步冲突提示
- 后台进度显示，不阻塞编辑器

Polarbear 使用服务商 REST API 完成同步，不要求用户安装或学习本地 Git 命令。

### 阅读与富文本复制

- 桌面端英译中功能内置经过验证的 Bergamot 引擎和模型资源，无需 Apple 语言包、首次启动下载或云端回退。
- Vocab 负责词典释义、国际音标和词汇收藏状态；macOS 收藏通过持久化队列投递。神经翻译可能误译 OEMS 等缩写。
- iPhone 阅读器使用独立的 Apple 翻译路径，仅调用已安装模型，并提供朗读、系统词典和需用户明确操作的采集文件交接。
- 整篇复制提供富文本内容和可读纯文本；需要原始 Markdown 时使用“复制 Markdown 源码”。原生接收端检查不能证明 Lark/Word 支持图文混合粘贴。

详见[桌面端阅读](docs/planning/desktop-vocab-reading.md)、
[iPhone 阅读](docs/planning/iphone-reading-assistant.md)和
[富文档复制](docs/planning/desktop-rich-document-copy.md)。

### 扩展边界

Mermaid、PlantUML、云同步和导出目前都是内置功能。Polarbear 暂不提供运行时插件 API；只有在权限、版本化协议与沙箱边界明确后才会考虑插件系统。

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
        features/     # 编辑器、工作区、图表、同步等功能
        shared/       # 国际化、设置、事件、常量与 Tauri 边界
      src-tauri/
        Cargo.toml
        src/
```

`apps/desktop/src-tauri` 是根 Cargo 工作区的唯一成员。
`apps/ios/src-tauri` 拥有独立的 Cargo 工作区和阅读器插件。
`packages/reader-core` 包含可移植的阅读器逻辑；`packages/apple-document-store`
包含原生关联文档基础能力，但尚未接入面向用户的编辑与同步流程。
根目录 npm 脚本面向桌面端；开发阅读器时需明确使用 `apps/ios` 工作区脚本。

---

## 架构原则

- 本地优先
- 按功能组织前端模块
- 稳定、类型化的 Tauri IPC 边界
- 界面、业务流程和原生输入输出分离
- 用户设置经过版本校验和迁移
- 命令 ID、菜单和快捷键使用同一注册表
- 令牌不进入 WebView 日志或普通配置文件
- macOS 专用代码隔离在平台模块中
- 不为目录形式机械创建空层级

详细设计见[架构文档](ARCHITECTURE.md)。

---

## 开发

### 环境要求

- Rust 稳定版
- Node.js 长期支持版
- npm
- macOS 上的 Tauri v2 构建依赖
- iPhone 原生开发需要 Xcode，并在本地生成工程；详见[阅读器指南](apps/ios/README.md)

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

`tauri:dev` 是仓库根目录的脚本；`apps/desktop/package.json` 中不存在同名脚本，直接使用工作区命令时必须写成上面的 `run tauri -- dev`。

开发 iPhone 阅读器时，使用独立工作区，不要调用桌面端的 Tauri 脚本：

```bash
npm --workspace apps/ios run dev
npm --workspace apps/ios run ios:init -- --ci
npm --workspace apps/ios run ios:dev
```

阅读器预览使用 1430 端口。生成的 Xcode 工程文件和签名凭据保留在本地；
浏览器或模拟器检查不能替代签名应用的真机验收。
完整检查方法与限制见[阅读器指南](apps/ios/README.md)。

### 前端检查

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

翻译资源完整性、生产环境 Chromium/WebKit 推理和剪贴板检查，
请使用[英文开发指南](README.md#run-frontend-checks)中的补充命令。

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

## 发布状态

桌面端 `v*` 标签，或手动触发时明确指定的现有发布标签，会生成 macOS 通用 DMG
和 Windows x64 NSIS 安装包。工作流按设计创建发布草稿。
`ios-v*` 里程碑使用独立的质量检查流程。构建环境中的版本来自所选标签；
此次文档修订不提升清单版本、不重新构建安装包，也不移动标签。

## 云同步令牌安全

- 不在普通配置文件中明文保存令牌
- 不在日志中输出令牌
- 发布构建必须使用系统钥匙串
- 明文存储回退仅允许在调试构建中使用
- 前端只接收账号与仓库元数据，不读取令牌

---

## 路线图

### 当前阶段

- 本地 Markdown 打开、编辑与保存
- 实时编辑和图表预览
- Mermaid / PlantUML 导出
- GitHub / GitLab 增量同步
- macOS 桌面应用

### 下一阶段

- 完成现有阅读器的 iPhone 真机、文件提供方验收及签名分发
- 补充实际安装后的桌面端/Tauri WebView 验收，以及 Lark/Word 图文混合粘贴验收记录
- 接入关联文档编辑后，再提供跨设备 iCloud 同步能力
- PDF / HTML 完整文档导出
- 扩充原生命令和发布打包的集成测试
- 更完善的跨平台适配

### 未来

- AI 辅助写作
- 知识管理与 MCP 集成
- 团队知识库与发布能力

---

## 许可证

Cargo 清单当前声明 `MIT OR Apache-2.0`，但仓库在正式分发前仍需补齐对应的许可证正文文件。

内置翻译资源另附第三方许可声明，不能替代尚未补齐的项目根许可证正文。
详见[资源许可说明](apps/desktop/public/models/en-zh/README.md)。
