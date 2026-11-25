export const ADMIN_SESSION_EXPIRED_EVENT = "admin:session-expired";

export class AdminSessionExpiredError extends Error {
  constructor() {
    super("管理员登录已过期，请重新登录");
    this.name = "AdminSessionExpiredError";
  }
}

export function notifyAdminSessionExpired() {
  window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
}
