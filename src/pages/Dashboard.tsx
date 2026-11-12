import React from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import {
  FiActivity, FiAlertTriangle, FiArrowRight, FiBox, FiCreditCard, FiDollarSign,
  FiDroplet, FiTrendingUp, FiTruck,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { buildReport } from '../lib/metrics';
import { formatDate, formatFCFA } from '../lib/format';
import { Alert, Badge, Card, EmptyState, LockedPanel, PageHeader, Progress, StatCard } from '../components/ui';
import { WASH_STATUS_LABELS, PAY_METHOD_LABELS } from '../types';
import { washStatusTone, finishedWashes } from '../lib/washLifecycle';
import Revenue7DaysLineChart from '../components/Revenue7DaysLineChart';

export default function Dashboard() {
  const { state, analyticsBoard } = useStore();
  const day = buildReport(state, 'jour');
  const month = buildReport(state, 'mois');
  const openCash = state.cashSessions.find((c) => c.status === 'ouverte');
  const unpaid = state.washes.filter((w) => w.status !== 'cancelled' && w.total > w.paid);
  const target = state.station?.monthlyTarget ?? 0;
  const recent = [...state.washes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);

  const alerts: { tone: 'warn' | 'danger' | 'accent'; text: string }[] = [];
  if (!state.station?.activated) alerts.push({ tone: 'warn', text: 'Station non activée : les écritures de métier sont bloquées (409 onboarding_incomplete).' });
  if (!openCash && state.station?.cashRequiresOpen) alerts.push({ tone: 'warn', text: 'Aucune caisse ouverte : les encaissements en espèces sont refusés.' });
  if (unpaid.length > 0) alerts.push({ tone: 'accent', text: `${unpaid.length} fiche(s) avec un reste à payer.` });
  if (state.expenses.some((e) => e.status === 'annulee')) alerts.push({ tone: 'accent', text: 'Des dépenses annulées sont conservées dans le journal.' });
  if (state.subscription?.pendingPlanId) alerts.push({ tone: 'accent', text: 'Une demande de changement de formule est en attente.' });
  if (state.stockAlerts.length > 0) {
    alerts.push({
      tone: 'danger',
      text: `Stock critique : ${state.stockAlerts.length} consommable(s) sous le seuil (${state.stockAlerts.map((a) => `${a.name} : ${a.qtyOnHand}`).slice(0, 2).join(', ')}).`,
    });
  }

  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        subtitle={`Chiffres du ${formatDate(new Date().toISOString())} — calculés par le serveur à partir des données enregistrées.`}
        actions={<Badge tone={state.station?.activated ? 'success' : 'warn'}>{state.station?.activated ? 'Station active' : 'Exploitation fermée'}</Badge>}
      />

      {!state.station?.activated && <div className="mb-6"><LockedPanel /></div>}
      <div className="mb-5"><Alert kind="warn">
        Finance P06 : <strong>coûts manquants</strong>. Le « solde partiel » (encaissé − dépenses) n’est <strong>pas un bénéfice net</strong> ; la marge brute et le résultat seront calculables après les achats/consommations du Prompt 07.
      </Alert></div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Chiffre d’affaires du jour" value={formatFCFA(day.revenue)} hint={`${day.washes.length} lavage(s) enregistré(s)`} icon={<FiTrendingUp />} />
        <StatCard label="Lavages du jour" value={String(day.washes.length)} hint={`${finishedWashes(day.washes).length} terminé(s)`} icon={<FiDroplet />} accent="bg-emerald-500/10 text-emerald-400" />
        <StatCard label="Encaissements du jour" value={formatFCFA(day.collected)} hint={`${day.byMethod.reduce((n, m) => n + m.count, 0)} paiement(s)`} icon={<FiCreditCard />} accent="bg-sky-500/10 text-sky-400" />
        <StatCard label="Dépenses du jour" value={formatFCFA(day.expenses)} hint={`Solde partiel : ${formatFCFA(day.partialBalance)} · PAS un bénéfice`} icon={<FiCreditCard />} accent="bg-amber-500/10 text-amber-400" />
      </div>

      <div className="mt-5">
        <Revenue7DaysLineChart />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold">Dernières opérations</h2>
            <Link to="/app/lavages" className="wg-link text-xs">Voir les lavages <FiArrowRight className="inline" /></Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState icon={<FiTruck />} title="Aucune opération enregistrée" description="Les fiches de lavage apparaîtront ici dès l’ouverture de l’exploitation. Aucune donnée d’exemple n’est ajoutée." />
          ) : (
            <div className="wg-scroll-x">
              <table>
                <thead><tr><th className="wg-th">Fiche</th><th className="wg-th">Véhicule</th><th className="wg-th">Client</th><th className="wg-th">Total</th><th className="wg-th">Payé</th><th className="wg-th">Statut</th></tr></thead>
                <tbody>
                  {recent.map((w) => (
                    <tr key={w.id}>
                      <td className="wg-td font-bold">{w.number}</td>
                      <td className="wg-td">{w.vehicleLabel}{w.plate && <span className="wg-muted ml-1 text-xs">· {w.plate}</span>}</td>
                      <td className="wg-td">{w.clientName ?? <span className="wg-muted">Sans client</span>}</td>
                      <td className="wg-td font-semibold">{formatFCFA(w.total)}</td>
                      <td className="wg-td">{formatFCFA(w.paid)}</td>
                      <td className="wg-td"><Badge tone={washStatusTone(w.status)}>{WASH_STATUS_LABELS[w.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-sm font-bold">État de la caisse</h2>
            {openCash ? (
              <>
                <Badge tone="success">Caisse ouverte</Badge>
                <p className="wg-muted mt-3 text-xs">Ouverte le {formatDate(openCash.openedAt)} par {openCash.openedBy}</p>
                <p className="mt-2 text-lg font-bold">{formatFCFA(openCash.openingFloat)}</p>
                <p className="wg-muted text-[11px]">Fond de caisse</p>
                <Link to="/app/caisse" className="wg-btn wg-btn-ghost mt-4 w-full">Gérer la caisse</Link>
              </>
            ) : (
              <>
                <Badge tone="warn">Aucune caisse ouverte</Badge>
                <p className="wg-muted mt-3 text-xs leading-relaxed">Un encaissement en espèces exige une caisse ouverte{!state.station?.cashRequiresOpen ? ' (règle désactivée pour cette station).' : '.'} Le Mobile Money peut être enregistré à tout moment.</p>
                <Link to="/app/caisse" className="wg-btn wg-btn-ghost mt-4 w-full">Ouvrir la caisse</Link>
              </>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Objectif du mois</h2><FiActivity className="text-sky-400" /></div>
            <p className="text-xl font-bold">{formatFCFA(month.revenue)}</p>
            <p className="wg-muted text-xs">sur {target > 0 ? formatFCFA(target) : 'aucun objectif fixé'}</p>
            <div className="mt-3"><Progress value={month.revenue} max={target || 1} tone={target && month.revenue >= target ? 'success' : 'accent'} /></div>
            {target === 0 && <p className="wg-muted mt-2 text-[11px]">Fixez un objectif dans Paramètres ou pendant la mise en route.</p>}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold flex items-center gap-1.5">
                <FiBox className="text-amber-400" /> Consommables & Alertes
              </h2>
              <Badge tone={state.stockAlerts.length > 0 ? 'warn' : 'success'}>
                {state.stockAlerts.length > 0 ? `${state.stockAlerts.length} alerte(s)` : 'Normal'}
              </Badge>
            </div>
            {state.stockAlerts.length === 0 ? (
              <p className="wg-muted text-xs">Tous les consommables sont au-dessus de leur seuil critique.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {state.stockAlerts.slice(0, 3).map((a) => (
                  <div key={a.productId} className="rounded-lg p-2" style={{ background: 'var(--wg-surface-2)' }}>
                    <div className="flex justify-between font-bold">
                      <span className="truncate">{a.name}</span>
                      <span className={a.severity === 'rupture' ? 'text-red-400' : 'text-amber-400'}>
                        {a.severity === 'rupture' ? 'Rupture (0)' : `${a.qtyOnHand} restant(s)`}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                      <span>Seuil critique défini : {a.reorderLevel}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex justify-between text-xs pt-1 border-t" style={{ borderColor: 'var(--wg-border)' }}>
              <Link to="/app/parametres#stock" className="wg-link text-[11px]">Seuils d’alerte</Link>
              <Link to="/app/stock" className="wg-link font-bold text-[11px]">Gérer les stocks →</Link>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><FiAlertTriangle className="text-amber-400" /> Alertes</h2>
          {alerts.length === 0 ? <p className="wg-muted text-xs">Aucune alerte pour le moment.</p> : (
            <div className="space-y-2">
              {alerts.map((a, i) => <div key={i}><Badge tone={a.tone}>{a.text}</Badge></div>)}
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Répartition des encaissements du jour</h2>
          {day.byMethod.length === 0 ? <p className="wg-muted text-xs">Aucun encaissement aujourd’hui.</p> : (
            <div className="space-y-3">
              {day.byMethod.map((m) => (
                <div key={m.method}>
                  <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{PAY_METHOD_LABELS[m.method]}</span><span className="wg-muted">{formatFCFA(m.amount)} · {m.count} paiement(s)</span></div>
                  <Progress value={m.amount} max={day.collected || 1} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Tendance du mois — dashboard station</h2>
          <Link to="/app/consolidation" className="wg-link text-xs"><FiTrendingUp className="inline" /> Consolidation multi-stations</Link>
        </div>
        {analyticsBoard.trend.length === 0 ? (
          <EmptyState icon={<FiActivity />} title="Aucune tendance enregistrée" description="Les lavages réels alimenteront ce graphique Recharts, sans donnée d’exemple." />
        ) : (
          <div className="wg-scroll-x">
            <BarChart width={720} height={220} data={analyticsBoard.trend} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickFormatter={(v) => String(v).slice(8, 10)} />
              <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '10px', fontSize: '12px' }} />
              <Bar dataKey="revenue" name="Chiffre d’affaires" fill="#38bdf8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="collected" name="Encaissé" fill="#34d399" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </div>
        )}
        <p className="wg-muted mt-2 text-xs">Source : {analyticsBoard.periodStart} → {analyticsBoard.periodEnd} · {analyticsBoard.rules.netResult}.</p>
      </Card>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link to="/app/rapports" className="wg-btn wg-btn-ghost"><FiDollarSign /> Rapports et export CSV</Link>
        <Link to="/app/commissions" className="wg-btn wg-btn-ghost"><FiTruck /> Commissions de la période</Link>
      </div>
    </div>
  );
}
