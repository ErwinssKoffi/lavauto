import type { ReactNode } from 'react';
import {
  FiActivity, FiBarChart2, FiBox, FiBriefcase, FiCompass, FiCreditCard, FiDollarSign,
  FiFileText, FiGrid, FiLayers, FiList, FiPackage, FiPieChart, FiSettings,
  FiShield, FiTool, FiTrendingUp, FiTruck, FiUserCheck, FiUsers,
} from 'react-icons/fi';
import type { Role } from '../types';
import { permissionsForRole, ROUTE_PERMISSIONS } from '../lib/permissionCatalog';

/** Une entrée « à venir » n'est PAS un lien : elle est rendue désactivée.
 *  Elle documente la feuille de route sans créer de page morte.            */
export interface NavUpcoming {
  step: string;
  hint: string;
}

export interface NavEntry {
  label: string;
  icon: ReactNode;
  roles: Role[];
  /** Permission serveur reflétée par l'UI ; aucune sécurité locale. */
  permission: string;
  to?: string;
  keywords?: string[];
  upcoming?: NavUpcoming;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: ReactNode;
  entries: NavEntry[];
}

const STAFF: Role[] = ['proprietaire', 'gerant', 'caissier', 'laveur'];
const MANAGERS: Role[] = ['proprietaire', 'gerant'];
const OWNER: Role[] = ['proprietaire'];
const SUPPORT: Role[] = ['super_admin'];

