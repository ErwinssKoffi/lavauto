import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiArrowDownRight,
  FiArrowRight,
  FiBarChart2,
  FiCheck,
  FiCheckCircle,
  FiChevronDown,
  FiCreditCard,
  FiDollarSign,
  FiFileText,
  FiGrid,
  FiLock,
  FiMoon,
  FiPieChart,
  FiSettings,
  FiShield,
  FiSun,
  FiTruck,
  FiUsers,
  FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatFCFA } from '../lib/format';
import { Badge, Logo, Progress } from '../components/ui';

const MODULES = [
  { icon: <FiTruck />, number: '01', title: 'Suivez chaque lavage', text: 'Statuts clairs, remise autorisée, encaissement total ou partiel et reste à payer.' },
  { icon: <FiDollarSign />, number: '02', title: 'Gardez une caisse juste', text: 'Fond de caisse, comptage à la clôture, écarts expliqués et réouverture motivée.' },
  { icon: <FiUsers />, number: '03', title: 'Coordonnez votre équipe', text: 'Rôles adaptés, comptes activés au bon moment et commissions calculées sur les lavages terminés.' },
  { icon: <FiCreditCard />, number: '04', title: 'Tracez chaque dépense', text: 'Catégorie, motif, fournisseur et annulation suivie. Les opérations ne disparaissent pas.' },
  { icon: <FiBarChart2 />, number: '05', title: 'Lisez vos résultats', text: 'Rapports par jour, semaine ou mois, moyens de paiement et export CSV.' },
  { icon: <FiSettings />, number: '06', title: 'Gardez la main sur vos tarifs', text: 'Votre catalogue appartient à votre station. Les lavages enregistrés gardent leur prix d’origine.' },
];

const FAQ = [
  { q: 'Les prix affichés sont-ils les vrais ?', r: 'Oui. Les formules et leurs tarifs sont lus dans la base, comme la facturation. La vitrine ne peut donc pas afficher un prix différent de celui qui sera appliqué.' },
  { q: 'Que se passe-t-il après l’inscription ?', r: 'Le serveur crée une seule fois votre entreprise, sa station, votre compte propriétaire et l’abonnement d’essai. Vous arrivez ensuite sur la Mise en route.' },
  { q: 'Puis-je encaisser avant d’avoir fixé mes tarifs ?', r: 'Non. Tant que la station n’est pas activée, les fiches, encaissements, la caisse et les dépenses restent verrouillés. La mise en route vous indique ce qu’il reste à compléter.' },
  { q: 'Puis-je modifier un tarif plus tard ?', r: 'Oui. Les lavages déjà enregistrés conservent toutefois le tarif en vigueur au moment de leur création, afin de préserver un historique juste.' },
  { q: 'Y a-t-il déjà des avis de clients ?', r: 'Pas encore. Nous préférons attendre les retours de vraies stations plutôt que d’afficher des témoignages inventés.' },
];

function DashboardPreview() {
  const stats = [
    { label: 'Chiffre d’affaires', value: '0 FCFA', icon: <FiDollarSign /> },
    { label: 'Lavages du jour', value: '0', icon: <FiTruck /> },
    { label: 'Encaissements', value: '0 FCFA', icon: <FiCreditCard /> },
    { label: 'Dépenses', value: '0 FCFA', icon: <FiPieChart /> },
  ];

  return (
    <div className="landing-dashboard" role="img" aria-label="Aperçu visuel du tableau de bord WashGuard">
      <div className="landing-dashboard-topbar">
        <div className="landing-window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span className="landing-address">washguard.app / tableau-de-bord</span>
        <span className="landing-live"><span /> Votre espace</span>
      </div>
      <div className="landing-dashboard-body">
        <aside className="landing-sidebar" aria-label="Navigation de l’aperçu">
          <div className="landing-sidebar-brand"><Logo compact /><span>WashGuard</span></div>
          {[
            ['Tableau de bord', <FiGrid />],
            ['Lavages', <FiTruck />],
            ['Prestations', <FiSettings />],
            ['Clients', <FiUsers />],
            ['Caisse', <FiDollarSign />],
            ['Rapports', <FiBarChart2 />],
          ].map(([label, icon], index) => (
            <div key={label as string} className={`landing-sidebar-link ${index === 0 ? 'is-active' : ''}`}>
              {icon as React.ReactNode}<span>{label as string}</span>
            </div>
          ))}
        </aside>
        <div className="landing-dashboard-content">
          <div className="landing-dashboard-heading">
            <div>
              <p className="landing-eyebrow">VUE D’ENSEMBLE</p>
              <h3>Tableau de bord</h3>
              <p>Les chiffres de votre station, en un seul endroit.</p>
            </div>
            <span className="landing-avatar" aria-hidden="true"><FiUsers /></span>
          </div>
          <div className="landing-stat-grid">
            {stats.map((stat) => (
              <div className="landing-stat" key={stat.label}>
                <span className="landing-stat-icon">{stat.icon}</span>
                <p>{stat.label}</p>
                <strong>{stat.value}</strong>
                <span className="landing-stat-rule" />
              </div>
            ))}
          </div>
          <div className="landing-activity">
            <div className="landing-activity-header"><div><h4>Activité récente</h4><p>Suivez les opérations de votre équipe.</p></div><span>Aujourd’hui</span></div>
            <div className="landing-activity-empty">
              <span className="landing-empty-icon"><FiTruck /></span>
              <strong>Votre activité apparaîtra ici</strong>
              <p>Aucune opération de démonstration n’est ajoutée.</p>
            </div>
          </div>
          <div className="landing-preview-note"><FiLock /><span>Vos données restent les vôtres. Les montants sont calculés à partir de vos opérations.</span></div>
        </div>
      </div>
    </div>
  );
}

