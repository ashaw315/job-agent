"use client";

interface ToastProps {
  message: string | null;
  onRetry?: () => void;
  onDismiss: () => void;
}

export default function Toast({ message, onRetry, onDismiss }: ToastProps) {
  if (!message) return null;
  return (
    <div className="fixed bottom-4 left-4 z-40 flex items-center gap-3 rounded border border-[color:var(--border-strong)] bg-[color:var(--bg-panel)] px-3 py-2 text-[11px] text-[color:var(--text-pri)] shadow-lg">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-[color:var(--accent)] hover:underline">
          Retry
        </button>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]">
        ×
      </button>
    </div>
  );
}
