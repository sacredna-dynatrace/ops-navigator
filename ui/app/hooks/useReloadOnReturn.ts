import { useEffect, useRef } from "react";

/**
 * Calls `reload` when the user comes back to this tab - after saving a workflow in the Workflows app
 * that a "create" link opened in another tab. Visibility and focus both fire on the way back, so calls
 * closer together than `minGapMs` collapse into one.
 */
export const useReloadOnReturn = (reload: () => void, minGapMs = 3000) => {
  const last = useRef(0);
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last.current < minGapMs) return;
      last.current = now;
      reload();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [reload, minGapMs]);
};
