import { bracketRoundLabel, tournamentStyleOf } from "../lib/format.js";

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

/**
 * Visual knockout bracket.
 * @param {"public"|"admin"} mode — admin shows Edit affordances; public shows Enter on pending
 * @param {boolean} compact — skip outer page chrome when embedded in a parent page
 */
export default function BracketView({
  tournament,
  onOpenMatch,
  mode = "public",
  compact = false,
}) {
  function getTeam(id) {
    return id ? tournament.teams.find(t => t.id === id) : null;
  }
  const { bracket, groups, phase } = tournament;
  const isAdmin = mode === "admin";

  if ((phase !== "bracket" && phase !== "complete") || !bracket?.length) {
    if (tournamentStyleOf(tournament) === "single_elim") {
      return (
        <div className={compact ? "" : "mp-page"}>
          {!compact && (
            <>
              <div className="mp-section-eyebrow">Knockout</div>
              <div className="mp-section-title">Bracket</div>
            </>
          )}
          <div className="mp-card ta-center pad-xl">
            <div className="font-meta t-muted">Bracket will appear once the tournament starts.</div>
          </div>
        </div>
      );
    }
    const done = (groups || []).filter(g => g.status === "done").length;
    return (
      <div className={compact ? "" : "mp-page"}>
        {!compact && (
          <>
            <div className="mp-section-eyebrow">Knockout</div>
            <div className="mp-section-title">Bracket</div>
          </>
        )}
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
    const clickable = !match.isBye && typeof onOpenMatch === "function";
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
          const showAction =
            side === "A" &&
            !match.isBye &&
            (
              (isAdmin && match.status !== "disputed") ||
              (!isAdmin && !closed && team && match.status === "pending")
            );
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
              {showAction && (
                <span className="mp-viz-enter">{isAdmin ? "Edit" : "Enter"}</span>
              )}
              {match.status === "disputed" && side === "A" && (
                <span className="mp-viz-score is-danger">{isAdmin ? "Resolve" : "Dispute"}</span>
              )}
            </div>
          );
        })}
      </button>
    );
  }

  return (
    <div className={compact ? "" : "mp-page pb-100"}>
      {champion && (
        <div className="mp-champion">
          <div className="mp-champion-label">Champion</div>
          <div className="mp-champion-name mb">{champion.name}</div>
        </div>
      )}
      {!compact && (
        <>
          <div className="mp-section-eyebrow">Knockout Stage</div>
          <div className="mp-section-title">Bracket</div>
        </>
      )}
      <div className="font-meta-sm t-faint mb-14">
        {isAdmin
          ? "Tap a match to override the result · swipe sideways for the full tree"
          : "Swipe sideways to explore the full tree"}
      </div>

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
