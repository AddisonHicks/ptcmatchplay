/** Discord webhook helpers for match-close notifications. */

import { bracketRoundLabel } from "./format.js";
import { computeGroupStats, sortByRecord, matchCloseStr } from "./engine.js";
import {
  DEFAULT_COLORS,
  peachToDiscordColor,
  resolveGroupName,
} from "./appSettings.js";

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//i;

export function isDiscordWebhookUrl(url) {
  return typeof url === "string" && DISCORD_WEBHOOK_RE.test(url.trim());
}

/** Prefer per-tournament override, then app-wide URL. */
export function resolveDiscordWebhook(tournament, db) {
  const fromTourn = tournament?.discordWebhookUrl?.trim();
  if (fromTourn) return fromTourn;
  const fromDb = db?.discordWebhookUrl?.trim();
  return fromDb || null;
}

function teamName(tournament, teamId) {
  return tournament?.teams?.find(t => t.id === teamId)?.name || "TBD";
}

function isPoolMatch(match) {
  return (
    !!match?.groupPhase ||
    (!!match?.groupId && !(match.bracketPhase || match.bracketRound))
  );
}

function isBracketMatch(match) {
  return !!(match?.bracketPhase || match?.bracketRound);
}

/** e.g. "Pool · Group A" or "Knockout · Semifinals" */
export function matchStageLabel(tournament, match) {
  if (!match) return null;

  if (isPoolMatch(match)) {
    const group = tournament?.groups?.find(g => g.id === match.groupId);
    const groupName = group?.name || "Group play";
    return `Pool · ${groupName}`;
  }

  if (isBracketMatch(match)) {
    const round = match.bracketRound;
    const roundMatches = (tournament?.bracket || []).filter(m => m.bracketRound === round);
    const roundName = bracketRoundLabel(roundMatches.length || 1);
    return `Knockout · ${roundName}`;
  }

  return null;
}

function resultSummary(tournament, match) {
  const a = teamName(tournament, match.teamA);
  const b = match.teamB ? teamName(tournament, match.teamB) : "Bye";
  if (match.result === "H") return { title: "Match Halved", detail: `${a} vs ${b}` };
  if (match.result === "A") return { title: `${a} wins`, detail: `vs ${b}` };
  if (match.result === "B") return { title: `${b} wins`, detail: `vs ${a}` };
  return { title: "Match closed", detail: `${a} vs ${b}` };
}

function winnerIdOf(match) {
  if (!match || match.result === "H") return null;
  if (match.result === "A") return match.teamA;
  if (match.result === "B") return match.teamB;
  return null;
}

/** Compact standings block for a pool group (post-save tournament). */
export function formatGroupStandings(tournament, groupId) {
  if (!tournament || !groupId) return null;
  const group = tournament.groups?.find(g => g.id === groupId);
  const teamIds = tournament.groupMap?.[groupId] || [];
  if (!teamIds.length) return null;

  const groupMatches = (tournament.matches || []).filter(
    m => m.groupId === groupId && !m.isBye
  );
  const stats = computeGroupStats(teamIds, groupMatches);
  const ordered = sortByRecord(teamIds, stats);
  const advanced = new Set(
    group?.winnerIds?.length
      ? group.winnerIds
      : group?.winnerId
        ? [group.winnerId]
        : []
  );

  const lines = ordered.map((id, i) => {
    const name = teamName(tournament, id);
    const s = stats[id] || { pts: 0, w: 0, l: 0, h: 0, margin: 0 };
    const mark = advanced.has(id) ? " ★" : "";
    return `${i + 1}. ${name}${mark} — ${s.pts} pts · ${s.w}-${s.l}-${s.h} · m${s.margin >= 0 ? "+" : ""}${s.margin}`;
  });

  if (group?.status === "done") {
    lines.push("", "★ Advanced");
  }

  const text = lines.join("\n");
  return text.length > 1000 ? `${text.slice(0, 997)}…` : text;
}

/**
 * Next step for the winner after a knockout match (post-save tournament,
 * so newly created next-round slots are visible).
 */
