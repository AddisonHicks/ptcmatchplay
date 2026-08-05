import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase.js";
import {
  DB_ID,
  SAVE_MAX_RETRIES,
  loadMain,
  saveMain,
  loadArchive,
  saveArchive,
  migrateArchivedFromMain,
  activeOnly,
} from "./lib/storage.js";
import { applyMatchToDb } from "./lib/engine.js";
import { resolveDiscordWebhook, postDiscordMatchResult } from "./lib/discord.js";
import {
  applyAppColors,
  normalizeAppSettings,
  resolveGroupName,
} from "./lib/appSettings.js";
import { BrandMark } from "./components/BrandMark.jsx";
import { AdminPasswordScreen } from "./components/AdminPasswordScreen.jsx";
import AdminHome from "./components/AdminHome.jsx";
import PublicHome from "./components/PublicHome.jsx";

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [db, setDb] = useState({ tournaments: [] });
  const [archived, setArchived] = useState([]);
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const versionRef = useRef(0);
  const dbRef = useRef({ tournaments: [] });
  const hydratedRef = useRef(false);

  function setMainState(state, version) {
    dbRef.current = state;
    setDb(state);
    if (typeof version === "number") versionRef.current = version;
  }

  // Simple hash-based routing: #/admin → admin view
  const [route, setRoute] = useState(window.location.hash === "#/admin" ? "admin" : "public");
  useEffect(() => {
    const handler = () => setRoute(window.location.hash === "#/admin" ? "admin" : "public");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // Live theme + document title from app settings
  useEffect(() => {
    applyAppColors(db.colors);
    document.title = `${resolveGroupName(db)} · Match Play`;
  }, [db]);

  useEffect(() => {
    (async () => {
      const loaded = await loadMain();
      if (!loaded.ok) {
        setLoadError("Could not load tournaments from the server. Check Supabase permissions and refresh.");
        hydratedRef.current = false;
        setLoading(false);
        return;
      }

      try {
        const migrated = await migrateArchivedFromMain(loaded.state, loaded.version);
        if (!migrated.ok) {
          setLoadError("Loaded tournaments, but could not finish archive migration. Writes are paused — refresh after fixing permissions.");
          setMainState(activeOnly(loaded.state), loaded.version);
          hydratedRef.current = false;
        } else {
          setMainState(migrated.state, migrated.version);
          hydratedRef.current = true;
          setLoadError(null);
        }
      } catch (e) {
        console.error("Archive migration failed", e);
        setMainState(activeOnly(loaded.state), loaded.version);
        hydratedRef.current = true;
        setLoadError(null);
      }
      setLoading(false);
    })();

    // Realtime — active row only; keep version in sync for optimistic locks
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
          if (incoming) {
            setMainState(
              activeOnly(incoming),
              typeof payload.new?.version === "number" ? payload.new.version : undefined
            );
            hydratedRef.current = true;
            setLoadError(null);
          } else if (typeof payload.new?.version === "number") {
            versionRef.current = payload.new.version;
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function ensureArchives() {
    if (archivesLoaded) return;
    const archiveLoad = await loadArchive();
    if (!archiveLoad.ok) {
      console.error("Archive load failed", archiveLoad.error);
      return;
    }
    const list = [...(archiveLoad.state.tournaments ?? [])].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    setArchived(list);
    setArchivesLoaded(true);
  }

  /** Persist a derived main state with version checks; mutator rebuilds from fresh data on conflict. */
  async function persistWithRetry(mutator) {
    if (!hydratedRef.current) {
      console.error("Persist blocked — app is not safely hydrated from the server");
      return false;
    }

    for (let attempt = 0; attempt < SAVE_MAX_RETRIES; attempt++) {
      let baseState;
      let baseVersion;
      if (attempt === 0) {
        baseState = dbRef.current;
        baseVersion = versionRef.current;
      } else {
        const fresh = await loadMain();
        if (!fresh.ok) {
          console.error("Persist aborted — could not reload main", fresh.error);
          return false;
        }
        baseState = activeOnly(fresh.state);
        baseVersion = fresh.version;
        setMainState(baseState, fresh.version);
      }

      const nextState = mutator(baseState);
      if (!nextState) return false;

      setMainState(nextState);
      try {
        const result = await saveMain(nextState, baseVersion);
        if (result.ok) {
          versionRef.current = result.version;
          return true;
        }
      } catch (e) {
        console.error("Persist failed", e);
        return false;
      }
    }
    const fresh = await loadMain();
    if (fresh.ok) setMainState(activeOnly(fresh.state), fresh.version);
    return false;
  }

  async function handleCreateTournament(t) {
    await persistWithRetry(base => {
      if (base.tournaments.some(x => x.id === t.id)) return base;
      return { ...base, tournaments: [...base.tournaments, t] };
    });
  }

  async function handleSaveMatch(tournId, matchId, updatedMatch, isGroupMatch) {
    const tournamentBefore = dbRef.current.tournaments.find(t => t.id === tournId);
    const prevMatch = tournamentBefore
      ? [...(tournamentBefore.matches || []), ...(tournamentBefore.bracket || [])].find(m => m.id === matchId)
      : null;
    const wasClosed = prevMatch?.status === "closed";

    const ok = await persistWithRetry(base =>
      applyMatchToDb(base, tournId, matchId, updatedMatch, isGroupMatch)
    );

    if (ok && updatedMatch.status === "closed" && !wasClosed) {
      const tournament = dbRef.current.tournaments.find(t => t.id === tournId) || tournamentBefore;
      const webhookUrl = resolveDiscordWebhook(tournament, dbRef.current);
      if (webhookUrl) {
        const accentColor = dbRef.current.colors?.peach;
        postDiscordMatchResult({
          webhookUrl,
          tournament,
          match: updatedMatch,
          accentColor,
        }).catch(err => {
          console.error("Discord notify failed", err);
        });
      }
    }

    return ok;
  }

  async function handleSaveDiscordWebhook(url) {
    const trimmed = (url || "").trim();
    return persistWithRetry(base => ({
      ...base,
      discordWebhookUrl: trimmed || null,
    }));
  }

  async function handleSaveAppSettings(partial) {
    return persistWithRetry(base => {
      const merged = normalizeAppSettings({
        ...base,
        ...partial,
        // Keep webhook unless the caller explicitly included it
        discordWebhookUrl:
          partial && Object.prototype.hasOwnProperty.call(partial, "discordWebhookUrl")
            ? partial.discordWebhookUrl
            : base.discordWebhookUrl,
      });
      return { ...base, ...merged };
    });
  }

  async function handleArchive(tournId) {
    if (!hydratedRef.current) {
      console.error("Archive blocked — app is not safely hydrated");
      return;
    }

    const tournament = dbRef.current.tournaments.find(t => t.id === tournId);
    if (!tournament) return;

    const archivedTourn = { ...tournament, status: "archived" };

    try {
      let archiveState;
      if (archivesLoaded) {
        archiveState = { tournaments: archived };
      } else {
        const archiveLoad = await loadArchive();
        if (!archiveLoad.ok) {
          console.error("Archive aborted — could not load existing archive", archiveLoad.error);
          return;
        }
        archiveState = archiveLoad.state;
      }
      const withoutDup = (archiveState.tournaments ?? []).filter(t => t.id !== tournId);
      const nextArchive = { tournaments: [archivedTourn, ...withoutDup] };
      await saveArchive(nextArchive);
      setArchived([...nextArchive.tournaments].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      ));
      setArchivesLoaded(true);
    } catch (e) {
      console.error("Archive failed", e);
      return;
    }

    await persistWithRetry(base => ({
      ...base,
      tournaments: base.tournaments.filter(t => t.id !== tournId),
    }));
  }

  if (loading) return (
    <><div className="mp-loading">
      <div className="mp-loading-text">LOADING...</div>
    </div></>
  );

  if (loadError) {
    return (
      <><div className="mp-root">
        <div className="mp-page" style={{ paddingTop: 48 }}>
          <div className="mp-section-title">Can't reach data</div>
          <div className="mp-section-sub">{loadError}</div>
          <button className="mp-btn mp-btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div></>
    );
  }

  const brandProps = {
    groupName: db.groupName,
    groupLogoUrl: db.groupLogoUrl,
  };

  // ── ADMIN ROUTE ──
  if (route === "admin") {
    if (!adminAuthed) {
      return (
        <><div className="mp-root">
          <AdminPasswordScreen
            onUnlock={() => setAdminAuthed(true)}
            {...brandProps}
          />
        </div></>
      );
    }
    return (
      <><div className="mp-root">
        <div className="mp-topbar">
          <BrandMark {...brandProps} />
          <div className="mp-topbar-right">
            <span className="mp-topbar-badge">Admin</span>
            <button onClick={() => { window.location.hash = ""; setAdminAuthed(false); }} className="mp-exit-btn">Exit</button>
          </div>
        </div>
        <AdminHome
          db={db}
          archived={archived}
          onEnsureArchives={ensureArchives}
          onCreateTournament={handleCreateTournament}
          onSaveMatch={handleSaveMatch}
          onArchive={handleArchive}
          onSaveDiscordWebhook={handleSaveDiscordWebhook}
          onSaveAppSettings={handleSaveAppSettings}
        />
      </div></>
    );
  }

  // ── PUBLIC ROUTE ──
  async function publicSaveMatch(matchId, updatedMatch, isGroupMatch) {
    const tournament = dbRef.current.tournaments.find(t => [...t.matches, ...t.bracket].some(m => m.id === matchId));
    if (!tournament) return false;
    return handleSaveMatch(tournament.id, matchId, updatedMatch, isGroupMatch);
  }

  return (
    <><div className="mp-root">
      <PublicHome
        db={db}
        archived={archived}
        onEnsureArchives={ensureArchives}
        onSaveMatch={publicSaveMatch}
      />
    </div></>
  );
}
