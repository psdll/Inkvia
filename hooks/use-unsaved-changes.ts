"use client";

import * as React from "react";

/** Protect explicit editor exits and browser refresh/close with the same dirty state. */
export function useUnsavedChanges(dirty: boolean) {
  const dirtyRef = React.useRef(dirty);
  const [pendingLeave, setPendingLeave] = React.useState<(() => void) | null>(null);

  React.useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const requestLeave = React.useCallback((action: () => void) => {
    if (dirtyRef.current) setPendingLeave(() => action);
    else action();
  }, []);
  const cancelLeave = React.useCallback(() => setPendingLeave(null), []);
  const discardAndLeave = React.useCallback(() => {
    // Do not trigger a second browser prompt after explicitly discarding.
    dirtyRef.current = false;
    setPendingLeave(null);
    pendingLeave?.();
  }, [pendingLeave]);

  return { requestLeave, cancelLeave, discardAndLeave, confirmOpen: pendingLeave !== null };
}
