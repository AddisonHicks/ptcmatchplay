// ─── Formatting & setup helpers ──────────────────────────────────────────────

export function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function nowIso() {
  return new Date().toISOString();
}

export function localDateInputValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatMatchTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatPlayedOn(dateStr) {
  if (!dateStr) return "";
  const parts = String(dateStr).split("-").map(Number);
  if (parts.length < 3 || parts.some(n => Number.isNaN(n))) return "";
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function matchPlayedLabel(m) {
  if (!m.playedOn) return null;
  return `Played · ${formatPlayedOn(m.playedOn)}`;
}

export function matchActivityLabel(m) {
  if (m.overriddenAt) return `Overridden · ${formatMatchTime(m.overriddenAt)}`;
  if (m.status === "closed" && m.closedAt) return `Closed · ${formatMatchTime(m.closedAt)}`;
  if (m.status === "disputed" && m.disputedAt) return `Disputed · ${formatMatchTime(m.disputedAt)}`;
  const latest = [m.submissionA?.submittedAt, m.submissionB?.submittedAt].filter(Boolean).sort().pop();
  if (latest) return `Submitted · ${formatMatchTime(latest)}`;
  return null;
}

export function minGroupsForTeams(n) {
  return Math.ceil(n / 4);
}

export function maxGroupsForTeams(n) {
  return Math.floor(n / 2);
}

/** Teams are dealt round-robin, so sizes differ when numTeams isn't divisible by numGroups */
export function groupSizeSpread(numTeams, numGroups) {
  const base = Math.floor(numTeams / numGroups);
  const larger = numTeams % numGroups;
  return {
    small: base,
    large: larger ? base + 1 : base,
    largeCount: larger,
    smallCount: numGroups - larger,
  };
}

export function groupSizeSummary(numTeams, numGroups) {
  const { small, large, largeCount, smallCount } = groupSizeSpread(numTeams, numGroups);
  if (!largeCount) return `${small} per group`;
  return `${largeCount} group${largeCount > 1 ? "s" : ""} of ${large} · ${smallCount} of ${small}`;
}

export function totalPoolMatches(numTeams, numGroups) {
  const { small, large, largeCount, smallCount } = groupSizeSpread(numTeams, numGroups);
  return largeCount * (large * (large - 1) / 2) + smallCount * (small * (small - 1) / 2);
}

/** Smallest group governs how many can advance while still eliminating someone */
export function maxAdvancersPerGroup(numTeams, numGroups) {
  return Math.max(1, Math.floor(numTeams / numGroups) - 1);
}

export function clampAdvancers(numTeams, numGroups, advancers) {
  const max = maxAdvancersPerGroup(numTeams, numGroups);
  return Math.max(1, Math.min(max, advancers));
}

export function groupLabel(index) {
  if (index < 26) return `Group ${String.fromCharCode(65 + index)}`;
  const first = Math.floor(index / 26) - 1;
  const second = index % 26;
  return `Group ${String.fromCharCode(65 + first)}${String.fromCharCode(65 + second)}`;
}

export function bracketStageLabel(totalAdvancers) {
  if (totalAdvancers <= 2) return "Final only";
  if (totalAdvancers <= 4) return "Semis + Final";
  if (totalAdvancers <= 8) return "QF + Semis + Final";
  if (totalAdvancers <= 16) return "R16 + QF + Semis + Final";
  if (totalAdvancers <= 32) return "R32 + R16 + QF + Semis + Final";
  return "R64 + R32 + R16 + QF + Semis + Final";
}

/** Label a knockout round by how many matches it contains (include byes). */
export function bracketRoundLabel(matchCount) {
  if (matchCount <= 1) return "Final";
  if (matchCount === 2) return "Semifinals";
  if (matchCount === 4) return "Quarterfinals";
  if (matchCount === 8) return "Round of 16";
  if (matchCount === 16) return "Round of 32";
  if (matchCount === 32) return "Round of 64";
  return `Round of ${matchCount * 2}`;
}

export function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

export function tournamentStyleOf(t) {
  return t?.style === "single_elim" ? "single_elim" : "pool_bracket";
}

export function styleLabel(style) {
  return style === "single_elim" ? "Single elim" : "Pool + Bracket";
}

export function nearestEvenPowerOfTwo(n, min = 4, max = 64) {
  const up = Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
  const down = Math.pow(2, Math.floor(Math.log2(Math.max(n, 2))));
  const candidates = [down, up].filter(v => v >= min && v <= max && v % 2 === 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a - n) - Math.abs(b - n) || a - b);
  return candidates[0];
}