function ActivityFlowPreview() {
  const stages = [
    { icon: <FiTruck />, title: 'Lavage enregistré', detail: 'Prestation · catégorie · tarif en vigueur' },
    { icon: <FiCreditCard />, title: 'Encaissement suivi', detail: 'Paiement · montant reçu · reste à payer' },
    { icon: <FiBarChart2 />, title: 'Rapport actualisé', detail: 'Activité · caisse · résultats regroupés' },
  ];

  return (
    <div className="landing-flow-card" role="img" aria-label="Schéma du suivi d’une opération, du lavage au rapport">
      <div className="landing-flow-header">
        <div><span className="landing-setup-kicker">DU TERRAIN AU RAPPORT</span><h3>Chaque opération laisse une trace.</h3></div>
        <span className="landing-flow-shield"><FiShield /></span>
      </div>
      <p className="landing-flow-intro">Un suivi cohérent, de la fiche de lavage aux résultats de la station.</p>
      <div className="landing-flow-stages">
        {stages.map((stage, index) => (
          <div className="landing-flow-stage" key={stage.title}>
            <span className="landing-flow-icon">{stage.icon}</span>
            <div><strong>{stage.title}</strong><span>{stage.detail}</span></div>
            <span className="landing-flow-number">0{index + 1}</span>
          </div>
        ))}
      </div>
      <div className="landing-flow-footer"><FiLock /><span>Les rapports regroupent les données saisies par vos équipes, jamais des exemples préremplis.</span></div>
    </div>
  );
}

function SetupPreview() {
  const steps = [
    'Identité de l’entreprise',
    'Horaires et catégories de véhicules',
    'Prestations et grille tarifaire',
    'Moyens de paiement',
    'Activation de la station',
  ];

  return (
    <div className="landing-setup-card">
      <div className="landing-setup-heading">
        <div><span className="landing-setup-kicker">APERÇU DE LA MISE EN ROUTE</span><h3>Une station configurée à votre façon</h3></div>
        <span className="landing-setup-count">0 <small>/ 13</small></span>
      </div>
      <div role="progressbar" aria-label="Avancement du parcours de mise en route" aria-valuenow={0} aria-valuemin={0} aria-valuemax={13}>
        <Progress value={0} max={13} />
      </div>
      <ul className="landing-setup-list">
        {steps.map((step, index) => (
          <li key={step}>
            <span className="landing-step-number">0{index + 1}</span>
            <span>{step}</span>
            <FiArrowDownRight aria-hidden="true" />
          </li>
        ))}
      </ul>
      <p className="landing-setup-footnote"><FiShield /> Parcours de 13 étapes. Pas de tarifs prédéfinis : vous décidez avant l’ouverture.</p>
    </div>
  );
}

