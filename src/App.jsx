import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase.js";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "";
const DB_ID = "main";

// ─── STORAGE (Supabase) ──────────────────────────────────────────────────────
// One row holds the full multi-tournament DB: { tournaments: [...] }
async function loadAll() {
  try {
    const { data, error } = await supabase
      .from("tournaments")
      .select("state")
      .eq("id", DB_ID)
      .maybeSingle();
    if (error) throw error;
    return data?.state ?? { tournaments: [] };
  } catch (e) {
    console.error("Load failed", e);
    return { tournaments: [] };
  }
}
async function saveAll(db) {
  try {
    const { error } = await supabase
      .from("tournaments")
      .upsert(
        { id: DB_ID, state: db, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (error) throw error;
  } catch (e) {
    console.error("Save failed", e);
  }
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────
function generateId() { return Math.random().toString(36).slice(2, 9); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── MATCH PLAY ENGINE ───────────────────────────────────────────────────────
function computeMatchState(holeResults) {
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

function parseMargin(closeStr) {
  if (!closeStr) return 0;
  if (closeStr === "Halved" || closeStr === "bye") return 0;
  const ampMatch = closeStr.match(/^(\d+)&/);
  if (ampMatch) return parseInt(ampMatch[1], 10);
  const upMatch = closeStr.match(/^(\d+)\s*UP/i);
  if (upMatch) return parseInt(upMatch[1], 10);
  return 0;
}

function computeGroupStats(teamIds, groupMatches) {
  const stats = {};
  teamIds.forEach(id => { stats[id] = { w: 0, l: 0, h: 0, margin: 0 }; });
  groupMatches.filter(m => m.status === "closed").forEach(m => {
    const margin = parseMargin(m.closeStr);
    if (m.isBye) { stats[m.teamA].w++; return; }
    if (m.result === "A") { stats[m.teamA].w++; stats[m.teamA].margin += margin; if (m.teamB) stats[m.teamB].l++; }
    else if (m.result === "B") { stats[m.teamA].l++; if (m.teamB) { stats[m.teamB].w++; stats[m.teamB].margin += margin; } }
    else if (m.result === "H") { stats[m.teamA].h++; if (m.teamB) stats[m.teamB].h++; }
  });
  return stats;
}

function sortByRecord(teamIds, stats) {
  return [...teamIds].sort((a, b) =>
    (stats[b].w - stats[a].w) || (stats[a].l - stats[b].l) || (stats[b].margin - stats[a].margin)
  );
}

function makeMatch(groupId, round, teamA, teamB, isBye = false) {
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

function submissionsMatch(subA, subB) {
  if (!subA || !subB) return false;
  return subA.result === subB.result && subA.closeStr === subB.closeStr;
}

// ─── FULL ROUND ROBIN SCHEDULE ───────────────────────────────────────────────
// Generates all pairs for n teams: n*(n-1)/2 matches
// 2 teams → 1 match, 3 teams → 3 matches, 4 teams → 6 matches
function generateRoundRobinMatches(groupId, memberIds) {
  const matches = [];
  const members = shuffle([...memberIds]);
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      matches.push(makeMatch(groupId, 1, members[i], members[j]));
    }
  }
  return matches;
}

// ─── TIEBREAKER ENGINE ───────────────────────────────────────────────────────
// For a set of tied teams, compute head-to-head record among only those teams
function headToHeadStats(teamIds, groupMatches) {
  const stats = {};
  teamIds.forEach(id => { stats[id] = { w: 0, l: 0, h: 0, margin: 0 }; });
  groupMatches
    .filter(m => m.status === "closed" && !m.isBye && teamIds.includes(m.teamA) && m.teamB && teamIds.includes(m.teamB))
    .forEach(m => {
      const margin = parseMargin(m.closeStr);
      if (m.result === "A") { stats[m.teamA].w++; stats[m.teamA].margin += margin; stats[m.teamB].l++; }
      else if (m.result === "B") { stats[m.teamB].w++; stats[m.teamB].margin += margin; stats[m.teamA].l++; }
      else if (m.result === "H") { stats[m.teamA].h++; stats[m.teamB].h++; }
    });
  return stats;
}

// Full tiebreaker sort:
// 1. W/L record (overall), 2. Head-to-head among tied teams, 3. Win margin overall
function tiebreakerSort(teamIds, overallStats, groupMatches) {
  // Group teams by W/L record
  const groups = {};
  teamIds.forEach(id => {
    const key = `${overallStats[id].w}-${overallStats[id].l}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(id);
  });

  const result = [];
  // Sort record groups by wins desc, losses asc
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const [aw, al] = a.split("-").map(Number);
    const [bw, bl] = b.split("-").map(Number);
    return (bw - aw) || (al - bl);
  });

  for (const key of sortedKeys) {
    const tied = groups[key];
    if (tied.length === 1) { result.push(tied[0]); continue; }

    // Apply head-to-head among tied teams
    const h2h = headToHeadStats(tied, groupMatches);
    const h2hSorted = [...tied].sort((a, b) =>
      (h2h[b].w - h2h[a].w) ||
      (h2h[a].l - h2h[b].l) ||
      (overallStats[b].margin - overallStats[a].margin)
    );
    result.push(...h2hSorted);
  }
  return result;
}

// ─── GROUP ENGINE ────────────────────────────────────────────────────────────
function evaluateGroup(group, teamIds, allMatches, advancersPerGroup) {
  const n = advancersPerGroup || 1;
  const groupMatches = allMatches.filter(m => m.groupId === group.id && m.groupPhase);
  const allClosed = groupMatches.length > 0 && groupMatches.every(m => m.status === "closed");

  // Not all matches complete yet
  if (!allClosed) {
    return { groupRound: 1, groupStatus: "playing", winnerIds: group.winnerIds || [], newMatches: [], eliminatedIds: [] };
  }

  // All matches closed — compute overall stats
  const stats = {};
  teamIds.forEach(id => { stats[id] = { w: 0, l: 0, h: 0, margin: 0 }; });
  groupMatches.filter(m => m.status === "closed" && !m.isBye).forEach(m => {
    const margin = parseMargin(m.closeStr);
    if (m.result === "A") { stats[m.teamA].w++; stats[m.teamA].margin += margin; if (m.teamB) stats[m.teamB].l++; }
    else if (m.result === "B") { stats[m.teamA].l++; if (m.teamB) { stats[m.teamB].w++; stats[m.teamB].margin += margin; } }
    else if (m.result === "H") { stats[m.teamA].h++; if (m.teamB) stats[m.teamB].h++; }
  });

  // Full tiebreaker sort
  const sorted = tiebreakerSort(teamIds, stats, groupMatches);
  const winnerIds = sorted.slice(0, Math.min(n, sorted.length));
  const eliminatedIds = sorted.slice(n);

  return { groupRound: 1, groupStatus: "done", winnerIds, eliminatedIds, newMatches: [] };
}

// Check if any team in a 4-team group is eliminated (0-2) with matches remaining
function getEliminatedWithMatchesRemaining(group, teamIds, allMatches, advancersPerGroup) {
  if (teamIds.length !== 4) return [];
  const groupMatches = allMatches.filter(m => m.groupId === group.id && m.groupPhase);
  const allClosed = groupMatches.every(m => m.status === "closed");
  if (allClosed) return [];

  // Compute current records
  const stats = {};
  teamIds.forEach(id => { stats[id] = { w: 0, l: 0 }; });
  groupMatches.filter(m => m.status === "closed" && !m.isBye).forEach(m => {
    if (m.result === "A") { stats[m.teamA].w++; if (m.teamB) stats[m.teamB].l++; }
    else if (m.result === "B") { stats[m.teamA].l++; if (m.teamB) stats[m.teamB].w++; }
  });

  // A team is flagged if 0-2 and has pending matches left
  return teamIds.filter(id => {
    if (stats[id].l < 2) return false;
    const hasMatchesLeft = groupMatches.some(m =>
      m.status !== "closed" && (m.teamA === id || m.teamB === id)
    );
    return hasMatchesLeft;
  });
}

function advanceGroupIfReady(tournament, groupId) {
  const group = tournament.groups.find(g => g.id === groupId);
  if (!group || group.status === "done") return tournament;
  const teamIds = tournament.groupMap[groupId] || [];
  const advancersPerGroup = tournament.advancersPerGroup || 1;
  const { groupRound, groupStatus, winnerIds, eliminatedIds, newMatches } = evaluateGroup(group, teamIds, tournament.matches, advancersPerGroup);

  // Check 0-2 flag for 4-team groups
  const eliminatedWithMatchesRemaining = getEliminatedWithMatchesRemaining(group, teamIds, tournament.matches, advancersPerGroup);

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

function generateBracket(groups, teams) {
  const sortedGroups = [...groups].sort((a, b) => a.index - b.index);
  const advancersPerGroup = sortedGroups[0]?.winnerIds?.length || 1;
  const winners = [];
  for (let slot = 0; slot < advancersPerGroup; slot++) {
    sortedGroups.forEach(g => {
      const id = g.winnerIds?.[slot] || (slot === 0 ? g.winnerId : null);
      if (id) winners.push(id);
    });
  }
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(winners.length, 2))));
  while (winners.length < size) winners.push(null);
  return Array.from({ length: size / 2 }, (_, i) => {
    const tA = winners[i * 2], tB = winners[i * 2 + 1];
    const isBye = !tB;
    return {
      id: generateId(), bracketPhase: true, bracketRound: 1, slot: i,
      teamA: tA, teamB: tB,
      holeResults: Array(18).fill(null),
      submissionA: null, submissionB: null,
      result: isBye ? "A" : null, status: isBye ? "closed" : "pending",
      closeStr: isBye ? "bye" : "", isBye,
    };
  });
}

function advanceBracketIfReady(tournament) {
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

function initTournament({ name, numTeams, numGroups, teamNames, advancersPerGroup = 1, mode = "teams" }) {
  const teams = teamNames.map(n => ({ id: generateId(), name: n.trim(), groupId: null, status: "active" }));
  const groups = Array.from({ length: numGroups }, (_, i) => ({
    id: generateId(), name: `Group ${String.fromCharCode(65 + i)}`, index: i,
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

  // Generate full round robin matches upfront for all groups
  const matches = [];
  groups.forEach(g => {
    generateRoundRobinMatches(g.id, groupMap[g.id]).forEach(m => matches.push(m));
  });

  return {
    id: generateId(), name, mode, phase: "group", status: "active",
    numTeams, numGroups, advancersPerGroup,
    teams: updatedTeams, groups, groupMap,
    matches, bracket: [], bracketPhase: false,
    championId: null, createdAt: new Date().toISOString(),
  };
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────
function BrandMark({ size = 40, showText = true }) {
  return (
    <div className="mp-topbar-logo">
      <img src="/brand/ptc-peach.png" alt="Peachtree Collective" width={size} height={size} />
      {showText && <div className="mp-topbar-logo-text">Peachtree <span>Collective</span></div>}
    </div>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="mp-toast">✓ {message}</div>;
}

// ─── PASSWORD SCREEN ─────────────────────────────────────────────────────────
function AdminPasswordScreen({ onUnlock }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  function handleSubmit() {
    if (pw.toLowerCase() === ADMIN_PASSWORD.toLowerCase()) onUnlock();
    else { setError(true); setTimeout(() => setError(false), 2000); }
  }
  return (
    <div className="mp-pw-screen">
      <button
        type="button"
        className="mp-pw-back"
        onClick={()=>{ window.location.hash = ""; }}
      >
        ← Back to tournament
      </button>
      <img className="mp-pw-crest" src="/brand/ptc-peach.png" alt="Peachtree Collective" />
      <div className="mp-pw-title">Peachtree <span>Admin</span></div>
      <div className="mp-pw-sub">Commissioner access only</div>
      <div className="mp-pw-form">
        <input type="password" placeholder="password"
          value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
          autoFocus className={error ? "mp-pw-input error shake" : "mp-pw-input"} />
        {error && <div className="mp-error ta-center">Incorrect password</div>}
        <button className="mp-btn mp-btn-primary" onClick={handleSubmit}>Enter Admin →</button>
      </div>
    </div>
  );
}

// ─── SCORECARD SCREEN ────────────────────────────────────────────────────────
function ScorecardScreen({ tournament, matchId, onBack, onSubmitSide, isAdmin, onAdminOverride }) {
  const allMatches = [...(tournament.matches||[]), ...(tournament.bracket||[])];
  const match = allMatches.find(m => m.id === matchId);
  const teamA = tournament.teams.find(t => t.id === match?.teamA);
  const teamB = match?.teamB ? tournament.teams.find(t => t.id === match.teamB) : null;
  const [side, setSide] = useState(null); // null | 'A' | 'B'
  const [holeResults, setHoleResults] = useState(Array(18).fill(null));

  if (!match) return null;

  const ms = computeMatchState(holeResults);
  const leaderName = ms.leader==="A" ? teamA?.name : ms.leader==="B" ? teamB?.name : null;

  const hasSubA = !!match.submissionA;
  const hasSubB = !!match.submissionB;
  const isLocked = match.status === "closed";
  const isDisputed = match.status === "disputed";
  const isPendingValidation = match.status === "pending_validation";

  function getStatus() {
    if (ms.holesPlayed===0) return { cls:"sc-st-unstarted", label:"Not Started", detail:"Tap each hole to record who won it" };
    if (ms.closed && ms.result==="H") return { cls:"sc-st-halved", label:"Halved", detail:"All square after 18" };
    if (ms.closed) return { cls:"sc-st-closed", label:ms.closeStr, detail:`${leaderName} wins` };
    if (ms.isDormy) return { cls:"sc-st-dormy", label:"DORMY", detail:`${leaderName} — ${ms.holesRemaining} to play` };
    if (ms.leader) return { cls:"sc-st-lead", label:`${ms.absLead} UP`, detail:`${leaderName} · ${ms.holesRemaining} to play` };
    return { cls:"sc-st-neutral", label:"All Square", detail:`${ms.holesRemaining} to play` };
  }
  const status = getStatus();

  function setHole(i, val) {
    if (ms.closed && i >= ms.holesPlayed) return;
    const next = [...holeResults];
    next[i] = next[i]===val ? null : val;
    for (let j=i+1; j<18; j++) next[j]=null;
    setHoleResults(next);
  }

  function handleSubmit() {
    if (!ms.closed) return;
    onSubmitSide(matchId, side, { holeResults, result: ms.result, closeStr: ms.closeStr });
    setSide(null);
  }

  // Side selector screen
  if (!side && !isLocked && !isAdmin) {
    return (
      <div className="sc-shell">
        <div className="sc-banner">
          <button onClick={onBack} className="mp-back-btn mb">← Back</button>
          <div className="sc-teams-row">
            <div className="flex-1"><div className="sc-team-name">{teamA?.name}</div></div>
            <div className="sc-vs">vs</div>
            <div className="flex-1"><div className="sc-team-name right">{teamB?.name}</div></div>
          </div>
        </div>

        {isPendingValidation && (
          <div className="mp-notice mp-notice-info">
            ⏳ One side has submitted — enter your results to validate
          </div>
        )}
        {isDisputed && (
          <div className="mp-notice mp-notice-danger">
            ⚠ Results disputed — admin has been notified
          </div>
        )}

        <div className="mp-page pt-20">
          <div className="mp-section-eyebrow">Enter Scorecard</div>
          <div className="mp-section-title">Which side<br />are you?</div>
          <div className="mp-section-sub">Select your side to enter your result. You'll enter your scorecard blind.</div>
          <div className="mp-side-pick">
            {[{val:"A",team:teamA,disabled:hasSubA&&!isDisputed},{val:"B",team:teamB,disabled:hasSubB&&!isDisputed}].map(({val,team,disabled})=>(
              <button key={val} onClick={()=>!disabled&&setSide(val)} disabled={disabled} className="mp-side-btn">
                <div className="mp-side-btn-name">{team?.name}</div>
                <div className="mp-side-btn-meta">
                  {disabled?"Scorecard already submitted":"Tap to enter your scorecard"}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Locked / admin view
  if (isLocked || isAdmin) {
    return (
      <div className="sc-shell">
        <div className="sc-banner">
          <button onClick={onBack} className="mp-back-btn mb">← Back</button>
          <div className="sc-teams-row">
            <div className="flex-1"><div className="sc-team-name">{teamA?.name}</div></div>
            <div className="sc-vs">vs</div>
            <div className="flex-1"><div className="sc-team-name right">{teamB?.name}</div></div>
          </div>
        </div>

        {isDisputed && isAdmin && (
          <div className="mp-notice">
            <div className="mp-dispute-banner">
              <span className="font-meta">⚠</span>
              <div>
                <div className="mp-dispute-title">DISPUTED RESULT</div>
                <div className="font-meta-sm t-muted">
                  {teamA?.name} submitted: {match.submissionA?.closeStr} · {match.submissionA?.result==="A"?teamA?.name:match.submissionA?.result==="B"?teamB?.name:"Halve"}
                </div>
                <div className="font-meta-sm t-muted">
                  {teamB?.name} submitted: {match.submissionB?.closeStr} · {match.submissionB?.result==="A"?teamA?.name:match.submissionB?.result==="B"?teamB?.name:"Halve"}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="sc-result-box">
          <div className="sc-result-trophy">{match.result==="H"?"🤝":"🏌️"}</div>
          <div className="sc-result-winner">
            {match.result==="H"?"Match Halved":match.result==="A"?`${teamA?.name} Wins`:`${teamB?.name} Wins`}
          </div>
          <div className="sc-result-score">{match.closeStr}</div>
          {isDisputed && isAdmin && (
            <button className="mp-btn mp-btn-danger mt-8" onClick={()=>onAdminOverride(match)}>Override Result →</button>
          )}
          {isLocked && !isDisputed && (
            <div className="sc-locked-note">✓ Validated & Locked</div>
          )}
        </div>
      </div>
    );
  }

  // Entry view
  return (
    <div className="sc-shell">
      <div className="sc-banner">
        <button onClick={()=>setSide(null)} className="mp-back-btn mb">← Back</button>
        <div className="font-label t-accent mb-8">
          Entering as: {side==="A"?teamA?.name:teamB?.name}
        </div>
        <div className="sc-teams-row">
          <div className="flex-1"><div className="sc-team-name">{teamA?.name}</div></div>
          <div className="sc-vs">vs</div>
          <div className="flex-1"><div className="sc-team-name right">{teamB?.name}</div></div>
        </div>
        <div className="sc-tally">
          {Array.from({length:18},(_,i)=>{
            const r=holeResults[i]; const isAuto=ms.closed&&i>=ms.holesPlayed;
            return <div key={i} className={`sc-tally-pip${isAuto?" sc-tally-empty":r==="A"?" sc-tally-A":r==="B"?" sc-tally-B":r==="H"?" sc-tally-H":" sc-tally-empty"}`}>{!isAuto&&r?(r==="H"?"½":r):""}</div>;
          })}
        </div>
        <div className={`sc-status ${status.cls}`}>
          <div className="sc-status-label">{status.label}</div>
          <div className="sc-status-detail">{status.detail}</div>
        </div>
      </div>

      <div className="sc-holes-hint">Holes — tap to record result</div>
      <div className="sc-hole-grid">
        {Array.from({length:18},(_,i)=>{
          const isAuto=ms.closed&&i>=ms.holesPlayed; const r=holeResults[i];
          return (
            <div key={i} className={`sc-hole-row${isAuto?" closed-auto":""}`}>
              <div className="sc-hole-num">{i+1}</div>
              <div className="sc-hole-btns">
                {[{val:"A",label:teamA?.name?.split(" ")[0]||"A"},{val:"H",label:"Halve"},{val:"B",label:teamB?.name?.split(" ")[0]||"B"}].map(({val,label})=>(
                  <button key={val} className={`sc-hole-btn${r===val?` sel-${val}`:""}`} onClick={()=>setHole(i,val)} disabled={isAuto}>{label}</button>
                ))}
              </div>
              <div className={`sc-hole-result${r==="A"?" is-A":r==="B"?" is-B":r==="H"?" is-H":""}`}>
                {isAuto?"·":r?(r==="H"?"½":r==="A"?"A":"B"):"—"}
              </div>
            </div>
          );
        })}
      </div>

      {ms.closed && (
        <div className="sc-result-box">
          <div className="sc-result-trophy">{ms.result==="H"?"🤝":"🏌️"}</div>
          <div className="sc-result-winner">{ms.result==="H"?"Match Halved":ms.result==="A"?`${teamA?.name} Wins`:`${teamB?.name} Wins`}</div>
          <div className="sc-result-score">{ms.closeStr}</div>
          <button className="mp-btn mp-btn-sign" onClick={handleSubmit}>✍ Confirm & Sign Scorecard</button>
          <div className="font-label t-muted mt-10">
            Both sides must submit to validate the result
          </div>
        </div>
      )}
      {ms.holesPlayed===0&&(
        <div className="sc-hint-empty">Tap a button next to each hole to record who won it.</div>
      )}
    </div>
  );
}

// ─── PUBLIC: MATCHES TAB ─────────────────────────────────────────────────────
function PublicMatchesTab({ tournament, onOpenMatch }) {
  function getTeam(id) { return tournament.teams.find(t=>t.id===id); }
  // All matches generated upfront — show all, not filtered by round
  const currentRoundMatches = tournament.phase==="bracket"
    ? tournament.bracket
    : tournament.matches.filter(m => !m.isBye);

  const pending = currentRoundMatches.filter(m=>m.status!=="closed"&&!m.isBye);
  const closed  = currentRoundMatches.filter(m=>m.status==="closed"&&!m.isBye);

  function statusBadge(m) {
    if (m.status==="disputed") return <span className="badge badge-disputed">⚠ Disputed</span>;
    if (m.status==="pending_validation") return <span className="badge badge-validation">Pending Validation</span>;
    if (m.status==="closed") {
      const w=m.result==="A"?getTeam(m.teamA):m.result==="B"?getTeam(m.teamB):null;
      return <span className="badge badge-done">{w?`${w.name.split(" ")[0]} ${m.closeStr}`:"Halve"} ✓</span>;
    }
    return <span className="badge badge-pending">Enter →</span>;
  }

  function MatchRow({ m }) {
    const tA=getTeam(m.teamA), tB=m.teamB?getTeam(m.teamB):null;
    const statusCls = m.status==="closed"?" is-closed":m.status==="disputed"?" is-disputed":"";
    return (
      <div className={`mp-match-row-item${statusCls}`} onClick={()=>onOpenMatch(m.id)}>
        <div className={`mp-match-name${m.status==="closed"&&m.result==="A"?" is-winner":""}`}>{tA?.name}</div>
        <div className="mp-match-vs">vs</div>
        <div className={`mp-match-name right${m.status==="closed"&&m.result==="B"?" is-winner":""}`}>{tB?.name||<span className="mp-match-bye">Bye</span>}</div>
        <div className="ml-6 shrink-0">{statusBadge(m)}</div>
      </div>
    );
  }

  if (tournament.phase==="complete") {
    const champion = tournament.teams.find(t=>t.id===tournament.championId);
    return (
      <div className="mp-page">
        <div className="mp-champion">
          <div className="mp-champion-emoji">🏆</div>
          <div className="mp-champion-label">Tournament Champion</div>
          <div className="mp-champion-name">{champion?.name}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mp-page">
      {tournament.phase==="bracket" && (
        <div className="mb-16">
          <div className="mp-section-eyebrow">Knockout Stage</div>
        </div>
      )}
      {tournament.groups.map(g=>{
        const gMatches=(tournament.phase==="bracket"?[]:tournament.matches.filter(m=>m.groupId===g.id&&!m.isBye));
        const eliminatedFlags=g.eliminatedWithMatchesRemaining||[];
        if (!gMatches.length) return null;
        const closedCount=gMatches.filter(m=>m.status==="closed").length;
        return (
          <div key={g.id} className="mp-card">
            <div className="flex items-center justify-between mb-12">
              <div className="mp-card-title mb-0">{g.name}</div>
              <div className="flex items-center gap-6">
                <span className="font-label t-faint">{closedCount}/{gMatches.length}</span>
                <span className={`badge ${g.status==="done"?"badge-advanced":"badge-active"}`}>
                  {g.status==="done"?"Done":"Playing"}
                </span>
              </div>
            </div>
            {eliminatedFlags.length>0&&(
              <div className="mp-callout">
                {eliminatedFlags.map(id=>{const t=tournament.teams.find(t2=>t2.id===id);return <div key={id}>⚠ {t?.name} is eliminated — remaining match may be rescheduled</div>;})}
              </div>
            )}
            {gMatches.map(m=><MatchRow key={m.id} m={m}/>)}
          </div>
        );
      })}
            {tournament.phase==="bracket" && (
        <div className="mp-card">
          <div className="mp-card-title">Bracket Matches</div>
          {tournament.bracket.filter(m=>!m.isBye).map(m=><MatchRow key={m.id} m={m}/>)}
        </div>
      )}
      {pending.length===0&&tournament.phase!=="complete"&&(
        <div className="mp-card ta-center pad-lg">
          <div className="font-meta t-accent">All matches complete ✓</div>
        </div>
      )}
    </div>
  );
}

// ─── PUBLIC: STANDINGS TAB ───────────────────────────────────────────────────
function PublicStandingsTab({ tournament }) {
  const { teams, groups, matches, groupMap } = tournament;
  return (
    <div className="mp-page">
      <div className="mp-section-eyebrow">Group Play</div>
      <div className="mp-section-title">Standings</div>
      {groups.map(g=>{
        const teamIds=groupMap[g.id]||[];
        const groupMatches=matches.filter(m=>m.groupId===g.id&&m.groupPhase&&!m.isBye);
        const overall=computeGroupStats(teamIds,groupMatches);
        const sortedTeams=sortByRecord(teamIds,overall).map(id=>teams.find(t=>t.id===id)).filter(Boolean);
        return (
          <div key={g.id} className="mp-card">
            <div className="flex items-center justify-between mb-14">
              <div className="mp-card-title mb-0">{g.name}</div>
              <span className={`badge ${g.status==="done"?"badge-advanced":"badge-active"}`}>
                {g.status==="done"?"Done":`R${g.round}`}
              </span>
            </div>
            <table className="mp-table">
              <thead>
                <tr>{["","W","L","H","+Margin"].map(h=>(
                  <th key={h} className={`mp-th${h===""?"":" center"}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {sortedTeams.map(team=>{
                  const r=overall[team.id];
                  const isWinner=g.winnerIds?.includes(team.id)||team.id===g.winnerId;
                  const isElim=team.status==="eliminated";
                  return (
                    <tr key={team.id}>
                      <td className={`mp-td${isWinner?" is-winner":isElim?" is-elim":""}`}>{team.name}</td>
                      {["w","l","h"].map(k=>(
                        <td key={k} className={`mp-td center${k==="w"&&r.w>0?" is-win-stat":k==="l"&&r.l>0?" is-loss-stat":""}`}>{r[k]}</td>
                      ))}
                      <td className={`mp-td center${r.margin>0?" is-margin":""}`}>{r.margin>0?`+${r.margin}`:r.margin===0&&r.w===0?"—":r.margin}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ─── PUBLIC: BRACKET TAB ─────────────────────────────────────────────────────
function PublicBracketTab({ tournament, onOpenMatch }) {
  function getTeam(id) { return id?tournament.teams.find(t=>t.id===id):null; }
  const { bracket, groups, phase } = tournament;

  if (phase!=="bracket"&&phase!=="complete"||!bracket.length) {
    const done=groups.filter(g=>g.status==="done").length;
    return (
      <div className="mp-page">
        <div className="mp-section-eyebrow">Knockout</div>
        <div className="mp-section-title">Bracket</div>
        <div className="mp-card ta-center pad-xl">
          <div className="mp-champion-emoji sm">🏆</div>
          <div className="font-meta t-muted mb-12">{done}/{groups.length} groups complete</div>
          {groups.map(g=>(
            <div key={g.id} className="mp-list-row">
              <span className="font-meta-sm t-body">{g.name}</span>
              {g.status==="done"
                ? <span className="badge badge-advanced">✓ {getTeam(g.winnerId)?.name}</span>
                : <span className="badge badge-active">R{g.round}</span>
              }
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rounds=[...new Set(bracket.map(m=>m.bracketRound))].sort((a,b)=>a-b);
  const maxRound=Math.max(...rounds);
  function roundLabel(r){const rem=maxRound-r;return rem===0?"Final":rem===1?"Semifinals":"Quarterfinals";}

  if (phase==="complete") {
    const champion=getTeam(tournament.championId);
    return (
      <div className="mp-page">
        <div className="mp-champion">
          <div className="mp-champion-emoji">🏆</div>
          <div className="mp-champion-label">Champion</div>
          <div className="mp-champion-name mb">{champion?.name}</div>
        </div>
        {rounds.map(r=>(
          <div key={r} className="mb-20">
            <div className="mp-round-label">{roundLabel(r)}</div>
            {bracket.filter(m=>m.bracketRound===r&&!m.isBye).map(m=>{
              const tA=getTeam(m.teamA),tB=getTeam(m.teamB);
              return (
                <div key={m.id} className="mp-bracket-card" onClick={()=>onOpenMatch(m.id)}>
                  {[{t:tA,side:"A"},{t:tB,side:"B"}].map(({t,side})=>(
                    <div key={side} className={`mp-bracket-row${m.result===side?" is-winner":""}`}>
                      <div className="mp-bracket-name">{t?.name||"TBD"}</div>
                      {m.result===side&&<span className="mp-bracket-score">{m.closeStr} ✓</span>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mp-page">
      <div className="mp-section-eyebrow">Knockout Stage</div>
      <div className="mp-section-title">Bracket</div>
      {rounds.map(r=>(
        <div key={r} className="mb-20">
          <div className="mp-round-label mb-10">{roundLabel(r)}</div>
          {bracket.filter(m=>m.bracketRound===r&&!m.isBye).map(m=>{
            const tA=getTeam(m.teamA),tB=getTeam(m.teamB);
            return (
              <div key={m.id} className={`mp-bracket-card${m.status==="disputed"?" is-disputed":""}`} onClick={()=>onOpenMatch(m.id)}>
                {[{t:tA,side:"A"},{t:tB,side:"B"}].map(({t,side})=>(
                  <div key={side} className={`mp-bracket-row${m.status==="closed"&&m.result===side?" is-winner":""}`}>
                    <div className={`mp-bracket-name${!t?" is-empty":""}`}>{t?.name||"TBD"}</div>
                    {m.status==="closed"&&m.result===side&&<span className="mp-bracket-score">{m.closeStr} ✓</span>}
                    {m.status!=="closed"&&t&&<span className="badge badge-pending">Enter →</span>}
                    {m.status==="disputed"&&<span className="badge badge-disputed">⚠</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── PUBLIC TOURNAMENT VIEW ───────────────────────────────────────────────────
function PublicTournamentView({ tournament, onSaveMatch }) {
  const [tab, setTab] = useState("matches");
  const [scorecardMatchId, setScorecardMatchId] = useState(null);
  const [toast, setToast] = useState(null);

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(null),2500); }

  function handleSubmitSide(matchId, side, submission) {
    const allMatches = [...tournament.matches, ...tournament.bracket];
    const match = allMatches.find(m=>m.id===matchId);
    if (!match) return;

    const isGroupMatch = tournament.matches.some(m=>m.id===matchId);
    const newSub = side==="A" ? { submissionA: submission } : { submissionB: submission };
    const updatedMatch = { ...match, ...newSub };
    const otherSub = side==="A" ? updatedMatch.submissionB : updatedMatch.submissionA;

    let status = updatedMatch.status;
    let result = updatedMatch.result;
    let closeStr = updatedMatch.closeStr;

    if (otherSub) {
      // Both submitted — compare
      if (submissionsMatch(updatedMatch.submissionA, updatedMatch.submissionB)) {
        status = "closed";
        result = submission.result;
        closeStr = submission.closeStr;
      } else {
        status = "disputed";
      }
    } else {
      status = "pending_validation";
    }

    const finalMatch = { ...updatedMatch, status, result, closeStr };
    onSaveMatch(matchId, finalMatch, isGroupMatch);
    setScorecardMatchId(null);
    showToast(status==="closed"?"Result validated ✓":status==="disputed"?"⚠ Dispute flagged — admin notified":"Scorecard submitted — awaiting opponent");
  }

  if (scorecardMatchId) {
    return (
      <>
        <ScorecardScreen
          tournament={tournament}
          matchId={scorecardMatchId}
          onBack={()=>setScorecardMatchId(null)}
          onSubmitSide={handleSubmitSide}
          isAdmin={false}
        />
        <Toast message={toast}/>
      </>
    );
  }

  const navItems=[
    {id:"matches",label:"Matches",icon:"⛳"},
    {id:"standings",label:"Standings",icon:"📊"},
    {id:"bracket",label:"Bracket",icon:"🏆"},
  ];

  return (
    <>
      {tab==="matches"&&<PublicMatchesTab tournament={tournament} onOpenMatch={setScorecardMatchId}/>}
      {tab==="standings"&&<PublicStandingsTab tournament={tournament}/>}
      {tab==="bracket"&&<PublicBracketTab tournament={tournament} onOpenMatch={setScorecardMatchId}/>}
      <nav className="mp-bottom-nav">
        {navItems.map(item=>(
          <button key={item.id} className={`mp-nav-item${tab===item.id?" active":""}`} onClick={()=>setTab(item.id)}>
            <span className="nav-icon">{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <Toast message={toast}/>
    </>
  );
}

// ─── PUBLIC HOME ─────────────────────────────────────────────────────────────
function PublicHome({ db, onSaveMatch }) {
  const active   = db.tournaments.filter(t=>t.status==="active");
  const archived = db.tournaments.filter(t=>t.status==="archived").sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const [activeTournIdx, setActiveTournIdx] = useState(0);
  const [archiveView, setArchiveView] = useState(null); // tournament id
  const [archiveTab, setArchiveTab] = useState("bracket");

  // Archive detail view
  if (archiveView) {
    const t = archived.find(t=>t.id===archiveView);
    if (!t) { setArchiveView(null); return null; }
    return (
      <div className="mp-root">
        <div className="mp-topbar">
          <button onClick={()=>setArchiveView(null)} className="mp-back-btn">← Back</button>
          <BrandMark />
          <div className="w-60"/>
        </div>
        <div className="mp-archive-header">
          <div className="mp-archive-kicker">Archive</div>
          <div className="mp-archive-title">{t.name}</div>
          <div className="mp-underline-tabs">
            {[{id:"bracket",label:"Bracket"},{id:"groups",label:"Group Results"}].map(item=>(
              <button key={item.id} onClick={()=>setArchiveTab(item.id)} className={`mp-underline-tab${archiveTab===item.id?" is-active":""}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {archiveTab==="bracket"&&<PublicBracketTab tournament={t} onOpenMatch={()=>{}}/>}
        {archiveTab==="groups"&&<PublicStandingsTab tournament={t}/>}
      </div>
    );
  }

  // No active tournaments
  if (active.length===0) {
    return (
      <div className="mp-root">
        <div className="mp-topbar">
          <BrandMark />
        </div>
        <div className="mp-page ta-center pt-60">
          <div className="mp-empty-title">No Active Tournaments</div>
          <div className="mp-empty-sub">Check back soon or contact your commissioner.</div>
        </div>
        {archived.length>0&&(
          <div className="mp-archive-section">
            <div className="mp-archive-label">Past Tournaments</div>
            {archived.map(t=>(
              <div key={t.id} className="mp-archive-card" onClick={()=>setArchiveView(t.id)}>
                <div>
                  <div className="mp-archive-name">{t.name}</div>
                  <div className="mp-archive-meta">
                    {t.mode==="players"?"Singles":"Teams"} · {new Date(t.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="font-meta t-accent">View →</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const currentTourn = active[activeTournIdx] || active[0];

  return (
    <div className="mp-root">
      <div className="mp-topbar">
        <BrandMark />
        <div className="mp-topbar-badge">{currentTourn.mode==="players"?"Singles":"Teams"}</div>
      </div>

      {/* Underline tabs — only show if multiple active tournaments */}
      {active.length>1&&(
        <div className="mp-tourn-tabs">
          {active.map((t,i)=>(
            <button key={t.id} className={`mp-tourn-tab${activeTournIdx===i?" active":""}`} onClick={()=>setActiveTournIdx(i)}>
              <div className="mp-tourn-tab-name">{t.mode==="players"?"Singles":"Teams"}</div>
              <div className="mp-tourn-tab-year">{t.name.match(/\d{4}/)?.[0]||t.name.split(" ").slice(0,2).join(" ")}</div>
            </button>
          ))}
        </div>
      )}

      <PublicTournamentView
        key={currentTourn.id}
        tournament={currentTourn}
        onSaveMatch={onSaveMatch}
      />

      {archived.length>0&&(
        <div className="mp-archive-section pb-nav">
          <div className="mp-archive-label">Past Tournaments</div>
          {archived.map(t=>(
            <div key={t.id} className="mp-archive-card" onClick={()=>setArchiveView(t.id)}>
              <div>
                <div className="mp-archive-name">{t.name}</div>
                <div className="mp-archive-meta">
                  {t.mode==="players"?"Singles":"Teams"} · {new Date(t.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-8">
                {t.championId&&<span className="font-meta t-accent">🏆 {t.teams.find(tm=>tm.id===t.championId)?.name?.split(" ")[0]}</span>}
                <span className="font-meta t-muted">View →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN: SETUP FORM ───────────────────────────────────────────────────────
function AdminSetupForm({ onCreated, onCancel }) {
  const [step, setStep] = useState(1);
  const [tournName, setTournName] = useState("");
  const [numTeams, setNumTeams] = useState(4);
  const [numGroups, setNumGroups] = useState(2);
  const [teamNames, setTeamNames] = useState(Array(4).fill(""));
  const [advancersPerGroup, setAdvancersPerGroup] = useState(1);
  const [mode, setMode] = useState("teams");
  const [errors, setErrors] = useState({});

  function handleNumTeams(val) {
    const n=Math.max(4,Math.min(16,val));
    setNumTeams(n);
    setTeamNames(prev=>{const next=[...prev];while(next.length<n)next.push("");return next.slice(0,n);});
    const minG=Math.ceil(n/4);
    const maxG=Math.floor(n/2);
    setNumGroups(g=>Math.max(minG,Math.min(maxG,g)));
  }
  function handleNumGroups(val){
    const minGroups=Math.ceil(numTeams/4);
    const ng=Math.max(minGroups,Math.min(Math.floor(numTeams/2),val));
    setNumGroups(ng);
    setAdvancersPerGroup(a=>Math.min(a,Math.ceil(numTeams/ng)-1));
  }
  function updateTeamName(i,val){setTeamNames(prev=>{const n=[...prev];n[i]=val;return n;});setErrors(p=>{const e={...p};delete e[`team_${i}`];return e;});}
  function validateStep1(){if(!tournName.trim()){setErrors({tournName:"Required"});return false;}return true;}
  function validateStep2(){
    const e={};
    teamNames.forEach((n,i)=>{if(!n.trim())e[`team_${i}`]="required";});
    const unique=new Set(teamNames.map(n=>n.trim().toLowerCase()).filter(Boolean));
    if(unique.size<teamNames.filter(n=>n.trim()).length)e.duplicate=`${mode==="players"?"Player":"Team"} names must be unique`;
    if(Object.keys(e).length){setErrors(e);return false;}return true;
  }
  const totalAdvancers=numGroups*advancersPerGroup;
  const bracketLabel=totalAdvancers<=2?"Final only":totalAdvancers<=4?"Semis + Final":"QF + Semis + Final";
  const label=mode==="players"?"player":"team";
  const Label=mode==="players"?"Player":"Team";

  return (
    <div className="mp-page">
      <div className="mp-steps">
        {["Configure",`${Label}s`,"Review"].map((lbl,i)=>(
          <div key={lbl} className="mp-step">
            <div className={`mp-step-bar${i<step?" is-done":""}${i<step-1?" is-past":""}`}/>
            <div className={`mp-step-label${i===step-1?" is-current":""}`}>{lbl}</div>
          </div>
        ))}
      </div>

      {step===1&&<>
        <div className="mp-section-eyebrow">New Tournament</div>
        <div className="mp-section-title">Set up the field</div>
        <div className="mp-section-sub">Configure structure before adding {label}s.</div>
        <div className="mp-card">
          <div className="mp-card-title">Tournament Name</div>
          <input className={`mp-input${errors.tournName?" error":""}`} value={tournName} onChange={e=>setTournName(e.target.value)} placeholder="e.g. 2026 Team Match Play"/>
          {errors.tournName&&<div className="mp-error">⚠ {errors.tournName}</div>}
        </div>
        <div className="mp-card">
          <div className="mp-card-title">Format</div>
          <div className="mp-choice-row">
            {[{val:"teams",label:"🏌️‍♂️🏌️‍♂️  Teams",sub:"2+ players per side"},{val:"players",label:"🏌️  Singles",sub:"1 player per side"}].map(({val,sub})=>(
              <button key={val} onClick={()=>setMode(val)} className={`mp-choice${mode===val?" is-active":""}`}>
                <div className="mp-choice-title">{val==="teams"?"🏌️‍♂️🏌️‍♂️ Teams":"🏌️ Singles"}</div>
                <div className="mp-choice-sub">{sub}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="mp-card">
          <div className="mp-card-title">Number of {Label}s</div>
          <div className="mp-stepper">
            <button className="mp-stepper-btn" onClick={()=>handleNumTeams(numTeams-2)} disabled={numTeams<=4}>−</button>
            <div className="mp-stepper-val">{numTeams}</div>
            <button className="mp-stepper-btn" onClick={()=>handleNumTeams(numTeams+2)} disabled={numTeams>=16}>+</button>
          </div>
          <div className="mp-stepper-hint">Even numbers · 4–16</div>
        </div>
        <div className="mp-card">
          <div className="mp-card-title">Number of Groups</div>
          <div className="mp-stepper">
            <button className="mp-stepper-btn" onClick={()=>handleNumGroups(numGroups-1)} disabled={numGroups<=1}>−</button>
            <div className="mp-stepper-val">{numGroups}</div>
            <button className="mp-stepper-btn" onClick={()=>handleNumGroups(numGroups+1)} disabled={numGroups>=Math.floor(numTeams/2)}>+</button>
          </div>
          <div className="mp-stepper-hint">Min {Math.ceil(numTeams/4)} groups · Max 4 per group</div>
        </div>
        <div className="mp-card">
          <div className="mp-card-title">{Label}s Advancing Per Group</div>
          <div className="mp-stepper">
            <button className="mp-stepper-btn" onClick={()=>setAdvancersPerGroup(a=>Math.max(1,a-1))} disabled={advancersPerGroup<=1}>−</button>
            <div className="mp-stepper-val">{advancersPerGroup}</div>
            <button className="mp-stepper-btn" onClick={()=>setAdvancersPerGroup(a=>Math.min(Math.ceil(numTeams/numGroups)-1,a+1))} disabled={advancersPerGroup>=Math.ceil(numTeams/numGroups)-1}>+</button>
          </div>
          <div className="mp-stepper-hint">{advancersPerGroup===1?`Only the group winner advances`:`Top ${advancersPerGroup} ${label}s per group advance`}</div>
          {(()=>{
            const teamsPerGroup=Math.ceil(numTeams/numGroups);
            const matchesPerTeam=teamsPerGroup-1;
            const isPow2=n=>n>0&&(n&(n-1))===0;
            const isClean=isPow2(totalAdvancers);
            const nextUp=Math.pow(2,Math.ceil(Math.log2(Math.max(totalAdvancers+0.5,2))));
            const nextDown=Math.pow(2,Math.floor(Math.log2(Math.max(totalAdvancers,2))));
            let suggestion="";
            if(!isClean){
              const advUp=nextUp/numGroups;
              const advDown=nextDown/numGroups;
              if(Number.isInteger(advUp)&&advUp<teamsPerGroup&&advUp>=1) suggestion=`Set advancers to ${advUp} per group → ${nextUp}-team bracket`;
              else if(Number.isInteger(advDown)&&advDown>=1&&advDown!==advancersPerGroup) suggestion=`Set advancers to ${Math.round(advDown)} per group → ${nextDown}-team bracket`;
              else suggestion=`Adjust groups or advancers to reach a power of 2 total (2, 4, 8...)`;
            }
            return (
              <div className={`mp-callout-box${isClean?" is-clean":" is-warn"}`}>
                <div className="mp-callout-box-head">
                  <span className="font-meta">{isClean?"✓":"⚠"}</span>
                  <span className={`font-meta fw-700${isClean?" t-win":" t-accent"}`}>
                    {isClean?"Clean bracket · No byes":"Uneven bracket · Byes in play"}
                  </span>
                </div>
                {[
                  `${teamsPerGroup} ${label}${teamsPerGroup>1?"s":""} per group`,
                  `${matchesPerTeam} match${matchesPerTeam!==1?"es":""} per ${label} (full round robin)`,
                  `${totalAdvancers} total ${label}s advance`,
                  bracketLabel,
                ].map(t=>(
                  <div key={t} className="flex items-center gap-8 mb-6">
                    <div className={`font-meta shrink-0${isClean?" t-win":" t-accent"}`}>—</div>
                    <div className="font-meta-sm t-body">{t}</div>
                  </div>
                ))}
                {!isClean&&suggestion&&(
                  <div className="mp-callout-box-foot font-meta-sm t-accent">
                    💡 {suggestion}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        <div className="mp-modal-actions">
          <button className="mp-btn mp-btn-ghost flex-1" onClick={onCancel}>Cancel</button>
          <button className="mp-btn mp-btn-primary flex-2" onClick={()=>{if(validateStep1())setStep(2);}}>Next: Add {Label}s →</button>
        </div>
      </>}

      {step===2&&<>
        <div className="mp-section-eyebrow">{Label} Names</div>
        <div className="mp-section-title">Name your {label}s</div>
        <div className="mp-section-sub">{numTeams} {label}s · {numGroups} group{numGroups>1?"s":""}</div>
        <div className="mp-card">
          <div className="mp-card-title">Enter {label} names</div>
          {errors.duplicate&&<div className="mp-error">⚠ {errors.duplicate}</div>}
          <div className="mp-team-grid">
            {teamNames.map((name,i)=>(
              <div className="mp-team-input-wrap" key={i}>
                <span className="mp-team-num">{i+1}</span>
                <input className={`mp-input${errors[`team_${i}`]?" error":""}`} value={name} onChange={e=>updateTeamName(i,e.target.value)} placeholder={`${Label} ${i+1}`} maxLength={24}/>
              </div>
            ))}
          </div>
        </div>
        <div className="mp-modal-actions">
          <button className="mp-btn mp-btn-ghost" onClick={()=>setStep(1)} className="flex-1">← Back</button>
          <button className="mp-btn mp-btn-primary" onClick={()=>{if(validateStep2())setStep(3);}} className="flex-2">Review Draw →</button>
        </div>
      </>}

      {step===3&&(()=>{
        const previewGroups=Array.from({length:numGroups},(_,i)=>({
          id:`g${i}`,name:`Group ${String.fromCharCode(65+i)}`,
          members:shuffle(teamNames.map((n,i)=>({id:`t${i}`,name:n.trim()}))).filter((_,ti)=>ti%numGroups===i),
        }));
        return <>
          <div className="mp-section-eyebrow">Review</div>
          <div className="mp-section-title">Round 1 Draw</div>
          <div className="mp-section-sub">{Label}s randomly assigned. Tap Start to confirm.</div>
          {previewGroups.map(g=>(
            <div key={g.id} className="mp-card">
              <div className="mp-group-preview-title">{g.name}</div>
              <div className="flex flex-wrap gap-6 mb-10">{g.members.map(m=><div key={m.id} className="mp-chip">{m.name}</div>)}</div>
              <div className="mp-group-preview-body">
                <div className="font-label-wide t-faint mb-8">Round 1 Matchups</div>
                {Array.from({length:Math.floor(g.members.length/2)},(_,i)=>(
                  <div key={i} className="mp-admin-row is-schedule">
                    <div className="mp-match-name">{g.members[i*2]?.name}</div>
                    <div className="font-meta t-muted">vs</div>
                    <div className="mp-match-name right">{g.members[i*2+1]?.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="mp-info-box">
            ⚠ Draw is re-randomized on Start. This is a preview.
          </div>
          <div className="mp-modal-actions">
            <button className="mp-btn mp-btn-ghost" onClick={()=>setStep(2)} className="flex-1">← Back</button>
            <button className="mp-btn mp-btn-primary" onClick={()=>onCreated(initTournament({name:tournName.trim(),numTeams,numGroups,teamNames,advancersPerGroup,mode}))} className="flex-2">Start Tournament →</button>
          </div>
        </>;
      })()}
    </div>
  );
}

// ─── ADMIN: OVERRIDE MODAL ───────────────────────────────────────────────────
function OverrideModal({ match, tournament, onSave, onClose }) {
  const tA=tournament.teams.find(t=>t.id===match.teamA);
  const tB=match.teamB?tournament.teams.find(t=>t.id===match.teamB):null;
  const [result,setResult]=useState(match.result||"A");
  const [closeStr,setCloseStr]=useState(match.closeStr||"");
  return (
    <div className="mp-modal-backdrop">
      <div className="mp-modal">
        <div className="mp-modal-title">Override Result</div>
        <div className="mp-empty-sub mb-20">{tA?.name} vs {tB?.name||"Bye"}</div>
        <div className="mp-choice-row mb-16">
          {[{val:"A",lbl:tA?.name?.split(" ")[0]||"A"},{val:"H",lbl:"Halve"},{val:"B",lbl:tB?.name?.split(" ")[0]||"B"}].map(({val,lbl})=>(
            <button key={val} onClick={()=>setResult(val)} className={`mp-result-btn${result===val?" is-active":""}`}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="mb-16">
          <div className="font-label t-muted mb-6">Score (e.g. 3&2, 1 UP, Halved)</div>
          <input value={closeStr} onChange={e=>setCloseStr(e.target.value)} placeholder="e.g. 3&2" className="mp-input mb-0"/>
        </div>
        <div className="mp-modal-actions">
          <button onClick={onClose} className="mp-modal-cancel">Cancel</button>
          <button onClick={()=>onSave(match.id,{...match,result,closeStr,status:"closed",submissionA:null,submissionB:null})} className="mp-btn mp-btn-primary flex-2">Save Override →</button>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN: TOURNAMENT MANAGEMENT ────────────────────────────────────────────
function AdminTournamentDetail({ tournament, onSaveMatch, onArchive, onBack }) {
  const [overrideMatch, setOverrideMatch] = useState(null);
  const [tab, setTab] = useState("matches");
  const [toast, setToast] = useState(null);
  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2500);}

  const allMatches=[...tournament.matches,...tournament.bracket];
  const disputed=allMatches.filter(m=>m.status==="disputed");
  const awaitingValidation=allMatches.filter(m=>m.status==="pending_validation");

  function forceApproveFromSubmission(m) {
    const sub = m.submissionA || m.submissionB;
    if (!sub) return m;
    return { ...m, result: sub.result, closeStr: sub.closeStr };
  }

  function handleOverrideSave(matchId, updatedMatch) {
    const isGroup=tournament.matches.some(m=>m.id===matchId);
    onSaveMatch(matchId, updatedMatch, isGroup);
    setOverrideMatch(null);
    showToast("Result overridden ✓");
  }

  return (
    <div>
      {overrideMatch&&<OverrideModal match={overrideMatch} tournament={tournament} onSave={handleOverrideSave} onClose={()=>setOverrideMatch(null)}/>}
      <div className="mp-underline-tabs sticky">
        <div className="mp-underline-tabs">
          {[{id:"matches",label:"Matches"},{id:"overrides",label:`Overrides${disputed.length?` (${disputed.length})`:""}` },{id:"info",label:"Info"}].map(item=>(
            <button key={item.id} onClick={()=>setTab(item.id)} className={`mp-underline-tab pad-sm${tab===item.id?" is-active":""}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab==="matches"&&(
        <div className="mp-page">
          {(awaitingValidation.length>0||disputed.length>0)&&(
            <div className="mb-16">
              {awaitingValidation.length>0&&(
                <div className="mb-12">
                  <div className="font-label t-accent mb-8">⏳ Awaiting Second Submission</div>
                  {awaitingValidation.map(m=>{
                    const tA=tournament.teams.find(t=>t.id===m.teamA),tB=m.teamB?tournament.teams.find(t=>t.id===m.teamB):null;
                    const sub=m.submissionA||m.submissionB;
                    const submittedSide=m.submissionA?tA:tB;
                    const waitingSide=m.submissionA?tB:tA;
                    return (
                      <div key={m.id} className="mp-callout flex items-center gap-10">
                        <div className="flex-1">
                          <div className="t-heading fw-600 mb-4">{tA?.name} vs {tB?.name}</div>
                          <div className="font-meta-sm t-muted mb-2">✓ {submittedSide?.name}: {sub?.result==="A"?tA?.name:sub?.result==="B"?tB?.name:"Halve"} {sub?.closeStr}</div>
                          <div className="font-meta t-faint">⏳ Waiting on {waitingSide?.name}</div>
                        </div>
                        <button onClick={()=>setOverrideMatch(forceApproveFromSubmission(m))} className="mp-btn mp-btn-primary shrink-0">Force Approve</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {disputed.length>0&&<div className="mp-dispute-section-label">⚠ Disputed Results</div>}
              {disputed.map(m=>{
                const tA=tournament.teams.find(t=>t.id===m.teamA),tB=m.teamB?tournament.teams.find(t=>t.id===m.teamB):null;
                return (
                  <div key={m.id} className="mp-dispute-banner" onClick={()=>setOverrideMatch(m)} className="mp-clickable">
                    <div className="flex-1">
                      <div className="t-heading fw-600 mb-3">{tA?.name} vs {tB?.name}</div>
                      <div className="font-meta-sm t-muted">A: {m.submissionA?.closeStr||"—"} · B: {m.submissionB?.closeStr||"—"}</div>
                    </div>
                    <span className="font-meta t-danger">Resolve →</span>
                  </div>
                );
              })}
            </div>
          )}
          {tournament.groups.map(g=>{
            const gMatches=tournament.matches.filter(m=>m.groupId===g.id&&!m.isBye);
            const eliminatedFlags=g.eliminatedWithMatchesRemaining||[];
            if(!gMatches.length)return null;
            const closedCount=gMatches.filter(m=>m.status==="closed").length;
            return (
              <div key={g.id} className="mp-card">
                <div className="flex items-center justify-between mb-12">
                  <div className="mp-card-title mb-0">{g.name}</div>
                  <div className="flex items-center gap-6">
                    <span className="font-label t-faint">{closedCount}/{gMatches.length}</span>
                    <span className={`badge ${g.status==="done"?"badge-advanced":"badge-active"}`}>{g.status==="done"?"Done":"Playing"}</span>
                  </div>
                </div>
                {eliminatedFlags.length>0&&(
                  <div className="mp-callout">
                    <div className="font-label t-accent mb-6">⚠ Eliminated — Coordinate Remaining Match</div>
                    {eliminatedFlags.map(id=>{const t=tournament.teams.find(t2=>t2.id===id);return <div key={id} className="font-meta-sm t-muted">{t?.name} is 0-2 and eliminated but has matches remaining</div>;})}
                  </div>
                )}
                                {gMatches.map(m=>{
                  const tA=tournament.teams.find(t=>t.id===m.teamA),tB=m.teamB?tournament.teams.find(t=>t.id===m.teamB):null;
                  return (
                    <div key={m.id} className={`mp-admin-row${m.status==="closed"?" is-closed":m.status==="disputed"?" is-disputed":""}`}>
                      <div className="mp-match-name">{tA?.name}</div>
                      <div className="font-meta t-muted">vs</div>
                      <div className="mp-match-name right">{tB?.name}</div>
                      <div className="flex items-center gap-6 ml-6">
                        {m.status==="closed"&&<span className="badge badge-done">{m.closeStr} ✓</span>}
                        {m.status==="disputed"&&<span className="badge badge-disputed">⚠</span>}
                        {m.status==="pending_validation"&&<span className="badge badge-validation">Validating</span>}
                        {m.status==="pending"&&<span className="badge badge-pending">Pending</span>}
                        {m.status==="pending_validation"&&<button onClick={()=>setOverrideMatch(forceApproveFromSubmission(m))} className="mp-edit-btn fw-700">Force Approve</button>}
                        <button onClick={()=>setOverrideMatch(m)} className="mp-edit-btn">Edit</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {tournament.bracket.filter(m=>!m.isBye).length>0&&(
            <div className="mp-card">
              <div className="mp-card-title">Bracket Matches</div>
              {tournament.bracket.filter(m=>!m.isBye).map(m=>{
                const tA=tournament.teams.find(t=>t.id===m.teamA),tB=m.teamB?tournament.teams.find(t=>t.id===m.teamB):null;
                return (
                  <div key={m.id} className={`mp-admin-row${m.status==="closed"?" is-closed":m.status==="disputed"?" is-disputed":""}`}>
                    <div className="mp-match-name">{tA?.name||"TBD"}</div>
                    <div className="font-meta t-muted">vs</div>
                    <div className="mp-match-name right">{tB?.name||"TBD"}</div>
                    <div className="flex items-center gap-6 ml-6">
                      {m.status==="closed"&&<span className="badge badge-done">{m.closeStr} ✓</span>}
                      {m.status==="disputed"&&<span className="badge badge-disputed">⚠</span>}
                      {m.status==="pending_validation"&&<span className="badge badge-validation">Validating</span>}
                      {m.status==="pending"&&<span className="badge badge-pending">Pending</span>}
                      {m.status==="pending_validation"&&<button onClick={()=>setOverrideMatch(forceApproveFromSubmission(m))} className="mp-edit-btn fw-700">Force Approve</button>}
                      <button onClick={()=>setOverrideMatch(m)} className="mp-edit-btn">Edit</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab==="overrides"&&(
        <div className="mp-page">
          <div className="mp-section-eyebrow">Commissioner</div>
          <div className="mp-section-title">Override Results</div>
          <div className="mp-section-sub">Correct any match result. This bypasses player validation.</div>
          {[...tournament.matches,...tournament.bracket].filter(m=>!m.isBye).map(m=>{
            const tA=tournament.teams.find(t=>t.id===m.teamA),tB=m.teamB?tournament.teams.find(t=>t.id===m.teamB):null;
            const isGroup=tournament.matches.some(mm=>mm.id===m.id);
            return (
              <div key={m.id} className="mp-list-row pad-hist flex items-center gap-8">
                <div className="flex-1 font-meta-sm t-body">{tA?.name} <span className="t-muted">vs</span> {tB?.name||"TBD"}</div>
                <div className={`mp-status-meta${m.status==="closed"?" is-closed":m.status==="disputed"?" is-disputed":""}`}>{m.status==="closed"?m.closeStr||"closed":m.status}</div>
                <button onClick={()=>setOverrideMatch(m)} className="mp-edit-btn pad-md">Edit</button>
              </div>
            );
          })}
        </div>
      )}

      {tab==="info"&&(
        <div className="mp-page">
          <div className="mp-section-eyebrow">Tournament Info</div>
          <div className="mp-section-title">{tournament.name}</div>
          <div className="mp-card">
            {[["Format",tournament.mode==="players"?"Singles":"Teams"],["Phase",tournament.phase],["Teams",tournament.numTeams],["Groups",tournament.numGroups],["Advancers/Group",tournament.advancersPerGroup],["Created",new Date(tournament.createdAt).toLocaleDateString()]].map(([k,v])=>(
              <div key={k} className="mp-list-row pad-y">
                <span className="font-meta-sm t-muted">{k}</span>
                <span className="t-body fw-600">{v}</span>
              </div>
            ))}
          </div>
          <div className="mp-card">
            <div className="mp-card-title">Archive Tournament</div>
            <div className="mp-empty-sub mb-14">Archiving removes it from the public active view. Players can still see it in Past Tournaments.</div>
            <button className="mp-btn mp-btn-ghost is-accent" onClick={onArchive}>Archive This Tournament</button>
          </div>
        </div>
      )}
      <Toast message={toast}/>
    </div>
  );
}

// ─── ADMIN HOME ───────────────────────────────────────────────────────────────
function AdminHome({ db, onCreateTournament, onSaveMatch, onArchive }) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("active"); // "active" | "archived"

  const active   = db.tournaments.filter(t=>t.status==="active");
  const archived = db.tournaments.filter(t=>t.status==="archived").sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));

  const selected = db.tournaments.find(t=>t.id===selectedId);

  if (creating) {
    return <AdminSetupForm onCreated={t=>{onCreateTournament(t);setCreating(false);setSelectedId(t.id);}} onCancel={()=>setCreating(false)}/>;
  }

  if (selected) {
    return (
      <AdminTournamentDetail
        tournament={selected}
        onSaveMatch={(matchId,match,isGroup)=>onSaveMatch(selected.id,matchId,match,isGroup)}
        onArchive={()=>{onArchive(selected.id);setSelectedId(null);}}
        onBack={()=>setSelectedId(null)}
      />
    );
  }

  return (
    <div className="mp-page">
      <div className="mp-section-eyebrow">Commissioner</div>
      <div className="mp-section-title">Admin Panel</div>

      {/* View toggle */}
      <div className="mp-segment mb-20">
        {[{id:"active",label:"Active"},{id:"archived",label:"Archived"}].map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)} className={`mp-seg-btn${view===v.id?" is-active":""}`}>
            {v.label} {v.id==="active"?`(${active.length})`:`(${archived.length})`}
          </button>
        ))}
      </div>

      {view==="active"&&<>
        {active.length===0&&(
          <div className="mp-card ta-center pad-xl">
            <div className="mp-champion-emoji sm">⛳</div>
            <div className="font-meta t-muted">No active tournaments</div>
          </div>
        )}
        {active.map(t=>{
          const allM=[...t.matches,...t.bracket];
          const disputed=allM.filter(m=>m.status==="disputed").length;
          const pending=allM.filter(m=>m.status==="pending"||m.status==="pending_validation").length;
          return (
            <div key={t.id} className="mp-card mp-clickable" onClick={()=>setSelectedId(t.id)}>
              <div className="flex justify-between mb-8">
                <div>
                  <div className="font-label t-accent mb-4">{t.mode==="players"?"Singles":"Teams"} · {t.phase}</div>
                  <div className="t-heading fw-700">{t.name}</div>
                </div>
                <span className="font-meta t-accent">Manage →</span>
              </div>
              <div className="flex flex-wrap gap-8 mt-8">
                {disputed>0&&<span className="badge badge-disputed">⚠ {disputed} dispute{disputed>1?"s":""}</span>}
                {pending>0&&<span className="badge badge-pending">{pending} pending</span>}
                {disputed===0&&pending===0&&<span className="badge badge-done">All clear ✓</span>}
              </div>
            </div>
          );
        })}
        <button className="mp-btn mp-btn-primary" onClick={()=>setCreating(true)} disabled={active.length>=3}>
          + New Tournament
        </button>
        {active.length>=3&&<div className="font-meta-sm t-muted ta-center mt-8">Max 3 active tournaments</div>}
      </>}

      {view==="archived"&&<>
        {archived.length===0&&(
          <div className="mp-card ta-center pad-xl">
            <div className="font-meta t-muted">No archived tournaments</div>
          </div>
        )}
        {archived.map(t=>(
          <div key={t.id} className="mp-card mp-clickable" onClick={()=>setSelectedId(t.id)}>
            <div className="font-label t-muted mb-4">{t.mode==="players"?"Singles":"Teams"} · {new Date(t.createdAt).toLocaleDateString()}</div>
            <div className="t-heading fw-700 mb-6">{t.name}</div>
            {t.championId&&<div className="font-meta-sm t-accent">🏆 {t.teams.find(tm=>tm.id===t.championId)?.name}</div>}
          </div>
        ))}
      </>}
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [db, setDb] = useState({ tournaments: [] });
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(false);

  // Simple hash-based routing: #/admin → admin view
  const [route, setRoute] = useState(window.location.hash==="#/admin"?"admin":"public");
  useEffect(()=>{
    const handler=()=>setRoute(window.location.hash==="#/admin"?"admin":"public");
    window.addEventListener("hashchange",handler);
    return ()=>window.removeEventListener("hashchange",handler);
  },[]);

  useEffect(()=>{
    loadAll().then(data=>{ setDb(data||{tournaments:[]}); setLoading(false); });

    // Realtime — when any device saves, all other open tabs update automatically
    const channel = supabase
      .channel("tournament_updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournaments",
          filter: `id=eq.${DB_ID}`,
        },
        (payload) => {
          const incoming = payload.new?.state;
          if (incoming) setDb(incoming);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  },[]);

  async function persist(newDb) { setDb(newDb); await saveAll(newDb); }

  function handleCreateTournament(t) {
    persist({ ...db, tournaments: [...db.tournaments, t] });
  }

  function handleSaveMatch(tournId, matchId, updatedMatch, isGroupMatch) {
    const tournament = db.tournaments.find(t=>t.id===tournId);
    if (!tournament) return;

    let updated;
    if (isGroupMatch) {
      const updatedMatches = tournament.matches.map(m=>m.id===matchId?updatedMatch:m);
      let t2 = { ...tournament, matches: updatedMatches };
      if (updatedMatch.status==="closed") {
        const groupId = updatedMatch.groupId;
        t2 = advanceGroupIfReady(t2, groupId);
      }
      updated = t2;
    } else {
      const updatedBracket = tournament.bracket.map(m=>m.id===matchId?updatedMatch:m);
      let t2 = { ...tournament, bracket: updatedBracket };
      if (updatedMatch.status==="closed") t2 = advanceBracketIfReady(t2);
      updated = t2;
    }
    persist({ ...db, tournaments: db.tournaments.map(t=>t.id===tournId?updated:t) });
  }

  // Public score submission (no tournId needed — find from matchId)
  function handlePublicSaveMatch(tournId, matchId, updatedMatch, isGroupMatch) {
    handleSaveMatch(tournId, matchId, updatedMatch, isGroupMatch);
  }

  function handleArchive(tournId) {
    persist({ ...db, tournaments: db.tournaments.map(t=>t.id===tournId?{...t,status:"archived"}:t) });
  }

  if (loading) return (
    <><div className="mp-loading">
      <div className="mp-loading-text">LOADING...</div>
    </div></>
  );

  // ── ADMIN ROUTE ──
  if (route==="admin") {
    if (!adminAuthed) {
      return (
        <><div className="mp-root">
          <AdminPasswordScreen onUnlock={()=>setAdminAuthed(true)}/>
        </div></>
      );
    }
    return (
      <><div className="mp-root">
        <div className="mp-topbar">
          <BrandMark />
          <div className="mp-topbar-right">
            <span className="mp-topbar-badge">Admin</span>
            <button onClick={()=>{window.location.hash="";setAdminAuthed(false);}} className="mp-exit-btn">Exit</button>
          </div>
        </div>
        <AdminHome
          db={db}
          onCreateTournament={handleCreateTournament}
          onSaveMatch={handleSaveMatch}
          onArchive={handleArchive}
        />
      </div></>
    );
  }

  // ── PUBLIC ROUTE ──
  // Wrap onSaveMatch to find the tournament from matchId
  function publicSaveMatch(matchId, updatedMatch, isGroupMatch) {
    const tournament = db.tournaments.find(t=>[...t.matches,...t.bracket].some(m=>m.id===matchId));
    if (!tournament) return;
    handleSaveMatch(tournament.id, matchId, updatedMatch, isGroupMatch);
  }

  return (
    <><div className="mp-root">
      <PublicHome db={db} onSaveMatch={publicSaveMatch}/>
      {/* Hidden admin link in footer */}
      <div className="mp-admin-footer">
        <button onClick={()=>{window.location.hash="#/admin";}} className="mp-link-admin">ADMIN</button>
      </div>
    </div></>
  );
}
