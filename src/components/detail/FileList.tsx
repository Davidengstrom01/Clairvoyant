import type { FileChange } from "../../lib/types";
import { statusLetter, type FileList as ListKind } from "../../lib/worktree";
import { Button } from "../ui";

const letterColor: Record<string, string> = {
  M: "text-amber-600",
  A: "text-emerald-600",
  D: "text-red-600",
  R: "text-sky-600",
  U: "text-sky-600",
  "!": "text-red-600 font-bold",
};

interface Props {
  list: ListKind;
  files: FileChange[];
  selected: string | null;
  onSelect: (file: FileChange) => void;
  onStage?: (file: FileChange) => void;
  onUnstage?: (file: FileChange) => void;
  onDiscard?: (file: FileChange) => void;
}

export function FileList({ list, files, selected, onSelect, onStage, onUnstage, onDiscard }: Props) {
  if (files.length === 0) {
    return <p className="px-3 py-2 text-xs text-zinc-400">{list === "staged" ? "Nothing staged" : "No changes"}</p>;
  }
  return (
    <ul className="overflow-y-auto">
      {files.map((file) => {
        const letter = statusLetter(file, list);
        const isSelected = selected === file.path;
        const slash = file.path.lastIndexOf("/");
        return (
          <li
            key={file.path}
            onClick={() => onSelect(file)}
            className={`group flex cursor-pointer items-center gap-2 px-3 py-1 text-sm ${
              isSelected ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            <span className={`w-3 shrink-0 text-center font-mono text-xs ${letterColor[letter] ?? ""}`}>{letter}</span>
            <span className="min-w-0 flex-1 truncate" title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
              {file.path.slice(slash + 1)}
              {slash > 0 && <span className="ml-1.5 text-xs text-zinc-400">{file.path.slice(0, slash)}</span>}
            </span>
            <span className={`flex gap-1 ${isSelected ? "" : "invisible group-hover:visible"}`}>
              {onDiscard && file.kind !== "conflicted" && (
                <Button
                  size="sm"
                  variant="danger"
                  title="Discard changes (undoable)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscard(file);
                  }}
                >
                  Discard
                </Button>
              )}
              {onStage && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStage(file);
                  }}
                >
                  {file.kind === "conflicted" ? "Mark resolved" : "Stage"}
                </Button>
              )}
              {onUnstage && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnstage(file);
                  }}
                >
                  Unstage
                </Button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
