// Phone-only presentation rules. A viewport reduced by pinch zoom is not a
// keyboard; an input must be focused before we hide workspace navigation.
export const PHONE_MAX_WIDTH = 679;
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px), (hover: none) and (pointer: coarse) and (max-width: 959px) and (max-height: 500px)`;

export function isPhoneKeyboardOpen({
  baselineHeight,
  visibleHeight,
  scale,
  editableFocused,
}: {
  baselineHeight: number;
  visibleHeight: number;
  scale: number;
  editableFocused: boolean;
}) {
  return editableFocused && baselineHeight - visibleHeight * scale > 120;
}

export function normalizeNoteReadingScale(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(160, Math.max(100, Math.round(number / 10) * 10)) : 100;
}
