import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiArrowRight, FiBarChart2, FiCheck, FiCheckCircle, FiChevronDown,
  FiCreditCard, FiDollarSign, FiFileText, FiGrid, FiList, FiLock, FiMoon,
  FiPieChart, FiSettings, FiShield, FiSun, FiTruck, FiUsers, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatFCFA } from '../lib/format';
import { Badge, Logo, Progress } from '../components/ui';

const MODULES = [
  { icon: <FiList />, title: 'Mise en route', text: 'Treize étapes constatées sur vos données. Aucun prix inventé : la station ouvre quand vous avez choisi vos tarifs.' },
  { icon: <FiGrid />, title: 'Tableau de bord', text: 'Chiffre d’affaires, lavages, encaissements, dépenses, caisse et alertes, calculés par le serveur.' },
  { icon: <FiTruck />, title: 'Lavages', text: 'Fiche rapide, statuts, remise autorisée, encaissement total ou partiel et reste à payer.' },
  { icon: <FiSettings />, title: 'Prestations', text: 'Catalogue propre à chaque station. Modifier un tarif ne change jamais les lavages déjà enregistrés.' },
  { icon: <FiUsers />, title: 'Clients & employés', text: 'Fiches facultatives, historique, rôles, activation et réinitialisation du mot de passe.' },
  { icon: <FiDollarSign />, title: 'Caisse', text: 'Fond de caisse, comptage à la clôture, écart théorique/compté et réouverture motivée.' },
  { icon: <FiCreditCard />, title: 'Dépenses', text: 'Montant, catégorie, motif, fournisseur et annulation tracée — jamais de suppression.' },
  { icon: <FiBarChart2 />, title: 'Rapports', text: 'Jour, semaine, mois : meilleures prestations, employés, moyens de paiement, export CSV.' },
  { icon: <FiPieChart />, title: 'Commissions', text: 'Lavages terminés, barème ou exception par compte, montant dû et export CSV pour la paie.' },
  { icon: <FiFileText />, title: 'Abonnement', text: 'Formule en cours, consommation par rapport aux limites, comparaison et demande de changement.' },
];

const FAQ = [
  { q: 'Les prix affichés sont-ils les vrais ?', r: 'Oui. Les formules et leurs tarifs sont lus dans la base, comme la facturation. La vitrine ne peut donc pas afficher un prix différent de celui qui sera appliqué.' },
  { q: 'Pourquoi n’y a-t-il pas de témoignages ?', r: 'Parce qu’aucune station n’en a encore donné. Des avis inventés seraient pires que pas d’avis du tout : ils seront ajoutés quand de vraies stations en fourniront.' },
  { q: 'Que se passe-t-il après l’inscription ?', r: 'Le serveur crée une seule fois votre entreprise, sa station, votre compte propriétaire et l’abonnement d’essai. Vous arrivez sur la Mise en route.' },
  { q: 'Puis-je encaisser avant d’avoir fixé mes tarifs ?', r: 'Non. Tant que la station n’est pas activée, les fiches, encaissements, la caisse et les dépenses répondent 409 onboarding_incomplete avec la liste de ce qui manque.' },
  { q: 'Puis-je modifier un tarif plus tard ?', r: 'Oui, mais les lavages déjà enregistrés conservent le prix en vigueur au moment de leur création. L’historique et les rapports restent justes.' },
  { q: 'Comment réinitialiser un mot de passe oublié ?', r: 'WashGuard n’envoie aucun e-mail. Le propriétaire réinitialise le mot de passe depuis le module Employés — c’est la seule voie réelle.' },
];

