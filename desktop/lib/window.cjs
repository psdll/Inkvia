const { BrowserWindow, WebContentsView, shell, dialog } = require("electron");
const path = require("node:path");
const { installMenu, showContextMenu, openDataDirectory, openLogsDirectory } = require("./menu.cjs");

const { localizeDialog } = require("./shell-strings.cjs");
const { installWindowOpen } = require("./window-open.cjs");

const mac = process.platform === "darwin";
const windows = process.platform === "win32";
const barHeight = 40;
const safePreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false };
const readTheme = '(document.documentElement.dataset.theme === "light" ? "light" : document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark" ? "dark" : "light")';
const editing = 'Boolean(document.activeElement?.matches("input,textarea,select") || document.activeElement?.isContentEditable || document.designMode === "on")';

function shortcut(input) {
  const { key, code, meta, alt, control, shift } = input;
  if (mac && meta && !alt && !control) {
    if (shift) return code === "KeyH" ? "home" : null;
    return { BracketLeft: "back", BracketRight: "forward", KeyR: "reload" }[code];
  }
  if (windows && !meta && !shift) {
    if (alt && !control) return { ArrowLeft: "back", ArrowRight: "forward", Home: "home" }[key];
    if (!alt && (control ? code === "KeyR" : key === "F5")) return "reload";
  }
}

