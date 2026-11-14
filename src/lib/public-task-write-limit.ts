import { SharedWorkError } from "./public-task-work-request";

let writers = 0;
export function reservePublicTaskWriter() {
  if (writers >= 4) throw new SharedWorkError("Work is busy. Try saving again shortly.", 503);
  writers++;
  let released = false;
  return () => { if (!released) { released = true; writers--; } };
}
