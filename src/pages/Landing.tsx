import React, { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatFCFA } from '../lib/format';
import { useStore } from '../lib/store';

/* ─── Vitrine `/` reprise du modèle public ixartz/Next-js-Boilerplate ───────
   Source : https://github.com/ixartz/Next-js-Boilerplate (branche `main`).
   Licence MIT — Copyright (c) 2026 Remi W. — voir
   `public/assets/images/LICENSE.txt` et `docs/landing.md`.
   Les textes, sections, illustrations et la navigation sont repris fidèlement ;
   seules les actions internes sont branchées aux routes WashGuard existantes.
   Aucune nouvelle fonctionnalité, dépendance, table ou clé n'est ajoutée.      */

type Sponsor = {
  label: string;
  href: string;
  src: string;
  alt: string;
};

const SPONSORS: Sponsor[] = [
  {
    label: 'Visit Clerk',
    href: 'https://clerk.com?utm_source=github&utm_medium=sponsorship&utm_campaign=nextjs-boilerplate',
    src: '/assets/images/clerk-logo-dark.png',
    alt: 'Clerk – Authentication & User Management for Next.js',
  },
  {
    label: 'Visit CodeRabbit',
    href: 'https://www.coderabbit.ai?utm_source=next_js_starter&utm_medium=github&utm_campaign=next_js_starter_oss_2025',
    src: '/assets/images/coderabbit-logo-light.svg',
    alt: 'CodeRabbit',
  },
  {
    label: 'Visit Sentry',
    href: 'https://sentry.io/for/nextjs/?utm_source=github&utm_medium=paid-community&utm_campaign=general-fy25q1-nextjs&utm_content=github-banner-nextjsboilerplate-logo',
    src: '/assets/images/sentry-dark.png',
    alt: 'Sentry',
  },
  {
    label: 'Visit Arcjet',
    href: 'https://launch.arcjet.com/Q6eLbRE',
    src: '/assets/images/arcjet-light.svg',
    alt: 'Arcjet',
  },
  {
    label: 'Visit Crowdin',
    href: 'https://l.crowdin.com/next-js',
    src: '/assets/images/crowdin-dark.png',
    alt: 'Crowdin',
  },
  {
    label: 'Visit Better Stack',
    href: 'https://betterstack.com/?utm_source=github&utm_medium=sponsorship&utm_campaign=next-js-boilerplate',
    src: '/assets/images/better-stack-dark.png',
    alt: 'Better Stack',
  },
  {
    label: 'Visit PostHog',
    href: 'https://posthog.com/?utm_source=github&utm_medium=sponsorship&utm_campaign=next-js-boilerplate',
    src: '/assets/images/posthog-logo.svg',
    alt: 'PostHog',
  },
  {
    label: 'Visit Checkly',
    href: 'https://www.checklyhq.com/?utm_source=github&utm_medium=sponsorship&utm_campaign=next-js-boilerplate',
    src: '/assets/images/checkly-logo-light.png',
    alt: 'Checkly',
  },
  {
    label: 'Visit Next.js SaaS Boilerplate',
    href: 'https://nextjs-boilerplate.com/pro-saas-starter-kit',
    src: '/assets/images/nextjs-boilerplate-saas.png',
    alt: 'Next.js SaaS Boilerplate',
  },
];

function DemoBanner() {
  return (
    <div className="boilerplate-banner sticky top-0 z-50 bg-gray-900 p-4 text-center text-lg font-semibold text-gray-100">
      Live Demo of Next.js Boilerplate -{' '}
      <Link to="/inscription" className="text-fuchsia-500 hover:text-indigo-500">
        Explore the Authentication
      </Link>
    </div>
  );
}

function DemoBadge() {
  return (
    <div className="fixed right-20 bottom-0 z-10">
      <a href="https://github.com/ixartz/Next-js-Boilerplate">
        <div className="rounded-md bg-gray-900 px-3 py-2 font-semibold text-gray-100">
          <span className="text-gray-500">Demo of</span>
          {` Next.js Boilerplate`}
        </div>
      </a>
    </div>
  );
}

/** Reflet visuel du sélecteur du modèle : l'i18n n'est pas une fonctionnalité WashGuard. */
function LocaleSwitcher() {
  return (
    <select
      defaultValue="FR"
      disabled
      aria-label="Changer de langue"
      className="border border-gray-300 bg-white font-medium text-gray-700"
    >
      <option value="FR">FR</option>
      <option value="EN">EN</option>
    </select>
  );
}

