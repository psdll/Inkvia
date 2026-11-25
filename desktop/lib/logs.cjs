const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

function logger(directory, config) {
  const secrets = Object.entries(config).filter(([k]) => /password|secret|token/i.test(k)).map(([,v]) => v);
  function redact(message) {
    let line = String(message).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[数据库连接已隐藏]")
      .replace(/(Bearer\s+|api[-_ ]?key["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[隐藏]");
    line = line.replace(/([?&](?:key|api_key|access_token|token)=)[^&#\s"']+/gi, "$1[隐藏]");
    line = line.replace(/(\b(?:ai_studio_admin(?:_device)?|auth_token)=)[^;\s,"']+/gi, "$1[隐藏]");
    if (config.localUser?.password) line = line.replaceAll(config.localUser.password, "[隐藏]");
    for (const value of secrets) line = line.replaceAll(value, "[隐藏]");
    return line;
  }
  function write(name, message) {
    const file = path.join(directory, name + ".log");
    const line = new Date().toISOString() + " " + redact(message).slice(0, 128 * 1024).trimEnd() + "\n";
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size || 0) + Buffer.byteLength(line) > 10 * 1024 ** 2) {
      for (let i = 3; i >= 1; i--) {
        const src = i === 1 ? file : file + "." + (i - 1);
        if (fs.existsSync(src)) fs.renameSync(src, file + "." + i);
      }
    }
    fs.appendFileSync(file, line, { mode: 0o600 });
  }
  function pipe(name, child) {
    for (const stream of [child.stdout, child.stderr]) readline.createInterface({ input: stream }).on("line", line => write(name, line));
  }
  return { write, pipe, redact };
}
module.exports = { logger };
