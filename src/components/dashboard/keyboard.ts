"use client";

import { useEffect, useRef } from "react";
import type { StatusValue } from "./types";

interface UseKeyboardNavArgs {
  visibleIds: () => string[];
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onChangeStatus: (status: StatusValue) => void;
  focusSearch: () => void;
}

const STATUS_BY_DIGIT: Record<string, StatusValue> = {
  "1": "new",
  "2": "interested",
  "3": "applied",
  "4": "interviewing",
  "5": "passed",
};

export function useKeyboardNav({
  visibleIds,
  focusedId,
  setFocusedId,
  selectedId,
  setSelectedId,
  onChangeStatus,
  focusSearch,
}: UseKeyboardNavArgs) {
  const lastKeyRef = useRef<string | null>(null);
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      const isInText = tag === "INPUT" || tag === "TEXTAREA";

      // Escape works even in inputs (to blur)
      if (e.key === "Escape") {
        if (isInText) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (selectedId) {
          e.preventDefault();
          setSelectedId(null);
          return;
        }
        if (focusedId) {
          setFocusedId(null);
          return;
        }
        return;
      }

      // All other keys yield to text inputs
      if (isInText) return;

      const ids = visibleIds();
      const idx = focusedId ? ids.indexOf(focusedId) : -1;

      const panelOpen = selectedId !== null;

      if (e.key === "j") {
        e.preventDefault();
        if (ids.length === 0) return;
        const next = idx < 0 ? 0 : Math.min(idx + 1, ids.length - 1);
        setFocusedId(ids[next]);
        if (panelOpen) setSelectedId(ids[next]);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        if (ids.length === 0) return;
        const next = idx < 0 ? 0 : Math.max(idx - 1, 0);
        setFocusedId(ids[next]);
        if (panelOpen) setSelectedId(ids[next]);
        return;
      }
      if (e.key === "Enter") {
        if (!panelOpen && focusedId) {
          e.preventDefault();
          setSelectedId(focusedId);
        }
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key === "G" && e.shiftKey) {
        e.preventDefault();
        if (ids.length > 0) {
          const last = ids[ids.length - 1];
          setFocusedId(last);
          if (panelOpen) setSelectedId(last);
        }
        return;
      }
      if (e.key === "g") {
        const now = Date.now();
        if (lastKeyRef.current === "g" && now - lastKeyTimeRef.current < 500) {
          e.preventDefault();
          if (ids.length > 0) {
            setFocusedId(ids[0]);
            if (panelOpen) setSelectedId(ids[0]);
          }
          lastKeyRef.current = null;
        } else {
          lastKeyRef.current = "g";
          lastKeyTimeRef.current = now;
        }
        return;
      }
      lastKeyRef.current = e.key;
      lastKeyTimeRef.current = Date.now();

      // Panel-mode digit shortcuts
      if (panelOpen && STATUS_BY_DIGIT[e.key]) {
        e.preventDefault();
        onChangeStatus(STATUS_BY_DIGIT[e.key]);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, setFocusedId, selectedId, setSelectedId, onChangeStatus, focusSearch, visibleIds]);
}
