import React from 'react';
import { Link } from 'react-router-dom';
import { FiCheckCircle, FiLock, FiShield } from 'react-icons/fi';
import { Logo } from '../../components/ui';
import { useStore } from '../../lib/store';

const POINTS = [
  'Vos tarifs, vos horaires, vos règles de caisse',
  'Chaque opération rattachée à un employé',
  'Rapports et commissions calculés sur vos données',
];

/** Mise en page commune connexion / inscription.
 *  Formulaire sur surface claire et centrée ; panneau photo à droite,
 *  masqué sur téléphone (le formulaire reste plein largeur). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { authKind } = useStore();
  return (
    <div className="flex min-h-screen bg-base-200 text-base-content">
      {/* Formulaire */}
      <div className="flex w-full flex-col lg:w-[54%] xl:w-1/2">
        <header className="flex h-16 items-center justify-between px-6 sm:px-10">
          <Link to="/" className="text-base-content"><Logo /></Link>
          <Link to="/" className="text-xs font-semibold text-base-content/60 hover:text-primary">← Retour à l’accueil</Link>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 py-8 sm:px-10 lg:px-16">
          <div className="w-full max-w-[460px] animate-fade-in rounded-2xl border border-base-300 bg-base-100 p-6 shadow-e1 sm:p-8">{children}</div>
        </div>
        <footer className="px-6 pb-6 text-center text-[11px] text-base-content/60 sm:px-10">
          © {new Date().getFullYear()} WashGuard · Montants en FCFA · Dates jj/mm/aaaa
        </footer>
      </div>

      {/* Panneau photo — dégradé sombre pour rester lisible même sur photo claire */}
      <div className="relative hidden overflow-hidden lg:block lg:w-[46%] xl:w-1/2">
        <img src="/images/lav-auto.jpeg" alt="Lavage d’un véhicule en cours dans une station" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-linear-to-br from-neutral/95 via-neutral/75 to-neutral/60" />
        <div className="absolute inset-0 bg-linear-to-t from-neutral/95 via-transparent to-neutral/50" />
        <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-neutral-content/25 bg-neutral-content/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-neutral-content backdrop-blur">
            <FiShield /> Espace station
          </span>
          <div className="max-w-lg">
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-neutral-content xl:text-4xl">
              Une station qui sait<br />exactement où elle en est.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-neutral-content/80">
              Du premier lavage à la clôture de caisse, WashGuard garde la trace de chaque montant — sans rien inventer.
            </p>
            <div className="mt-8 space-y-3">
              {POINTS.map((p) => (
                <div key={p} className="flex items-start gap-3 text-sm text-neutral-content/90">
                  <FiCheckCircle className="mt-0.5 shrink-0 text-neutral-content" /> <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-neutral-content/60">
            <FiLock /> {authKind === 'local' ? 'Stockage navigateur actif' : 'Connexion sécurisée par e-mail et mot de passe'}
          </div>
        </div>
      </div>
    </div>
  );
}
