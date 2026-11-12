import { useEffect, useMemo, useRef, useState } from 'react';
import { FiCornerDownLeft, FiSearch, FiX } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { groupsForRole, normalizeNavText, type NavEntry } from './navigation';
import type { Role } from '../types';

interface Result { entry: NavEntry; group: string }

/** Recherche globale réelle (Ctrl/Cmd + K) : ne liste QUE des écrans
 *  existants et autorisés pour le rôle, et navigue effectivement.       */
export function CommandPalette({
  open,
  onClose,
  role,
  permissions,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  permissions: string[];
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<Result[]>(() => groupsForRole(role, permissions).flatMap((group) =>
    group.entries
      .filter((entry) => Boolean(entry.to) && !entry.upcoming)
      .map((entry) => ({ entry, group: group.label }))
  ), [role, permissions]);

  const results = useMemo(() => {
    const q = normalizeNavText(query.trim());
    if (!q) return entries;
    return entries.filter(({ entry, group }) =>
      normalizeNavText([entry.label, group, ...(entry.keywords ?? [])].join(' ')).includes(q)
    );
  }, [entries, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
      } else if (event.key === 'Enter') {
        const target = results[active];
        if (target?.entry.to) {
          event.preventDefault();
          navigate(target.entry.to);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, results, active, onClose, navigate]);

  if (!open) return null;

  return (
    <div
      className="wg-overlay fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recherche rapide"
        className="wg-card wg-elev-2 wg-fade-in w-full max-w-xl overflow-hidden"
        style={{ background: 'var(--wg-surface)' }}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--wg-border)' }}>
          <FiSearch className="wg-muted shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--wg-text)' }}
            aria-label="Rechercher un écran"
            placeholder="Rechercher un écran, un module…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="wg-muted" onClick={onClose} aria-label="Fermer la recherche"><FiX size={18} /></button>
        </div>
        <div role="listbox" aria-label="Écrans disponibles" className="wg-scroll-thin max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="wg-muted px-3 py-6 text-center text-xs">Aucun écran autorisé ne correspond à « {query} ».</p>
          ) : results.map(({ entry, group }, index) => (
            <button
              key={entry.to}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => { if (entry.to) { navigate(entry.to); onClose(); } }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${index === active ? 'wg-nav-item-active' : 'wg-nav-item'}`}
            >
              <span className="text-base">{entry.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{entry.label}</span>
                <span className="wg-muted block truncate text-[11px]">{group}</span>
              </span>
              {index === active && <FiCornerDownLeft className="wg-muted shrink-0" size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-[11px]" style={{ borderColor: 'var(--wg-border)' }}>
          <span className="wg-muted">{results.length} écran(s) · ↑ ↓ pour parcourir · Entrée pour ouvrir</span>
          <span className="wg-kbd">Échap</span>
        </div>
      </div>
    </div>
  );
}
