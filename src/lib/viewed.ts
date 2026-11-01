import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileDiff } from "./types";

/** path → fingerprint of the diff that was marked viewed. */
export type ViewedStore = Record<string, string>;

const PREFIX = "clairvoyant.viewed:";

/**
 * FNV-1a over the diff's headers and lines. The header carries git's blob
 * hashes, so even binary or not-yet-loaded diffs change fingerprint when the
 * file does.
 */
export function fingerprint(diff: FileDiff): string {
  let hash = 0x811c9dc5;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193);
  };
  diff.header.forEach(feed);
  for (const hunk of diff.hunks) {
    feed(hunk.header);
    for (const line of hunk.lines) feed(line.kind + line.text);
  }
  return (hash >>> 0).toString(16);
}

/** Keeps only marks whose file is still listed with the exact diff that was viewed. */
export function pruned(store: ViewedStore, prints: Map<string, string>): ViewedStore {
  return Object.fromEntries(Object.entries(store).filter(([path, print]) => prints.get(path) === print));
}

export function toggledMark(store: ViewedStore, path: string, print: string): ViewedStore {
  const next = { ...store };
  if (next[path] === print) delete next[path];
  else next[path] = print;
  return next;
}

export function loadStore(scope: string): ViewedStore {
  try {
    const raw = localStorage.getItem(PREFIX + scope);
    return raw ? (JSON.parse(raw) as ViewedStore) : {};
  } catch {
    return {};
  }
}

function saveStore(scope: string, store: ViewedStore) {
  try {
    if (Object.keys(store).length === 0) localStorage.removeItem(PREFIX + scope);
    else localStorage.setItem(PREFIX + scope, JSON.stringify(store));
  } catch {
    // Storage unavailable: marks last for this session only.
  }
}

export interface Viewed {
  isViewed: (path: string) => boolean;
  toggle: (path: string) => void;
  count: number;
}

/**
 * "Viewed" marks for one list of diffs, cached in local storage under `scope`.
 * A mark only counts while the file's diff is unchanged, so new edits
 * un-mark it. Pass `null` while diffs are loading so nothing gets pruned.
 */
export function useViewed(scope: string, diffs: { path: string; diff: FileDiff }[] | null): Viewed {
  const [store, setStore] = useState<ViewedStore>(() => loadStore(scope));

  useEffect(() => setStore(loadStore(scope)), [scope]);

  const prints = useMemo(() => new Map((diffs ?? []).map((d) => [d.path, fingerprint(d.diff)])), [diffs]);

  useEffect(() => {
    if (!diffs) return;
    setStore((current) => {
      const next = pruned(current, prints);
      if (Object.keys(next).length !== Object.keys(current).length) saveStore(scope, next);
      return next;
    });
  }, [diffs, prints, scope]);

  const isViewed = useCallback((path: string) => store[path] !== undefined && store[path] === prints.get(path), [store, prints]);

  const toggle = useCallback(
    (path: string) => {
      const print = prints.get(path);
      if (!print) return;
      setStore((current) => {
        const next = toggledMark(current, path, print);
        saveStore(scope, next);
        return next;
      });
    },
    [prints, scope],
  );

  const count = useMemo(() => [...prints.keys()].filter(isViewed).length, [prints, isViewed]);

  return { isViewed, toggle, count };
}
