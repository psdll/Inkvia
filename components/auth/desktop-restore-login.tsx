import { UiText } from "@/i18n/ui";
export function DesktopRestoreLoginLink({ className }: { className?: string }) {
  // This must be a full document navigation so Electron can intercept it.
  return <a href="/__desktop/restore-login" className={className}><UiText id="auth.medd4000049f2" /></a>;
}
