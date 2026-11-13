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
    a: 'Définissez un seuil critique par consommable dans Paramètres ou Stocks & achats. Dès que le stock disponible atteint ou passe sous ce seuil, une alerte apparaît dans le tableau de bord et la cloche en temps réel.',
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
  const { plans, plansError } = useStore();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'lavages' | 'caisse' | 'stock' | 'commissions'>('caisse');
  return (
    <div className="min-h-screen bg-base-200 text-base-content antialiased selection:bg-primary selection:text-primary-content">
      {/* ── Top Announcement Banner ────────────────────────────────────────── */}
      <div className="border-b border-primary/20 bg-linear-to-r from-base-200 via-base-200 to-base-300 px-4 py-2 text-center text-xs font-medium text-primary">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-0.5 font-bold text-primary">
          Nouveau
        </span>{' '}
        Suivi des stocks et rapprochement par moyen de paiement · Devise FCFA (XOF).
      </div>

      {/* ── Main Navigation ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-base-300/80 bg-base-200/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-primary via-primary to-secondary text-primary-content shadow-e2">
              <FiDroplet size={22} className="stroke-[2.5]" />
            </span>
            <div className="leading-tight">
              <span className="text-lg font-black tracking-tight text-base-content">
                Wash<span className="text-primary">Guard</span>
              </span>
              <span className="block text-[10px] font-semibold tracking-wider text-base-content/60 uppercase">
                ERP Station & Caisse
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-base-content/80 md:flex">
            <a href="#fonctionnalites" className="transition hover:text-base-content">Fonctionnalités</a>
            <a href="#caisse-stock" className="transition hover:text-base-content">Caisse & Stock</a>
            <a href="#tarifs" className="transition hover:text-base-content">Tarifs</a>
            <a href="#faq" className="transition hover:text-base-content">FAQ</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to="/connexion"
              className="rounded-lg px-3.5 py-2 text-sm font-semibold text-base-content/90 transition hover:bg-base-200 hover:text-base-content"
            >
              Connexion
            </Link>
            <Link
              to="/inscription"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-content shadow-e2 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-base-100"
            >
              Inscription
              <FiArrowRight size={15} />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero Section ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28">
        <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/10 blur-[140px]" />
        <div className="pointer-events-none absolute top-1/2 right-0 -z-10 h-[400px] w-[500px] rounded-full bg-secondary/10 blur-[130px]" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
              <FiShield className="text-primary" />
              ERP SaaS Conçu pour les Stations de Lavage d'Afrique de l'Ouest & Centrale
            </div>

            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-base-content sm:text-5xl lg:text-6xl">
              Suivez votre caisse.{' '}
              <span className="bg-linear-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                Pilotez vos lavages, vos stocks et vos équipes.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-base-content/80 sm:text-xl">
              WashGuard vous aide à suivre votre station : fiches de lavage, enregistrement des encaissements
              (Wave, Orange Money, MTN MoMo, Espèces), calcul des commissions des laveurs,
              et <span className="font-semibold text-base-content">alertes stock</span> pour repérer les produits sous leur seuil.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                to="/inscription"
                className="inline-flex items-center gap-2.5 rounded-xl bg-linear-to-r from-primary to-secondary px-6 py-3.5 text-base font-bold text-primary-content shadow-e3 transition hover:brightness-110"
              >
                Créer mon compte
                <FiArrowRight size={18} />
              </Link>
              <Link
                to="/connexion"
                className="inline-flex items-center gap-2 rounded-xl border border-base-300 bg-base-100/80 px-6 py-3.5 text-base font-semibold text-base-content/90 backdrop-blur transition hover:bg-base-200 hover:text-base-content"
              >
                <FiPlay size={16} className="text-primary" />
                Se connecter
              </Link>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-xs text-base-content/60">
              <span className="flex items-center gap-1.5">
                <FiCheck className="text-success" /> Sans carte bancaire
              </span>
              <span className="flex items-center gap-1.5">
                <FiCheck className="text-success" /> Tarification 100% en FCFA
              </span>
              <span className="flex items-center gap-1.5">
                <FiCheck className="text-success" /> Compatible Téléphone & Ordinateur
              </span>
            </div>
          </div>

          {/* ── Hero Operational Showcase (No fictitious figures) ──────────── */}
          <div className="relative mt-14 overflow-hidden rounded-2xl border border-base-300 bg-base-100/90 shadow-e3 backdrop-blur-xl">
            <div className="grid items-stretch lg:grid-cols-5">
              <div className="relative min-h-[260px] overflow-hidden lg:col-span-2">
                <img
                  src="/images/lav-auto.jpeg"
                  alt="Station de lavage automobile équipée"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-linear-to-t from-neutral via-neutral/40 to-transparent lg:bg-linear-to-r lg:from-transparent lg:to-neutral" />
                <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-base-300 bg-base-200/90 p-3.5 backdrop-blur">
                  <p className="text-[11px] font-bold tracking-wider text-primary uppercase">Architecture Station</p>
                  <p className="mt-1 text-xs text-base-content/90">
                    Chaque opération est horodatée, attribuée à un employé et vérifiée côté serveur avant enregistrement.
                  </p>
                </div>
              </div>

              <div className="p-6 sm:p-8 lg:col-span-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 pb-4">
                  <div>
                    <h2 className="text-base font-bold text-base-content">Chaîne de contrôle de bout en bout</h2>
                    <p className="mt-0.5 text-xs text-base-content/60">Aucune donnée préremplie — votre station démarre à blanc sur vos propres tarifs.</p>
                  </div>
                  <span className="rounded-lg border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                    Devise FCFA (XOF)
                  </span>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-base-300 bg-base-200/60 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-primary">
                      <FiTruck size={15} /> 1. Mise en route contrôlée
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-base-content/60">
                      Catégories de véhicules, catalogue, grille tarifaire complète et moyens de paiement validés avant ouverture.
                    </p>
                  </div>

                  <div className="rounded-xl border border-base-300 bg-base-200/60 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-success">
                      <FiLock size={15} /> 2. Caisse & canaux séparés
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-base-content/60">
                      Espèces rattachées à la session ouverte ; Wave, Orange Money et MTN MoMo rapprochés indépendamment.
                    </p>
                  </div>

                  <div className="rounded-xl border border-base-300 bg-base-200/60 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-warning">
                      <FiBox size={15} /> 3. Stocks & coût moyen (PUMP)
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-base-content/60">
                      Commandes fournisseurs, réceptions, normes de consommation par lavage, inventaires et alertes de seuil.
                    </p>
                  </div>

                  <div className="rounded-xl border border-base-300 bg-base-200/60 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-accent">
                      <FiUsers size={15} /> 4. Équipe, RBAC & reçus PDF
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-base-content/60">
                      Invitations par rôle, affectations multi-stations, barème de commissions et reçu imprimable ou PDF.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Payment Methods Trust Bar ────────────────────────────────────── */}
      <section className="border-y border-base-300/80 bg-base-100/50 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs font-semibold tracking-wider text-base-content/60 uppercase">
            Enregistrez vos encaissements par moyen de paiement
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-8 sm:gap-14 text-sm font-bold text-base-content/80">
            <div className="flex items-center gap-2 rounded-xl border border-base-300 bg-base-200/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span>Wave Côte d’Ivoire</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-base-300 bg-base-200/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
              <span>Orange Money CI</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-base-300 bg-base-200/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
              <span>MTN Mobile Money</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-base-300 bg-base-200/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-success" />
              <span>Espèces physiques</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-base-300 bg-base-200/60 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" />
              <span>Carte bancaire & Virement</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6 Core Pillars ──────────────────────────────────────────────── */}
      <section id="fonctionnalites" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">
              Modules Métier Intégrés
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-base-content sm:text-4xl">
              Tout ce dont votre station a besoin, réuni dans un seul outil.
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-base-content/60">
              Chaque fonctionnalité a été conçue pour résoudre les défis concrets rencontrés par les
              propriétaires et gérants de station de lavage sur le terrain.
            </p>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {/* Pillar 1 */}
            <div className="rounded-2xl border border-base-300 bg-base-100/60 p-7 transition hover:border-primary/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <FiTruck size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-base-content">File d’attente & Prise en charge</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-base-content/60">
                Numérotation automatique des fiches, immatriculation facultative, choix des prestations selon la catégorie et suivi des statuts et des affectations.
              </p>
            </div>

            {/* Pillar 2 */}
            <div className="rounded-2xl border border-base-300 bg-base-100/60 p-7 transition hover:border-success/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-success/10 text-success">
                <FiLock size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-base-content">Caisse & Rapprochement</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-base-content/60">
                Fond de caisse, séparation des espèces et des canaux numériques, prix figés et calcul de l’écart au comptage de clôture.
              </p>
            </div>

            {/* Pillar 3 */}
            <div className="rounded-2xl border border-base-300 bg-base-100/60 p-7 transition hover:border-warning/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-warning/10 text-warning">
                <FiBox size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-base-content">Alertes de stock</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-base-content/60">
                Consultez les niveaux et les seuils disponibles pour repérer les consommables à réapprovisionner.
              </p>
            </div>

            {/* Pillar 4 */}
            <div className="rounded-2xl border border-base-300 bg-base-100/60 p-7 transition hover:border-accent/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent/10 text-accent">
                <FiUsers size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-base-content">Commissions des Laveurs</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-base-content/60">
                Aperçu des commissions et relevés périodiques figés après validation par un responsable. Les réglages locaux ne configurent pas le serveur.
              </p>
            </div>

            {/* Pillar 5 */}
            <div className="rounded-2xl border border-base-300 bg-base-100/60 p-7 transition hover:border-secondary/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-secondary/10 text-secondary">
                <FiAward size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-base-content">CRM, Flottes & Cartes de Fidélité</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-base-content/60">
                Gestion des contrats de flottes professionnelles (entreprises, taxis, VTC) avec paiement différé, et programme de fidélité à points pour récompenser les habitués.
              </p>
            </div>

            {/* Pillar 6 */}
            <div className="rounded-2xl border border-base-300 bg-base-100/60 p-7 transition hover:border-rose-500/40">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-rose-500/10 text-rose-400">
                <FiBarChart2 size={24} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-base-content">Multi-Stations & Rentabilité Nette</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-base-content/60">
                Comparez les stations accessibles, leur chiffre d’affaires et leurs performances. Le résultat net dépend d’une attestation des coûts.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Interactive Workflow Demonstrator ───────────────────────────── */}
      <section id="caisse-stock" className="border-t border-base-300/80 bg-base-100/30 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">
              Fonctionnement Métier
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-base-content sm:text-4xl">
              Des règles claires sur chaque poste de la station
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-base-content/60">
              Explorez les contrôles automatisés appliqués sur vos données d’exploitation réelles.
            </p>
          </div>

          <div className="mt-10 flex justify-center">
            <div className="inline-flex rounded-xl border border-base-300 bg-base-200 p-1.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('caisse')}
                className={`rounded-lg px-4 py-2 transition ${activeTab === 'caisse' ? 'bg-primary/12 font-bold text-primary' : 'text-base-content/60 hover:bg-base-100 hover:text-base-content'}`}
              >
                1. Caisse & Rapprochement
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('stock')}
                className={`rounded-lg px-4 py-2 transition ${activeTab === 'stock' ? 'bg-primary/12 font-bold text-primary' : 'text-base-content/60 hover:bg-base-100 hover:text-base-content'}`}
              >
                2. Alertes Stock Critiques
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('lavages')}
                className={`rounded-lg px-4 py-2 transition ${activeTab === 'lavages' ? 'bg-primary/12 font-bold text-primary' : 'text-base-content/60 hover:bg-base-100 hover:text-base-content'}`}
              >
                3. File de Lavages & Fiche
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('commissions')}
                className={`rounded-lg px-4 py-2 transition ${activeTab === 'commissions' ? 'bg-primary/12 font-bold text-primary' : 'text-base-content/60 hover:bg-base-100 hover:text-base-content'}`}
              >
                4. Commissions Laveurs
              </button>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-base-300 bg-base-200 p-6 sm:p-10">
            {activeTab === 'caisse' && (
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success/20 px-3 py-1 text-xs font-bold text-success">
                    <FiLock size={14} /> Suivi de caisse
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-base-content">
                    Calcul de l’écart au comptage
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-base-content/80">
                    Chaque matin, le caissier ouvre la caisse avec son fond initial. Au cours de la journée,
                    les encaissements espèces s'additionnent et les sorties de dépenses autorisées se déduisent.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-base-content/80">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-success" />
                      <span><strong>Solde théorique</strong> = fond + mouvements de caisse espèces</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-success" />
                      <span>Rapprochement Wave et Orange Money <strong>strictement séparé</strong> des billets de banque</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-success" />
                      <span>Clôture immuable : relevé figé avec horodatage et identité du caissier</span>
                    </li>
                  </ul>
                  <div className="mt-6">
                    <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary">
                      Tester le module de caisse <FiArrowRight />
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100/90 p-5 text-xs">
                  <div className="flex items-center justify-between border-b border-base-300 pb-3">
                    <span className="font-bold text-base-content/90">Règles de clôture serveur</span>
                    <span className="rounded bg-success/20 px-2 py-0.5 text-[10px] font-bold text-success">IMMUABLE</span>
                  </div>
                  <div className="mt-3 space-y-2.5 text-base-content/80">
                    <div className="flex justify-between rounded-lg bg-base-200/60 px-3 py-2">
                      <span>1. Fond d’ouverture</span>
                      <span className="font-semibold text-base-content">Déclaré à la prise de poste</span>
                    </div>
                    <div className="flex justify-between rounded-lg bg-base-200/60 px-3 py-2">
                      <span>2. Mouvements espèces</span>
                      <span className="font-semibold text-success">+ Encaissements − Dépenses</span>
                    </div>
                    <div className="flex justify-between rounded-lg bg-base-200/60 px-3 py-2">
                      <span>3. Comptage physique</span>
                      <span className="font-semibold text-primary">Saisi par le caissier</span>
                    </div>
                    <div className="flex justify-between rounded-lg bg-base-200/60 px-3 py-2">
                      <span>4. Relevé de clôture</span>
                      <span className="font-semibold text-base-content">Écart archivé sans réécriture</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'stock' && (
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/20 px-3 py-1 text-xs font-bold text-warning">
                    <FiAlertTriangle size={14} /> Alertes de stock
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-base-content">
                    Repérez les produits sous leur seuil
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-base-content/80">
                    Configurez vos consommables, leurs seuils critiques et leurs fiches techniques par prestation. Chaque réception met à jour le coût moyen pondéré (PUMP) et chaque sortie est tracée.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-base-content/80">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-warning" />
                      <span>Suivi des consommations enregistrées par lavage</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-warning" />
                      <span>Seuil d’alerte configurable par produit (litres, bidons, unités)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-warning" />
                      <span>Valorisation du stock au coût moyen pondéré (PUMP)</span>
                    </li>
                  </ul>
                  <div className="mt-6">
                    <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary">
                      Voir la gestion des stocks <FiArrowRight />
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100/90 p-5 text-xs">
                  <div className="mb-4 flex items-center justify-between border-b border-base-300 pb-3">
                    <span className="font-bold text-base-content">Cycle complet des achats & stocks</span>
                    <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning">
                      TRAÇABILITÉ PUMP
                    </span>
                  </div>
                  <div className="space-y-2.5 text-base-content/80">
                    <div className="rounded-lg border border-base-300 bg-base-200/60 p-3">
                      <p className="font-bold text-base-content">Commande fournisseur → Réception partielle ou totale</p>
                      <p className="mt-1 text-[11px] text-base-content/60">Une commande ne crédite le stock qu’à la réception physique validée.</p>
                    </div>
                    <div className="rounded-lg border border-base-300 bg-base-200/60 p-3">
                      <p className="font-bold text-base-content">Alertes de seuil en direct</p>
                      <p className="mt-1 text-[11px] text-base-content/60">Détection immédiate des consommables en rupture ou sous le seuil critique.</p>
                    </div>
                    <div className="rounded-lg border border-base-300 bg-base-200/60 p-3">
                      <p className="font-bold text-base-content">Certification périodique des coûts</p>
                      <p className="mt-1 text-[11px] text-base-content/60">Rapprochement des factures d’achat et des consommations valorisées.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'lavages' && (
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1 text-xs font-bold text-primary">
                    <FiDroplet size={14} /> Fluidité opérationnelle
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-base-content">
                    File d’attente et suivi du contrôle qualité
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-base-content/80">
                    Chaque fiche regroupe les prestations choisies, les affectations et, si nécessaire, un poste. Le contrôle qualité précède la livraison et les tarifs restent figés à la création.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-base-content/80">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-primary" />
                      <span>Grille tarifaire configurable par catégorie de véhicule</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-primary" />
                      <span>Affectation nominative des laveurs pour chaque fiche</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-primary" />
                      <span>Validation du contrôle qualité et reçu PDF avant restitution</span>
                    </li>
                  </ul>
                  <div className="mt-6">
                    <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary">
                      Explorer la file de lavage <FiArrowRight />
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100/90 p-5 text-xs">
                  <div className="flex items-center justify-between border-b border-base-300 pb-3 font-bold text-base-content">
                    <span>Statuts d’une fiche de lavage</span>
                    <span className="text-primary">Tarifs figés serveur</span>
                  </div>
                  <div className="mt-3 space-y-2.5 text-base-content/80">
                    <div className="flex justify-between rounded-lg bg-base-200/60 px-3 py-2">
                      <span>En attente / Affecté</span>
                      <span className="text-base-content/60">Prise en charge & équipe</span>
                    </div>
                    <div className="flex justify-between rounded-lg bg-base-200/60 px-3 py-2">
                      <span>En cours</span>
                      <span className="text-primary">Exécution sur poste</span>
                    </div>
                    <div className="flex justify-between rounded-lg bg-base-200/60 px-3 py-2">
                      <span>Contrôle qualité → Prêt</span>
                      <span className="text-success">Inspection avant remise</span>
                    </div>
                    <div className="flex justify-between rounded-lg bg-base-200/60 px-3 py-2">
                      <span>Livré · Reçu FCFA</span>
                      <span className="font-semibold text-base-content">Impression & export PDF</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'commissions' && (
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/20 px-3 py-1 text-xs font-bold text-accent">
                    <FiUsers size={14} /> Motivation & Transparence
                  </span>
                  <h3 className="mt-4 text-2xl font-bold text-base-content">
                    Commissions calculées et relevés de période
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-base-content/80">
                    Définissez le barème de la station et, si besoin, un taux individuel par employé. Les relevés validés figent les montants dus pour préparer la paie sans ambiguïté.
                  </p>
                  <ul className="mt-4 space-y-2.5 text-xs text-base-content/80">
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-accent" />
                      <span>Barème de station et taux individuel par employé</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-accent" />
                      <span>Relevé périodique figé après validation</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <FiCheck className="text-accent" />
                      <span>Enregistrement du règlement avec référence de paiement</span>
                    </li>
                  </ul>
                  <div className="mt-6">
                    <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary">
                      Accéder aux commissions <FiArrowRight />
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100/90 p-5 text-xs">
                  <div className="flex items-center justify-between border-b border-base-300 pb-3 font-bold text-base-content">
                    <span>Validation des relevés</span>
                    <span className="text-success">Export CSV paie</span>
                  </div>
                  <div className="mt-3 space-y-2.5 text-base-content/80">
                    <div className="rounded-lg bg-base-200/60 p-3">
                      <p className="font-bold text-base-content">1. Aperçu en direct sur lavages terminés</p>
                      <p className="mt-1 text-[11px] text-base-content/60">Les fiches annulées ou en cours sont automatiquement exclues.</p>
                    </div>
                    <div className="rounded-lg bg-base-200/60 p-3">
                      <p className="font-bold text-base-content">2. Création & validation de période</p>
                      <p className="mt-1 text-[11px] text-base-content/60">Le relevé validé fige la base, le taux appliqué et le montant dû.</p>
                    </div>
                    <div className="rounded-lg bg-base-200/60 p-3">
                      <p className="font-bold text-base-content">3. Traçabilité des règlements</p>
                      <p className="mt-1 text-[11px] text-base-content/60">Chaque paie enregistrée conserve sa référence et son horodatage.</p>
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
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">
              Tarification Transparente
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-base-content sm:text-4xl">
              Des formules adaptées à chaque taille de station
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-base-content/60">
Essai de 14 jours avec tous les modules. Standard et Premium nécessitent une demande puis une validation administrateur : une validation anticipée met fin à l’essai immédiatement. Aucun paiement automatique. Montants indicatifs en FCFA, à valider commercialement.
            </p>
          </div>

          {plansError ? (
            <div role="alert" className="mt-14 rounded-2xl border border-warning/30 bg-base-100/60 p-6 text-center">
              <p className="font-bold text-base-content">Formules et tarifs indisponibles</p>
              <p className="mt-2 text-sm text-base-content/60">Aucun prix local n’est présenté à la place des tarifs indisponibles. Veuillez réessayer plus tard.</p>
            </div>
          ) : plans.length === 0 ? (
            <p role="status" className="mt-14 text-center text-sm text-base-content/60">Chargement des formules…</p>
          ) : (
          <div className="mt-14 grid gap-8 lg:grid-cols-3">
            {plans.filter((plan) => ['essai', 'standard', 'premium'].includes(plan.id)).map((plan) => {
              const isPopular = plan.id === 'standard';
              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col justify-between rounded-2xl border p-8 transition ${
 isPopular
 ? 'border-primary bg-linear-to-b from-primary/10 via-base-100 to-base-100 shadow-e3 shadow-primary/20'
 : 'border-base-300 bg-base-100/60 hover:border-base-300'
 }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-linear-to-r from-primary to-secondary px-4 py-1 text-xs font-bold text-primary-content shadow-md">
                      Formule Standard
                    </div>
                  )}

                  <div>
                    <h3 className="text-xl font-bold text-base-content">{plan.name}</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-base-content">
                        {plan.priceMonthly === 0 ? 'Gratuit' : formatFCFA(plan.priceMonthly)}
                      </span>
                      {plan.priceMonthly > 0 && (
                        <span className="text-sm font-semibold text-base-content/60">/ mois</span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-base-content/60">
                      {plan.id === 'essai' ? '14 jours · tous les modules' : 'Tarif mensuel indicatif · activation sur validation'}
                    </p>

                    <div className="my-6 border-t border-base-300" />

                    <div className="text-xs font-semibold text-base-content/80">
                      <p className="font-bold text-primary">
                        {plan.limits.stations} station(s) · {plan.limits.employees} comptes actifs · {plan.limits.washesPerMonth.toLocaleString('fr-FR')} lavages/mois
                      </p>
                      <p className="mt-1 text-base-content/60">Le propriétaire compte dans les comptes actifs.</p>
                    </div>

                    <div className="mt-6 text-base-content/80"><PlanDetails plan={plan} /></div>
                  </div>

                  <div className="mt-8">
                    <Link
                      to={`/inscription?plan=${encodeURIComponent(plan.id)}`}
                      className={`block w-full rounded-xl py-3 text-center text-sm font-bold transition ${
 isPopular
 ? 'bg-primary text-primary-content shadow-e2 hover:brightness-110'
 : 'border border-base-300 bg-base-100 text-base-content hover:bg-base-200'
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
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">
              Questions Fréquentes
            </h2>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-base-content sm:text-4xl">
              Tout ce que vous devez savoir avant de commencer
            </p>
          </div>

          <div className="mt-12 space-y-4">
            {FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div
                  key={index}
                  className="rounded-xl border border-base-300 bg-base-100/60 transition hover:border-base-300"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    className="flex w-full items-center justify-between p-5 text-left text-sm font-bold text-base-content"
                  >
                    <span>{faq.q}</span>
                    <FiChevronDown
                      size={18}
                      className={`text-base-content/60 transition-transform ${isOpen ? 'rotate-180 text-primary' : ''}`}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t border-base-300 px-5 pt-3 pb-5 text-xs leading-relaxed text-base-content/80">
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
      <section className="relative overflow-hidden border-t border-base-300 bg-linear-to-b from-base-200 via-base-100 to-base-100 py-20 text-center">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-black text-base-content sm:text-4xl lg:text-5xl">
            Prêt à transformer la gestion de votre station de lavage ?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base-content/80">
            Suivez vos lavages, vos encaissements et vos équipes au même endroit.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              to="/inscription"
              className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-primary to-secondary px-7 py-3.5 text-base font-bold text-primary-content shadow-e3 transition hover:brightness-110"
            >
              Créer mon espace
              <FiArrowRight size={18} />
            </Link>
            <Link
              to="/connexion"
              className="inline-flex items-center gap-2 rounded-xl border border-base-300 bg-base-100 px-6 py-3.5 text-base font-semibold text-base-content/90 transition hover:bg-base-200 hover:text-base-content"
            >
              Se connecter
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-base-300 bg-base-200 py-12 text-xs text-base-content/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-content">
                <FiDroplet size={18} />
              </span>
              <span className="text-base font-black text-base-content">
                Wash<span className="text-primary">Guard</span>
              </span>
              <span className="ml-2 text-base-content/60">· ERP Station & Caisse</span>
            </div>

            <div className="flex flex-wrap gap-6 font-medium text-base-content/80">
              <Link to="/connexion" className="hover:text-base-content">Connexion</Link>
              <Link to="/inscription" className="hover:text-base-content">Inscription</Link>
              <a href="#fonctionnalites" className="hover:text-base-content">Fonctionnalités</a>
              <a href="#tarifs" className="hover:text-base-content">Tarifs (FCFA)</a>
              <a href="#faq" className="hover:text-base-content">FAQ</a>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between border-t border-base-300/80 pt-6 text-[11px] text-base-content/60">
            <p>© {new Date().getFullYear()} WashGuard. Tous droits réservés.</p>
            <p>Devise affichée : Francs CFA (XOF).</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
