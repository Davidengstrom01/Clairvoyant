import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  applyHunk,
  discard,
  fileDiff,
  removeWorktree,
  restoreTrash,
  stage,
  unstage,
  worktreeDiffs,
} from "../../lib/api";
import { plural } from "../../lib/format";
import { buildTree, folderPaths } from "../../lib/tree";
import { useGuard, useNotify } from "../../lib/notify";
import type { FileChange, Hunk, HunkAction, PathDiff, WorktreeDiffs, WorktreeSummary } from "../../lib/types";
import { useViewed } from "../../lib/viewed";
import {
  branchLabel,
  discardTargets,
  operationLabel,
  splitFiles,
  unstagePaths,
  type FileList as ListKind,
} from "../../lib/worktree";
import { DiffStack, stackKey, type DiffStackHandle, type StackGroup } from "../DiffStack";
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

export function WorktreeDetail({ repo, summary, version, onBack, onChanged }: Props) {
  const guard = useGuard();
  const notify = useNotify();
  const path = summary.path;
  const files = summary.status?.files ?? [];
  const lists = splitFiles(files);

  const [diffs, setDiffs] = useState<WorktreeDiffs | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  /** Key (`list:path`) of the file at the top of the diff pane. */
  const [current, setCurrent] = useState<string | null>(null);
  const stack = useRef<DiffStackHandle>(null);
  const [panel, setPanel] = useState<"stashes" | "trash">("stashes");
  const [dialog, setDialog] = useState<"stash" | "switch" | null>(null);
  // Folded folders per list, so folding in Changes doesn't fold Staged.
  const [collapsed, setCollapsed] = useState<Record<ListKind, Set<string>>>({
    unstaged: new Set(),
    staged: new Set(),
  });

  // Old diffs stay on screen until new ones arrive, so refreshes don't jump.
  useEffect(() => {
    let live = true;
    worktreeDiffs(path).then(
      (d) => live && (setDiffs(d), setDiffError(null)),
      (e) => live && setDiffError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [path, version]);

  const unstagedDiffs = diffs?.unstaged ?? null;
  // Conflicted files belong to Changes only, matching the left-hand lists.
  const stagedDiffs = useMemo(() => diffs?.staged.filter((d) => d.status !== "U") ?? null, [diffs]);
  const viewed = {
    unstaged: useViewed(`${path}:unstaged`, unstagedDiffs),
    staged: useViewed(`${path}:staged`, stagedDiffs),
  };

  const currentIn = (list: ListKind) =>
    current?.startsWith(`${list}:`) ? current.slice(list.length + 1) : null;
  const jumpTo = (list: ListKind) => (file: FileChange) => stack.current?.scrollTo(stackKey(list, file.path));
  const changeFor = (list: ListKind, file: PathDiff) => lists[list].find((f) => f.path === file.path);

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

  async function hunkAction(file: PathDiff, hunk: Hunk, action: HunkAction) {
    const id = await guard(() => applyHunk(path, file.path, hunk.header, action));
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

  const groups: StackGroup[] = [
    {
      id: "unstaged",
      title: "Changes",
      files: unstagedDiffs ?? [],
      viewed: viewed.unstaged,
      fileActions: (d) => {
        const file = changeFor("unstaged", d);
        if (!file) return null;
        return (
          <>
            {file.kind !== "conflicted" && (
              <Button size="sm" variant="danger" title="Discard changes (undoable)" onClick={() => discardFiles([file])}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={() => act(() => stage(path, [file.path]))}>
              {file.kind === "conflicted" ? "Mark resolved" : "Stage"}
            </Button>
          </>
        );
      },
      // Untracked files are staged whole; their "diff" is the full new file.
      hunkActions: (d, hunk) =>
        d.status === "?" ? null : (
          <>
            <Button size="sm" variant="danger" onClick={() => hunkAction(d, hunk, "discard")}>
              Discard hunk
            </Button>
            <Button size="sm" onClick={() => hunkAction(d, hunk, "stage")}>
              Stage hunk
            </Button>
          </>
        ),
      loadDeferred: (d) => fileDiff(path, d.path, null, d.status === "?" ? "untracked" : "unstaged"),
    },
    {
      id: "staged",
      title: "Staged",
      files: stagedDiffs ?? [],
      viewed: viewed.staged,
      fileActions: (d) => {
        const file = changeFor("staged", d);
        return (
          file && (
            <Button size="sm" onClick={() => act(() => unstage(path, unstagePaths([file])))}>
              Unstage
            </Button>
          )
        );
      },
      hunkActions: (d, hunk) => (
        <Button size="sm" onClick={() => hunkAction(d, hunk, "unstage")}>
          Unstage hunk
        </Button>
      ),
      loadDeferred: (d) => fileDiff(path, d.path, d.origPath, "staged"),
    },
  ];

  const viewedNote = (list: ListKind) => (viewed[list].count > 0 ? ` · ${viewed[list].count} viewed` : "");

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
              title={`Changes (${lists.unstaged.length})${viewedNote("unstaged")}`}
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
                current={currentIn("unstaged")}
                isViewed={viewed.unstaged.isViewed}
                collapsed={collapsed.unstaged}
                onToggleFolder={toggleFolder("unstaged")}
                onSelect={jumpTo("unstaged")}
                onStage={(targets) => act(() => stage(path, targets.map((f) => f.path)))}
                onDiscard={discardFiles}
              />
            </Section>
            <Section
              title={`Staged (${lists.staged.length})${viewedNote("staged")}`}
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
                current={currentIn("staged")}
                isViewed={viewed.staged.isViewed}
                collapsed={collapsed.staged}
                onToggleFolder={toggleFolder("staged")}
                onSelect={jumpTo("staged")}
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

        <main className="flex min-h-0 flex-col">
          {diffError && <p className="p-4 text-sm text-red-600">{diffError}</p>}
          {diffs === null && !diffError ? (
            <p className="p-4 text-sm text-zinc-500">Loading…</p>
          ) : (
            <DiffStack
              ref={stack}
              groups={groups}
              onCurrent={setCurrent}
              empty={<p className="p-6 text-sm text-zinc-500">Working tree clean. Nothing to review.</p>}
            />
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
