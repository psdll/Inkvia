const { app, dialog, shell, WebContentsView } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// A file opened for preview should never overwrite an existing user download.
const previewExtensions = /\.(?:avif|bmp|gif|hei[cf]|ico|jpe?g|png|tiff?|webp|mp4|m4v|mkv|mov|webm|avi|mp3|m4a|aac|flac|ogg|opus|wav|pdf|txt|csv|json|md|docx?|xlsx?|pptx?|zip|7z|rar|gz|tar)$/i;
const blank = url => url === "" || url === "about:blank";

function installWindowOpen(win, page, classify) {
  const pending = new Map();
  const placeholders = new Set();
  const session = page.session;
  const report = message => {
    if (!win.isDestroyed()) void dialog.showMessageBox(win, { type: "error", message });
  };
  // Only downloads initiated by this dispatcher get opened. Ordinary Save As stays intact.
  function download(url) {
    pending.set(url, (pending.get(url) || 0) + 1);
    session.downloadURL(url);
  }
  function receive(event, item, source) {
    if (source) return;
    const chain = item.getURLChain(), url = chain[0], count = pending.get(url);
    if (!count || item.getInitiatorOrigin()) return;
    if (count === 1) pending.delete(url);
    else pending.set(url, count - 1);
    const outside = chain.find(link => classify(link) !== "local");
    if (outside) {
      event.preventDefault();
      if (classify(outside) === "external") dispatch(outside);
      return;
    }
    try {
      const dir = fs.mkdtempSync(path.join(app.getPath("temp"), "Inkvia-"));
      const name = path.win32.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      const file = path.join(dir, name && name !== "." && name !== ".." ? name : "download");
      item.setSavePath(file);
      item.once("done", async (_event, state) => {
        if (state !== "completed") { fs.rmSync(dir, { recursive: true, force: true }); report("文件下载未完成"); return; }
        // Do not execute programs or OS shortcuts received as attachments.
        if (!previewExtensions.test(file)) { shell.showItemInFolder(file); return; }
        const error = await shell.openPath(file);
        if (error) report("无法用系统默认程序打开文件：" + error);
      });
    } catch { event.preventDefault(); report("无法保存临时文件"); }
  }
  session.on("will-download", receive);
  page.once("destroyed", () => {
    session.removeListener("will-download", receive);
    for (const view of placeholders) if (!view.webContents.isDestroyed()) view.webContents.close();
  });

  async function open(raw) {
    let url = new URL(raw);
    for (let redirects = 0; redirects <= 10 && !page.isDestroyed(); redirects++) {
      const kind = classify(url.href);
      if (kind === "external") { await shell.openExternal(url.href); return; }
      if (kind !== "local") return;
      if (url.pathname.startsWith("/uploads/")) { url.hash = ""; download(url.href); return; }
      const options = { credentials: "include", redirect: "manual" };
      let response = await session.fetch(url.href, { ...options, method: "HEAD" });
      if ([405, 501].includes(response.status) || (!response.headers.has("content-type") && response.status === 200)) {
        response = await session.fetch(url.href, options);
        void response.body?.cancel();
      }
      if (page.isDestroyed()) return;
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) { url = new URL(location, url); continue; }
      const type = response.headers.get("content-type") || "";
      const attachment = /^attachment\b/i.test(response.headers.get("content-disposition") || "");
      const file = type && !/^(?:text\/html|application\/xhtml\+xml)\b/i.test(type);
      if (response.ok && (attachment || file)) {
        url.hash = ""; download(url.href);
      } else {
        await page.loadURL(url.href);
      }
      return;
    }
    if (!page.isDestroyed()) throw Error("链接重定向次数过多");
  }
  function dispatch(url) {
    open(url).catch(error => {
      if (!page.isDestroyed() && error.code !== "ERR_ABORTED" && error.errno !== -3) report("无法打开链接：" + error.message);
    });
  }
  page.setWindowOpenHandler(({ url }) => {
    if (blank(url)) return {
      action: "allow",
      createWindow(options) {
        // No native window and no parent view: focus(), resizeTo() or page load cannot show it.
        const hidden = new WebContentsView({ webContents: options.webContents });
        placeholders.add(hidden);
        const guest = hidden.webContents;
        guest.once("destroyed", () => placeholders.delete(hidden));
        guest.setWindowOpenHandler(() => ({ action: "deny" }));
        let used = false;
        guest.on("will-frame-navigate", event => {
          if (event.isMainFrame && blank(event.url)) return;
          event.preventDefault();
          if (!event.isMainFrame || used) return;
          used = true;
          const target = event.url;
          setImmediate(() => { if (!guest.isDestroyed()) guest.close(); if (!page.isDestroyed()) dispatch(target); });
        });
        return guest;
      },
    };
    if (classify(url) !== "deny") dispatch(url);
    return { action: "deny" };
  });
}
module.exports = { installWindowOpen };
