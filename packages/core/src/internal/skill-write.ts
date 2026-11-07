/** Serialize replacements of one skill so staging and destination checks cannot race. */
const writes = new Map<string, Promise<void>>();

export function serializeSkillWrite(dir: string, write: () => Promise<void>): Promise<void> {
  const previous = writes.get(dir);
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(write);
  writes.set(dir, next);
  void next
    .finally(() => {
      if (writes.get(dir) === next) writes.delete(dir);
    })
    .catch(() => undefined);
  return next;
}
