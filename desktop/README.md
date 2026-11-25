# Inkvia 桌面客户端

Inkvia 桌面版支持 macOS 和 Windows。安装包自带网页服务、PostgreSQL 16 和媒体工具，在本机独立运行。

## 使用

- 在左侧导航或账号菜单点「设置」，直接进入后台的「系统概览」。界面主题、语言、生成快捷键和关闭窗口行为都在「系统设置 → 通用」。「语言」可切换简体中文和 English。
- 标题栏显示 Inkvia。页面通过左侧导航切换，画布项目和后台页面在当前窗口打开。本地媒体会交给系统默认程序打开。
- 第一次启动自动建立本机账号和管理员会话。在后台的 API 配置中填写需要的模型平台凭据。客户端默认跟随系统代理，在代理设置中可查看当前识别结果或改用其他模式。本机服务始终走回环地址直连。
- 首次启动提供两个官方技能「静态图片转 4 秒 Live Photo」和「产品AI真实场景图提示词」。两个技能只安装一次，删除后重启不会自动恢复。批量 Live 视频在未设置绑定时会默认使用 Live Photo 技能。
- 关闭窗口默认在后台继续运行。macOS 点红色关闭按钮隐藏窗口，点程序坞图标恢复，按 ⌘Q 或选「退出 Inkvia」结束程序。Windows 第一次点关闭按钮可以选择最小化到通知区域或退出，并记住选择。通知区域的 Inkvia 图标可恢复窗口或退出。需要调整时，在「系统设置 → 通用 → 关闭主窗口时」修改。

## 安装和用户数据

macOS 打开 DMG，将 Inkvia 拖到「应用程序」，再从访达打开。Apple 芯片使用 arm64 包，Intel Mac 使用 x64 包。通过本地命令生成的 Mac 包使用 ad-hoc 签名。

Windows 双击 x64 安装程序，选择当前用户的安装目录。覆盖安装和卸载都保留用户数据。

| 位置 | 数据目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Inkvia/` |
| Windows | `%APPDATA%\Inkvia` |

数据目录包含 `postgres/data`、素材、导入与导出文件、配置和 `logs`。可从 macOS「帮助」菜单打开数据或日志目录，也可在后台「本机存储」和「日志」进入对应目录。数据库迁移问题可查看 `logs/migrate.log`。

备份时退出 Inkvia 后复制整个数据目录。Windows 若因中文路径导致首次数据库初始化失败，数据库会改存当前用户专属的 `%ProgramData%\Inkvia-<实例 ID>\data`，配置中记录该路径。备份时一并复制这个数据库目录。

## 从源码运行与构建安装包

在项目根目录使用 Node.js 22.12 或更高版本和 npm。首次下载 Electron 和媒体二进制需要联网。

```sh
npm ci
npm run desktop:prepare
npm run desktop:start
```

运行前取消设置 `INKVIA_LOCAL_PRODUCTION`。启动画面会等待本机数据库、Prisma 迁移和网页服务就绪。新增或修改 worker 时同步维护 `desktop/lib/workers.cjs`。

| 构建环境 | 命令 | 产物 |
| --- | --- | --- |
| 对应架构的 Mac | `npm run desktop:dist:mac` | `dist-desktop/Inkvia-*-mac-*.dmg` |
| x64 Windows | `npm run desktop:dist:win` | `dist-desktop/Inkvia-*-win-x64-setup.exe` |
| Apple 芯片 Mac | 先执行 `npm run desktop:dist:mac`，再执行 `npm run desktop:dist:win:cross` | `dist-desktop/win-out/Inkvia-*-win-x64-setup.exe` |

原生打包先构建 Next.js standalone 和 worker。Windows 交叉打包复用同版本的 Mac 构建产物，并替换为 Windows x64 的原生组件。

## 第三方许可

安装包的 `app-runtime/licenses/` 包含 PostgreSQL 16.16 版权声明、Inter 字体的 SIL OFL 1.1 全文、FFmpeg 许可、来源说明及打包生成的 `THIRD_PARTY_NOTICES.txt`。后者根据实际打包使用的 npm 软件包生成，记录名称、版本、声明的许可和对应原文。上游发行包缺少元数据时会明确标记。Electron 和 Chromium 的许可随各平台发行包保留。

源码版和安装版使用同一平台的静态 FFmpeg 与 ffprobe。Mac 使用 Martin Riedl 的 FFmpeg 9.1，Windows 使用 BtbN 的月末构建 `n9.0.2-39-g7adfbe40dc-win64-gpl-9.0`。下载保存到 `dist-desktop/cache/` 并核对固定的 SHA-256。打包检查编译参数和平台架构。[FFmpeg 构建和对应源码](licenses/FFmpeg.md)
