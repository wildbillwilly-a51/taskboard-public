"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  UI_SETTINGS_STORAGE_KEY,
  defaultUiSettings,
  getThemeChromeColor,
  mergeUiSettings,
  resolveThemePreference,
  type ResolvedTheme,
  type UiSettings,
} from "@/lib/ui-settings";

type UiSettingsContextValue = {
  settings: UiSettings;
  updateSetting: <K extends keyof UiSettings>(
    key: K,
    value: UiSettings[K],
  ) => void;
  updateSettings: (patch: Partial<UiSettings>) => void;
};

const UiSettingsContext = createContext<UiSettingsContextValue | null>(null);
const UI_SETTINGS_CHANGE_EVENT = "taskboard-ui-settings-change";
let cachedStorageValue: string | null | undefined;
let cachedSettings: UiSettings = defaultUiSettings;
let memorySettings: UiSettings | null = null;

function parseStoredSettings(raw: string | null) {
  if (raw === cachedStorageValue) {
    return cachedSettings;
  }

  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<UiSettings>) : undefined;
    const settings = mergeUiSettings(parsed);

    cachedStorageValue = raw;
    cachedSettings = settings;

    return settings;
  } catch {
    cachedStorageValue = raw;
    cachedSettings = defaultUiSettings;

    return defaultUiSettings;
  }
}

function readUiSettingsSnapshot() {
  if (typeof window === "undefined") {
    return defaultUiSettings;
  }

  if (memorySettings) {
    return memorySettings;
  }

  try {
    return parseStoredSettings(window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY));
  } catch {
    return defaultUiSettings;
  }
}

function subscribeToUiSettings(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === UI_SETTINGS_STORAGE_KEY) {
      memorySettings = null;
      cachedStorageValue = undefined;
      onStoreChange();
    }
  };

  window.addEventListener(UI_SETTINGS_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(UI_SETTINGS_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function writeUiSettings(settings: UiSettings) {
  if (typeof window === "undefined") {
    return;
  }

  const serialized = JSON.stringify(settings);

  try {
    window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, serialized);
    memorySettings = null;
    cachedStorageValue = serialized;
    cachedSettings = settings;
  } catch {
    memorySettings = settings;
    cachedStorageValue = undefined;
    cachedSettings = settings;
  }

  window.dispatchEvent(new Event(UI_SETTINGS_CHANGE_EVENT));
}

function getSystemDarkPreference() {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

function applySettingsToElement(
  root: HTMLElement,
  settings: UiSettings,
  resolvedTheme: ResolvedTheme,
) {
  root.dataset.themePreference = settings.theme;
  root.dataset.theme = resolvedTheme;
  root.dataset.themeVariant = settings.themeVariant;
  root.dataset.uiSkin = settings.uiSkin;
  root.dataset.density = settings.density;
  root.dataset.fontScale = settings.fontScale;
  root.dataset.backgroundStyle = settings.backgroundStyle;
  root.dataset.surfaceStyle = settings.surfaceStyle;
  root.dataset.headerPinned = settings.headerPinned ? "true" : "false";
}

function syncManagedMeta(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(
    `meta[name="${name}"][data-taskboard-managed="true"]`,
  );

  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    meta.dataset.taskboardManaged = "true";
  }

  meta.content = content;
  document.head.appendChild(meta);
}

function syncThemeBrowserMetadata(settings: UiSettings, resolvedTheme: ResolvedTheme) {
  syncManagedMeta("theme-color", getThemeChromeColor(settings.uiSkin, resolvedTheme));
  syncManagedMeta("color-scheme", resolvedTheme === "light" ? "light" : "dark");
}

function applySettingsToDocument(settings: UiSettings) {
  const root = document.documentElement;
  const systemDark = getSystemDarkPreference();
  const resolvedTheme = resolveThemePreference(settings.theme, systemDark);

  applySettingsToElement(root, settings, resolvedTheme);
  syncThemeBrowserMetadata(settings, resolvedTheme);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settingsRootRef = useRef<HTMLDivElement | null>(null);
  const settings = useSyncExternalStore(
    subscribeToUiSettings,
    readUiSettingsSnapshot,
    () => defaultUiSettings,
  );
  const [systemDark, setSystemDark] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const resolvedTheme: ResolvedTheme = resolveThemePreference(settings.theme, systemDark);

  useEffect(() => {
    applySettingsToDocument(settings);
    if (settingsRootRef.current) {
      applySettingsToElement(settingsRootRef.current, settings, resolvedTheme);
    }
  }, [resolvedTheme, settings]);

  useEffect(() => {
    if (settings.theme !== "system") {
      return;
    }

    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemDark(mediaQuery.matches);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [settings]);

  return (
    <UiSettingsContext.Provider
      value={{
        settings,
        updateSetting: (key, value) => {
          writeUiSettings({
            ...readUiSettingsSnapshot(),
            [key]: value,
          });
        },
        updateSettings: (patch) => {
          writeUiSettings({
            ...readUiSettingsSnapshot(),
            ...patch,
          });
        },
      }}
    >
      <div
        ref={settingsRootRef}
        className="taskboard-settings-root contents"
        suppressHydrationWarning
      >
        {children}
      </div>
    </UiSettingsContext.Provider>
  );
}

export function useUiSettings() {
  const context = useContext(UiSettingsContext);

  if (!context) {
    throw new Error("useUiSettings must be used within a SettingsProvider.");
  }

  return context;
}
