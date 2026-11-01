import type { ReactNode } from "react";
import type { DiffLine, FileDiff, Hunk } from "../lib/types";

const lineStyle: Record<DiffLine["kind"], string> = {
  context: "",
  added: "bg-emerald-50 dark:bg-emerald-950/50",
  removed: "bg-red-50 dark:bg-red-950/50",
  noNewline: "text-zinc-400 italic",
};

const prefix: Record<DiffLine["kind"], string> = { context: " ", added: "+", removed: "-", noNewline: "" };

/** Renders a parsed diff; `hunkActions` adds buttons to each hunk header. */
export function DiffView({ diff, hunkActions }: { diff: FileDiff; hunkActions?: (hunk: Hunk) => ReactNode }) {
  if (diff.binary) return <p className="p-4 text-sm text-zinc-500">Binary file; no text diff to show.</p>;
  if (diff.hunks.length === 0) return <p className="p-4 text-sm text-zinc-500">No changes.</p>;

  return (
    <div className="font-mono text-xs leading-5">
      {diff.combined && (
        <p className="border-b border-zinc-200 px-3 py-2 font-sans text-amber-700 dark:border-zinc-800 dark:text-amber-300">
          Conflicted file. Resolve the markers in your editor, then stage it to mark it resolved.
        </p>
      )}
      {diff.hunks.map((hunk, i) => (
        <div key={`${i}-${hunk.header}`} className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="sticky top-0 flex items-center gap-2 bg-zinc-100 px-3 py-1 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <span className="truncate">{hunk.header}</span>
            {!diff.combined && hunkActions && <div className="ml-auto flex gap-1 font-sans">{hunkActions(hunk)}</div>}
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {hunk.lines.map((line, j) => (
                <tr key={j} className={lineStyle[line.kind]}>
                  <td className="w-10 pr-2 text-right text-zinc-400 select-none">{line.oldLine ?? ""}</td>
                  <td className="w-10 pr-2 text-right text-zinc-400 select-none">{line.newLine ?? ""}</td>
                  <td className="w-4 text-zinc-400 select-none">{prefix[line.kind]}</td>
                  <td className="pr-3 break-all whitespace-pre-wrap">
                    {line.kind === "noNewline" ? "No newline at end of file" : line.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {diff.truncated && (
        <p className="p-3 font-sans text-sm text-zinc-500">Diff cut short; open the file in your editor for the rest.</p>
      )}
    </div>
  );
}
