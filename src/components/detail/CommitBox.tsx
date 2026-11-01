import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commit, headIsPublished } from "../../lib/api";
import { useNotify } from "../../lib/notify";
import type { CommitOutput } from "../../lib/types";
import { Button, inputClass } from "../ui";

interface Props {
  worktree: string;
  stagedCount: number;
  hasHead: boolean;
  version: number;
  onCommitted: () => void;
}

export function CommitBox({ worktree, stagedCount, hasHead, version, onCommitted }: Props) {
  const notify = useNotify();
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [published, setPublished] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const outputEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    headIsPublished(worktree).then(setPublished, () => setPublished(false));
  }, [worktree, version]);

  useEffect(() => {
    if (published) setAmend(false);
  }, [published]);

  useEffect(() => {
    const unlisten = listen<CommitOutput>("commit-output", (e) => {
      if (e.payload.worktree === worktree) setOutput((prev) => [...prev, e.payload.line]);
    });
    return () => void unlisten.then((stop) => stop());
  }, [worktree]);

  useEffect(() => outputEnd.current?.scrollIntoView({ block: "nearest" }), [output]);

  const canCommit = !running && (amend ? hasHead : stagedCount > 0 && message.trim() !== "");

  async function submit() {
    setRunning(true);
    setOutput([]);
    setFailed(null);
    try {
      const head = await commit(worktree, message, amend);
      setMessage("");
      setAmend(false);
      notify({ message: `${amend ? "Amended" : "Committed"} ${head.slice(0, 7)}`, tone: "info" });
      onCommitted();
    } catch (e) {
      setFailed(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey && canCommit) void submit();
        }}
        rows={3}
        placeholder={amend ? "New message (leave empty to keep the current one)" : "Commit message"}
        className={`${inputClass} resize-y`}
      />
      <div className="flex items-center gap-3">
        <label
          className={`flex items-center gap-1.5 text-sm ${published || !hasHead ? "opacity-40" : ""}`}
          title={published ? "HEAD is already pushed; amending would rewrite published history" : undefined}
        >
          <input
            type="checkbox"
            checked={amend}
            disabled={published || !hasHead}
            onChange={(e) => setAmend(e.target.checked)}
          />
          Amend last commit
        </label>
        <Button variant="primary" className="ml-auto" disabled={!canCommit} onClick={submit} title="⌘↵">
          {running ? "Committing…" : amend ? "Amend" : `Commit ${stagedCount || ""}`.trim()}
        </Button>
      </div>
      {(running || failed || output.length > 0) && (
        <div className="max-h-40 overflow-y-auto rounded bg-zinc-950 p-2 font-mono text-xs text-zinc-200">
          {output.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {line}
            </div>
          ))}
          {running && <div className="text-zinc-500">running hooks…</div>}
          {failed && <div className="mt-1 whitespace-pre-wrap text-red-400">{failed}</div>}
          <div ref={outputEnd} />
        </div>
      )}
    </div>
  );
}