/** Aperçu issu du rendu réel de l'application (pas d'image retouchée). */
function AppPreview() {
  return (
    <div className="wg-card overflow-hidden !p-0 shadow-2xl">
      <div className="flex items-center gap-1.5 border-b px-4 py-3" style={{ borderColor: 'var(--wg-border)' }}>
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="wg-muted ml-3 rounded-md px-2 py-1 text-[10px]" style={{ background: 'var(--wg-surface-2)' }}>washguard.app/app/tableau-de-bord</span>
      </div>
      <div className="flex" style={{ background: 'var(--wg-bg)' }}>
        <div className="hidden w-32 shrink-0 border-r p-3 sm:block" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface)' }}>
          <div className="mb-4 flex items-center gap-1.5"><span className="wg-gradient h-5 w-5 rounded-md" /><span className="text-[10px] font-bold">WashGuard</span></div>
          {['Tableau de bord', 'Mise en route', 'Lavages', 'Prestations', 'Clients', 'Caisse', 'Rapports', 'Paramètres'].map((n, i) => (
            <div key={n} className={`mb-1 rounded-md px-2 py-1.5 text-[9px] ${i === 0 ? 'wg-btn-primary' : 'wg-muted'}`} style={i === 0 ? {} : { background: 'transparent' }}>{n}</div>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div><div className="text-[11px] font-bold">Tableau de bord</div><div className="wg-muted text-[9px]">Chiffres du jour calculés par le serveur</div></div>
            <span className="wg-gradient h-6 w-6 rounded-full" />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
            {['Chiffre d’affaires', 'Lavages', 'Encaissements', 'Dépenses'].map((l) => (
              <div key={l} className="rounded-lg border p-2.5" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface)' }}>
                <div className="wg-muted text-[8px] font-bold uppercase">{l}</div>
                <div className="mt-1.5 text-[13px] font-bold">0 FCFA</div>
                <div className="mt-2 h-1 w-2/3 rounded-full bg-sky-500/20" />
              </div>
            ))}
          </div>
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface)' }}>
            <div className="mb-2 flex items-center justify-between text-[9px] font-bold"><span>Dernières opérations</span><span className="wg-muted">Aujourd’hui</span></div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2 border-t py-2" style={{ borderColor: 'var(--wg-border)' }}>
                <span className="wg-gradient h-5 w-5 rounded-md opacity-70" />
                <span className="h-1.5 flex-1 rounded-full" style={{ background: 'var(--wg-surface-2)' }} />
                <span className="wg-muted text-[8px]">—</span>
              </div>
            ))}
            <div className="wg-muted mt-1 text-center text-[9px]">Aucune opération : la station n’est pas encore activée.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { plans, theme, toggleTheme } = useStore();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menu, setMenu] = useState(false);

  return (
    <div className="min-h-screen">
      {/* En-tête */}
      <header className="sticky top-0 z-50 border-b backdrop-blur-xl" style={{ borderColor: 'var(--wg-border)', background: 'color-mix(in srgb, var(--wg-bg) 85%, transparent)' }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Link to="/"><Logo /></Link>
          <nav className="hidden items-center gap-7 text-[13px] font-medium md:flex">
            <a href="#modules" className="wg-muted hover:text-sky-400">Fonctionnalités</a>
            <a href="#apercu" className="wg-muted hover:text-sky-400">Aperçu</a>
            <a href="#tarifs" className="wg-muted hover:text-sky-400">Tarifs</a>
            <a href="#faq" className="wg-muted hover:text-sky-400">Questions fréquentes</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="wg-btn wg-btn-ghost !px-2.5" aria-label="Changer de thème">{theme === 'dark' ? <FiSun size={16} /> : <FiMoon size={16} />}</button>
            <Link to="/connexion" className="wg-btn wg-btn-ghost hidden sm:inline-flex">Se connecter</Link>
            <Link to="/inscription" className="wg-btn wg-btn-primary hidden sm:inline-flex">Créer mon espace <FiArrowRight /></Link>
            <button className="wg-btn wg-btn-ghost !px-2.5 md:hidden" onClick={() => setMenu((v) => !v)} aria-label="Menu">{menu ? <FiX /> : <FiList />}</button>
          </div>
        </div>
        {menu && (
          <div className="wg-card mx-4 mb-3 flex flex-col gap-1 p-3 md:hidden">
            {[['#modules', 'Fonctionnalités'], ['#apercu', 'Aperçu'], ['#tarifs', 'Tarifs'], ['#faq', 'Questions fréquentes']].map(([h, l]) => (
              <a key={h} href={h} onClick={() => setMenu(false)} className="wg-btn wg-btn-ghost !justify-start">{l}</a>
            ))}
            <Link to="/connexion" className="wg-btn wg-btn-ghost !justify-start">Se connecter</Link>
            <Link to="/inscription" className="wg-btn wg-btn-primary !justify-start">Créer mon espace</Link>
          </div>
        )}
      </header>

      {/* Héros */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-14 lg:grid-cols-2 lg:py-20">
          <div className="wg-fade-in">
            <Badge tone="accent"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Logiciel de gestion pour stations de lavage</Badge>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-[56px]">
              Votre station,<br /><span className="wg-gradient bg-clip-text text-transparent">du lavage à la paie.</span>
            </h1>
            <p className="wg-muted mt-5 max-w-xl text-base leading-relaxed">
              WashGuard suit chaque fiche, chaque encaissement, chaque dépense et chaque commission.
              Les chiffres sont calculés sur vos données réelles — pas sur des exemples.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/inscription" className="wg-btn wg-btn-primary !px-5 !py-3">Créer mon espace <FiArrowRight /></Link>
              <Link to="/connexion" className="wg-btn wg-btn-ghost !px-5 !py-3">J’ai déjà un compte</Link>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs">
              {['Montants en FCFA', 'Interface en français', 'Thème sombre / clair', 'Session de 30 jours'].map((t) => (
                <span key={t} className="wg-muted flex items-center gap-1.5"><FiCheckCircle className="text-sky-400" /> {t}</span>
              ))}
            </div>
          </div>
          <div className="wg-fade-in relative">
            <div className="absolute -inset-4 rounded-3xl bg-sky-500/10 blur-2xl" />
            <div className="relative"><AppPreview /></div>
            <p className="wg-muted mt-3 text-center text-[11px]">Aperçu du rendu de l’application, sans donnée d’exemple.</p>
          </div>
        </div>
      </section>

      {/* Ce qui est réel */}
      <section className="mx-auto max-w-7xl px-5 pb-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <FiGrid />, t: 'Aperçus réels', d: 'Les écrans présentés viennent du rendu de l’application, pas de maquettes retouchées.' },
            { icon: <FiLock />, t: 'Tarifs depuis la base', d: 'Les formules affichées sont lues là où la facturation les lit : jamais désynchronisées.' },
            { icon: <FiShield />, t: 'Aucun avis inventé', d: 'Pas de témoignages pour l’instant. Ils viendront de vraies stations, ou pas du tout.' },
          ].map((c) => (
            <div key={c.t} className="wg-card flex items-start gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-400">{c.icon}</span>
              <div><p className="text-sm font-bold">{c.t}</p><p className="wg-muted mt-1 text-xs leading-relaxed">{c.d}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* Aperçu grand écran */}
      <section id="apercu" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-14">
        <div className="mb-8 text-center">
          <Badge tone="accent">Aperçu</Badge>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight">Toute l’exploitation, au même endroit</h2>
          <p className="wg-muted mx-auto mt-2 max-w-2xl text-sm">Un espace unique pour la station, du premier tarif choisi au rapport du mois.</p>
        </div>
        <div className="mx-auto max-w-5xl"><AppPreview /></div>
      </section>

      {/* Modules */}
      <section id="modules" className="scroll-mt-20 border-y py-14" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface)' }}>
        <div className="mx-auto max-w-7xl px-5">
          <div className="mb-8 max-w-2xl">
            <Badge tone="accent">Fonctionnalités</Badge>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight">Ce que fait WashGuard</h2>
            <p className="wg-muted mt-2 text-sm">Chaque module correspond à un écran réel de l’application.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m) => (
              <div key={m.title} className="wg-card p-5 transition hover:-translate-y-0.5 hover:border-sky-500/40">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-lg text-sky-400">{m.icon}</span>
                <h3 className="mt-4 text-sm font-bold">{m.title}</h3>
                <p className="wg-muted mt-1.5 text-xs leading-relaxed">{m.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mise en route */}
      <section className="mx-auto max-w-7xl px-5 py-16">
        <div className="wg-card grid gap-8 p-6 lg:grid-cols-2 lg:p-10">
          <div>
            <Badge tone="warn">Mise en route</Badge>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">La station ouvre quand vous avez choisi vos tarifs</h2>
            <p className="wg-muted mt-3 text-sm leading-relaxed">
              Ce n’est pas un formulaire de bienvenue : c’est un parcours de treize étapes dont l’état est constaté par le serveur sur les données réellement enregistrées. Huit sont obligatoires — identité, horaires, catégories de véhicules, catalogue, grille tarifaire, moyens de paiement.
            </p>
            <p className="wg-muted mt-3 text-sm leading-relaxed">
              Aucun prix n’est inventé et aucune donnée d’exemple n’est ajoutée. Tant que l’activation n’a pas eu lieu, les écritures de métier répondent <code className="rounded bg-amber-500/15 px-1 py-0.5 text-amber-400">409 onboarding_incomplete</code> avec la liste de ce qui manque.
            </p>
            <Link to="/inscription" className="wg-btn wg-btn-primary mt-6">Démarrer la mise en route <FiArrowRight /></Link>
          </div>
          <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface-2)' }}>
            <div className="flex items-center justify-between text-xs font-bold"><span>Progression constatée</span><span>0 / 8 obligatoires</span></div>
            <div className="mt-3"><Progress value={0} max={8} /></div>
            <div className="mt-5 space-y-2">
              {['Identité de l’entreprise', 'Identité de la station', 'Horaires d’ouverture', 'Catégories de véhicules', 'Catalogue des prestations', 'Grille tarifaire', 'Moyens de paiement', 'Activation de la station'].map((s, i) => (
                <div key={s} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface)' }}>
                  <span className="wg-muted grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold" style={{ background: 'var(--wg-surface-2)' }}>{i + 1}</span>
                  <span className="flex-1 font-medium">{s}</span>
                  <Badge tone="warn">À faire</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tarifs */}
      <section id="tarifs" className="scroll-mt-20 border-y py-16" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface)' }}>
        <div className="mx-auto max-w-7xl px-5">
          <div className="mb-8 text-center">
            <Badge tone="accent">Formules et tarifs</Badge>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight">Les prix de la base, affichés tels quels</h2>
            <p className="wg-muted mx-auto mt-2 max-w-2xl text-sm">Ces montants sont lus depuis la table des formules : la vitrine et la facturation partagent la même source.</p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => {
              const featured = plan.id === 'standard';
              return (
                <div key={plan.id} className={`wg-card relative flex flex-col p-6 ${featured ? 'border-sky-500 shadow-xl shadow-sky-500/10' : ''}`}>
                  {featured && <span className="absolute -top-3 left-6"><Badge tone="accent">Le plus choisi</Badge></span>}
                  <h3 className="text-lg font-extrabold">{plan.name}</h3>
                  <p className="wg-muted mt-1 text-xs">{plan.trial ? 'Pour ouvrir votre station' : 'Facturé chaque mois, en FCFA'}</p>
                  <p className="mt-5 text-3xl font-extrabold tracking-tight">{formatFCFA(plan.priceMonthly)}<span className="wg-muted text-sm font-medium"> / mois</span></p>
                  <div className="my-5 border-t" style={{ borderColor: 'var(--wg-border)' }} />
                  <ul className="flex-1 space-y-2.5 text-xs">
                    {plan.features.map((f) => <li key={f} className="flex items-start gap-2"><FiCheck className="mt-0.5 shrink-0 text-sky-400" /><span>{f}</span></li>)}
                    <li className="flex items-start gap-2"><FiCheck className="mt-0.5 shrink-0 text-sky-400" /><span>{plan.limits.stations} station(s) · {plan.limits.employees} comptes · {plan.limits.washesPerMonth.toLocaleString('fr-FR')} lavages/mois</span></li>
                  </ul>
                  <Link to="/inscription" className={`wg-btn mt-6 ${featured ? 'wg-btn-primary' : 'wg-btn-ghost'}`}>
                    {plan.trial ? 'Commencer l’essai' : `Choisir ${plan.name}`}
                  </Link>
                </div>
              );
            })}
          </div>
          <p className="wg-muted mt-5 text-center text-xs">Aucun prix de prestation n’est prédéfini : vos tarifs de lavage sont choisis par vous pendant la mise en route.</p>
        </div>
      </section>

      {/* Pas de témoignages */}
      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="wg-card flex flex-col items-center justify-center border-dashed py-10 text-center">
          <FiShield className="text-3xl text-sky-400 opacity-70" />
          <h3 className="mt-3 text-lg font-bold">Pas de témoignages — pour l’instant</h3>
          <p className="wg-muted mt-2 max-w-xl text-sm leading-relaxed">Des avis inventés seraient pires que pas d’avis du tout. Cette section accueillera les retours de vraies stations quand elles en donneront.</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 border-t py-16" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface)' }}>
        <div className="mx-auto max-w-3xl px-5">
          <div className="mb-8 text-center">
            <Badge tone="accent">Questions fréquentes</Badge>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight">Les réponses, sans détour</h2>
          </div>
          <div className="space-y-2">
            {FAQ.map((f, i) => (
              <div key={f.q} className="wg-card overflow-hidden !p-0">
                <button className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-semibold" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {f.q}<FiChevronDown className={`wg-muted shrink-0 transition ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && <p className="wg-muted border-t px-5 py-4 text-xs leading-relaxed" style={{ borderColor: 'var(--wg-border)' }}>{f.r}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto max-w-7xl px-5 py-16">
        <div className="wg-gradient relative overflow-hidden rounded-3xl px-6 py-12 text-center text-white sm:px-12">
          <div className="absolute -right-10 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <h2 className="relative text-2xl font-extrabold sm:text-3xl">Prêt à ouvrir votre station ?</h2>
          <p className="relative mx-auto mt-2 max-w-xl text-sm text-white/85">Inscription en deux temps, puis mise en route guidée. Aucune donnée d’exemple, aucun tarif imposé.</p>
          <Link to="/inscription" className="wg-btn relative mt-6 !bg-white !px-6 !py-3 !text-sky-700">Créer mon espace <FiArrowRight /></Link>
        </div>
      </section>

      <footer className="border-t py-8" style={{ borderColor: 'var(--wg-border)' }}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5">
          <Logo />
          <p className="wg-muted text-xs">© {new Date().getFullYear()} WashGuard · Interface en français · Montants en FCFA · Dates jj/mm/aaaa</p>
          <div className="flex gap-4 text-xs"><a href="#modules" className="wg-link">Fonctionnalités</a><a href="#tarifs" className="wg-link">Tarifs</a><Link to="/connexion" className="wg-link">Connexion</Link></div>
        </div>
      </footer>
    </div>
  );
}
