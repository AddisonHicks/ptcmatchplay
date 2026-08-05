import { useState, useEffect, useRef } from "react";
import { BrandMark } from "./BrandMark.jsx";
import { Toast } from "./Toast.jsx";
import { ScorecardScreen } from "./ScorecardScreen.jsx";
import BracketView from "./BracketView.jsx";
import { tournamentStyleOf, styleLabel, matchPlayedLabel, matchActivityLabel, nowIso, waitingForTeamId, pendingValidationLabel, bracketRoundLabel } from "../lib/format.js";
import { computeGroupStats, sortByRecord, submissionsMatch, groupAdvancementNotes, matchCloseStr } from "../lib/engine.js";

function PublicMatchesTab({ tournament, onOpenMatch }) {
  function getTeam(id) { return tournament.teams.find(t => t.id === id); }

  const groups = tournament.groups || [];
  const hasPools = tournamentStyleOf(tournament) === "pool_bracket" && groups.length > 0;
  const bracket = tournament.bracket || [];
  const bracketMatches = bracket.filter(m => !m.isBye);
  const hasBracket = bracketMatches.length > 0;
  const bracketRounds = [...new Set(bracket.map(m => m.bracketRound))].sort((a, b) => a - b);

  const defaultExpanded = (() => {
    const ids = [];
    if (tournament.phase === "group" && hasPools) {
      const playing = groups.filter(g => g.status !== "done");
      (playing.length ? playing : groups.slice(0, 1)).forEach(g => ids.push(g.id));
    } else if (hasBracket) {
      let openedRound = false;
      for (const r of bracketRounds) {
        const hasOpen = bracket.some(m => m.bracketRound === r && !m.isBye && m.status !== "closed");
        if (hasOpen) {
          ids.push(`__round_${r}`);
          openedRound = true;
        }
      }
      if (!openedRound && bracketRounds.length) {
        ids.push(`__round_${bracketRounds[bracketRounds.length - 1]}`);
      }
    }
    return ids;
  })();

  const [expandedIds, setExpandedIds] = useState(defaultExpanded);

  function toggle(id) {
    setExpandedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function statusBadge(m) {
    if (m.status === "disputed") return <span className="badge badge-disputed">⚠ Disputed</span>;
    if (m.status === "pending_validation" || m.status === "closed") return null;
    return <span className="badge badge-pending">Enter →</span>;
  }

  function closedResultLabel(m) {
    if (m.status !== "closed" || m.isBye) return null;
    if (m.result === "H") return "Halve";
    const score = matchCloseStr(m);
    if (!score || score === "bye") return null;
    return score;
  }

  function MatchRow({ m }) {
    const tA = getTeam(m.teamA);
    const tB = m.teamB ? getTeam(m.teamB) : null;
    const statusCls = m.status === "closed" ? " is-closed" : m.status === "disputed" ? " is-disputed" : "";
    const activity = matchActivityLabel(m);
    const played = matchPlayedLabel(m);
    const waitingId = waitingForTeamId(m);
    const waitingName = waitingId ? getTeam(waitingId)?.name : null;
    const badge = statusBadge(m);
    const closed = m.status === "closed";
    const aWon = closed && m.result === "A";
    const bWon = closed && m.result === "B";
    const aLost = closed && m.result === "B";
    const bLost = closed && m.result === "A";
    const resultLabel = closedResultLabel(m);
    return (
      <div className={`mp-match-row-item${statusCls}`} onClick={() => onOpenMatch(m.id)}>
        <div className="flex-1 min-w-0">
          <div className="mp-match-teams">
            <div className={`mp-match-name${aWon ? " is-winner" : ""}${aLost ? " is-loser" : ""}`}>
              {aWon ? <span className="mp-match-name-hl">{tA?.name}</span> : tA?.name}
            </div>
            <div className="mp-match-vs">
              <span className="mp-match-vs-label">vs</span>
              {resultLabel && <span className="mp-match-result">{resultLabel}</span>}
            </div>
            <div className={`mp-match-name right${bWon ? " is-winner" : ""}${bLost ? " is-loser" : ""}`}>
              {bWon ? (
                <span className="mp-match-name-hl">{tB?.name}</span>
              ) : (
                tB?.name || <span className="mp-match-bye">Bye</span>
              )}
            </div>
          </div>
          {played && <div className="mp-match-time">{played}</div>}
          {activity && <div className="mp-match-time">{activity}</div>}
          {m.status === "pending_validation" && (
            <div className="mp-match-waiting">{pendingValidationLabel(m, waitingName)}</div>
          )}
        </div>
        {badge && <div className="mp-match-badge">{badge}</div>}
      </div>
    );
  }

  function MatchAccordion({ id, title, meta, badge, matches, callout }) {
    const open = expandedIds.includes(id);
    const closedCount = matches.filter(m => m.status === "closed").length;
    return (
      <div className={`mp-match-accordion${open ? " is-open" : ""}`}>
        <button
          type="button"
          className="mp-match-accordion-trigger"
          aria-expanded={open}
          onClick={() => toggle(id)}
        >
          <div className="flex-1 min-w-0 ta-left">
            <div className="mp-match-accordion-title">{title}</div>
            {meta && <div className="mp-match-accordion-meta">{meta}</div>}
          </div>
          <div className="flex items-center gap-8 shrink-0">
            <span className="font-label t-faint">{closedCount}/{matches.length}</span>
            {badge}
            <span className="mp-match-accordion-chevron" aria-hidden="true" />
          </div>
        </button>
        {open && (
          <div className="mp-match-accordion-body">
            {callout}
            {matches.length === 0 ? (
              <div className="font-meta-sm t-faint ta-center pad-lg">No matches yet</div>
            ) : (
              matches.map(m => <MatchRow key={m.id} m={m} />)
            )}
          </div>
        )}
      </div>
    );
  }

  function RoundAccordion({ round }) {
    const roundAll = bracket.filter(m => m.bracketRound === round);
    const roundMatches = roundAll.filter(m => !m.isBye).sort((a, b) => a.slot - b.slot);
    if (!roundMatches.length) return null;
    const pendingCount = roundMatches.filter(m => m.status !== "closed").length;
    const allDone = pendingCount === 0;
    return (
      <MatchAccordion
        id={`__round_${round}`}
        title={bracketRoundLabel(roundAll.length)}
        meta={allDone ? "Complete" : `${pendingCount} open`}
        badge={
          <span className={`badge ${allDone ? "badge-advanced" : "badge-active"}`}>
            {allDone ? "Done" : "Live"}
          </span>
        }
        matches={roundMatches}
      />
    );
  }

  function KnockoutSection({ complete = false }) {
    return (
      <>
        <div className={`mp-section-eyebrow${hasPools ? " mt-8" : ""}`}>
          {complete ? "Knockout" : "Knockout Stage"}
        </div>
        {!complete && <div className="mp-section-title mb-14">Rounds</div>}
        {bracketRounds.map(r => <RoundAccordion key={r} round={r} />)}
      </>
    );
  }

  if (tournament.phase === "complete") {
    const champion = tournament.teams.find(t => t.id === tournament.championId);
    return (
      <div className="mp-page pb-100">
        <div className="mp-champion">
          <div className="mp-champion-emoji">🏆</div>
          <div className="mp-champion-label">Tournament Champion</div>
          <div className="mp-champion-name">{champion?.name}</div>
        </div>
        {hasPools && (
          <>
            <div className="mp-section-eyebrow">Pool Play</div>
            {groups.map(g => {
              const gMatches = tournament.matches.filter(m => m.groupId === g.id && !m.isBye);
              return (
                <MatchAccordion
                  key={g.id}
                  id={g.id}
                  title={g.name}
                  meta="Completed"
                  badge={<span className="badge badge-advanced">Done</span>}
                  matches={gMatches}
                />
              );
            })}
          </>
        )}
        {hasBracket && <KnockoutSection complete />}
      </div>
    );
  }

  return (
    <div className="mp-page pb-100">
      {hasPools && (
        <>
          <div className="mp-section-eyebrow">
            {tournament.phase === "bracket" ? "Pool Play · History" : "Pool Play"}
          </div>
          <div className="mp-section-title mb-14">
            {tournament.phase === "bracket" ? "Groups" : "Matches"}
          </div>
          {groups.map(g => {
            const gMatches = tournament.matches.filter(m => m.groupId === g.id && !m.isBye);
            const eliminatedFlags = g.eliminatedWithMatchesRemaining || [];
            const pendingCount = gMatches.filter(m => m.status !== "closed").length;
            return (
              <MatchAccordion
                key={g.id}
                id={g.id}
                title={g.name}
                meta={
                  g.status === "done"
                    ? "Complete"
                    : pendingCount
                      ? `${pendingCount} open`
                      : "In progress"
                }
                badge={
                  <span className={`badge ${g.status === "done" ? "badge-advanced" : "badge-active"}`}>
                    {g.status === "done" ? "Done" : "Playing"}
                  </span>
                }
                matches={gMatches}
                callout={
                  eliminatedFlags.length > 0 ? (
                    <div className="mp-callout">
                      {eliminatedFlags.map(id => {
                        const t = tournament.teams.find(t2 => t2.id === id);
                        return (
                          <div key={id}>⚠ {t?.name} is eliminated — remaining match may be rescheduled</div>
                        );
                      })}
                    </div>
                  ) : null
                }
              />
            );
          })}
        </>
      )}

      {hasBracket && <KnockoutSection />}

      {!hasPools && !hasBracket && (
        <div className="mp-card ta-center pad-lg">
          <div className="font-meta t-muted">No matches yet</div>
        </div>
      )}
    </div>
  );
}

function PublicStandingsTab({ tournament }) {
  const { teams, groups, matches, groupMap } = tournament;
  const hasPools = tournamentStyleOf(tournament) !== "single_elim" && groups?.length > 0;

  const defaultExpanded = hasPools ? groups.map(g => g.id) : [];

  const [expandedIds, setExpandedIds] = useState(defaultExpanded);

  function toggle(id) {
    setExpandedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  if (!hasPools) {
    return (
      <div className="mp-page">
        <div className="mp-section-eyebrow">Knockout</div>
        <div className="mp-section-title">Standings</div>
        <div className="mp-card ta-center pad-xl">
          <div className="font-meta t-muted">No pool standings for single-elimination events.</div>
          <div className="font-meta-sm t-faint mt-8">Use Matches or Bracket to follow results.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mp-page">
      <div className="mp-section-eyebrow">Group Play</div>
      <div className="mp-section-title mb-14">Standings</div>
      {groups.map(g => {
        const teamIds = groupMap[g.id] || [];
        const groupMatches = matches.filter(m => m.groupId === g.id && m.groupPhase && !m.isBye);
        const overall = computeGroupStats(teamIds, groupMatches);
        const sortedTeams = sortByRecord(teamIds, overall).map(id => teams.find(t => t.id === id)).filter(Boolean);
        const tieNotes = groupAdvancementNotes(g, teamIds, teams, groupMatches);
        const open = expandedIds.includes(g.id);
        const leader = sortedTeams[0];
        const leaderRecord = leader ? overall[leader.id] : null;
        const leaderPlayed = leaderRecord && (leaderRecord.w + leaderRecord.l + leaderRecord.h) > 0;
        return (
          <div key={g.id} className={`mp-match-accordion${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="mp-match-accordion-trigger"
              aria-expanded={open}
              onClick={() => toggle(g.id)}
            >
              <div className="flex-1 min-w-0 ta-left">
                <div className="mp-match-accordion-title">{g.name}</div>
                <div className="mp-match-accordion-meta">
                  {g.status === "done"
                    ? "Complete"
                    : leaderPlayed
                      ? `Led by ${leader.name}`
                      : `${teamIds.length} ${tournament.mode === "players" ? "players" : "teams"}`}
                </div>
              </div>
              <div className="flex items-center gap-8 shrink-0">
                <span className={`badge ${g.status === "done" ? "badge-advanced" : "badge-active"}`}>
                  {g.status === "done" ? "Done" : `R${g.round}`}
                </span>
                <span className="mp-match-accordion-chevron" aria-hidden="true" />
              </div>
            </button>
            {open && (
              <div className="mp-match-accordion-body">
                <table className="mp-table mp-standings-table">
                  <thead>
                    <tr>
                      <th className="mp-th"></th>
                      <th className="mp-th center">W</th>
                      <th className="mp-th center">L</th>
                      <th className="mp-th center">H</th>
                      <th className="mp-th center mp-th-pts">Pts</th>
                      <th className="mp-th center mp-th-margin">+Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTeams.map(team => {
                      const r = overall[team.id];
                      const isWinner = g.winnerIds?.includes(team.id) || team.id === g.winnerId;
                      const isElim = team.status === "eliminated";
                      const played = (r.w + r.l + r.h) > 0;
                      return (
                        <tr key={team.id}>
                          <td className={`mp-td${isWinner ? " is-winner" : isElim ? " is-elim" : ""}`}>{team.name}</td>
                          {["w", "l", "h"].map(k => (
                            <td key={k} className={`mp-td center${k === "w" && r.w > 0 ? " is-win-stat" : k === "l" && r.l > 0 ? " is-loss-stat" : ""}`}>{r[k]}</td>
                          ))}
                          <td className={`mp-td center mp-td-pts${played ? " is-pts" : ""}`}>
                            {played ? r.pts : "—"}
                          </td>
                          <td className={`mp-td center mp-td-margin${played ? " is-margin" : ""}`}>
                            {!played ? "—" : r.margin > 0 ? `+${r.margin}` : r.margin}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {tieNotes.length > 0 && (
                  <div className="mp-standings-notes">
                    {tieNotes.map(note => (
                      <div key={note} className="mp-standings-note">{note}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PublicBracketTab({ tournament, onOpenMatch }) {
  return <BracketView tournament={tournament} onOpenMatch={onOpenMatch} mode="public" />;
}

function PublicTournamentView({ tournament, onSaveMatch }) {
  const [tab, setTab] = useState("matches");
  const [scorecardMatchId, setScorecardMatchId] = useState(null);
  const [toast, setToast] = useState(null);

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(null),2500); }

  async function handleSubmitSide(matchId, side, submission) {
    const allMatches = [...tournament.matches, ...tournament.bracket];
    const match = allMatches.find(m=>m.id===matchId);
    if (!match) return;

    const isGroupMatch = tournament.matches.some(m=>m.id===matchId);
    const { playedOn: playedOnFromSub, ...subFields } = submission;
    const stamped = { ...subFields, submittedAt: submission.submittedAt || nowIso() };
    const newSub = side==="A" ? { submissionA: stamped } : { submissionB: stamped };
    const updatedMatch = { ...match, ...newSub };
    const otherSub = side==="A" ? updatedMatch.submissionB : updatedMatch.submissionA;

    let status = updatedMatch.status;
    let result = updatedMatch.result;
    let closeStr = updatedMatch.closeStr;
    let closedAt = match.closedAt || null;
    let disputedAt = match.disputedAt || null;
    const playedOn = match.playedOn || playedOnFromSub || null;
    const ts = nowIso();

    if (otherSub) {
      // Both submitted — compare
      if (submissionsMatch(updatedMatch.submissionA, updatedMatch.submissionB)) {
        status = "closed";
        result = stamped.result;
        closeStr = stamped.closeStr;
        closedAt = ts;
      } else {
        status = "disputed";
        disputedAt = ts;
      }
    } else {
      status = "pending_validation";
    }

    const finalMatch = { ...updatedMatch, status, result, closeStr, closedAt, disputedAt, playedOn };
    setScorecardMatchId(null);
    const ok = await onSaveMatch(matchId, finalMatch, isGroupMatch);
    if (ok === false) {
      showToast("Couldn't save — someone else updated. Try again.");
    } else {
      showToast(status === "closed" ? "Result validated ✓" : status === "disputed" ? "⚠ Dispute flagged — admin notified" : "Scorecard submitted — awaiting opponent");
    }
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

  const isSingleElim = tournamentStyleOf(tournament) === "single_elim";
  const navItems=[
    {id:"matches",label:"Matches"},
    ...(!isSingleElim ? [{id:"standings",label:"Standings"}] : []),
    {id:"bracket",label:"Bracket"},
  ];
  const activeTab = tab === "standings" && isSingleElim ? "bracket" : tab;

  return (
    <>
      {activeTab==="matches"&&<PublicMatchesTab tournament={tournament} onOpenMatch={setScorecardMatchId}/>}
      {activeTab==="standings"&&!isSingleElim&&<PublicStandingsTab tournament={tournament}/>}
      {activeTab==="bracket"&&<PublicBracketTab tournament={tournament} onOpenMatch={setScorecardMatchId}/>}
      <nav className="mp-bottom-nav">
        {navItems.map(item=>(
          <button key={item.id} className={`mp-nav-item${activeTab===item.id?" active":""}`} onClick={()=>setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <Toast message={toast}/>
    </>
  );
}

function TournamentPicker({ tournaments, valueId, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = tournaments.find(t => t.id === valueId) || tournaments[0];

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`mp-tourn-picker${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="mp-tourn-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select tournament"
        onClick={() => setOpen(o => !o)}
      >
        <span className="mp-tourn-picker-label">{current?.name}</span>
        <span className="mp-tourn-picker-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul className="mp-tourn-picker-menu" role="listbox" aria-label="Tournaments">
          {tournaments.map(t => {
            const selected = t.id === current?.id;
            return (
              <li key={t.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={`mp-tourn-picker-option${selected ? " is-selected" : ""}`}
                  onClick={() => {
                    onChange(t.id);
                    setOpen(false);
                  }}
                >
                  <span className="mp-tourn-picker-option-name">{t.name}</span>
                  <span className="mp-tourn-picker-option-meta">
                    {t.mode === "players" ? "Singles" : "Teams"} · {styleLabel(tournamentStyleOf(t))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function PublicHome({ db, archived = [], onEnsureArchives, onSaveMatch }) {
  const active = db.tournaments.filter(t => t.status === "active");

  function tournIdFromHash() {
    const m = window.location.hash.match(/^#\/t\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function indexForTournId(id) {
    if (!id) return 0;
    const idx = active.findIndex(t => t.id === id);
    return idx >= 0 ? idx : 0;
  }

  const [activeTournIdx, setActiveTournIdx] = useState(() => indexForTournId(tournIdFromHash()));
  const [archiveView, setArchiveView] = useState(null); // tournament id
  const [archiveTab, setArchiveTab] = useState("bracket");

  useEffect(() => { onEnsureArchives?.(); }, []); // load archives once when this view mounts

  useEffect(() => {
    function syncFromHash() {
      if (window.location.hash === "#/admin") return;
      const id = tournIdFromHash();
      if (!id || !active.length) return;
      const idx = active.findIndex(t => t.id === id);
      if (idx >= 0) setActiveTournIdx(idx);
    }
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [active]);

  // Keep idx valid when the active list changes
  useEffect(() => {
    if (!active.length) return;
    if (activeTournIdx >= active.length) setActiveTournIdx(0);
  }, [active, activeTournIdx]);

  function selectTournament(id) {
    const idx = active.findIndex(t => t.id === id);
    if (idx < 0) return;
    setActiveTournIdx(idx);
    const next = `#/t/${encodeURIComponent(id)}`;
    if (window.location.hash !== next) {
      window.location.hash = next;
    }
  }

  // Archive detail view
  if (archiveView) {
    const t = archived.find(t => t.id === archiveView);
    if (!t) { setArchiveView(null); return null; }
    return (
      <div className="mp-root">
        <div className="mp-topbar">
          <button onClick={() => setArchiveView(null)} className="mp-back-btn">← Back</button>
          <BrandMark groupName={db.groupName} groupLogoUrl={db.groupLogoUrl} />
          <div className="w-60"/>
        </div>
        <div className="mp-archive-header">
          <div className="mp-archive-kicker">Archive</div>
          <div className="mp-archive-title">{t.name}</div>
          {tournamentStyleOf(t) !== "single_elim" ? (
            <div className="mp-underline-tabs">
              {[{id:"bracket",label:"Bracket"},{id:"groups",label:"Group Results"}].map(item => (
                <button key={item.id} onClick={() => setArchiveTab(item.id)} className={`mp-underline-tab${archiveTab === item.id ? " is-active" : ""}`}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {(tournamentStyleOf(t) === "single_elim" || archiveTab === "bracket") && <PublicBracketTab tournament={t} onOpenMatch={() => {}}/>}
        {tournamentStyleOf(t) !== "single_elim" && archiveTab === "groups" && <PublicStandingsTab tournament={t}/>}
      </div>
    );
  }

  // No active tournaments
  if (active.length === 0) {
    return (
      <div className="mp-root">
        <div className="mp-topbar">
          <BrandMark groupName={db.groupName} groupLogoUrl={db.groupLogoUrl} />
        </div>
        <div className="mp-page ta-center pt-60">
          <div className="mp-empty-title">No Active Tournaments</div>
          <div className="mp-empty-sub">Check back soon or contact your commissioner.</div>
        </div>
        {archived.length > 0 && (
          <div className="mp-archive-section">
            <div className="mp-archive-label">Past Tournaments</div>
            {archived.map(t => (
              <div key={t.id} className="mp-archive-card" onClick={() => setArchiveView(t.id)}>
                <div>
                  <div className="mp-archive-name">{t.name}</div>
                  <div className="mp-archive-meta">
                    {t.mode === "players" ? "Singles" : "Teams"} · {styleLabel(tournamentStyleOf(t))} · {new Date(t.createdAt).toLocaleDateString()}
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
      <div className="mp-public-header">
        <div className="mp-public-header-brand">
          <BrandMark groupName={db.groupName} groupLogoUrl={db.groupLogoUrl} />
        </div>
        <div className="mp-tourn-banner">
          {active.length > 1 ? (
            <TournamentPicker
              tournaments={active}
              valueId={currentTourn.id}
              onChange={selectTournament}
            />
          ) : (
            <div className="mp-tourn-banner-name">{currentTourn.name}</div>
          )}
          <div className="mp-tourn-banner-meta">
            {currentTourn.mode === "players" ? "Singles" : "Teams"} · {styleLabel(tournamentStyleOf(currentTourn))}
          </div>
        </div>
      </div>

      <PublicTournamentView
        key={currentTourn.id}
        tournament={currentTourn}
        onSaveMatch={onSaveMatch}
      />

      {archived.length > 0 && (
        <div className="mp-archive-section pb-nav">
          <div className="mp-archive-label">Past Tournaments</div>
          {archived.map(t => (
            <div key={t.id} className="mp-archive-card" onClick={() => setArchiveView(t.id)}>
              <div>
                <div className="mp-archive-name">{t.name}</div>
                <div className="mp-archive-meta">
                  {t.mode === "players" ? "Singles" : "Teams"} · {styleLabel(tournamentStyleOf(t))} · {new Date(t.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-8">
                {t.championId && <span className="font-meta t-accent">🏆 {t.teams.find(tm => tm.id === t.championId)?.name?.split(" ")[0]}</span>}
                <span className="font-meta t-muted">View →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
