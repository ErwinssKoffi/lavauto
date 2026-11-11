import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  AppState, AppUser, CashSession, Client, Company, DayHours, Expense, PayMethod,
  Plan, Role, Service, Session, Station, Subscription, VehicleCategory, Wash,
  WashItem, WashStatus,
} from '../types';
import { ApiError } from '../types';
import { uid, todayISO } from './format';
import { PLANS } from './plans';
import { isSupabaseConfigured } from './supabase';

// ═══════════════════════════════════════════════════════════════════════════
// Couche de données WashGuard — FRONTEND UNIQUEMENT
//
// En l'absence de backend branché, l'état est conservé dans le navigateur.
// Cette couche simule le *contrat* du serveur, pas des données :
//   • l'inscription crée UNE SEULE FOIS entreprise + station + compte
//     propriétaire + abonnement d'essai ;
//   • l'onboarding est CONSTATÉ sur les données enregistrées (aucune case
//     cochée par le navigateur) ;
//   • tant que la station n'est pas activée, toute écriture métier lève
//     409 onboarding_incomplete avec la liste de ce qui manque ;
//   • aucun prix de prestation ni aucune donnée d'exemple n'est prérempli.
//
// Quand Supabase sera branché (lib/supabase.ts), chaque action ci-dessous
// sera remplacée par un appel RPC / table, sans changer les écrans.
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'washguard.state.v1';

export const DEFAULT_DAYS: DayHours[] = [
  { day: 'Lundi', open: '08:00', close: '18:00', closed: false },
  { day: 'Mardi', open: '08:00', close: '18:00', closed: false },
  { day: 'Mercredi', open: '08:00', close: '18:00', closed: false },
  { day: 'Jeudi', open: '08:00', close: '18:00', closed: false },
  { day: 'Vendredi', open: '08:00', close: '18:00', closed: false },
  { day: 'Samedi', open: '08:00', close: '18:00', closed: false },
  { day: 'Dimanche', open: '08:00', close: '18:00', closed: false },
];

export const emptyState = (): AppState => ({
  company: null,
  station: null,
  users: [],
  vehicleCategories: [],
  services: [],
  clients: [],
  washes: [],
  cashSessions: [],
  expenses: [],
  subscription: null,
  auditLogs: [],
  platformCompanies: [],
  session: null,
  demoMode: !isSupabaseConfigured,
  washCounter: 0,
  passwords: {},
});

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...emptyState(), ...(JSON.parse(raw) as AppState) };
  } catch { /* état corrompu → repartir à vide */ }
  return emptyState();
}

// ─── Garde-fou /auth/me : UN SEUL appel par visiteur ─────────────────────────
// Le défaut réel : le 401 de /auth/me invalidait tout le cache, ce qui
// relançait /auth/me, et ainsi de suite (2 300 requêtes en 5 s mesurées
// dans un vrai navigateur). La promesse est mémorisée une fois pour toutes
// et un 401 résout `null` SANS invalider le cache.
let meRequest: Promise<Session | null> | null = null;
export function fetchMeOnce(): Promise<Session | null> {
  if (meRequest) return meRequest;
  meRequest = new Promise<Session | null>((resolve) => {
    // En mode local, la session vient du stockage navigateur.
    // Avec Supabase : supabase.auth.getSession() → 401 ⇒ resolve(null),
    // jamais de nouvelle tentative ni d'invalidation de cache.
    try {
      const s = load().session;
      resolve(s ?? null);
    } catch {
      resolve(null);
    }
  });
  return meRequest;
}

// ─── Onboarding : 13 étapes, 8 obligatoires, état constaté ───────────────────
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  required: boolean;
  done: boolean;
  hint: string;
}