/** Les 8 sections ERP. Les 19 écrans gardent leurs URL ; P08 active les deux
 *  liens CRM, P09 la consolidation et P10 la qualité, sans page morte.    */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'pilotage', label: 'Pilotage', icon: <FiCompass />, entries: [
      { to: '/app/tableau-de-bord', label: 'Tableau de bord', icon: <FiGrid />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/tableau-de-bord'], keywords: ['accueil', 'indicateurs', 'dashboard', 'chiffre'] },
      { to: '/app/mise-en-route', label: 'Mise en route', icon: <FiList />, roles: MANAGERS, permission: ROUTE_PERMISSIONS['/app/mise-en-route'], keywords: ['activation', 'onboarding', '409', 'tarifs'] },
    ],
  },
  {
    id: 'exploitation', label: 'Exploitation', icon: <FiTruck />, entries: [
      { to: '/app/lavages', label: 'Lavages', icon: <FiTruck />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/lavages'], keywords: ['fiche', 'véhicule', 'file', 'statut', 'prestation'] },
      { label: 'Postes & affectations', icon: <FiTool />, roles: STAFF, permission: 'washes.assign', upcoming: { step: '05', hint: 'File d’attente et suivi des postes de lavage' } },
    ],
  },
  {
    id: 'commercial', label: 'Commercial', icon: <FiBriefcase />, entries: [
      { to: '/app/clients', label: 'Clients', icon: <FiUsers />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/clients'], keywords: ['fiche', 'plaque', 'contact', 'téléphone'] },
      { to: '/app/prestations', label: 'Prestations', icon: <FiBox />, roles: MANAGERS, permission: ROUTE_PERMISSIONS['/app/prestations'], keywords: ['tarifs', 'services', 'catégories', 'grille'] },
      { to: '/app/fidelisation', label: 'Fidélisation & forfaits', icon: <FiUserCheck />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/fidelisation'], keywords: ['CRM', 'points', 'carte', 'forfait', 'promotion', 'notification'] },
      { to: '/app/flottes', label: 'Flottes & contrats', icon: <FiBriefcase />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/flottes'], keywords: ['contrat', 'créance', 'crédit', 'véhicule', 'flotte'] },
    ],
  },
  {
    id: 'rh', label: 'RH', icon: <FiUsers />, entries: [
      { to: '/app/employes', label: 'Employés', icon: <FiUsers />, roles: MANAGERS, permission: ROUTE_PERMISSIONS['/app/employes'], keywords: ['équipe', 'rôles', 'mot de passe', 'compte'] },
      { to: '/app/commissions', label: 'Commissions', icon: <FiPieChart />, roles: MANAGERS, permission: ROUTE_PERMISSIONS['/app/commissions'], keywords: ['paie', 'barème', 'laveur'] },
    ],
  },
  {
    id: 'finance', label: 'Finance', icon: <FiDollarSign />, entries: [
      { to: '/app/caisse', label: 'Caisse', icon: <FiDollarSign />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/caisse'], keywords: ['fond', 'clôture', 'espèces', 'session'] },
      { to: '/app/depenses', label: 'Dépenses', icon: <FiCreditCard />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/depenses'], keywords: ['charges', 'fournisseur', 'annulation'] },
    ],
  },
  {
    id: 'stock', label: 'Stock', icon: <FiPackage />, entries: [
      { to: '/app/stock', label: 'Stocks & achats', icon: <FiPackage />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/stock'], keywords: ['produits', 'fournisseurs', 'réceptions', 'inventaires', 'commandes'] },
      { to: '/app/consommations', label: 'Consommations', icon: <FiLayers />, roles: STAFF, permission: ROUTE_PERMISSIONS['/app/consommations'], keywords: ['normes', 'coût moyen', 'lavages', 'valorisation'] },
    ],
  },
  {
    id: 'analyse', label: 'Analyse', icon: <FiBarChart2 />, entries: [
      { to: '/app/rapports', label: 'Rapports', icon: <FiBarChart2 />, roles: MANAGERS, permission: ROUTE_PERMISSIONS['/app/rapports'], keywords: ['csv', 'export', 'période', 'chiffre'] },
      { to: '/app/consolidation', label: 'Consolidation multi-stations', icon: <FiTrendingUp />, roles: MANAGERS, permission: ROUTE_PERMISSIONS['/app/consolidation'], keywords: ['Recharts', 'comparaison', 'classement', 'graphiques', 'stations'] },
      { to: '/app/qualite', label: 'Qualité & déploiement', icon: <FiActivity />, roles: MANAGERS, permission: ROUTE_PERMISSIONS['/app/qualite'], keywords: ['QA', 'tests', 'Playwright', 'Storage', 'CI', 'déploiement', 'performance'] },
    ],
  },
  {
    id: 'administration', label: 'Administration', icon: <FiSettings />, entries: [
      { to: '/app/parametres', label: 'Paramètres', icon: <FiSettings />, roles: MANAGERS, permission: ROUTE_PERMISSIONS['/app/parametres'], keywords: ['horaires', 'devise', 'règles', 'station'] },
      { to: '/app/abonnement', label: 'Abonnement', icon: <FiFileText />, roles: OWNER, permission: ROUTE_PERMISSIONS['/app/abonnement'], keywords: ['formule', 'essai', 'facturation', 'quota'] },
      { to: '/app/plateforme', label: 'Espace plateforme', icon: <FiShield />, roles: SUPPORT, permission: ROUTE_PERMISSIONS['/app/plateforme'], keywords: ['support', 'entreprises', 'saas'] },
    ],
  },
];

/** URL réelles de l'application (les entrées « à venir » n'en ont pas). */
export const NAV_PATHS: string[] = NAV_GROUPS.flatMap(
  (group) => group.entries.filter((entry) => Boolean(entry.to)).map((entry) => entry.to as string)
);

export function groupsForRole(role: Role, permissions?: string[]): NavGroup[] {
  const granted = permissions ?? permissionsForRole(role);
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) =>
        entry.roles.includes(role) && granted.includes(entry.permission)
      ),
    }))
    .filter((group) => group.entries.length > 0);
}

export function findEntry(pathname: string): { group: NavGroup; entry: NavEntry } | undefined {
  for (const group of NAV_GROUPS) {
    const entry = group.entries.find((item) => item.to === pathname);
    if (entry) return { group, entry };
  }
  return undefined;
}

/** Comparaison insensible aux accents pour la recherche rapide. */
export function normalizeNavText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
