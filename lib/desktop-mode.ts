import "server-only";

export function isDesktopMode() {
  return process.env.INKVIA_DESKTOP_MODE === "1";
}
