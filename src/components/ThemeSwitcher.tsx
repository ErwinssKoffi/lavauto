import React, { useEffect, useRef, useState } from 'react';
import { FiCheck, FiDroplet } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { DAISY_THEMES, WASHGUARD_THEMES, themeLabel, type ThemeOption } from '../lib/themes';

/**
 * Sélecteur de thème DaisyUI.
 *
 * Les 35 thèmes intégrés (`themes: all` dans src/index.css) et les deux thèmes
 * WashGuard sont proposés. Chaque ligne porte son propre `data-theme` : elle
 * s'affiche donc avec les couleurs réelles du thème qu'elle propose, sans
 * aucune image ni duplication de palette.
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

export function ThemePicker() {
  const { themeName, setTheme } = useStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (name: string) => { setTheme(name); setOpen(false); };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-sm px-2.5!"
        aria-label="Choisir un thème"
        aria-expanded={open}
        title={`Thème : ${themeLabel(themeName)}`}
      >
        <FiDroplet size={16} />
      </button>

      {open && (
        <div className="card absolute right-0 top-12 z-50 w-72 max-w-[calc(100vw-2rem)] bg-base-100 p-2 shadow-xl">
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-extrabold uppercase tracking-[0.13em] text-base-content/60">Thème WashGuard</p>
          <div className="flex flex-col gap-1" role="group" aria-label="Thèmes WashGuard">
            {WASHGUARD_THEMES.map((option) => (
              <ThemeRow key={option.name} option={option} active={option.name === themeName} onSelect={select} />
            ))}
          </div>

          <div className="my-2 border-t border-base-300" />

          <p className="px-2 pb-1.5 text-[11px] font-extrabold uppercase tracking-[0.13em] text-base-content/60">Thèmes DaisyUI</p>
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1 [scrollbar-width:thin]" role="group" aria-label="Thèmes DaisyUI">
            {DAISY_THEMES.map((option) => (
              <ThemeRow key={option.name} option={option} active={option.name === themeName} onSelect={select} />
            ))}
          </div>

          <p className="mt-2 border-t border-base-300 px-2 pt-2 text-[10px] leading-relaxed text-base-content/60">
            Le choix est enregistré dans ce navigateur. La bascule rapide (soleil / lune) revient aux thèmes WashGuard.
          </p>
        </div>
      )}
    </div>
  );
}

export default ThemePicker;