export function computeOnboarding(s: AppState): OnboardingStep[] {
  const st = s.station;
  const co = s.company;
  const cats = s.vehicleCategories.filter((c) => c.active);
  const svcs = s.services.filter((v) => v.active);
  const pricesComplete =
    cats.length > 0 && svcs.length > 0 &&
    svcs.every((v) => cats.every((c) => (v.prices[c.id] ?? 0) > 0));
  const hoursSet = Boolean(st && st.hours.length === 7 && st.hours.some((h) => !h.closed));

  return [
    {
      id: 'entreprise', title: 'Identité de l’entreprise', required: true,
      description: 'Raison sociale, ville et téléphone de l’entreprise.',
      done: Boolean(co && co.name.trim() && co.city.trim() && co.phone.trim()),
      hint: 'Renseignez le nom, la ville et le téléphone.',
    },
    {
      id: 'station', title: 'Identité de la station', required: true,
      description: 'Nom, adresse et ville de la station.',
      done: Boolean(st && st.name.trim() && st.address.trim() && st.city.trim()),
      hint: 'Renseignez le nom, l’adresse et la ville.',
    },
    {
      id: 'horaires', title: 'Horaires d’ouverture', required: true,
      description: 'Les sept jours de la semaine, avec les jours fermés.',
      done: hoursSet,
      hint: 'Validez au moins un jour ouvert.',
    },
    {
      id: 'categories', title: 'Catégories de véhicules', required: true,
      description: 'Les types de véhicules que vous lavez (ex. Berline, 4×4).',
      done: cats.length > 0,
      hint: 'Ajoutez au moins une catégorie.',
    },
    {
      id: 'catalogue', title: 'Catalogue des prestations', required: true,
      description: 'Les prestations proposées par votre station.',
      done: svcs.length > 0,
      hint: 'Ajoutez au moins une prestation.',
    },
    {
      id: 'tarifs', title: 'Grille tarifaire', required: true,
      description: 'Un prix par prestation et par catégorie de véhicule.',
      done: pricesComplete,
      hint: `Chaque prestation doit avoir un prix pour chaque catégorie (${cats.length} catégorie(s) × ${svcs.length} prestation(s)).`,
    },
    {
      id: 'paiements', title: 'Moyens de paiement', required: true,
      description: 'Especes, Mobile Money, carte, virement.',
      done: Boolean(st && st.paymentMethods.length > 0),
      hint: 'Sélectionnez au moins un moyen de paiement.',
    },
    {
      id: 'equipe', title: 'Comptes employés', required: false,
      description: 'Ajoutez vos laveurs, gérants et caissiers.',
      done: s.users.filter((u) => u.role !== 'proprietaire').length > 0,
      hint: 'Facultatif : le compte propriétaire suffit pour ouvrir.',
    },
    {
      id: 'logo', title: 'Logo de la station', required: false,
      description: 'Apparaît sur les fiches et les rapports.',
      done: Boolean(st?.logoUrl),
      hint: 'Facultatif.',
    },
    {
      id: 'caisse', title: 'Règles de caisse', required: false,
      description: 'Caisse obligatoire pour les espèces, remise maximale du caissier.',
      done: Boolean(st && (st.maxCashierDiscount > 0 || !st.cashRequiresOpen)),
      hint: 'Facultatif : des règles par défaut sont déjà appliquées.',
    },
    {
      id: 'commissions', title: 'Barème des commissions', required: false,
      description: 'Pourcentage dû aux laveurs sur les lavages terminés.',
      done: Boolean(st && st.commissionRate > 0),
      hint: 'Facultatif : 0 % tant que vous n’avez pas choisi.',
    },
    {
      id: 'objectif', title: 'Objectif du mois', required: false,
      description: 'Objectif de chiffre d’affaires suivi sur le tableau de bord.',
      done: Boolean(st && st.monthlyTarget > 0),
      hint: 'Facultatif.',
    },
    {
      id: 'activation', title: 'Activation de la station', required: true,
      description: 'Ouvre l’exploitation : fiches, encaissements, caisse et dépenses.',
      done: Boolean(st?.activated),
      hint: 'Activez une fois les sept étapes obligatoires constatées.',
    },
  ];
}

export function missingRequired(s: AppState): string[] {
  return computeOnboarding(s)
    .filter((step) => step.required && step.id !== 'activation' && !step.done)
    .map((step) => step.title);
}

// ─── Contexte ────────────────────────────────────────────────────────────────
export interface Toast { id: string; kind: 'success' | 'error' | 'info'; message: string }

