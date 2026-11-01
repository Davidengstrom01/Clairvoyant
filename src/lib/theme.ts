import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePref = "system" | "light" | "dark";

// Also read by the inline script in index.html, which applies it before first paint.
const KEY = "clairvoyant.theme";

export function loadTheme(): ThemePref {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function saveTheme(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Storage can be unavailable; the choice then lasts until the app closes.
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)");

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && systemDark().matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  try {
    // Themes the title bar and native dialogs too; `null` hands control back to macOS.
    void getCurrentWindow()
      .setTheme(pref === "system" ? null : pref)
      .catch(() => {});
  } catch {
    // Not running inside Tauri (e.g. a plain browser preview).
  }
}

/** The theme preference, applied to the page and window, following macOS live in System mode. */
export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(loadTheme);

  useEffect(() => {
    apply(pref);
    saveTheme(pref);
    if (pref !== "system") return;
    const media = systemDark();
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  return [pref, setPref];
}
