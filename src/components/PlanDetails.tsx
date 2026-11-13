import React from 'react';
import { FEATURE_KEYS, FEATURE_LABELS, CORE_FEATURES } from '../lib/subscription';
import type { Plan } from '../types';

/** Libellés calculés à partir des droits techniques, pas des slogans commerciaux. */
export function PlanDetails({ plan, compact = false }: { plan: Plan; compact?: boolean }) {
  const included = FEATURE_KEYS.filter((key) => plan.entitlements?.[key]);
  const excluded = FEATURE_KEYS.filter((key) => !plan.entitlements?.[key]);
  return <div className={`space-y-2 leading-relaxed ${compact ? 'text-[11px]' : 'text-xs'}`}>
    <p><strong>Limites :</strong> {plan.limits.stations} station(s) · {plan.limits.employees} comptes actifs · {plan.limits.washesPerMonth.toLocaleString('fr-FR')} lavages/mois.</p>
    <p><strong>Gestion essentielle :</strong> {CORE_FEATURES}.</p>
    {included.length > 0 && <p><strong>Modules avancés inclus :</strong> {included.map((key) => FEATURE_LABELS[key]).join(' · ')}.</p>}
    {excluded.length > 0 && <p><strong>Non inclus :</strong> {excluded.map((key) => FEATURE_LABELS[key]).join(' · ')}.</p>}
  </div>;
}
