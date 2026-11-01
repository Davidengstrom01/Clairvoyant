import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { plural } from "../lib/format";
import { buildTree, flattenTree } from "../lib/tree";
import type { FileDiff, Hunk, PathDiff } from "../lib/types";
import type { Viewed } from "../lib/viewed";
import { DiffView } from "./DiffView";
import { letterColor } from "./detail/FileList";
import { Button } from "./ui";

export interface StackGroup {
  /** Prefix of each file's key, e.g. "unstaged"; keys are `${id}:${path}`. */
  id: string;
  title: string;
  files: PathDiff[];
  viewed: Viewed;
  fileActions?: (file: PathDiff) => ReactNode;
  hunkActions?: (file: PathDiff, hunk: Hunk) => ReactNode;
  /** Fetches a file the backend left out to stay within its size budget. */
  loadDeferred?: (file: PathDiff) => Promise<FileDiff>;
}

export interface DiffStackHandle {
  /** Scrolls a file's section to the top; scrolling on continues into the next file. */
  scrollTo: (key: string) => void;
}

export const stackKey = (groupId: string, path: string) => `${groupId}:${path}`;

/** Same letters as the tree: git reports untracked files as `?`, the tree shows U. */
const letter = (file: PathDiff) => (file.status === "?" ? "U" : file.status);

interface Props {
  groups: StackGroup[];
  /** The file whose section is at the top of the pane, for highlighting it in the tree. */
  onCurrent?: (key: string | null) => void;
  empty?: ReactNode;
  ref?: Ref<DiffStackHandle>;
}

/** Every file's diff in one scrollable column, in the same order as the tree. */
export function DiffStack({ groups, onCurrent, empty, ref }: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Explicit fold state; files without an entry are open unless viewed.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Record<string, FileDiff>>({});
  const current = useRef<string | null>(null);

  const ordered = useMemo(
    () => groups.map((g) => ({ ...g, files: flattenTree(buildTree(g.files)) })),
    [groups],
  );
  // Which sections exist; effects re-run when this changes, not on every refresh.
  const layout = ordered.map((g) => `${g.id}\n${g.files.map((f) => f.path).join("\0")}`).join("\n\n");

  useImperativeHandle(ref, () => ({
    scrollTo(key) {
      // A folded (e.g. viewed) file opens when you jump to it.
      setOpenOverride((o) => ({ ...o, [key]: true }));
      requestAnimationFrame(() => {
        const el = container.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
        if (!el || !container.current) return;
        container.current.scrollTo({ top: el.offsetTop });
      });
    },
  }));

  // Colour only diffs near the viewport; keeps long reviews responsive.
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.key!);
        if (visible.length) setSeen((s) => (visible.every((k) => s.has(k)) ? s : new Set([...s, ...visible])));
      },
      { root, rootMargin: "800px 0px" },
    );
    root.querySelectorAll("[data-key]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [layout]);

  // Scroll-spy: the last section whose top has scrolled past the top edge.
  useEffect(() => {
    const root = container.current;
    if (!root || !onCurrent) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let key: string | null = null;
      for (const el of root.querySelectorAll<HTMLElement>("[data-key]")) {
        if (el.offsetTop > root.scrollTop + 4) break;
        key = el.dataset.key!;
      }
      key ??= root.querySelector<HTMLElement>("[data-key]")?.dataset.key ?? null;
      if (key !== current.current) {
        current.current = key;
        onCurrent(key);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [layout, onCurrent]);

  const total = ordered.reduce((n, g) => n + g.files.length, 0);

  return (
    <div ref={container} className="relative min-h-0 flex-1 overflow-y-auto">
      {total === 0
        ? empty
        : ordered
            .filter((g) => g.files.length > 0)
            .map((group) => (
              <div key={group.id}>
                <h3 className="border-b border-zinc-200 bg-zinc-100 px-3 py-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900">
                  {group.title} · {group.viewed.count} / {plural(group.files.length, "file")} viewed
                </h3>
                {group.files.map((file) => {
                  const key = stackKey(group.id, file.path);
                  const viewed = group.viewed.isViewed(file.path);
                  const open = openOverride[key] ?? !viewed;
                  const diff = loaded[key] ?? file.diff;
                  const deferred = file.deferred && !loaded[key];
                  return (
                    <section key={key} data-key={key} className="border-b border-zinc-200 dark:border-zinc-800">
                      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                        <button
                          aria-label={open ? "Fold file" : "Unfold file"}
                          onClick={() => setOpenOverride((o) => ({ ...o, [key]: !open }))}
                          className={`w-4 text-[10px] text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
                        >
                          ▶
                        </button>
                        <span className={`w-3 text-center font-mono text-xs ${letterColor[letter(file)] ?? ""}`}>{letter(file)}</span>
                        <span className={`min-w-0 truncate font-mono text-xs ${viewed ? "text-zinc-400" : ""}`} title={file.path}>
                          {file.origPath && <span className="text-zinc-400">{file.origPath} → </span>}
                          {file.path}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-2">
                          {group.fileActions?.(file)}
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 select-none dark:text-zinc-400">
                            <input
                              type="checkbox"
                              checked={viewed}
                              onChange={() => {
                                group.viewed.toggle(file.path);
                                // Let the default take over: viewed folds, un-viewed unfolds.
                                setOpenOverride(({ [key]: _, ...rest }) => rest);
                              }}
                            />
                            Viewed
                          </label>
                        </span>
                      </header>
                      {open &&
                        (deferred ? (
                          <div className="flex items-center gap-3 p-4 text-sm text-zinc-500">
                            Large change set: this diff wasn't loaded up front.
                            {group.loadDeferred && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  group.loadDeferred!(file).then(
                                    (d) => setLoaded((l) => ({ ...l, [key]: d })),
                                    () => {},
                                  )
                                }
                              >
                                Load diff
                              </Button>
                            )}
                          </div>
                        ) : (
                          <DiffView
                            diff={diff}
                            path={file.path}
                            highlight={seen.has(key)}
                            hunkActions={group.hunkActions && ((hunk) => group.hunkActions!(file, hunk))}
                          />
                        ))}
                    </section>
                  );
                })}
              </div>
            ))}
    </div>
  );
}
