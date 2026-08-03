import { useState, useEffect } from "react";
import { Toast } from "./Toast.jsx";
import BracketView from "./BracketView.jsx";
import AdminAppSettings from "./AdminAppSettings.jsx";
import { initTournament, submissionsMatch } from "../lib/engine.js";
import {
  nowIso,
  localDateInputValue,
  formatMatchTime,
  matchPlayedLabel,
  matchActivityLabel,
  waitingForTeamId,
  pendingValidationLabel,
  shuffle,
  minGroupsForTeams,
  maxGroupsForTeams,
  maxAdvancersPerGroup,
  clampAdvancers,
  groupLabel,
  bracketStageLabel,
  isPowerOfTwo,
  groupSizeSpread,
  groupSizeSummary,
  totalPoolMatches,
  nearestEvenPowerOfTwo,
  tournamentStyleOf,
  styleLabel,
  bracketRoundLabel,
} from "../lib/format.js";

function AdminSetupForm({ onCreated, onCancel }) {
  const [step, setStep] = useState(1);
  const [tournName, setTournName] = useState("");
  const [numTeams, setNumTeams] = useState(4);
  const [numGroups, setNumGroups] = useState(2);
  const [teamNames, setTeamNames] = useState(Array(4).fill(""));
  const [advancersPerGroup, setAdvancersPerGroup] = useState(1);
  const [mode, setMode] = useState("teams");
  const [style, setStyle] = useState("pool_bracket"); // pool_bracket | single_elim
  const [errors, setErrors] = useState({});

  const isSingleElim = style === "single_elim";
  const minGroups = minGroupsForTeams(numTeams);
  const maxGroups = maxGroupsForTeams(numTeams);
  const maxAdvancers = maxAdvancersPerGroup(numTeams, numGroups);

  function handleNumTeams(val) {
    const n = Math.max(4, Math.min(64, val % 2 === 0 ? val : val - 1));
    const nextMinG = minGroupsForTeams(n);
    const nextMaxG = maxGroupsForTeams(n);
    const ng = Math.max(nextMinG, Math.min(nextMaxG, numGroups));
    setNumTeams(n);
    setTeamNames(prev => {
      const next = [...prev];
      while (next.length < n) next.push("");
      return next.slice(0, n);
    });
    setNumGroups(ng);
    setAdvancersPerGroup(a => clampAdvancers(n, ng, a));
  }
  function handleNumGroups(val) {
    const ng = Math.max(minGroups, Math.min(maxGroups, val));
    setNumGroups(ng);
    setAdvancersPerGroup(a => clampAdvancers(numTeams, ng, a));
  }
  function handleAdvancers(val) {
    setAdvancersPerGroup(clampAdvancers(numTeams, numGroups, val));
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

  const label=mode==="players"?"player":"team";
  const Label=mode==="players"?"Player":"Team";

  // Pool + bracket checks
  const totalAdvancers=numGroups*advancersPerGroup;
  const poolBracketLabel=bracketStageLabel(totalAdvancers);
  const sizes=groupSizeSpread(numTeams,numGroups);
  const sizeSummary=groupSizeSummary(numTeams,numGroups);
  const poolMatches=totalPoolMatches(numTeams,numGroups);
  const matchesPerTeam=sizes.largeCount&&sizes.large!==sizes.small
    ? `${sizes.small-1}–${sizes.large-1}`
    : `${sizes.small-1}`;
  const hasEqualGroups=numTeams%numGroups===0;
  const hasCleanBracket=totalAdvancers>=2&&isPowerOfTwo(totalAdvancers);
  const isPoolClean=hasEqualGroups&&hasCleanBracket;

  // Single elim checks
  const elimBracketSize=Math.pow(2, Math.ceil(Math.log2(Math.max(numTeams, 2))));
  const elimByes=elimBracketSize-numTeams;
  const hasCleanElim=numTeams>=4&&isPowerOfTwo(numTeams);
  const elimStageLabel=bracketStageLabel(numTeams);
  const nearestPow2=nearestEvenPowerOfTwo(numTeams);
  const elimSuggestion=!hasCleanElim&&nearestPow2&&nearestPow2!==numTeams
    ? `Use ${nearestPow2} ${label}s for a clean bracket with no byes`
    : !hasCleanElim
      ? "Use a power of 2 field size (4, 8, 16, 32, 64) for no byes"
      : "";

  function equalGroupsSuggestion() {
    if (hasEqualGroups) return "";
    const validGroupCounts=[];
    for (let g=minGroups;g<=maxGroups;g++) {
      if (numTeams%g===0) validGroupCounts.push(g);
    }
    validGroupCounts.sort((a,b)=>Math.abs(a-numGroups)-Math.abs(b-numGroups));
    const validPlayerCounts=[];
    for (let n=4;n<=64;n+=2) {
      if (n%numGroups!==0) continue;
      const perGroup=n/numGroups;
      if (perGroup>=2&&perGroup<=4) validPlayerCounts.push(n);
    }
    validPlayerCounts.sort((a,b)=>Math.abs(a-numTeams)-Math.abs(b-numTeams));
    const alternatives=[];
    if (validGroupCounts[0]) {
      alternatives.push(`${validGroupCounts[0]} groups (${numTeams/validGroupCounts[0]} per group)`);
    }
    if (validPlayerCounts[0]) {
      alternatives.push(`${validPlayerCounts[0]} ${label}s (${validPlayerCounts[0]/numGroups} per group)`);
    }
    return alternatives.length
      ? `For equal pools, use ${alternatives.join(" or ")}`
      : "Adjust the field or group count so every group has the same size";
  }
  const poolSuggestion=equalGroupsSuggestion();

  function bracketSuggestion() {
    if (hasCleanBracket) return "";
    const nextUp = Math.pow(2, Math.ceil(Math.log2(Math.max(totalAdvancers + 0.5, 2))));
    const nextDown = Math.pow(2, Math.floor(Math.log2(Math.max(totalAdvancers, 2))));
    const advUp = nextUp / numGroups;
    const advDown = nextDown / numGroups;
    if (Number.isInteger(advUp) && advUp <= maxAdvancers && advUp >= 1) {
      return `Set advancers to ${advUp} per group → ${nextUp}-team bracket`;
    }
    if (Number.isInteger(advDown) && advDown >= 1 && advDown <= maxAdvancers && advDown !== advancersPerGroup) {
      return `Set advancers to ${advDown} per group → ${nextDown}-team bracket`;
    }
    for (const target of [nextDown, nextUp, 2, 4, 8, 16, 32, 64]) {
      if (target % advancersPerGroup !== 0) continue;
      const g = target / advancersPerGroup;
      if (!Number.isInteger(g) || g < minGroups || g > maxGroups) continue;
      if (advancersPerGroup > maxAdvancersPerGroup(numTeams, g)) continue;
      return `Set groups to ${g} → ${target}-team bracket`;
    }
    return "Adjust groups or advancers to reach a power of 2 total (2, 4, 8, 16...)";
  }
  const suggestion = bracketSuggestion();

  function startTournament() {
    onCreated(initTournament({
      name: tournName.trim(),
      numTeams,
      numGroups: isSingleElim ? 0 : numGroups,
      teamNames,
      advancersPerGroup: isSingleElim ? 0 : clampAdvancers(numTeams, numGroups, advancersPerGroup),
      mode,
      style,
    }));
  }

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
            {[{val:"teams",label:"Teams",sub:"2+ players per side"},{val:"players",label:"Singles",sub:"1 player per side"}].map(({val,sub})=>(
              <button key={val} onClick={()=>setMode(val)} className={`mp-choice${mode===val?" is-active":""}`}>
                <div className="mp-choice-title">{val==="teams"?"Teams":"Singles"}</div>
                <div className="mp-choice-sub">{sub}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="mp-card">
          <div className="mp-card-title">Tournament Style</div>
          <div className="mp-choice-row">
            {[
              {val:"pool_bracket",title:"Pool + Bracket",sub:"Group play, then knockout"},
              {val:"single_elim",title:"Single Elim",sub:"Straight knockout bracket"},
            ].map(({val,title,sub})=>(
              <button key={val} onClick={()=>setStyle(val)} className={`mp-choice${style===val?" is-active":""}`}>
                <div className="mp-choice-title">{title}</div>
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
            <button className="mp-stepper-btn" onClick={()=>handleNumTeams(numTeams+2)} disabled={numTeams>=64}>+</button>
          </div>
          <div className="mp-stepper-hint">Even numbers · 4–64</div>
        </div>

        {!isSingleElim && <>
          <div className="mp-card">
            <div className="mp-card-title">Number of Groups</div>
            <div className="mp-stepper">
              <button className="mp-stepper-btn" onClick={()=>handleNumGroups(numGroups-1)} disabled={numGroups<=minGroups}>−</button>
              <div className="mp-stepper-val">{numGroups}</div>
              <button className="mp-stepper-btn" onClick={()=>handleNumGroups(numGroups+1)} disabled={numGroups>=maxGroups}>+</button>
            </div>
            <div className="mp-stepper-hint">{minGroups}–{maxGroups} groups · {sizeSummary}</div>
          </div>
          <div className="mp-card">
            <div className="mp-card-title">{Label}s Advancing Per Group</div>
            <div className="mp-stepper">
              <button className="mp-stepper-btn" onClick={()=>handleAdvancers(advancersPerGroup-1)} disabled={advancersPerGroup<=1}>−</button>
              <div className="mp-stepper-val">{advancersPerGroup}</div>
              <button className="mp-stepper-btn" onClick={()=>handleAdvancers(advancersPerGroup+1)} disabled={advancersPerGroup>=maxAdvancers}>+</button>
            </div>
            <div className="mp-stepper-hint">{advancersPerGroup===1?`Only the group winner advances`:`Top ${advancersPerGroup} ${label}s per group advance`}</div>
            <div className={`mp-callout-box${isPoolClean?" is-clean":" is-warn"}`}>
              <div className="mp-callout-box-head">
                <span className="font-meta">{isPoolClean?"✓":"⚠"}</span>
                <span className={`font-meta fw-700${isPoolClean?" t-win":" t-accent"}`}>
                  {isPoolClean
                    ?"Balanced pools · Clean bracket"
                    :!hasEqualGroups&&!hasCleanBracket
                      ?"Uneven pools · Bracket byes"
                      :!hasEqualGroups
                        ?"Uneven pool sizes · Clean bracket"
                        :"Balanced pools · Bracket byes"}
                </span>
              </div>
              {[
                `${hasEqualGroups?"✓":"⚠"} Pool sizes: ${sizeSummary}`,
                `${matchesPerTeam} matches per ${label} · ${poolMatches} pool matches total`,
                `${hasCleanBracket?"✓":"⚠"} ${totalAdvancers} total ${label}s advance`,
                poolBracketLabel,
              ].map(t=>(
                <div key={t} className="flex items-center gap-8 mb-6">
                  <div className={`font-meta shrink-0${isPoolClean?" t-win":" t-accent"}`}>—</div>
                  <div className="font-meta-sm t-body">{t}</div>
                </div>
              ))}
              {!hasEqualGroups&&poolSuggestion&&(
                <div className="mp-callout-box-foot font-meta-sm t-accent">💡 {poolSuggestion}</div>
              )}
              {!hasCleanBracket&&suggestion&&(
                <div className="mp-callout-box-foot font-meta-sm t-accent">💡 {suggestion}</div>
              )}
            </div>
          </div>
        </>}

        {isSingleElim && (
          <div className="mp-card">
            <div className="mp-card-title">Bracket Preview</div>
            <div className={`mp-callout-box${hasCleanElim?" is-clean":" is-warn"}`}>
              <div className="mp-callout-box-head">
                <span className="font-meta">{hasCleanElim?"✓":"⚠"}</span>
                <span className={`font-meta fw-700${hasCleanElim?" t-win":" t-accent"}`}>
                  {hasCleanElim?"Clean bracket · No byes":`Uneven field · ${elimByes} bye${elimByes===1?"":"s"}`}
                </span>
              </div>
              {[
                `${numTeams} ${label}s into a ${elimBracketSize}-slot bracket`,
                elimStageLabel,
                "Seed randomly shuffled on Start",
              ].map(t=>(
                <div key={t} className="flex items-center gap-8 mb-6">
                  <div className={`font-meta shrink-0${hasCleanElim?" t-win":" t-accent"}`}>—</div>
                  <div className="font-meta-sm t-body">{t}</div>
                </div>
              ))}
              {!hasCleanElim&&elimSuggestion&&(
                <div className="mp-callout-box-foot font-meta-sm t-accent">💡 {elimSuggestion}</div>
              )}
            </div>
          </div>
        )}

        <div className="mp-modal-actions">
          <button className="mp-btn mp-btn-ghost flex-1" onClick={onCancel}>Cancel</button>
          <button className="mp-btn mp-btn-primary flex-2" onClick={()=>{if(validateStep1())setStep(2);}}>Next: Add {Label}s →</button>
        </div>
      </>}

      {step===2&&<>
        <div className="mp-section-eyebrow">{Label} Names</div>
        <div className="mp-section-title">Name your {label}s</div>
        <div className="mp-section-sub">
          {numTeams} {label}s · {isSingleElim ? "Single elimination" : `${numGroups} group${numGroups>1?"s":""}`}
        </div>
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
          <button className="mp-btn mp-btn-ghost flex-1" onClick={()=>setStep(1)}>← Back</button>
          <button className="mp-btn mp-btn-primary flex-2" onClick={()=>{if(validateStep2())setStep(3);}}>
            {isSingleElim ? "Review Bracket →" : "Review Draw →"}
          </button>
        </div>
      </>}

      {step===3&&!isSingleElim&&(()=>{
        const previewGroups=Array.from({length:numGroups},(_,i)=>({
          id:`g${i}`,name:groupLabel(i),
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
                <div className="font-label-wide t-faint mb-8">Pool play · full round robin ({g.members.length * (g.members.length - 1) / 2} matches)</div>
                {Array.from({length:Math.floor(g.members.length/2)},(_,i)=>(
                  <div key={i} className="mp-admin-row is-schedule">
                    <div className="mp-match-name">{g.members[i*2]?.name}</div>
                    <div className="font-meta t-muted">vs</div>
                    <div className="mp-match-name right">{g.members[i*2+1]?.name}</div>
                  </div>
                ))}
                {g.members.length > 2 && (
                  <div className="font-meta-sm t-faint mt-8">Preview shows sample pairings only — all round-robin matches are created on Start.</div>
                )}
              </div>
            </div>
          ))}
          <div className={`mp-callout-box mb-16${isPoolClean?" is-clean":" is-warn"}`}>
            <div className="mp-callout-box-head">
              <span className="font-meta">{isPoolClean?"✓":"⚠"}</span>
              <span className={`font-meta fw-700${isPoolClean?" t-win":" t-accent"}`}>
                {isPoolClean
                  ? `Balanced pools · Clean ${totalAdvancers}-${label} bracket`
                  :!hasEqualGroups&&!hasCleanBracket
                    ?"Uneven pool sizes and bracket byes"
                    :!hasEqualGroups
                      ?"Uneven pool sizes"
                      :"Bracket includes byes"}
              </span>
            </div>
            <div className="font-meta-sm t-body">
              {sizeSummary} · {advancersPerGroup} advance per group · {totalAdvancers} total into knockout
            </div>
            {!hasEqualGroups&&<div className="font-meta-sm t-accent mt-8">⚠ Unequal pools play different numbers of matches and are not preferred.</div>}
            {!hasEqualGroups&&poolSuggestion&&<div className="font-meta-sm t-accent mt-4">💡 {poolSuggestion}</div>}
            {!hasCleanBracket&&suggestion&&<div className="font-meta-sm t-accent mt-4">💡 {suggestion}</div>}
          </div>
          <div className="mp-info-box">⚠ Draw is re-randomized on Start. This is a preview.</div>
          <div className="mp-modal-actions">
            <button className="mp-btn mp-btn-ghost flex-1" onClick={()=>setStep(2)}>← Back</button>
            <button className="mp-btn mp-btn-primary flex-2" onClick={startTournament}>Start Tournament →</button>
          </div>
        </>;
      })()}

      {step===3&&isSingleElim&&(()=>{
        const previewNames=shuffle(teamNames.map(n=>n.trim()));
        const slots=[...previewNames];
        while (slots.length < elimBracketSize) slots.push(null);
        const previewPairs=Array.from({length:elimBracketSize/2},(_,i)=>({
          a: slots[i*2], b: slots[i*2+1],
        }));
        return <>
          <div className="mp-section-eyebrow">Review</div>
          <div className="mp-section-title">Opening Round</div>
          <div className="mp-section-sub">Bracket is randomly seeded on Start. Sample pairings below.</div>
          <div className="mp-card">
            <div className="mp-card-title">Round 1 preview</div>
            {previewPairs.map((p,i)=>(
              <div key={i} className="mp-admin-row is-schedule">
                <div className="mp-match-name">{p.a||"Bye"}</div>
                <div className="font-meta t-muted">vs</div>
                <div className="mp-match-name right">{p.b||"Bye"}</div>
              </div>
            ))}
          </div>
          <div className={`mp-callout-box mb-16${hasCleanElim?" is-clean":" is-warn"}`}>
            <div className="mp-callout-box-head">
              <span className="font-meta">{hasCleanElim?"✓":"⚠"}</span>
              <span className={`font-meta fw-700${hasCleanElim?" t-win":" t-accent"}`}>
                {hasCleanElim
                  ? `Clean ${numTeams}-${label} single-elim bracket`
                  : `${numTeams} ${label}s · ${elimByes} bye${elimByes===1?"":"s"} into ${elimBracketSize}-slot bracket`}
              </span>
            </div>
            <div className="font-meta-sm t-body">{elimStageLabel}</div>
            {!hasCleanElim&&elimSuggestion&&<div className="font-meta-sm t-accent mt-8">💡 {elimSuggestion}</div>}
          </div>
          <div className="mp-info-box">⚠ Seed is re-randomized on Start. This is a preview.</div>
          <div className="mp-modal-actions">
            <button className="mp-btn mp-btn-ghost flex-1" onClick={()=>setStep(2)}>← Back</button>
            <button className="mp-btn mp-btn-primary flex-2" onClick={startTournament}>Start Tournament →</button>
          </div>
        </>;
      })()}
    </div>
  );
}

function OverrideModal({ match, tournament, onSave, onClose }) {
  const tA=tournament.teams.find(t=>t.id===match.teamA);
  const tB=match.teamB?tournament.teams.find(t=>t.id===match.teamB):null;
  const [result,setResult]=useState(match.result||"A");
  const initialClose =
    match.closeStr ||
    match.submissionA?.closeStr ||
    match.submissionB?.closeStr ||
    "";
  const [closeStr,setCloseStr]=useState(initialClose);
  const [playedOn,setPlayedOn]=useState(match.playedOn||localDateInputValue());
  const isHalve = result === "H";
  return (
    <div className="mp-modal-backdrop">
      <div className="mp-modal">
        <div className="mp-modal-title">Override Result</div>
        <div className="mp-empty-sub mb-20">{tA?.name} vs {tB?.name||"Bye"}</div>
        <div className="mp-choice-row mb-16">
          {[{val:"A",lbl:tA?.name||"Side A"},{val:"H",lbl:"Halve"},{val:"B",lbl:tB?.name||"Side B"}].map(({val,lbl})=>(
            <button key={val} onClick={()=>setResult(val)} className={`mp-result-btn${result===val?" is-active":""}`}>
              {lbl}
            </button>
          ))}
        </div>
        {!isHalve && (
          <div className="mb-16">
            <div className="font-label t-muted mb-6">Score (e.g. 3&2, 1 UP, or 3)</div>
            <input value={closeStr} onChange={e=>setCloseStr(e.target.value)} placeholder="e.g. 3&2 or 3" className="mp-input mb-0"/>
          </div>
        )}
        <div className="mb-16">
          <div className="font-label t-muted mb-6">Date played</div>
          <input
            type="date"
            className="mp-input mb-0"
            value={playedOn}
            max={localDateInputValue()}
            onChange={e=>setPlayedOn(e.target.value)}
          />
        </div>
        <div className="mp-modal-actions">
          <button onClick={onClose} className="mp-modal-cancel">Cancel</button>
          <button onClick={()=>{
            const ts = nowIso();
            onSave(match.id,{
              ...match,
              result,
              closeStr: isHalve ? "Halved" : closeStr.trim(),
              status:"closed",
              closedAt:ts,
              overriddenAt:ts,
              playedOn: playedOn || match.playedOn || null,
              submissionA:null,
              submissionB:null,
            });
          }} className="mp-btn mp-btn-primary flex-2" disabled={!playedOn || (!isHalve && !closeStr.trim())}>Save Override →</button>
        </div>
      </div>
    </div>
  );
}

function AdminTournamentDetail({ tournament, onSaveMatch, onArchive, onBack }) {
  const [overrideMatch, setOverrideMatch] = useState(null);
  const [tab, setTab] = useState("matches");
  const [toast, setToast] = useState(null);
  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2500);}

  const allMatches=[...tournament.matches,...tournament.bracket];
  const disputed=allMatches.filter(m=>m.status==="disputed");
  const awaitingValidation=allMatches.filter(m=>m.status==="pending_validation");
  const groups = tournament.groups || [];
  const hasPools = tournamentStyleOf(tournament) === "pool_bracket" && groups.length > 0;
  const bracket = tournament.bracket || [];
  const bracketRounds = [...new Set(bracket.map(m => m.bracketRound))].sort((a, b) => a - b);
  const hasBracketList = bracket.some(m => !m.isBye);

  const defaultExpanded = (() => {
    const ids = [];
    if (hasPools && tournament.phase === "group") {
      const playing = groups.filter(g => g.status !== "done");
      (playing.length ? playing : groups.slice(0, 1)).forEach(g => ids.push(g.id));
    }
    if (hasBracketList && (!hasPools || tournament.phase !== "group")) {
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

  function toggleSection(id) {
    setExpandedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function forceApproveFromSubmission(m) {
    const sub = m.submissionA || m.submissionB;
    if (!sub) return m;
    return { ...m, result: sub.result, closeStr: sub.closeStr };
  }

  async function handleOverrideSave(matchId, updatedMatch) {
    const isGroup = tournament.matches.some(m => m.id === matchId);
    setOverrideMatch(null);
    const ok = await onSaveMatch(matchId, updatedMatch, isGroup);
    if (ok === false) showToast("Couldn't save — refresh and try again.");
    else showToast("Result overridden ✓");
  }

  function AdminMatchRow({ m }) {
    const tA = tournament.teams.find(t => t.id === m.teamA);
    const tB = m.teamB ? tournament.teams.find(t => t.id === m.teamB) : null;
    const activity = matchActivityLabel(m);
    const played = matchPlayedLabel(m);
    const waitingId = waitingForTeamId(m);
    const waitingName = waitingId
      ? tournament.teams.find(t => t.id === waitingId)?.name
      : null;
    return (
      <div className={`mp-admin-row${m.status === "closed" ? " is-closed" : m.status === "disputed" ? " is-disputed" : ""}`}>
        <div className="mp-admin-row-main">
          <div className="mp-admin-row-teams">
            <div className="mp-match-name">{tA?.name || "TBD"}</div>
            <div className="font-meta t-muted">vs</div>
            <div className="mp-match-name right">{tB?.name || "TBD"}</div>
          </div>
          {played && <div className="mp-match-time">{played}</div>}
          {activity && <div className="mp-match-time">{activity}</div>}
          {m.status === "pending_validation" && (
            <div className="mp-match-waiting">{pendingValidationLabel(m, waitingName)}</div>
          )}
        </div>
        <div className="mp-admin-row-actions">
          {m.status === "closed" && <span className="badge badge-done">{m.closeStr} ✓</span>}
          {m.status === "disputed" && <span className="badge badge-disputed">Disputed</span>}
          {m.status === "pending" && <span className="badge badge-pending">Pending</span>}
          {m.status === "pending_validation" && (
            <button type="button" onClick={() => setOverrideMatch(forceApproveFromSubmission(m))} className="mp-edit-btn fw-700">
              Force Approve
            </button>
          )}
          <button type="button" onClick={() => setOverrideMatch(m)} className="mp-edit-btn">Edit</button>
        </div>
      </div>
    );
  }

  function AdminAccordion({ id, title, meta, badge, children }) {
    const open = expandedIds.includes(id);
    return (
      <div className={`mp-match-accordion${open ? " is-open" : ""}`}>
        <button
          type="button"
          className="mp-match-accordion-trigger"
          aria-expanded={open}
          onClick={() => toggleSection(id)}
        >
          <div className="flex-1 min-w-0 ta-left">
            <div className="mp-match-accordion-title">{title}</div>
            {meta && <div className="mp-match-accordion-meta">{meta}</div>}
          </div>
          <div className="flex items-center gap-8 shrink-0">
            {badge}
            <span className="mp-match-accordion-chevron" aria-hidden="true" />
          </div>
        </button>
        {open && <div className="mp-match-accordion-body">{children}</div>}
      </div>
    );
  }

  function AdminGroupAccordion({ g }) {
    const gMatches = tournament.matches.filter(m => m.groupId === g.id && !m.isBye);
    if (!gMatches.length) return null;
    const closedCount = gMatches.filter(m => m.status === "closed").length;
    const pendingCount = gMatches.filter(m => m.status !== "closed").length;
    const eliminatedFlags = g.eliminatedWithMatchesRemaining || [];
    return (
      <AdminAccordion
        id={g.id}
        title={g.name}
        meta={g.status === "done" ? "Complete" : pendingCount ? `${pendingCount} open` : "In progress"}
        badge={
          <>
            <span className="font-label t-faint">{closedCount}/{gMatches.length}</span>
            <span className={`badge ${g.status === "done" ? "badge-advanced" : "badge-active"}`}>
              {g.status === "done" ? "Done" : "Playing"}
            </span>
          </>
        }
      >
        {eliminatedFlags.length > 0 && (
          <div className="mp-callout">
            <div className="font-label t-accent mb-6">Eliminated — Coordinate Remaining Match</div>
            {eliminatedFlags.map(id => {
              const t = tournament.teams.find(t2 => t2.id === id);
              return (
                <div key={id} className="font-meta-sm t-muted">
                  {t?.name} is 0-2 and eliminated but has matches remaining
                </div>
              );
            })}
          </div>
        )}
        {gMatches.map(m => <AdminMatchRow key={m.id} m={m} />)}
      </AdminAccordion>
    );
  }

  function AdminRoundAccordion({ round }) {
    const roundAll = bracket.filter(m => m.bracketRound === round);
    const roundMatches = roundAll.filter(m => !m.isBye).sort((a, b) => a.slot - b.slot);
    if (!roundMatches.length) return null;
    const closedCount = roundMatches.filter(m => m.status === "closed").length;
    const pendingCount = roundMatches.filter(m => m.status !== "closed").length;
    const label = bracketRoundLabel(roundAll.length);
    return (
      <AdminAccordion
        id={`__round_${round}`}
        title={label}
        meta={pendingCount ? `${pendingCount} open` : "Complete"}
        badge={
          <>
            <span className="font-label t-faint">{closedCount}/{roundMatches.length}</span>
            <span className={`badge ${pendingCount ? "badge-active" : "badge-advanced"}`}>
              {pendingCount ? "Live" : "Done"}
            </span>
          </>
        }
      >
        {roundMatches.map(m => <AdminMatchRow key={m.id} m={m} />)}
      </AdminAccordion>
    );
  }

  return (
    <div>
      {overrideMatch&&<OverrideModal match={overrideMatch} tournament={tournament} onSave={handleOverrideSave} onClose={()=>setOverrideMatch(null)}/>}
      <div className="mp-page pb-0">
        <button onClick={onBack} className="mp-back-btn mb">← All Tournaments</button>
        <div className="font-label t-accent mb-4">{tournament.mode==="players"?"Singles":"Teams"} · {styleLabel(tournamentStyleOf(tournament))} · {tournament.phase}</div>
        <div className="mp-section-title mb-0">{tournament.name}</div>
      </div>
      <div className="mp-underline-tabs sticky">
        <div className="mp-underline-tabs">
          {[
            {id:"matches",label: disputed.length ? `Matches (${disputed.length})` : "Matches"},
            {id:"bracket",label:"Bracket"},
            {id:"info",label:"Info"},
          ].map(item=>(
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
                  <div className="font-label t-accent mb-8">Awaiting Second Submission</div>
                  {awaitingValidation.map(m=>{
                    const tA=tournament.teams.find(t=>t.id===m.teamA),tB=m.teamB?tournament.teams.find(t=>t.id===m.teamB):null;
                    const sub=m.submissionA||m.submissionB;
                    const submittedSide=m.submissionA?tA:tB;
                    const waitingSide=m.submissionA?tB:tA;
                    const winnerLabel = sub?.result==="A"?tA?.name:sub?.result==="B"?tB?.name:"Halve";
                    return (
                      <div key={m.id} className="mp-admin-alert">
                        <div className="mp-admin-alert-body">
                          <div className="mp-admin-alert-title">{tA?.name} vs {tB?.name}</div>
                          <div className="mp-admin-alert-line">
                            Submitted · {submittedSide?.name}: {winnerLabel}{sub?.closeStr ? ` ${sub.closeStr}` : ""}
                            {sub?.submittedAt ? ` · ${formatMatchTime(sub.submittedAt)}` : ""}
                          </div>
                          {matchPlayedLabel(m) && (
                            <div className="mp-admin-alert-line is-faint">{matchPlayedLabel(m)}</div>
                          )}
                          <div className="mp-admin-alert-line is-wait">Waiting on {waitingSide?.name}</div>
                        </div>
                        <button
                          type="button"
                          onClick={()=>setOverrideMatch(forceApproveFromSubmission(m))}
                          className="mp-admin-alert-btn"
                        >
                          Force Approve
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {disputed.length>0&&<div className="mp-dispute-section-label">Disputed Results</div>}
              {disputed.map(m=>{
                const tA=tournament.teams.find(t=>t.id===m.teamA),tB=m.teamB?tournament.teams.find(t=>t.id===m.teamB):null;
                return (
                  <div key={m.id} className="mp-dispute-banner mp-clickable" onClick={()=>setOverrideMatch(m)}>
                    <div className="flex-1">
                      <div className="t-heading fw-600 mb-3">{tA?.name} vs {tB?.name}</div>
                      <div className="font-meta-sm t-muted">A: {m.submissionA?.closeStr||"—"}{m.submissionA?.submittedAt ? ` · ${formatMatchTime(m.submissionA.submittedAt)}` : ""} · B: {m.submissionB?.closeStr||"—"}{m.submissionB?.submittedAt ? ` · ${formatMatchTime(m.submissionB.submittedAt)}` : ""}</div>
                      {matchActivityLabel(m) && <div className="font-meta-sm t-faint mt-4">{matchActivityLabel(m)}</div>}
                    </div>
                    <span className="font-meta t-danger">Resolve →</span>
                  </div>
                );
              })}
            </div>
          )}

          {hasPools && (
            <>
              <div className="mp-section-eyebrow">
                {tournament.phase === "bracket" || tournament.phase === "complete" ? "Pool Play · History" : "Pool Play"}
              </div>
              <div className="mp-section-title mb-14">Groups</div>
              {groups.map(g => <AdminGroupAccordion key={g.id} g={g} />)}
            </>
          )}

          {hasBracketList && (
            <>
              <div className={`mp-section-eyebrow${hasPools ? " mt-8" : ""}`}>Knockout</div>
              <div className="mp-section-title mb-14">
                {hasPools ? "Rounds" : "Matches"}
              </div>
              {bracketRounds.map(r => <AdminRoundAccordion key={r} round={r} />)}
            </>
          )}

          {!hasPools && !hasBracketList && (
            <div className="mp-card ta-center pad-lg">
              <div className="font-meta t-muted">No matches yet</div>
            </div>
          )}
        </div>
      )}

      {tab==="bracket"&&(
        <div className="mp-page">
          <div className="mp-section-eyebrow">Knockout</div>
          <div className="mp-section-title mb-0">Bracket</div>
          <BracketView
            tournament={tournament}
            mode="admin"
            compact
            onOpenMatch={(matchId) => {
              const m = [...tournament.matches, ...tournament.bracket].find(x => x.id === matchId);
              if (m && !m.isBye) setOverrideMatch(m);
            }}
          />
        </div>
      )}

      {tab==="info"&&(
        <div className="mp-page">
          <div className="mp-section-eyebrow">Tournament Info</div>
          <div className="mp-section-title">{tournament.name}</div>
          <div className="mp-card">
            {[
              ["Format",tournament.mode==="players"?"Singles":"Teams"],
              ["Style",styleLabel(tournamentStyleOf(tournament))],
              ["Phase",tournament.phase],
              ["Field",tournament.numTeams],
              ...(tournamentStyleOf(tournament)==="pool_bracket"
                ? [["Groups",tournament.numGroups],["Advancers/Group",tournament.advancersPerGroup]]
                : []),
              ["Created",new Date(tournament.createdAt).toLocaleDateString()],
            ].map(([k,v])=>(
              <div key={k} className="mp-list-row pad-y">
                <span className="font-meta-sm t-muted">{k}</span>
                <span className="t-body fw-600">{v}</span>
              </div>
            ))}
          </div>
          {tournament.status === "active" && onArchive && (
            <div className="mp-card">
              <div className="mp-card-title">Archive Tournament</div>
              <div className="mp-empty-sub mb-14">Archiving removes it from the public active view. Players can still see it in Past Tournaments.</div>
              <button className="mp-btn mp-btn-ghost is-accent" onClick={onArchive}>Archive This Tournament</button>
            </div>
          )}
        </div>
      )}
      <Toast message={toast}/>
    </div>
  );
}

export default function AdminHome({
  db,
  archived = [],
  onEnsureArchives,
  onCreateTournament,
  onSaveMatch,
  onArchive,
  onSaveDiscordWebhook,
  onSaveAppSettings,
}) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState("active"); // "active" | "archived"

  useEffect(() => { onEnsureArchives?.(); }, []); // load archives once when this view mounts

  const active = db.tournaments.filter(t => t.status === "active");
  const selected = active.find(t => t.id === selectedId) || archived.find(t => t.id === selectedId);

  if (showSettings) {
    return (
      <AdminAppSettings
        db={db}
        onBack={() => setShowSettings(false)}
        onSaveDiscordWebhook={onSaveDiscordWebhook}
        onSaveAppSettings={onSaveAppSettings}
      />
    );
  }

  if (creating) {
    return <AdminSetupForm onCreated={t => { onCreateTournament(t); setCreating(false); setSelectedId(t.id); }} onCancel={() => setCreating(false)}/>;
  }

  if (selected) {
    return (
      <AdminTournamentDetail
        tournament={selected}
        onSaveMatch={(matchId, match, isGroup) => onSaveMatch(selected.id, matchId, match, isGroup)}
        onArchive={selected.status === "active" ? () => { onArchive(selected.id); setSelectedId(null); } : undefined}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="mp-page">
      <div className="mp-section-eyebrow">Commissioner</div>
      <div className="mp-section-title">Admin Panel</div>
      <button type="button" className="mp-app-settings-link mb-20" onClick={() => setShowSettings(true)}>
        App settings →
      </button>

      {/* View toggle */}
      <div className="mp-segment mb-20">
        {[{id:"active",label:"Active"},{id:"archived",label:"Archived"}].map(v => (
          <button key={v.id} onClick={() => setView(v.id)} className={`mp-seg-btn${view === v.id ? " is-active" : ""}`}>
            {v.label} {v.id === "active" ? `(${active.length})` : `(${archived.length})`}
          </button>
        ))}
      </div>

      {view === "active" && <>
        {active.length === 0 && (
          <div className="mp-card ta-center pad-xl">
            <div className="font-meta t-muted">No active tournaments</div>
          </div>
        )}
        {active.map(t => {
          const allM = [...t.matches, ...t.bracket];
          const disputed = allM.filter(m => m.status === "disputed").length;
          const pending = allM.filter(m => m.status === "pending" || m.status === "pending_validation").length;
          return (
            <div key={t.id} className="mp-card mp-clickable" onClick={() => setSelectedId(t.id)}>
              <div className="flex justify-between mb-8">
                <div>
                  <div className="font-label t-accent mb-4">{t.mode === "players" ? "Singles" : "Teams"} · {styleLabel(tournamentStyleOf(t))} · {t.phase}</div>
                  <div className="t-heading fw-700">{t.name}</div>
                </div>
                <span className="font-meta t-accent">Manage →</span>
              </div>
              <div className="flex flex-wrap gap-8 mt-8">
                {disputed > 0 && <span className="badge badge-disputed">⚠ {disputed} dispute{disputed > 1 ? "s" : ""}</span>}
                {pending > 0 && <span className="badge badge-pending">{pending} pending</span>}
                {disputed === 0 && pending === 0 && <span className="badge badge-done">All clear ✓</span>}
              </div>
            </div>
          );
        })}
        <button className="mp-btn mp-btn-primary" onClick={() => setCreating(true)} disabled={active.length >= 3}>
          + New Tournament
        </button>
        {active.length >= 3 && <div className="font-meta-sm t-muted ta-center mt-8">Max 3 active tournaments</div>}
      </>}

      {view === "archived" && <>
        {archived.length === 0 && (
          <div className="mp-card ta-center pad-xl">
            <div className="font-meta t-muted">No archived tournaments</div>
          </div>
        )}
        {archived.map(t => (
          <div key={t.id} className="mp-card mp-clickable" onClick={() => setSelectedId(t.id)}>
            <div className="font-label t-muted mb-4">{t.mode === "players" ? "Singles" : "Teams"} · {styleLabel(tournamentStyleOf(t))} · {new Date(t.createdAt).toLocaleDateString()}</div>
            <div className="t-heading fw-700 mb-6">{t.name}</div>
            {t.championId && <div className="font-meta-sm t-accent">🏆 {t.teams.find(tm => tm.id === t.championId)?.name}</div>}
          </div>
        ))}
      </>}
    </div>
  );
}