export default function Landing() {
  const { plans, theme, toggleTheme } = useStore();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menu, setMenu] = useState(false);

  const closeMenu = () => setMenu(false);
  const navigation = [
    ['#fonctionnalites', 'Fonctionnalités'],
    ['#apercu', 'Aperçu'],
    ['#tarifs', 'Tarifs'],
    ['#faq', 'FAQ'],
  ];

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link to="/" aria-label="WashGuard, accueil" onClick={closeMenu}><Logo /></Link>
          <nav className="landing-desktop-nav" aria-label="Navigation principale">
            {navigation.map(([href, label]) => <a href={href} key={href}>{label}</a>)}
          </nav>
          <div className="landing-header-actions">
            <button onClick={toggleTheme} className="landing-theme-toggle" aria-label={theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre'}>
              {theme === 'dark' ? <FiSun /> : <FiMoon />}
            </button>
            <Link to="/connexion" className="landing-login">Se connecter</Link>
            <Link to="/inscription" className="landing-button landing-button-primary landing-header-cta">Créer mon espace <FiArrowRight /></Link>
            <button
              className="landing-menu-toggle"
              onClick={() => setMenu((current) => !current)}
              aria-label={menu ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={menu}
              aria-controls="landing-mobile-menu"
            >
              {menu ? <FiX /> : <span className="landing-menu-icon"><i /><i /></span>}
            </button>
          </div>
        </div>
        {menu && (
          <nav id="landing-mobile-menu" className="landing-mobile-nav" aria-label="Navigation mobile">
            {navigation.map(([href, label]) => <a href={href} key={href} onClick={closeMenu}>{label}</a>)}
            <Link to="/connexion" onClick={closeMenu}>Se connecter</Link>
            <Link to="/inscription" className="landing-mobile-cta" onClick={closeMenu}>Créer mon espace <FiArrowRight /></Link>
          </nav>
        )}
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <Badge tone="accent"><span className="landing-badge-dot" /> Gestion de station · en français · FCFA</Badge>
            <h1>Le quotidien de votre station, <span>enfin bien maîtrisé.</span></h1>
            <p className="landing-hero-description">Lavages, caisse, équipe et résultats : WashGuard rassemble vos opérations pour vous aider à piloter votre station avec clarté.</p>
            <div className="landing-hero-actions">
              <Link to="/inscription" className="landing-button landing-button-primary">Découvrir WashGuard <FiArrowRight /></Link>
              <a href="#apercu" className="landing-button landing-button-secondary">Voir l’interface <FiArrowDownRight /></a>
            </div>
            <div className="landing-hero-reassurance">
              <span><FiCheckCircle /> Essai de 14 jours</span>
              <span><FiCheckCircle /> Vos tarifs, votre choix</span>
              <span><FiCheckCircle /> Aucun avis inventé</span>
            </div>
          </div>
          <div className="landing-hero-visual">
            <div className="landing-visual-glow" />
            <DashboardPreview />
            <div className="landing-float-card"><span className="landing-float-icon"><FiShield /></span><span><strong>Conçu pour le terrain</strong><small>Des opérations suivies, pas devinées.</small></span></div>
          </div>
          <div className="landing-hero-index" aria-hidden="true"><span>01</span><i /></div>
        </section>

        <section className="landing-trust-strip" aria-label="Les engagements WashGuard">
          <div><FiLock /><span>Tarifs lus depuis la même base que la facturation</span></div>
          <div><FiFileText /><span>Historique conservé pour chaque opération</span></div>
          <div><FiShield /><span>Pas de témoignages ni de chiffres inventés</span></div>
        </section>

        <section className="landing-section landing-features" id="fonctionnalites">
          <div className="landing-section-heading">
            <div><span className="landing-section-kicker">TOUT EST À SA PLACE</span><h2>Moins de flou.<br /><span>Plus de maîtrise.</span></h2></div>
            <p>Chaque module répond à un besoin concret de la station. Ils travaillent ensemble pour vous donner une vue cohérente de l’activité.</p>
          </div>
          <div className="landing-feature-grid">
            {MODULES.map((module) => (
              <article className="landing-feature-card" key={module.number}>
                <div className="landing-feature-card-top"><span className="landing-feature-icon">{module.icon}</span><span className="landing-feature-number">{module.number}</span></div>
                <h3>{module.title}</h3>
                <p>{module.text}</p>
                <span className="landing-feature-line" />
              </article>
            ))}
          </div>
        </section>

        <section className="landing-showcase" id="apercu">
          <div className="landing-showcase-copy">
            <span className="landing-section-kicker">VOTRE STATION, EN UN COUP D’ŒIL</span>
            <h2>Une vue claire sur ce qui se passe.</h2>
            <p>Le tableau de bord rassemble les chiffres utiles : chiffre d’affaires, lavages, encaissements et dépenses. Les données présentées dans l’application proviennent de vos opérations, pas d’exemples préremplis.</p>
            <ul className="landing-check-list">
              <li><FiCheck /> Chiffres calculés à partir de vos données</li>
              <li><FiCheck /> Les opérations récentes restent traçables</li>
              <li><FiCheck /> Une interface adaptée aux écrans du quotidien</li>
            </ul>
            <Link to="/inscription" className="landing-text-link">Créer mon espace <FiArrowRight /></Link>
          </div>
          <div className="landing-showcase-visual"><ActivityFlowPreview /></div>
        </section>

        <section className="landing-setup-section">
          <div className="landing-setup-copy">
            <span className="landing-section-kicker">VOUS GARDEZ LA MAIN</span>
            <h2>Prêt quand <span>vous l’êtes.</span></h2>
            <p>Configurez l’identité de la station, ses prestations, ses tarifs et ses moyens de paiement. L’activation attend que les éléments obligatoires soient réellement renseignés.</p>
            <div className="landing-setup-note"><FiShield /><span>Aucun tarif n’est imposé. Les écritures de gestion restent verrouillées tant que la station n’est pas activée.</span></div>
            <Link to="/inscription" className="landing-button landing-button-secondary">Commencer la mise en route <FiArrowRight /></Link>
          </div>
          <SetupPreview />
        </section>

        <section className="landing-pricing-section" id="tarifs">
          <div className="landing-section-heading landing-pricing-heading">
            <div><span className="landing-section-kicker">DES FORMULES CLAIRES</span><h2>Choisissez votre rythme.</h2></div>
            <p>Les formules et les montants ci-dessous sont ceux utilisés par l’application et la facturation.</p>
          </div>
          <div className="landing-pricing-grid">
            {plans.map((plan) => {
              const featured = plan.id === 'standard';
              return (
                <article key={plan.id} className={`landing-price-card ${featured ? 'is-featured' : ''}`}>
                  {plan.trial && <span className="landing-plan-tag">14 JOURS D’ESSAI</span>}
                  <div className="landing-plan-header"><h3>{plan.name}</h3><span>{plan.trial ? 'Pour démarrer' : 'Sans surprise'}</span></div>
                  <p className="landing-plan-description">{plan.trial ? 'Prenez le temps de configurer votre station.' : 'La gestion complète de votre activité, chaque mois.'}</p>
                  <p className="landing-price">{formatFCFA(plan.priceMonthly)}<span>{plan.trial ? ' / 14 jours' : ' / mois'}</span></p>
                  <div className="landing-plan-divider" />
                  <ul>
                    {plan.features.map((feature) =>                     <li key={feature}><FiCheck /><span>{feature}</span></li>)}
                  </ul>
                  <Link to="/inscription" className={`landing-button ${featured ? 'landing-button-primary' : 'landing-button-secondary'}`}>
                    {plan.trial ? 'Commencer l’essai' : `Choisir ${plan.name}`} <FiArrowRight />
                  </Link>
                </article>
              );
            })}
          </div>
          <p className="landing-pricing-footnote">Les tarifs de lavage sont définis par chaque station pendant la mise en route.</p>
        </section>

        <section className="landing-honesty">
          <div className="landing-honesty-icon"><FiShield /></div>
          <div><span className="landing-section-kicker">LA CONFIANCE SE MÉRITE</span><h2>Pas de témoignages inventés.</h2><p>Les avis viendront de vraies stations, quand elles auront quelque chose à raconter. En attendant, nous préférons vous montrer ce que le produit fait réellement.</p></div>
          <a href="#apercu" className="landing-text-link">Voir le produit <FiArrowRight /></a>
        </section>

        <section className="landing-faq-section" id="faq">
          <div className="landing-faq-intro"><span className="landing-section-kicker">BESOIN DE SAVOIR</span><h2>Questions fréquentes.</h2><p>Des réponses directes sur l’utilisation de WashGuard.</p></div>
          <div className="landing-faq-list">
            {FAQ.map((item, index) => (
              <article className={`landing-faq-item ${openFaq === index ? 'is-open' : ''}`} key={item.q}>
                <h3>
                  <button aria-expanded={openFaq === index} aria-controls={`landing-faq-answer-${index}`} onClick={() => setOpenFaq(openFaq === index ? null : index)}>
                    <span>{item.q}</span><FiChevronDown aria-hidden="true" />
                  </button>
                </h3>
                {openFaq === index && <p id={`landing-faq-answer-${index}`} className="landing-faq-answer">{item.r}</p>}
              </article>
            ))}
          </div>
        </section>

        <section className="landing-final-cta">
          <div className="landing-cta-glow" />
          <div className="landing-final-cta-content">
            <span className="landing-section-kicker">ON Y VA ?</span>
            <h2>La prochaine étape,<br /><span>c’est votre station.</span></h2>
            <p>Créez votre espace, renseignez vos tarifs et avancez à votre rythme.</p>
            <Link to="/inscription" className="landing-button landing-button-light">Créer mon espace <FiArrowRight /></Link>
          </div>
          <div className="landing-cta-mark" aria-hidden="true"><Logo compact /></div>
        </section>
      </main>

      <footer className="landing-footer">
        <Link to="/" aria-label="WashGuard, accueil"><Logo /></Link>
        <p>© {new Date().getFullYear()} WashGuard <span>·</span> Interface en français <span>·</span> Montants en FCFA</p>
        <nav aria-label="Liens de pied de page"><a href="#fonctionnalites">Fonctionnalités</a><a href="#tarifs">Tarifs</a><Link to="/connexion">Connexion</Link></nav>
      </footer>
    </div>
  );
}
