// Gemeinsame Hinweise unten rechts (Kursalarme, wichtige Nachrichten) – eine Liste, damit sich
// Hinweise verschiedener Herkunft nicht überdecken.

import { useSyncExternalStore } from "react";

export interface Toast {
  id: string;
  kind: "alert" | "news" | "urgent";
  icon: string;
  message: string;
  meta: string;
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Hinweis zeigen (neueste oben, höchstens 5) und nach `ttl` Millisekunden ausblenden. */
export function pushToast(t: Toast, ttl = 60_000) {
  toasts = [t, ...toasts.filter((x) => x.id !== t.id)].slice(0, 5);
  emit();
  if (ttl > 0) setTimeout(() => dismissToast(t.id), ttl);
}

export function dismissToast(id: string) {
  const next = toasts.filter((x) => x.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

export const currentToasts = (): Toast[] => toasts;

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    currentToasts,
  );
}
