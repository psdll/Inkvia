# FFmpeg 和 ffprobe

Inkvia 调用 FFmpeg 项目的 ffmpeg 和 ffprobe。两者在每个目标平台使用同一构建，许可为 GNU General Public License 第 3 版或更高版本。随附 [GPL 第 3 版全文](FFmpeg-GPL-3.0.txt)。

| 系统 | 版本与发布者 | 获取对应源码与构建文件 |
|---|---|---|
| macOS arm64、x64 | [Martin Riedl 静态 release](https://ffmpeg.martin-riedl.de/)，9.1。arm64 构建号 1795207104，Intel 构建号 1795212433。 | [FFmpeg 9.1 源码归档](https://ffmpeg.org/releases/ffmpeg-9.1.tar.xz)、[9.1 构建脚本及依赖版本](https://git.martin-riedl.de/ffmpeg/build-script/src/commit/78d7b7d9ff77fe8442c727636c0386a8a23b6adf)、[arm64 组件清单](https://ffmpeg.martin-riedl.de/download/macos/arm64/1795207104_9.1/versions.txt)、[Intel 组件清单](https://ffmpeg.martin-riedl.de/download/macos/amd64/1795212433_9.1/versions.txt) |
| Windows x64 | [BtbN / FFmpeg-Builds 月末静态 win64-gpl](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59)，n9.0.2-39-g7adfbe40dc。 | [FFmpeg 对应提交的源码](https://github.com/FFmpeg/FFmpeg/archive/7adfbe40dcde598f93a6963d2f7b22cd75202ccc.tar.gz)、[该次构建脚本](https://github.com/BtbN/FFmpeg-Builds/tree/5031c6f1082414e53688d39e521849905071070d)、[外部组件源码获取脚本](https://github.com/BtbN/FFmpeg-Builds/tree/5031c6f1082414e53688d39e521849905071070d/scripts.d) |

视频合成使用 libx264 和 FFmpeg 内置 AAC 编码器。各构建还含其他第三方组件，其源码地址与版本见对应构建脚本。
