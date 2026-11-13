import type { Plan, PlanFeatures } from '../types';

const allAdvanced: PlanFeatures = { stock: true, loyalty: true, fleets: true, consolidation: true, audit: true };
const noAdvanced: PlanFeatures = { stock: false, loyalty: false, fleets: false, consolidation: false, audit: false };

// ─── Table `plans` / cache ───────────────────────────────────────────────────
// La vitrine lit ses tarifs dans la base pour ne jamais être désynchronisée
// de la facturation. Depuis le Prompt 03, `SupabaseDataAdapter` charge
// `SELECT … FROM plans WHERE active` + `plan_limits` et alimente le cache
// ci-dessous via `setPlansCache()`. `PLANS` reste le repli du mode
// `VITE_DATA_SOURCE=local`, partagé par la vitrine, la page Abonnement et
// l'Espace plateforme. Aucun prix de prestation n'est prédéfini ici : les
// tarifs de lavage sont toujours choisis par la station pendant la mise en route.

export const PLANS: Plan[] = [
  {
    id: 'essai',
    name: 'Essai',
    priceMonthly: 0,
    trial: true,
    limits: { stations: 1, employees: 3, washesPerMonth: 100 },
    entitlements: { ...allAdvanced },
    features: [
      '14 jours, tous les modules',
      '1 station, 3 comptes actifs (propriétaire inclus)',
      '100 lavages par mois',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    priceMonthly: 15000,
    trial: false,
    limits: { stations: 1, employees: 10, washesPerMonth: 1000 },
    entitlements: { ...noAdvanced },
    features: [
      'Gestion essentielle : lavages, clients, employés, caisse, dépenses, rapports et commissions',
      '1 station, 10 comptes actifs (propriétaire inclus)',
      '1 000 lavages par mois',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    priceMonthly: 35000,
    trial: false,
    limits: { stations: 5, employees: 50, washesPerMonth: 100000 },
    entitlements: { ...allAdvanced },
    features: [
      'Gestion essentielle et modules avancés',
      'Jusqu’à 5 stations, 50 comptes actifs (propriétaire inclus)',
      'Jusqu’à 100 000 lavages par mois',
    ],
  },
];

/** Copie défensive du repli local : jamais de mutation partagée. */
export function clonePlans(): Plan[] {
  return PLANS.map((plan) => ({
    ...plan,
    limits: { ...plan.limits },
    features: [...plan.features],
    entitlements: plan.entitlements ? { ...plan.entitlements } : undefined,
  }));
}

// ─── Cache des formules ──────────────────────────────────────────────────────
// `PLANS` est le repli du mode local (rollback immédiat). En mode Supabase,
// StoreProvider remplace ce cache par les lignes réellement lues dans `plans`
// et `plan_limits`. La vitrine, la page Abonnement et les actions du store
// consultent alors la même source que la facturation, sans appel réseau par page.
let plansCache: Plan[] = clonePlans();

export function getPlans(): Plan[] {
  return plansCache;
}

export function setPlansCache(plans: Plan[]): void {
  plansCache = plans.map((plan) => ({
    ...plan,
    limits: { ...plan.limits },
    features: [...plan.features],
    entitlements: plan.entitlements ? { ...plan.entitlements } : undefined,
  }));
}

export function resetPlansCache(): void {
  plansCache = clonePlans();
}

export function planById(id: string | null | undefined): Plan | undefined {
  return plansCache.find((p) => p.id === id);
}
