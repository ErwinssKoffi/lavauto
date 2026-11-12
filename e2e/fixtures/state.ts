// État de test injecté en mémoire pour le harnais E2E. Aucune donnée n'est
// persistée dans Supabase, aucun compte Auth ni secret n'est créé.

const now = new Date().toISOString();

export function baseState(): Record<string, unknown> {
  return {
    company: { id: 'co1', name: 'Clean Auto SARL', city: 'Abidjan', phone: '+225 0700000000', createdAt: now, suspended: false },
    station: {
      id: 'st1', companyId: 'co1', name: 'Clean Auto Cocody', address: 'Rue des Jardins, Cocody',
      city: 'Abidjan', phone: '+225 0700000000', currency: 'FCFA', logoUrl: null,
      hours: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
        .map((day, index) => ({ day, open: '08:00', close: '18:00', closed: index === 6 })),
      paymentMethods: ['especes', 'mobile_money', 'carte', 'virement'],
      cashRequiresOpen: true, maxCashierDiscount: 2000, commissionRate: 10,
      monthlyTarget: 500000, activated: true, activatedAt: now,
    },
    users: [
      { id: 'u1', companyId: 'co1', stationId: 'st1', name: 'Erwin Koffi', email: 'erwin@cleanauto.ci', phone: '', role: 'proprietaire', active: true, commissionRateOverride: null, createdAt: now },
      { id: 'u2', companyId: 'co1', stationId: 'st1', name: 'Moussa Laveur', email: 'moussa@cleanauto.ci', phone: '', role: 'caissier', active: true, commissionRateOverride: null, createdAt: now },
    ],
    vehicleCategories: [
      { id: 'c1', stationId: 'st1', name: 'Berline', active: true },
      { id: 'c2', stationId: 'st1', name: '4×4 / SUV', active: true },
    ],
    services: [
      { id: 's1', stationId: 'st1', name: 'Lavage extérieur', description: '', active: true, prices: { c1: 3000, c2: 5000 } },
      { id: 's2', stationId: 'st1', name: 'Lavage complet', description: '', active: true, prices: { c1: 6000, c2: 8500 } },
    ],
    clients: [{ id: 'cl1', stationId: 'st1', name: 'Client Test', phone: '', plate: '1234 AB 01', notes: '', createdAt: now }],
    washes: [{
      id: 'w1', stationId: 'st1', number: 'L-0001', clientId: 'cl1', clientName: 'Client Test',
      vehicleCategoryId: 'c1', vehicleLabel: 'Berline', plate: '1234 AB 01', employeeId: 'u2',
      items: [{ serviceId: 's1', serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 1 }],
      discount: 0, total: 3000, paid: 3000, status: 'ready', createdAt: now, finishedAt: now,
      cancelledReason: null, payments: [{ id: 'p1', amount: 3000, method: 'especes', at: now, byUserId: 'u2' }],
    }],
    washPosts: [{ id: 'p1', stationId: 'st1', name: 'Piste 1', capacity: 2, active: true }],
    cashSessions: [{ id: 'ca1', stationId: 'st1', openedBy: 'Erwin Koffi', openedAt: now, openingFloat: 10000, closedAt: null, countedAmount: null, closedBy: null, status: 'ouverte', reopenReason: null, reopenedAt: null }],
    expenses: [{ id: 'e1', stationId: 'st1', amount: 1500, category: 'Fournitures', reason: 'Shampoing', supplier: 'Fournisseur', date: now.slice(0, 10), method: 'especes', cashSessionId: 'ca1', status: 'enregistree', cancelReason: null, createdBy: 'Erwin Koffi', createdAt: now }],
    subscription: { id: 'sub1', companyId: 'co1', planId: 'essai', status: 'essai', startedAt: now, trialEndsAt: now, pendingPlanId: null },
    auditLogs: [{ id: 'l1', at: now, actor: 'Erwin Koffi', action: 'Station activée', detail: 'Ouverture' }],
    platformCompanies: [{ id: 'co1', name: 'Clean Auto SARL', city: 'Abidjan', phone: '', planName: 'Essai', status: 'essai', stations: 1, monthlyRevenue: 0, createdAt: now }],
    session: { userId: 'u1', email: 'erwin@cleanauto.ci', name: 'Erwin Koffi', role: 'proprietaire', companyId: 'co1', stationId: 'st1' },
    demoMode: true,
    washCounter: 1,
  };
}

export function adminState(): Record<string, unknown> {
  return {
    ...baseState(),
    session: {
      userId: 'admin1', email: 'admin@plateforme.test', name: 'Super admin SaaS',
      role: 'super_admin', companyId: null, stationId: null,
    },
  };
}
