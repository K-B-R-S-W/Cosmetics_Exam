"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  success(message: string): void;
  error(message: string): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const SUCCESS_DURATION_MS = 4_000;
const MAX_VISIBLE_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const itemsRef = useRef<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const nextItems = itemsRef.current.filter((item) => item.id !== id);
    itemsRef.current = nextItems;
    setItems(nextItems);
  }, []);

  const add = useCallback((kind: ToastKind, message: string) => {
    const duplicate = itemsRef.current.find((item) => item.kind === kind && item.message === message);
    if (duplicate) {
      if (kind === "success") {
        const timer = timers.current.get(duplicate.id);
        if (timer) clearTimeout(timer);
        timers.current.set(
          duplicate.id,
          setTimeout(() => dismiss(duplicate.id), SUCCESS_DURATION_MS),
        );
      }
      return;
    }

    nextId.current += 1;
    const item = { id: nextId.current, kind, message };
    const nextItems = [...itemsRef.current, item].slice(-MAX_VISIBLE_TOASTS);
    const visibleIds = new Set(nextItems.map((visibleItem) => visibleItem.id));
    for (const existing of itemsRef.current) {
      if (!visibleIds.has(existing.id)) {
        const timer = timers.current.get(existing.id);
        if (timer) clearTimeout(timer);
        timers.current.delete(existing.id);
      }
    }
    itemsRef.current = nextItems;
    setItems(nextItems);
    if (kind === "success") {
      timers.current.set(
        item.id,
        setTimeout(() => dismiss(item.id), SUCCESS_DURATION_MS),
      );
    }
  }, [dismiss]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  return (
    <ToastContext.Provider
      value={{
        success: (message) => add("success", message),
        error: (message) => add("error", message),
      }}
    >
      {children}
      <div
        className="pointer-events-none fixed right-5 top-[4.5rem] z-50 flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-3"
        data-testid="toast-container"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.kind === "error" ? "alert" : "status"}
            aria-live={item.kind === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            className={`pointer-events-auto flex items-start justify-between gap-3 border-l-4 bg-surface px-4 py-3 text-ink shadow-dialog ${item.kind === "error" ? "border-alert" : "border-ok"}`}
          >
            <p>{item.message}</p>
            <button
              type="button"
              className="min-h-11 min-w-11 font-bold text-ink hover:bg-selected"
              aria-label="Close notification"
              onClick={() => dismiss(item.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider.");
  return context;
}
