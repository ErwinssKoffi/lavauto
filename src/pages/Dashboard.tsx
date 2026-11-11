import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiActivity, FiAlertTriangle, FiArrowRight, FiCheckCircle,
  FiCreditCard, FiDollarSign, FiDroplet, FiPlus, FiSettings,
  FiTrendingUp, FiTruck, FiUsers,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { buildReport, previous7DaysMetrics } from '../lib/metrics';
import { formatDate, formatDateTime, formatFCFA } from '../lib/format';
import {
  Badge, Breadcrumbs, Card, Drawer, EmptyState, Input,
  LockedPanel, PageHeader, Progress, Select, StatCard, useSafeAction,
} from '../components/ui';
import TodayActivityWidget from '../components/TodayActivityWidget';
import { WASH_STATUS_LABELS, PAY_METHOD_LABELS, type PayMethod, type WashStatus } from '../types';

export default function Dashboard() {
  const { state, setWashStatus, addPayment } = useStore();
  const safe = useSafeAction();
  const navigate = useNavigate();

  const [selectedWashId, setSelectedWashId] = useState<string | null>(null);

  const day = buildReport(state, 'jour');
  const month = buildReport(state, 'mois');
  const prev7 = previous7DaysMetrics(state);

  const currentStationId = state.station?.id;
  const stationWashes = state.washes.filter(
    (w) => !currentStationId || w.stationId === currentStationId
  );
  const openCash = state.cashSessions.find(
    (c) => c.status === 'ouverte' && (!currentStationId || c.stationId === currentStationId)
  );
  const unpaid = stationWashes.filter((w) => w.status !== 'annule' && w.total > w.paid);
  const target = state.station?.monthlyTarget ?? 0;
  const recent = [...stationWashes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);

  const selectedWash = state.washes.find((w) => w.id === selectedWashId) ?? null;
  const methods: PayMethod[] = state.station?.paymentMethods.length
    ? state.station.paymentMethods
    : ['especes', 'mobile_money', 'carte', 'virement'];

  // Alerts
  const alerts: { tone: 'warn' | 'danger' | 'accent'; text: string }[] = [];
  if (!state.station?.activated) {
    alerts.push({
      tone: 'warn',
      text: 'Station non activée : les écritures de métier sont bloquées (409 onboarding_incomplete).',
    });
  }
  if (!openCash && state.station?.cashRequiresOpen) {
    alerts.push({
      tone: 'warn',
      text: 'Aucune caisse ouverte : les encaissements en espèces sont refusés.',
    });
  }
  if (unpaid.length > 0) {
    alerts.push({ tone: 'accent', text: `${unpaid.length} fiche(s) avec un solde restant dû.` });
  }
  if (state.expenses.some((e) => e.status === 'annulee')) {
    alerts.push({ tone: 'accent', text: 'Des dépenses annulées sont archivées dans le journal d’audit.' });
  }

  // Stat trends
  const revDiffPct = prev7.dailyAverage > 0
    ? Math.round(((day.revenue - prev7.dailyAverage) / prev7.dailyAverage) * 100)
    : day.revenue > 0 ? 100 : 0;

  const collectedPct = day.revenue > 0
    ? Math.round((day.collected / day.revenue) * 100)
    : 100;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Pilotage', to: '/app/tableau-de-bord' }, { label: 'Tableau de bord' }]} />

      {/* Header with Quick Action Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl text-slate-100">
            Tableau de bord
          </h1>
          <p className="wg-muted mt-1 text-xs sm:text-sm">
            Exploitation en temps réel — {formatDate(new Date().toISOString())}
          </p>
        </div>

        {/* Quick action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate('/app/lavages')}
            className="wg-btn wg-btn-primary !py-2 !px-3.5 !text-xs shadow-md shadow-sky-500/20"
          >
            <FiPlus size={15} /> Nouvelle fiche
          </button>
          <button
            onClick={() => navigate('/app/caisse')}
            className="wg-btn wg-btn-ghost !py-2 !px-3 !text-xs"
          >
            <FiDollarSign size={14} className="text-sky-400" /> Caisse
          </button>
          <button
            onClick={() => navigate('/app/depenses')}
            className="wg-btn wg-btn-ghost !py-2 !px-3 !text-xs"
          >
            <FiCreditCard size={14} className="text-sky-400" /> Dépenses
          </button>
        </div>
      </div>

      {!state.station?.activated && <LockedPanel />}

      {/* Widget 'Activité du Jour' spécifique avec indicateur de tendance sur 7 jours */}
      <TodayActivityWidget onNewWashClick={() => navigate('/app/lavages')} />

      {/* Primary KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Chiffre d’affaires du jour"
          value={formatFCFA(day.revenue)}
          hint={`${day.washes.length} lavage(s) aujourd’hui`}
          icon={<FiTrendingUp />}
          trend={
            prev7.dailyAverage > 0
              ? {
                  direction: revDiffPct >= 0 ? 'up' : 'down',
                  text: `${revDiffPct >= 0 ? '+' : ''}${revDiffPct}% vs 7j`,
                }
              : undefined
          }
        />
        <StatCard
          label="Lavages effectués"
          value={String(day.washes.length)}
          hint={`${day.washes.filter((w) => w.status === 'termine').length} terminé(s) · ${day.washes.filter((w) => w.status === 'en_cours').length} en cours`}
          icon={<FiDroplet />}
          accent="bg-emerald-500/10 text-emerald-400"
        />
        <StatCard
          label="Encaissements constatés"
          value={formatFCFA(day.collected)}
          hint={`${collectedPct}% du CA déjà recouvré`}
          icon={<FiCreditCard />}
          accent="bg-sky-500/10 text-sky-400"
        />
        <StatCard
          label="Dépenses de la journée"
          value={formatFCFA(day.expenses)}
          hint={`Résultat d’exploitation : ${formatFCFA(day.result)}`}
          icon={<FiCreditCard />}
          accent="bg-amber-500/10 text-amber-400"
        />
      </div>

      {/* Middle Grid: Operations & Cash State */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Recent Operations Table */}
        <Card className="lg:col-span-2 !p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--wg-border)' }}>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-slate-200">
                Dernières opérations de lavage
              </h2>
              <p className="wg-muted text-[11px]">Cliquez sur une ligne pour inspecter la fiche</p>
            </div>
            <Link to="/app/lavages" className="wg-link text-xs flex items-center gap-1">
              Voir tout <FiArrowRight size={13} />
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<FiTruck />}
                title="Aucune opération enregistrée"
                description="Les fiches de lavage apparaîtront ici dès l’ouverture de l’exploitation. Aucune donnée d’exemple n’est ajoutée."
              />
            </div>
          ) : (
            <div className="wg-scroll-x">
              <table>
                <thead>
                  <tr>
                    <th className="wg-th">Fiche</th>
                    <th className="wg-th">Véhicule</th>
                    <th className="wg-th">Client</th>
                    <th className="wg-th">Total</th>
                    <th className="wg-th">Payé</th>
                    <th className="wg-th">Statut</th>
                    <th className="wg-th text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((w) => (
                    <tr
                      key={w.id}
                      onClick={() => setSelectedWashId(w.id)}
                      className="wg-tr-hover cursor-pointer"
                    >
                      <td className="wg-td font-bold text-sky-400">{w.number}</td>
                      <td className="wg-td">
                        <span className="font-medium text-slate-200">{w.vehicleLabel}</span>
                        {w.plate && <span className="wg-muted ml-1 text-xs">· {w.plate}</span>}
                      </td>
                      <td className="wg-td">
                        {w.clientName ? (
                          <span className="text-slate-300">{w.clientName}</span>
                        ) : (
                          <span className="wg-muted italic">Sans client</span>
                        )}
                      </td>
                      <td className="wg-td font-semibold text-slate-200">{formatFCFA(w.total)}</td>
                      <td className="wg-td text-emerald-400">{formatFCFA(w.paid)}</td>
                      <td className="wg-td">
                        <Badge
                          tone={
                            w.status === 'termine'
                              ? 'success'
                              : w.status === 'annule'
                              ? 'danger'
                              : 'warn'
                          }
                        >
                          {WASH_STATUS_LABELS[w.status]}
                        </Badge>
                      </td>
                      <td className="wg-td text-right">
                        <button className="wg-link text-xs">Détails →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Side Panel: Cash Status & Monthly Target */}
        <div className="space-y-5">
          {/* Cash Status Card */}
          <Card className="border">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">
              État de la caisse physique
            </h2>
            {openCash ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge tone="success">Caisse ouverte</Badge>
                  <span className="text-[11px] text-slate-400">
                    Par {openCash.openedBy}
                  </span>
                </div>
                <div>
                  <p className="wg-muted text-[11px]">Fond de caisse initial :</p>
                  <p className="text-2xl font-extrabold text-slate-100">
                    {formatFCFA(openCash.openingFloat)}
                  </p>
                </div>
                <p className="wg-muted text-[11px]">
                  Ouverte le {formatDateTime(openCash.openedAt)}
                </p>
                <Link to="/app/caisse" className="wg-btn wg-btn-ghost mt-2 w-full !text-xs !py-2">
                  Gérer la caisse & clôture
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <Badge tone="warn">Aucune caisse ouverte</Badge>
                <p className="wg-muted text-xs leading-relaxed">
                  Un encaissement en espèces exige une caisse ouverte
                  {!state.station?.cashRequiresOpen
                    ? ' (règle désactivée pour cette station).'
                    : '.'}
                </p>
                <Link to="/app/caisse" className="wg-btn wg-btn-primary mt-2 w-full !text-xs !py-2">
                  Ouvrir la caisse
                </Link>
              </div>
            )}
          </Card>

          {/* Monthly Target Card */}
          <Card className="border">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Objectif mensuel de CA
              </h2>
              <FiActivity className="text-sky-400" size={16} />
            </div>
            <p className="text-2xl font-extrabold text-slate-100">{formatFCFA(month.revenue)}</p>
            <p className="wg-muted text-xs mt-0.5">
              sur {target > 0 ? formatFCFA(target) : 'aucun objectif fixé'}
            </p>
            <div className="mt-3">
              <Progress
                value={month.revenue}
                max={target || 1}
                tone={target && month.revenue >= target ? 'success' : 'accent'}
              />
            </div>
            {target === 0 && (
              <p className="wg-muted mt-2 text-[11px]">
                Définissez votre objectif mensuel dans{' '}
                <Link to="/app/parametres" className="wg-link">
                  Paramètres
                </Link>
                .
              </p>
            )}
          </Card>
        </div>
      </div>

      {/* Bottom Grid: Alerts & Payments Breakdown */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
            <FiAlertTriangle className="text-amber-400" /> Notifications & Alertes système
          </h2>
          {alerts.length === 0 ? (
            <p className="wg-muted text-xs">Aucune alerte en attente. Tout est sous contrôle.</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <div key={i}>
                  <Badge tone={a.tone}>{a.text}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">
            Répartition des encaissements par canal
          </h2>
          {day.byMethod.length === 0 ? (
            <p className="wg-muted text-xs">Aucun encaissement enregistré aujourd’hui.</p>
          ) : (
            <div className="space-y-3">
              {day.byMethod.map((m) => (
                <div key={m.method}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-semibold text-slate-200">
                      {PAY_METHOD_LABELS[m.method]}
                    </span>
                    <span className="wg-muted">
                      {formatFCFA(m.amount)} · {m.count} paiement(s)
                    </span>
                  </div>
                  <Progress value={m.amount} max={day.collected || 1} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Slide-in Drawer when inspecting a wash from Dashboard */}
      {selectedWash && (
        <DashboardWashDrawer
          wash={selectedWash}
          methods={methods}
          onClose={() => setSelectedWashId(null)}
          onStatus={(s, reason) => safe(() => setWashStatus(selectedWash.id, s, reason))}
          onPay={(amt, meth) => safe(() => addPayment(selectedWash.id, amt, meth))}
        />
      )}
    </div>
  );
}

function DashboardWashDrawer({
  wash,
  methods,
  onClose,
  onStatus,
  onPay,
}: {
  wash: any;
  methods: PayMethod[];
  onClose: () => void;
  onStatus: (s: WashStatus, reason?: string) => void;
  onPay: (amt: number, meth: PayMethod) => void;
}) {
  const { state } = useStore();
  const [payAmount, setPayAmount] = useState(Math.max(0, wash.total - wash.paid));
  const [payMethod, setPayMethod] = useState<PayMethod>(methods[0] ?? 'especes');
  const employee = state.users.find((u) => u.id === wash.employeeId)?.name ?? '—';

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Fiche ${wash.number}`}
      subtitle={`${wash.vehicleLabel}${wash.plate ? ` · ${wash.plate}` : ''} — ${formatDateTime(wash.createdAt)}`}
      width="max-w-lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          {wash.status === 'en_attente' && (
            <button className="wg-btn wg-btn-ghost text-xs" onClick={() => onStatus('en_cours')}>
              Passer en cours
            </button>
          )}
          {wash.status !== 'termine' && wash.status !== 'annule' && (
            <button className="wg-btn wg-btn-primary text-xs" onClick={() => onStatus('termine')}>
              <FiCheckCircle size={14} /> Marquer terminé
            </button>
          )}
          <button className="wg-btn wg-btn-ghost text-xs ml-auto" onClick={onClose}>
            Fermer
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={wash.status === 'termine' ? 'success' : wash.status === 'annule' ? 'danger' : 'warn'}>
            {WASH_STATUS_LABELS[wash.status as WashStatus]}
          </Badge>
          <Badge>Employé : {employee}</Badge>
          {wash.clientName && <Badge>Client : {wash.clientName}</Badge>}
        </div>

        <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
          <table>
            <thead>
              <tr>
                <th className="wg-th">Prestation</th>
                <th className="wg-th">Prix</th>
                <th className="wg-th">Qté</th>
                <th className="wg-th">Total</th>
              </tr>
            </thead>
            <tbody>
              {wash.items.map((it: any) => (
                <tr key={it.serviceId}>
                  <td className="wg-td">{it.serviceName}</td>
                  <td className="wg-td">{formatFCFA(it.unitPrice)}</td>
                  <td className="wg-td">{it.qty}</td>
                  <td className="wg-td font-semibold">{formatFCFA(it.unitPrice * it.qty)}</td>
                </tr>
              ))}
              <tr>
                <td className="wg-td font-bold" colSpan={3}>Total</td>
                <td className="wg-td font-bold text-sky-400">{formatFCFA(wash.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Card className="!p-2.5 text-center">
            <p className="wg-muted text-[10px]">Total</p>
            <p className="font-bold text-xs">{formatFCFA(wash.total)}</p>
          </Card>
          <Card className="!p-2.5 text-center">
            <p className="wg-muted text-[10px]">Payé</p>
            <p className="font-bold text-xs text-emerald-400">{formatFCFA(wash.paid)}</p>
          </Card>
          <Card className="!p-2.5 text-center">
            <p className="wg-muted text-[10px]">Reste</p>
            <p className="font-bold text-xs text-amber-400">{formatFCFA(Math.max(0, wash.total - wash.paid))}</p>
          </Card>
        </div>

        {wash.total - wash.paid > 0 && wash.status !== 'annule' && (
          <div className="rounded-xl border p-3 border-sky-500/30" style={{ background: 'var(--wg-surface-2)' }}>
            <p className="mb-2 text-xs font-bold text-slate-200">Encaisser le reste dû</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                type="number"
                min="1"
                max={wash.total - wash.paid}
                value={payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value))}
              />
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PayMethod)}>
                {methods.map((m) => (
                  <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>
                ))}
              </Select>
              <button
                className="wg-btn wg-btn-primary !text-xs"
                onClick={() => onPay(payAmount, payMethod)}
              >
                Encaisser
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
