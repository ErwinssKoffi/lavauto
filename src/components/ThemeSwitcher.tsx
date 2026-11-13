import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiCheck, FiDroplet, FiSearch } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { DAISY_THEMES, WASHGUARD_THEMES, themeLabel, type ThemeOption } from '../lib/themes';

/**
 * Sélecteur de thème DaisyUI.
 *
 * Les 37 thèmes déclarés dans `@plugin "daisyui" { themes: … }` (35 intégrés +
 * les deux thèmes WashGuard) sont proposés. Chaque ligne porte son propre
 * `data-theme` : elle s'affiche donc avec les couleurs réelles du thème qu'elle
 * propose, sans aucune image ni duplication de palette.
 */
function ThemeRow({ option, active, onSelect }: { option: ThemeOption; active: boolean; onSelect: (name: string) => void }) {
  return (
    <button
      type="button"
      data-theme={option.name}
      onClick={() => onSelect(option.name)}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-lg bg-base-100 px-2 py-1.5 text-left text-xs text-base-content transition hover:bg-base-200 ${active ? 'ring-1 ring-primary' : ''}`}
    >
      <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
        <span className="h-3 w-3 rounded-full bg-primary" />
        <span className="h-3 w-3 rounded-full border border-base-300 bg-base-100" />
        <span className="h-3 w-3 rounded-full bg-base-content" />
      </span>
      <span className={`flex-1 truncate ${active ? 'font-semibold' : ''}`}>{option.label}</span>
      {active && <FiCheck size={14} className="shrink-0 text-primary" aria-hidden="true" />}
    </button>
  );
}

/** Comparaison insensible à la casse et aux accents (« Lofi » trouve « Lo-Fi »). */
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const matches = (option: ThemeOption, query: string) => {
  const needle = normalize(query.trim());
  if (!needle) return true;
  return normalize(option.label).includes(needle) || normalize(option.name).includes(needle);
};

export function ThemePicker() {
  const { themeName, setTheme } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const washguardOptions = useMemo(() => WASHGUARD_THEMES.filter((option) => matches(option, query)), [query]);
  const daisyOptions = useMemo(() => DAISY_THEMES.filter((option) => matches(option, query)), [query]);
  const total = washguardOptions.length + daisyOptions.length;

  useEffect(() => {
    if (!open) return;
    // Le thème actif peut être loin dans la liste : on l'amène à l'écran.
    // `scrollIntoView` n'existe pas dans tous les environnements (JSDOM).
    const active = panelRef.current?.querySelector('[aria-pressed="true"]');
    if (typeof active?.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (name: string) => {
    setTheme(name);
    setOpen(false);
    setQuery('');
  };

  const toggle = () => {
    setOpen((value) => {
      if (value) setQuery('');
      return !value;
    });
  };

  /** Flèches haut/bas : déplace le focus dans la liste, sans quitter le menu. */
  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button[data-theme]') ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown'
      ? (current + 1) % rows.length
      : (current <= 0 ? rows.length - 1 : current - 1);
    rows[next].focus();
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="btn btn-sm px-2.5!"
        aria-label="Choisir un thème"
        aria-expanded={open}
        title={`Thème : ${themeLabel(themeName)}`}
      >
        <FiDroplet size={16} />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choix du thème"
          onKeyDown={onPanelKeyDown}
          className="card absolute right-0 top-12 z-50 w-72 max-w-[calc(100vw-2rem)] bg-base-100 p-2 shadow-xl"
        >
          <label className="input input-sm mb-1 w-full">
            <FiSearch size={13} className="text-base-content/50" aria-hidden="true" />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un thème"
              aria-label="Rechercher un thème"
              className="grow"
            />
          </label>

          {total === 0 && (
            <p className="px-2 py-3 text-center text-xs text-base-content/60">Aucun thème ne correspond.</p>
          )}

          {washguardOptions.length > 0 && (
            <>
              <p className="px-2 pt-1.5 pb-1.5 text-[11px] font-extrabold uppercase tracking-[0.13em] text-base-content/60">Thème WashGuard</p>
              <div className="flex flex-col gap-1" role="group" aria-label="Thèmes WashGuard">
                {washguardOptions.map((option) => (
                  <ThemeRow key={option.name} option={option} active={option.name === themeName} onSelect={select} />
                ))}
              </div>
            </>
          )}

          {washguardOptions.length > 0 && daisyOptions.length > 0 && <div className="my-2 border-t border-base-300" />}

          {daisyOptions.length > 0 && (
            <>
              <p className="px-2 pb-1.5 text-[11px] font-extrabold uppercase tracking-[0.13em] text-base-content/60">Thèmes DaisyUI</p>
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1 [scrollbar-width:thin]" role="group" aria-label="Thèmes DaisyUI">
                {daisyOptions.map((option) => (
                  <ThemeRow key={option.name} option={option} active={option.name === themeName} onSelect={select} />
                ))}
              </div>
            </>
          )}

          <p className="mt-2 border-t border-base-300 px-2 pt-2 text-[10px] leading-relaxed text-base-content/60">
            Le choix est enregistré dans ce navigateur. La bascule rapide (soleil / lune) revient aux thèmes WashGuard.
          </p>
        </div>
      )}
    </div>
  );
}

export default ThemePicker;
