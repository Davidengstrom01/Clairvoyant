import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { applyHunk, discard, fileDiff, removeWorktree, restoreTrash, stage, unstage } from "../../lib/api";
import { plural } from "../../lib/format";
import { buildTree, folderPaths } from "../../lib/tree";
import { useGuard, useNotify } from "../../lib/notify";
import type { FileChange, FileDiff, Hunk, HunkAction, WorktreeSummary } from "../../lib/types";
import {
  branchLabel,
  diffSource,
  discardTargets,
  operationLabel,
  splitFiles,
  unstagePaths,
  type FileList as ListKind,
} from "../../lib/worktree";
import { DiffView } from "../DiffView";
import { toggled } from "../FileTree";
import { StashDialog } from "../dialogs/StashDialog";
import { SwitchBranchDialog } from "../dialogs/SwitchBranchDialog";
import { JumpOuts } from "../JumpOuts";
import { Button, Chip, Section } from "../ui";
import { CommitBox } from "./CommitBox";
import { FileList } from "./FileList";
import { StashPanel, TrashPanel } from "./SidePanels";

interface Props {
  repo: string;
  summary: WorktreeSummary;
  /** Bumped whenever this worktree was refreshed, so dependent data reloads. */
  version: number;
  onBack: () => void;
  onChanged: () => void;
}

interface Selection {
  list: ListKind;
  path: string;
}

