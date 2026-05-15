"use client";

import { useState, useEffect, useRef } from "react";

interface DangerActionProps {
  label: string;
  description: string;
  confirmText: string;
  buttonText: string;
  /** If true, no two-click reveal — single click fires onAction. Used for export (non-destructive). */
  noConfirm?: boolean;
  onAction: () => Promise<void>;
}

export default function DangerAction({ label, description, confirmText, buttonText, noConfirm, onAction }: DangerActionProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleClick = async () => {
    if (noConfirm) {
      setBusy(true);
      try { await onAction(); } finally { setBusy(false); }
      return;
    }
    if (!confirming) {
      setConfirming(true);
      timeoutRef.current = setTimeout(() => setConfirming(false), 5000);
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setConfirming(false);
    setBusy(true);
    try { await onAction(); } finally { setBusy(false); }
  };

  return (
    <div className="flex items-start justify-between gap-4 border-t border-[color:rgba(196,126,126,0.2)] py-3 first:border-t-0">
      <div className="flex-1">
        <div className="text-[12px] text-[color:var(--text-pri)] font-medium">{label}</div>
        <div className="mt-1 text-[11px] text-[color:var(--text-sec)] whitespace-pre-line">{description}</div>
      </div>
      <button
        onClick={handleClick}
        disabled={busy}
        className={
          "shrink-0 rounded border px-3 py-1 text-[11px] " +
          (confirming
            ? "border-[color:var(--danger)] text-[color:var(--danger)] bg-[color:var(--danger-bg)]"
            : "border-[color:rgba(196,126,126,0.3)] text-[color:var(--danger)] hover:bg-[color:var(--danger-bg)]")
        }
      >
        {busy ? "…" : confirming ? confirmText : buttonText}
      </button>
    </div>
  );
}
