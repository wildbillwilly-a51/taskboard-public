export type TickBounds = { left: number; right: number };

// Account for the actual end label after its CSS translation, rather than
// assuming evenly spaced dates imply evenly spaced rendered text.
export function selectTimelineTicks(bounds: TickBounds[], gap: number): number[] {
  if (bounds.length < 2) return bounds.map((_, index) => index);
  const last = bounds.length - 1;
  const keepEnd = bounds[last].left >= bounds[0].right + gap;
  const limit = keepEnd ? bounds[last].left - gap : Infinity;
  const selected = [0];
  let right = bounds[0].right;
  for (let index = 1; index < last; index++) {
    const tick = bounds[index];
    if (tick.left >= right + gap && tick.right <= limit) {
      selected.push(index);
      right = tick.right;
    }
  }
  if (keepEnd) selected.push(last);
  return selected;
}
