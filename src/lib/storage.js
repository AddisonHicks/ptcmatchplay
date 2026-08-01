import { supabase } from "./supabase.js";

export const DB_ID = "main";
export const ARCHIVE_ID = "archive";
export const SAVE_MAX_RETRIES = 5;

// main    → { tournaments: [active only] } + integer version for optimistic locking
// archive → { tournaments: [archived only] } (low contention; plain upsert)

function emptyDb() {
  return { tournaments: [] };
}

function activeOnly(state) {
  return {
    tournaments: (state?.tournaments ?? []).filter(t => t.status !== "archived"),
  };
}

export async function loadArchive() {
  try {
    const { data, error } = await supabase
      .from("tournaments")
      .select("state")
      .eq("id", ARCHIVE_ID)
      .maybeSingle();
    if (error) throw error;
    return {
      ok: true,
      state: data?.state ?? emptyDb(),
      exists: !!data,
    };
  } catch (e) {
    console.error("Load failed (archive)", e);
    return { ok: false, error: e, state: emptyDb(), exists: false };
  }
}

export async function saveArchive(db) {
  const { error } = await supabase
    .from("tournaments")
    .upsert(
      { id: ARCHIVE_ID, state: db, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) {
    console.error("Save failed (archive)", error);
    throw error;
  }
}

/**
 * Load the main row as stored (includes any archived-still-in-main leftovers).
 * Callers that need the public active list should use activeOnly / migrate first.
 */
export async function loadMain() {
  try {
    const { data, error } = await supabase
      .from("tournaments")
      .select("state, version")
      .eq("id", DB_ID)
      .maybeSingle();
    if (error) throw error;
    const state = data?.state ?? emptyDb();
    return {
      ok: true,
      state: { tournaments: state.tournaments ?? [] },
      version: data?.version ?? 0,
      exists: !!data,
    };
  } catch (e) {
    console.error("Load failed (main)", e);
    return { ok: false, error: e, state: emptyDb(), version: 0, exists: false };
  }
}

/** Conditional write: succeeds only if expectedVersion still matches. */
export async function saveMain(state, expectedVersion) {
  const nextVersion = expectedVersion + 1;
  const payload = {
    state,
    version: nextVersion,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("tournaments")
    .update(payload)
    .eq("id", DB_ID)
    .eq("version", expectedVersion)
    .select("version")
    .maybeSingle();

  if (error) {
    console.error("Save failed (main)", error);
    throw error;
  }
  if (data) return { ok: true, version: data.version };

  const { data: existing, error: existingErr } = await supabase
    .from("tournaments")
    .select("id, version")
    .eq("id", DB_ID)
    .maybeSingle();

  // Don't invent a new empty row if we can't even read whether one exists
  if (existingErr) {
    console.error("Save aborted — could not verify main row", existingErr);
    throw existingErr;
  }

  if (!existing) {
    const { error: insertErr } = await supabase
      .from("tournaments")
      .insert({ id: DB_ID, ...payload });
    if (!insertErr) return { ok: true, version: nextVersion };
    return { ok: false, conflict: true };
  }

  return { ok: false, conflict: true };
}

/**
 * Move any archived tournaments still sitting in main → archive row.
 * Always operates on the raw main payload (never a pre-filtered active list).
 */
export async function migrateArchivedFromMain(mainState, version) {
  const tournaments = mainState?.tournaments ?? [];
  const stuck = tournaments.filter(t => t.status === "archived");
  const active = tournaments.filter(t => t.status !== "archived");
  if (stuck.length === 0) {
    return { ok: true, state: { tournaments: active }, version };
  }

  const archiveLoad = await loadArchive();
  if (!archiveLoad.ok) {
    // Refuse to rewrite main if we can't safely merge into archive
    return {
      ok: false,
      error: archiveLoad.error,
      state: { tournaments: active },
      version,
    };
  }

  const existingIds = new Set((archiveLoad.state.tournaments ?? []).map(t => t.id));
  const merged = {
    tournaments: [
      ...(archiveLoad.state.tournaments ?? []),
      ...stuck.filter(t => !existingIds.has(t.id)),
    ],
  };
  await saveArchive(merged);
  const nextMain = { tournaments: active };

  const result = await saveMain(nextMain, version);
  if (result.ok) return { ok: true, state: nextMain, version: result.version };

  const fresh = await loadMain();
  if (!fresh.ok) {
    return { ok: false, error: fresh.error, state: nextMain, version };
  }
  return { ok: true, state: activeOnly(fresh.state), version: fresh.version };
}

export { activeOnly };
