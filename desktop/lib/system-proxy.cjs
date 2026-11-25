const { networkInterfaces } = require("node:os");
const { writeJson } = require("./config.cjs");

const PROBE_URL = "https://www.google.com/";
const REFRESH_MS = 25_000;

function parseSystemProxy(result) {
  let socks = false;
  for (const directive of result.split(";")) {
    if (/^DIRECT$/i.test(directive.trim())) return { status: socks ? "socks" : "direct" };
    const match = /^(PROXY|HTTPS|SOCKS[45]?)\s+(\[[a-f\d:.]+\]|[a-z\d._-]+):(\d{1,5})$/i.exec(directive.trim());
    if (!match) continue;
    const [, kind, host, port] = match;
    if (+port < 1 || +port > 65535) continue;
    try {
      const url = new URL(`${kind.toUpperCase() === "HTTPS" ? "https" : "http"}://${host}:${port}`);
      if (/^SOCKS/i.test(kind)) socks = true;
      else return { status: "proxy", url: url.origin };
    } catch {}
  }
  return { status: socks ? "socks" : "unavailable" };
}

function watchSystemProxy(electronSession, app, powerMonitor, file, reportError) {
  let pending = false, closed = false, lastCheck = 0, previous = "";
  const connections = () => JSON.stringify(networkInterfaces());
  let interfaces = connections();
  function publish(state) {
    const current = JSON.stringify(state);
    if (!closed && current !== previous) {
      writeJson(file, state);
      previous = current;
    }
  }
  const refresh = async () => {
    if (pending || closed) return;
    pending = true;
    lastCheck = Date.now();
    try {
      let state;
      try {
        state = parseSystemProxy(await electronSession.resolveProxy(PROBE_URL));
      } catch {
        state = { status: "unavailable" };
      }
      publish(state);
    } catch (error) {
      reportError(error.message);
    } finally {
      pending = false;
    }
  };
  publish({ status: "unavailable" });
  void refresh();
  const timer = setInterval(() => {
    const current = connections();
    if (current === interfaces && Date.now() - lastCheck < REFRESH_MS) return;
    interfaces = current;
    void refresh();
  }, 2_000);
  app.on("browser-window-focus", refresh);
  powerMonitor.on("resume", refresh);
  return () => {
    closed = true;
    clearInterval(timer);
    app.off("browser-window-focus", refresh);
    powerMonitor.off("resume", refresh);
  };
}

module.exports = { parseSystemProxy, watchSystemProxy };
