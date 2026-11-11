import React from 'react';
import {
  FiAlertCircle, FiCheck, FiCheckCircle, FiInfo, FiLock, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { Link } from 'react-router-dom';

// ─── Briques d'interface ─────────────────────────────────────────────────────
export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <span className="wg-gradient grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-lg shadow-sky-500/20">
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

export function Card({ children, className = '', padded = true, onClick }: { children: React.ReactNode; className?: string; padded?: boolean; onClick?: React.MouseEventHandler<HTMLDivElement> }) {
  return <div onClick={onClick} className={`wg-card ${padded ? 'p-5' : ''} ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="wg-muted mt-1 max-w-2xl text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-bold uppercase tracking-wide">{children}</h2>
      {hint && <p className="wg-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="wg-label">{children}</label>;
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string };
export function Input({ label, hint, className = '', ...props }: InputProps) {
  return (
    <div className={className}>
      {label && <Label>{label}</Label>}
      <input className="wg-input" {...props} />
      {hint && <p className="wg-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string };
export function Select({ label, hint, className = '', children, ...props }: SelectProps) {
  return (
    <div className={className}>
      {label && <Label>{label}</Label>}
      <select className="wg-input" {...props}>{children}</select>
      {hint && <p className="wg-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string };
export function Textarea({ label, className = '', ...props }: TextareaProps) {
  return (
    <div className={className}>
      {label && <Label>{label}</Label>}
      <textarea className="wg-input" rows={3} {...props} />
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'accent' }) {
  const cls = tone === 'success' ? 'wg-badge-success' : tone === 'warn' ? 'wg-badge-warn' : tone === 'danger' ? 'wg-badge-danger' : tone === 'accent' ? 'wg-badge-accent' : '';
  return <span className={`wg-badge ${cls}`}>{children}</span>;
}

export function StatCard({ label, value, hint, icon, accent }: { label: string; value: string; hint?: string; icon?: React.ReactNode; accent?: string }) {
  return (
    <Card className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="wg-muted text-xs font-semibold uppercase tracking-wide">{label}</p>
        <p className="mt-2 truncate text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
        {hint && <p className="wg-muted mt-1 truncate text-xs">{hint}</p>}
      </div>
      {icon && (
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${accent ?? 'bg-sky-500/10 text-sky-400'}`}>
          {icon}
        </span>
      )}
    </Card>
  );
}

export function Progress({ value, max = 100, tone = 'accent' }: { value: number; max?: number; tone?: 'accent' | 'success' | 'warn' }) {
  const pct = Math.min(100, Math.max(0, max ? (value / max) * 100 : 0));
  const color = tone === 'success' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-sky-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--wg-surface-2)' }}>
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center" style={{ borderColor: 'var(--wg-border)' }}>
      {icon && <div className="wg-muted mb-3 text-3xl opacity-60">{icon}</div>}
      <p className="text-sm font-bold">{title}</p>
      {description && <p className="wg-muted mt-1 max-w-md text-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`wg-card wg-fade-in w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
        style={{ background: 'var(--wg-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--wg-border)' }}>
          <h3 className="text-base font-bold">{title}</h3>
          <button className="wg-muted hover:text-sky-400" onClick={onClose} aria-label="Fermer"><FiX size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl p-1" style={{ background: 'var(--wg-surface-2)' }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${value === o.id ? 'wg-btn-primary' : 'wg-muted hover:text-sky-400'}`}
          style={value === o.id ? {} : { background: 'transparent' }}
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
          <p className="wg-muted mt-1 text-sm leading-relaxed">
            Tant que la station n’est pas activée, le serveur refuse les fiches, les encaissements, la caisse et les dépenses.
            Il n’ouvre pas l’exploitation avec des tarifs que vous n’avez pas choisis.
          </p>
          <p className="wg-muted mt-3 text-xs font-semibold uppercase tracking-wide">
            {steps.length > 0 ? `${steps.length} étape(s) obligatoire(s) constatée(s) manquante(s) :` : 'Toutes les étapes obligatoires sont constatées.'}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {steps.map((s) => <li key={s}><Badge tone="danger">{s}</Badge></li>)}
            {steps.length === 0 && <li><Badge tone="success">Prêt à activer la station</Badge></li>}
          </ul>
          <Link to="/app/mise-en-route" className="wg-btn wg-btn-primary mt-4">Ouvrir la mise en route</Link>
        </div>
      </div>
      {state.company?.suspended && <p className="mt-3 text-xs text-red-400">Cette entreprise est suspendue par le support WashGuard.</p>}
    </Card>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'success' | 'warn' | 'danger'; children: React.ReactNode }) {
  const map = {
    info: { icon: <FiInfo />, cls: 'wg-badge-accent' },
    success: { icon: <FiCheckCircle />, cls: 'wg-badge-success' },
    warn: { icon: <FiAlertCircle />, cls: 'wg-badge-warn' },
    danger: { icon: <FiAlertCircle />, cls: 'wg-badge-danger' },
  }[kind];
  return (
    <div className={`wg-badge ${map.cls} !rounded-xl !px-3 !py-2.5 !text-xs !font-medium !leading-relaxed`}>
      <span className="shrink-0 text-sm">{map.icon}</span>
      <span>{children}</span>
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
          className={`wg-card wg-fade-in pointer-events-auto flex items-start gap-3 p-3.5 text-sm ${t.kind === 'error' ? 'border-red-500/40' : t.kind === 'success' ? 'border-emerald-500/40' : ''}`}
        >
          <span className={`mt-0.5 ${t.kind === 'error' ? 'text-red-400' : t.kind === 'success' ? 'text-emerald-400' : 'text-sky-400'}`}>
            {t.kind === 'error' ? <FiAlertCircle /> : t.kind === 'success' ? <FiCheck /> : <FiInfo />}
          </span>
          <span className="flex-1 text-xs leading-relaxed">{t.message}</span>
          <button className="wg-muted" onClick={() => dismissToast(t.id)} aria-label="Fermer"><FiX size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function useSafeAction() {
  const { notify } = useStore();
  return (fn: () => void) => {
    try { fn(); } catch (e) {
      const err = e as Error & { missing?: string[] };
      notify('error', err.message + (err.missing?.length ? ` (${err.missing.join(', ')})` : ''));
    }
  };
}