export interface SignUpPayload {
  companyName: string;
  stationName: string;
  phone: string;
  city: string;
  ownerName: string;
  email: string;
  password: string;
}

export interface WashPayload {
  categoryId: string;
  plate: string;
  employeeId: string;
  clientId: string | null;
  clientName: string;
  items: { serviceId: string; qty: number }[];
  discount: number;
  payment?: { amount: number; method: PayMethod } | null;
}

interface Ctx {
  state: AppState;
  toasts: Toast[];
  notify: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  plans: Plan[];
  onboarding: OnboardingStep[];
  missing: string[];
  // auth
  signUp: (p: SignUpPayload) => void;
  signIn: (email: string, password: string) => void;
  signInSupportDemo: () => void;
  signOut: () => void;
  // données de base / paramètres
  updateCompany: (patch: Partial<Company>) => void;
  updateStation: (patch: Partial<Station>) => void;
  setHours: (hours: DayHours[]) => void;
  addCategory: (name: string) => void;
  toggleCategory: (id: string) => void;
  removeCategory: (id: string) => void;
  addService: (name: string, description: string) => void;
  updateService: (id: string, patch: Partial<Service>) => void;
  setPrice: (serviceId: string, categoryId: string, price: number) => void;
  removeService: (id: string) => void;
  addEmployee: (p: { name: string; email: string; phone: string; role: Role; password: string }) => void;
  updateEmployee: (id: string, patch: Partial<AppUser>) => void;
  resetPassword: (id: string, password: string) => void;
  addClient: (p: { name: string; phone: string; plate: string; notes: string }) => void;
  updateClient: (id: string, p: Partial<Client>) => void;
  // exploitation (protégées par le garde 409)
  createWash: (p: WashPayload) => Wash;
  setWashStatus: (id: string, status: WashStatus, reason?: string) => void;
  addPayment: (washId: string, amount: number, method: PayMethod) => void;
  openCash: (openingFloat: number) => void;
  closeCash: (counted: number) => void;
  reopenCash: (sessionId: string, reason: string) => void;
  addExpense: (p: Omit<Expense, 'id' | 'stationId' | 'status' | 'cancelReason' | 'createdBy' | 'createdAt' | 'cashSessionId'>) => void;
  cancelExpense: (id: string, reason: string) => void;
  // abonnement / plateforme
  requestPlanChange: (planId: string) => void;
  toggleCompanySuspension: (companyId: string) => void;
  activateStation: () => void;
  resetAll: () => void;
}

const StoreContext = createContext<Ctx | null>(null);

