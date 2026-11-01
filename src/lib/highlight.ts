import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { FileDiff } from "./types";

/** Above this many diff lines, colouring isn't worth the wait. */
const MAX_LINES = 3_000;

// Each grammar is a separate chunk, loaded the first time a file needs it.
const grammars = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  razor: () => import("shiki/langs/razor.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
};

export type Language = keyof typeof grammars;

const byExtension: Record<string, Language> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  rs: "rust",
  cs: "csharp",
  cshtml: "razor",
  razor: "razor",
  csproj: "xml",
  props: "xml",
  targets: "xml",
  xml: "xml",
  config: "xml",
  py: "python",
  go: "go",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
};

/** The grammar for a file, or `null` to show it as plain text. */
export function languageFor(path: string): Language | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (byExtension[name.slice(dot + 1)] ?? null) : null;
}

/** A coloured piece of a line; both theme colours ride along so switching theme needs no re-run. */
export interface Token {
  content: string;
  light?: string;
  dark?: string;
}

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/**
 * Tokens for every line of every hunk, in the same order as `hunk.lines`, or
 * `null` when the file is shown uncoloured. Each hunk is tokenized as one
 * block so multi-line strings and comments keep their context.
 */
export async function highlightHunks(diff: FileDiff, path: string): Promise<(Token[] | null)[][] | null> {
  const lang = languageFor(path);
  const total = diff.hunks.reduce((n, h) => n + h.lines.length, 0);
  if (!lang || diff.binary || diff.combined || total > MAX_LINES) return null;

  const shiki = await getHighlighter();
  if (!shiki.getLoadedLanguages().includes(lang)) await shiki.loadLanguage(grammars[lang]());

  return diff.hunks.map((hunk) => {
    const code = hunk.lines.filter((l) => l.kind !== "noNewline");
    // Shiki treats \r\n as one line break; strip \r so line counts match ours.
    const text = code.map((l) => l.text.replace(/\r$/, "")).join("\n");
    const lines = shiki.codeToTokens(text, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    }).tokens;
    if (lines.length !== code.length) return hunk.lines.map(() => null);

    let next = 0;
    return hunk.lines.map((line) =>
      line.kind === "noNewline"
        ? null
        : lines[next++].map((t) => ({
            content: t.content,
            light: t.htmlStyle?.["--shiki-light"],
            dark: t.htmlStyle?.["--shiki-dark"],
          })),
    );
  });
}
