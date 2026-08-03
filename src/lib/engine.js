import { generateId, shuffle, groupLabel } from "./format.js";

// ─── MATCH PLAY ENGINE ───────────────────────────────────────────────────────

export function computeMatchState(holeResults) {
  let lead = 0, holesPlayed = 0;
  for (let i = 0; i < 18; i++) {
    if (!holeResults[i]) break;
    holesPlayed++;
    if (holeResults[i] === "A") lead++;
    else if (holeResults[i] === "B") lead--;
  }
  const holesRemaining = 18 - holesPlayed;
  const absLead = Math.abs(lead);
  const leader = lead > 0 ? "A" : lead < 0 ? "B" : null;
  let closed = false, result = null, closeStr = "";
  if (holesPlayed > 0 && leader && absLead > holesRemaining) {
    closed = true; result = leader; closeStr = `${absLead}&${holesRemaining}`;
  } else if (holesPlayed === 18) {
    closed = true;
    result = lead > 0 ? "A" : lead < 0 ? "B" : "H";
    closeStr = result === "H" ? "Halved" : "1 UP";
  }
  return { lead, leader, absLead, holesPlayed, holesRemaining, closed, result, closeStr, isDormy: !closed && leader !== null && absLead === holesRemaining };
}

export function parseMargin(closeStr) {
  if (!closeStr) return 0;
  const s = String(closeStr).trim();
  if (/^halved$/i.test(s) || /^bye$/i.test(s) || /^as$/i.test(s)) return 0;
  // "3&2", "3 & 2", "3& 2"
  const ampMatch = s.match(/^(\d+)\s*&/);
  if (ampMatch) return parseInt(ampMatch[1], 10);
  // "1 UP", "2 up", "1-up"
  const upMatch = s.match(/^(\d+)\s*-?\s*UP\b/i);
  if (upMatch) return parseInt(upMatch[1], 10);
  // Bare margin from admin override: "3"
  const bare = s.match(/^(\d+)$/);
  if (bare) return parseInt(bare[1], 10);
  return 0;
}

/** Prefer match.closeStr; fall back to either submission if the match score was never copied up. */
export function matchCloseStr(m) {
  if (!m) return "";
  if (m.closeStr) return m.closeStr;
  return m.submissionA?.closeStr || m.submissionB?.closeStr || "";
}

export function computeGroupStats(teamIds, groupMatches) {
  const stats = {};
  teamIds.forEach(id => { stats[id] = { w: 0, l: 0, h: 0, margin: 0, pts: 0 }; });
  groupMatches.filter(m => m.status === "closed").forEach(m => {
    const margin = parseMargin(matchCloseStr(m));
    if (m.isBye) {
      stats[m.teamA].w++;
      stats[m.teamA].pts += 3;
      return;
    }
    if (m.result === "A") {
      stats[m.teamA].w++;
      stats[m.teamA].pts += 3;
      stats[m.teamA].margin += margin;
      if (m.teamB) stats[m.teamB].l++;
    } else if (m.result === "B") {
      stats[m.teamA].l++;
      if (m.teamB) {
        stats[m.teamB].w++;
        stats[m.teamB].pts += 3;
        stats[m.teamB].margin += margin;
      }
    } else if (m.result === "H") {
      stats[m.teamA].h++;
      stats[m.teamA].pts += 1;
      if (m.teamB) {
        stats[m.teamB].h++;
        stats[m.teamB].pts += 1;
      }
    }
  });
  return stats;
}

export function sortByRecord(teamIds, stats) {
  return [...teamIds].sort((a, b) =>
    (stats[b].pts - stats[a].pts) ||
    (stats[b].w - stats[a].w) ||
    (stats[a].l - stats[b].l) ||
    (stats[b].margin - stats[a].margin)
  );
}

/**
 * When a finished group has teams level on points across the cut line,
 * explain who advanced via head-to-head (or margin if H2H was level).
 */
