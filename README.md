# 个人工作站

任务清单 × 文档工作站的一体化个人工作台。本地优先、数据不出本机、单人不设账号。

> 依据《产品方案》（`docs/产品方案.html`）落地。当前版本 **v0.9.0（任务清单 / 文档工作站 / ⌘K / 截图批注 / 多标签 / MD 编辑器）**。
> 提供 **安卓 App**（Capacitor 封装，完全离线、无需服务器）与 **网页版 PWA** 两种形态。最新 APK 在 [Releases](../../releases) 页下载。

## 快速开始（网页版）

**在线版（推荐，无需安装）**：<https://ajie203b.github.io/personal-workstation-site/>
任何电脑打开即用；数据存在各自浏览器的 IndexedDB，GitHub 不存储任何用户数据。更新部署：`bash scripts/deploy-site.sh`。

本地开发：

```bash
npm install
npm run dev        # 开发：http://localhost:5173
npm run build      # 产出 dist/ + PWA（Service Worker 自动生成）
npm run preview    # 生产预览：http://localhost:4173
```

## 安卓 App（推荐方式）

Web 应用通过 Capacitor 封装为原生安卓应用：所有资源内嵌 APK，安装即用、完全离线、不依赖任何服务器。工程位于 `android/`。

### 一次性构建出 APK

```bash
npm run build            # 先构建 Web 资源
npx cap sync android     # 同步到安卓工程（web 资源变化后重新执行）
```

然后任选其一：

**方式 A · Android Studio（推荐日常使用）**

用 Android Studio 打开 `android/` 目录 → `Build > Build App Bundle(s) / APK(s) > Build APK(s)` → 产物在 `android/app/build/outputs/apk/`。

**方式 B · 命令行**

```bash
cd android
./gradlew assembleDebug      # 调试包 app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease    # 签名正式包 app/build/outputs/apk/release/app-release.apk
```

> **环境要求**：Gradle 构建需要 **JDK 21**（本机已装在 `%LOCALAPPDATA%\jdk-21`，构建时设置 `JAVA_HOME` 指向它即可）。Android Studio 用户：`Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK` 选 JDK 21。SDK 位置写在 `android/local.properties`。

**本机当前产物**（已生成，直接取用）：

- `apk/personal-workstation-v0.8.1.apk` —— 正式签名包（6.4MB，安装这个）

### 安装到手机 / 平板

把 APK 传到手机（数据线 / 网盘 / 微信文件传输均可）→ 点击安装（允许「未知来源」）→ 桌面出现「个人工作站」图标，全屏独立运行。

- 首次构建的签名 keystore：`android/app/workstation.keystore`（别名 `workstation`，密码 `workstation2026`）。**换手机重装、后续升级都用同一个 keystore 签名**，否则需要先卸载旧版（会丢数据，记得先在设置里导出备份）。
- 应用数据（任务等）保存在应用沙箱的 IndexedDB 中，卸载即清除；重要节点先到「设置 → 数据 → 导出备份」。
- 连接 USB 后也可直接 `adb install app-debug.apk`。

### 日常改动流程

```bash
# 改完 src/ 里的代码后：
npm run build && npx cap sync android
# 再用 Android Studio / gradlew 出包
```

## 网页版 PWA（备用形态）

同一套代码也是标准 PWA：部署 `dist/` 到任意静态托管（HTTPS）后，浏览器访问 →「安装应用」。局域网临时使用可 `npm run preview:lan`。

功能自适应三种屏幕形态：

- **桌面 ≥1024px**：完整侧栏（可折叠）
- **平板 / 窄窗口 768–1023px**：图标栏侧栏
- **手机 <768px**：顶栏（状态栏安全区适配）+ 底部标签导航；**左上角应用图标 = 设置入口**

## 功能（M1 · 任务清单）

- **四清单时间语义**（Things 3 式）：今日 / 近期 / 随时 / 将来，完成自动入「日志」归档
- **四档优先级**：P0 红 · P1 橙 · P2 蓝 · P3 灰，列表左色条 + 标签；绿色保留给状态（进行中/已完成）
- **自然语言录入**：`明天14:00 交报告 P1 #工作` 自动解析日期/时间/优先级/标签/重复
- **打卡 / 重复任务**：描述里写「每天」「每周」自动识别；分辨不出时手动选单次/重复与频率；完成后自动生成下一次（连续打卡）
- **今日页**：日期行右侧加号添加（弹抽屉按上述流程走），任务 + 进度 KPI + 最近阅读
- **同数据多视图**：列表 / 看板（跨列拖拽改清单）
- **任务详情**：标题、笔记、清单、优先级、截止日期时间、标签、子任务，点任务卡任意位置以居中弹窗打开；完成只由左侧勾选框触发，误勾可在 toast 里撤销
- **全键盘流**：`N` 或 `/` 快速添加、`↑↓/J K` 选择、`空格/X` 勾选、`Enter` 详情、`?` 帮助
- **数据安全**：IndexedDB 本地持久化；设置页可导出/导入 JSON 备份（含文档库）、清空数据

## 功能（M2 · 文档工作站）

