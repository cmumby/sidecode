/**
 * Minimal, strict unified-diff support for the single-file patches OpenCode 1.19.4 puts in
 * edit permissions and edit tool metadata (jsdiff format). Used only to build read-only
 * previews; nothing here writes files. Any mismatch returns `undefined` instead of guessing.
 */
interface Hunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(patch: string): Hunk[] | undefined {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  for (const line of patch.split('\n')) {
    const match = header.exec(line);
    if (match) {
      current = { oldStart: Number(match[1]), oldLines: match[2] === undefined ? 1 : Number(match[2]), newStart: Number(match[3]), newLines: match[4] === undefined ? 1 : Number(match[4]), lines: [] };
      hunks.push(current);
    } else if (current && (line.startsWith(' ') || line.startsWith('-') || line.startsWith('+') || line.startsWith('\\'))) current.lines.push(line);
    else if (current && line === '') current.lines.push(' '); // some generators drop the space of an empty context line
  }
  // Drop a trailing artifact from the final newline of the patch text.
  for (const hunk of hunks) {
    while (count(hunk, ' ', '-') > hunk.oldLines && hunk.lines.at(-1) === ' ') hunk.lines.pop();
    if (count(hunk, ' ', '-') !== hunk.oldLines || count(hunk, ' ', '+') !== hunk.newLines) return undefined;
  }
  return hunks.length ? hunks : undefined;
}
function count(hunk: Hunk, a: string, b: string) { return hunk.lines.filter(line => line[0] === a || line[0] === b).length; }

/** Added/removed line counts, or `undefined` for an unparsable patch. */
export function patchStats(patch: string): { additions: number; deletions: number } | undefined {
  const hunks = parsePatch(patch);
  if (!hunks) return undefined;
  return { additions: hunks.reduce((sum, h) => sum + h.lines.filter(l => l[0] === '+').length, 0), deletions: hunks.reduce((sum, h) => sum + h.lines.filter(l => l[0] === '-').length, 0) };
}

/**
 * Applies (or with `reverse`, un-applies) a patch to `source`. Every context and removed
 * line must match exactly (ignoring a trailing CR); otherwise returns `undefined`.
 */
export function applyPatch(source: string, patch: string, reverse = false): string | undefined {
  const parsed = parsePatch(patch);
  if (!parsed) return undefined;
  const crlf = source.includes('\r\n');
  const hunks = reverse ? parsed.map(h => ({ oldStart: h.newStart, oldLines: h.newLines, newStart: h.oldStart, newLines: h.oldLines,
    lines: h.lines.map(l => l[0] === '+' ? '-' + l.slice(1) : l[0] === '-' ? '+' + l.slice(1) : l) })) : parsed;
  const lines = source === '' ? [] : source.split('\n');
  const endsWithNewline = source.endsWith('\n');
  if (endsWithNewline) lines.pop();
  const plain = (line: string) => line.endsWith('\r') ? line.slice(0, -1) : line;
  const output: string[] = [];
  let index = 0; let newEndsWithNewline = source === '' || endsWithNewline;
  for (const hunk of hunks) {
    const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    if (start < index || start > lines.length) return undefined;
    output.push(...lines.slice(index, start)); index = start;
    let previous = '';
    for (const line of hunk.lines) {
      const kind = line[0]; const text = line.slice(1);
      if (kind === '\\') {
        // "No newline at end of file" applies to the side of the preceding line.
        if (previous === '+' || previous === ' ') newEndsWithNewline = false;
        if (previous === '-' && index >= lines.length) newEndsWithNewline = true;
        continue;
      }
      previous = kind!;
      if (kind === ' ' || kind === '-') {
        if (index >= lines.length || plain(lines[index]!) !== plain(text)) return undefined;
        if (kind === ' ') output.push(lines[index]!);
        index++;
      } else output.push(crlf && !text.endsWith('\r') ? text + '\r' : text);
    }
  }
  output.push(...lines.slice(index));
  if (!output.length) return '';
  return output.join('\n') + (newEndsWithNewline ? '\n' : '');
}
