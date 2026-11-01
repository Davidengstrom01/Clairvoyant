import type { FileChange } from "../../lib/types";
import { statusLetter, type FileList as ListKind } from "../../lib/worktree";
import { FileTree } from "../FileTree";
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
  collapsed: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelect: (file: FileChange) => void;
  /** Each action takes one file, or every file under a folder. */
  onStage?: (files: FileChange[]) => void;
  onUnstage?: (files: FileChange[]) => void;
  onDiscard?: (files: FileChange[]) => void;
}

/** Stops the click from also selecting the row or folding the folder. */
const only = (run: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  run();
};

export function FileList({ list, files, selected, collapsed, onToggleFolder, onSelect, onStage, onUnstage, onDiscard }: Props) {
  if (files.length === 0) {
    return <p className="px-3 py-2 text-xs text-zinc-400">{list === "staged" ? "Nothing staged" : "No changes"}</p>;
  }

  const actions = (targets: FileChange[], single: boolean) => {
    const notConflicted = targets.filter((f) => f.kind !== "conflicted");
    const resolving = single && targets[0].kind === "conflicted";
    return (
      <>
        {onDiscard && notConflicted.length > 0 && (
          <Button size="sm" variant="danger" title="Discard changes (undoable)" onClick={only(() => onDiscard(notConflicted))}>
            Discard
          </Button>
        )}
        {onStage && (resolving || notConflicted.length > 0) && (
          <Button size="sm" onClick={only(() => onStage(resolving ? targets : notConflicted))}>
            {resolving ? "Mark resolved" : "Stage"}
          </Button>
        )}
        {onUnstage && (
          <Button size="sm" onClick={only(() => onUnstage(targets))}>
            Unstage
          </Button>
        )}
      </>
    );
  };

  return (
    <FileTree
      items={files}
      collapsed={collapsed}
      onToggle={onToggleFolder}
      folderActions={(folder) => actions(folder.items, false)}
      renderFile={(file, name, indent) => {
        const letter = statusLetter(file, list);
        const isSelected = selected === file.path;
        return (
          <li
            key={file.path}
            onClick={() => onSelect(file)}
            style={{ paddingLeft: indent }}
            className={`group flex cursor-pointer items-center gap-2 py-0.5 pr-3 text-sm ${
              isSelected ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            <span className={`w-3 shrink-0 text-center font-mono text-xs ${letterColor[letter] ?? ""}`}>{letter}</span>
            <span className="min-w-0 flex-1 truncate" title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
              {name}
            </span>
            <span className={`flex gap-1 ${isSelected ? "" : "invisible group-hover:visible"}`}>{actions([file], true)}</span>
          </li>
        );
      }}
    />
  );
}
