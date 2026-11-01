import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { openClaude, openInEditor } from "../lib/api";
import { useGuard, useNotify } from "../lib/notify";
import { Button } from "./ui";

/** Editor / Claude Code / Finder / copy path for one worktree. */
export function JumpOuts({ path }: { path: string }) {
  const guard = useGuard();
  const notify = useNotify();
  // Cards are clickable; keep these buttons from opening the detail view.
  const stop = (run: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    run();
  };

  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" title="Open in editor" onClick={stop(() => guard(() => openInEditor(path)))}>
        Editor
      </Button>
      <Button size="sm" variant="ghost" title="Open Claude Code here" onClick={stop(() => guard(() => openClaude(path)))}>
        Claude
      </Button>
      <Button size="sm" variant="ghost" title="Reveal in Finder" onClick={stop(() => guard(() => revealItemInDir(path)))}>
        Finder
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title="Copy path"
        onClick={stop(() =>
          guard(async () => {
            await navigator.clipboard.writeText(path);
            notify({ message: "Path copied", tone: "info" });
          }),
        )}
      >
        Copy path
      </Button>
    </div>
  );
}