function BaseTemplate(props: { leftNav: ReactNode; rightNav?: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full px-1 text-gray-700 antialiased">
      <div className="mx-auto max-w-3xl">
        <header className="border-b border-gray-300">
          <div className="pt-16 pb-8">
            <h1 className="text-3xl font-bold text-gray-900">Nextjs Starter</h1>
            <h2 className="text-xl">Code de démarrage pour Next.js avec Tailwind CSS</h2>
          </div>

          <div className="flex justify-between">
            <nav aria-label="Navigation principale">
              <ul className="flex flex-wrap gap-x-5 text-xl">{props.leftNav}</ul>
            </nav>

            <nav>
              <ul className="flex flex-wrap gap-x-5 text-xl">{props.rightNav}</ul>
            </nav>
          </div>
        </header>

        <main>{props.children}</main>

        <footer className="border-t border-gray-300 py-8 text-center text-sm">
          © {new Date().getFullYear()} Nextjs Starter. Fait avec{' '}
          <a
            href="https://nextjs-boilerplate.com"
            className="text-blue-700 hover:border-b-2 hover:border-blue-700"
          >
            Next.js Boilerplate
          </a>
          .
        </footer>
      </div>
    </div>
  );
}

function Sponsors() {
  const rows = [SPONSORS.slice(0, 3), SPONSORS.slice(3, 6), SPONSORS.slice(6, 9)];
  return (
    <table className="border-collapse">
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr className="h-56" key={rowIndex}>
            {row.map((sponsor) => (
              <td className="border-2 border-gray-300 p-3" key={sponsor.label}>
                <a aria-label={sponsor.label} href={sponsor.href}>
                  <img
                    src={sponsor.src}
                    alt={sponsor.alt}
                    width={220}
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                </a>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Section WashGuard conservée : mêmes formules que la facturation, sans nouveau prix local. */
function Pricing() {
  const { plans, plansError, dataSource } = useStore();
  return (
    <section id="tarifs" className="mt-10 scroll-mt-20 border-t border-gray-300 pt-8">
      <h2 className="text-2xl font-bold">Formules et tarifs</h2>
      <p className="text-base">
        Ces montants sont lus depuis la table des formules : la vitrine et la facturation partagent la même source.
      </p>
      {plans.length === 0 && dataSource === 'supabase' && (
        <div role="alert" className="mt-3 border-2 border-red-300 p-3 text-base text-red-700">
          Formules et tarifs indisponibles. Aucun prix local n’est affiché en repli :{' '}
          {plansError ?? 'réessayez dans un instant.'}
        </div>
      )}
      <div className="mt-4 grid gap-4 text-base md:grid-cols-3">
        {plans.map((plan) => (
          <div className="border-2 border-gray-300 p-3" key={plan.id}>
            <h3 className="font-bold">{plan.name}</h3>
            <p className="mt-2 text-2xl font-bold">{formatFCFA(plan.priceMonthly)} / mois</p>
            <ul className="mt-3">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
              <li>
                {plan.limits.stations} station(s) · {plan.limits.employees} comptes ·{' '}
                {plan.limits.washesPerMonth.toLocaleString('fr-FR')} lavages/mois
              </li>
            </ul>
            <Link
              to="/inscription"
              className="mt-4 inline-block border-2 border-blue-700 px-3 py-1 font-semibold text-blue-700 hover:border-b-4"
            >
              {plan.trial ? 'Commencer l’essai' : `Choisir ${plan.name}`}
            </Link>
          </div>
        ))}
      </div>
      <p className="text-base">
        Aucun prix de prestation n’est prédéfini : vos tarifs de lavage sont choisis par vous pendant la mise en route.
      </p>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="wg-boilerplate-landing min-h-screen w-full bg-white">
      <DemoBanner />
      <BaseTemplate
        leftNav={
          <>
            <li>
              <Link to="/" className="border-none text-gray-700 hover:text-gray-900">
                Accueil
              </Link>
            </li>
            <li>
              <a href="#a-propos" className="border-none text-gray-700 hover:text-gray-900">
                A propos
              </a>
            </li>
            <li>
              <Link
                to="/app/tableau-de-bord"
                title="Tableau de bord WashGuard"
                className="border-none text-gray-700 hover:text-gray-900"
              >
                Compteur
              </Link>
            </li>
            <li>
              <a href="#partenaires" className="border-none text-gray-700 hover:text-gray-900">
                Portfolio
              </a>
            </li>
            <li>
              <a href="#tarifs" className="border-none text-gray-700 hover:text-gray-900">
                Tarifs
              </a>
            </li>
            <li>
              <a
                className="border-none text-gray-700 hover:text-gray-900"
                href="https://github.com/ixartz/Next-js-Boilerplate"
              >
                GitHub
              </a>
            </li>
          </>
        }
        rightNav={
          <>
            <li>
              <Link to="/connexion" className="border-none text-gray-700 hover:text-gray-900">
                Se connecter
              </Link>
            </li>
            <li>
              <Link to="/inscription" className="border-none text-gray-700 hover:text-gray-900">
                S'inscrire
              </Link>
            </li>
            <li>
              <LocaleSwitcher />
            </li>
          </>
        }
      >
        <div className="boilerplate-main py-5 text-xl">
          <p id="a-propos">
            {`Follow `}
            <a
              className="text-blue-700 hover:border-b-2 hover:border-blue-700"
              href="https://twitter.com/ixartz"
              target="_blank"
              rel="noreferrer noopener"
            >
              @Ixartz on Twitter
            </a>
            {` for updates and more information about the boilerplate.`}
          </p>
          <h2 className="mt-5 text-2xl font-bold">
            Boilerplate Code for Your Next.js Project with Tailwind CSS
          </h2>
          <p className="text-base">
            Next.js Boilerplate is a developer-friendly starter code for Next.js projects, built with
            Tailwind CSS and TypeScript.{' '}
            <span role="img" aria-label="Éclair">
              ⚡️
            </span>{' '}
            Designed with developer experience in mind, it includes:
          </p>
          <ul className="mt-3 text-base">
            <li>🚀 Next.js with App Router support</li>
            <li>🔥 TypeScript for type checking</li>
            <li>💎 Tailwind CSS integration</li>
            <li>
              🔒 Authentication with{' '}
              <a
                className="font-bold text-blue-700 hover:border-b-2 hover:border-blue-700"
                href="https://clerk.com?utm_source=github&utm_medium=sponsorship&utm_campaign=nextjs-boilerplate"
              >
                Clerk
              </a>{' '}
              (includes passwordless, social, and multi-factor auth)
            </li>
            <li>📦 ORM with DrizzleORM (PostgreSQL, SQLite, MySQL support)</li>
            <li>
              💽 Dev database with PGlite and production with{' '}
              <a
                className="font-bold text-blue-700 hover:border-b-2 hover:border-blue-700"
                href="https://get.neon.com/BMFYNtx"
              >
                Neon
              </a>
            </li>
            <li>
              🌐 Multi-language support (i18n) with next-intl and{' '}
              <a
                className="font-bold text-blue-700 hover:border-b-2 hover:border-blue-700"
                href="https://l.crowdin.com/next-js"
              >
                Crowdin
              </a>
            </li>
            <li>🔴 Form handling (React Hook Form) and validation (Zod)</li>
            <li>📏 Linting and formatting (ESLint, Prettier)</li>
            <li>🦊 Git hooks and commit linting (Husky, Commitlint)</li>
            <li>🦺 Testing suite (Vitest, React Testing Library, Playwright)</li>
            <li>🎉 Storybook for UI development</li>
            <li>
              🐰 AI-powered code reviews with{' '}
              <a
                className="font-bold text-blue-700 hover:border-b-2 hover:border-blue-700"
                href="https://www.coderabbit.ai?utm_source=next_js_starter&utm_medium=github&utm_campaign=next_js_starter_oss_2025"
              >
                CodeRabbit
              </a>
            </li>
            <li>
              🚨 Error monitoring (
              <a
                className="font-bold text-blue-700 hover:border-b-2 hover:border-blue-700"
                href="https://sentry.io/for/nextjs/?utm_source=github&utm_medium=paid-community&utm_campaign=general-fy25q1-nextjs&utm_content=github-banner-nextjsboilerplate-logo"
              >
                Sentry
              </a>
              ) and logging (LogTape, an alternative to Pino.js)
            </li>
            <li>🖥️ Monitoring as Code (Checkly)</li>
            <li>
              🔐 Security and bot protection (
              <a
                className="font-bold text-blue-700 hover:border-b-2 hover:border-blue-700"
                href="https://launch.arcjet.com/Q6eLbRE"
              >
                Arcjet
              </a>
              )
            </li>
            <li>🤖 SEO optimization (metadata, JSON-LD, Open Graph tags)</li>
            <li>⚙️ Development tools (VSCode config, bundler analyzer, changelog generation)</li>
          </ul>
          <p className="text-base">
            Our sponsors' exceptional support has made this project possible. Their services
            integrate seamlessly with the boilerplate, and we recommend trying them out.
          </p>
          <section id="partenaires" className="scroll-mt-20">
            <h2 className="mt-5 text-2xl font-bold">Partenaires</h2>
            <Sponsors />
          </section>
          <Pricing />
        </div>
      </BaseTemplate>
      <DemoBadge />
    </div>
  );
}
