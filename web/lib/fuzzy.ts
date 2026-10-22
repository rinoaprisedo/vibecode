// Small fuzzy matcher for file paths: every space-separated term must match; higher score = better.
export type Hit = { path: string; score: number; marks: Set<number> };

const isBoundary = (s: string, i: number) => i === 0 || "/._- ".includes(s[i - 1]) || (s[i] >= "A" && s[i] <= "Z" && s[i - 1] >= "a" && s[i - 1] <= "z");

// Matches `term` inside `text` (a whole path). Returns the matched character positions, or null.
function matchTerm(text: string, lower: string, term: string, base: number): { score: number; pos: number[] } | null {
  // 1) plain substring: strongest signal, especially inside the file name or at its start
  const at = lower.lastIndexOf(term);
  if (at >= 0) {
    const inName = at >= base;
    const score = 100 + (inName ? 60 : 0) + (at === base ? 40 : 0) + (isBoundary(text, at) ? 20 : 0) - Math.min(at, 30) / 3;
    return { score, pos: Array.from({ length: term.length }, (_, k) => at + k) };
  }
  // 2) subsequence: letters in order, rewarding runs and word starts; prefer matching inside the file name
  for (const from of [base, 0]) {
    let i = from, score = 0, prev = -2;
    const pos: number[] = [];
    for (const ch of term) {
      let j = lower.indexOf(ch, i);
      if (j < 0) { pos.length = 0; break; }
      // look a little ahead for a word boundary rather than the first random hit
      for (let k = j; k < Math.min(lower.length, j + 12); k++) if (lower[k] === ch && isBoundary(text, k)) { j = k; break; }
      score += 10 + (j === prev + 1 ? 15 : 0) + (isBoundary(text, j) ? 10 : 0) - Math.min(j - i, 20) / 4;
      pos.push(j); prev = j; i = j + 1;
    }
    if (pos.length === term.length) return { score: score + (from === base ? 25 : 0), pos };
  }
  return null;
}

export function search(paths: string[], query: string, limit = 80): Hit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const base = path.lastIndexOf("/") + 1;
    let score = 0;
    const marks = new Set<number>();
    let ok = true;
    for (const t of terms) {
      const m = matchTerm(path, lower, t, base);
      if (!m) { ok = false; break; }
      score += m.score;
      m.pos.forEach((p) => marks.add(p));
    }
    if (ok) hits.push({ path, score: score - path.length / 20, marks });
  }
  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return hits.slice(0, limit);
}
