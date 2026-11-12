import type { Role } from '../types';

// ─── Catalogue des permissions (Prompt 04) ───────────────────────────────────
// Le mode local reproduit le référentiel RBAC de la base pour garder la démo
// cohérente. En mode Supabase, `identity.permissions` vient de `my_context()`
// (RPC SECURITY DEFINER) : l'UI ne fait que refléter cette liste, elle ne
// protège aucune opération.

export const ALL_PERMISSIONS = [
  'washes.view', 'washes.create', 'washes.update_status', 'washes.assign', 'washes.quality',
  'customers.view', 'customers.manage', 'catalog.manage',
  'payments.create', 'payments.cancel',
  'cash.open', 'cash.close', 'cash.reopen',
  'expenses.create', 'expenses.cancel',
  'reports.view', 'commissions.view', 'commissions.validate',
  'employees.manage', 'employees.invite', 'employees.assign_stations', 'employees.disable',
  'users.reset_password',
  'inventory.view', 'inventory.receive', 'inventory.consume', 'inventory.adjust',
  'crm.view', 'crm.manage',
  'loyalty.view', 'loyalty.manage',
  'packages.view', 'packages.manage',
  'promotions.view', 'promotions.manage',
  'fleets.view', 'fleets.manage',
  'notifications.view', 'notifications.enqueue',
  'settings.manage', 'subscription.manage', 'audit.view', 'platform.view',
  'analytics.view', 'analytics.compare',
  'platform.plans.manage', 'platform.companies.manage', 'platform.quotas.manage',
] as const;

const CASHIER = [
  'washes.view', 'washes.create', 'washes.update_status',
  'customers.view', 'customers.manage', 'payments.create',
  'cash.open', 'cash.close', 'expenses.create',
  'crm.view', 'loyalty.view', 'packages.view', 'promotions.view',
  'fleets.view', 'notifications.view', 'analytics.view',
];
const WASHER = ['washes.view', 'washes.update_status', 'washes.quality'];
// Le gérant pilote l'exploitation mais n'administre pas l'abonnement : cette
// permission reste réservée au propriétaire (migration 016 + UI). Les trois
// permissions d'administration SaaS restent réservées au super admin serveur.
const PLATFORM_ADMIN_ONLY = [
  'platform.view', 'platform.plans.manage', 'platform.companies.manage',
  'platform.quotas.manage',
];
const MANAGER = ALL_PERMISSIONS.filter((key) =>
  key !== 'subscription.manage' && !PLATFORM_ADMIN_ONLY.includes(key)
);
const OWNER = ALL_PERMISSIONS.filter((key) => !PLATFORM_ADMIN_ONLY.includes(key));

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  proprietaire: [...OWNER],
  gerant: [...MANAGER],
  caissier: [...CASHIER],
  laveur: [...WASHER],
  super_admin: [...ALL_PERMISSIONS],
  support: [...ALL_PERMISSIONS], // alias historique de démonstration locale
};

export function permissionsForRole(role: Role | string): string[] {
  return ROLE_PERMISSIONS[role as Role] ?? [];
}

/** Permission minimale affichée/consultée par chaque route (confort UI). */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/app/tableau-de-bord': 'washes.view',
  '/app/mise-en-route': 'settings.manage',
  '/app/lavages': 'washes.view',
  '/app/prestations': 'catalog.manage',
  '/app/clients': 'customers.view',
  '/app/employes': 'employees.manage',
  '/app/caisse': 'cash.open',
  '/app/depenses': 'expenses.create',
  '/app/rapports': 'reports.view',
  '/app/commissions': 'commissions.view',
  '/app/stock': 'inventory.view',
  '/app/consommations': 'inventory.consume',
  '/app/fidelisation': 'crm.view',
  '/app/flottes': 'fleets.view',
  '/app/parametres': 'settings.manage',
  '/app/abonnement': 'subscription.manage',
  '/app/plateforme': 'platform.view',
  '/app/consolidation': 'analytics.view',
  '/app/qualite': 'reports.view',
};

/** Correspondance entre les anciens tableaux de rôles et la permission. */
export function permissionForRoles(roles: Role[]): string {
  if (roles.includes('super_admin') || roles.includes('support')) return 'platform.view';
  if (roles.length === 1 && roles[0] === 'proprietaire') return 'subscription.manage';
  if (roles.includes('caissier') && roles.includes('laveur')) return 'washes.view';
  if (roles.includes('proprietaire') && roles.includes('gerant')) return 'settings.manage';
  return 'washes.view';
}
