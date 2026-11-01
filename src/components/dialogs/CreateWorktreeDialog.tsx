import { useEffect, useState } from "react";
import { addWorktree, branches as loadBranches, suggestWorktreePath } from "../../lib/api";
import { defaultBranch, localName } from "../../lib/branches";
import { useGuard } from "../../lib/notify";
import type { Branch } from "../../lib/types";
import { Button, Field, Modal, inputClass } from "../ui";

interface Props {
  repo: string;
  /** Preselects "existing branch" mode with this branch. */
  branch?: Branch;
  onClose: () => void;
  onCreated: (path: string) => void;
}

export function CreateWorktreeDialog({ repo, branch, onClose, onCreated }: Props) {
  const guard = useGuard();
  const [all, setAll] = useState<Branch[]>([]);
  const [mode, setMode] = useState<"new" | "existing">(branch ? "existing" : "new");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [existing, setExisting] = useState(branch?.name ?? "");
  const [path, setPath] = useState("");
  const [pathEdited, setPathEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    guard(() => loadBranches(repo)).then((list) => {
      if (!list) return;
      setAll(list);
      setStart((s) => s || defaultBranch(list)?.name || "HEAD");
    });
  }, [repo, guard]);

  const available = all.filter((b) => b.worktree === null && !b.isDefault);
  const picked = all.find((b) => b.name === existing);
  // A remote branch becomes a new local branch tracking it.
  const branchName = mode === "new" ? name.trim() : picked ? (picked.remote ? localName(picked.name) : picked.name) : "";

  useEffect(() => {
    if (pathEdited || !branchName) return;
    let current = true;
    suggestWorktreePath(repo, branchName).then((p) => current && setPath(p), () => {});
    return () => {
      current = false;
    };
  }, [repo, branchName, pathEdited]);

  async function submit() {
    setBusy(true);
    const created =
      mode === "new"
        ? await guard(() => addWorktree(repo, path, branchName, true, start || null))
        : picked?.remote
          ? await guard(() => addWorktree(repo, path, branchName, true, picked.name))
          : await guard(() => addWorktree(repo, path, branchName, false, null));
    setBusy(false);
    if (created !== undefined) {
      onCreated(path);
      onClose();
    }
  }

  return (
    <Modal
      title="New worktree"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !branchName || !path}>
            {busy ? "Creating…" : "Create worktree"}
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        {(["new", "existing"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1.5">
            <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
            {m === "new" ? "New branch" : "Existing branch"}
          </label>
        ))}
      </div>

      {mode === "new" ? (
        <>
          <Field label="Branch name">
            <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/my-change" />
          </Field>
          <Field label="Start from">
            <select className={inputClass} value={start} onChange={(e) => setStart(e.target.value)}>
              <option value="HEAD">HEAD of the main worktree</option>
              {all.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <Field label="Branch" hint="Branches already checked out elsewhere aren't listed; git allows one worktree per branch.">
          <select className={inputClass} value={existing} onChange={(e) => setExisting(e.target.value)}>
            <option value="">Choose…</option>
            {available.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.remote ? ` (creates ${localName(b.name)})` : ""}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Folder" hint="Defaults to the repo's worktree root; change the root in Settings.">
        <input
          className={`${inputClass} font-mono text-xs`}
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setPathEdited(true);
          }}
        />
      </Field>
    </Modal>
  );
}
