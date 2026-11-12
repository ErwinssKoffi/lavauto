import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiArrowRight, FiBriefcase, FiCheckCircle, FiInfo, FiLock, FiUser } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { useStore } from '../../lib/store';

const fieldCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100';
const labelCls = 'mb-1.5 block text-xs font-bold text-slate-600';

export default function SignUp() {
  const { signUp } = useStore();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    companyName: '', stationName: '', phone: '', city: '',
    ownerName: '', email: '', password: '', confirm: '',
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (form.password !== form.confirm) return setError('Les deux mots de passe ne correspondent pas.');
    if (form.password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.');
    setBusy(true);
    try {
      const result = await signUp(form);
      if (result.confirmationRequired) {
        setNotice(result.message ?? 'Confirmez votre adresse e-mail avant la première connexion.');
        return;
      }
      const activated = result.identity?.stations[0]?.activated ?? false;
      navigate(activated ? '/app/tableau-de-bord' : '/app/mise-en-route');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Badge tone="accent">14 jours d’essai · sans carte bancaire</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Créer mon espace</h1>
      <p className="mt-2 text-sm text-slate-500">Deux temps, quatre informations sur votre station, puis votre compte.</p>

      <form onSubmit={(e) => { void submit(e); }} className="mt-6 space-y-5">
        {/* Temps 1 */}
        <section className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-100 text-sky-600"><FiBriefcase size={14} /></span>
            <div>
              <h2 className="text-sm font-bold">Votre entreprise et sa station</h2>
              <p className="text-[11px] text-slate-400">Ces informations identifient votre exploitation.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={labelCls} htmlFor="companyName">Nom de l’entreprise *</label><input id="companyName" required className={fieldCls} value={form.companyName} onChange={set('companyName')} placeholder="Ex. SARL Clean Auto" /></div>
            <div><label className={labelCls} htmlFor="stationName">Nom de la station *</label><input id="stationName" required className={fieldCls} value={form.stationName} onChange={set('stationName')} placeholder="Ex. Clean Auto Cocody" /></div>
            <div><label className={labelCls} htmlFor="phone">Téléphone *</label><input id="phone" required type="tel" className={fieldCls} value={form.phone} onChange={set('phone')} placeholder="+225 00 00 00 00" /></div>
            <div><label className={labelCls} htmlFor="city">Ville *</label><input id="city" required className={fieldCls} value={form.city} onChange={set('city')} placeholder="Abidjan" /></div>
          </div>
        </section>

        {/* Temps 2 */}
        <section className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-100 text-sky-600"><FiUser size={14} /></span>
            <div>
              <h2 className="text-sm font-bold">Votre compte de propriétaire</h2>
              <p className="text-[11px] text-slate-400">Il pourra créer les autres comptes depuis Employés.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={labelCls} htmlFor="ownerName">Votre nom *</label><input id="ownerName" required className={fieldCls} value={form.ownerName} onChange={set('ownerName')} placeholder="Prénom et nom" /></div>
            <div><label className={labelCls} htmlFor="email">Adresse e-mail *</label><input id="email" required type="email" autoComplete="email" className={fieldCls} value={form.email} onChange={set('email')} placeholder="vous@exemple.ci" /></div>
            <div><label className={labelCls} htmlFor="password">Mot de passe *</label><input id="password" required type="password" autoComplete="new-password" className={fieldCls} value={form.password} onChange={set('password')} placeholder="8 caractères minimum" /></div>
            <div><label className={labelCls} htmlFor="confirm">Confirmer *</label><input id="confirm" required type="password" autoComplete="new-password" className={fieldCls} value={form.confirm} onChange={set('confirm')} placeholder="••••••••" /></div>
          </div>
        </section>

        {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}
        {notice && <div className="text-xs"><Alert kind="success">{notice}</Alert></div>}

        <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
          <div className="flex items-start gap-2"><FiInfo className="mt-0.5 shrink-0 text-sky-600" />
            <p>Supabase Auth crée <strong>une seule fois</strong> l’entreprise, sa station, le profil propriétaire et l’abonnement d’essai. Un e-mail de confirmation est requis avant la première connexion. Aucune donnée d’exemple ni aucun tarif de lavage n’est prérempli.</p>
          </div>
        </div>

        <button type="submit" disabled={busy} className="wg-btn wg-btn-primary w-full !py-3 disabled:opacity-60">
          {busy ? 'Création…' : 'Créer mon espace'} <FiArrowRight />
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        Déjà inscrit ? <Link to="/connexion" className="font-bold text-sky-600 hover:underline">Se connecter</Link>
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-slate-400"><FiCheckCircle /> <FiLock /> JWT 1 h · refresh token renouvelé · aucune connexion Google / Facebook</div>
    </AuthLayout>
  );
}
