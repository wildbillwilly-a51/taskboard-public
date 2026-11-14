export type SkinResolvedTheme = "light" | "dark";

type UiSkinDefinition = {
  label: string;
  themeChromeColors: Record<SkinResolvedTheme, string>;
};

export const UI_SKIN_REGISTRY = {
  architecture: {
    label: "Architecture",
    themeChromeColors: {
      light: "#eeebe5",
      dark: "#242220",
    },
  },
} as const satisfies Record<string, UiSkinDefinition>;

export type UiSkin = keyof typeof UI_SKIN_REGISTRY;

export const DEFAULT_UI_SKIN = "architecture" satisfies UiSkin;

export const UI_SKIN_IDS = Object.freeze(
  Object.keys(UI_SKIN_REGISTRY) as UiSkin[],
);

export const UI_SKIN_CHROME_COLORS = Object.freeze(
  Object.fromEntries(
    UI_SKIN_IDS.map((uiSkin) => [
      uiSkin,
      UI_SKIN_REGISTRY[uiSkin].themeChromeColors,
    ]),
  ) as Record<UiSkin, Record<SkinResolvedTheme, string>>,
);

export function getUiSkinChromeColor(
  uiSkin: UiSkin,
  resolvedTheme: SkinResolvedTheme,
) {
  return UI_SKIN_REGISTRY[uiSkin].themeChromeColors[resolvedTheme];
}
