const { app, BrowserWindow, dialog, shell, session, powerMonitor, Tray, Menu } = require("electron");
const path = require("node:path");
const { paths, load, port, writeJson } = require("./lib/config.cjs");
const { database } = require("./lib/postgres.cjs");
const { environment, policy } = require("./lib/env.cjs");
const { services } = require("./lib/services.cjs");
const { desktopWindows } = require("./lib/window.cjs");
const { desktopSession } = require("./lib/session.cjs");
const { watchSystemProxy } = require("./lib/system-proxy.cjs");
const { normalizeCloseSetting, windowCloseAction, needsExitConfirmation } = require("./lib/close-policy.cjs");
const { shellText, localizeDialog } = require("./lib/shell-strings.cjs");
const { logger } = require("./lib/logs.cjs");

app.setName("Inkvia");
app.setPath("userData", path.join(app.getPath("appData"), app.getName()));
process.umask(0o077);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let splash, main, tray, children, stopDatabase, stopProxyWatch, startup, log;
  let locale = "zh-CN";
  const text = (source, values) => shellText(locale, source, values);
  let quitting = false, finished = false, askingClose = false, askingExit = false;
  const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false };

  function focus() {
    if (quitting) return;
    if (main) { main.show(); return; }
    if (splash && !splash.isDestroyed()) { splash.show(); splash.focus(); }
  }

  function refreshTrayMenu() {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: text("打开 Inkvia"), click: focus },
      { label: text("退出 Inkvia"), click: () => void requestExit() },
    ]));
  }

  function finishQuit() {
    if (quitting) return;
    quitting = true;
    stopProxyWatch?.();
    void (async () => {
      try {
        await children?.stop();
        await startup;
        await children?.stop();
      } catch (error) {
        log?.write("desktop", error.message);
      } finally {
        try { await stopDatabase?.(); } catch (error) { log?.write("desktop", error.message); }
        tray?.destroy();
        if (main && !main.win.isDestroyed()) main.win.destroy();
        finished = true;
        app.quit();
      }
    })();
  }

  async function requestExit() {
    if (quitting || askingExit) return;
    askingExit = true;
    try {
      let count;
      try { count = await children?.countUnfinished() ?? 0; } catch { count = null; }
      if (quitting) return;
      if (needsExitConfirmation("user", count)) {
        const message = count === null ? text("暂时无法确认是否还有生成任务。") : text("还有 {count} 个任务尚未完成。", {
          count: locale === "en" ? count.toLocaleString("en-US") : count,
        });
        const confirm = localizeDialog({
          type: "question", title: "退出 Inkvia", message,
          detail: "已排队的批量、画布和 Live 任务会在下次打开后继续。单次生成或部分正在运行的任务可能需要手动重试。",
          buttons: ["退出", "取消"], defaultId: 1, cancelId: 1,
        }, text);
        const result = main?.win.isVisible() ? await dialog.showMessageBox(main.win, confirm) : await dialog.showMessageBox(confirm);
        if (result.response !== 0 || quitting) return;
      }
      if (main && !main.page.isDestroyed()) main.page.close({ waitForBeforeUnload: true });
      else finishQuit();
    } finally { askingExit = false; }
  }

  app.on("second-instance", focus);
  app.on("activate", focus);
  app.on("window-all-closed", finishQuit);
  app.on("before-quit", event => {
    if (finished) return;
    event.preventDefault();
    void requestExit();
  });

  async function start() {
    const startTime = Date.now();
    splash = new BrowserWindow({ width: 480, height: 290, title: "Inkvia", backgroundColor: "#121619", webPreferences });
    splash.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    splash.webContents.on("will-navigate", e => e.preventDefault());
    await splash.loadFile(path.join(__dirname, "splash.html"));
    const p = paths(app.getPath("userData"), app.isPackaged);
    try {
      const cookies = session.defaultSession.cookies;
      const [savedLocale] = await cookies.get({ domain: "127.0.0.1", name: "INKVIA_LOCALE" }).catch(() => []);
      locale = savedLocale?.value === "en" ? "en" : "zh-CN";
      if (locale === "en" && !splash.isDestroyed()) {
        await splash.webContents.executeJavaScript(`document.documentElement.lang = ${JSON.stringify(locale)}; document.querySelector('#status').textContent = ${JSON.stringify(text("正在启动…"))}`);
      }
      const config = load(p);
      log = logger(p.logs, config);
      config.pgPort = await port(config.pgPort);
      writeJson(p.settings, config);
      stopDatabase = await database(p, config, message => log.write("postgres", message));
      if (quitting) return;
      config.webPort = await port(config.webPort);
      writeJson(p.settings, config);
      const env = environment(p, config);
      const origin = env.NEXT_PUBLIC_APP_URL;
      // Use the OS configuration even if Electron was launched with proxy switches.
      await session.defaultSession.setProxy({ mode: "system" });
      if (quitting) return;
      stopProxyWatch = watchSystemProxy(session.defaultSession, app, powerMonitor,
        env.INKVIA_DESKTOP_PROXY_FILE, message => log.write("desktop", message));
      children = services(p, config, env, log, async () => {
        const result = await dialog.showMessageBox(localizeDialog({ type: "error", message: "服务异常退出", buttons: ["重启", "打开日志目录"] }, text));
        if (quitting) return;
        if (result.response === 0) { app.relaunch(); finishQuit(); }
        else await shell.openPath(p.logs);
      });
      await children.migrate();
      if (quitting) return;
      policy(p, config);
      await children.next();
      if (quitting) return;
      const auth = desktopSession(session.defaultSession, origin, config, p.settings);
      await auth.installAdminSession();
      await auth.loginUser();
      if (quitting) return;
      children.startWorkerScheduler();
      async function refreshLocale() {
        const [stored] = await cookies.get({ url: origin, name: "INKVIA_LOCALE" });
        locale = stored?.value === "en" ? "en" : "zh-CN";
        main?.refreshMenu();
        refreshTrayMenu();
      }
      await refreshLocale();
      cookies.on("changed", (_event, cookie) => {
        if (cookie.name === "INKVIA_LOCALE" && cookie.domain === "127.0.0.1" && !quitting) {
          void refreshLocale().catch(error => log.write("desktop", error.message));
        }
      });
      if (quitting) return;
      const createWindow = desktopWindows(origin, auth.ensureAdmin, async () => {
        try {
          await auth.ensureAdmin();
          await auth.loginUser();
        } catch (error) {
          log.write("desktop", error.message);
          throw error;
        }
      }, {
        text,
        getCloseSetting: () => ({
          platform: process.platform,
          value: normalizeCloseSetting(process.platform, config.closeWindowBehavior) || "background",
        }),
        setCloseSetting: value => {
          const setting = normalizeCloseSetting(process.platform, value);
          if (!setting) throw Error("关闭窗口设置无效");
          config.closeWindowBehavior = setting;
          writeJson(p.settings, config);
          return setting;
        },
        async closeWindow(win) {
          if (quitting || askingClose || askingExit) return;
          askingClose = true;
          try {
            let action = windowCloseAction(process.platform, config.closeWindowBehavior);
            if (action === "ask") {
              const result = await dialog.showMessageBox(win, localizeDialog({
                type: "question", title: "关闭 Inkvia",
                message: "关闭窗口后，Inkvia 可以在后台继续运行，生成任务不会中断。",
                buttons: ["最小化到托盘（推荐）", "退出程序"], defaultId: 0, cancelId: 0,
                checkboxLabel: "记住我的选择，不再询问", checkboxChecked: true,
              }, text));
              if (quitting) return;
              action = result.response === 1 ? "exit" : "background";
              if (result.checkboxChecked) {
                config.closeWindowBehavior = action;
                writeJson(p.settings, config);
              }
            }
            if (action === "exit") await requestExit();
            else {
              win.hide();
              if (tray && !config.closeTrayBalloonShown) {
                config.closeTrayBalloonShown = true;
                writeJson(p.settings, config);
                tray.displayBalloon({ title: "Inkvia", content: text("Inkvia 仍在后台运行，可以从这里重新打开") });
              }
            }
          } catch (error) { log.write("desktop", error.message); }
          finally { askingClose = false; }
        },
        pageClosed: finishQuit,
        systemExit: finishQuit,
      });
      main = createWindow();
      if (process.platform === "win32") {
        const icon = app.isPackaged ? path.join(process.resourcesPath, "inkvia-tray.ico") : path.join(__dirname, "build/icon.ico");
        tray = new Tray(icon);
        tray.setToolTip("Inkvia");
        tray.on("click", focus);
        tray.on("double-click", focus);
        refreshTrayMenu();
      }
      await Promise.all([main.ready, main.page.loadURL(origin + "/")]);
      if (quitting) return;
      main.show();
      splash.close();
      log.write("desktop", "首页已打开 " + (Date.now() - startTime) + "ms");
    } catch (err) {
      const message = log ? log.redact(err?.message || err) : String(err?.message || err);
      log?.write("desktop", message);
      stopProxyWatch?.();
      await children?.stop();
      await stopDatabase?.();
      stopDatabase = undefined;
      if (!quitting && !splash.isDestroyed()) {
        const visibleError = locale === "en" ? text("无法启动本机服务，请查看日志后重试。") : message;
        await splash.webContents.executeJavaScript(
          "document.querySelector('#status').textContent=" + JSON.stringify(`${visibleError}\n${text("日志目录")} ${p.logs}`));
      }
    }
  }
  app.whenReady().then(() => {
    if (process.platform === "darwin") powerMonitor.on("shutdown", finishQuit);
    startup = start();
  });
}