- **导入**：PDF / Markdown / TXT，按内容指纹（SHA-256）去重，文件本体存 IndexedDB
- **三栏工作区**：左侧目录+高亮+书签 · 中央阅读画布 · 右侧批注+反链（手机为抽屉）
- **双坐标位置记忆**（Readwise Reader 模式）：瞬时滚动位置与深度阅读进度分开记录，快速翻页不污染进度；**关掉重开自动回到上次阅读位置**并提示
- **批注三件套**：划词四色高亮（黄/绿/蓝/红）+ 侧栏评论 + 一键转任务（自动携带文档深链与摘录）；PDF 高亮以归一化矩形锚定，MD 以块+文本锚定
- **沉浸排版**：日间/夜间/羊皮纸/暮色四主题，字号/行距/页宽**按文档记忆**；PDF 夜间自动反色（不破坏图像层次）
- **目录导航**：PDF 大纲（书签）解析跳页；Markdown 按块解析标题目录；用户书签
- **反向链接**：「哪些任务引用了本文档」可逆查询，点击跳转任务
- **互跳**：任务卡上的文档引用可点击直达阅读位置（含页码/块锚点/批注闪烁）
- 暂缓至 M2.5：PDF 区域截图批注、多标签页阅读、MD 编辑器（TipTap）

## 功能（AI 资产 · 已移除）

- v0.7.0 起 AI 资产管理（会员/API 卡片）按需求整体移除；本地数据表保留，如需恢复可回退到 v0.5.0 分支查看实现

## 功能（M4 + M2.5）

- **⌘K 命令面板**：全局搜索任务/文档/AI 会话 + 快捷动作（新建任务/文档/会话、导航、切主题），`Ctrl/Cmd+K` 任意位置呼出，全键盘操作
- **PDF 区域截图批注**：截图模式下拖拽框选页面区域，自动裁剪画布生成本地缩略图批注，可评论、转任务、定位闪烁
- **多标签阅读**：同时打开多篇文档，标签栏切换/关闭（最多 8 个，自动记忆）
- **MD 编辑器（TipTap）**：「写文档」直接创建 Markdown 笔记，工具栏（标题/粗斜体/列表/引用/代码块）+ 自动 Markdown 序列化保存

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript + Vite 6 |
| 样式 | Tailwind CSS 4（MD3×HIG 设计令牌，亮暗双主题） |
| 状态 | Zustand（UI 四域）+ dexie-react-hooks（数据响应） |
| 存储 | IndexedDB（Dexie 4），任务模型已预留 `docRef`/`aiRef` 互跳外键 |
| 路由 | React Router v7（Hash 路由，任意静态托管免配置） |
| 阅读 | react-pdf（PDF.js 5，窗口渲染 + 文本层划词）· react-markdown + remark-gfm |
| 拖拽 | dnd-kit · 弹层 Radix（Dialog/DropdownMenu） |
| PWA | vite-plugin-pwa（manifest + Workbox 预缓存 + 自动更新） |
| 安卓 | Capacitor 8（WebView 封装，返回键/图标/启动图已配） |

## 项目结构

```
src/
├─ app/            # AppShell、侧栏/底栏/顶栏、路由导航
├─ modules/
│  ├─ tasks/       # QuickAdd(NLP) · TaskItem · TaskList · BoardView · LogbookView · TaskDetail
│  ├─ today/       # 今日 Dashboard
│  ├─ docs/        # 文档库 + 三栏阅读器 + TipTap 编辑器
│  ├─ ai/          # AI 资产管理 + 对话 + 用量仪表盘
│  └─ settings/    # 外观 / 数据备份 / 关于(PWA安装)
├─ shared/         # ui 组件 · DeepLink 互跳入口 · 快捷键 · 主题
├─ stores/         # ui.ts / tasks.ts（Zustand）
├─ db/             # Dexie 模型 + 仓储 + hooks
└─ lib/            # nlp 解析 · 日期 · PWA 安装
```

## 路线图

- [x] **M1** 任务清单 MVP
- [x] **M2** 文档工作站：PDF/MD 三栏阅读器、双坐标位置记忆、批注转任务
- [x] **M2.5** PDF 区域截图批注、多标签阅读、TipTap MD 编辑器
- [x] **M3** AI 助手面板：Provider 卡片 + Key 槽位、会话五态、运行中任务卡片、用量仪表盘
- [x] **M4** ⌘K 命令面板、互跳打磨
- [ ] **可选** Tauri 桌面包壳（需 Rust 工具链；当前 PWA 已覆盖桌面场景）
- [ ] **可选** AI 附加：流式中的工具调用展开行、Provider 订阅额度自动同步

> ⚠️ 安卓签名密钥 `android/app/workstation.keystore` 与密码只保存在本机（已加入 .gitignore）。换电脑构建前请先备份它——丢失后无法对已安装设备覆盖升级。

## 数据与隐私

- 所有数据保存在本机（App 内 IndexedDB / 浏览器 IndexedDB），不上传任何服务器
- AI 功能（M3）的 API Key 将仅存本地，永不明文回显
- 换设备 / 清除数据前，先到 **设置 → 数据 → 导出备份**
- **卸载 App 会删除其沙箱内数据**，升级 APK（同签名）则不影响

## 已解决的构建环境问题（备忘）

| 问题 | 解法（已落地到仓库） |
| --- | --- |
| 项目路径含中文，AGP 拒绝构建 | `android/gradle.properties` 已加 `android.overridePathCheck=true` |
| Capacitor 8 需要 JDK 21 | 本机安装了 Microsoft JDK 21（`%LOCALAPPDATA%\jdk-21`） |
| kotlin-stdlib 与旧 jdk7/jdk8 重复类冲突 | `android/app/build.gradle` 已加依赖约束对齐到 1.8.22 |
| SDK 未安装 | 已通过 cmdline-tools 安装 platform 35 + build-tools 35.0.0（`%LOCALAPPDATA%\Android\Sdk`） |
