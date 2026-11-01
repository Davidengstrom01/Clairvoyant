import { useEffect, useState } from "react";
import { getSettings, setSettings, setWorktreeRoot } from "../../lib/api";
import { useGuard } from "../../lib/notify";
import type { RegisteredRepo, Settings } from "../../lib/types";
import { folderName } from "../../lib/worktree";
import { Button, Field, Modal, inputClass } from "../ui";

function defaultRoot(repo: string): string {
  const trimmed = repo.replace(/\/+$/, "");
  return `${trimmed.slice(0, trimmed.lastIndexOf("/"))}/${folderName(trimmed)}.worktrees`;
}

export function SettingsDialog({
  repos,
  onClose,
  onSaved,
}: {
  repos: RegisteredRepo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const guard = useGuard();
  const [settings, setLocal] = useState<Settings | null>(null);
  const [roots, setRoots] = useState<Record<string, string>>(() =>
    Object.fromEntries(repos.map((r) => [r.path, r.worktreeRoot ?? ""])),
  );

  useEffect(() => {
    guard(getSettings).then((s) => s && setLocal(s));
  }, [guard]);

  async function save() {
    if (!settings) return;
    const saved = await guard(async () => {
      await setSettings(settings);
      for (const repo of repos) {
        const root = roots[repo.path].trim();
        if (root !== (repo.worktreeRoot ?? "")) await setWorktreeRoot(repo.path, root || null);
      }
    });
    if (saved !== undefined) {
      onSaved();
      onClose();
    }
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!settings}>
            Save
          </Button>
        </>
      }
    >
      {settings && (
        <>
          <Field label="Open in editor" hint="Shell command; {path} is replaced with the worktree path. Runs with your login shell's PATH.">
            <input
              className={`${inputClass} font-mono text-xs`}
              value={settings.editorCommand}
              onChange={(e) => setLocal({ ...settings, editorCommand: e.target.value })}
            />
          </Field>
          <Field label="Open Claude Code" hint="Should open a terminal in {path} running `claude`.">
            <input
              className={`${inputClass} font-mono text-xs`}
              value={settings.claudeCommand}
              onChange={(e) => setLocal({ ...settings, claudeCommand: e.target.value })}
            />
          </Field>
        </>
      )}
      {repos.length > 0 && <h3 className="mt-2 font-semibold">Worktree folders</h3>}
      {repos.map((repo) => (
        <Field key={repo.path} label={folderName(repo.path)} hint="Where new worktrees of this repo are created. Leave empty for the default.">
          <input
            className={`${inputClass} font-mono text-xs`}
            value={roots[repo.path]}
            placeholder={defaultRoot(repo.path)}
            onChange={(e) => setRoots({ ...roots, [repo.path]: e.target.value })}
          />
        </Field>
      ))}
    </Modal>
  );
}
