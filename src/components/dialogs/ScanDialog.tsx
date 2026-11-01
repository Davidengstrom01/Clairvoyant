import { useEffect, useState } from "react";
import { addRepo, scanFolder } from "../../lib/api";
import { useGuard } from "../../lib/notify";
import { Button, Modal } from "../ui";

/** Shows repos found under `root` that aren't registered yet, all ticked. */
export function ScanDialog({ root, onClose, onAdded }: { root: string; onClose: () => void; onAdded: () => void }) {
  const guard = useGuard();
  const [found, setFound] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    guard(() => scanFolder(root)).then((repos) => {
      setFound(repos ?? []);
      setPicked(new Set(repos ?? []));
    });
  }, [root, guard]);

  function toggle(path: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    for (const path of picked) await guard(() => addRepo(path));
    setBusy(false);
    onAdded();
    onClose();
  }

  return (
    <Modal
      title={`Repos in ${root}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || picked.size === 0}>
            Add {picked.size}
          </Button>
        </>
      }
    >
      {found === null ? (
        <p className="text-zinc-500">Scanning…</p>
      ) : found.length === 0 ? (
        <p className="text-zinc-500">No new repos found (looked 4 levels deep, skipping node_modules and build folders).</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {found.map((path) => (
            <li key={path}>
              <label className="flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" checked={picked.has(path)} onChange={() => toggle(path)} />
                {path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") : path}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