function logAction(state: AppState, action: string, detail: string): AppState['auditLogs'] {
  const actor = state.session?.name ?? 'Système';
  return [{ id: uid('log'), at: new Date().toISOString(), actor, action, detail }, ...state.auditLogs].slice(0, 200);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('washguard.theme') === 'light' ? 'light' : 'dark'
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = uid('toast');
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('washguard.theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  }, []);

  const onboarding = useMemo(() => computeOnboarding(state), [state]);
  const missing = useMemo(() => missingRequired(state), [state]);

  /** Toutes les écritures métier passent par ce garde. */
  const assertActivated = useCallback(() => {
    const s = stateRef.current;
    if (!s.station?.activated) {
      throw new ApiError(
        'onboarding_incomplete',
        'La station n’est pas encore activée : les fiches, encaissements, la caisse et les dépenses sont bloqués.',
        missingRequired(s)
      );
    }
  }, []);

  /** Mutation simple, avec journalisation optionnelle. */
  const mutate = useCallback((fn: (s: AppState) => AppState) => setState((s) => fn(s)), []);

  // ── Auth ───────────────────────────────────────────────────────────────────
  const signUp = useCallback((p: SignUpPayload) => {
    const s = stateRef.current;
    if (s.company && s.station && s.users.length > 0) {
      // Idempotence : l'inscription ne crée ces objets qu'UNE SEULE FOIS,
      // même si le formulaire est soumis deux fois.
      setState({ ...s, session: makeSession(s.users.find((u) => u.role === 'proprietaire')!, s) });
      notify('info', 'Cette entreprise est déjà enregistrée. Connectez-vous.');
      return;
    }
    const companyId = uid('co');
    const stationId = uid('st');
    const userId = uid('usr');
    const now = new Date().toISOString();
    const company: Company = {
      id: companyId, name: p.companyName.trim(), city: p.city.trim(),
      phone: p.phone.trim(), createdAt: now, suspended: false,
    };
    const station: Station = {
      id: stationId, companyId, name: p.stationName.trim(), address: '',
      city: p.city.trim(), phone: p.phone.trim(), currency: 'FCFA',
      logoUrl: null, hours: [], paymentMethods: [], cashRequiresOpen: true,
      maxCashierDiscount: 0, commissionRate: 0, monthlyTarget: 0,
      activated: false, activatedAt: null,
    };
    const owner: AppUser = {
      id: userId, companyId, stationId, name: p.ownerName.trim(),
      email: p.email.trim().toLowerCase(), phone: p.phone.trim(), role: 'proprietaire',
      active: true, commissionRateOverride: null, createdAt: now,
    };
    const trialEndsAt = new Date(Date.now() + 14 * 86400000).toISOString();
    const sub: Subscription = {
      id: uid('sub'), companyId, planId: 'essai', status: 'essai',
      startedAt: now, trialEndsAt, pendingPlanId: null,
    };
    const next: AppState = {
      ...s,
      company, station, users: [owner], subscription: sub,
      passwords: { ...s.passwords, [owner.email]: p.password },
      platformCompanies: [{
        id: companyId, name: company.name, city: company.city, phone: company.phone,
        planName: 'Essai', status: 'essai', stations: 1, monthlyRevenue: 0, createdAt: now,
      }, ...s.platformCompanies],
      session: { userId, email: owner.email, name: owner.name, role: 'proprietaire', companyId, stationId },
    };
    setState({ ...next, auditLogs: logAction(next, 'Inscription', `Création de ${company.name} / ${station.name} et de l’abonnement d’essai`) });
    notify('success', 'Votre espace est créé. Bienvenue dans la mise en route !');
  }, [notify]);

  const signIn = useCallback((email: string, password: string) => {
    const s = stateRef.current;
    const user = s.users.find((u) => u.email === email.trim().toLowerCase());
    if (!user || s.passwords[user.email] !== password) {
      throw new ApiError('invalid_credentials', 'Adresse e-mail ou mot de passe incorrect.');
    }
    if (!user.active) throw new ApiError('account_disabled', 'Ce compte est désactivé. Voyez le propriétaire.');
    if (s.company?.suspended) throw new ApiError('company_suspended', 'Cette entreprise est suspendue. Contactez le support WashGuard.');
    setState((cur) => ({ ...cur, session: makeSession(user, cur) }));
    notify('success', `Bonjour ${user.name} !`);
  }, [notify]);

  const signInSupportDemo = useCallback(() => {
    setState((s) => ({
      ...s,
      session: { userId: 'support-demo', email: 'support@washguard.demo', name: 'Support WashGuard', role: 'support', companyId: null, stationId: null },
    }));
    notify('info', 'Accès support de démonstration (frontend seul).');
  }, [notify]);

  const signOut = useCallback(() => {
    setState((s) => ({ ...s, session: null }));
  }, []);

  // ── Données de base ────────────────────────────────────────────────────────
  const updateCompany = useCallback((patch: Partial<Company>) => mutate((s) => {
    if (!s.company) return s;
    const company = { ...s.company, ...patch };
    return {
      ...s, company,
      platformCompanies: s.platformCompanies.map((c) => c.id === company.id ? {
        ...c, name: company.name, city: company.city, phone: company.phone,
      } : c),
      auditLogs: logAction(s, 'Entreprise modifiée', Object.keys(patch).join(', ')),
    };
  }), [mutate]);

  const updateStation = useCallback((patch: Partial<Station>) => mutate((s) => {
    if (!s.station) return s;
    return {
      ...s, station: { ...s.station, ...patch },
      auditLogs: logAction(s, 'Station modifiée', Object.keys(patch).join(', ')),
    };
  }), [mutate]);

  const setHours = useCallback((hours: DayHours[]) => mutate((s) =>
    s.station ? { ...s, station: { ...s.station, hours } } : s
  ), [mutate]);

  const addCategory = useCallback((name: string) => mutate((s) => {
    if (!s.station || !name.trim()) return s;
    const cat: VehicleCategory = { id: uid('cat'), stationId: s.station.id, name: name.trim(), active: true };
    return { ...s, vehicleCategories: [...s.vehicleCategories, cat] };
  }), [mutate]);

  const toggleCategory = useCallback((id: string) => mutate((s) => ({
    ...s, vehicleCategories: s.vehicleCategories.map((c) => c.id === id ? { ...c, active: !c.active } : c),
  })), [mutate]);

  const removeCategory = useCallback((id: string) => mutate((s) => ({
    ...s, vehicleCategories: s.vehicleCategories.filter((c) => c.id !== id),
  })), [mutate]);

  const addService = useCallback((name: string, description: string) => mutate((s) => {
    if (!s.station || !name.trim()) return s;
    const svc: Service = {
      id: uid('svc'), stationId: s.station.id, name: name.trim(),
      description: description.trim(), active: true, prices: {},
    };
    return { ...s, services: [...s.services, svc] };
  }), [mutate]);

  const updateService = useCallback((id: string, patch: Partial<Service>) => mutate((s) => ({
    ...s, services: s.services.map((v) => v.id === id ? { ...v, ...patch } : v),
  })), [mutate]);

  const setPrice = useCallback((serviceId: string, categoryId: string, price: number) => mutate((s) => ({
    ...s,
    services: s.services.map((v) => v.id === serviceId
      ? { ...v, prices: { ...v.prices, [categoryId]: Math.max(0, Math.round(price)) } }
      : v),
  })), [mutate]);

  const removeService = useCallback((id: string) => mutate((s) => ({
    ...s, services: s.services.filter((v) => v.id !== id),
  })), [mutate]);

  const addEmployee = useCallback((p: { name: string; email: string; phone: string; role: Role; password: string }) => {
    const s = stateRef.current;
    if (!s.company || !s.station) return;
    const email = p.email.trim().toLowerCase();
    if (s.users.some((u) => u.email === email)) throw new ApiError('email_taken', 'Cette adresse e-mail est déjà utilisée.');
    const user: AppUser = {
      id: uid('usr'), companyId: s.company.id, stationId: s.station.id,
      name: p.name.trim(), email, phone: p.phone.trim(), role: p.role,
      active: true, commissionRateOverride: null, createdAt: new Date().toISOString(),
    };
    const next = { ...s, users: [...s.users, user], passwords: { ...s.passwords, [email]: p.password } };
    setState({ ...next, auditLogs: logAction(next, 'Employé ajouté', `${user.name} (${p.role})`) });
    notify('success', `${user.name} ajouté à l’équipe.`);
  }, [notify]);

  const updateEmployee = useCallback((id: string, patch: Partial<AppUser>) => mutate((s) => {
    const next = { ...s, users: s.users.map((u) => u.id === id ? { ...u, ...patch } : u) };
    return { ...next, auditLogs: logAction(next, 'Employé modifié', `${id} : ${Object.keys(patch).join(', ')}`) };
  }), [mutate]);

  const resetPassword = useCallback((id: string, password: string) => mutate((s) => {
    const user = s.users.find((u) => u.id === id);
    if (!user) return s;
    const next = { ...s, passwords: { ...s.passwords, [user.email]: password } };
    return { ...next, auditLogs: logAction(next, 'Mot de passe réinitialisé', `Compte : ${user.name}`) };
  }), [mutate]);

  const addClient = useCallback((p: { name: string; phone: string; plate: string; notes: string }) => mutate((s) => {
    if (!s.station || !p.name.trim()) return s;
    const c: Client = {
      id: uid('cli'), stationId: s.station.id, name: p.name.trim(),
      phone: p.phone.trim(), plate: p.plate.trim(), notes: p.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    return { ...s, clients: [c, ...s.clients] };
  }), [mutate]);

  const updateClient = useCallback((id: string, p: Partial<Client>) => mutate((s) => ({
    ...s, clients: s.clients.map((c) => c.id === id ? { ...c, ...p } : c),
  })), [mutate]);

  // ── Exploitation ───────────────────────────────────────────────────────────
  const assertCashRule = useCallback((method: PayMethod, amount: number) => {
    const s = stateRef.current;
    if (method === 'especes' && amount > 0 && s.station?.cashRequiresOpen && !s.cashSessions.some((c) => c.status === 'ouverte')) {
      throw new ApiError('cash_closed', 'Un encaissement en espèces exige une caisse ouverte (règle désactivable dans Paramètres).');
    }
  }, []);

  const createWash = useCallback((p: WashPayload): Wash => {
    assertActivated();
    const s = stateRef.current;
    const st = s.station!;
    const cats = s.vehicleCategories.filter((c) => c.active);
    const cat = cats.find((c) => c.id === p.categoryId);
    if (!cat) throw new ApiError('invalid_category', 'Choisissez une catégorie de véhicule.');
    if (!p.employeeId) throw new ApiError('invalid_employee', 'Choisissez l’employé qui réalise le lavage.');
    if (p.items.length === 0) throw new ApiError('empty_items', 'Ajoutez au moins une prestation.');
    const discount = Math.max(0, Math.round(p.discount));
    if (s.session?.role === 'caissier' && discount > st.maxCashierDiscount) {
      throw new ApiError('discount_exceeded', `Remise maximale autorisée pour un caissier : ${st.maxCashierDiscount} FCFA.`);
    }
    // Le prix est figé ici : modifier la grille tarifaire ne change JAMAIS
    // les lavages déjà enregistrés.
    const items: WashItem[] = p.items.map((it) => {
      const svc = s.services.find((v) => v.id === it.serviceId && v.active);
      if (!svc) throw new ApiError('invalid_service', 'Une prestation sélectionnée n’est plus disponible.');
      const unitPrice = svc.prices[cat.id] ?? 0;
      if (unitPrice <= 0) throw new ApiError('missing_price', `Aucun prix défini pour « ${svc.name} » / ${cat.name}.`);
      return { serviceId: svc.id, serviceName: svc.name, unitPrice, qty: Math.max(1, it.qty) };
    });
    const total = Math.max(0, items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0) - discount);
    const payment = p.payment && p.payment.amount > 0 ? p.payment : null;
    if (payment) {
      assertCashRule(payment.method, payment.amount);
      if (payment.amount > total) throw new ApiError('overpayment', 'L’encaissement dépasse le montant de la fiche.');
    }
    const counter = s.washCounter + 1;
    const now = new Date().toISOString();
    const wash: Wash = {
      id: uid('wash'), stationId: st.id, number: `L-${String(counter).padStart(4, '0')}`,
      clientId: p.clientId || null,
      clientName: p.clientId
        ? s.clients.find((c) => c.id === p.clientId)?.name ?? null
        : p.clientName.trim() || null,
      vehicleCategoryId: cat.id, vehicleLabel: cat.name, plate: p.plate.trim(),
      employeeId: p.employeeId, items, discount, total, paid: payment?.amount ?? 0,
      status: 'en_attente', createdAt: now, finishedAt: null, cancelledReason: null,
      payments: payment ? [{
        id: uid('pay'), amount: payment.amount, method: payment.method, at: now,
        byUserId: s.session?.userId ?? 'inconnu',
      }] : [],
    };
    setState((cur) => ({ ...cur, washes: [wash, ...cur.washes], washCounter: counter }));
    notify('success', `Fiche ${wash.number} enregistrée — ${total.toLocaleString('fr-FR')} FCFA.`);
    return wash;
  }, [assertActivated, assertCashRule, notify]);

  const setWashStatus = useCallback((id: string, status: WashStatus, reason?: string) => {
    assertActivated();
    setState((s) => ({
      ...s,
      washes: s.washes.map((w) => w.id === id ? {
        ...w, status,
        finishedAt: status === 'termine' ? new Date().toISOString() : w.finishedAt,
        cancelledReason: status === 'annule' ? (reason ?? 'Motif non précisé') : null,
      } : w),
    }));
  }, [assertActivated]);

  const addPayment = useCallback((washId: string, amount: number, method: PayMethod) => {
    assertActivated();
    const s = stateRef.current;
    const wash = s.washes.find((w) => w.id === washId);
    if (!wash) throw new ApiError('not_found', 'Fiche introuvable.');
    const amt = Math.round(amount);
    if (amt <= 0) throw new ApiError('invalid_amount', 'Le montant doit être supérieur à zéro.');
    if (amt > wash.total - wash.paid) throw new ApiError('overpayment', 'Le montant dépasse le reste à payer.');
    assertCashRule(method, amt);
    setState((cur) => ({
      ...cur,
      washes: cur.washes.map((w) => w.id === washId ? {
        ...w, paid: w.paid + amt,
        payments: [...w.payments, {
          id: uid('pay'), amount: amt, method, at: new Date().toISOString(),
          byUserId: cur.session?.userId ?? 'inconnu',
        }],
        status: w.paid + amt >= w.total && w.status === 'en_attente' ? 'en_cours' : w.status,
      } : w),
    }));
    notify('success', 'Encaissement enregistré.');
  }, [assertActivated, assertCashRule, notify]);

  const openCash = useCallback((openingFloat: number) => {
    assertActivated();
    const s = stateRef.current;
    if (s.cashSessions.some((c) => c.status === 'ouverte')) throw new ApiError('cash_open', 'Une caisse est déjà ouverte.');
    const session: CashSession = {
      id: uid('cash'), stationId: s.station!.id, openedBy: s.session?.name ?? '—',
      openedAt: new Date().toISOString(), openingFloat: Math.max(0, Math.round(openingFloat)),
      closedAt: null, countedAmount: null, closedBy: null, status: 'ouverte',
      reopenReason: null, reopenedAt: null,
    };
    const next = { ...s, cashSessions: [session, ...s.cashSessions] };
    setState({ ...next, auditLogs: logAction(next, 'Caisse ouverte', `Fond de caisse : ${session.openingFloat} FCFA`) });
    notify('success', 'Caisse ouverte.');
  }, [assertActivated, notify]);

  const closeCash = useCallback((counted: number) => {
    assertActivated();
    const s = stateRef.current;
    const open = s.cashSessions.find((c) => c.status === 'ouverte');
    if (!open) throw new ApiError('cash_closed', 'Aucune caisse ouverte.');
    const next = {
      ...s,
      cashSessions: s.cashSessions.map((c) => c.id === open.id ? {
        ...c, status: 'cloturee' as const, closedAt: new Date().toISOString(),
        countedAmount: Math.max(0, Math.round(counted)), closedBy: s.session?.name ?? '—',
      } : c),
    };
    setState({ ...next, auditLogs: logAction(next, 'Caisse clôturée', `Comptage : ${counted} FCFA`) });
    notify('success', 'Caisse clôturée avec comptage.');
  }, [assertActivated, notify]);

  const reopenCash = useCallback((sessionId: string, reason: string) => {
    assertActivated();
    if (!reason.trim()) throw new ApiError('invalid_reason', 'La réouverture doit être motivée.');
    const next0 = stateRef.current;
    const next = {
      ...next0,
      cashSessions: next0.cashSessions.map((c) => c.id === sessionId ? {
        ...c, status: 'ouverte' as const, reopenReason: reason.trim(),
        reopenedAt: new Date().toISOString(), closedAt: null, countedAmount: null,
      } : c),
    };
    setState({ ...next, auditLogs: logAction(next, 'Caisse réouverte', reason.trim()) });
    notify('info', 'Caisse réouverte (motif enregistré).');
  }, [assertActivated, notify]);

  const addExpense = useCallback((p: Omit<Expense, 'id' | 'stationId' | 'status' | 'cancelReason' | 'createdBy' | 'createdAt' | 'cashSessionId'>) => {
    assertActivated();
    const s = stateRef.current;
    if (p.amount <= 0) throw new ApiError('invalid_amount', 'Le montant doit être supérieur à zéro.');
    if (!p.reason.trim()) throw new ApiError('invalid_reason', 'Le motif est obligatoire.');
    assertCashRule(p.method, p.amount);
    const open = s.cashSessions.find((c) => c.status === 'ouverte');
    const expense: Expense = {
      ...p, id: uid('exp'), stationId: s.station!.id, status: 'enregistree',
      cancelReason: null, createdBy: s.session?.name ?? '—',
      createdAt: new Date().toISOString(), cashSessionId: open?.id ?? null,
      amount: Math.round(p.amount),
    };
    setState((cur) => ({ ...cur, expenses: [expense, ...cur.expenses] }));
    notify('success', 'Dépense enregistrée.');
  }, [assertActivated, assertCashRule, notify]);

  const cancelExpense = useCallback((id: string, reason: string) => {
    assertActivated();
    if (!reason.trim()) throw new ApiError('invalid_reason', 'L’annulation doit être motivée.');
    // Jamais de suppression : on conserve la trace et le motif.
    setState((s) => ({
      ...s,
      expenses: s.expenses.map((e) => e.id === id ? {
        ...e, status: 'annulee', cancelReason: reason.trim(),
      } : e),
      auditLogs: logAction(s, 'Dépense annulée', `${id} — ${reason.trim()}`),
    }));
    notify('info', 'Dépense annulée (tracée, jamais supprimée).');
  }, [assertActivated, notify]);

  // ── Abonnement / plateforme / activation ──────────────────────────────────
  const requestPlanChange = useCallback((planId: string) => {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) return;
    setState((s) => {
      if (!s.subscription) return s;
      const next = { ...s, subscription: { ...s.subscription, pendingPlanId: planId } };
      return { ...next, auditLogs: logAction(next, 'Demande de changement de formule', plan.name) };
    });
    notify('success', `Demande de passage à « ${plan.name} » enregistrée.`);
  }, [notify]);

  const toggleCompanySuspension = useCallback((companyId: string) => {
    setState((s) => {
      const company = s.platformCompanies.find((c) => c.id === companyId);
      if (!company) return s;
      const suspended = company.status !== 'suspendue';
      const next = {
        ...s,
        platformCompanies: s.platformCompanies.map((c) => c.id === companyId
          ? { ...c, status: suspended ? 'suspendue' as const : 'active' as const } : c),
        company: s.company?.id === companyId ? { ...s.company, suspended } : s.company,
      };
      return { ...next, auditLogs: logAction(next, suspended ? 'Entreprise suspendue' : 'Entreprise réactivée', company.name) };
    });
  }, []);

  const activateStation = useCallback(() => {
    const s = stateRef.current;
    const missingNow = missingRequired(s);
    if (missingNow.length > 0) {
      throw new ApiError('onboarding_incomplete', 'La station ne peut pas ouvrir : des étapes obligatoires manquent.', missingNow);
    }
    setState((cur) => {
      const next = {
        ...cur,
        station: cur.station ? { ...cur.station, activated: true, activatedAt: new Date().toISOString() } : null,
      };
      return { ...next, auditLogs: logAction(next, 'Station activée', 'Ouverture de l’exploitation') };
    });
    notify('success', 'Station activée : l’exploitation est ouverte.');
  }, [notify]);

  const resetAll = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(emptyState());
    notify('info', 'Données locales de démonstration effacées.');
  }, [notify]);

  const value: Ctx = {
    state, toasts, notify, dismissToast, theme, toggleTheme, plans: PLANS, onboarding, missing,
    signUp, signIn, signInSupportDemo, signOut,
    updateCompany, updateStation, setHours, addCategory, toggleCategory, removeCategory,
    addService, updateService, setPrice, removeService,
    addEmployee, updateEmployee, resetPassword, addClient, updateClient,
    createWash, setWashStatus, addPayment, openCash, closeCash, reopenCash, addExpense, cancelExpense,
    requestPlanChange, toggleCompanySuspension, activateStation, resetAll,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function makeSession(u: AppUser, s: AppState): Session {
  return {
    userId: u.id, email: u.email, name: u.name, role: u.role,
    companyId: u.companyId, stationId: u.stationId ?? s.station?.id ?? null,
  };
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore doit être utilisé dans StoreProvider');
  return ctx;
}

export { ApiError, todayISO };
