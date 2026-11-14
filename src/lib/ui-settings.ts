import {
  DEFAULT_UI_SKIN,
  UI_SKIN_CHROME_COLORS,
  UI_SKIN_IDS,
  getUiSkinChromeColor,
  type UiSkin,
} from "@/lib/ui-skins";

export type { UiSkin } from "@/lib/ui-skins";

export type ThemePreference = "light" | "dark" | "system";
export type ThemeVariant = "neutral";
export type DensityMode = "relaxed" | "standard" | "tight";
export type FontScale = "small" | "normal" | "large" | "x-large" | "xx-large";
export type CardDetailLevel = "minimal" | "standard" | "detailed";
export type SidebarWidthMode = "narrow" | "normal" | "wide";
export type BucketWidthMode = "tight" | "balanced" | "wide";
export type BackgroundStyle = "atmospheric" | "minimal";
export type SurfaceStyle = "low" | "normal" | "strong";
export type BoardCollapsePreference = "collapsed" | "expanded";
export type CalendarViewPreference = "month" | "week" | "day";
export type ResolvedTheme = "light" | "dark";

export type UiSettings = {
  theme: ThemePreference;
  themeVariant: ThemeVariant;
  uiSkin: UiSkin;
  density: DensityMode;
  fontScale: FontScale;
  cardDetailLevel: CardDetailLevel;
  sidebarWidth: SidebarWidthMode;
  bucketWidthMode: BucketWidthMode;
  backgroundStyle: BackgroundStyle;
  surfaceStyle: SurfaceStyle;
  boardCollapsePreference: BoardCollapsePreference;
  boardCollapsePreferenceInitialized: boolean;
  headerPinned: boolean;
  calendarView: CalendarViewPreference;
  outagesCalendarView: CalendarViewPreference;
  /** Calendar overlays, remembered per viewer: outages on the main calendar,
   * and the viewer's own events on the Outages calendar. */
  calendarShowOutages: boolean;
  outagesShowMyCalendar: boolean;
  singleKeyShortcuts: boolean;
};

export const UI_SETTINGS_STORAGE_KEY = "taskboard-ui-settings";

export const defaultUiSettings: UiSettings = {
  theme: "dark",
  themeVariant: "neutral",
  uiSkin: DEFAULT_UI_SKIN,
  density: "standard",
  fontScale: "normal",
  cardDetailLevel: "minimal",
  sidebarWidth: "normal",
  bucketWidthMode: "balanced",
  backgroundStyle: "atmospheric",
  surfaceStyle: "normal",
  boardCollapsePreference: "collapsed",
  boardCollapsePreferenceInitialized: false,
  headerPinned: true,
  calendarView: "week",
  outagesCalendarView: "month",
  calendarShowOutages: true,
  outagesShowMyCalendar: false,
  singleKeyShortcuts: true,
};

const themePreferences: readonly ThemePreference[] = ["light", "dark", "system"];
const themeVariants: readonly ThemeVariant[] = ["neutral"];
const densityModes: readonly DensityMode[] = ["relaxed", "standard", "tight"];
const fontScales: readonly FontScale[] = [
  "small",
  "normal",
  "large",
  "x-large",
  "xx-large",
];
const cardDetailLevels: readonly CardDetailLevel[] = [
  "minimal",
  "standard",
  "detailed",
];
const sidebarWidthModes: readonly SidebarWidthMode[] = [
  "narrow",
  "normal",
  "wide",
];
const bucketWidthModes: readonly BucketWidthMode[] = [
  "tight",
  "balanced",
  "wide",
];
const backgroundStyles: readonly BackgroundStyle[] = [
  "atmospheric",
  "minimal",
];
const surfaceStyles: readonly SurfaceStyle[] = ["low", "normal", "strong"];
const boardCollapsePreferences: readonly BoardCollapsePreference[] = [
  "collapsed",
  "expanded",
];
const calendarViewPreferences: readonly CalendarViewPreference[] = [
  "month",
  "week",
  "day",
];

function pickSetting<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeBackgroundStyle(value: unknown): BackgroundStyle {
  if (value === "flat") {
    return "minimal";
  }

  return pickSetting(
    value,
    backgroundStyles,
    defaultUiSettings.backgroundStyle,
  );
}

