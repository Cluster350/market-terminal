// Hinweise unten rechts: Kursalarme und wichtige Nachrichten in einer gemeinsamen Liste.

import { dismissToast, useToasts } from "../lib/toasts";

export function ToastHost() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="alert">
          <span className="toast-bell" aria-hidden="true">{t.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div className="toast-msg">{t.message}</div>
            <div className="xs muted">{t.meta}</div>
          </div>
          {t.action ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="tool" aria-label="Hinweis schließen" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
