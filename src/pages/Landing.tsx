import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiAlertTriangle, FiArrowRight, FiAward, FiBarChart2, FiBox, FiCheck,
  FiChevronDown, FiClock, FiCreditCard, FiDollarSign, FiDroplet,
  FiFileText, FiLayers, FiLock, FiPhone, FiPieChart, FiPlay,
  FiPlus, FiRefreshCw, FiShield, FiSmartphone, FiStar, FiTruck, FiUsers,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatFCFA } from '../lib/format';

interface FaqItem {
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    q: "WashGuard fonctionne-t-il avec les coupures d'électricité ou d'internet ?",
    a: "Oui. WashGuard fonctionne sur smartphone et tablette même en cas d'instabilité réseau grâce à son architecture moderne. Dès que la connexion revient, les opérations sont resynchronisées automatiquement sans aucune perte de données.",
  },
  {
    q: 'Comment s’effectue le rapprochement Wave, Orange Money et MTN MoMo ?',
    a: 'Chaque paiement Mobile Money est enregistré avec sa référence de transaction. Dans le module de caisse, les espèces physiques et les comptes Mobile Money sont isolés dans des relevés distincts : vous ne confondez plus le liquide présent dans le tiroir avec les soldes numériques.',
  },
  {
    q: 'Comment fonctionne le système d’alertes de stock en temps réel ?',
    a: 'Vous définissez dans les paramètres un seuil critique pour chaque produit (par exemple 10 Litres pour le savon/shampoing, 5 Litres pour la cire lustrante). Dès qu’une consommation fait descendre le stock en dessous de ce seuil, une alerte visuelle immédiate s’affiche sur le tableau de bord et dans la barre de notification.',
  },
  {
    q: 'Les prix des prestations peuvent-ils être modifiés par les caissiers ?',
    a: 'Non. Pour éliminer tout risque de fraude ou de surfacturation occulte, les prix unitaires de chaque prestation sont gelés au moment de la création du ticket. Les remises caissier sont strictement plafonnées selon la limite fixée par le propriétaire.',
  },
  {
    q: 'Puis-je gérer plusieurs stations de lavage avec le même compte ?',
    a: 'Absolument. La formule Réseau permet au propriétaire de superviser jusqu’à 5 stations en direct : chiffre d’affaires consolidé, rentabilité par site, comparaison des volumes de lavage et fiches de commissions des laveurs.',
  },
  {
    q: 'Comment tester WashGuard sans engagement ?',
    a: 'Vous bénéficiez d’un essai gratuit de 14 jours, sans carte bancaire requise. Vous pouvez également cliquer sur « Découvrir la démo » pour tester immédiatement l’interface avec des données réalistes.',
  },
];

