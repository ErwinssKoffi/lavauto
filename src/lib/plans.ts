import type { Plan } from '../types';

// ─── Table `plans` ────────────────────────────────────────────────────────────
// La vitrine lit ses tarifs dans la base pour ne jamais être désynchronisée
// de la facturation. En attendant le branchement Supabase, cette constante
// joue le rôle de la table `plans` (une seule source de vérité, partagée par
// la vitrine, la page Abonnement et l'Espace plateforme).
//
// À terme : SELECT * FROM plans WHERE active = true (voir lib/supabase.ts).
// Aucun prix de prestation n'est prédéfini ici : les tarifs de lavage sont
// toujours choisis par la station pendant la mise en route.

export const PLANS: Plan[] = [
  {
    id: 'essai',
    name: 'Essai',
    priceMonthly: 0,
    trial: true,
    limits: { stations: 1, employees: 3, washesPerMonth: 100 },
    features: [
      '14 jours pour ouvrir votre station',
      '1 station, 3 comptes employés',
      '100 lavages pour démarrer',
      'Tous les modules de gestion',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    priceMonthly: 15000,
    trial: false,
    limits: { stations: 1, employees: 10, washesPerMonth: 1000 },
    features: [
      'Tout ce que contient l’essai',
      '1 station, 10 comptes employés',
      '1 000 lavages par mois',
      'Rapports et exports CSV',
      'Commissions et objectif du mois',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    priceMonthly: 35000,
    trial: false,
    limits: { stations: 5, employees: 50, washesPerMonth: 100000 },
    features: [
      'Tout ce que contient Standard',
      'Jusqu’à 5 stations',
      '50 comptes employés',
      'Lavages illimités',
      'Journal des opérations sensibles',
      'Support prioritaire',
    ],
  },
];

export function planById(id: string | null | undefined): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
