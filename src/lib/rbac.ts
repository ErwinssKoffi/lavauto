import type { Role } from '../types';

export type Permission =
  | 'dashboard:view'
  | 'onboarding:manage'
  | 'washes:view'
  | 'washes:create'
  | 'washes:update'
  | 'washes:delete'
  | 'services:manage'
  | 'clients:view'
  | 'clients:manage'
  | 'employees:view'
  | 'employees:manage'
  | 'commissions:view'
  | 'commissions:payout'
  | 'cash:view'
  | 'cash:open_close'
  | 'expenses:view'
  | 'expenses:create'
  | 'expenses:cancel'
  | 'reports:view'
  | 'settings:view'
  | 'settings:manage'
  | 'stations:switch'
  | 'stations:create'
  | 'subscription:manage'
  | 'platform:manage';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  proprietaire: [
    'dashboard:view',
    'onboarding:manage',
    'washes:view',
    'washes:create',
    'washes:update',
    'washes:delete',
    'services:manage',
    'clients:view',
    'clients:manage',
    'employees:view',
    'employees:manage',
    'commissions:view',
    'commissions:payout',
    'cash:view',
    'cash:open_close',
    'expenses:view',
    'expenses:create',
    'expenses:cancel',
    'reports:view',
    'settings:view',
    'settings:manage',
    'stations:switch',
    'stations:create',
    'subscription:manage',
  ],
  gerant: [
    'dashboard:view',
    'onboarding:manage',
    'washes:view',
    'washes:create',
    'washes:update',
    'services:manage',
    'clients:view',
    'clients:manage',
    'employees:view',
    'employees:manage',
    'commissions:view',
    'commissions:payout',
    'cash:view',
    'cash:open_close',
    'expenses:view',
    'expenses:create',
    'expenses:cancel',
    'reports:view',
    'settings:view',
    'settings:manage',
    'stations:switch',
    'stations:create',
  ],
  caissier: [
    'dashboard:view',
    'washes:view',
    'washes:create',
    'washes:update',
    'clients:view',
    'clients:manage',
    'cash:view',
    'cash:open_close',
    'expenses:view',
    'expenses:create',
    'stations:switch',
  ],
  laveur: [
    'washes:view',
    'washes:update',
  ],
  support: [
    'platform:manage',
  ],
};

export function hasPermission(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAccessPath(role: Role | undefined, path: string): boolean {
  if (!role) return false;
  if (role === 'support') {
    return path.startsWith('/app/plateforme');
  }

  const p = path.toLowerCase();

  if (p.includes('/app/plateforme')) return false;
  if (p.includes('/app/abonnement')) return role === 'proprietaire';
  if (p.includes('/app/parametres')) return role === 'proprietaire' || role === 'gerant';
  if (p.includes('/app/rapports')) return role === 'proprietaire' || role === 'gerant';
  if (p.includes('/app/commissions')) return role === 'proprietaire' || role === 'gerant';
  if (p.includes('/app/employes')) return role === 'proprietaire' || role === 'gerant';
  if (p.includes('/app/prestations')) return role === 'proprietaire' || role === 'gerant';
  if (p.includes('/app/mise-en-route')) return role === 'proprietaire' || role === 'gerant';

  if (p.includes('/app/caisse')) return role === 'proprietaire' || role === 'gerant' || role === 'caissier';
  if (p.includes('/app/depenses')) return role === 'proprietaire' || role === 'gerant' || role === 'caissier';
  if (p.includes('/app/clients')) return role === 'proprietaire' || role === 'gerant' || role === 'caissier';
  if (p.includes('/app/tableau-de-bord')) return role === 'proprietaire' || role === 'gerant' || role === 'caissier';

  if (p.includes('/app/lavages')) return role === 'proprietaire' || role === 'gerant' || role === 'caissier' || role === 'laveur';

  return true;
}

export function getDefaultRedirectForRole(role: Role): string {
  switch (role) {
    case 'support':
      return '/app/plateforme';
    case 'laveur':
      return '/app/lavages';
    case 'caissier':
    case 'gerant':
    case 'proprietaire':
    default:
      return '/app/tableau-de-bord';
  }
}
