import { useMemo } from 'react';
import { useStore } from './store';
import type { Role } from '../types';
import { filterPlanPermissions } from './subscription';

// ─── Hook UI des permissions (Prompt 04) ─────────────────────────────────────
// Il ne protège RIEN : les permissions viennent de `my_context()` (serveur)
// ou du référentiel local de démonstration. Les routes et la navigation s'en
// servent uniquement pour afficher/masquer des écrans, la RLS et les RPC
// `SECURITY DEFINER` restant les seules barrières réelles.

export interface PermissionView {
  role: Role | null;
  permissions: string[];
  can(permission: string): boolean;
  canAll(permissions: string[]): boolean;
  canAny(permissions: string[]): boolean;
  isPlatformAdmin: boolean;
}

export function usePermissions(): PermissionView {
  const { identity, subscriptionAccess } = useStore();
  return useMemo<PermissionView>(() => {
    const permissions = filterPlanPermissions(identity?.permissions ?? [], subscriptionAccess, Boolean(identity?.isPlatformAdmin));
    return {
      role: identity?.role ?? null,
      permissions,
      can: (permission) => permissions.includes(permission),
      canAll: (keys) => keys.every((key) => permissions.includes(key)),
      canAny: (keys) => keys.some((key) => permissions.includes(key)),
      isPlatformAdmin: Boolean(identity?.isPlatformAdmin),
    };
  }, [identity, subscriptionAccess]);
}
