import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiAlertTriangle, FiArrowRight, FiAward, FiBarChart2, FiBox, FiCheck,
  FiChevronDown, FiClock, FiCreditCard, FiDollarSign, FiDroplet,
  FiFileText, FiLayers, FiLock, FiPhone, FiPieChart, FiPlay,
  FiPlus, FiRefreshCw, FiShield, FiSmartphone, FiTruck, FiUsers,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatFCFA } from '../lib/format';
import { DemoNotice } from '../components/DemoNotice';
import { PlanDetails } from '../components/PlanDetails';

interface FaqItem {
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    q: "WashGuard fonctionne-t-il avec les coupures d'électricité ou d'internet ?",
    a: "En mode connecté, les opérations nécessitent une connexion. Si une réponse est interrompue, vérifiez le résultat avant toute nouvelle saisie ; la synchronisation hors ligne n’est pas garantie.",
  },
  {
    q: 'Comment s’effectue le rapprochement Wave, Orange Money et MTN MoMo ?',
    a: 'Les paiements sont enregistrés par moyen de paiement ; les espèces alimentent la caisse et les canaux numériques restent distincts. Le rapprochement est saisi dans l’application, sans connexion automatique aux opérateurs.',
  },
  {
    q: 'Comment fonctionne le système d’alertes de stock ?',
    a: 'Les niveaux et les seuils disponibles sont affichés dans le module stock et signalés dans l’interface. Les simulations et l’édition locale des seuils sont réservées à la démonstration locale ; en mode connecté, les données sont relues depuis le serveur.',
  },
  {
    q: 'Les prix des prestations peuvent-ils être modifiés par les caissiers ?',
    a: 'Le catalogue est réservé aux comptes autorisés. Le serveur relit les tarifs et les fige sur la fiche ; le plafond de remise du caissier est contrôlé dans l’interface, mais pas encore par la base connectée.',
  },
  {
    q: 'Puis-je gérer plusieurs stations de lavage avec le même compte ?',
    a: 'La supervision multi-stations dépend des limites de votre formule et des permissions de votre compte. Les limites des formules disponibles sont indiquées dans la section tarifs.',
  },
  {
    q: 'Comment commencer avec WashGuard ?',
    a: 'Consultez les formules disponibles puis créez votre compte. La disponibilité et les limites de l’essai dépendent des formules affichées.',
  },
];

