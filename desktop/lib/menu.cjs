const { app, Menu, shell } = require("electron");
const path = require("node:path");

const items = [
  ["back", "后退", "Command+["],
  ["forward", "前进", "Command+]"],
  ["reload", "刷新", "Command+R"],
  ["home", "回到首页", "Shift+Command+H"],
  ["admin", "管理后台"],
];

function openDataDirectory() {
  return shell.openPath(app.getPath("userData"));
}

function openLogsDirectory() {
  return shell.openPath(path.join(app.getPath("userData"), "logs"));
}

function directoryItems(text) {
  return [
    { label: text("打开数据目录"), click: () => void openDataDirectory() },
    { label: text("打开日志目录"), click: () => void openLogsDirectory() },
  ];
}

function installMenu(navigateFocused, text) {
  if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: text("Inkvia"), submenu: [
      { role: "about", label: text("关于 Inkvia") }, { type: "separator" },
      { role: "hide", label: text("隐藏 Inkvia") }, { role: "quit", label: text("退出 Inkvia") },
    ] },
    { label: text("编辑"), submenu: [
      { role: "undo", label: text("撤销") }, { role: "redo", label: text("重做") }, { type: "separator" },
      { role: "cut", label: text("剪切") }, { role: "copy", label: text("复制") },
      { role: "paste", label: text("粘贴") }, { role: "selectAll", label: text("全选") },
    ] },
    { label: text("前往"), submenu: items.map(([action, label, accelerator]) => ({
      label: text(label), accelerator, click: () => navigateFocused(action),
    })) },
    { label: text("窗口"), submenu: [
      { role: "close", label: text("关闭窗口"), accelerator: "Command+W" },
      { role: "togglefullscreen", label: text("进入全屏"), accelerator: "Control+Command+F" },
      { role: "minimize", label: text("最小化") }, { role: "zoom", label: text("缩放") },
    ] },
    { role: "help", label: text("帮助"), submenu: directoryItems(text) },
  ]));
}

function showContextMenu(win, page, params, available, navigate, text) {
  const template = items.map(([action, label]) => ({
    label: text(label), enabled: available[action] !== false, click: () => navigate(action),
  }));
  const edits = params.isEditable ? [
    ["cut", "剪切", params.editFlags.canCut], ["copy", "复制", params.editFlags.canCopy],
    ["paste", "粘贴", params.editFlags.canPaste], ["selectAll", "全选", params.editFlags.canSelectAll],
  ] : params.selectionText ? [["copy", "复制", true]] : [];
  if (edits.length) template.push({ type: "separator" });
  for (const [method, label, enabled] of edits) {
    template.push({ label: text(label), enabled, click: () => page[method]() });
  }
  template.push({ type: "separator" }, ...directoryItems(text));
  Menu.buildFromTemplate(template).popup({ window: win });
}

module.exports = { installMenu, showContextMenu, openDataDirectory, openLogsDirectory };
