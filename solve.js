// makefun-diff 1.0.0 reference-optimized implementation in solve.js

export const FORMAT = 'makefun-diff/1';
export const CONTEXT = 3;

const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

export function tokenize(text) {
  const parts = text.split('\n');
  const lines = [];
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines.push(`${parts[i]}\n`);
  if (parts[last] !== '') lines.push(parts[last]);
  return lines;
}

function addToPath(path, kind, oldPosInc) {
  const last = path.lastComponent;
  if (last !== undefined && last.kind === kind) {
    return { oldPos: path.oldPos + oldPosInc, lastComponent: { count: last.count + 1, kind, previousComponent: last.previousComponent } };
  }
  return { oldPos: path.oldPos + oldPosInc, lastComponent: { count: 1, kind, previousComponent: last } };
}

function extractCommon(path, newTokens, oldTokens, diagonal) {
  const newLen = newTokens.length;
  const oldLen = oldTokens.length;
  let oldPos = path.oldPos;
  let newPos = oldPos - diagonal;
  let common = 0;
  while (newPos + 1 < newLen && oldPos + 1 < oldLen && oldTokens[oldPos + 1] === newTokens[newPos + 1]) {
    newPos++;
    oldPos++;
    common++;
  }
  if (common > 0) path.lastComponent = { count: common, kind: KEEP, previousComponent: path.lastComponent };
  path.oldPos = oldPos;
  return newPos;
}

function editRuns(oldTokens, newTokens) {
  const oldLen = oldTokens.length;
  const newLen = newTokens.length;
  const runsOf = (lastComponent) => {
    const runs = [];
    for (let c = lastComponent; c !== undefined; c = c.previousComponent) runs.push({ kind: c.kind, count: c.count });
    return runs.reverse();
  };
  const maxEdit = oldLen + newLen;
  const offset = maxEdit + 1;
  const bestPath = new Array(2 * maxEdit + 3);
  bestPath[offset] = { oldPos: -1, lastComponent: undefined };
  let newPos = extractCommon(bestPath[offset], newTokens, oldTokens, 0);
  if (bestPath[offset].oldPos + 1 >= oldLen && newPos + 1 >= newLen) return runsOf(bestPath[offset].lastComponent);
  for (let d = 1; d <= maxEdit; d++) {
    for (let k = -d; k <= d; k += 2) {
      const removePath = bestPath[offset + k - 1];
      const addPath = bestPath[offset + k + 1];
      if (removePath !== undefined) bestPath[offset + k - 1] = undefined;
      const canRemove = removePath !== undefined && removePath.oldPos + 1 < oldLen;
      const canAdd = addPath !== undefined && addPath.oldPos - k < newLen;
      if (!canRemove && !canAdd) {
        bestPath[offset + k] = undefined;
        continue;
      }
      const byDeletion = canRemove ? removePath.oldPos + 1 : -2;
      const byInsertion = canAdd ? addPath.oldPos : -2;
      const path = byDeletion >= byInsertion ? addToPath(removePath, DELETE, 1) : addToPath(addPath, INSERT, 0);
      newPos = extractCommon(path, newTokens, oldTokens, k);
      if (path.oldPos + 1 >= oldLen && newPos + 1 >= newLen) return runsOf(path.lastComponent);
      bestPath[offset + k] = path;
    }
  }
  throw new Error('makefun-diff: the search ended without reaching both ends');
}

function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

export function diffPatch(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(a.slice(prefix, n - suffix), b.slice(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.at(-1);
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  const hunks = [];
  for (const c of changes) {
    const h = hunks.at(-1);
    const prev = h?.at(-1);
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h.at(-1);
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, a[at]));
  }
  return out.join('');
}

export function run(input) {
  return diffPatch(input);
}
