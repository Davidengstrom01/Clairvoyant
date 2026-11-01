import { useState } from "react";
import { stashPush } from "../../lib/api";
import { useGuard } from "../../lib/notify";
import { Button, Field, Modal, inputClass } from "../ui";

export function StashDialog({ worktree, onClose, onDone }: { worktree: string; onClose: () => void; onDone: () => void }) {
  const guard = useGuard();
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const done = await guard(() => stashPush(worktree, message || null, includeUntracked));
    setBusy(false);
    if (done !== undefined) {
      onDone();
      onClose();
    }
  }

  return (
    <Modal
      title="Stash changes"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            Stash
          </Button>
        </>
      }
    >
      <Field label="Message" hint="Optional. Helps you find it again; the stash list is shared by all worktrees.">
        <input
          autoFocus
          className={inputClass}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
      </Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} />
        Include untracked files
      </label>
    </Modal>
  );
}
