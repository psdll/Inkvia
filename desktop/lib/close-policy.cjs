function normalizeCloseSetting(platform, value) {
  if (value === "background" || value === "exit" || (platform === "win32" && value === "ask")) return value;
  return null;
}

function windowCloseAction(platform, setting) {
  return normalizeCloseSetting(platform, setting) || (platform === "win32" ? "ask" : "background");
}

function needsExitConfirmation(reason, count) {
  return reason === "user" && count !== 0;
}

module.exports = { normalizeCloseSetting, windowCloseAction, needsExitConfirmation };