export default function Landing() {
  const { plans, plansError, dataSource, authKind } = useStore();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'lavages' | 'caisse' | 'stock' | 'commissions'>('caisse');
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-sky-500 selection:text-white">
      {dataSource === 'local' && authKind === 'local' && <DemoNotice />}
      {/* ── Top Announcement Banner ────────────────────────────────────────── */}
      <div className="border-b border-sky-500/20 bg-gradient-to-r from-sky-950 via-slate-900 to-indigo-950 px-4 py-2 text-center text-xs font-medium text-sky-200">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 px-2.5 py-0.5 font-bold text-sky-300">
          Nouveau
        </span>{' '}
        Suivi des stocks et rapprochement par moyen de paiement · Devise FCFA (XOF).
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
              Inscription
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
              Suivez votre caisse.{' '}
              <span className="bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-300 bg-clip-text text-transparent">
                Pilotez vos lavages, vos stocks et vos équipes.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-300 sm:text-xl">
              WashGuard vous aide à suivre votre station : fiches de lavage, enregistrement des encaissements
              (Wave, Orange Money, MTN MoMo, Espèces), calcul des commissions des laveurs,
              et <span className="font-semibold text-white">alertes stock</span> pour repérer les produits sous leur seuil.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                to="/inscription"
                className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-3.5 text-base font-bold text-white shadow-xl shadow-sky-500/25 transition hover:from-sky-400 hover:to-blue-500"
              >
                Créer mon compte
                <FiArrowRight size={18} />
              </Link>
              <Link
                to="/connexion"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-6 py-3.5 text-base font-semibold text-slate-200 backdrop-blur transition hover:bg-slate-800 hover:text-white"
              >
                <FiPlay size={16} className="text-sky-400" />
                Se connecter
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
                  Aperçu d’une station — données fictives
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Illustration
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
                  <p className="mt-1 text-xs text-slate-400">Comptage espèces (exemple fictif)</p>
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
                    <span className="text-xs text-sky-400">Exemple fictif</span>
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
                        Alerte affichée dans l’interface
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
            Enregistrez vos encaissements par moyen de paiement
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
                Numérotation automatique des fiches, immatriculation facultative, choix des prestations selon la catégorie et suivi des statuts et des affectations.
              </p>
            </div>

            {/* Pillar 2 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-emerald-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <FiLock size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">Caisse & Rapprochement</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Fond de caisse, séparation des espèces et des canaux numériques, prix figés et calcul de l’écart au comptage de clôture.
              </p>
            </div>

            {/* Pillar 3 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-amber-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-500/10 text-amber-400">
                <FiBox size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">Alertes de stock</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Consultez les niveaux et les seuils disponibles pour repérer les consommables à réapprovisionner.
              </p>
            </div>

            {/* Pillar 4 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 transition hover:border-indigo-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-500/10 text-indigo-400">
                <FiUsers size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">Commissions des Laveurs</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                Aperçu des commissions et relevés périodiques figés après validation par un responsable. Les réglages locaux ne configurent pas le serveur.
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
                Comparez les stations accessibles, leur chiffre d’affaires et leurs performances. Le résultat net dépend d’une attestation des coûts.
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
              Cliquez sur les onglets pour découvrir des exemples illustratifs avec des données fictives.
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
                3. File de Lavages & Fiche
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
                    <FiLock size={14} /> Suivi de caisse
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-white">
                    Calcul de l’écart au comptage
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Chaque matin, le caissier ouvre la caisse avec son fond initial. Au cours de la journée,
                    les encaissements espèces s'additionnent et les sorties de dépenses autorisées se déduisent.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-emerald-400" />
                      <span><strong>Solde théorique</strong> = fond + mouvements de caisse espèces</span>
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
                    <FiAlertTriangle size={14} /> Alertes de stock
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-white">
                    Repérez les produits sous leur seuil
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Le bandeau signale les produits sous leur seuil à partir des données disponibles. En mode connecté, les données proviennent du serveur ; les simulations et l’édition locale des seuils sont réservées à la démonstration locale.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-amber-400" />
                      <span>Suivi des consommations enregistrées par lavage</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-amber-400" />
                      <span>Seuil d’alerte affiché par produit (litres, bidons, unités)</span>
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
                    File d'attente et suivi du contrôle qualité
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Chaque fiche regroupe les prestations choisies, les affectations et, si nécessaire, un poste. Le contrôle qualité précède la livraison.
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
                      <span>Validation du contrôle qualité avant restitution</span>
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
                    <span>Exemple de fiche #LAV-2026-042</span>
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
                    Commissions calculées et relevés de période
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Consultez un aperçu des commissions et préparez des relevés périodiques. En mode connecté, les relevés utilisent les données de barème du serveur ; les réglages locaux ne les modifient pas.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-indigo-400" />
                      <span>Barème de station ou contrat employé côté serveur</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-indigo-400" />
                      <span>Relevé périodique figé après validation</span>
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
Essai de 14 jours avec tous les modules. Standard et Premium nécessitent une demande puis une validation administrateur : une validation anticipée met fin à l’essai immédiatement. Aucun paiement automatique. Montants indicatifs en FCFA, à valider commercialement.
            </p>
          </div>

          {plansError ? (
            <div role="alert" className="mt-14 rounded-2xl border border-amber-500/30 bg-slate-900/60 p-6 text-center">
              <p className="font-bold text-white">Formules et tarifs indisponibles</p>
              <p className="mt-2 text-sm text-slate-400">Aucun prix local n’est présenté à la place des tarifs indisponibles. Veuillez réessayer plus tard.</p>
            </div>
          ) : plans.length === 0 ? (
            <p role="status" className="mt-14 text-center text-sm text-slate-400">Chargement des formules…</p>
          ) : (
          <div className="mt-14 grid gap-8 lg:grid-cols-3">
            {plans.filter((plan) => ['essai', 'standard', 'premium'].includes(plan.id)).map((plan) => {
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
                      Formule Standard
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
                      {plan.id === 'essai' ? '14 jours · tous les modules' : 'Tarif mensuel indicatif · activation sur validation'}
                    </p>

                    <div className="my-6 border-t border-slate-800" />

                    <div className="text-xs font-semibold text-slate-300">
                      <p className="font-bold text-sky-400">
                        {plan.limits.stations} station(s) · {plan.limits.employees} comptes actifs · {plan.limits.washesPerMonth.toLocaleString('fr-FR')} lavages/mois
                      </p>
                      <p className="mt-1 text-slate-400">Le propriétaire compte dans les comptes actifs.</p>
                    </div>

                    <div className="mt-6 text-slate-300"><PlanDetails plan={plan} /></div>
                  </div>

                  <div className="mt-8">
                    <Link
                      to={`/inscription?plan=${encodeURIComponent(plan.id)}`}
                      className={`block w-full rounded-xl py-3 text-center text-sm font-bold transition ${
                        isPopular
                          ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25 hover:bg-sky-400'
                          : 'border border-slate-700 bg-slate-800 text-white hover:bg-slate-700'
                      }`}
                    >
                      {plan.id === 'essai' ? 'Commencer l’essai' : `Choisir ${plan.name}`}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          )}
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
            Suivez vos lavages, vos encaissements et vos équipes au même endroit.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              to="/inscription"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-7 py-3.5 text-base font-bold text-white shadow-xl shadow-sky-500/25 transition hover:from-sky-400 hover:to-blue-500"
            >
              Créer mon espace
              <FiArrowRight size={18} />
            </Link>
            <Link
              to="/connexion"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-6 py-3.5 text-base font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              Se connecter
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
            <p>© {new Date().getFullYear()} WashGuard. Tous droits réservés.</p>
            <p>Devise affichée : Francs CFA (XOF).</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
