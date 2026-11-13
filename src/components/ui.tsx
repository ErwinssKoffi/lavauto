import React from 'react';
import {
  FiAlertCircle, FiCheck, FiCheckCircle, FiInfo, FiLock, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { Link } from 'react-router-dom';

// ─── Briques d'interface (DaisyUI, thèmes WashGuard) ────────────────────────
// Ces composants exposent la même API qu'avant la migration : les pages n'ont
// pas changé. Toute l'apparence vient des classes DaisyUI (btn, card, input,
// badge, alert, modal, tabs, table…) et des thèmes `washguard` /
// `washguard-dark` déclarés dans tailwind.config.js.

export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-600 via-sky-500 to-cyan-400 shadow-lg shadow-sky-500/20">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor" aria-hidden>
          <path d="M12 2.5c.4 0 .75.26.87.64l1.05 3.35a3 3 0 0 1 1.59.92l3.4-.85a.9.9 0 0 1 1.03 1.27l-1.6 3.12a3 3 0 0 1 0 1.9l1.6 3.12a.9.9 0 0 1-1.03 1.27l-3.4-.85a3 3 0 0 1-1.59.92l-1.05 3.35a.9.9 0 0 1-1.74 0l-1.05-3.35a3 3 0 0 1-1.59-.92l-3.4.85A.9.9 0 0 1 5.06 15.9l1.6-3.12a3 3 0 0 1 0-1.9l-1.6-3.12A.9.9 0 0 1 6.09 6.5l3.4.85a3 3 0 0 1 1.59-.92l1.05-3.35A.9.9 0 0 1 12 2.5Z" />
          <circle cx="12" cy="12" r="2.6" fill="#0284c7" />
        </svg>
      </span>
      {!compact && (
        <span className={`text-[17px] font-extrabold tracking-tight ${light ? 'text-white' : ''}`}>
          Wash<span className="text-sky-400">Guard</span>
        </span>
      )}
    </div>
  );
}

export function Card({ children, className = '', padded = true, onClick, id }: { children: React.ReactNode; className?: string; padded?: boolean; onClick?: React.MouseEventHandler<HTMLDivElement>; id?: string }) {
  // `border` sans couleur explicite : la bordure prend `borderColor.DEFAULT`
  // du thème Tailwind (base-300 du thème actif), ce qui reste sensible au
  // clair/sombre et laisse les surcharges `border-*-500/30` fonctionner.
  return <div id={id} onClick={onClick} className={`card bg-base-100 border shadow-xl ${padded ? 'p-5' : ''} ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-base-content/60">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-bold uppercase tracking-wide">{children}</h2>
      {hint && <p className="mt-1 text-xs text-base-content/60">{hint}</p>}
    </div>
  );
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label className="mb-1.5 block text-xs font-semibold text-base-content/60" htmlFor={htmlFor}>{children}</label>;
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string };
export function Input({ label, hint, id, className = '', ...props }: InputProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <div className={className}>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <input className="input input-bordered input-sm w-full" id={inputId} {...props}
        value={props.type === 'number' && typeof props.value === 'number' && Number.isNaN(props.value) ? '' : props.value} />
      {hint && <p className="mt-1 text-xs text-base-content/60">{hint}</p>}
    </div>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string };
export function Select({ label, hint, id, className = '', children, ...props }: SelectProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <div className={className}>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <select className="select select-bordered select-sm w-full" id={inputId} {...props}>{children}</select>
      {hint && <p className="mt-1 text-xs text-base-content/60">{hint}</p>}
    </div>
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string };
export function Textarea({ label, id, className = '', ...props }: TextareaProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <div className={className}>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <textarea className="textarea textarea-bordered textarea-sm w-full" id={inputId} rows={3} {...props} />
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'accent' }) {
  const cls = tone === 'success' ? 'badge-success' : tone === 'warn' ? 'badge-warning' : tone === 'danger' ? 'badge-error' : tone === 'accent' ? 'badge-primary' : '';
  return <span className={`badge badge-sm ${cls}`}>{children}</span>;
}

export function StatCard({ label, value, hint, icon, accent, sparkline }: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: string;
  sparkline?: React.ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col justify-between gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-base-content/60">{label}</p>
          <p className="mt-2 truncate text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
          {hint && <p className="mt-1 truncate text-xs text-base-content/60">{hint}</p>}
        </div>
        {icon && (
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${accent ?? 'bg-sky-500/10 text-sky-400'}`}>
            {icon}
          </span>
        )}
      </div>
      {sparkline && (
        <div className="border-t border-base-300 pt-2.5">
          {sparkline}
        </div>
      )}
    </Card>
  );
}

