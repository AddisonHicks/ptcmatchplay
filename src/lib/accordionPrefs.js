import { useCallback, useEffect, useMemo, useState } from "react";

export function accordionStorageKey(scope, tournamentId) {
  return `mp_accordion_${scope}_${tournamentId}`;
}

function readSaved(key, validIdSet, fallback) {
  try {
    if (localStorage.getItem(key) == null) return fallback;
    const parsed = JSON.parse(localStorage.getItem(key));
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter(id => validIdSet.has(id));
  } catch {
    return fallback;
  }
}

/**
 * Remember which group/round accordions are open per tournament (localStorage).
 * @param {string} scope e.g. public-matches, public-standings, admin-matches
 */
export function usePersistedAccordion(scope, tournamentId, defaultExpanded, validIds) {
  const validSet = useMemo(() => new Set(validIds), [validIds]);
  const key = accordionStorageKey(scope, tournamentId);

  const [expandedIds, setExpandedIds] = useState(() =>
    readSaved(key, validSet, defaultExpanded)
  );

  useEffect(() => {
    const nextKey = accordionStorageKey(scope, tournamentId);
    setExpandedIds(readSaved(nextKey, new Set(validIds), defaultExpanded));
  }, [scope, tournamentId]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(expandedIds));
    } catch {
      /* ignore quota / private mode */
    }
  }, [key, expandedIds]);

  useEffect(() => {
    setExpandedIds(prev => {
      const next = prev.filter(id => validSet.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [validSet]);

  const toggle = useCallback((id) => {
    setExpandedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  return { expandedIds, toggle, setExpandedIds };
}