export function mergeUiSettings(
  value: Partial<UiSettings> | null | undefined,
): UiSettings {
  const savedSettings = value as Record<string, unknown> | null | undefined;

  return {
    ...defaultUiSettings,
    theme: pickSetting(savedSettings?.theme, themePreferences, defaultUiSettings.theme),
    themeVariant: pickSetting(
      savedSettings?.themeVariant,
      themeVariants,
      defaultUiSettings.themeVariant,
    ),
    uiSkin: pickSetting(savedSettings?.uiSkin, UI_SKIN_IDS, defaultUiSettings.uiSkin),
    density: pickSetting(savedSettings?.density, densityModes, defaultUiSettings.density),
    fontScale: pickSetting(
      savedSettings?.fontScale,
      fontScales,
      defaultUiSettings.fontScale,
    ),
    cardDetailLevel: pickSetting(
      savedSettings?.cardDetailLevel,
      cardDetailLevels,
      defaultUiSettings.cardDetailLevel,
    ),
    sidebarWidth: pickSetting(
      savedSettings?.sidebarWidth,
      sidebarWidthModes,
      defaultUiSettings.sidebarWidth,
    ),
    bucketWidthMode: pickSetting(
      savedSettings?.bucketWidthMode,
      bucketWidthModes,
      defaultUiSettings.bucketWidthMode,
    ),
    backgroundStyle: normalizeBackgroundStyle(savedSettings?.backgroundStyle),
    surfaceStyle: pickSetting(
      savedSettings?.surfaceStyle,
      surfaceStyles,
      defaultUiSettings.surfaceStyle,
    ),
    boardCollapsePreference: pickSetting(
      savedSettings?.boardCollapsePreference,
      boardCollapsePreferences,
      defaultUiSettings.boardCollapsePreference,
    ),
    boardCollapsePreferenceInitialized: pickBoolean(
      savedSettings?.boardCollapsePreferenceInitialized,
      defaultUiSettings.boardCollapsePreferenceInitialized,
    ),
    // Header pinning is session-scoped: every fresh load starts pinned.
    headerPinned: true,
    calendarView: pickSetting(
      savedSettings?.calendarView,
      calendarViewPreferences,
      defaultUiSettings.calendarView,
    ),
    outagesCalendarView: pickSetting(
      savedSettings?.outagesCalendarView,
      calendarViewPreferences,
      defaultUiSettings.outagesCalendarView,
    ),
    calendarShowOutages: pickBoolean(
      savedSettings?.calendarShowOutages,
      defaultUiSettings.calendarShowOutages,
    ),
    outagesShowMyCalendar: pickBoolean(
      savedSettings?.outagesShowMyCalendar,
      defaultUiSettings.outagesShowMyCalendar,
    ),
    singleKeyShortcuts: pickBoolean(
      savedSettings?.singleKeyShortcuts,
      defaultUiSettings.singleKeyShortcuts,
    ),
  };
}

export function resolveThemePreference(
  theme: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  if (theme === "system") {
    return systemDark ? "dark" : "light";
  }

  return theme;
}

export function getThemeChromeColor(uiSkin: UiSkin, resolvedTheme: ResolvedTheme) {
  return getUiSkinChromeColor(uiSkin, resolvedTheme);
}

export function buildUiSettingsInitScript(): string {
  return `
    (function () {
      try {
        var defaults = ${JSON.stringify(defaultUiSettings)};
        var skinIds = ${JSON.stringify(UI_SKIN_IDS)};
        var skinChromeColors = ${JSON.stringify(UI_SKIN_CHROME_COLORS)};
        var raw = window.localStorage.getItem(${JSON.stringify(UI_SETTINGS_STORAGE_KEY)});
        var parsed = raw ? JSON.parse(raw) : {};
        function pick(value, allowed, fallback) {
          return allowed.indexOf(value) === -1 ? fallback : value;
        }
        function pickBool(value, fallback) {
          return typeof value === 'boolean' ? value : fallback;
        }
        function pickBackground(value) {
          if (value === 'flat') {
            return 'minimal';
          }
          return pick(value, ['atmospheric', 'minimal'], defaults.backgroundStyle);
        }
        var settings = {
          theme: pick(parsed && parsed.theme, ['light', 'dark', 'system'], defaults.theme),
          themeVariant: pick(parsed && parsed.themeVariant, ['neutral'], defaults.themeVariant),
          uiSkin: pick(parsed && parsed.uiSkin, skinIds, defaults.uiSkin),
          density: pick(parsed && parsed.density, ['relaxed', 'standard', 'tight'], defaults.density),
          fontScale: pick(parsed && parsed.fontScale, ['small', 'normal', 'large', 'x-large', 'xx-large'], defaults.fontScale),
          backgroundStyle: pickBackground(parsed && parsed.backgroundStyle),
          surfaceStyle: pick(parsed && parsed.surfaceStyle, ['low', 'normal', 'strong'], defaults.surfaceStyle),
          headerPinned: true
        };
        var root = document.documentElement;
        var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var resolvedTheme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
        function getThemeChromeColor(uiSkin, theme) {
          var colors = skinChromeColors[uiSkin] || skinChromeColors[defaults.uiSkin];
          return colors[theme];
        }
        function syncManagedMeta(name, content) {
          if (!document.head) {
            return;
          }
          var meta = document.head.querySelector('meta[name="' + name + '"][data-taskboard-managed="true"]');
          if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', name);
            meta.setAttribute('data-taskboard-managed', 'true');
          }
          meta.setAttribute('content', content);
          document.head.appendChild(meta);
        }
        root.dataset.themePreference = settings.theme || defaults.theme;
        root.dataset.theme = resolvedTheme;
        root.dataset.themeVariant = settings.themeVariant || defaults.themeVariant;
        root.dataset.uiSkin = settings.uiSkin || defaults.uiSkin;
        root.dataset.density = settings.density || defaults.density;
        root.dataset.fontScale = settings.fontScale || defaults.fontScale;
        root.dataset.backgroundStyle = settings.backgroundStyle || defaults.backgroundStyle;
        root.dataset.surfaceStyle = settings.surfaceStyle || defaults.surfaceStyle;
        root.dataset.headerPinned = settings.headerPinned ? 'true' : 'false';
        syncManagedMeta('theme-color', getThemeChromeColor(settings.uiSkin, resolvedTheme));
        syncManagedMeta('color-scheme', resolvedTheme === 'light' ? 'light' : 'dark');
      } catch (error) {
        document.documentElement.dataset.themePreference = 'dark';
        document.documentElement.dataset.theme = 'dark';
        document.documentElement.dataset.themeVariant = 'neutral';
        document.documentElement.dataset.uiSkin = '${defaultUiSettings.uiSkin}';
        document.documentElement.dataset.density = 'compact';
        document.documentElement.dataset.fontScale = 'normal';
        document.documentElement.dataset.backgroundStyle = 'atmospheric';
        document.documentElement.dataset.surfaceStyle = 'normal';
        document.documentElement.dataset.headerPinned = 'true';
      }
    })();
  `;
}