export function WorktreeDetail({ repo, summary, version, onBack, onChanged }: Props) {
  const guard = useGuard();
  const notify = useNotify();
  const path = summary.path;
  const files = summary.status?.files ?? [];
  const lists = splitFiles(files);

  const [chosen, setChosen] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"stashes" | "trash">("stashes");
  const [dialog, setDialog] = useState<"stash" | "switch" | null>(null);
  // Folded folders per list, so folding in Changes doesn't fold Staged.
  const [collapsed, setCollapsed] = useState<Record<ListKind, Set<string>>>({
    unstaged: new Set(),
    staged: new Set(),
  });

  // Fall back to the first file when the chosen one was staged, committed or discarded.
  const chosenFile = chosen && lists[chosen.list].find((f) => f.path === chosen.path);
  const selection: Selection | null = chosenFile
    ? chosen
    : lists.unstaged[0]
      ? { list: "unstaged", path: lists.unstaged[0].path }
      : lists.staged[0]
        ? { list: "staged", path: lists.staged[0].path }
        : null;
  const selectedFile = selection ? lists[selection.list].find((f) => f.path === selection.path)! : null;
  const source = selectedFile && selection ? diffSource(selectedFile, selection.list) : null;
  const origPath = source === "staged" ? (selectedFile?.origPath ?? null) : null;

  useEffect(() => {
    if (!selectedFile || !source) {
      setDiff(null);
      return;
    }
    let current = true;
    fileDiff(path, selectedFile.path, origPath, source).then(
      (d) => current && (setDiff(d), setDiffError(null)),
      (e) => current && (setDiff(null), setDiffError(String(e))),
    );
    return () => {
      current = false;
    };
    // Keyed on the file's path, not the object, which is recreated on every refresh.
  }, [path, selectedFile?.path, origPath, source, version]);

  async function act(action: () => Promise<unknown>) {
    await guard(action);
    onChanged();
  }

  function offerUndo(message: string, trashId: string) {
    notify({
      message,
      tone: "info",
      action: { label: "Undo", run: () => void act(() => restoreTrash(path, trashId)) },
    });
  }

  async function discardFiles(targets: FileChange[]) {
    const { tracked, untracked } = discardTargets(targets);
    const id = await guard(() => discard(path, tracked, untracked));
    onChanged();
    if (id) offerUndo(`Discarded ${plural(tracked.length + untracked.length, "file")}`, id);
  }

  async function hunkAction(hunk: Hunk, action: HunkAction) {
    if (!selectedFile) return;
    const id = await guard(() => applyHunk(path, selectedFile.path, hunk.header, action));
    onChanged();
    if (id) offerUndo("Discarded hunk", id);
  }

  async function confirmRemove() {
    const dirty = files.length;
    const ok = await ask(
      dirty
        ? `This worktree has ${plural(dirty, "uncommitted change")}. Remove it anyway? A copy of the changes stays in git (refs/clairvoyant/trash) for 14 days.`
        : `Remove the worktree at ${path}? The branch is kept.`,
      { title: "Remove worktree", kind: "warning", okLabel: "Remove" },
    );
    if (!ok) return;
    const done = await guard(() => removeWorktree(repo, path, dirty > 0));
    if (done !== undefined) {
      onBack();
      onChanged();
    }
  }

  const hunkActions = (hunk: Hunk) =>
    source === "unstaged" ? (
      <>
        <Button size="sm" variant="danger" onClick={() => hunkAction(hunk, "discard")}>
          Discard hunk
        </Button>
        <Button size="sm" onClick={() => hunkAction(hunk, "stage")}>
          Stage hunk
        </Button>
      </>
    ) : source === "staged" ? (
      <Button size="sm" onClick={() => hunkAction(hunk, "unstage")}>
        Unstage hunk
      </Button>
    ) : null;

  const stageable = lists.unstaged.filter((f) => f.kind !== "conflicted");
  const discardable = lists.unstaged.filter((f) => f.kind !== "conflicted");

  const toggleFolder = (list: ListKind) => (folder: string) =>
    setCollapsed((c) => ({ ...c, [list]: toggled(c[list], folder) }));

  /** "Collapse" folds every folder; once anything is folded it offers "Expand". */
  const foldButton = (list: ListKind) => {
    const folders = folderPaths(buildTree(lists[list]));
    if (folders.length === 0) return null;
    const anyFolded = collapsed[list].size > 0;
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setCollapsed((c) => ({ ...c, [list]: new Set(anyFolded ? [] : folders) }))}
      >
        {anyFolded ? "Expand" : "Collapse"}
      </Button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← All worktrees
        </Button>
        <h2 className="font-mono font-semibold">{branchLabel(summary)}</h2>
        <span className="truncate text-xs text-zinc-500" title={path}>
          {path}
        </span>
        {summary.operation && <Chip tone="violet">{operationLabel[summary.operation]}</Chip>}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <JumpOuts path={path} />
          <Button size="sm" onClick={() => setDialog("switch")}>
            Switch branch
          </Button>
          <Button size="sm" onClick={() => setDialog("stash")} disabled={files.length === 0}>
            Stash changes
          </Button>
          {!summary.isMain && (
            <Button size="sm" variant="danger" onClick={confirmRemove}>
              Remove worktree
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,26rem)_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <Section
              title={`Changes (${lists.unstaged.length})`}
              actions={
                <>
                  {foldButton("unstaged")}
                  <Button size="sm" variant="danger" disabled={discardable.length === 0} onClick={() => discardFiles(discardable)}>
                    Discard all
                  </Button>
                  <Button
                    size="sm"
                    disabled={stageable.length === 0}
                    onClick={() => act(() => stage(path, stageable.map((f) => f.path)))}
                  >
                    Stage all
                  </Button>
                </>
              }
            >
              <FileList
                list="unstaged"
                files={lists.unstaged}
                selected={selection?.list === "unstaged" ? selection.path : null}
                collapsed={collapsed.unstaged}
                onToggleFolder={toggleFolder("unstaged")}
                onSelect={(f) => setChosen({ list: "unstaged", path: f.path })}
                onStage={(targets) => act(() => stage(path, targets.map((f) => f.path)))}
                onDiscard={discardFiles}
              />
            </Section>
            <Section
              title={`Staged (${lists.staged.length})`}
              actions={
                <>
                  {foldButton("staged")}
                  <Button
                    size="sm"
                    disabled={lists.staged.length === 0}
                    onClick={() => act(() => unstage(path, unstagePaths(lists.staged)))}
                  >
                    Unstage all
                  </Button>
                </>
              }
            >
              <FileList
                list="staged"
                files={lists.staged}
                selected={selection?.list === "staged" ? selection.path : null}
                collapsed={collapsed.staged}
                onToggleFolder={toggleFolder("staged")}
                onSelect={(f) => setChosen({ list: "staged", path: f.path })}
                onUnstage={(targets) => act(() => unstage(path, unstagePaths(targets)))}
              />
            </Section>
          </div>

          <CommitBox
            worktree={path}
            stagedCount={lists.staged.length}
            hasHead={Boolean(summary.status?.headOid)}
            version={version}
            onCommitted={onChanged}
          />

          <div className="flex max-h-56 min-h-0 flex-col border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex gap-1 px-2 pt-2">
              {(["stashes", "trash"] as const).map((p) => (
                <Button key={p} size="sm" variant={panel === p ? "secondary" : "ghost"} onClick={() => setPanel(p)}>
                  {p === "stashes" ? "Stashes" : "Recently discarded"}
                </Button>
              ))}
            </div>
            {panel === "stashes" ? (
              <StashPanel repo={repo} worktree={path} version={version} onChanged={onChanged} />
            ) : (
              <TrashPanel repo={repo} worktree={path} version={version} onChanged={onChanged} />
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto">
          {selectedFile ? (
            <>
              <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-950">
                {selectedFile.origPath && source === "staged" && (
                  <span className="text-zinc-400">{selectedFile.origPath} → </span>
                )}
                {selectedFile.path}
                <span className="ml-2 font-sans text-zinc-400">{source}</span>
              </div>
              {diffError ? (
                <p className="p-4 text-sm text-red-600">{diffError}</p>
              ) : diff ? (
                <DiffView diff={diff} path={selectedFile.path} hunkActions={hunkActions} />
              ) : (
                <p className="p-4 text-sm text-zinc-500">Loading…</p>
              )}
            </>
          ) : (
            <p className="p-6 text-sm text-zinc-500">Working tree clean. Nothing to review.</p>
          )}
        </main>
      </div>

      {dialog === "stash" && <StashDialog worktree={path} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === "switch" && (
        <SwitchBranchDialog repo={repo} worktree={path} onClose={() => setDialog(null)} onDone={onChanged} />
      )}
    </div>
  );
}