export function formatBracketNextUp(tournament, match) {
  if (!isBracketMatch(match)) return null;

  const winnerId = winnerIdOf(match);
  if (!winnerId) {
    return "Match halved — no one advances";
  }

  if (tournament?.championId === winnerId || tournament?.phase === "complete") {
    return `🏆 ${teamName(tournament, winnerId)} is the champion`;
  }

  const thisRound = match.bracketRound || 0;
  const thisRoundMatches = (tournament?.bracket || []).filter(m => m.bracketRound === thisRound);
  const nextRound = thisRound + 1;
  const nextMatches = (tournament?.bracket || []).filter(m => m.bracketRound === nextRound);
  const nextRoundName = bracketRoundLabel(nextMatches.length || Math.max(1, Math.ceil(thisRoundMatches.length / 2)));

  const nextMatch = nextMatches.find(m => m.teamA === winnerId || m.teamB === winnerId);
  if (nextMatch) {
    const oppId = nextMatch.teamA === winnerId ? nextMatch.teamB : nextMatch.teamA;
    if (!oppId) {
      return `Next: ${nextRoundName} · opponent TBD`;
    }
    return `Next: ${nextRoundName} vs ${teamName(tournament, oppId)}`;
  }

  // Next round not created yet — name the sibling match that feeds the same slot
  const sibling = thisRoundMatches.find(
    m => m.id !== match.id && Math.floor(m.slot / 2) === Math.floor((match.slot ?? 0) / 2)
  );
  if (sibling) {
    if (sibling.status === "closed" && !sibling.isBye) {
      const sibWinner = winnerIdOf(sibling);
      if (sibWinner) {
        return `Next: ${nextRoundName} vs ${teamName(tournament, sibWinner)}`;
      }
    }
    const a = teamName(tournament, sibling.teamA);
    const b = sibling.teamB ? teamName(tournament, sibling.teamB) : "Bye";
    return `Next: ${nextRoundName} · plays winner of ${a} / ${b}`;
  }

  return `Next: ${nextRoundName}`;
}

/** Public app URL for a tournament (hash deep link). */
export function tournamentPublicUrl(tournamentId) {
  if (!tournamentId || typeof window === "undefined") return null;
  const path = window.location.pathname || "/";
  const base = `${window.location.origin}${path === "/" ? "" : path.replace(/\/$/, "")}`;
  return `${base}/#/t/${encodeURIComponent(tournamentId)}`;
}

function seeTournamentComponents(tournamentId) {
  const url = tournamentPublicUrl(tournamentId);
  if (!url) return undefined;
  return [
    {
      type: 1,
      components: [
        {
          type: 5,
          label: "See Full Tournament",
          url,
        },
      ],
    },
  ];
}

export function buildDiscordMatchPayload({ tournament, match, accentColor }) {
  const { title, detail } = resultSummary(tournament, match);
  const score = match.closeStr || matchCloseStr(match) || "";
  const stage = matchStageLabel(tournament, match);
  const overridden = !!match.overriddenAt;

  const standings = isPoolMatch(match)
    ? formatGroupStandings(tournament, match.groupId)
    : null;
  const nextUp = isBracketMatch(match)
    ? formatBracketNextUp(tournament, match)
    : null;

  const lines = [
    `**${tournament?.name || "Match Play"}**`,
    ...(stage ? [stage] : []),
    `${title}${score ? ` · ${score}` : ""}`,
    detail,
  ];
  if (overridden) lines.push("_Admin override_");
  if (nextUp) lines.push(nextUp);

  const fields = [
    { name: "Tournament", value: tournament?.name || "—", inline: true },
    ...(stage ? [{ name: "Stage", value: stage, inline: true }] : []),
    { name: "Score", value: score || "—", inline: true },
    ...(overridden ? [{ name: "Note", value: "Admin override", inline: true }] : []),
    ...(standings ? [{ name: "Standings", value: standings, inline: false }] : []),
    ...(nextUp ? [{ name: "Next", value: nextUp, inline: false }] : []),
  ];

  const components = seeTournamentComponents(tournament?.id);
  const embedColor = peachToDiscordColor(accentColor || DEFAULT_COLORS.peach);

  return {
    content: lines.join("\n"),
    embeds: [
      {
        title,
        description: detail,
        color: embedColor,
        fields,
      },
    ],
    ...(components ? { components } : {}),
  };
}

export async function postDiscordWebhook(webhookUrl, body) {
  const url = webhookUrl?.trim();
  if (!url || !isDiscordWebhookUrl(url)) {
    throw new Error("Invalid Discord webhook URL");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed (${res.status})${text ? `: ${text}` : ""}`);
  }
  return true;
}

export async function postDiscordMatchResult({ webhookUrl, tournament, match, accentColor }) {
  const payload = buildDiscordMatchPayload({ tournament, match, accentColor });
  return postDiscordWebhook(webhookUrl, payload);
}

export async function postDiscordTestMessage(webhookUrl, { groupName } = {}) {
  const brand = resolveGroupName({ groupName });
  return postDiscordWebhook(webhookUrl, {
    content: `**${brand} Match Play** — Discord notifications are connected ✓`,
  });
}

