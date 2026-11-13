import { readNumber } from '../lib/validation';
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiAlertTriangle, FiBox, FiCheck, FiDatabase, FiLock,
  FiMinus, FiPlus, FiSave, FiShield, FiTrash2,
} from 'react-icons/fi';
import { useStore, DEFAULT_DAYS } from '../lib/store';
import { isSupabaseConfigured as sbConfigured } from '../lib/supabase';
import { formatDateTime } from '../lib/format';
import { Alert, Badge, Card, Input, PageHeader, SectionTitle, useSafeAction } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { usePermissions } from '../lib/usePermissions';
import { StationLogoEditor } from '../components/StationLogoEditor';

export default function Settings() {
  const {
    state, updateStation, updateCompany, setHours, resetAll, notify, authKind, dataSource, isLocalStockDemo, isServerStock,
    updateStockThreshold, adjustProductStock, canWriteSubscription,
  } = useStore();
  const navigate = useNavigate();
  const safe = useSafeAction();
  const { can } = usePermissions();
  const st = state.station;
  const co = state.company;
  const [stationDraft, setStationDraft] = useState({ name: st?.name ?? '', address: st?.address ?? '', city: st?.city ?? '', phone: st?.phone ?? '' });
  const [companyDraft, setCompanyDraft] = useState({ name: co?.name ?? '', city: co?.city ?? '', phone: co?.phone ?? '' });
  const [rules, setRules] = useState({ cashRequiresOpen: st?.cashRequiresOpen ?? true, maxCashierDiscount: st?.maxCashierDiscount ?? 0, commissionRate: st?.commissionRate ?? 0, monthlyTarget: st?.monthlyTarget ?? 0 });
  const [hours, setLocalHours] = useState(st?.hours?.length ? st.hours : DEFAULT_DAYS.map((h) => ({ ...h })));
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Identité de la station, horaires, devise, logo, règles de caisse, barème, objectif, entreprise et journal des opérations sensibles."
        actions={<Badge tone="accent">Devise : FCFA</Badge>} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="Nom et coordonnées de la station.">Identité de la station</SectionTitle>
          <fieldset disabled={!canWriteSubscription} className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nom" value={stationDraft.name} onChange={(e) => setStationDraft({ ...stationDraft, name: e.target.value })} />
            <Input label="Adresse" value={stationDraft.address} onChange={(e) => setStationDraft({ ...stationDraft, address: e.target.value })} />
            <Input label="Ville" value={stationDraft.city} onChange={(e) => setStationDraft({ ...stationDraft, city: e.target.value })} />
            <Input label="Téléphone" value={stationDraft.phone} onChange={(e) => setStationDraft({ ...stationDraft, phone: e.target.value })} />
            <Input label="Devise" value="FCFA" disabled hint="La devise est fixée en FCFA pour toutes les stations." />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => { void safe(async () => { await updateStation(stationDraft); notify('success', 'Identité de la station enregistrée.'); }); }}><FiSave /> Enregistrer</button>
          </fieldset>
          <StationLogoEditor />
        </Card>

        <Card>
          <SectionTitle hint="Règles de caisse, commissions et objectif.">Caisse et remises</SectionTitle>
          {!isLocalStockDemo && (
            <div className="mb-4"><Alert kind="warn">En mode connecté, la caisse ouverte est obligatoire pour les espèces et le plafond de remise du caissier n’est pas encore contrôlé par le serveur : ces deux champs ne sont pas configurables ici. Le barème et l’objectif sont enregistrés pour la station ; les relevés déjà validés restent figés.</Alert></div>
          )}
          <fieldset disabled={!canWriteSubscription} className="min-w-0">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--wg-border)' }}>
            <div><p className="text-sm font-bold">Espèces : caisse ouverte obligatoire</p><p className="wg-muted text-xs">Désactivable uniquement pour les calculs locaux. Mobile Money enregistrable à tout moment.</p></div>
            <input type="checkbox" className="h-5 w-5 accent-sky-500" disabled={!isLocalStockDemo} checked={rules.cashRequiresOpen} onChange={(e) => setRules({ ...rules, cashRequiresOpen: e.target.checked })} />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Remise maximale du caissier (FCFA)" type="number" min="0" disabled={!isLocalStockDemo} value={rules.maxCashierDiscount} onChange={(e) => setRules({ ...rules, maxCashierDiscount: readNumber(e.target.value) })} />
            <Input label="Barème des commissions (%)" type="number" min="0" max="100" value={rules.commissionRate} onChange={(e) => setRules({ ...rules, commissionRate: readNumber(e.target.value) })} />
            <Input label="Objectif de CA du mois (FCFA)" type="number" min="0" value={rules.monthlyTarget} onChange={(e) => setRules({ ...rules, monthlyTarget: readNumber(e.target.value) })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => { void safe(async () => {
            await updateStation(isLocalStockDemo ? rules : { commissionRate: rules.commissionRate, monthlyTarget: rules.monthlyTarget });
            notify('success', isLocalStockDemo ? 'Règles enregistrées dans ce navigateur.' : 'Barème et objectif enregistrés.');
          }); }}><FiSave /> Enregistrer</button>
          </fieldset>
        </Card>

        <Card>
          <SectionTitle hint="Sept jours déclarés ; cochez « Fermé » pour les jours sans activité.">Horaires d’ouverture</SectionTitle>
          <fieldset disabled={!canWriteSubscription} className="min-w-0">
          <div className="space-y-2">
            {hours.map((h, i) => (
              <div key={h.day} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--wg-border)' }}>
                <span className="w-20 font-bold">{h.day}</span>
                <input type="time" className="wg-input !w-28 !py-1" disabled={h.closed} value={h.open} onChange={(e) => setLocalHours((hs) => hs.map((x, idx) => idx === i ? { ...x, open: e.target.value } : x))} />
                <span className="wg-muted">→</span>
                <input type="time" className="wg-input !w-28 !py-1" disabled={h.closed} value={h.close} onChange={(e) => setLocalHours((hs) => hs.map((x, idx) => idx === i ? { ...x, close: e.target.value } : x))} />
                <label className="wg-muted ml-auto flex items-center gap-1.5"><input type="checkbox" className="accent-sky-500" checked={h.closed} onChange={(e) => setLocalHours((hs) => hs.map((x, idx) => idx === i ? { ...x, closed: e.target.checked } : x))} /> Fermé</label>
              </div>
            ))}
          </div>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => { void safe(async () => { await setHours(hours); notify('success', 'Horaires enregistrés.'); }); }}><FiSave /> Enregistrer les horaires</button>
          </fieldset>
        </Card>

        <Card>
          <SectionTitle hint="Raison sociale et coordonnées de l’entreprise.">Entreprise</SectionTitle>
          <fieldset disabled={!canWriteSubscription} className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nom de l’entreprise" value={companyDraft.name} onChange={(e) => setCompanyDraft({ ...companyDraft, name: e.target.value })} />
            <Input label="Ville" value={companyDraft.city} onChange={(e) => setCompanyDraft({ ...companyDraft, city: e.target.value })} />
            <Input label="Téléphone" value={companyDraft.phone} onChange={(e) => setCompanyDraft({ ...companyDraft, phone: e.target.value })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => { void safe(async () => { await updateCompany(companyDraft); notify('success', 'Entreprise enregistrée.'); }); }}><FiSave /> Enregistrer</button>
          </fieldset>

          {can('audit.view') && <div className="mt-6 border-t pt-5" style={{ borderColor: 'var(--wg-border)' }}>
            <SectionTitle hint={isLocalStockDemo ? 'Historique de démonstration dans ce navigateur.' : 'Le journal serveur n’est pas affiché dans cet écran.'}>Journal des opérations sensibles</SectionTitle>
            {!isLocalStockDemo && <p className="wg-muted mb-2 text-xs">Les événements ci-dessous ne constituent pas le journal d’audit serveur.</p>}
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {state.auditLogs.length === 0 ? <p className="wg-muted text-xs">Aucune opération sensible enregistrée.</p> : state.auditLogs.map((l) => (
                <div key={l.id} className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                  <div className="flex flex-wrap justify-between gap-2"><span className="font-bold">{l.action}</span><span className="wg-muted">{formatDateTime(l.at)}</span></div>
                  <p className="wg-muted mt-0.5">{l.actor} · {l.detail}</p>
                </div>
              ))}
            </div>
          </div>}
        </Card>

        {/* ── Section dédiée : Seuils d'alerte stock & Consommables ──── */}
        {can('inventory.view') && <Card id="stock" className="lg:col-span-2 border-amber-500/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FiBox className="text-amber-400" size={18} />
                <h3 className="text-sm font-bold text-white">Seuils d’alerte stock & Consommables critiques</h3>
                {state.stockAlerts.length > 0 ? (
                  <Badge tone="warn">{state.stockAlerts.length} produit(s) sous le seuil critique</Badge>
                ) : (
                  <Badge tone="success">Tous les stocks sont au-dessus des seuils</Badge>
                )}
              </div>
              <p className="wg-muted mt-1 text-xs">
                Une alerte est déclenchée dès que le stock descend à ou sous le seuil critique.
              </p>
              <p className="wg-muted mt-1 text-xs">
                {isLocalStockDemo
                  ? 'Démonstration locale : les changements de seuil et les simulations de consommation ou de réapprovisionnement restent dans ce navigateur. Aucun mouvement n’est envoyé au serveur.'
                  : isServerStock
                    ? 'Seuils en lecture seule : leur modification est indisponible depuis cet écran hors démonstration locale. Pour les opérations de stock, utilisez le module Stocks & achats.'
                    : 'Seuils en lecture seule. Configuration de stock indisponible ou mixte : les opérations sont bloquées pour éviter un enregistrement uniquement local.'}
              </p>
            </div>
            <Link to="/app/stock" className="wg-link text-xs">Ouvrir le module Stocks complet →</Link>
          </div>

          <div className="mt-4 divide-y" style={{ borderColor: 'var(--wg-border)' }}>
            {state.products.length === 0 ? (
              <p className="wg-muted py-4 text-xs">Aucun produit configuré.</p>
            ) : (
              state.products.map((p) => {
                const level = state.stockLevels.find((l) => l.productId === p.id);
                const qty = level?.qtyOnHand ?? 0;
                const isRupture = qty === 0;
                const isAlert = qty <= p.reorderLevel;

                return (
                  <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                    <div className="min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-white">{p.name}</p>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{p.sku}</span>
                      </div>
                      <p className="wg-muted text-[11px]">{p.category || 'Consommable'} · Unité : {p.unit}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <div className="text-right">
                        <p className="text-[10px] text-slate-400 uppercase font-semibold">Stock actuel</p>
                        <p className={`font-bold ${isRupture ? 'text-red-400' : isAlert ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {qty} {p.unit}
                        </p>
                      </div>

                      <div className="w-32">
                        {isLocalStockDemo ? (
                          <>
                            <label htmlFor={`stock-threshold-${p.id}`} className="text-[10px] text-slate-400 block mb-0.5 font-semibold">Seuil critique ({p.unit})</label>
                            <input
                              id={`stock-threshold-${p.id}`}
                              type="number"
                              min="0"
                              disabled={!canWriteSubscription}
                              className="wg-input !py-1 !text-xs font-bold"
                              defaultValue={p.reorderLevel}
                              onBlur={(e) => { const value = readNumber(e.target.value); void safe(() => updateStockThreshold(p.id, value)); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            />
                          </>
                        ) : (
                          <>
                            <p className="text-[10px] text-slate-400 mb-0.5 font-semibold">Seuil critique</p>
                            <p className="font-bold">{p.reorderLevel} {p.unit}</p>
                          </>
                        )}
                      </div>

                      {isLocalStockDemo && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="wg-muted text-[10px]">Simulation locale :</span>
                          <button
                            type="button"
                            onClick={() => { void safe(() => adjustProductStock(p.id, Math.max(0, qty - 1))); }}
                            disabled={!canWriteSubscription}
                            className="rounded bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20"
                            title="Simuler une consommation dans ce navigateur"
                            aria-label={`Simuler une consommation de 1 ${p.unit} pour ${p.name}`}
                          >
                            <FiMinus size={10} className="inline mr-0.5" aria-hidden="true" /> 1 {p.unit}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void safe(() => adjustProductStock(p.id, qty + 5)); }}
                            disabled={!canWriteSubscription}
                            className="rounded bg-sky-500/10 px-2 py-1 text-[11px] font-bold text-sky-300 hover:bg-sky-500/20"
                            title="Simuler un réapprovisionnement dans ce navigateur"
                            aria-label={`Simuler un réapprovisionnement de 5 ${p.unit} pour ${p.name}`}
                          >
                            <FiPlus size={10} className="inline mr-0.5" aria-hidden="true" /> 5 {p.unit}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>}
      </div>

      <Card className="mt-5">
        <SectionTitle hint="État du branchement et données locales de démonstration.">Environnement</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={dataSource === 'supabase' && sbConfigured ? 'success' : 'warn'}><FiDatabase /> Supabase : {dataSource === 'supabase' && sbConfigured
            ? 'connecté'
            : sbConfigured ? 'configuré · mode local' : 'non branché (mode local)'}</Badge>
          <Badge><FiShield /> Thème sombre par défaut, clair disponible</Badge>
          <Badge><FiLock /> Montants FCFA · dates jj/mm/aaaa</Badge>
        </div>
        <p className="wg-muted mt-3 text-xs leading-relaxed">L’authentification et les permissions sont servies par {authKind === 'supabase' ? 'Supabase Auth et les RPC RBAC' : 'le mode local de démonstration'}. {dataSource === 'supabase' && authKind === 'supabase' ? 'En mode connecté, identité, horaires, barème et objectif sont relus sur le serveur après enregistrement. Les règles de caisse non prises en charge restent verrouillées.' : 'En démonstration, les modifications restent dans ce navigateur.'}</p>
        {isLocalStockDemo && <button className="wg-btn wg-btn-danger mt-4" onClick={() => setConfirmReset(true)}><FiTrash2 /> Réinitialiser la démonstration</button>}
      </Card>

      <ConfirmDialog
        open={confirmReset}
        title="Effacer les données de démonstration ?"
        description="Toutes les données de démonstration de ce navigateur seront supprimées, ainsi que les accès locaux. Téléchargez et vérifiez d’abord une copie des données locales. Cette action est définitive."
        confirmLabel="Tout effacer"
        cancelLabel="Conserver les données"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => { void safe(async () => { await resetAll(); setConfirmReset(false); navigate('/', { replace: true }); }); }}
      />
    </div>
  );
}