export function Progress({ value, max = 100, tone = 'accent' }: { value: number; max?: number; tone?: 'accent' | 'success' | 'warn' }) {
  const pct = Math.min(100, Math.max(0, max ? (value / max) * 100 : 0));
  const cls = tone === 'success' ? 'progress-success' : tone === 'warn' ? 'progress-warning' : 'progress-primary';
  return <progress className={`progress ${cls} w-full`} value={pct} max={100} aria-valuenow={Math.round(pct)} />;
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-base-300 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-3xl text-base-content/60 opacity-60">{icon}</div>}
      <p className="text-sm font-bold">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs leading-relaxed text-base-content/60">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const titleId = React.useId();
  // Échap ferme la modale (le <dialog> natif ne le fait qu'en showModal).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <dialog className="modal modal-open z-[80]" role="dialog" aria-labelledby={titleId}>
      <div className={`modal-box p-5 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="mb-4 flex items-center justify-between border-b border-base-300 pb-4">
          <h3 id={titleId} className="text-base font-bold">{title}</h3>
          <button type="button" className="btn btn-ghost btn-sm !px-2.5" onClick={onClose} aria-label="Fermer"><FiX size={18} /></button>
        </div>
        {children}
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div role="tablist" className="tabs tabs-boxed">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`tab ${value === o.id ? 'tab-active' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Aucune donnée d'exemple : ce panneau explique le blocage réel 409. */
export function LockedPanel() {
  const { state, missing } = useStore();
  const steps = missing;
  return (
    <Card className="border-amber-500/30">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-500"><FiLock size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">Exploitation fermée</h2>
            <Badge tone="warn">409 onboarding_incomplete</Badge>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-base-content/60">
            Tant que la station n’est pas activée, le serveur refuse les fiches, les encaissements, la caisse et les dépenses.
            Il n’ouvre pas l’exploitation avec des tarifs que vous n’avez pas choisis.
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-base-content/60">
            {steps.length > 0 ? `${steps.length} étape(s) obligatoire(s) constatée(s) manquante(s) :` : 'Toutes les étapes obligatoires sont constatées.'}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {steps.map((s) => <li key={s}><Badge tone="danger">{s}</Badge></li>)}
            {steps.length === 0 && <li><Badge tone="success">Prêt à activer la station</Badge></li>}
          </ul>
          <Link to="/app/mise-en-route" className="btn btn-sm btn-primary mt-4">Ouvrir la mise en route</Link>
        </div>
      </div>
      {state.company?.suspended && <p className="mt-3 text-xs text-red-400">Cette entreprise est suspendue par le support WashGuard.</p>}
    </Card>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'success' | 'warn' | 'danger'; children: React.ReactNode }) {
  const map = {
    info: { icon: <FiInfo />, cls: 'alert-info' },
    success: { icon: <FiCheckCircle />, cls: 'alert-success' },
    warn: { icon: <FiAlertCircle />, cls: 'alert-warning' },
    danger: { icon: <FiAlertCircle />, cls: 'alert-error' },
  }[kind];
  return (
    <div className={`alert ${map.cls}`}>
      <span className="shrink-0 text-lg">{map.icon}</span>
      <span className="text-xs leading-relaxed">{children}</span>
    </div>
  );
}

export function ToastHost() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`card pointer-events-auto flex-row animate-fade-in items-start gap-3 bg-base-100 p-3.5 text-sm shadow-xl ${t.kind === 'error' ? 'border-red-500/40' : t.kind === 'success' ? 'border-emerald-500/40' : 'border-base-300'}`}
        >
          <span className={`mt-0.5 ${t.kind === 'error' ? 'text-red-400' : t.kind === 'success' ? 'text-emerald-400' : 'text-sky-400'}`}>
            {t.kind === 'error' ? <FiAlertCircle /> : t.kind === 'success' ? <FiCheck /> : <FiInfo />}
          </span>
          <span className="flex-1 text-xs leading-relaxed">{t.message}</span>
          <button type="button" className="text-base-content/60" onClick={() => dismissToast(t.id)} aria-label="Fermer"><FiX size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function useSafeAction() {
  const { notify } = useStore();
  const report = (e: unknown) => {
    const err = e as Error & { missing?: string[] };
    notify('error', err.message + (err.missing?.length ? ` (${err.missing.join(', ')})` : ''));
  };
  // Prompt 04/05 : les actions Auth et les RPC sont asynchrones. La fonction
  // renvoie une Promise que les appelants peuvent attendre ; les erreurs
  // synchrones ET rejetées sont notifiées exactement de la même manière.
  return async (fn: () => void | Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) { report(e); }
  };
}
