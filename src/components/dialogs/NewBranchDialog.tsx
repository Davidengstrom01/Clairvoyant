import { useState } from "react";
import { createBranch } from "../../lib/api";
import { useGuard } from "../../lib/notify";
import type { Branch } from "../../lib/types";
import { Button, Field, Modal, inputClass } from "../ui";

export function NewBranchDialog({
  repo,
  branches,
  onClose,
  onDone,
}: {
  repo: string;
  branches: Branch[];
  onClose: () => void;
  onDone: () => void;
}) {
  const guard = useGuard();
  const [name, setName] = useState("");
  const [start, setStart] = useState(branches.find((b) => b.isDefault)?.name ?? "HEAD");

  async function submit() {
    const done = await guard(() => createBranch(repo, name.trim(), start));
    if (done !== undefined) {
      onDone();
      onClose();
    }
  }

  return (
    <Modal
      title="New branch"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            Create branch
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input
          autoFocus
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && void submit()}
        />
      </Field>
      <Field label="Start from" hint="Creates the branch only; nothing is checked out.">
        <select className={inputClass} value={start} onChange={(e) => setStart(e.target.value)}>
          <option value="HEAD">HEAD of the main worktree</option>
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}
