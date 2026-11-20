import type { Row } from '../../shared/domain';

const STOP = new Set('a an the and or of in on at to with my is it was for from near by colour color'.split(' '));
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}\p{Mn}\p{Mc}]+/u)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}

/**
 * Heuristic score 0–100 between a complaint and a found item. Staff always
 * confirm matches; the score only orders suggestions.
 */
export function matchScore(c: Row, f: Row): number {
  let score = 0;
  if (c.category && c.category === f.category) score += 35;
  score += 25 * overlap(tokens(`${c.item_name} ${c.description}`), tokens(`${f.item_name} ${f.public_description} ${f.private_details}`));
  score += 20 * overlap(tokens(c.color_features), tokens(`${f.color_features} ${f.public_description}`));
  score += 10 * overlap(tokens(c.last_seen_location), tokens(f.found_location));
  const lost = Date.parse(c.lost_date);
  const found = Date.parse(f.found_date);
  if (!Number.isNaN(lost) && !Number.isNaN(found)) {
    const days = (found - lost) / 86400e3;
    if (days >= -1 && days <= 3) score += 10;
    else if (days > 3 && days <= 14) score += 5;
    else if (days < -1) score -= 15; // found before it was lost
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
