import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Workspace-relative label when `path` resolves (symlinks included) to a location strictly
 * inside the real project directory; otherwise `undefined`. OpenCode reads any
 * `file://` path it is given, so this is the only boundary for attached files.
 */
export async function projectLabel(project: string, path: string): Promise<string | undefined> {
  try {
    const [root, real] = await Promise.all([realpath(project), realpath(path)]);
    const inside = relative(root, real);
    if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) return undefined;
    const label = relative(project, path).split(sep).join('/');
    return label && label !== '..' && !label.startsWith('../') ? label : inside.split(sep).join('/');
  } catch { return undefined; }
}

/** `name:5` or `name:5-7`; a selection ending at column 0 of a later line excludes that line. */
export function selectionLabel(name: string, start: { line: number }, end: { line: number; character: number }): string {
  const last = end.character === 0 && end.line > start.line ? end.line : end.line + 1;
  return `${name}:${start.line + 1 === last ? last : `${start.line + 1}-${last}`}`;
}

/**
 * Like `projectLabel`, for paths reported by OpenCode that may not exist yet (a proposed
 * new file). Relative paths are resolved against the project. The nearest existing
 * ancestor is resolved with `realpath`, so symlinked directories cannot escape.
 */
export async function projectTarget(project: string, path: string): Promise<{ path: string; label: string; exists: boolean } | undefined> {
  const absolute = resolve(project, path);
  const missing: string[] = [];
  let existing = absolute;
  for (;;) {
    try {
      const real = await realpath(existing);
      const root = await realpath(project);
      const target = missing.length ? join(real, ...missing.reverse()) : real;
      const inside = relative(root, target);
      if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) return undefined;
      const label = relative(project, absolute).split(sep).join('/');
      return { path: absolute, label: label && !label.startsWith('../') && label !== '..' ? label : inside.split(sep).join('/'), exists: missing.length === 0 };
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return undefined;
      missing.push(basename(existing)); existing = parent;
    }
  }
}
