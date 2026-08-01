import { useState } from "react";
import { computeMatchState } from "../lib/engine.js";
import { nowIso, localDateInputValue, formatMatchTime, matchPlayedLabel, matchActivityLabel } from "../lib/format.js";

export function ScorecardScreen({ tournament, matchId, onBack, onSubmitSide, isAdmin, onAdminOverride }) {
  const allMatches = [...(tournament.matches||[]), ...(tournament.bracket||[])];
  const match = allMatches.find(m => m.id === matchId);
  const teamA = tournament.teams.find(t => t.id === match?.teamA);
  const teamB = match?.teamB ? tournament.teams.find(t => t.id === match.teamB) : null;
  const [side, setSide] = useState(null); // null | 'A' | 'B'
  const [holeResults, setHoleResults] = useState(Array(18).fill(null));
  const [playedOn, setPlayedOn] = useState(match?.playedOn || localDateInputValue());

  if (!match) return null;

  const ms = computeMatchState(holeResults);
  const leaderName = ms.leader==="A" ? teamA?.name : ms.leader==="B" ? teamB?.name : null;

  const hasSubA = !!match.submissionA;
  const hasSubB = !!match.submissionB;
  const isLocked = match.status === "closed";
  const isDisputed = match.status === "disputed";
  const isPendingValidation = match.status === "pending_validation";
  const needsPlayedOn = !match.playedOn;

  function getStatus() {
    if (ms.holesPlayed===0) return { cls:"sc-st-unstarted", label:"Not Started", detail:"Tap each hole to record who won it" };
    if (ms.closed && ms.result==="H") return { cls:"sc-st-halved", label:"Halved", detail:"All square after 18" };
    if (ms.closed) return { cls: ms.result==="A" ? "sc-st-closed-a" : "sc-st-closed-b", label:ms.closeStr, detail:`${leaderName} wins` };
    if (ms.isDormy) return { cls: ms.leader==="A" ? "sc-st-dormy-a" : "sc-st-dormy-b", label:"DORMY", detail:`${leaderName} — ${ms.holesRemaining} to play` };
    if (ms.leader) return { cls: ms.leader==="A" ? "sc-st-lead-a" : "sc-st-lead-b", label:`${ms.absLead} UP`, detail:`${leaderName} · ${ms.holesRemaining} to play` };
    return { cls:"sc-st-neutral", label:"All Square", detail:`${ms.holesRemaining} to play` };
  }
  const status = getStatus();

  function setHole(i, val) {
    if (ms.closed && i >= ms.holesPlayed) return;
    const next = [...holeResults];
    next[i] = next[i] === val ? null : val;
    if (next[i] === null) {
      // Clearing a hole leaves a gap — drop everything after it
      for (let j = i + 1; j < 18; j++) next[j] = null;
    } else {
      // Keep later holes; trim anything past a new early close
      const state = computeMatchState(next);
      if (state.closed) {
        for (let j = state.holesPlayed; j < 18; j++) next[j] = null;
      }
    }
    setHoleResults(next);
  }

  function handleSubmit() {
    if (!ms.closed) return;
    if (needsPlayedOn && !playedOn) return;
    onSubmitSide(matchId, side, {
      holeResults,
      result: ms.result,
      closeStr: ms.closeStr,
      submittedAt: nowIso(),
      ...(needsPlayedOn ? { playedOn } : {}),
    });
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
            {match.playedOn && (
              <div className="font-meta-sm mp-support-text mt-4">{matchPlayedLabel(match)}</div>
            )}
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
                  {match.submissionA?.submittedAt ? ` · ${formatMatchTime(match.submissionA.submittedAt)}` : ""}
                </div>
                <div className="font-meta-sm t-muted">
                  {teamB?.name} submitted: {match.submissionB?.closeStr} · {match.submissionB?.result==="A"?teamA?.name:match.submissionB?.result==="B"?teamB?.name:"Halve"}
                  {match.submissionB?.submittedAt ? ` · ${formatMatchTime(match.submissionB.submittedAt)}` : ""}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="sc-result-box">
          <div className="sc-result-winner">
            {match.result==="H"?"Match Halved":match.result==="A"?`${teamA?.name} Wins`:`${teamB?.name} Wins`}
          </div>
          <div className="sc-result-score">{match.closeStr}</div>
          {matchPlayedLabel(match) && (
            <div className="font-meta-sm mp-support-text mt-8">{matchPlayedLabel(match)}</div>
          )}
          {matchActivityLabel(match) && (
            <div className="font-meta-sm mp-support-text mt-4">{matchActivityLabel(match)}</div>
          )}
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
        <div className="font-label mb-8">
          Entering as:{" "}
          <span className={side === "A" ? "sc-team-tone-a" : "sc-team-tone-b"}>
            {side === "A" ? teamA?.name : teamB?.name}
          </span>
        </div>
        <div className="sc-teams-row">
          <div className="flex-1">
            <div className="sc-team-name sc-team-tone-a">{teamA?.name}</div>
          </div>
          <div className="sc-vs">vs</div>
          <div className="flex-1">
            <div className="sc-team-name right sc-team-tone-b">{teamB?.name}</div>
          </div>
        </div>
        <div className="sc-tally">
          {Array.from({length:18},(_,i)=>{
            const r=holeResults[i]; const isAuto=ms.closed&&i>=ms.holesPlayed;
            const mark = !isAuto && r ? (r === "H" ? "/" : r === "A" ? "↑" : "↓") : "";
            return <div key={i} className={`sc-tally-pip${isAuto?" sc-tally-empty":r==="A"?" sc-tally-A":r==="B"?" sc-tally-B":r==="H"?" sc-tally-H":" sc-tally-empty"}`}>{mark}</div>;
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
                {isAuto?"·":r?(r==="H"?"/":r==="A"?"↑":"↓"):"—"}
              </div>
            </div>
          );
        })}
      </div>

      {ms.closed && (
        <div className="sc-result-box">
          <div className="sc-result-winner">{ms.result==="H"?"Match Halved":ms.result==="A"?`${teamA?.name} Wins`:`${teamB?.name} Wins`}</div>
          <div className="sc-result-score">{ms.closeStr}</div>
          <div className="sc-played-on">
            {needsPlayedOn ? (
              <>
                <div className="font-label t-muted mb-6">Date played</div>
                <input
                  type="date"
                  className="mp-input mb-0"
                  value={playedOn}
                  max={localDateInputValue()}
                  onChange={e => setPlayedOn(e.target.value)}
                />
                <div className="font-meta-sm mp-support-text mt-6">Required for the first scorecard submission</div>
              </>
            ) : (
              <div className="font-meta-sm mp-support-text">{matchPlayedLabel(match)}</div>
            )}
          </div>
          <button
            className="mp-btn mp-btn-sign"
            onClick={handleSubmit}
            disabled={needsPlayedOn && !playedOn}
          >
            Confirm & Sign Scorecard
          </button>
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
