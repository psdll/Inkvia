const en = {
  "正在启动…": "Starting Inkvia…", "日志目录": "Logs folder",
  "无法启动本机服务，请查看日志后重试。": "The local service could not start. Check the logs and try again.",
  "后退": "Back", "前进": "Forward", "刷新": "Reload", "回到首页": "Home", "管理后台": "Admin console",
  "打开数据目录": "Open data folder", "打开日志目录": "Open logs folder",
  "关于 Inkvia": "About Inkvia", "隐藏 Inkvia": "Hide Inkvia", "退出 Inkvia": "Quit Inkvia", "打开 Inkvia": "Open Inkvia",
  "编辑": "Edit", "撤销": "Undo", "重做": "Redo", "剪切": "Cut", "复制": "Copy", "粘贴": "Paste", "全选": "Select All",
  "前往": "Go", "窗口": "Window", "关闭窗口": "Close Window", "进入全屏": "Enter Full Screen",
  "最小化": "Minimize", "缩放": "Zoom", "帮助": "Help", "重启": "Restart",
  "服务异常退出": "The local service stopped unexpectedly",
  "无法打开管理后台": "Could not open the admin console",
  "恢复登录失败": "Could not restore your session",
  "请打开日志目录查看详情后重试。": "Open the logs for details and try again.",
  "关闭": "Close", "离开": "Leave", "留下": "Stay",
  "这个页面有未保存的修改，确定要离开吗？": "This page has unsaved changes. Leave anyway?",
  "暂时无法确认是否还有生成任务。": "Inkvia could not check for unfinished tasks.",
  "还有 {count} 个任务尚未完成。": "{count} tasks are unfinished.",
  "已排队的批量、画布和 Live 任务会在下次打开后继续。单次生成或部分正在运行的任务可能需要手动重试。":
    "Queued batch, canvas and Live tasks resume when you reopen Inkvia. Individual generations and some running tasks may need to be retried.",
  "退出": "Quit", "取消": "Cancel", "关闭 Inkvia": "Close Inkvia",
  "关闭窗口后，Inkvia 可以在后台继续运行，生成任务不会中断。":
    "Inkvia can keep running in the background and continue generation after you close the window.",
  "最小化到托盘（推荐）": "Minimize to tray (recommended)", "退出程序": "Quit Inkvia",
  "记住我的选择，不再询问": "Remember my choice",
  "Inkvia 仍在后台运行，可以从这里重新打开": "Inkvia is running in the background. Open it again from here.",
};

function shellText(locale, source, values = {}) {
  const message = locale === "en" ? en[source] || source : source;
  return message.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}

function localizeDialog(options, text) {
  const copy = { ...options, buttons: options.buttons.map(label => text(label)) };
  for (const field of ["title", "message", "detail", "checkboxLabel"]) {
    if (copy[field]) copy[field] = text(copy[field]);
  }
  return copy;
}

module.exports = { shellText, localizeDialog };
