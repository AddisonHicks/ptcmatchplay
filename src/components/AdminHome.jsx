import { useState, useEffect } from "react";
import { Toast } from "./Toast.jsx";
import BracketView from "./BracketView.jsx";
import AdminAppSettings from "./AdminAppSettings.jsx";
import { initTournament, collectAdvancers, confirmBracketSetup, generateBracket, startKnockoutAuto, startKnockoutManual, canStartKnockout } from "../lib/engine.js";
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
  const [groupNames, setGroupNames] = useState(Array(2).fill(""));
  const [advancersPerGroup, setAdvancersPerGroup] = useState(1);
  const [mode, setMode] = useState("teams");
  const [style, setStyle] = useState("pool_bracket"); // pool_bracket | single_elim
  const [assignmentMode, setAssignmentMode] = useState("random"); // random | manual
  const [elimSeeding, setElimSeeding] = useState("random"); // random | manual (single elim only)
  const [groupAssignments, setGroupAssignments] = useState(Array(4).fill(null)); // group index per team
  const [elimBracketSlots, setElimBracketSlots] = useState([
    { teamA: null, teamB: null },
    { teamA: null, teamB: null },
  ]);
  const [errors, setErrors] = useState({});

  const isSingleElim = style === "single_elim";
  const isManualAssign = !isSingleElim && assignmentMode === "manual";
  const isManualElimSeed = isSingleElim && elimSeeding === "manual";
  const reviewStep = isManualAssign || isManualElimSeed ? 4 : 3;
  const assignStep = isManualAssign ? 3 : null;
  const elimSeedStep = isManualElimSeed ? 3 : null;
  const minGroups = minGroupsForTeams(numTeams);
  const maxGroups = maxGroupsForTeams(numTeams);
  const maxAdvancers = maxAdvancersPerGroup(numTeams, numGroups);

  function syncGroupNames(count) {
    setGroupNames(prev => {
      const next = [...prev];
      while (next.length < count) next.push("");
      return next.slice(0, count);
    });
  }

  function syncGroupAssignments(teamCount, groupCount) {
    setGroupAssignments(prev => {
      const next = [...prev];
      while (next.length < teamCount) next.push(null);
      return next.slice(0, teamCount).map(gi =>
        typeof gi === "number" && gi >= 0 && gi < groupCount ? gi : null
      );
    });
  }
  function syncElimBracketSlots(teamCount) {
    const size = Math.pow(2, Math.ceil(Math.log2(Math.max(teamCount, 2))));
    const matchCount = size / 2;
    setElimBracketSlots(prev => {
      const next = prev.slice(0, matchCount).map(s => ({ teamA: s.teamA, teamB: s.teamB }));
      while (next.length < matchCount) next.push({ teamA: null, teamB: null });
      return next.map(s => ({
        teamA: typeof s.teamA === "number" && s.teamA >= 0 && s.teamA < teamCount ? s.teamA : null,
        teamB: typeof s.teamB === "number" && s.teamB >= 0 && s.teamB < teamCount ? s.teamB : null,
      }));
    });
  }
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
    syncGroupNames(ng);
    syncGroupAssignments(n, ng);
    syncElimBracketSlots(n);
    setAdvancersPerGroup(a => clampAdvancers(n, ng, a));
  }
  function handleNumGroups(val) {
    const ng = Math.max(minGroups, Math.min(maxGroups, val));
    setNumGroups(ng);
    syncGroupNames(ng);
    syncGroupAssignments(numTeams, ng);
    setAdvancersPerGroup(a => clampAdvancers(numTeams, ng, a));
  }
  function assignTeamToGroup(teamIndex, groupIndex) {
    setGroupAssignments(prev => {
      const next = [...prev];
      next[teamIndex] = groupIndex;
      return next;
    });
    setErrors(p => {
      const e = { ...p };
      delete e.assignments;
      return e;
    });
  }
  function clearTeamAssignment(teamIndex) {
    setGroupAssignments(prev => {
      const next = [...prev];
      next[teamIndex] = null;
      return next;
    });
  }
  function handleAdvancers(val) {
    setAdvancersPerGroup(clampAdvancers(numTeams, numGroups, val));
  }
  function updateTeamName(i,val){setTeamNames(prev=>{const n=[...prev];n[i]=val;return n;});setErrors(p=>{const e={...p};delete e[`team_${i}`];return e;});}
  function updateGroupName(i, val) {
    setGroupNames(prev => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
    setErrors(p => {
      const e = { ...p };
      delete e.groupNames;
      return e;
    });
  }
  function resolvedGroupName(i) {
    const custom = groupNames[i]?.trim();
    return custom || groupLabel(i);
  }
  function validateStep1() {
    const e = {};
    if (!tournName.trim()) e.tournName = "Required";
    if (!isSingleElim) {
      const resolved = Array.from({ length: numGroups }, (_, i) => resolvedGroupName(i));
      const unique = new Set(resolved.map(n => n.toLowerCase()));
      if (unique.size < resolved.length) e.groupNames = "Group names must be unique";
    }
    if (Object.keys(e).length) { setErrors(e); return false; }
    return true;
  }
  function validateStep2(){
    const e={};
    teamNames.forEach((n,i)=>{if(!n.trim())e[`team_${i}`]="required";});
    const unique=new Set(teamNames.map(n=>n.trim().toLowerCase()).filter(Boolean));
    if(unique.size<teamNames.filter(n=>n.trim()).length)e.duplicate=`${mode==="players"?"Player":"Team"} names must be unique`;
    if(Object.keys(e).length){setErrors(e);return false;}return true;
  }
  function teamLabelAt(i) {
    return teamNames[i]?.trim() || `${Label} ${i + 1}`;
  }
  function setElimSlotSide(slotIndex, side, rawValue) {
    const value = rawValue === "" || rawValue == null ? null : Number(rawValue);
    setElimBracketSlots(prev => {
      const next = prev.map(s => ({ ...s }));
      next[slotIndex] = {
        ...next[slotIndex],
        [side]: Number.isNaN(value) ? null : value,
      };
      return next;
    });
    setErrors(p => {
      const e = { ...p };
      delete e.elimSlots;
      return e;
    });
  }
  function validateElimBracketSlots() {
    const e = {};
    const used = new Set();
    for (let i = 0; i < elimBracketSlots.length; i++) {
      const { teamA, teamB } = elimBracketSlots[i];
      if (teamA === null || teamA === undefined) {
        e.elimSlots = `Match ${i + 1} needs a ${label} on side A`;
        break;
      }
      if (used.has(teamA) || (teamB != null && used.has(teamB))) {
        e.elimSlots = `Each ${label} can only appear once in the bracket`;
        break;
      }
      if (teamB != null && teamA === teamB) {
        e.elimSlots = `Match ${i + 1} cannot use the same ${label} twice`;
        break;
      }
      used.add(teamA);
      if (teamB != null) used.add(teamB);
    }
    if (!e.elimSlots && used.size !== numTeams) {
      e.elimSlots = `Assign all ${numTeams} ${label}s across round 1 (use Bye where needed)`;
    }
    if (Object.keys(e).length) { setErrors(e); return false; }
    return true;
  }
  function validateAssignments() {
    const e = {};
    const unassigned = groupAssignments.filter(gi => gi === null || gi === undefined).length;
    if (unassigned > 0) e.assignments = `Assign every ${mode === "players" ? "player" : "team"} to a group`;
    const counts = Array.from({ length: numGroups }, () => 0);
    groupAssignments.forEach(gi => {
      if (typeof gi === "number" && gi >= 0 && gi < numGroups) counts[gi]++;
    });
    const tooSmall = counts.findIndex(c => c < 2);
    if (tooSmall >= 0 && !e.assignments) {
      e.assignments = `${resolvedGroupName(tooSmall)} needs at least 2 ${mode === "players" ? "players" : "teams"}`;
    }
    if (Object.keys(e).length) { setErrors(e); return false; }
    return true;
  }

  const label=mode==="players"?"player":"team";
  const Label=mode==="players"?"Player":"Team";
  const setupSteps = isManualAssign
    ? ["Configure", `${Label}s`, "Groups", "Review"]
    : isManualElimSeed
      ? ["Configure", `${Label}s`, "Seed", "Review"]
      : ["Configure", `${Label}s`, "Review"];

  const elimSlotsUsed = new Set();
  elimBracketSlots.forEach(s => {
    if (s.teamA != null) elimSlotsUsed.add(s.teamA);
    if (s.teamB != null) elimSlotsUsed.add(s.teamB);
  });
  function elimSlotOptions(currentIndex) {
    const remaining = [];
    for (let i = 0; i < numTeams; i++) {
      if (!elimSlotsUsed.has(i) || i === currentIndex) remaining.push(i);
    }
    return remaining;
  }

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
      groupNames: isSingleElim ? [] : groupNames,
      advancersPerGroup: isSingleElim ? 0 : clampAdvancers(numTeams, numGroups, advancersPerGroup),
      mode,
      style,
      assignmentMode: isSingleElim ? "random" : assignmentMode,
      groupAssignments: isManualAssign ? groupAssignments : null,
      elimSeeding: isSingleElim ? elimSeeding : "random",
      elimBracketSlots: isManualElimSeed ? elimBracketSlots : null,
    }));
  }

  const assignmentCounts = Array.from({ length: numGroups }, () => 0);
  groupAssignments.forEach(gi => {
    if (typeof gi === "number" && gi >= 0 && gi < numGroups) assignmentCounts[gi]++;
  });
  const unassignedCount = groupAssignments.filter(gi => gi === null || gi === undefined).length;

  return (
    <div className="mp-page">
      <div className="mp-steps">
        {setupSteps.map((lbl,i)=>(
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
            <div className="mp-card-title">Group Names</div>
            <div className="font-meta-sm t-muted mb-14">
              Optional — leave blank to use Group A, Group B, …
            </div>
            {Array.from({ length: numGroups }, (_, i) => (
              <div key={i} className="mp-team-input-wrap mb-10">
                <span className="mp-team-num">{i + 1}</span>
                <input
                  className={`mp-input${errors.groupNames ? " error" : ""}`}
                  value={groupNames[i] || ""}
                  onChange={e => updateGroupName(i, e.target.value)}
                  placeholder={groupLabel(i)}
                />
              </div>
            ))}
            {errors.groupNames && <div className="mp-error">⚠ {errors.groupNames}</div>}
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
          <div className="mp-card">
            <div className="mp-card-title">Group Assignment</div>
            <div className="mp-choice-row">
              {[
                { val: "random", title: "Random draw", sub: `Shuffle ${label}s into groups` },
                { val: "manual", title: "Manual groups", sub: `Place each ${label} yourself` },
              ].map(({ val, title, sub }) => (
                <button key={val} type="button" onClick={() => setAssignmentMode(val)} className={`mp-choice${assignmentMode === val ? " is-active" : ""}`}>
                  <div className="mp-choice-title">{title}</div>
                  <div className="mp-choice-sub">{sub}</div>
                </button>
              ))}
            </div>
          </div>
        </>}

        {isSingleElim && (
          <>
            <div className="mp-card">
              <div className="mp-card-title">Bracket Seeding</div>
              <div className="mp-choice-row">
                {[
                  { val: "random", title: "Random seed", sub: "Shuffle opening pairings on Start" },
                  { val: "manual", title: "Manual seed", sub: "Set round-1 matchups yourself" },
                ].map(({ val, title, sub }) => (
                  <button key={val} type="button" onClick={() => setElimSeeding(val)} className={`mp-choice${elimSeeding === val ? " is-active" : ""}`}>
                    <div className="mp-choice-title">{title}</div>
                    <div className="mp-choice-sub">{sub}</div>
                  </button>
                ))}
              </div>
            </div>
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
                  isManualElimSeed ? "You will set opening pairings on the next steps" : "Seed randomly shuffled on Start",
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
          </>
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
          <button className="mp-btn mp-btn-primary flex-2" onClick={()=>{
            if (!validateStep2()) return;
            if (isManualAssign) setStep(3);
            else if (isManualElimSeed) setStep(3);
            else setStep(reviewStep);
          }}>
            {isManualAssign
              ? `Assign Groups →`
              : isManualElimSeed
                ? "Seed Bracket →"
                : isSingleElim
                  ? "Review Bracket →"
                  : "Review Draw →"}
          </button>
        </div>
      </>}

      {step===assignStep&&isManualAssign&&<>
        <div className="mp-section-eyebrow">Groups</div>
        <div className="mp-section-title">Assign {label}s</div>
        <div className="mp-section-sub">
          Place each {label} into a group. Target sizes: {sizeSummary}.
        </div>
        {errors.assignments && <div className="mp-error mb-12">⚠ {errors.assignments}</div>}
        <div className="mp-card">
          <div className="mp-card-title">
            Unassigned {unassignedCount > 0 ? `(${unassignedCount})` : "· all placed"}
          </div>
          {unassignedCount === 0 ? (
            <div className="font-meta-sm t-muted">Every {label} is in a group.</div>
          ) : (
            <div className="mp-assign-list">
              {teamNames.map((name, i) => {
                if (groupAssignments[i] !== null && groupAssignments[i] !== undefined) return null;
                return (
                  <div key={i} className="mp-assign-row">
                    <div className="mp-assign-name">{name.trim() || `${Label} ${i + 1}`}</div>
                    <select
                      className="mp-select"
                      value=""
                      onChange={e => {
                        const gi = Number(e.target.value);
                        if (!Number.isNaN(gi)) assignTeamToGroup(i, gi);
                      }}
                    >
                      <option value="" disabled>Assign…</option>
                      {Array.from({ length: numGroups }, (_, gi) => (
                        <option key={gi} value={gi}>
                          {resolvedGroupName(gi)} ({assignmentCounts[gi]})
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {Array.from({ length: numGroups }, (_, gi) => (
          <div key={gi} className="mp-card">
            <div className="mp-group-preview-title">
              {resolvedGroupName(gi)}
              <span className="font-meta t-muted" style={{ marginLeft: 8 }}>{assignmentCounts[gi]} {label}{assignmentCounts[gi] === 1 ? "" : "s"}</span>
            </div>
            <div className="flex flex-wrap gap-6">
              {teamNames.map((name, i) => {
                if (groupAssignments[i] !== gi) return null;
                return (
                  <button
                    key={i}
                    type="button"
                    className="mp-chip mp-chip-removable"
                    onClick={() => clearTeamAssignment(i)}
                    title="Remove from group"
                  >
                    {name.trim() || `${Label} ${i + 1}`}
                    <span aria-hidden="true"> ×</span>
                  </button>
                );
              })}
              {assignmentCounts[gi] === 0 && (
                <div className="font-meta-sm t-faint">No {label}s yet</div>
              )}
            </div>
          </div>
        ))}
        <div className="mp-modal-actions">
          <button className="mp-btn mp-btn-ghost flex-1" onClick={() => setStep(2)}>← Back</button>
          <button className="mp-btn mp-btn-primary flex-2" onClick={() => { if (validateAssignments()) setStep(4); }}>
            Review Groups →
          </button>
        </div>
      </>}

      {step===elimSeedStep&&isManualElimSeed&&<>
        <div className="mp-section-eyebrow">Bracket</div>
        <div className="mp-section-title">Seed opening round</div>
        <div className="mp-section-sub">
          {elimBracketSize / 2} round-1 matches · {numTeams} {label}s
          {elimByes > 0 ? ` · ${elimByes} bye${elimByes === 1 ? "" : "s"}` : ""}
        </div>
        {errors.elimSlots && <div className="mp-error mb-12">⚠ {errors.elimSlots}</div>}
        {elimBracketSlots.map((slot, i) => (
          <div key={i} className="mp-card mp-bracket-slot">
            <div className="font-label t-faint mb-8">Match {i + 1}</div>
            <div className="mp-bracket-slot-row">
              <select
                className="mp-select flex-1"
                value={slot.teamA ?? ""}
                onChange={e => setElimSlotSide(i, "teamA", e.target.value)}
              >
                <option value="">Side A…</option>
                {elimSlotOptions(slot.teamA).map(ti => (
                  <option key={ti} value={ti}>{teamLabelAt(ti)}</option>
                ))}
              </select>
              <div className="font-meta t-muted">vs</div>
              <select
                className="mp-select flex-1"
                value={slot.teamB ?? ""}
                onChange={e => setElimSlotSide(i, "teamB", e.target.value)}
              >
                <option value="">Bye</option>
                {elimSlotOptions(slot.teamB).map(ti => (
                  <option key={ti} value={ti}>{teamLabelAt(ti)}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <div className="mp-modal-actions">
          <button className="mp-btn mp-btn-ghost flex-1" onClick={() => setStep(2)}>← Back</button>
          <button className="mp-btn mp-btn-primary flex-2" onClick={() => { if (validateElimBracketSlots()) setStep(4); }}>
            Review Bracket →
          </button>
        </div>
      </>}

      {step===reviewStep&&!isSingleElim&&(()=>{
        const previewGroups = Array.from({ length: numGroups }, (_, i) => ({
          id: `g${i}`,
          name: resolvedGroupName(i),
          members: isManualAssign
            ? teamNames
                .map((n, ti) => ({ id: `t${ti}`, name: n.trim(), gi: groupAssignments[ti] }))
                .filter(m => m.gi === i)
            : shuffle(teamNames.map((n, ti) => ({ id: `t${ti}`, name: n.trim() }))).filter((_, ti) => ti % numGroups === i),
        }));
        return <>
          <div className="mp-section-eyebrow">Review</div>
          <div className="mp-section-title">{isManualAssign ? "Group Assignments" : "Round 1 Draw"}</div>
          <div className="mp-section-sub">
            {isManualAssign
              ? `${Label}s placed manually. Tap Start to confirm.`
              : `${Label}s randomly assigned. Tap Start to confirm.`}
          </div>
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
                {g.members.length > 2 && !isManualAssign && (
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
          {!isManualAssign && <div className="mp-info-box">⚠ Draw is re-randomized on Start. This is a preview.</div>}
          <div className="mp-modal-actions">
            <button className="mp-btn mp-btn-ghost flex-1" onClick={()=>setStep(isManualAssign ? 3 : 2)}>← Back</button>
            <button className="mp-btn mp-btn-primary flex-2" onClick={startTournament}>Start Tournament →</button>
          </div>
        </>;
      })()}

      {step===reviewStep&&isSingleElim&&(()=>{
        const previewPairs = isManualElimSeed
          ? elimBracketSlots.map(s => ({
              a: s.teamA != null ? teamLabelAt(s.teamA) : "—",
              b: s.teamB != null ? teamLabelAt(s.teamB) : "Bye",
            }))
          : (() => {
              const previewNames = shuffle(teamNames.map(n => n.trim()));
              const slots = [...previewNames];
              while (slots.length < elimBracketSize) slots.push(null);
              return Array.from({ length: elimBracketSize / 2 }, (_, i) => ({
                a: slots[i * 2],
                b: slots[i * 2 + 1],
              }));
            })();
        return <>
          <div className="mp-section-eyebrow">Review</div>
          <div className="mp-section-title">Opening Round</div>
          <div className="mp-section-sub">
            {isManualElimSeed
              ? "Round-1 pairings below. Tap Start to confirm."
              : "Bracket is randomly seeded on Start. Sample pairings below."}
          </div>
          <div className="mp-card">
            <div className="mp-card-title">Round 1 {isManualElimSeed ? "pairings" : "preview"}</div>
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
          {!isManualElimSeed && <div className="mp-info-box">⚠ Seed is re-randomized on Start. This is a preview.</div>}
          <div className="mp-modal-actions">
            <button className="mp-btn mp-btn-ghost flex-1" onClick={()=>setStep(isManualElimSeed ? 3 : 2)}>← Back</button>
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

function KnockoutAdvancePanel({ tournament, onAuto, onManual, saving }) {
  const advancers = collectAdvancers(tournament.groups || []);
  return (
    <div className="mp-card mp-bracket-setup">
      <div className="mp-card-title">Start Knockout Stage</div>
      <div className="font-meta-sm t-muted mb-14">
        Pool play is complete. Choose how to seed the {advancers.length} advancers into the bracket.
      </div>
      <div className="mp-choice-row mb-16">
        <button
          type="button"
          className="mp-choice"
          disabled={saving}
          onClick={() => onAuto()}
        >
          <div className="mp-choice-title">Auto seed</div>
          <div className="mp-choice-sub">Build bracket from group finishers</div>
        </button>
        <button
          type="button"
          className="mp-choice"
          disabled={saving}
          onClick={() => onManual()}
        >
          <div className="mp-choice-title">Manual bracket</div>
          <div className="mp-choice-sub">Set round-1 pairings yourself</div>
        </button>
      </div>
      <div className="font-label-wide t-faint mb-8">Advancers</div>
      <div className="flex flex-wrap gap-6">
        {advancers.map(id => {
          const team = tournament.teams.find(t => t.id === id);
          return <div key={id} className="mp-chip">{team?.name || "—"}</div>;
        })}
      </div>
      {advancers.length === 0 && (
        <div className="font-meta-sm t-accent mt-8">No advancers recorded yet — check group results.</div>
      )}
    </div>
  );
}

function BracketSetupPanel({ tournament, onConfirm, onCancel }) {
  const advancers = collectAdvancers(tournament.groups || []);
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(advancers.length, 2))));
  const matchCount = bracketSize / 2;
  const byeCount = bracketSize - advancers.length;

  const [slots, setSlots] = useState(() =>
    Array.from({ length: matchCount }, () => ({ teamA: null, teamB: null }))
  );
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const assigned = new Set();
  slots.forEach(s => {
    if (s.teamA) assigned.add(s.teamA);
    if (s.teamB) assigned.add(s.teamB);
  });
  const remaining = advancers.filter(id => !assigned.has(id));

  function teamName(id) {
    return tournament.teams.find(t => t.id === id)?.name || "—";
  }

  function advancerLabel(id) {
    const team = tournament.teams.find(t => t.id === id);
    const group = (tournament.groups || []).find(g => (g.winnerIds || []).includes(id) || g.winnerId === id);
    const place = group?.winnerIds?.indexOf(id);
    const placeLabel = place === 0 || (place == null && group?.winnerId === id)
      ? "1st"
      : place === 1 ? "2nd"
        : place === 2 ? "3rd"
          : place != null ? `${place + 1}th` : "";
    return `${team?.name || "—"}${group ? ` · ${group.name}${placeLabel ? ` ${placeLabel}` : ""}` : ""}`;
  }

  function setSlotSide(slotIndex, side, value) {
    setSlots(prev => {
      const next = prev.map(s => ({ ...s }));
      next[slotIndex] = { ...next[slotIndex], [side]: value || null };
      return next;
    });
    setError(null);
  }

  function autoFill() {
    const auto = generateBracket(tournament.groups || []);
    const next = Array.from({ length: matchCount }, (_, i) => {
      const m = auto[i];
      return { teamA: m?.teamA || null, teamB: m?.teamB || null };
    });
    setSlots(next);
    setError(null);
  }

  async function handleConfirm() {
    const used = new Set();
    for (let i = 0; i < slots.length; i++) {
      const { teamA, teamB } = slots[i];
      if (!teamA) {
        setError(`Match ${i + 1} needs a player on side A`);
        return;
      }
      if (used.has(teamA) || (teamB && used.has(teamB))) {
        setError("Each advancer can only appear once");
        return;
      }
      used.add(teamA);
      if (teamB) used.add(teamB);
      if (teamA === teamB) {
        setError(`Match ${i + 1} cannot have the same player twice`);
        return;
      }
    }
    if (used.size !== advancers.length) {
      setError(`Assign all ${advancers.length} advancers before confirming`);
      return;
    }
    setSaving(true);
    const ok = await onConfirm(slots);
    setSaving(false);
    if (ok === false) setError("Couldn't save — refresh and try again.");
  }

  const optionList = (currentId) => {
    const opts = remaining.concat(currentId ? [currentId] : []);
    return opts;
  };

  return (
    <div className="mp-card mp-bracket-setup">
      <div className="mp-card-title">Set Knockout Bracket</div>
      <div className="font-meta-sm t-muted mb-14">
        {advancers.length} advancers · {matchCount} round-1 matches
        {byeCount > 0 ? ` · ${byeCount} bye${byeCount === 1 ? "" : "s"}` : ""}
      </div>
      {error && <div className="mp-error mb-12">⚠ {error}</div>}
      <div className="mb-14">
        <button type="button" className="mp-btn mp-btn-ghost" onClick={autoFill}>
          Prefill from standings
        </button>
      </div>
      {slots.map((slot, i) => (
        <div key={i} className="mp-bracket-slot">
          <div className="font-label t-faint mb-8">Match {i + 1}</div>
          <div className="mp-bracket-slot-row">
            <select
              className="mp-select flex-1"
              value={slot.teamA || ""}
              onChange={e => setSlotSide(i, "teamA", e.target.value)}
            >
              <option value="">Side A…</option>
              {optionList(slot.teamA).map(id => (
                <option key={id} value={id}>{advancerLabel(id)}</option>
              ))}
            </select>
            <div className="font-meta t-muted">vs</div>
            <select
              className="mp-select flex-1"
              value={slot.teamB || ""}
              onChange={e => setSlotSide(i, "teamB", e.target.value)}
            >
              <option value="">Bye</option>
              {optionList(slot.teamB).map(id => (
                <option key={id} value={id}>{advancerLabel(id)}</option>
              ))}
            </select>
          </div>
        </div>
      ))}
      {remaining.length > 0 && (
        <div className="mp-info-box mt-8 mb-14">
          Still to place: {remaining.map(id => teamName(id)).join(", ")}
        </div>
      )}
      <div className="mp-modal-actions">
        {onCancel && (
          <button type="button" className="mp-btn mp-btn-ghost flex-1" onClick={onCancel}>Cancel</button>
        )}
        <button
          type="button"
          className="mp-btn mp-btn-primary flex-2"
          disabled={saving}
          onClick={handleConfirm}
        >
          {saving ? "Saving…" : "Confirm Bracket →"}
        </button>
      </div>
    </div>
  );
}

function AdminTournamentDetail({ tournament, onSaveMatch, onUpdateTournament, onArchive, onBack }) {
  const [overrideMatch, setOverrideMatch] = useState(null);
  const [tab, setTab] = useState(
    tournament.phase === "bracket_setup" || tournament.phase === "pools_complete" ? "bracket" : "matches"
  );
  const [toast, setToast] = useState(null);
  const [advancingKnockout, setAdvancingKnockout] = useState(false);
  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2500);}

  const allMatches=[...tournament.matches,...(tournament.bracket || [])];
  const disputed=allMatches.filter(m=>m.status==="disputed");
  const awaitingValidation=allMatches.filter(m=>m.status==="pending_validation");
  const groups = tournament.groups || [];
  const hasPools = tournamentStyleOf(tournament) === "pool_bracket" && groups.length > 0;
  const bracket = tournament.bracket || [];
  const bracketRounds = [...new Set(bracket.map(m => m.bracketRound))].sort((a, b) => a - b);
  const hasBracketList = bracket.some(m => !m.isBye);
  const needsBracketSetup = tournament.phase === "bracket_setup";
  const awaitingKnockoutAdvance = canStartKnockout(tournament);

  function adminPhaseLabel() {
    if (awaitingKnockoutAdvance) return "start knockout";
    if (needsBracketSetup) return "set bracket";
    return tournament.phase;
  }

  const defaultExpanded = (() => {
    const ids = [];
    if (hasPools && (tournament.phase === "group" || tournament.phase === "bracket_setup" || tournament.phase === "pools_complete")) {
      const playing = groups.filter(g => g.status !== "done");
      (playing.length ? playing : groups.slice(0, 1)).forEach(g => ids.push(g.id));
    }
    if (hasBracketList && (!hasPools || (tournament.phase !== "group" && tournament.phase !== "bracket_setup" && tournament.phase !== "pools_complete"))) {
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

  async function handleConfirmBracket(slots) {
    if (!onUpdateTournament) return false;
    const ok = await onUpdateTournament(t => confirmBracketSetup(t, slots));
    if (ok === false) return false;
    showToast("Bracket confirmed ✓");
    setTab("bracket");
    return true;
  }

  async function handleStartKnockout(mode) {
    if (!onUpdateTournament) return;
    setAdvancingKnockout(true);
    const updater = mode === "manual" ? startKnockoutManual : startKnockoutAuto;
    const ok = await onUpdateTournament(t => updater(t));
    setAdvancingKnockout(false);
    if (ok === false) {
      showToast("Couldn't save — refresh and try again.");
      return;
    }
    showToast(mode === "manual" ? "Set round-1 pairings →" : "Knockout started ✓");
    setTab("bracket");
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
        <div className="font-label t-accent mb-4">{tournament.mode==="players"?"Singles":"Teams"} · {styleLabel(tournamentStyleOf(tournament))} · {adminPhaseLabel()}</div>
        <div className="mp-section-title mb-0">{tournament.name}</div>
      </div>
      <div className="mp-underline-tabs sticky">
        <div className="mp-underline-tabs">
          {[
            {id:"matches",label: disputed.length ? `Matches (${disputed.length})` : "Matches"},
            {id:"bracket",label: awaitingKnockoutAdvance ? "Start Knockout" : needsBracketSetup ? "Set Bracket" : "Bracket"},
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
          {awaitingKnockoutAdvance && (
            <div className="mp-admin-alert mb-16">
              <div className="mp-admin-alert-body">
                <div className="mp-admin-alert-title">Pool play complete</div>
                <div className="mp-admin-alert-line">Advance the tournament to knockout and choose auto or manual bracket seeding.</div>
              </div>
              <button type="button" className="mp-admin-alert-btn" onClick={() => setTab("bracket")}>
                Start Knockout
              </button>
            </div>
          )}
          {needsBracketSetup && (
            <div className="mp-admin-alert mb-16">
              <div className="mp-admin-alert-body">
                <div className="mp-admin-alert-title">Set round-1 pairings</div>
                <div className="mp-admin-alert-line">Pair the advancers to confirm the knockout bracket.</div>
              </div>
              <button type="button" className="mp-admin-alert-btn" onClick={() => setTab("bracket")}>
                Set Bracket
              </button>
            </div>
          )}
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
                {tournament.phase === "bracket" || tournament.phase === "complete" || tournament.phase === "bracket_setup" || tournament.phase === "pools_complete" ? "Pool Play · History" : "Pool Play"}
              </div>
              <div className="mp-section-title mb-14">Groups</div>
              {groups.map(g => <AdminGroupAccordion key={g.id} g={g} />)}
            </>
          )}

          {hasBracketList && (
            <>
              <div className={`mp-section-eyebrow${hasPools ? " mt-8" : ""}`}>Knockout Stage</div>
              <div className="mp-section-title mb-14">Rounds</div>
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
          <div className="mp-section-title mb-0">
            {awaitingKnockoutAdvance ? "Start Knockout" : needsBracketSetup ? "Set Bracket" : "Bracket"}
          </div>
          {awaitingKnockoutAdvance ? (
            <KnockoutAdvancePanel
              tournament={tournament}
              saving={advancingKnockout}
              onAuto={() => handleStartKnockout("auto")}
              onManual={() => handleStartKnockout("manual")}
            />
          ) : needsBracketSetup ? (
            <BracketSetupPanel tournament={tournament} onConfirm={handleConfirmBracket} />
          ) : (
            <BracketView
              tournament={tournament}
              mode="admin"
              compact
              onOpenMatch={(matchId) => {
                const m = [...tournament.matches, ...(tournament.bracket || [])].find(x => x.id === matchId);
                if (m && !m.isBye) setOverrideMatch(m);
              }}
            />
          )}
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
              ["Phase", adminPhaseLabel()],
              ["Field",tournament.numTeams],
              ...(tournamentStyleOf(tournament)==="pool_bracket"
                ? [
                    ["Groups",tournament.numGroups],
                    ["Advancers/Group",tournament.advancersPerGroup],
                    ["Group draw", tournament.assignmentMode === "manual" ? "Manual" : "Random"],
                  ]
                : []),
              ...(tournamentStyleOf(tournament)==="single_elim"
                ? [["Bracket seed", tournament.elimSeeding === "manual" ? "Manual" : "Random"]]
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
  onUpdateTournament,
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
        onUpdateTournament={onUpdateTournament
          ? (updater) => onUpdateTournament(selected.id, updater)
          : undefined}
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
                  <div className="font-label t-accent mb-4">{t.mode === "players" ? "Singles" : "Teams"} · {styleLabel(tournamentStyleOf(t))} · {t.phase === "pools_complete" ? "start knockout" : t.phase === "bracket_setup" ? "set bracket" : t.phase}</div>
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
