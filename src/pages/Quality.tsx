import React, { useEffect, useState } from 'react';
import {
  FiActivity, FiCheckCircle, FiDatabase, FiExternalLink, FiHardDrive,
  FiList, FiRefreshCw, FiShield, FiUpload,
} from 'react-icons/fi';
import { Alert, Badge, Card, EmptyState, PageHeader, SectionTitle } from '../components/ui';
import { useStore } from '../lib/store';
import { useStationLogoUrl } from '../lib/useStationLogoUrl';
import { supabase } from '../lib/supabase';
import {
  fetchQaBoard, fetchWashesPage, uploadStationLogo,
  type QaBoard, type WashPage, type LogoUploadResult,
} from '../lib/qa';

const E2E_SCENARIOS = [
  'Vitrine publique et CTA',
  'Connexion',
  'Inscription en deux temps',
  'Tableau de bord station',
  'Mise en route constatée',
  'File de lavages',
  'Grille tarifaire',
  'Fiche client',
  'Employés et rôles',
  'Caisse et clôture',
  'Dépenses',
  'Rapports et export CSV',
  'Consolidation multi-stations',
  'Qualité & déploiement',
  'Back-office super admin',
  'Logo privé en mode local et mise en route',
  'Simulations de stock en mode local',
  'Caisse, lavage, paiements mixtes et clôture',
  'Validations lavage et caisse fermée',
  'Invitation locale et révocation',
  'Accès aux invitations limité selon le rôle',
  'Reçu de lavage : aperçu, impression et PDF',
];

const DOCS = [
  'docs/installation.md',
  'docs/architecture.md',
  'docs/database.md',
  'docs/security.md',
  'docs/user-guide.md',
  'docs/deployment.md',
  'docs/testing.md',
];

function Stat({ label, value, ok }: { label: string; value: string | number; ok?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-sm font-bold text-slate-100">
        <span>{value}</span>
        {ok === true && <FiCheckCircle className="text-emerald-400" aria-label="OK" />}
        {ok === false && <Badge tone="danger">À vérifier</Badge>}
      </div>
    </div>
  );
}

