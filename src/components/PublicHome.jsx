import { useState, useEffect, useRef } from "react";
import { BrandMark } from "./BrandMark.jsx";
import { Toast } from "./Toast.jsx";
import { ScorecardScreen } from "./ScorecardScreen.jsx";
import { tournamentStyleOf, styleLabel, matchPlayedLabel, matchActivityLabel, nowIso, bracketRoundLabel } from "../lib/format.js";
import { computeGroupStats, sortByRecord, submissionsMatch } from "../lib/engine.js";

function PublicMatchesTab({ tournament, onOpenMatch }) {
  function getTeam(id) { return tournament.teams.find(t => t.id === id); }

  const groups = tournament.groups || [];
  const hasPools = tournamentStyleOf(tournament) === "pool_bracket" && groups.length > 0;
  const bracketMatches = (tournament.bracket || []).filter(m => !m.isBye);
  const hasBracket = bracketMatches.length > 0;

  const defaultExpanded = (() => {
    const ids = [];
    if (tournament.phase === "group" && hasPools) {
      const playing = groups.filter(g => g.status !== "done");
      (playing.length ? playing : groups.slice(0, 1)).forEach(g => ids.push(g.id));
    } else if (hasBracket) {
      ids.push("__bracket__");
    }
    return ids;
  })();

  const [expandedIds, setExpandedIds] = useState(defaultExpanded);

  function toggle(id) {
    setExpandedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function statusBadge(m) {
    if (m.status === "disputed") return <span className="badge badge-disputed">⚠ Disputed</span>;
    if (m.status === "pending_validation") return <span className="badge badge-validation">Pending Validation</span>;
    if (m.status === "closed") {
      const w = m.result === "A" ? getTeam(m.teamA) : m.result === "B" ? getTeam(m.teamB) : null;
      return <span className="badge badge-done">{w ? `${w.name.split(" ")[0]} ${m.closeStr}` : "Halve"} ✓</span>;
    }
    return <span className="badge badge-pending">Enter →</span>;
  }

  function MatchRow({ m }) {
    const tA = getTeam(m.teamA);
    const tB = m.teamB ? getTeam(m.teamB) : null;
    const statusCls = m.status === "closed" ? " is-closed" : m.status === "disputed" ? " is-disputed" : "";
    const activity = matchActivityLabel(m);
    const played = matchPlayedLabel(m);
    return (
      <div className={`mp-match-row-item${statusCls}`} onClick={() => onOpenMatch(m.id)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-8">
            <div className={`mp-match-name${m.status === "closed" && m.result === "A" ? " is-winner" : ""}`}>{tA?.name}</div>
            <div className="mp-match-vs">vs</div>
            <div className={`mp-match-name right${m.status === "closed" && m.result === "B" ? " is-winner" : ""}`}>
              {tB?.name || <span className="mp-match-bye">Bye</span>}
            </div>
          </div>
          {played && <div className="mp-match-time">{played}</div>}
          {activity && <div className="mp-match-time">{activity}</div>}
        </div>
        <div className="ml-6 shrink-0">{statusBadge(m)}</div>
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
        {hasBracket && (
          <>
            <div className="mp-section-eyebrow mt-8">Knockout</div>
            <MatchAccordion
              id="__bracket__"
              title="Bracket Matches"
              meta="Final results"
              badge={<span className="badge badge-advanced">Done</span>}
              matches={bracketMatches}
            />
          </>
        )}
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

      {hasBracket && (
        <>
          <div className={`mp-section-eyebrow${hasPools ? " mt-8" : ""}`}>Knockout Stage</div>
          {!hasPools && <div className="mp-section-title mb-14">Matches</div>}
          <MatchAccordion
            id="__bracket__"
            title="Bracket Matches"
            meta={`${bracketMatches.filter(m => m.status !== "closed").length} open`}
            badge={
              <span className={`badge ${bracketMatches.every(m => m.status === "closed") ? "badge-advanced" : "badge-active"}`}>
                {bracketMatches.every(m => m.status === "closed") ? "Done" : "Live"}
              </span>
            }
            matches={bracketMatches}
          />
        </>
      )}

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
  if (tournamentStyleOf(tournament) === "single_elim" || !groups?.length) {
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

function buildBracketColumns(bracket) {
  const r1 = bracket
    .filter(m => m.bracketRound === 1)
    .sort((a, b) => a.slot - b.slot);
  if (!r1.length) return [];

  const r1Count = r1.length;
  const totalRounds = Math.round(Math.log2(r1Count)) + 1;
  const columns = [];

  for (let r = 1; r <= totalRounds; r++) {
    const expected = r1Count / Math.pow(2, r - 1);
    const existing = bracket
      .filter(m => m.bracketRound === r)
      .sort((a, b) => a.slot - b.slot);
    const slots = Array.from({ length: expected }, (_, s) =>
      existing.find(m => m.slot === s) || null
    );
    columns.push({ round: r, matches: slots });
  }
  return columns;
}

function PublicBracketTab({ tournament, onOpenMatch }) {
  function getTeam(id) { return id ? tournament.teams.find(t => t.id === id) : null; }
  const { bracket, groups, phase } = tournament;

  if ((phase !== "bracket" && phase !== "complete") || !bracket.length) {
    if (tournamentStyleOf(tournament) === "single_elim") {
      return (
        <div className="mp-page">
          <div className="mp-section-eyebrow">Knockout</div>
          <div className="mp-section-title">Bracket</div>
          <div className="mp-card ta-center pad-xl">
            <div className="font-meta t-muted">Bracket will appear once the tournament starts.</div>
          </div>
        </div>
      );
    }
    const done = (groups || []).filter(g => g.status === "done").length;
    return (
      <div className="mp-page">
        <div className="mp-section-eyebrow">Knockout</div>
        <div className="mp-section-title">Bracket</div>
        <div className="mp-card ta-center pad-xl">
          <div className="font-meta t-muted mb-12">{done}/{(groups || []).length} groups complete</div>
          <div className="font-meta-sm t-faint mb-16">Bracket unlocks when every group finishes.</div>
          {(groups || []).map(g => (
            <div key={g.id} className="mp-list-row">
              <span className="font-meta-sm t-body">{g.name}</span>
              {g.status === "done"
                ? <span className="badge badge-advanced">{getTeam(g.winnerId)?.name}</span>
                : <span className="badge badge-active">Playing</span>
              }
            </div>
          ))}
        </div>
      </div>
    );
  }

  const columns = buildBracketColumns(bracket);
  const champion = phase === "complete" ? getTeam(tournament.championId) : null;

  function MatchCell({ match }) {
    if (!match) {
      return (
        <div className="mp-viz-match is-placeholder">
          <div className="mp-viz-side"><span className="mp-viz-name is-empty">TBD</span></div>
          <div className="mp-viz-side"><span className="mp-viz-name is-empty">TBD</span></div>
        </div>
      );
    }

    const tA = getTeam(match.teamA);
    const tB = match.teamB ? getTeam(match.teamB) : null;
    const clickable = !match.isBye;
    const closed = match.status === "closed";

    return (
      <button
        type="button"
        className={[
          "mp-viz-match",
          match.status === "disputed" ? "is-disputed" : "",
          match.isBye ? "is-bye" : "",
          clickable ? "is-clickable" : "",
        ].filter(Boolean).join(" ")}
        disabled={!clickable}
        onClick={() => clickable && onOpenMatch(match.id)}
      >
        {[
          { side: "A", team: tA },
          { side: "B", team: tB },
        ].map(({ side, team }) => {
          const won = closed && match.result === side;
          const lost = closed && match.result && match.result !== "H" && match.result !== side;
          return (
            <div
              key={side}
              className={[
                "mp-viz-side",
                won ? "is-winner" : "",
                lost ? "is-loser" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className={`mp-viz-name${!team && !match.isBye ? " is-empty" : ""}`}>
                {team?.name || (match.isBye && side === "B" ? "BYE" : "TBD")}
              </span>
              {won && match.closeStr && match.closeStr !== "bye" && (
                <span className="mp-viz-score">{match.closeStr}</span>
              )}
              {!closed && !match.isBye && team && side === "A" && match.status === "pending" && (
                <span className="mp-viz-enter">Enter</span>
              )}
              {match.status === "disputed" && side === "A" && (
                <span className="mp-viz-score is-danger">Dispute</span>
              )}
            </div>
          );
        })}
      </button>
    );
  }

  return (
    <div className="mp-page pb-100">
      {champion && (
        <div className="mp-champion">
          <div className="mp-champion-label">Champion</div>
          <div className="mp-champion-name mb">{champion.name}</div>
        </div>
      )}
      <div className="mp-section-eyebrow">Knockout Stage</div>
      <div className="mp-section-title">Bracket</div>
      <div className="font-meta-sm t-faint mb-14">Swipe sideways to explore the full tree</div>

      <div className="mp-viz-scroll">
        <div
          className="mp-viz"
          style={{ "--r1-count": columns[0]?.matches.length || 1 }}
        >
          {columns.map((col, colIdx) => (
            <div key={col.round} className="mp-viz-col">
              <div className="mp-viz-col-label">
                {bracketRoundLabel(col.matches.length)}
              </div>
              <div className="mp-viz-col-body">
                {col.matches.map((match, i) => (
                  <div
                    key={match?.id || `r${col.round}-s${i}`}
                    className="mp-viz-slot"
                    style={{ flex: Math.pow(2, colIdx) }}
                  >
                    <MatchCell match={match} />
                    {colIdx > 0 && (
                      <span className="mp-viz-in" aria-hidden="true" />
                    )}
                    {colIdx < columns.length - 1 && (
                      <>
                        <span className="mp-viz-stub" aria-hidden="true" />
                        <span className="mp-viz-elbow" aria-hidden="true" />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
  const [activeTournIdx, setActiveTournIdx] = useState(0);
  const [archiveView, setArchiveView] = useState(null); // tournament id
  const [archiveTab, setArchiveTab] = useState("bracket");

  useEffect(() => { onEnsureArchives?.(); }, []); // load archives once when this view mounts

  // Archive detail view
  if (archiveView) {
    const t = archived.find(t => t.id === archiveView);
    if (!t) { setArchiveView(null); return null; }
    return (
      <div className="mp-root">
        <div className="mp-topbar">
          <button onClick={() => setArchiveView(null)} className="mp-back-btn">← Back</button>
          <BrandMark />
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
          <BrandMark />
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
          <BrandMark />
        </div>
        <div className="mp-tourn-banner">
          {active.length > 1 ? (
            <TournamentPicker
              tournaments={active}
              valueId={currentTourn.id}
              onChange={id => {
                const idx = active.findIndex(t => t.id === id);
                if (idx >= 0) setActiveTournIdx(idx);
              }}
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