export default function Landing() {
  const { plans } = useStore();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'lavages' | 'caisse' | 'stock' | 'commissions'>('caisse');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

  // Tarifs par défaut conformes au playbook (15 000 FCFA standard, 35 000 FCFA réseau)
  const displayPlans = plans.length > 0 ? plans : [
    {
      id: 'essai',
      name: 'Essai Gratuit',
      priceMonthly: 0,
      trial: true,
      limits: { stations: 1, employees: 3, washesPerMonth: 100 },
      features: [
        '1 station incluse',
        'Jusqu’à 3 comptes collaborateurs',
        '100 lavages / mois',
        'Encaissement Espèces & Mobile Money',
        'Support technique par email & WhatsApp',
      ],
    },
    {
      id: 'standard',
      name: 'Formule Standard',
      priceMonthly: 15000,
      trial: false,
      limits: { stations: 1, employees: 10, washesPerMonth: 1000 },
      features: [
        '1 station opérationnelle',
        'Jusqu’à 10 employés (gérant, caissiers, laveurs)',
        '1 000 lavages / mois',
        'Rapprochement de caisse & écart théorique',
        'Alertes stock en temps réel (savon, cire)',
        'Calcul automatique des commissions laveurs',
        'Export CSV et rapports de rentabilité',
      ],
    },
    {
      id: 'reseau',
      name: 'Formule Réseau',
      priceMonthly: 35000,
      trial: false,
      limits: { stations: 5, employees: 50, washesPerMonth: 10000 },
      features: [
        'Jusqu’à 5 stations de lavage',
        '50 comptes collaborateurs',
        'Lavages illimités',
        'Tableau de bord consolidé multi-stations',
        'Gestion des flottes d’entreprises & facturation',
        'Cartes de fidélité clients & programmes à points',
        'Audit logs complets & assistance prioritaire 7j/7',
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-sky-500 selection:text-white">
      {/* ── Top Announcement Banner ────────────────────────────────────────── */}
      <div className="border-b border-sky-500/20 bg-gradient-to-r from-sky-950 via-slate-900 to-indigo-950 px-4 py-2 text-center text-xs font-medium text-sky-200">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 px-2.5 py-0.5 font-bold text-sky-300">
          Nouveau
        </span>{' '}
        Système d'alertes stock en temps réel & Rapprochement Wave / Orange Money inclus · Devises FCFA (XOF).
      </div>

      {/* ── Main Navigation ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-400 via-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/25">
              <FiDroplet size={22} className="stroke-[2.5]" />
            </span>
            <div className="leading-tight">
              <span className="text-lg font-black tracking-tight text-white">
                Wash<span className="text-sky-400">Guard</span>
              </span>
              <span className="block text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                ERP Station & Caisse
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-300 md:flex">
            <a href="#fonctionnalites" className="transition hover:text-white">Fonctionnalités</a>
            <a href="#caisse-stock" className="transition hover:text-white">Caisse & Stock</a>
            <a href="#tarifs" className="transition hover:text-white">Tarifs</a>
            <a href="#temoignages" className="transition hover:text-white">Témoignages</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to="/connexion"
              className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              Connexion
            </Link>
            <Link
              to="/inscription"
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Essai gratuit
              <FiArrowRight size={15} />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero Section ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28">
        <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-[140px]" />
        <div className="pointer-events-none absolute top-1/2 right-0 -z-10 h-[400px] w-[500px] rounded-full bg-blue-600/10 blur-[130px]" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3.5 py-1.5 text-xs font-semibold text-sky-300">
              <FiShield className="text-sky-400" />
              ERP SaaS Conçu pour les Stations de Lavage d'Afrique de l'Ouest & Centrale
            </div>

            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Fini le coulage de caisse.{' '}
              <span className="bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-300 bg-clip-text text-transparent">
                Pilotez vos lavages, vos stocks et vos équipes.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-300 sm:text-xl">
              WashGuard digitalise chaque étape de votre station : ticket de lavage, encaissements
              sécurisés (Wave, Orange Money, MTN MoMo, Espèces), calcul automatique des commissions des laveurs,
              et <span className="font-semibold text-white">alertes stock en temps réel</span> pour ne plus jamais manquer de savon ou de cire.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                to="/inscription"
                className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-3.5 text-base font-bold text-white shadow-xl shadow-sky-500/25 transition hover:from-sky-400 hover:to-blue-500"
              >
                Démarrer mon essai de 14 jours
                <FiArrowRight size={18} />
              </Link>
              <Link
                to="/connexion"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-6 py-3.5 text-base font-semibold text-slate-200 backdrop-blur transition hover:bg-slate-800 hover:text-white"
              >
                <FiPlay size={16} className="text-sky-400" />
                Tester la démo instantanée
              </Link>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <FiCheck className="text-emerald-400" /> Sans carte bancaire
              </span>
              <span className="flex items-center gap-1.5">
                <FiCheck className="text-emerald-400" /> Tarification 100% en FCFA
              </span>
              <span className="flex items-center gap-1.5">
                <FiCheck className="text-emerald-400" /> Compatible Téléphone & Ordinateur
              </span>
            </div>
          </div>

          {/* ── Hero Live Preview Widget (Interactive Dashboard Teaser) ────── */}
          <div className="relative mt-14 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-2xl shadow-black/80 backdrop-blur-xl">
            {/* Window Topbar */}
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-500/80" />
                <span className="h-3 w-3 rounded-full bg-amber-500/80" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
                <span className="ml-2 font-mono text-xs text-slate-400">
                  app.washguard.ci / Station Étoile Auto — Cocody Angré
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Système en direct
              </div>
            </div>

            {/* Dashboard Mockup Content */}
            <div className="p-5 sm:p-7">
              {/* Top Metrics Row */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase">Chiffre d’affaires du jour</p>
                  <p className="mt-1.5 text-2xl font-black text-white">142 500 FCFA</p>
                  <p className="mt-1 text-xs text-emerald-400">↑ +18% vs moyenne 7 jours</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase">Lavages aujourd’hui</p>
                  <p className="mt-1.5 text-2xl font-black text-white">38 véhicules</p>
                  <p className="mt-1 text-xs text-slate-400">32 livrés · 4 en cours · 2 en attente</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase">Contrôle de Caisse</p>
                  <p className="mt-1.5 text-2xl font-black text-emerald-400">0 FCFA d'écart</p>
                  <p className="mt-1 text-xs text-slate-400">Espèces physiques + Wave + MoMo</p>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-amber-300 uppercase">Alerte Stock Critique</p>
                    <FiAlertTriangle className="text-amber-400" size={16} />
                  </div>
                  <p className="mt-1.5 text-xl font-bold text-amber-200">2 produits bas</p>
                  <p className="mt-1 text-xs text-amber-300/80">Savon (4L / min 10L) · Cire (1L)</p>
                </div>
              </div>

              {/* Live Bays & Real-time Operations Showcase */}
              <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 lg:col-span-2">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Postes de lavage en activité</h3>
                    <span className="text-xs text-sky-400">Mise à jour instantanée</span>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-slate-900/60 p-3 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="rounded bg-sky-500/20 px-2 py-1 font-mono font-bold text-sky-300">
                          LAV-2026-042
                        </span>
                        <div>
                          <p className="font-bold text-white">Toyota Land Cruiser (4x4) · 1289 JJ 01</p>
                          <p className="text-slate-400">Lavage complet + Lustrage cire · Laveur : Ibrahim K.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-white">7 000 FCFA</span>
                        <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 font-bold text-blue-300">
                          En cours (85%)
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-slate-900/60 p-3 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="rounded bg-emerald-500/20 px-2 py-1 font-mono font-bold text-emerald-300">
                          LAV-2026-041
                        </span>
                        <div>
                          <p className="font-bold text-white">Mercedes Classe C (Berline) · 8845 HG 01</p>
                          <p className="text-slate-400">Extérieur + Nettoyage jantes · Laveur : Moussa T.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-white">4 000 FCFA</span>
                        <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-bold text-emerald-300">
                          Prêt · Contrôle validé
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stock Alert Real-time card */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">État des consommables</h3>
                    <FiBox className="text-slate-400" />
                  </div>
                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="flex justify-between font-medium">
                        <span className="text-amber-300">Shampoing moussant carrosserie</span>
                        <span className="font-bold text-amber-400">4 Litres (Seuil : 10L)</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                        <div className="h-1.5 rounded-full bg-amber-400" style={{ width: '40%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between font-medium">
                        <span className="text-red-400">Cire lustrante protectrice</span>
                        <span className="font-bold text-red-400">1 Litre (Seuil : 5L)</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                        <div className="h-1.5 rounded-full bg-red-400" style={{ width: '20%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between font-medium">
                        <span className="text-slate-300">Dégraissant jantes actif</span>
                        <span className="font-bold text-emerald-400">18 Litres (Seuil : 8L)</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                        <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: '85%' }} />
                      </div>
                    </div>
                    <div className="pt-2 text-center">
                      <span className="inline-block rounded-lg bg-sky-500/20 px-3 py-1 font-semibold text-sky-300">
                        Notification automatique au gérant
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Payment Methods Trust Bar ────────────────────────────────────── */}
      <section className="border-y border-slate-800/80 bg-slate-900/50 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Encaissez tous les moyens de paiement locaux sans friction
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-8 sm:gap-14 text-sm font-bold text-slate-300">
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
              <span>Wave Côte d’Ivoire</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
              <span>Orange Money CI</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
              <span>MTN Mobile Money</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span>Espèces physiques</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />
              <span>Carte bancaire & Virement</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6 Core Pillars ──────────────────────────────────────────────── */}
      <section id="fonctionnalites" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-xs font-bold tracking-widest text-sky-400 uppercase">
              Modules Métier Intégrés
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Tout ce dont votre station a besoin, réuni dans un seul outil.
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">
              Chaque fonctionnalité a été conçue pour résoudre les défis concrets rencontrés par les
              propriétaires et gérants de station de lavage sur le terrain.
            </p>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {/* Pillar 1 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-sky-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-sky-500/10 text-sky-400">
                <FiTruck size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">File d’attente & Prise en charge</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Numérotation automatique des tickets, immatriculation du véhicule, choix des prestations selon la catégorie (Berline, 4x4, Moto) et suivi en direct sur chaque poste.
              </p>
            </div>

            {/* Pillar 2 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-emerald-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <FiLock size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">Caisse Anti-Fraude & Rapprochement</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Fond initial obligatoire, double journal étanche Espèces / Mobile Money, gel des prix unitaires et calcul instantané de l'écart théorique lors du comptage de clôture.
              </p>
            </div>

            {/* Pillar 3 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-amber-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-500/10 text-amber-400">
                <FiBox size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">Alertes Stock en Temps Réel</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Définissez les seuils critiques pour vos consommables (savon, cire, dégraissant, microfibres). Recevez des alertes visuelles immédiates pour commander avant la rupture.
              </p>
            </div>

            {/* Pillar 4 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-indigo-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-500/10 text-indigo-400">
                <FiUsers size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">Commissions des Laveurs</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Barème personnalisé par laveur ou par prestation. Relevés périodiques figés et validés par le gérant pour des fiches de paie transparentes et sans litiges.
              </p>
            </div>

            {/* Pillar 5 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-purple-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-purple-500/10 text-purple-400">
                <FiAward size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">CRM, Flottes & Cartes de Fidélité</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Gestion des contrats de flottes professionnelles (entreprises, taxis, VTC) avec paiement différé, et programme de fidélité à points pour récompenser les habitués.
              </p>
            </div>

            {/* Pillar 6 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-rose-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-rose-500/10 text-rose-400">
                <FiBarChart2 size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">Multi-Stations & Rentabilité Nette</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Supervisez toutes vos stations depuis votre téléphone : chiffre d’affaires consolidé, comparaison des performances et rapport comptable distinguant charges et marges.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Interactive Workflow Demonstrator ───────────────────────────── */}
      <section id="caisse-stock" className="border-t border-slate-800/80 bg-slate-900/30 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-xs font-bold tracking-widest text-sky-400 uppercase">
              Expérience Interactive
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Découvrez la simplicité d'utilisation au quotidien
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">
              Cliquez sur les différents onglets pour voir comment WashGuard sécurise chaque opération.
            </p>
          </div>

          <div className="mt-10 flex justify-center">
            <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('caisse')}
                className={`rounded-lg px-4 py-2 transition ${activeTab === 'caisse' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                1. Caisse & Rapprochement
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('stock')}
                className={`rounded-lg px-4 py-2 transition ${activeTab === 'stock' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                2. Alertes Stock Critiques
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('lavages')}
                className={`rounded-lg px-4 py-2 transition ${activeTab === 'lavages' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                3. File de Lavages & Ticket
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('commissions')}
                className={`rounded-lg px-4 py-2 transition ${activeTab === 'commissions' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                4. Commissions Laveurs
              </button>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-6 sm:p-10">
            {activeTab === 'caisse' && (
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">
                    <FiLock size={14} /> Sécurité financière absolue
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-white">
                    Zéro coulage : calcul automatique de l'écart au comptage
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Chaque matin, le caissier ouvre la caisse avec son fond initial. Au cours de la journée,
                    les encaissements espèces s'additionnent et les sorties de dépenses autorisées se déduisent.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-emerald-400" />
                      <span><strong>Solde théorique garanti</strong> = Fond + Espèces encaissées − Dépenses payées</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-emerald-400" />
                      <span>Rapprochement Wave et Orange Money <strong>strictement séparé</strong> des billets de banque</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-emerald-400" />
                      <span>Clôture immuable : relevé figé avec horodatage et identité du caissier</span>
                    </li>
                  </ul>
                  <div className="mt-6">
                    <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-bold text-sky-400 hover:text-sky-300">
                      Tester le module de caisse <FiArrowRight />
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 font-mono text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="font-bold text-slate-300">Session de caisse #CS-092</span>
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">CONFORME</span>
                  </div>
                  <div className="mt-3 space-y-2 text-slate-300">
                    <div className="flex justify-between"><span>Fond initial (08h00) :</span><span className="font-bold text-white">25 000 FCFA</span></div>
                    <div className="flex justify-between"><span>+ Encaissements Espèces :</span><span className="font-bold text-emerald-400">+ 85 000 FCFA</span></div>
                    <div className="flex justify-between"><span>- Sorties dépenses autorisées :</span><span className="font-bold text-red-400">- 10 000 FCFA</span></div>
                    <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-sky-300">
                      <span>Solde théorique attendu :</span><span>100 000 FCFA</span>
                    </div>
                    <div className="flex justify-between font-bold text-white">
                      <span>Montant physique compté :</span><span>100 000 FCFA</span>
                    </div>
                    <div className="rounded-lg bg-emerald-500/10 p-2.5 text-center font-bold text-emerald-400">
                      Écart de clôture : 0 FCFA (Équilibré)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'stock' && (
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-400">
                    <FiAlertTriangle size={14} /> Alertes stock en temps réel
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-white">
                    Ne tombez plus jamais en panne de savon ou de cire
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Configurez le seuil critique dans les paramètres pour chaque consommable de lavage. Dès qu'un produit descend sous sa limite, le bandeau d'alerte et la cloche de notification vous préviennent en direct.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-amber-400" />
                      <span>Suivi automatique des consommations par lavage effectué</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-amber-400" />
                      <span>Seuil d'alerte paramétrable par produit (Litres, Bidons, Unités)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-amber-400" />
                      <span>Valorisation du stock au coût moyen pondéré (PUMP)</span>
                    </li>
                  </ul>
                  <div className="mt-6">
                    <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-bold text-sky-400 hover:text-sky-300">
                      Voir la gestion des stocks <FiArrowRight />
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 text-xs">
                  <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="font-bold text-white">Niveaux de stock critiques</span>
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      2 alertes actives
                    </span>
                  </div>
                  <div className="space-y-4">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="flex items-center justify-between font-bold text-amber-200">
                        <span>Shampoing moussant carrosserie</span>
                        <span>4 Litres restants</span>
                      </div>
                      <p className="mt-1 text-[11px] text-amber-300/80">Seuil critique : 10 Litres · Action : Commander 25L</p>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800">
                        <div className="h-1.5 rounded-full bg-amber-400" style={{ width: '40%' }} />
                      </div>
                    </div>

                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                      <div className="flex items-center justify-between font-bold text-red-200">
                        <span>Cire lustrante protectrice</span>
                        <span>1 Litre restant</span>
                      </div>
                      <p className="mt-1 text-[11px] text-red-300/80">Seuil critique : 5 Litres · Action : Rupture imminente</p>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800">
                        <div className="h-1.5 rounded-full bg-red-400" style={{ width: '20%' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'lavages' && (
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 px-3 py-1 text-xs font-bold text-sky-400">
                    <FiDroplet size={14} /> Fluidité opérationnelle
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-white">
                    File d'attente digitale et contrôle qualité en 6 points
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Fini les confusions sur l'ordre de passage ou les réclamations clients. Chaque véhicule reçoit son ticket avec ses prestations choisies et son poste de lavage attitré.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-sky-400" />
                      <span>Grille tarifaire par catégorie : Moto, Berline, SUV, 4x4, Minibus</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-sky-400" />
                      <span>Affectation nominative des laveurs pour chaque tâche</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-sky-400" />
                      <span>Validation du contrôle qualité (jantes, vitres, intérieur) avant restitution</span>
                    </li>
                  </ul>
                  <div className="mt-6">
                    <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-bold text-sky-400 hover:text-sky-300">
                      Explorer la file de lavage <FiArrowRight />
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 font-bold text-white">
                    <span>Ticket de lavage #LAV-2026-042</span>
                    <span className="text-sky-400">Poste 1 (Extérieur)</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-between text-slate-300">
                      <span>Véhicule :</span><span className="font-bold text-white">Hyundai Tucson · 4512 KM 01</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Prestation :</span><span>Lavage Complet + Moteur</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Laveur affecté :</span><span className="font-semibold text-sky-300">Koffi Serge</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Moyen de paiement :</span><span className="font-semibold text-emerald-400">Wave (Trans. #WAV-9812)</span>
                    </div>
                    <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-white">
                      <span>Total réglé :</span><span className="text-emerald-400">6 000 FCFA</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'commissions' && (
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-bold text-indigo-400">
                    <FiUsers size={14} /> Motivation & Transparence
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-white">
                    Commissions calculées automatiquement, zéro contestation
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Motivez votre personnel avec des commissions claires et instantanées. Définissez le pourcentage global ou individuel (ex: 20% ou 25%). Les laveurs savent exactement ce qu'ils gagnent chaque jour.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-indigo-400" />
                      <span>Barème paramétrable par station ou par employé</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-indigo-400" />
                      <span>Relevé de paie périodique figé et infalsifiable</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-indigo-400" />
                      <span>Enregistrement du règlement avec référence de paiement</span>
                    </li>
                  </ul>
                  <div className="mt-6">
                    <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-bold text-sky-400 hover:text-sky-300">
                      Tester le calcul des commissions <FiArrowRight />
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 font-bold text-white">
                    <span>Relevé Hebdomadaire · Laveurs</span>
                    <span className="text-emerald-400">Période validée</span>
                  </div>
                  <div className="mt-3 divide-y divide-slate-800">
                    <div className="py-2 flex justify-between items-center">
                      <div>
                        <p className="font-bold text-white">Moussa Traoré</p>
                        <p className="text-[11px] text-slate-400">42 lavages · Base : 168 000 FCFA (20%)</p>
                      </div>
                      <span className="font-bold text-emerald-400">33 600 FCFA</span>
                    </div>
                    <div className="py-2 flex justify-between items-center">
                      <div>
                        <p className="font-bold text-white">Ibrahim Koné</p>
                        <p className="text-[11px] text-slate-400">38 lavages · Base : 152 000 FCFA (20%)</p>
                      </div>
                      <span className="font-bold text-emerald-400">30 400 FCFA</span>
                    </div>
                    <div className="py-2 flex justify-between items-center">
                      <div>
                        <p className="font-bold text-white">Serge Kouadio</p>
                        <p className="text-[11px] text-slate-400">29 lavages · Base : 116 000 FCFA (20%)</p>
                      </div>
                      <span className="font-bold text-emerald-400">23 200 FCFA</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Pricing Section (Formules en FCFA) ─────────────────────────── */}
      <section id="tarifs" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-xs font-bold tracking-widest text-sky-400 uppercase">
              Tarification Transparente
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Des formules adaptées à chaque taille de station
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">
              Des montants clairs en Francs CFA (XOF). Sans frais d'installation cachés. Sans engagement.
            </p>
          </div>

          <div className="mt-14 grid gap-8 lg:grid-cols-3">
            {displayPlans.map((plan) => {
              const isPopular = plan.id === 'standard';
              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col justify-between rounded-2xl border p-8 transition ${
                    isPopular
                      ? 'border-sky-500 bg-gradient-to-b from-sky-950/40 via-slate-900 to-slate-950 shadow-2xl shadow-sky-500/20'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-1 text-xs font-bold text-white shadow-md">
                      Recommandé · Station Unique
                    </div>
                  )}

                  <div>
                    <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-white">
                        {plan.priceMonthly === 0 ? 'Gratuit' : formatFCFA(plan.priceMonthly)}
                      </span>
                      {plan.priceMonthly > 0 && (
                        <span className="text-sm font-semibold text-slate-400">/ mois</span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {plan.trial ? '14 jours d’essai sans carte bancaire' : 'Facturation mensuelle sans engagement'}
                    </p>

                    <div className="my-6 border-t border-slate-800" />

                    <div className="text-xs font-semibold text-slate-300">
                      <p className="font-bold text-sky-400">
                        {plan.limits.stations} station(s) · {plan.limits.employees} collaborateur(s) · {plan.limits.washesPerMonth.toLocaleString('fr-FR')} lavages/mois
                      </p>
                    </div>

                    <ul className="mt-6 space-y-3 text-xs text-slate-300">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <FiCheck className="mt-0.5 shrink-0 text-sky-400" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-8">
                    <Link
                      to="/inscription"
                      className={`block w-full rounded-xl py-3 text-center text-sm font-bold transition ${
                        isPopular
                          ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25 hover:bg-sky-400'
                          : 'border border-slate-700 bg-slate-800 text-white hover:bg-slate-700'
                      }`}
                    >
                      {plan.trial ? 'Démarrer l’essai gratuit' : `Choisir la formule ${plan.name}`}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-8 text-center text-xs text-slate-400">
            Besoin d’un déploiement sur plus de 10 stations ou d’un accompagnement sur mesure ?{' '}
            <a href="https://wa.me/2250700000000" target="_blank" rel="noopener noreferrer" className="text-sky-400 underline">
              Contactez notre équipe par WhatsApp
            </a>.
          </p>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      <section id="temoignages" className="border-t border-slate-800/80 bg-slate-900/40 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-xs font-bold tracking-widest text-sky-400 uppercase">
              Témoignages Clients
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Adopté par les gérants de station les plus exigeants
            </p>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 text-sm">
              <div className="flex gap-1 text-amber-400">
                {[...Array(5)].map((_, i) => <FiStar key={i} className="fill-amber-400" size={14} />)}
              </div>
              <p className="mt-4 italic text-slate-300">
                « Avant WashGuard, j’avais systématiquement des écarts de caisse de 10 000 à 15 000 FCFA par jour en fin de soirée. Avec le contrôle obligatoire et le calcul d'écart automatique, le coulage est tombé à zéro dès la première semaine. »
              </p>
              <div className="mt-6 border-t border-slate-800 pt-4">
                <p className="font-bold text-white">M. Bakayoko Souleymane</p>
                <p className="text-xs text-slate-400">Gérant de Prestige Auto Wash · Marcory Zone 4</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 text-sm">
              <div className="flex gap-1 text-amber-400">
                {[...Array(5)].map((_, i) => <FiStar key={i} className="fill-amber-400" size={14} />)}
              </div>
              <p className="mt-4 italic text-slate-300">
                « Les alertes stock en temps réel nous ont sauvé plusieurs samedis ! Avant, on se rendait compte qu'il n'y avait plus de shampoing moussant en plein milieu de l'affluence. Maintenant, on reçoit l'alerte bien avant d'atteindre le seuil critique. »
              </p>
              <div className="mt-6 border-t border-slate-800 pt-4">
                <p className="font-bold text-white">Mme Kouamé Affoué</p>
                <p className="text-xs text-slate-400">Propriétaire de 3 stations · Cocody Angré & Riviera</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 text-sm">
              <div className="flex gap-1 text-amber-400">
                {[...Array(5)].map((_, i) => <FiStar key={i} className="fill-amber-400" size={14} />)}
              </div>
              <p className="mt-4 italic text-slate-300">
                « Le calcul automatique des commissions des laveurs a transformé l'ambiance dans la station. Les gars voient leurs points et leurs sous en direct. Plus aucune dispute le samedi soir au moment du partage ! »
              </p>
              <div className="mt-6 border-t border-slate-800 pt-4">
                <p className="font-bold text-white">M. Diabaté Lassina</p>
                <p className="text-xs text-slate-400">Responsable d'exploitation · Yopougon Sable</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ Section ─────────────────────────────────────────────────── */}
      <section id="faq" className="py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-xs font-bold tracking-widest text-sky-400 uppercase">
              Questions Fréquentes
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Tout ce que vous devez savoir avant de commencer
            </p>
          </div>

          <div className="mt-12 space-y-4">
            {FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div
                  key={index}
                  className="rounded-xl border border-slate-800 bg-slate-900/60 transition hover:border-slate-700"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    className="flex w-full items-center justify-between p-5 text-left text-sm font-bold text-white"
                  >
                    <span>{faq.q}</span>
                    <FiChevronDown
                      size={18}
                      className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-sky-400' : ''}`}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-800 px-5 pt-3 pb-5 text-xs leading-relaxed text-slate-300">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Final Call to Action ────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-slate-800 bg-gradient-to-b from-sky-950/40 via-slate-950 to-slate-950 py-20 text-center">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-black text-white sm:text-4xl lg:text-5xl">
            Prêt à transformer la gestion de votre station de lavage ?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-300">
            Rejoignez les stations qui ont éliminé les pertes de caisse et boosté leur rentabilité avec WashGuard.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              to="/inscription"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-7 py-3.5 text-base font-bold text-white shadow-xl shadow-sky-500/25 transition hover:from-sky-400 hover:to-blue-500"
            >
              Créer mon espace gratuitement
              <FiArrowRight size={18} />
            </Link>
            <Link
              to="/connexion"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-6 py-3.5 text-base font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              Accéder à la démo
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-800 bg-slate-950 py-12 text-xs text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500 text-white">
                <FiDroplet size={18} />
              </span>
              <span className="text-base font-black text-white">
                Wash<span className="text-sky-400">Guard</span>
              </span>
              <span className="ml-2 text-slate-500">· ERP Station & Caisse</span>
            </div>

            <div className="flex flex-wrap gap-6 font-medium text-slate-300">
              <Link to="/connexion" className="hover:text-white">Connexion</Link>
              <Link to="/inscription" className="hover:text-white">Inscription</Link>
              <a href="#fonctionnalites" className="hover:text-white">Fonctionnalités</a>
              <a href="#tarifs" className="hover:text-white">Tarifs (FCFA)</a>
              <a href="#faq" className="hover:text-white">FAQ</a>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between border-t border-slate-800/80 pt-6 text-[11px] text-slate-500">
            <p>© {new Date().getFullYear()} WashGuard Technologies. Tous droits réservés. Abidjan, Côte d’Ivoire.</p>
            <p>Devise réglementaire : Francs CFA (XOF) · Hébergement sécurisé Supabase & Cloud.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