export default function Quality() {
  const { state, dataSource, authKind, canWriteSubscription } = useStore();
  const serverReady = ((dataSource === 'supabase' && authKind === 'supabase' && Boolean(supabase))
    || (dataSource === 'api' && authKind === 'api')) && Boolean(state.session?.userId);
  const [board, setBoard] = useState<QaBoard | null>(null);
  const [page, setPage] = useState<WashPage | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<LogoUploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const logoPreview = useStationLogoUrl(upload?.path ?? null, serverReady, state.session?.userId ?? '');
  const limit = 5;

  useEffect(() => {
    if (!serverReady) return;
    let cancelled = false;
    fetchQaBoard()
      .then((data) => { if (!cancelled) { setBoard(data); setBoardError(null); } })
      .catch((error: unknown) => {
        if (!cancelled) setBoardError(error instanceof Error ? error.message : 'Board QA indisponible');
      });
    return () => { cancelled = true; };
  }, [serverReady]);

  useEffect(() => {
    if (!serverReady) return;
    let cancelled = false;
    fetchWashesPage(limit, pageIndex * limit)
      .then((data) => { if (!cancelled) { setPage(data); setPageError(null); } })
      .catch((error: unknown) => {
        if (!cancelled) setPageError(error instanceof Error ? error.message : 'Pagination indisponible');
      });
    return () => { cancelled = true; };
  }, [serverReady, pageIndex]);

  async function handleUpload() {
    if (!file || !serverReady || !canWriteSubscription) return;
    setUploading(true);
    setUploadError(null);
    setUpload(null);
    try {
      setUpload(await uploadStationLogo(file));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Envoi impossible');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Qualité & déploiement"
        subtitle="Contrôles d’intégrité, sécurité, pagination serveur, stockage du logo et diagnostics techniques."
        actions={<Badge tone="accent">Diagnostic serveur</Badge>}
      />

      {!serverReady && (
        <div className="mb-5">
          <Alert kind="info">
            Connectez une session serveur pour charger les métriques de diagnostic, la pagination des fiches et le stockage du logo.
          </Alert>
        </div>
      )}
      {boardError && <div className="mb-5"><Alert kind="warn">{boardError}</Alert></div>}

      <Card className="mb-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-bold"><FiActivity /> État du socle</div>
        {board ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Migrations" value={board.migrations} ok={board.migrations >= 49} />
            <Stat label="Tables publiques" value={board.tables} ok={board.tables >= 70} />
            <Stat label="Vues analytics" value={board.views} ok={board.views === 2} />
            <Stat label="Permissions" value={board.permissions} ok={board.permissions === 48} />
            <Stat label="Liaisons RBAC" value={board.rolePermissions} ok={board.rolePermissions === 112} />
            <Stat label="Index SQL" value={board.indexes} ok={board.indexes === 5} />
            <Stat label="Fonctions RPC" value={board.rpcCount} ok={board.rpcCount === 4} />
            <Stat label="Triggers quota" value={board.quotaTriggers} ok={board.quotaTriggers === 3} />
            <Stat label="Bucket privé" value={board.storageBucket ? 'oui' : 'non'} ok={board.storageBucket} />
            <Stat label="Policies objets" value={board.storagePolicies} ok={board.storagePolicies >= 5} />
            <Stat label="Policies buckets" value={board.bucketPolicies} ok={board.bucketPolicies >= 5} />
            <Stat label="RLS anon restrictive" value={board.anonStorageRevoked ? 'active' : 'absente'} ok={board.anonStorageRevoked} />
            <Stat label="Écriture bucket bloquée" value={board.authenticatedBucketInsertRevoked ? 'oui' : 'non'} ok={board.authenticatedBucketInsertRevoked} />
            <Stat label="Table d’idempotence" value={board.idempotencyTable ? 'présente' : 'absente'} ok={board.idempotencyTable} />
          </div>
        ) : (
          <EmptyState title="Diagnostic serveur non chargé" description="Les compteurs sont lus depuis le backend connecté." />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold"><FiDatabase /> Pagination serveur</div>
            <button
              className="btn btn-sm py-2!"
              disabled={!serverReady}
              onClick={() => { setPageError(null); fetchWashesPage(limit, pageIndex * limit).then(setPage).catch((e: unknown) => setPageError(e instanceof Error ? e.message : 'Erreur')); }}
            >
              <FiRefreshCw /> Actualiser
            </button>
          </div>
          {pageError && <div className="mb-3"><Alert kind="warn">{pageError}</Alert></div>}
          {!serverReady || !page ? (
            <EmptyState title="Aucune page chargée" description="my_washes_page() applique LIMIT/OFFSET côté serveur, 100 lignes maximum." />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <Badge>Total {page.total ?? 0}</Badge>
                <Badge>Limite {page.limit ?? limit}</Badge>
                <Badge>Offset {page.offset ?? 0}</Badge>
                <Badge tone={page.hasMore ? 'accent' : 'success'}>{page.hasMore ? 'Suite disponible' : 'Dernière page'}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400">
                    <tr><th className="py-2">Fiche</th><th>Statut</th><th>Montant</th><th>Station</th></tr>
                  </thead>
                  <tbody>
                    {(page.rows ?? []).map((row) => (
                      <tr key={row.washId} className="border-t border-white/10">
                        <td className="py-2 font-semibold">{row.number}</td>
                        <td>{row.status}</td>
                        <td>{row.total}</td>
                        <td className="truncate">{row.stationId.slice(0, 8)}…</td>
                      </tr>
                    ))}
                    {(page.rows ?? []).length === 0 && (
                      <tr><td colSpan={4} className="py-4 text-slate-400">Aucune fiche sur cette page.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex gap-2">
                <button className="btn btn-sm py-2!" disabled={pageIndex === 0} onClick={() => setPageIndex((n) => Math.max(0, n - 1))}>Précédent</button>
                <button className="btn btn-sm py-2!" disabled={!page.hasMore} onClick={() => setPageIndex((n) => n + 1)}>Suivant</button>
              </div>
            </>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center gap-2 text-sm font-bold"><FiHardDrive /> Stockage du logo</div>
          <p className="text-base-content/60 mb-4 text-xs leading-relaxed">
            Bucket privé <code>station-assets</code>, 5 Mo maximum, PNG / JPEG / WebP. Le logo est optimisé en WebP jusqu’à 512 px lorsque possible ; sinon le fichier d’origine est conservé. Le chemin est construit par le serveur et l’URL est signée une heure. Cet envoi de diagnostic ne modifie pas le logo de la station : utilisez Paramètres pour l’associer.
          </p>
          <input
            aria-label="Fichier logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="mb-3 block w-full text-xs text-slate-300"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button className="btn btn-sm btn-primary" disabled={!serverReady || !canWriteSubscription || !file || uploading} onClick={handleUpload}>
            <FiUpload /> {uploading ? 'Envoi…' : 'Envoyer le logo'}
          </button>
          {uploadError && <div className="mt-3"><Alert kind="warn">{uploadError}</Alert></div>}
          {upload && (
            <div className="mt-4 space-y-2 text-xs">
              <div><span className="text-slate-400">Chemin :</span> <code>{upload.path}</code></div>
              <div><span className="text-slate-400">Clé d’idempotence :</span> <code>{upload.idempotencyKey}</code></div>
              <div><span className="text-slate-400">Optimisation :</span> {upload.optimized ? 'WebP 512 px' : 'fichier d’origine conservé'} · {upload.bytes} octets</div>
              {logoPreview.loading && <p>Préparation de l’URL signée…</p>}
              {logoPreview.error && <button type="button" className="link link-primary" onClick={logoPreview.retry}>Réessayer l’URL signée</button>}
              {logoPreview.url && <a className="inline-flex items-center gap-1 text-sky-300 hover:underline" href={logoPreview.url} target="_blank" rel="noreferrer">
                Ouvrir l’URL signée <FiExternalLink />
              </a>}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center gap-2 text-sm font-bold"><FiShield /> Réseau, idempotence et sécurité</div>
          <ul className="space-y-2 text-xs leading-relaxed text-slate-300">
            {board ? Object.entries(board.rules ?? {}).map(([key, value]) => (
              <li key={key}><Badge tone="accent">{key}</Badge> <span className="ml-2">{value}</span></li>
            )) : (
              <li>Retry exponentiel, clé d’idempotence stable, aucun secret côté navigateur.</li>
            )}
            <li>Rôle connecté : <strong>{state.session?.role ?? 'non connecté'}</strong> ; source : <strong>{dataSource}</strong>.</li>
            {board && (
              <li>
                Grant <code>SELECT</code> anon historique : <strong>{board.anonStorageSelectGrant ? 'présent' : 'absent'}</strong> ;
                {' '}compensé par les policies RLS restrictives {board.anonStorageRevoked ? 'actives' : 'absentes'} : 0 ligne visible.
              </li>
            )}
            <li>Aucun compte, e-mail, secret, clé API ni fournisseur d’envoi n’est créé par cette page.</li>
          </ul>
        </Card>

        <Card>
          <div className="mb-4 flex items-center gap-2 text-sm font-bold"><FiList /> {E2E_SCENARIOS.length} parcours E2E locaux et 7 livrables</div>
          <SectionTitle>Playwright — {E2E_SCENARIOS.length} parcours locaux</SectionTitle>
          <ol className="mb-4 grid grid-cols-1 gap-1 text-xs text-slate-300 sm:grid-cols-2">
            {E2E_SCENARIOS.map((scenario, index) => (
              <li key={scenario}>{String(index + 1).padStart(2, '0')}. {scenario}</li>
            ))}
          </ol>
          <SectionTitle>Documentation de déploiement</SectionTitle>
          <ul className="grid grid-cols-1 gap-1 text-xs text-sky-300 sm:grid-cols-2">
            {DOCS.map((doc) => <li key={doc}><code>{doc}</code></li>)}
          </ul>
          <p className="text-base-content/60 mt-3 text-xs">
            Les parcours locaux et les scénarios Supabase simulés sont exécutés en CI avec Chromium. Les 15 vérifications de routes JSDOM de <code>npm run check</code> ne remplacent pas ces interactions ni une recette sur service réel.
          </p>
        </Card>
      </div>
    </div>
  );
}