export function groupAdvancementNotes(group, teamIds, teams, groupMatches) {
  if (group?.status !== "done") return [];
  const advanced = new Set(group.winnerIds?.length ? group.winnerIds : (group.winnerId ? [group.winnerId] : []));
  if (!advanced.size) return [];

  const stats = computeGroupStats(teamIds, groupMatches);
  const notes = [];
  const seen = new Set();

  for (const a of teamIds) {
    for (const b of teamIds) {
      if (a >= b) continue;
      const aIn = advanced.has(a);
      const bIn = advanced.has(b);
      if (aIn === bIn) continue;
      if (stats[a].pts !== stats[b].pts) continue;

      const pairKey = `${a}:${b}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const advancerId = aIn ? a : b;
      const otherId = aIn ? b : a;
      const advancer = teams.find(t => t.id === advancerId);
      const other = teams.find(t => t.id === otherId);
      if (!advancer || !other) continue;

      const h2h = headToHeadStats([advancerId, otherId], groupMatches);
      const h2hDiff =
        (h2h[advancerId].pts - h2h[otherId].pts) ||
        (h2h[advancerId].w - h2h[otherId].w) ||
        (h2h[otherId].l - h2h[advancerId].l) ||
        (h2h[advancerId].margin - h2h[otherId].margin);

      if (h2hDiff > 0) {
        notes.push(`${advancer.name} advanced over ${other.name} on head-to-head`);
      } else if (stats[advancerId].margin > stats[otherId].margin) {
        notes.push(`${advancer.name} advanced over ${other.name} on margin`);
      }
    }
  }

  return notes;
}

export function makeMatch(groupId, round, teamA, teamB, isBye = false) {
  return {
    id: generateId(), groupId, round, groupPhase: true,
    teamA, teamB: isBye ? null : teamB,
    holeResults: Array(18).fill(null),
    submissionA: null,
    submissionB: null,
    result: isBye ? "A" : null,
    status: isBye ? "closed" : "pending",
    closeStr: isBye ? "bye" : "",
    isBye,
  };
}

export function submissionsMatch(subA, subB) {
  if (!subA || !subB) return false;
  return subA.result === subB.result && subA.closeStr === subB.closeStr;
}

export function generateRoundRobinMatches(groupId, memberIds) {
  const matches = [];
  const members = shuffle([...memberIds]);
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      matches.push(makeMatch(groupId, 1, members[i], members[j]));
    }
  }
  return matches;
}

export function headToHeadStats(teamIds, groupMatches) {
  const stats = {};
  teamIds.forEach(id => { stats[id] = { w: 0, l: 0, h: 0, margin: 0, pts: 0 }; });
  groupMatches
    .filter(m => m.status === "closed" && !m.isBye && teamIds.includes(m.teamA) && m.teamB && teamIds.includes(m.teamB))
    .forEach(m => {
      const margin = parseMargin(matchCloseStr(m));
      if (m.result === "A") {
        stats[m.teamA].w++;
        stats[m.teamA].pts += 3;
        stats[m.teamA].margin += margin;
        stats[m.teamB].l++;
      } else if (m.result === "B") {
        stats[m.teamB].w++;
        stats[m.teamB].pts += 3;
        stats[m.teamB].margin += margin;
        stats[m.teamA].l++;
      } else if (m.result === "H") {
        stats[m.teamA].h++;
        stats[m.teamA].pts += 1;
        stats[m.teamB].h++;
        stats[m.teamB].pts += 1;
      }
    });
  return stats;
}

export function tiebreakerSort(teamIds, overallStats, groupMatches) {
  const groups = {};
  teamIds.forEach(id => {
    const key = String(overallStats[id].pts ?? 0);
    if (!groups[key]) groups[key] = [];
    groups[key].push(id);
  });

  const result = [];
  const sortedKeys = Object.keys(groups).sort((a, b) => Number(b) - Number(a));

  for (const key of sortedKeys) {
    const tied = groups[key];
    if (tied.length === 1) { result.push(tied[0]); continue; }

    const h2h = headToHeadStats(tied, groupMatches);
    const h2hSorted = [...tied].sort((a, b) =>
      (h2h[b].pts - h2h[a].pts) ||
      (h2h[b].w - h2h[a].w) ||
      (h2h[a].l - h2h[b].l) ||
      (overallStats[b].margin - overallStats[a].margin)
    );
    result.push(...h2hSorted);
  }
  return result;
}

export function evaluateGroup(group, teamIds, allMatches, advancersPerGroup) {
  const n = advancersPerGroup || 1;
  const groupMatches = allMatches.filter(m => m.groupId === group.id && m.groupPhase);
  const allClosed = groupMatches.length > 0 && groupMatches.every(m => m.status === "closed");

  if (!allClosed) {
    return { groupRound: 1, groupStatus: "playing", winnerIds: group.winnerIds || [], newMatches: [], eliminatedIds: [] };
  }

  const stats = {};
  teamIds.forEach(id => { stats[id] = { w: 0, l: 0, h: 0, margin: 0, pts: 0 }; });
  groupMatches.filter(m => m.status === "closed" && !m.isBye).forEach(m => {
    const margin = parseMargin(matchCloseStr(m));
    if (m.result === "A") {
      stats[m.teamA].w++;
      stats[m.teamA].pts += 3;
      stats[m.teamA].margin += margin;
      if (m.teamB) stats[m.teamB].l++;
    } else if (m.result === "B") {
      stats[m.teamA].l++;
      if (m.teamB) {
        stats[m.teamB].w++;
        stats[m.teamB].pts += 3;
        stats[m.teamB].margin += margin;
      }
    } else if (m.result === "H") {
      stats[m.teamA].h++;
      stats[m.teamA].pts += 1;
      if (m.teamB) {
        stats[m.teamB].h++;
        stats[m.teamB].pts += 1;
      }
    }
  });

  const sorted = tiebreakerSort(teamIds, stats, groupMatches);
  const winnerIds = sorted.slice(0, Math.min(n, sorted.length));
  const eliminatedIds = sorted.slice(n);

  return { groupRound: 1, groupStatus: "done", winnerIds, eliminatedIds, newMatches: [] };
}

export function getEliminatedWithMatchesRemaining(group, teamIds, allMatches) {
  if (teamIds.length !== 4) return [];
  const groupMatches = allMatches.filter(m => m.groupId === group.id && m.groupPhase);
  const allClosed = groupMatches.every(m => m.status === "closed");
  if (allClosed) return [];

  const stats = {};
  teamIds.forEach(id => { stats[id] = { w: 0, l: 0 }; });
  groupMatches.filter(m => m.status === "closed" && !m.isBye).forEach(m => {
    if (m.result === "A") { stats[m.teamA].w++; if (m.teamB) stats[m.teamB].l++; }
    else if (m.result === "B") { stats[m.teamA].l++; if (m.teamB) stats[m.teamB].w++; }
  });

  return teamIds.filter(id => {
    if (stats[id].l < 2) return false;
    const hasMatchesLeft = groupMatches.some(m =>
      m.status !== "closed" && (m.teamA === id || m.teamB === id)
    );
    return hasMatchesLeft;
  });
}

export function makeBracketMatch(slot, teamA, teamB, bracketRound = 1) {
  const isBye = !teamB;
  return {
    id: generateId(), bracketPhase: true, bracketRound, slot,
    teamA, teamB: teamB || null,
    holeResults: Array(18).fill(null),
    submissionA: null, submissionB: null,
    result: isBye ? "A" : null, status: isBye ? "closed" : "pending",
    closeStr: isBye ? "bye" : "", isBye,
  };
}

export function generateSingleElimBracket(teamIds) {
  const seeds = teamIds.filter(Boolean);
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(seeds.length, 2))));
  const byeCount = size - seeds.length;
  const matches = [];
  let slot = 0;
  let i = 0;
  for (; i < byeCount; i++, slot++) {
    matches.push(makeBracketMatch(slot, seeds[i], null));
  }
  for (; i < seeds.length; i += 2, slot++) {
    matches.push(makeBracketMatch(slot, seeds[i], seeds[i + 1] || null));
  }
  return matches;
}

export function generateBracket(groups) {
  const sortedGroups = [...groups].sort((a, b) => a.index - b.index);
  const advancersPerGroup = sortedGroups[0]?.winnerIds?.length || 1;
  const winners = [];
  for (let slot = 0; slot < advancersPerGroup; slot++) {
    sortedGroups.forEach(g => {
      const id = g.winnerIds?.[slot] || (slot === 0 ? g.winnerId : null);
      if (id) winners.push(id);
    });
  }
  return generateSingleElimBracket(winners);
}

export function advanceBracketIfReady(tournament) {
  const bracket = tournament.bracket;
  if (!bracket.length) return tournament;
  const rounds = [...new Set(bracket.map(m => m.bracketRound))].sort((a, b) => a - b);
  const maxRound = Math.max(...rounds);
  for (const r of [...rounds].reverse()) {
    const roundMatches = bracket.filter(m => m.bracketRound === r);
    if (!roundMatches.every(m => m.status === "closed")) break;
    if (bracket.some(m => m.bracketRound === r + 1)) continue;
    const winners = roundMatches.sort((a, b) => a.slot - b.slot).map(m => m.result === "A" ? m.teamA : m.teamB);
    if (winners.length === 1) return { ...tournament, bracket, phase: "complete", championId: winners[0] };
    const nextMatches = winners.reduce((acc, _, i) => {
      if (i % 2 !== 0) return acc;
      const tA = winners[i], tB = winners[i + 1], isBye = !tB;
      return [...acc, {
        id: generateId(), bracketPhase: true, bracketRound: r + 1, slot: Math.floor(i / 2),
        teamA: tA, teamB: tB, holeResults: Array(18).fill(null),
        submissionA: null, submissionB: null,
        result: isBye ? "A" : null, status: isBye ? "closed" : "pending",
        closeStr: isBye ? "bye" : "", isBye,
      }];
    }, []);
    return { ...tournament, bracket: [...bracket, ...nextMatches] };
  }
  const finalMatches = bracket.filter(m => m.bracketRound === maxRound);
  if (finalMatches.length === 1 && finalMatches[0].status === "closed") {
    const championId = finalMatches[0].result === "A" ? finalMatches[0].teamA : finalMatches[0].teamB;
    return { ...tournament, bracket, phase: "complete", championId };
  }
  return { ...tournament, bracket };
}

export function advanceGroupIfReady(tournament, groupId) {
  const group = tournament.groups.find(g => g.id === groupId);
  if (!group || group.status === "done") return tournament;
  const teamIds = tournament.groupMap[groupId] || [];
  const advancersPerGroup = tournament.advancersPerGroup || 1;
  const { groupRound, groupStatus, winnerIds, eliminatedIds, newMatches } = evaluateGroup(group, teamIds, tournament.matches, advancersPerGroup);

  const eliminatedWithMatchesRemaining = getEliminatedWithMatchesRemaining(group, teamIds, tournament.matches);

  const updatedGroups = tournament.groups.map(g =>
    g.id === groupId ? {
      ...g, round: groupRound, status: groupStatus,
      winnerIds: winnerIds?.length ? winnerIds : (g.winnerIds || []),
      winnerId: winnerIds?.[0] || g.winnerId,
      eliminatedWithMatchesRemaining,
    } : g
  );
  const updatedTeams = tournament.teams.map(t => {
    if (!teamIds.includes(t.id)) return t;
    if (groupStatus === "done" && winnerIds?.includes(t.id)) return { ...t, status: "advanced" };
    if (groupStatus === "done" && eliminatedIds?.includes(t.id)) return { ...t, status: "eliminated" };
    return t;
  });
  const updatedMatches = [...tournament.matches, ...newMatches];
  const allGroupsDone = updatedGroups.every(g => g.status === "done");
  let bracketMatches = tournament.bracket || [];
  if (allGroupsDone && !tournament.bracketPhase) bracketMatches = generateBracket(updatedGroups, updatedTeams);
  return {
    ...tournament, groups: updatedGroups, teams: updatedTeams, matches: updatedMatches,
    phase: allGroupsDone ? "bracket" : "group", bracketPhase: allGroupsDone, bracket: bracketMatches,
  };
}

export function applyMatchToDb(db, tournId, matchId, updatedMatch, isGroupMatch) {
  const tournament = db.tournaments.find(t => t.id === tournId);
  if (!tournament) return null;

  let updated;
  if (isGroupMatch) {
    const updatedMatches = tournament.matches.map(m => m.id === matchId ? updatedMatch : m);
    let t2 = { ...tournament, matches: updatedMatches };
    if (updatedMatch.status === "closed") t2 = advanceGroupIfReady(t2, updatedMatch.groupId);
    updated = t2;
  } else {
    const updatedBracket = tournament.bracket.map(m => m.id === matchId ? updatedMatch : m);
    let t2 = { ...tournament, bracket: updatedBracket };
    if (updatedMatch.status === "closed") t2 = advanceBracketIfReady(t2);
    updated = t2;
  }
  return {
    ...db,
    tournaments: db.tournaments.map(t => t.id === tournId ? updated : t),
  };
}

export function initTournament({
  name, numTeams, numGroups, teamNames, advancersPerGroup = 1,
  mode = "teams", style = "pool_bracket",
}) {
  const teams = teamNames.map(n => ({ id: generateId(), name: n.trim(), groupId: null, status: "active" }));

  if (style === "single_elim") {
    const shuffled = shuffle(teams);
    const bracket = generateSingleElimBracket(shuffled.map(t => t.id));
    let tournament = {
      id: generateId(), name, mode, style: "single_elim",
      phase: "bracket", status: "active",
      numTeams, numGroups: 0, advancersPerGroup: 0,
      teams: shuffled, groups: [], groupMap: {},
      matches: [], bracket, bracketPhase: true,
      championId: null, createdAt: new Date().toISOString(),
    };
    tournament = advanceBracketIfReady(tournament);
    return tournament;
  }

  const groups = Array.from({ length: numGroups }, (_, i) => ({
    id: generateId(), name: groupLabel(i), index: i,
    round: 1, status: "playing", winnerId: null, winnerIds: [],
    eliminatedWithMatchesRemaining: [],
  }));
  const shuffled = shuffle(teams);
  const groupMap = {};
  groups.forEach(g => { groupMap[g.id] = []; });
  shuffled.forEach((t, i) => { groupMap[groups[i % numGroups].id].push(t.id); });
  const updatedTeams = teams.map(t => ({
    ...t, groupId: groups.find(g => groupMap[g.id].includes(t.id))?.id || null,
  }));

  const matches = [];
  groups.forEach(g => {
    generateRoundRobinMatches(g.id, groupMap[g.id]).forEach(m => matches.push(m));
  });

  return {
    id: generateId(), name, mode, style: "pool_bracket", phase: "group", status: "active",
    numTeams, numGroups, advancersPerGroup,
    teams: updatedTeams, groups, groupMap,
    matches, bracket: [], bracketPhase: false,
    championId: null, createdAt: new Date().toISOString(),
  };
}