function desktopWindows(origin, ensureAdmin, recoverLogin, lifecycle) {
  const home = origin + "/";
  const adminUrl = origin + "/admin";
  const commands = new Map();
  const refreshMenu = () => installMenu(action => commands.get(BrowserWindow.getFocusedWindow())?.(action, true), lifecycle.text);
  refreshMenu();

  function classify(raw) {
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "deny";
      return url.origin === origin ? "local" : "external";
    } catch { return "deny"; }
  }

  function create() {
    const win = new BrowserWindow({
      width: 1440, height: 900, minWidth: 1100, minHeight: 700, show: false, title: "Inkvia",
      backgroundColor: "#202020", autoHideMenuBar: windows,
      titleBarStyle: mac ? "hiddenInset" : "hidden",
      ...(mac ? { trafficLightPosition: { x: 14, y: 13 } } : {}),
      ...(windows ? { titleBarOverlay: { height: barHeight, color: "#202020", symbolColor: "#b8b8b8" } } : {}),
      webPreferences: { ...safePreferences, preload: path.join(__dirname, "../toolbar-preload.cjs") },
    });
    const toolbar = win.webContents;
    const view = new WebContentsView({
      webPreferences: { ...safePreferences, preload: path.join(__dirname, "../app-preload.cjs") },
    });
    const page = view.webContents;
    const trusted = event => event.senderFrame === page.mainFrame && classify(event.senderFrame.url) === "local";
    page.ipc.handle("inkvia:close-setting:get", event => {
      if (!trusted(event)) throw Error("无权查看关闭设置");
      return lifecycle.getCloseSetting();
    });
    page.ipc.handle("inkvia:close-setting:set", (event, value) => {
      if (!trusted(event)) throw Error("无权修改关闭设置");
      return lifecycle.setCloseSetting(value);
    });
    page.setUserAgent(`${page.getUserAgent()} InkviaDesktop/${process.platform}`);
    win.contentView.addChildView(view);
    const layout = () => {
      const [width, height] = win.getContentSize();
      view.setBounds({ x: 0, y: barHeight, width, height: Math.max(0, height - barHeight) });
    };
    layout();
    win.on("resize", layout);
    win.on("page-title-updated", e => e.preventDefault());
    const history = page.navigationHistory;
    let toolbarReady = false, theme = "dark", documentId = 0, restoringLogin = false;

    function available() {
      const i = history.getActiveIndex();
      return {
        back: history.canGoBack() && classify(history.getEntryAtIndex(i - 1)?.url) === "local",
        forward: history.canGoForward() && classify(history.getEntryAtIndex(i + 1)?.url) === "local",
        home: page.getURL() !== home,
      };
    }
    function publish() {
      if (toolbarReady && !toolbar.isDestroyed() && !page.isDestroyed()) {
        toolbar.send("toolbar:state", { platform: process.platform, theme });
      }
    }
    async function navigate(action, guardEditing = false) {
      if (page.isDestroyed()) return;
      if (guardEditing && (action === "back" || action === "forward")) {
        const frame = page.focusedFrame || page.mainFrame;
        if (await frame.executeJavaScript(editing).catch(() => true)) return;
      }
      if (page.isDestroyed() || available()[action] === false) return;
      page.focus();
      if (action === "admin") {
        try {
          await ensureAdmin();
          if (!page.isDestroyed()) await page.loadURL(adminUrl);
        } catch (error) {
          if (!win.isDestroyed() && error.code !== "ERR_ABORTED") await dialog.showMessageBox(win, {
            type: "error", message: lifecycle.text("无法打开管理后台"), detail: error.message,
          });
        }
      }
      if (action === "back") history.goBack();
      if (action === "forward") history.goForward();
      if (action === "reload") page.reload();
      if (action === "home") await page.loadURL(home).catch(() => {});
    }
    commands.set(win, navigate);
    function setTheme(value) {
      if (win.isDestroyed() || !value || value === theme) return;
      theme = value;
      if (windows) win.setTitleBarOverlay({
        height: barHeight, color: theme === "light" ? "#e9ecef" : "#202020",
        symbolColor: theme === "light" ? "#626c7a" : "#b8b8b8",
      });
      publish();
    }
    function refreshTheme() {
      if (!page.isDestroyed() && classify(page.getURL()) === "local") {
        const id = documentId;
        page.executeJavaScript(readTheme).then(value => { if (id === documentId) setTheme(value); }).catch(() => {});
      }
    }
    // Observe only the existing root attributes, including theme switches without navigation.
    async function watchTheme(id) {
      while (!page.isDestroyed() && id === documentId && classify(page.getURL()) === "local") {
        const next = await page.executeJavaScript(`new Promise(resolve => {
          const root = document.documentElement;
          const check = () => { const value = ${readTheme};
            if (value !== ${JSON.stringify(theme)}) { observer.disconnect(); resolve(value); }
          };
          const observer = new MutationObserver(check);
          observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "class"] });
          check();
        })`).catch(() => null);
        if (!next || id !== documentId) return;
        setTheme(next);
      }
    }
    page.on("dom-ready", () => {
      void watchTheme(++documentId);
      if (classify(page.getURL()) !== "local") return;
      // The home hero shares the viewport's right edge; compensate for its narrower content column.
      // Trim the transparent left inset of the 100px brand mark when centering the visible wordmark.
      const hero = 'div:has(> h1.sr-only + p.font-sora):has(> div > a.cta-btn[href="/studio"])';
      void page.insertCSS(`
        ${hero} { translate: calc(50% - 50vw) 0; }
        ${hero} > div > span:has(> svg[width="100"]) { translate: -10px 0; }
      `).catch(() => {});
    });
    page.on("did-navigate", publish);
    page.on("did-navigate-in-page", (_event, _url, mainFrame) => {
      if (mainFrame) { publish(); refreshTheme(); }
    });
    page.on("did-finish-load", () => { publish(); refreshTheme(); });
    win.on("focus", refreshTheme);
    toolbar.on("did-finish-load", () => { toolbarReady = true; publish(); });
    toolbar.on("will-frame-navigate", e => e.preventDefault());
    toolbar.setWindowOpenHandler(() => ({ action: "deny" }));
    for (const contents of [page, toolbar]) {
      contents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown" || input.isComposing) return;
        const action = shortcut(input);
        if (action) { event.preventDefault(); if (!input.isAutoRepeat) void navigate(action, true); }
      });
    }
    if (mac) win.on("swipe", (_event, direction) => {
      if (direction === "right") void navigate("back");
      if (direction === "left") void navigate("forward");
    });
    if (windows) win.on("app-command", (event, command) => {
      if (command === "browser-backward" || command === "browser-forward") {
        event.preventDefault();
        void navigate(command === "browser-backward" ? "back" : "forward");
      }
    });
    page.on("context-menu", (_event, params) => showContextMenu(win, page, params, available(), navigate, lifecycle.text));

    async function restoreLogin() {
      if (restoringLogin) return;
      restoringLogin = true;
      const currentUrl = page.getURL();
      try {
        await recoverLogin();
        if (!page.isDestroyed() && page.getURL() === currentUrl) page.reload();
      } catch {
        if (!win.isDestroyed()) {
          const { response } = await dialog.showMessageBox(win, localizeDialog({
            type: "error", message: "恢复登录失败", detail: "请打开日志目录查看详情后重试。",
            buttons: ["关闭", "打开日志目录"], defaultId: 0, cancelId: 0,
          }, lifecycle.text));
          if (response === 1) await openLogsDirectory();
        }
      } finally {
        restoringLogin = false;
      }
    }

    const localActions = new Map([
      [origin + "/__desktop/restore-login", restoreLogin],
      [origin + "/__desktop/open-data-dir", openDataDirectory],
      [origin + "/__desktop/open-logs-dir", openLogsDirectory],
    ]);
    function protect(event) {
      if (event.url === adminUrl && event.isMainFrame && classify(page.getURL()) === "local") {
        event.preventDefault();
        void navigate("admin");
        return;
      }
      const localAction = localActions.get(event.url);
      if (localAction) {
        event.preventDefault();
        if (event.isMainFrame && classify(page.getURL()) === "local") void localAction();
        return;
      }
      const kind = classify(event.url);
      if (kind === "local") return;
      event.preventDefault();
      if (kind === "external" && event.isMainFrame) void shell.openExternal(event.url);
    }
    page.on("will-frame-navigate", protect);
    page.on("will-redirect", protect);
    installWindowOpen(win, page, classify);
    page.on("will-prevent-unload", event => {
      const choice = dialog.showMessageBoxSync(win, localizeDialog({
        type: "question", message: "这个页面有未保存的修改，确定要离开吗？",
        buttons: ["离开", "留下"], defaultId: 1, cancelId: 1,
      }, lifecycle.text));
      if (choice === 0) event.preventDefault();
    });
    // Honor the page's beforeunload (including an unsaved canvas) before closing its host.
    win.on("close", event => {
      if (page.isDestroyed()) return;
      event.preventDefault();
      void lifecycle.closeWindow(win);
    });
    if (windows) {
      win.on("query-session-end", lifecycle.systemExit);
      win.on("session-end", lifecycle.systemExit);
    }
    page.once("destroyed", () => {
      if (!win.isDestroyed()) win.close();
      lifecycle.pageClosed();
    });
    win.once("closed", () => { commands.delete(win); if (!page.isDestroyed()) page.close(); });
    return {
      page, ready: toolbar.loadFile(path.join(__dirname, "../toolbar.html")),
      win, refreshMenu,
      show() {
        if (win.isDestroyed() || page.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        page.focus();
      },
    };
  }
  return create;
}

module.exports = { desktopWindows };
