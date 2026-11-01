import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export interface Notice {
  id: number;
  message: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
}

type Notify = (notice: Omit<Notice, "id">) => void;

const NotifyContext = createContext<Notify>(() => {});

export const useNotify = () => useContext(NotifyContext);

/** Runs an action and reports a failure as an error notice; resolves to undefined on failure. */
export function useGuard() {
  const notify = useNotify();
  return useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await action();
      } catch (e) {
        notify({ message: String(e), tone: "error" });
        return undefined;
      }
    },
    [notify],
  );
}

let nextId = 1;

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);

  const dismiss = useCallback((id: number) => setNotices((prev) => prev.filter((n) => n.id !== id)), []);

  const notify = useCallback<Notify>(
    (notice) => {
      const id = nextId++;
      setNotices((prev) => [...prev.slice(-3), { ...notice, id }]);
      // Errors stay until dismissed; undo offers stay long enough to react.
      if (notice.tone === "info") setTimeout(() => dismiss(id), notice.action ? 10_000 : 4_000);
    },
    [dismiss],
  );

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <div className="fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
        {notices.map((n) => (
          <div
            key={n.id}
            role={n.tone === "error" ? "alert" : "status"}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg ${
              n.tone === "error"
                ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">{n.message}</p>
            {n.action && (
              <button
                className="font-semibold underline"
                onClick={() => {
                  n.action!.run();
                  dismiss(n.id);
                }}
              >
                {n.action.label}
              </button>
            )}
            <button aria-label="Dismiss" className="text-zinc-400 hover:text-zinc-700" onClick={() => dismiss(n.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </NotifyContext.Provider>
  );
}
