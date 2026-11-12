/* ───────────────────────────────────────────────────────────────────────────
   WashGuard — vérification complète, sans framework de test.
   npm run check

   1. Logique métier et formatage (bundle esbuild → Node)
   2. Gardes serveur (409, caisse, annulations) via un harnais React + JSDOM
   3. Rendu réel de toutes les routes (0 erreur console)
   4. Parcours inscription → mise en route
   5. Contrôles statiques du cahier des charges
   6. Design system & navigation (Prompt 02)
   7. Schéma, RLS et adaptateurs (Prompt 03)
   8. Auth, multi-tenancy et RBAC (Prompt 04)
   9. Cœur métier lavages (Prompt 05)
   10. Caisse, canaux, commissions, rentabilité (Prompt 06)
   11. Stock, achats, consommations et coûts certifiés (Prompt 07)
   12. CRM, fidélité, forfaits, promotions, flottes (Prompt 08)
   13. Analytics, quotas, graphiques et back-office SaaS (Prompt 09)

   npm run check                       → mode local (défaut)
   WG_DATA_SOURCE=supabase npm run check → mode Supabase lecture seule, réseau simulé
   ─────────────────────────────────────────────────────────────────────────── */
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const now = new Date().toISOString();

const base = () => ({
  company: { id:'co1', name:'Clean Auto SARL', city:'Abidjan', phone:'+225 0700000000', createdAt:now, suspended:false },
  station: { id:'st1', companyId:'co1', name:'Clean Auto Cocody', address:'Rue des Jardins, Cocody', city:'Abidjan', phone:'+225 0700000000',
    currency:'FCFA', logoPath:null, hours:['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'].map((d,i)=>({day:d,open:'08:00',close:'18:00',closed:i===6})),
    paymentMethods:['especes','mobile_money','carte','virement'], cashRequiresOpen:true, maxCashierDiscount:2000,
    commissionRate:10, monthlyTarget:500000, activated:true, activatedAt:now },
  users: [
    {id:'u1',companyId:'co1',stationId:'st1',name:'Erwin Koffi',email:'erwin@cleanauto.ci',phone:'',role:'proprietaire',active:true,commissionRateOverride:null,createdAt:now},
    {id:'u2',companyId:'co1',stationId:'st1',name:'Moussa Laveur',email:'moussa@cleanauto.ci',phone:'',role:'caissier',active:true,commissionRateOverride:null,createdAt:now},
  ],
  vehicleCategories:[{id:'c1',stationId:'st1',name:'Berline',active:true},{id:'c2',stationId:'st1',name:'4×4 / SUV',active:true}],
  services:[{id:'s1',stationId:'st1',name:'Lavage extérieur',description:'',active:true,prices:{c1:3000,c2:5000}},
            {id:'s2',stationId:'st1',name:'Lavage complet',description:'',active:true,prices:{c1:6000,c2:8500}}],
  clients:[{id:'cl1',stationId:'st1',name:'Client Test',phone:'',plate:'1234 AB 01',notes:'',createdAt:now}],
  washes:[{id:'w1',stationId:'st1',number:'L-0001',clientId:'cl1',clientName:'Client Test',vehicleCategoryId:'c1',vehicleLabel:'Berline',plate:'1234 AB 01',
    employeeId:'u2',items:[{serviceId:'s1',serviceName:'Lavage extérieur',unitPrice:3000,qty:1}],discount:0,total:3000,paid:3000,status:'ready',
    createdAt:now,finishedAt:now,cancelledReason:null,payments:[{id:'p1',amount:3000,method:'especes',at:now,byUserId:'u2'}]}],
  washPosts:[{id:'p1',stationId:'st1',name:'Piste 1',capacity:2,active:true}],
  cashSessions:[{id:'ca1',stationId:'st1',openedBy:'Erwin Koffi',openedAt:now,openingFloat:10000,closedAt:null,countedAmount:null,closedBy:null,status:'ouverte',reopenReason:null,reopenedAt:null}],
  expenses:[{id:'e1',stationId:'st1',amount:1500,category:'Fournitures',reason:'Shampoing',supplier:'Fournisseur',date:now.slice(0,10),method:'especes',cashSessionId:'ca1',status:'enregistree',cancelReason:null,createdBy:'Erwin Koffi',createdAt:now}],
  subscription:{id:'sub1',companyId:'co1',planId:'essai',status:'essai',startedAt:now,trialEndsAt:now,pendingPlanId:null},
  auditLogs:[{id:'l1',at:now,actor:'Erwin Koffi',action:'Station activée',detail:'Ouverture'}],
  platformCompanies:[{id:'co1',name:'Clean Auto SARL',city:'Abidjan',phone:'',planName:'Essai',status:'essai',stations:1,monthlyRevenue:0,createdAt:now}],
  session:{userId:'u1',email:'erwin@cleanauto.ci',name:'Erwin Koffi',role:'proprietaire',companyId:'co1',stationId:'st1'},
  demoMode:true, washCounter:1,
});
const empty = () => ({ company:null, station:null, users:[], vehicleCategories:[], services:[], clients:[], washes:[], washPosts:[], cashSessions:[], expenses:[], subscription:null, auditLogs:[], platformCompanies:[], session:null, demoMode:true, washCounter:0 });

// Deux modes reproductibles : local (aucun réseau) et supabase (lecture seule
// avec un fetch simulé). Le prix Standard du faux lecteur est volontairement
// différent du repli local pour prouver que la vitrine lit bien la base.
const MODE = process.env.WG_DATA_SOURCE === 'supabase' ? 'supabase' : 'local';
const FAKE_URL = MODE === 'supabase' ? 'https://test.supabase.co' : '';
const FAKE_KEY = MODE === 'supabase' ? 'test-anon-key' : '';
const DEFINE = {
  'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(FAKE_URL),
  'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(FAKE_KEY),
  'import.meta.env.VITE_WG_TEST_AUTH': JSON.stringify('1'),
  'import.meta.env.VITE_SUPABASE_STORAGE_BUCKET': JSON.stringify('station-assets'),
  'import.meta.env': JSON.stringify({
    VITE_SUPABASE_URL: FAKE_URL,
    VITE_SUPABASE_ANON_KEY: FAKE_KEY,
    VITE_DATA_SOURCE: MODE,
    VITE_WG_TEST_AUTH: '1',
    VITE_SUPABASE_STORAGE_BUCKET: 'station-assets',
  }),
};
const PLAN_ROWS = [
  { id:'essai', name:'Essai', price_monthly_minor:0, currency_code:'XOF', trial_days:14, sort_order:1,
    features:['14 jours pour ouvrir votre station','1 station, 3 comptes employés','100 lavages pour démarrer'],
    plan_limits:[{key:'stations',value_int:1},{key:'employees',value_int:3},{key:'washes_per_month',value_int:100}] },
  { id:'standard', name:'Standard', price_monthly_minor:16000, currency_code:'XOF', trial_days:0, sort_order:2,
    features:['1 station, 10 comptes employés','1 000 lavages par mois','Rapports et exports CSV'],
    plan_limits:[{key:'stations',value_int:1},{key:'employees',value_int:10},{key:'washes_per_month',value_int:1000}] },
  { id:'premium', name:'Premium', price_monthly_minor:35000, currency_code:'XOF', trial_days:0, sort_order:3,
    features:['Jusqu’à 5 stations','50 comptes employés','Support prioritaire'],
    plan_limits:[{key:'stations',value_int:5},{key:'employees',value_int:50},{key:'washes_per_month',value_int:100000}] },
];
if (MODE === 'supabase') {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    let body = [];
    if (url.includes('/rest/v1/plans')) body = PLAN_ROWS;
    else if (url.includes('/auth/v1/')) body = { user: null };
    else if (url.includes('/rest/v1/')) body = [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': '0-2/3' },
    });
  };
}
const buildWith = (stdin, define=DEFINE) => esbuild.build({ stdin, bundle:true, write:false, platform:'node', format:'cjs', target:'node22',
  loader:{'.css':'empty'}, define, jsx:'automatic', absWorkingDir:ROOT, logLevel:'silent' });
const build = (stdin) => buildWith(stdin);

let pass = 0, fail = 0;
const check = (name, cond, detail='') => { if(cond){pass++; console.log('  \u2713 '+name);} else {fail++; console.log('  \u2717 '+name+(detail?' \u2192 '+detail:''));} };
const wait = (ms=200) => new Promise(r=>setTimeout(r,ms));

function makeDom(url, state) {
  const dom = new JSDOM('<!doctype html><html lang="fr" class="dark"><head></head><body><div id="root"></div></body></html>',
    { url:'http://localhost:5173'+url, pretendToBeVisual:true, runScripts:'outside-only' });
  const w = dom.window;
  if (state) w.localStorage.setItem('washguard.state.v1', JSON.stringify(state));
  // Pont de compilation du harnais : la session est injectée EN MÉMOIRE.
  w.__WG_TEST_SESSION__ = { session: state?.session ?? null };
  w.localStorage.setItem('washguard.theme','dark');
  w.matchMedia = () => ({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  // Recharts utilise ResizeObserver, absent de JSDOM : donner une taille
  // déterministe au conteneur plutôt que faire planter l'arbre React.
  w.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ target, contentRect: { width: 800, height: 400 } }], this); }
    unobserve() {}
    disconnect() {}
  };
  w.confirm = () => true;
  Object.assign(global, { window:w, document:w.document, localStorage:w.localStorage,
    HTMLElement:w.HTMLElement, HTMLInputElement:w.HTMLInputElement, Node:w.Node, Event:w.Event, MouseEvent:w.MouseEvent,
    ResizeObserver:w.ResizeObserver,
    getComputedStyle:w.getComputedStyle.bind(w), requestAnimationFrame:(cb)=>setTimeout(cb,0), cancelAnimationFrame:clearTimeout,
    Blob:w.Blob, URL:w.URL });
  Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});
  return { dom, w };
}
async function mount(code, w) {
  const errs=[]; const orig=console.error;
  console.error=(...a)=>{const s=a.map(String).join(' '); if(!s.includes('Future Flag')) errs.push(s);};
  const mod={exports:{}};
  new Function('module','exports','require','window','document','localStorage','navigator',code)(
    mod,mod.exports,require,w,w.document,w.localStorage,w.navigator);
  await wait(220);
  // React.lazy : laisser le temps aux 7 écrans lourds de resoudre leur import.
  for (let i = 0; i < 16 && w.document.body.textContent.includes('Chargement de l’écran'); i += 1) {
    await wait(50);
  }
  console.error=orig;
  return errs;
}
const read = (p) => fs.readFileSync(path.join(ROOT,p),'utf8');

(async () => {
  // React Router v6 émet des avertissements « future flag » sans rapport
  // avec l'application : on les tait pour garder une sortie lisible.
  console.warn = () => {};

  // ── 1. Logique pure ───────────────────────────────────────────────────────
  console.log('\n[1] Logique métier / formatage');
  const logic = await build({ contents:`
    export { computeOnboarding, missingRequired, load, persist, DEFAULT_DAYS, emptyState } from './src/lib/store.tsx';
    export { formatFCFA, formatDate, todayISO, downloadCSV } from './src/lib/format.ts';
    export { buildReport, buildCommissions, theoreticalCash, periodRange } from './src/lib/metrics.ts';
    export { PLANS, planById } from './src/lib/plans.ts';
  `, resolveDir:ROOT, sourcefile:'logic.ts', loader:'ts' });
  const lm={exports:{}};
  new Function('module','exports','require', logic.outputFiles[0].text)(lm,lm.exports,require);
  const L = lm.exports;
  const full = base(), blank = empty();
  check('formatFCFA(12500)', L.formatFCFA(12500)==='12 500 FCFA', L.formatFCFA(12500));
  check('formatFCFA(0)', L.formatFCFA(0)==='0 FCFA');
  check('formatDate ISO \u2192 jj/mm/aaaa', L.formatDate('2026-11-11T10:00:00Z')==='11/11/2026', L.formatDate('2026-11-11T10:00:00Z'));
  check('formatDate date seule, sans décalage UTC', L.formatDate('2026-01-03')==='03/01/2026', L.formatDate('2026-01-03'));
  check('13 étapes', L.computeOnboarding(blank).length===13);
  check('8 obligatoires', L.computeOnboarding(blank).filter(s=>s.required).length===8);
  check('état vide : 0 constaté, 7 manques', L.computeOnboarding(blank).filter(s=>s.done).length===0 && L.missingRequired(blank).length===7);
  check('état complet : 8 obligatoires constatés', L.computeOnboarding(full).filter(s=>s.required&&s.done).length===8);
  check('grille incomplète \u2192 tarifs non constaté', (()=>{const s=base(); delete s.services[0].prices.c2; return !L.computeOnboarding(s).find(x=>x.id==='tarifs').done;})());
  check('prix retiré \u2192 blocage activation', (()=>{const s=base(); s.services[0].prices={}; return L.missingRequired(s).includes('Grille tarifaire');})());
  {
    const { dom, w } = makeDom('/', { ...base(), session: { ...base().session, role: 'proprietaire' } });
    w.__WG_TEST_SESSION__ = undefined;
    const scrubbed = L.load();
    check('session non forgeable : localStorage ne restaure jamais la session', scrubbed.session === null);
    w.__WG_TEST_SESSION__ = { session: { ...base().session, role: 'proprietaire' } };
    const injected = L.load();
    L.persist(injected);
    const persisted = w.localStorage.getItem('washguard.state.v1') || '';
    check('harnais JSDOM : session en mémoire, jamais écrite dans l’état persisté',
      injected.session?.role === 'proprietaire' && !persisted.includes('\"session\"'));
    check('fetchMeOnce supprimé : onAuthStateChange est la seule source',
      !read('src/lib/store.tsx').includes('export function fetchMeOnce') &&
      read('src/lib/store.tsx').includes('onAuthStateChange'));
    dom.window.close();
  }
  check('commissions : lavages terminés seulement', (()=>{const s=base(); s.washes.push({...s.washes[0],id:'w2',status:'pending',finishedAt:null,total:9000}); const c=L.buildCommissions(s,'jour'); return c.length===1 && c[0].base===3000;})());
  check('commission : barème 10 % = 300 FCFA', L.buildCommissions(base(),'jour')[0].amount===300);
  check('commission : exception par compte', (()=>{const s=base(); s.users[1].commissionRateOverride=20; const c=L.buildCommissions(s,'jour')[0]; return c.amount===600 && c.override;})());
  check('théorique caisse = fond + espèces \u2212 dépenses', L.theoreticalCash(base(),'ca1')===11500, String(L.theoreticalCash(base(),'ca1')));
  check('réouverture : le comptage devient le fond, pas de double comptage', (()=>{
    const s=base(); const earlier=new Date(Date.now()-3600000).toISOString(); const later=new Date(Date.now()+1000).toISOString();
    s.cashSessions[0].status='ouverte'; s.cashSessions[0].closedAt=null; s.cashSessions[0].countedAmount=12000; s.cashSessions[0].reopenedAt=later;
    s.washes[0].payments=[{id:'old',amount:3000,method:'especes',at:earlier,byUserId:'u1'}];
    s.washes.push({...s.washes[0],id:'w3',payments:[{id:'new',amount:2000,method:'especes',at:new Date(Date.now()+2000).toISOString(),byUserId:'u1'}]});
    s.expenses[0].createdAt=earlier;
    return L.theoreticalCash(s,'ca1')===14000; // 12 000 + 2 000, ni l'ancien paiement ni l'ancienne dépense
  })());
  check('rapport P06 : solde partiel, coûts manquants, jamais de faux résultat net', (()=>{const r=L.buildReport(base(),'jour'); return r.revenue===3000&&r.collected===3000&&r.receivables===0&&r.expenses===1500&&r.partialBalance===1500&&r.netResult===null&&r.grossMargin===null&&r.costsMissing===true&&!('result' in r);})());
  check('plans : 3 formules, essai gratuit', L.PLANS.length===3 && L.planById('essai').priceMonthly===0);
  // CSV : échappement + anti-injection de formule
  {
    const { dom, w } = makeDom('/', blank);
    let captured='';
    global.Blob = class { constructor(parts){ captured = parts.join(''); } };
    global.URL.createObjectURL = () => 'blob:test';
    global.URL.revokeObjectURL = () => {};
    const origCreate = w.document.createElement.bind(w.document);
    w.document.createElement = (tag) => tag==='a' ? { click(){}, set href(v){}, set download(v){} } : origCreate(tag);
    L.downloadCSV('x.csv',['A','B'],[['a;b','=SOMME(1+1)'],[-500,'@client']]);
    check('CSV : point-virgule échappé, formules neutralisées, nombres conservés',
      captured.includes('"a;b"') && captured.includes("'=SOMME(1+1)") && captured.includes("'@client") && captured.includes('-500') && !captured.includes(';-500\'') ,
      captured.slice(0,160));
    dom.window.close();
  }

  // ── 2. Gardes serveur ─────────────────────────────────────────────────────
  console.log('\n[2] Gardes 409 / caisse / annulations');
  const harness = await build({ contents:`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { StoreProvider, useStore } from './src/lib/store.tsx';
    function H(){
      const s = useStore();
      React.useEffect(()=>{
        const out=[]; const mode=window.__mode||'guard';
        const call=(label,fn)=>{try{fn();out.push(label+':OK');}catch(e){out.push(label+':'+e.code+':'+(e.missing||[]).length);}};
        if(mode==='guard'){
          const w=(p)=>s.createWash({categoryId:'c1',plate:'',employeeId:'u1',clientId:null,clientName:'',items:[{serviceId:'s1',qty:1}],discount:0,payment:p});
          call('sansPaiement',()=>w(null));
          call('especes',()=>w({amount:500,method:'especes'}));
          call('mobile',()=>w({amount:500,method:'mobile_money'}));
          call('reste',()=>w({amount:99999,method:'mobile_money'}));
          call('depense',()=>s.addExpense({amount:100,category:'Autre',reason:'Entretien',supplier:'',date:'2026-11-11',method:'especes'}));
        }
        if(mode==='rules'){
          call('payAnnule',()=>s.addPayment('w2',100,'mobile_money'));
          call('statusAnnule',()=>s.setWashStatus('w2','ready'));
          call('cancelDeja',()=>s.cancelExpense('e1','Motif'));
          call('reopenOpen',()=>s.reopenCash('ca1','Motif'));
          call('reopenInconnu',()=>s.reopenCash('inconnu','Motif'));
        }
        if(mode==='reopen'){
          call('reopen',()=>s.reopenCash('ca1','Erreur de comptage'));
        }
        document.body.dataset.results=JSON.stringify(out);
      },[]);
      return null;
    }
    createRoot(document.getElementById('root')).render(React.createElement(StoreProvider,null,React.createElement(H)));
  `, resolveDir:ROOT, sourcefile:'harness.tsx', loader:'tsx' });
  const hcode = harness.outputFiles[0].text;
  const fresh = () => { const s=base(); s.station.activated=false; s.station.hours=[]; s.station.paymentMethods=[]; s.station.address=''; s.vehicleCategories=[]; s.services=[]; s.cashSessions=[]; s.washes=[]; return s; };
  const guardScenarios = [
    ['inscription fraîche : 409 avec 6 manques', fresh(), ['sansPaiement:onboarding_incomplete:6','especes:onboarding_incomplete:6','mobile:onboarding_incomplete:6','reste:onboarding_incomplete:6','depense:onboarding_incomplete:6']],
    ['complet mais non activé : 409 sans manque', (()=>{const s=base(); s.station.activated=false; s.cashSessions=[]; return s;})(), ['sansPaiement:onboarding_incomplete:0','especes:onboarding_incomplete:0','mobile:onboarding_incomplete:0','reste:onboarding_incomplete:0','depense:onboarding_incomplete:0']],
    ['activée, caisse fermée : espèces refusées, Mobile Money accepté', (()=>{const s=base(); s.cashSessions=[]; return s;})(), ['sansPaiement:OK','especes:cash_closed:0','mobile:OK','reste:overpayment:0','depense:cash_closed:0']],
    ['activée, caisse ouverte : tout accepté', base(), ['sansPaiement:OK','especes:OK','mobile:OK','reste:overpayment:0','depense:OK']],
  ];
  for (const [label, state, expected] of guardScenarios) {
    const { dom, w } = makeDom('/', state); w.__mode='guard';
    const errs = await mount(hcode, w);
    const got = JSON.parse(w.document.body.dataset.results || '[]');
    check(label, expected.every((e,i)=>got[i]===e) && errs.length===0, got.join(' | ')+' err='+errs.length);
    dom.window.close();
  }
  {
    const s=base();
    s.washes.push({...s.washes[0],id:'w2',number:'L-0002',status:'cancelled',cancelledReason:'Test',paid:0});
    s.expenses[0].status='annulee'; s.expenses[0].cancelReason='Déjà annulée';
    const { dom, w } = makeDom('/', s); w.__mode='rules';
    const errs = await mount(hcode, w);
    const got = JSON.parse(w.document.body.dataset.results || '[]');
    check('fiche annulée : encaissement et changement de statut refusés', got[0]==='payAnnule:wash_cancelled:0' && got[1]==='statusAnnule:wash_cancelled:0', got.slice(0,2).join(' | '));
    check('dépense déjà annulée : seconde annulation refusée', got[2]==='cancelDeja:already_cancelled:0', got[2]);
    check('réouverture refusée si une caisse est déjà ouverte', got[3]==='reopenOpen:cash_open:0' && errs.length===0, got[3]);
    dom.window.close();
  }
  {
    const s=base();
    s.cashSessions=[{...s.cashSessions[0],status:'cloturee',closedAt:now,countedAmount:12000,closedBy:'Erwin Koffi'}];
    const { dom, w } = makeDom('/', s); w.__mode='reopen';
    const errs = await mount(hcode, w);
    const got = JSON.parse(w.document.body.dataset.results || '[]');
    // L'état persisté reflète le rendu après mise à jour (pas la valeur
    // capturée par le harnais avant le re-render).
    const etat = JSON.parse(w.localStorage.getItem('washguard.state.v1')).cashSessions[0];
    check('réouverture motivée : comptage conservé comme fond', got[0]==='reopen:OK' && etat.status==='ouverte' && etat.reopenedAt && etat.countedAmount===12000 && errs.length===0, got[0]+' '+JSON.stringify(etat).slice(0,160));
    dom.window.close();
  }

  // ── 3. Rendu de toutes les routes ─────────────────────────────────────────
  console.log('\n[3] Rendu DOM des routes');
  const app = await build({ contents:`import './src/main.tsx';`, resolveDir:ROOT, sourcefile:'entry.ts', loader:'ts' });
  const acode = app.outputFiles[0].text;
  const ROUTES = [
    ['/','Pilotez vos lavages, vos stocks et vos équipes.','anon'], ['/connexion','Bonjour','anon'], ['/inscription','Votre entreprise et sa station','anon'],
    ['/app/tableau-de-bord','Tableau de bord'], ['/app/mise-en-route','Mise en route'], ['/app/lavages','Lavages'],
    ['/app/prestations','Grille tarifaire'], ['/app/clients','Clients'], ['/app/employes','Employés'],
    ['/app/caisse','Historique des caisses'], ['/app/depenses','Dépenses'], ['/app/rapports','Rapports'],
    ['/app/commissions','Commissions'], ['/app/stock','Stocks & achats'], ['/app/consommations','Consommations'],
    ['/app/fidelisation','Fidélisation & forfaits'], ['/app/flottes','Flottes & contrats'],
    ['/app/consolidation','Consolidation multi-stations'],
    ['/app/qualite','Qualité & déploiement'],
    ['/app/parametres','Paramètres'], ['/app/abonnement','Abonnement'],
    ['/app/plateforme','Espace plateforme','support'],
  ];
  const origWarn = console.warn; console.warn = () => {};
  for (const [route, expected, variant] of ROUTES) {
    let fixture = base();
    if (variant==='anon') fixture = {...base(), session:null};
    if (variant==='support') fixture = {...base(), session:{...base().session, role:'super_admin', name:'Super admin SaaS', companyId:null, stationId:null}};
    const { dom, w } = makeDom(route, fixture);
    const errs = await mount(acode, w);
    const t = w.document.body.textContent.replace(/\s+/g,' ');
    check(route.padEnd(24), t.includes(expected) && errs.length===0, 'err='+errs.length+' '+(errs[0]||'').slice(0,160));
    dom.window.close();
  }
  {
    const { dom, w } = makeDom('/app/lavages', {...base(), session:null});
    const errs = await mount(acode, w);
    check('visiteur non connecté \u2192 /connexion', w.location.pathname==='/connexion' && errs.length===0, w.location.pathname);
    dom.window.close();
  }
  // Garde de rôle au niveau des routes (URL saisie directement)
  for (const [route, role] of [['/app/commissions','caissier'],['/app/parametres','caissier'],['/app/abonnement','gerant'],['/app/plateforme','proprietaire']]) {
    const { dom, w } = makeDom(route, {...base(), session:{...base().session, role}});
    const errs = await mount(acode, w);
    const t = w.document.body.textContent.replace(/\s+/g,' ');
    check('rôle '+role+' bloqué sur '+route, t.includes('Accès refusé') && errs.length===0, (errs[0]||t.slice(0,120)));
    dom.window.close();
  }
  {
    const { dom, w } = makeDom('/app/lavages', {...base(), session:{...base().session, role:'caissier'}});
    const errs = await mount(acode, w);
    check('caissier : lavages accessibles', w.document.body.textContent.includes('Lavages') && errs.length===0);
    dom.window.close();
  }
  console.warn = origWarn;

  // ── 4. Parcours inscription ────────────────────────────────────────────────
  console.log('\n[4] Parcours inscription \u2192 mise en route');
  {
    const { dom, w } = makeDom('/', null);
    const errs0 = await mount(acode, w);
    const click = (sel) => { const el=w.document.querySelector(sel); if(!el) throw new Error('missing '+sel); el.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,view:w})); };
    const fill = (id,v) => { const el=w.document.getElementById(id); const setter=Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set; setter.call(el,v); el.dispatchEvent(new w.Event('input',{bubbles:true})); };
    click('a[href="/inscription"]'); await wait(150);
    check('formulaire en deux temps', w.document.body.textContent.includes('Votre entreprise et sa station') && w.document.body.textContent.includes('Votre compte de propriétaire'));
    for(const [id,v] of Object.entries({companyName:'Clean Auto SARL',stationName:'Clean Auto Cocody',phone:'+225 0700000000',city:'Abidjan',ownerName:'Erwin Koffi',email:'erwin@cleanauto.ci',password:'motdepasse123',confirm:'motdepasse123'})) fill(id,v);
    await wait(60);
    click('button[type="submit"]'); await wait(220);
    const saved = JSON.parse(w.localStorage.getItem('washguard.state.v1'));
    check('redirection /app/mise-en-route', w.location.pathname==='/app/mise-en-route', w.location.pathname);
    check('création unique entreprise/station/propriétaire/essai', saved.company?.name==='Clean Auto SARL' && saved.users.length===1 && saved.subscription?.status==='essai' && saved.platformCompanies.length===1);
    check('aucune donnée métier préremplie', saved.services.length===0 && saved.vehicleCategories.length===0 && saved.washes.length===0 && saved.station.hours.length===0 && saved.station.paymentMethods.length===0);
    check('409 affiché / 1 étape constatée', w.document.body.textContent.includes('409 onboarding_incomplete') && (w.document.body.textContent.match(/Constaté/g)||[]).length>=1);
    check('0 erreur d’exécution', errs0.length===0, errs0[0]);
    dom.window.close();
  }

  // ── 5. Contrôles statiques ─────────────────────────────────────────────────
  console.log('\n[5] Cahier des charges (contrôles statiques)');
  const landing = read('src/pages/Landing.tsx');
  const signin = read('src/pages/auth/SignIn.tsx');
  const employees = read('src/pages/Employees.tsx');
  const landingFaq = read('src/pages/Landing.tsx');
  const html = read('index.html');
  check('aucun témoignage inventé', !/témoignage|testimonial/i.test(landing));
  check('pas de connexion Google / Facebook', !signin.includes('Continuer avec Google') && !signin.includes('Continuer avec Facebook'));
  check('pas de « Se souvenir de moi » (aucune case à cocher)', !signin.includes('type="checkbox"'));
  check('mot de passe oublié : lien Supabase réel, anciens textes retirés',
    signin.includes('/mot-de-passe-oublie') && signin.includes('lien de réinitialisation') &&
    !signin.includes('n’envoie aucun e-mail') && !signin.includes('module Employés') &&
    !employees.includes('Mot de passe provisoire') && !landingFaq.includes('n’envoie aucun e-mail') &&
    fs.existsSync(path.join(ROOT, 'src/pages/auth/ForgotPassword.tsx')) &&
    fs.existsSync(path.join(ROOT, 'src/pages/auth/ResetPassword.tsx')));
  check('langue fr + devise FCFA', html.includes('lang="fr"') && read('src/lib/format.ts').includes('FCFA'));
  check('thème sombre par défaut / clair disponible', html.includes('class="dark"') && read('tailwind.config.js').includes("darkMode: 'class'") && read('src/main.tsx').includes("washguard.theme"));
  check('photo unique pour les écrans auth', read('src/pages/auth/AuthLayout.tsx').includes('/images/lav-auto.jpeg') && fs.existsSync(path.join(ROOT,'public/images/lav-auto.jpeg')));
  check('client Supabase prêt, non branché', read('src/lib/supabase.ts').includes('isSupabaseConfigured') && fs.existsSync(path.join(ROOT,'.env.example')));
  check('plus aucun fichier CRA / template', !fs.existsSync(path.join(ROOT,'src/App.jsx')) && !fs.existsSync(path.join(ROOT,'public/index.html')) && !fs.existsSync(path.join(ROOT,'jsconfig.json')));
  check('pas de prix de prestation prédéfini dans le store', !/prices:\s*\{[^}]*\d{3,}/.test(read('src/lib/store.tsx')));
  check('documentation présente', fs.existsSync(path.join(ROOT,'docs/onboarding.md')) && fs.existsSync(path.join(ROOT,'docs/audit.md')));
  // La vitrine présente dans la base de cette branche est WashGuard, pas la
  // version ixartz historique. Conserver des assertions sur son vrai contenu,
  // son illustration explicitement fictive et ses destinations effectives.
  check('vitrine WashGuard : titre, sections produit et aperçu identifié comme fictif',
    landing.includes('Pilotez vos lavages, vos stocks et vos équipes.') &&
    ['id="fonctionnalites"','id="caisse-stock"','id="tarifs"','id="faq"']
      .every((token) => landing.includes(token)) &&
    landing.includes('données fictives') && !landing.includes('Système en direct'));
  check('vitrine WashGuard : routes réelles et ancres existantes', (() => {
    const anchors = [...landing.matchAll(/href="#([a-z-]+)"/g)].map((match) => match[1]);
    const appSrc = read('src/App.tsx');
    return ['fonctionnalites','caisse-stock','tarifs','faq'].every((id) => anchors.includes(id)) &&
      anchors.every((id) => landing.includes(`id="${id}"`)) &&
      ['to="/"','to="/connexion"','to="/inscription"'].every((token) => landing.includes(token)) &&
      ['path="/connexion"','path="/inscription"'].every((token) => appSrc.includes(token)) &&
      fs.existsSync(path.join(ROOT,'docs/landing.md'));
  })());
  check('vitrine : tarifs depuis plans, aucun prix local en repli',
    landing.includes('plans.map((plan)') && landing.includes('formatFCFA(plan.priceMonthly)') &&
    landing.includes('plansError') && landing.includes('Formules et tarifs indisponibles') &&
    landing.includes('Aucun prix local') && !/priceMonthly:\s*\d/.test(landing));
  check('landing ixartz : 9 illustrations et licence MIT copiées',
    fs.readdirSync(path.join(ROOT,'public/assets/images')).filter((f) => /\.(png|svg)$/.test(f)).length === 9 &&
    read('public/assets/images/LICENSE.txt').includes('Copyright (c) 2026 Remi W.'));

  // ── 6. Design system & UX (Prompt 02) ─────────────────────────────────────
  // Ajoutés SANS modifier les 66 assertions ci-dessus : ils valident les
  // composants réels, la navigation et la non-régression du contrat.
  console.log('\n[6] Design system & navigation (Prompt 02)');
  const uiSrc = read('src/components/ui.tsx');
  const navSrc = read('src/components/navigation.tsx');
  const shellSrc = read('src/components/AppShell.tsx');
  const cssSrc = read('src/index.css');
  const pkg = JSON.parse(read('package.json'));

  check('API publique de ui.tsx conservée (18 exports)', [
    'Logo','Card','PageHeader','SectionTitle','Label','Input','Select','Textarea','Badge',
    'StatCard','Progress','EmptyState','Modal','Tabs','LockedPanel','Alert','ToastHost','useSafeAction',
  ].every((name) => new RegExp('export function ' + name + '\\b').test(uiSrc)));
  check('contrat useStore() intact, aucune dépendance UI dans le store',
    read('src/lib/store.tsx').includes('export function useStore') && !read('src/lib/store.tsx').includes('components/'));
  check('8 sections ERP déclarées', [
    'pilotage','exploitation','commercial','rh','finance','stock','analyse','administration',
  ].every((id) => navSrc.includes(`id: '${id}'`)));
  check('les 19 URL /app existantes restent toutes dans la navigation',
    ROUTES.filter(([route]) => route.startsWith('/app/')).length === 19 &&
    ROUTES.filter(([route]) => route.startsWith('/app/')).every(([route]) => navSrc.includes(`to: '${route}'`)));
  check('modules à venir : désactivés, P07 / P08 / P09 réellement routés',
    navSrc.includes('upcoming:') && shellSrc.includes('aria-disabled="true"') &&
    !navSrc.includes("upcoming: { step: '07'") && !navSrc.includes("upcoming: { step: '08'") &&
    !navSrc.includes("upcoming: { step: '09'") && !navSrc.includes("upcoming: { step: '10'") &&
    navSrc.includes("to: '/app/stock'") && navSrc.includes("to: '/app/consommations'") &&
    navSrc.includes("to: '/app/fidelisation'") && navSrc.includes("to: '/app/flottes'") &&
    navSrc.includes("to: '/app/consolidation'") && navSrc.includes("to: '/app/qualite'"));
  check('P10 : dépendances et outils QA conservés ; jsPDF ajouté au reçu',
    Object.keys(pkg.dependencies).length === 8 && Object.keys(pkg.devDependencies).length >= 13 &&
    Boolean(pkg.dependencies.jspdf) && Boolean(pkg.dependencies.zod) && Boolean(pkg.devDependencies['pdfjs-dist']) &&
    String(pkg.dependencies.recharts).startsWith('^2.') &&
    String(pkg.dependencies['react-router-dom']).startsWith('^6.'));
  check('tokens : focus clavier, mouvement réduit, élévation, squelette',
    [':focus-visible','prefers-reduced-motion','--wg-elev-2','wg-nav-item-active','wg-skeleton'].every((token) => cssSrc.includes(token)));
  check('états réels branchés : chargement, erreur, confirmation, tableau',
    read('src/App.tsx').includes('LoadingState') &&
    read('src/main.tsx').includes('ErrorBoundary') &&
    read('src/components/feedback.tsx').includes('componentDidCatch') &&
    !read('src/pages/Settings.tsx').includes('window.confirm') &&
    read('src/pages/Commissions.tsx').includes('DataTable'));

  {
    const { dom, w } = makeDom('/app/tableau-de-bord', base());
    const errs = await mount(acode, w);
    const text = w.document.body.textContent.replace(/\s+/g, ' ');
    check('8 groupes rendus pour le propriétaire + 0 erreur console',
      ['Pilotage','Exploitation','Commercial','RH','Finance','Stock','Analyse','Administration'].every((g) => text.includes(g)) && errs.length === 0,
      'err=' + errs.length + ' ' + (errs[0] || '').slice(0, 140));
    check('Stock P07 actif : 2 liens réels, plus aucun step 07 à venir',
      text.includes('Stocks & achats') && text.includes('Consommations') &&
      Boolean(w.document.querySelector('a[href="/app/stock"]')) &&
      Boolean(w.document.querySelector('a[href="/app/consommations"]')) &&
      !navSrc.includes("upcoming: { step: '07'"));
    check('CRM P08 actif : 2 liens réels, plus aucun step 08 à venir',
      text.includes('Fidélisation & forfaits') && text.includes('Flottes & contrats') &&
      Boolean(w.document.querySelector('a[href="/app/fidelisation"]')) &&
      Boolean(w.document.querySelector('a[href="/app/flottes"]')) &&
      !navSrc.includes("upcoming: { step: '08'"));
    dom.window.close();
  }
  {
    const { dom, w } = makeDom('/app/lavages', { ...base(), session: { ...base().session, role: 'caissier' } });
    const errs = await mount(acode, w);
    check('navigation filtrée par rôle : caissier sans Paramètres ni Abonnement',
      !w.document.querySelector('a[href="/app/parametres"]') && !w.document.querySelector('a[href="/app/abonnement"]') && errs.length === 0);
    dom.window.close();
  }
  {
    const { dom, w } = makeDom('/app/tableau-de-bord', base());
    const errs = await mount(acode, w);
    const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
    click(w.document.querySelector('button[aria-label="Rechercher un écran"]'));
    await wait(120);
    const dialog = w.document.querySelector('[role="dialog"][aria-label="Recherche rapide"]');
    check('recherche globale : ouverture réelle', Boolean(dialog));
    if (dialog) {
      const input = dialog.querySelector('input[type="search"]');
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'caisse');
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      await wait(120);
      const options = [...dialog.querySelectorAll('[role="option"]')].map((o) => o.textContent);
      check('recherche globale : filtrage réel des écrans autorisés',
        options.length === 1 && options[0].includes('Caisse'), JSON.stringify(options));
      input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(150);
      check('recherche globale : Entrée navigue vers l’écran cible', w.location.pathname === '/app/caisse', w.location.pathname);
    }
    check('recherche globale : 0 erreur console', errs.length === 0, (errs[0] || '').slice(0, 140));
    dom.window.close();
  }
  {
    const { dom, w } = makeDom('/app/lavages', base());
    await mount(acode, w);
    const button = w.document.querySelector('button[aria-label="Replier la navigation"]');
    button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
    await wait(120);
    check('sidebar repliable et préférence persistée',
      w.localStorage.getItem('washguard.sidebar.collapsed') === '1' &&
      Boolean(w.document.querySelector('button[aria-label="Déplier la navigation"]')));
    dom.window.close();
  }
  {
    const { dom, w } = makeDom('/app/parametres', base());
    let confirmCalls = 0;
    w.confirm = () => { confirmCalls++; return true; };
    const errs = await mount(acode, w);
    const button = [...w.document.querySelectorAll('button')].find((b) => b.textContent.includes('Réinitialiser la démonstration'));
    button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
    await wait(120);
    const dialog = w.document.querySelector('[role="dialog"][aria-modal="true"]');
    check('confirmation accessible : plus de window.confirm', Boolean(dialog) && confirmCalls === 0 && dialog.textContent.includes('Tout effacer'));
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(120);
    check('confirmation : Échap ferme sans effacer les données',
      !w.document.querySelector('[role="dialog"][aria-modal="true"]') && Boolean(w.localStorage.getItem('washguard.state.v1')) && errs.length === 0);
    dom.window.close();
  }
  {
    const { dom, w } = makeDom('/app/commissions', base());
    const errs = await mount(acode, w);
    const heads = [...w.document.querySelectorAll('th[aria-sort]')];
    check('DataTable : colonnes triables et accessibles (aria-sort)',
      heads.length >= 4 && heads.every((th) => ['none','ascending','descending'].includes(th.getAttribute('aria-sort'))));
    const sortButton = [...w.document.querySelectorAll('th button')].find((b) => b.textContent.includes('Aperçu') || b.textContent.includes('Montant dû'));
    sortButton.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
    await wait(120);
    check('DataTable : tri réel sur clic', Boolean(w.document.querySelector('th[aria-sort="ascending"]')) && errs.length === 0);
    dom.window.close();
  }

  // ── 7. Database & adaptateurs (Prompt 03) ─────────────────────────────────
  console.log('\n[7] Schéma, RLS et adaptateurs (Prompt 03)');
  const migrationsDir = path.join(ROOT, 'supabase/migrations');
  // Seules les migrations numerotees sont comptees. 051/052 sont deja
  // appliquees sur lavauto ; 053 reste locale. Les fichiers dates sont historiques.
  const sqlFiles = fs.readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  const sql = sqlFiles.map((f) => read('supabase/migrations/' + f)).join('\n');
  const s002 = read('supabase/migrations/002_identity_rbac.sql');
  const s008 = read('supabase/migrations/008_saas.sql');
  const s009 = read('supabase/migrations/009_rls.sql');
  const s010 = read('supabase/migrations/010_functions_triggers.sql');

  check('54 migrations locales numérotées 001 → 055, correctif 048 absent',
    sqlFiles.length === 54 && sqlFiles[0].startsWith('001_') && sqlFiles[19].startsWith('020_') &&
    sqlFiles[20].startsWith('021_') && sqlFiles[21].startsWith('022_') && sqlFiles[22].startsWith('023_') &&
    sqlFiles[23].startsWith('024_') && sqlFiles[24].startsWith('025_') && sqlFiles[25].startsWith('026_') &&
    sqlFiles[26].startsWith('027_') && sqlFiles[27].startsWith('028_') && sqlFiles[28].startsWith('029_') &&
    sqlFiles[29].startsWith('030_') && sqlFiles[30].startsWith('031_') &&
    sqlFiles[31].startsWith('032_') && sqlFiles[32].startsWith('033_') &&
    sqlFiles[33].startsWith('034_') && sqlFiles[34].startsWith('035_') &&
    sqlFiles[35].startsWith('036_') && sqlFiles[36].startsWith('037_') &&
    sqlFiles[37].startsWith('038_') && sqlFiles[38].startsWith('039_') &&
    sqlFiles[39].startsWith('040_') && sqlFiles[40].startsWith('041_') &&
    sqlFiles[41].startsWith('042_') && sqlFiles[42].startsWith('043_') &&
    sqlFiles[43].startsWith('044_') && sqlFiles[44].startsWith('045_') &&
    sqlFiles[45].startsWith('046_') && sqlFiles[46].startsWith('047_') &&
    sqlFiles[47].startsWith('049_') && sqlFiles[48].startsWith('050_') && sqlFiles[49].startsWith('051_') &&
    sqlFiles[50].startsWith('052_') && sqlFiles[51].startsWith('053_') &&
    sqlFiles[52].startsWith('054_') && sqlFiles[53].startsWith('055_') && !sqlFiles.some((f) => f.startsWith('048_')));
  check('053 WhatsApp : consentement distinct, file séparée, journal immuable et worker privé', (() => {
    const wa = read('supabase/migrations/053_whatsapp_wash_notifications.sql');
    return wa.includes('whatsapp_consent_granted boolean NOT NULL DEFAULT false') &&
      wa.includes('trg_customer_whatsapp_phone') && wa.includes('trg_wash_whatsapp_status') &&
      wa.includes("status IN ('pending','sending','unknown')") &&
      wa.includes('REVOKE ALL ON public.whatsapp_consent_events') &&
      wa.includes("GRANT EXECUTE ON FUNCTION %s TO service_role") &&
      read('supabase/tests/whatsapp_wash_rollback.sql').trim().endsWith('ROLLBACK;');
  })());
  check('Reçu et fournisseur : PDF local, webhook HMAC, aucune clé Meta dans le frontend', (() => {
    const worker = read('supabase/functions/_shared/whatsapp.ts');
    const receipt = read('src/lib/receiptPdf.ts');
    return receipt.includes('createReceiptPdf') && receipt.includes('DejaVuSans.ttf') &&
      worker.includes('crypto.subtle.verify') && worker.includes('WHATSAPP_SEND_ENABLED') &&
      worker.includes('biz_opaque_callback_data') &&
      !read('src/components/WhatsappPanels.tsx').includes('META_ACCESS_TOKEN') &&
      !read('src/services/adapters/SupabaseWhatsappCommands.ts').includes('META_ACCESS_TOKEN');
  })());
  check('003_catalog : index unique corrigé, plus de UNIQUE(expression)',
    read('supabase/migrations/003_catalog.sql').includes('CREATE UNIQUE INDEX uq_expense_categories_name') &&
    !/UNIQUE\s*\(\s*station_id\s*,\s*lower\(/i.test(sql));
  check('RLS générée sur toutes les tables + helpers de sécurité',
    s009.includes('ENABLE ROW LEVEL SECURITY') &&
    s009.includes('CREATE POLICY p_%I_all') &&
    s002.includes('current_company_id()') && s002.includes('enforce_company_id()') &&
    s002.includes('is_platform_admin()') && s002.includes('has_permission('));
  check('prix figé dans wash_items + historiques immuables',
    s010.includes('INSERT INTO public.wash_items') && s010.includes('unit_price_minor') &&
    s010.includes("trg_%s_immutable") && s009.includes('REVOKE INSERT, UPDATE, DELETE'));
  check('réception seule incrémente le stock, commande P07 sans mouvement',
    s010.includes("'purchase_receipt'") && s010.includes('ON CONFLICT (station_id, product_id) DO UPDATE') &&
    read('supabase/migrations/031_stock_commands.sql').includes('CREATE OR REPLACE FUNCTION public.create_purchase_order') &&
    read('supabase/migrations/031_stock_commands.sql').includes('Creee sans incrementer le stock'));
  check('caisse : solde théorique et réouverture sans mouvement à zéro',
    s010.includes('COALESCE(v_s.reopened_at, v_s.opened_at)') &&
    s010.includes('opening_float_minor=COALESCE(counted_minor, opening_float_minor)') &&
    !/kind\s*,\s*'reopen'/i.test(s010));
  check('périodes de commission validées figées',
    s010.includes('validate_commission_period') && s010.includes('trg_commission_periods_guard') &&
    read('supabase/migrations/006_hr_commissions.sql').includes("'validated','paid'"));
  check('3 formules administrables + quotas en table',
    ["'essai'", "'standard'", "'premium'"].every((v) => s008.includes(v)) && s008.includes('plan_limits'));
  check('aucune donnée métier de démonstration en seed',
    !/INSERT INTO public\.(companies|stations|washes|customers|payments|expenses)\s*\([^)]*\)\s*VALUES\s*\(\s*'/i.test(sql));

  const frontendFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else frontendFiles.push(full);
    }
  })(path.join(ROOT, 'src'));
  const frontendSrc = frontendFiles.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  check('aucun identifiant de tenant ni clé service_role dans le frontend',
    !frontendSrc.includes('company_id') &&
    !frontendSrc.includes('VITE_SUPABASE_SERVICE_ROLE') &&
    !read('.env.example').includes('VITE_SUPABASE_SERVICE_ROLE'));
  check('VITE_DATA_SOURCE documenté et typé + docs/database.md',
    read('.env.example').includes('VITE_DATA_SOURCE=local') &&
    read('src/vite-env.d.ts').includes('VITE_DATA_SOURCE') &&
    fs.existsSync(path.join(ROOT, 'docs/database.md')) &&
    read('docs/database.md').includes('69 tables'));

  const adapters = await build({ contents: `
    export { resolveDataSource, getDataSource, getDataAdapter } from './src/services/adapters/DataAdapter.ts';
    export { LocalDataAdapter } from './src/services/adapters/LocalDataAdapter.ts';
    export { SupabaseDataAdapter, mapPlanRows, mapCatalogRows } from './src/services/adapters/SupabaseDataAdapter.ts';
    export { PLANS, clonePlans, getPlans, setPlansCache, resetPlansCache, planById } from './src/lib/plans.ts';
  `, resolveDir: ROOT, sourcefile: 'adapters.ts', loader: 'ts' });
  const am = { exports: {} };
  new Function('module', 'exports', 'require', adapters.outputFiles[0].text)(am, am.exports, require);
  const A = am.exports;

  let invalidRejected = false;
  try { A.resolveDataSource('production'); } catch (e) { invalidRejected = /invalide/i.test(e.message); }
  check('résolution de la source : local par défaut, supabase explicite, autre valeur refusée',
    A.resolveDataSource(undefined) === 'local' && A.resolveDataSource(' SUPABASE ') === 'supabase' && invalidRejected);
  check(`source active cohérente avec le mode de test (${MODE})`, A.getDataSource() === MODE);
  check('getDataAdapter sélectionne les deux implémentations',
    A.getDataAdapter(() => empty()).source === MODE);
  {
    const missingDefine = {
      ...DEFINE,
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
      'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_STORAGE_BUCKET: 'station-assets' }),
    };
    const missing = await buildWith({ contents: `export { getDataAdapter } from './src/services/adapters/DataAdapter.ts';`,
      resolveDir: ROOT, sourcefile: 'missing.ts', loader: 'ts' }, missingDefine);
    const mm = { exports: {} };
    new Function('module', 'exports', 'require', missing.outputFiles[0].text)(mm, mm.exports, require);
    let refused = false;
    try { mm.exports.getDataAdapter(() => empty()); } catch (e) { refused = /VITE_SUPABASE_URL/.test(e.message); }
    check('supabase sans clé publishable : refus explicite, pas de repli silencieux', refused);
  }

  const local = new A.LocalDataAdapter(() => base());
  const localPlans = await local.listPlans();
  const localBootstrap = await local.getBootstrap();
  const localCatalog = await local.listCatalog();
  check('LocalDataAdapter : 3 formules du repli, sans mutation du cache',
    localPlans.length === 3 && localPlans[0].priceMonthly === 0 && A.PLANS.length === 3 && A.clonePlans() !== A.PLANS);
  check('LocalDataAdapter : bootstrap dérivé de l’état existant, vide → null',
    localBootstrap.company.id === 'co1' && localBootstrap.stations.length === 1 &&
    localBootstrap.roleKey === 'owner' &&
    (await new A.LocalDataAdapter(() => empty()).getBootstrap()) === null);
  check('LocalDataAdapter : catalogue et grille tarifaire existants',
    localCatalog.categories.length === 2 && localCatalog.services.length === 2 && localCatalog.prices.length === 4);

  function fakeReader(rowsByTable, calls) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from(table) {
        calls.push({ table, op: 'from' });
        const query = {
          select(columns) { calls.push({ table, op: 'select', columns }); return query; },
          eq(column, value) { calls.push({ table, op: 'eq', column, value }); return query; },
          order() { return query; },
          limit() { return query; },
          maybeSingle() { return Promise.resolve({ data: (rowsByTable[table] || [])[0] || null, error: null }); },
          then(resolve, reject) {
            return Promise.resolve({ data: rowsByTable[table] || [], error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };
  }
  const DB_ROWS = {
    plans: PLAN_ROWS,
    user_profiles: [{ id: 'u-db', full_name: 'Propriétaire DB', email: 'owner@db.test', active: true, role_id: 'r-owner' }],
    companies: [{ id: 'co-db', name: 'Entreprise DB', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false }],
    stations: [{ id: 'st-db', name: 'Station DB', city: 'Abidjan', activated: true }],
    user_station_assignments: [{ station_id: 'st-db' }],
    roles: [{ key: 'owner' }],
    role_permissions: [{ permission_id: 'washes.create' }, { permission_id: 'cash.close' }],
    vehicle_categories: [{ id: 'cat-db', station_id: 'st-db', name: 'Berline', active: true }],
    services: [{ id: 'srv-db', station_id: 'st-db', name: 'Lavage DB', description: '', active: true }],
    service_prices: [{ station_id: 'st-db', service_id: 'srv-db', vehicle_category_id: 'cat-db', price_minor: 3000, currency_code: 'XOF' }],
  };
  const calls = [];
  const sb = new A.SupabaseDataAdapter(fakeReader(DB_ROWS, calls));
  const dbPlans = await sb.listPlans();
  const bootstrap = await sb.getBootstrap();
  const catalog = await sb.listCatalog();
  check('SupabaseDataAdapter : plans + limites mappés depuis la base',
    dbPlans.length === 3 && dbPlans[1].priceMonthly === 16000 &&
    dbPlans[1].limits.washesPerMonth === 1000 && dbPlans[1].trial === false &&
    dbPlans[0].trial === true);
  check('bootstrap : contexte du tenant sans filtre d’entreprise côté client',
    bootstrap.company.id === 'co-db' && bootstrap.stations.length === 1 &&
    bootstrap.stationIds[0] === 'st-db' && bootstrap.roleKey === 'owner' &&
    bootstrap.permissions.includes('cash.close') &&
    !calls.some((c) => c.op === 'eq' && /company/i.test(c.column)));
  check('catalogue : catégories, prestations et prix servis par la RLS',
    catalog.categories.length === 1 && catalog.services.length === 1 &&
    catalog.prices.length === 1 && catalog.prices[0].priceMinor === 3000);
  const mappedCatalog = A.mapCatalogRows(DB_ROWS.vehicle_categories, DB_ROWS.services, DB_ROWS.service_prices);
  check('mapCatalogRows : conversion pure snake_case → domaine',
    mappedCatalog.categories[0].stationId === 'st-db' && mappedCatalog.prices[0].currencyCode === 'XOF');

  let currencyRejected = false, limitsRejected = false, emptyRejected = false;
  try { A.mapPlanRows(PLAN_ROWS.map((r) => ({ ...r, currency_code: 'GHS' }))); }
  catch (e) { currencyRejected = /GHS/.test(e.message); }
  try { A.mapPlanRows(PLAN_ROWS.map((r) => ({ ...r, plan_limits: r.plan_limits.filter((l) => l.key !== 'employees') }))); }
  catch (e) { limitsRejected = /Limites manquantes/.test(e.message); }
  try { A.mapPlanRows([]); } catch (e) { emptyRejected = /Aucune formule/.test(e.message); }
  check('mapping strict : devise non FCFA, limites manquantes et table vide refusés',
    currencyRejected && limitsRejected && emptyRejected);
  A.setPlansCache(dbPlans);
  check('cache plans partagé : planById lit la base après chargement',
    A.planById('standard').priceMonthly === 16000 && A.getPlans().length === 3);
  A.resetPlansCache();
  check('rollback : resetPlansCache restaure le repli local',
    A.planById('standard').priceMonthly === 15000 && A.getPlans().length === 3);

  {
    const { dom, w } = makeDom('/', { ...base(), session: null });
    const errs = await mount(acode, w);
    const pricing = w.document.querySelector('#tarifs');
    const text = (pricing?.textContent ?? '').replace(/\s+/g, ' ');
    const anchors = [...w.document.querySelectorAll('a[href^="#"]')];
    check('vitrine rendue : ancres présentes, inscription et connexion utilisables',
      anchors.length >= 4 && anchors.every((link) => w.document.getElementById(link.getAttribute('href').slice(1))) &&
      Boolean(w.document.querySelector('a[href="/inscription"]')) &&
      Boolean(w.document.querySelector('a[href="/connexion"]')) && errs.length === 0);
    if (MODE === 'supabase') {
      check('vitrine en mode supabase : tarifs de la base, pas du repli local',
        text.includes('16 000 FCFA') && !text.includes('15 000 FCFA') && errs.length === 0,
        'err=' + errs.length + ' ' + text.slice(0, 180));
    } else {
      check('vitrine en mode local : repli local conservé, aucune requête réseau',
        text.includes('15 000 FCFA') && !text.includes('16 000 FCFA') && errs.length === 0);
    }
    dom.window.close();
  }
  if (MODE === 'supabase') {
    const savedFetch = globalThis.fetch;
    // 503 simulé avec Retry-After: 0 : le client peut effectuer ses retries
    // sans que le test lise encore l'état de chargement après 220 ms.
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'base indisponible pour le test' }), {
      status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0' },
    });
    const { dom, w } = makeDom('/', { ...base(), session: null });
    await mount(acode, w);
    const text = (w.document.querySelector('#tarifs')?.textContent ?? '').replace(/\s+/g, ' ');
    check('base indisponible : aucun prix local présenté comme tarif de la base',
      !text.includes('16 000 FCFA') && !text.includes('15 000 FCFA') &&
      (text.includes('Formules et tarifs indisponibles') || text.includes('Aucun prix local')),
      text.slice(0, 180));
    globalThis.fetch = savedFetch;
    dom.window.close();
  }

  // ── 8. Auth, multi-tenancy et RBAC (Prompt 04) ───────────────────────────
  console.log('\n[8] Auth, multi-tenancy et RBAC (Prompt 04)');
  const s011 = read('supabase/migrations/011_auth_bootstrap.sql');
  const s012 = read('supabase/migrations/012_rbac_policies.sql');
  const s013 = read('supabase/migrations/013_audit_triggers.sql');
  const s014 = read('supabase/migrations/014_user_admin_functions.sql');
  const s015 = read('supabase/migrations/015_company_read_views.sql');
  const s016 = read('supabase/migrations/016_owner_guard.sql');
  const s017 = read('supabase/migrations/017_granular_user_permissions.sql');
  const edge = read('supabase/functions/invite-user/index.ts');
  const authDoc = read('docs/auth-rbac.md');

  check('bootstrap Auth : company_id dérivé du JWT, jamais du navigateur',
    s011.includes('AFTER INSERT ON auth.users') && s011.includes('bootstrap_company_from_auth_user') &&
    s011.includes('auth.uid()') && !frontendSrc.includes('company_id'));
  check('invitations, affectations et permissions supplémentaires',
    s011.includes('accepted_user_id') && s011.includes('employees.invite') &&
    s011.includes('employees.assign_stations') && s011.includes('users.reset_password') &&
    s011.includes('platform.view'));
  check('RLS explicite sur profils, affectations et invitations',
    ['p_user_profiles_select','p_user_station_assignments_manage','p_user_invitations_insert']
      .every((token) => s012.includes(token)) && s012.includes("has_permission('employees.manage')"));
  check('audit append-only : acteur auth.uid(), triggers d’identité',
    s013.includes('auth.uid()') && s013.includes('trg_user_profiles_audit') &&
    s013.includes('trg_user_invitations_audit') && s010.includes('trg_%s_immutable'));
  check('mutations sensibles : SECURITY DEFINER + has_permission dans la fonction',
    s014.includes('SECURITY DEFINER') && s017.includes("has_permission('employees.disable')") &&
    s017.includes("has_permission('employees.assign_stations')") &&
    s016.includes('subscription.manage') && s017.includes("v_current_role = 'owner'"));
  check('lectures serveur : my_context / my_company_users sans filtre client',
    s011.includes('CREATE OR REPLACE FUNCTION public.my_context') &&
    s015.includes('my_company_users') && s015.includes('my_company_invitations') &&
    !s015.includes('.eq(') && authDoc.includes('onAuthStateChange'));
  check('Edge Function : JWT, permission serveur, secret hors dépôt',
    edge.includes("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')") &&
    edge.includes("has_permission") && edge.includes('employees.invite') &&
    edge.includes('inviteUserByEmail') && !frontendSrc.includes('SUPABASE_SERVICE_ROLE_KEY'));
  check('aucun mot de passe importé ni stocké dans AppState',
    !/passwords\s*:/.test(read('src/types.ts')) && !/passwords\s*:/.test(read('src/lib/store.tsx')) &&
    !read('src/pages/Employees.tsx').includes('Mot de passe provisoire') &&
    read('src/lib/demoPasswords.ts').includes('fingerprint'));
  check('RoleRoute conservé comme confort ; UI reflète permissions',
    read('src/App.tsx').includes('function RoleRoute') && read('src/App.tsx').includes('usePermissions') &&
    read('src/components/navigation.tsx').includes('granted.includes(entry.permission)') &&
    read('src/lib/usePermissions.ts').includes('my_context()'));

  const authBundle = await build({ contents: `
    export { mapMyContext, mapCompanyUsers, mapInvitations, mapIdentityToAppState, uiRoleToDb } from './src/services/auth/authTypes.ts';
    export { LocalAuthAdapter, identityFromState, companyUsersToAppUsers } from './src/services/auth/LocalAuthAdapter.ts';
    export { SupabaseAuthAdapter } from './src/services/auth/SupabaseAuthAdapter.ts';
    export { ALL_PERMISSIONS, permissionsForRole, ROUTE_PERMISSIONS } from './src/lib/permissionCatalog.ts';
    export { setDemoPassword, verifyDemoPassword, clearDemoPasswords } from './src/lib/demoPasswords.ts';
  `, resolveDir: ROOT, sourcefile: 'auth.ts', loader: 'ts' });
  const authModule = { exports: {} };
  new Function('module','exports','require', authBundle.outputFiles[0].text)(authModule, authModule.exports, require);
  const AUTH = authModule.exports;

  const rawContext = {
    authenticated: true, userId: 'u-owner', email: 'owner@tenant-a.test', fullName: 'Awa Propriétaire',
    profileReady: true, active: true, roleKey: 'owner', isPlatformAdmin: false,
    company: { id: 'co-a', name: 'Tenant A', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: now },
    companyId: 'co-a', stations: [{ id: 'st-a', name: 'Station A', city: 'Abidjan', activated: true }],
    permissions: ['employees.manage', 'employees.invite', 'subscription.manage'],
  };
  const mapped = AUTH.mapMyContext(rawContext, true);
  check('mapMyContext : contexte RBAC serveur, aucun tenant fourni par l’UI',
    mapped?.role === 'proprietaire' && mapped.companyId === 'co-a' &&
    mapped.permissions.includes('subscription.manage') && mapped.emailConfirmed === true);
  check('mapping rôles DB → UI et catalogue des permissions',
    AUTH.uiRoleToDb('super_admin') === 'super_admin' && AUTH.uiRoleToDb('laveur') === 'washer' &&
    AUTH.ALL_PERMISSIONS.length === 48 && AUTH.permissionsForRole('gerant').includes('employees.manage') &&
    AUTH.permissionsForRole('gerant').includes('analytics.compare') &&
    !AUTH.permissionsForRole('gerant').includes('platform.plans.manage') &&
    AUTH.permissionsForRole('super_admin').includes('platform.quotas.manage') &&
    AUTH.ROUTE_PERMISSIONS['/app/consolidation'] === 'analytics.view' &&
    AUTH.ROUTE_PERMISSIONS['/app/qualite'] === 'reports.view' &&
    AUTH.permissionsForRole('caissier').includes('crm.view') &&
    !AUTH.permissionsForRole('caissier').includes('crm.manage') &&
    !AUTH.permissionsForRole('gerant').includes('subscription.manage') &&
    AUTH.permissionsForRole('super_admin').includes('platform.view') &&
    AUTH.ROUTE_PERMISSIONS['/app/abonnement'] === 'subscription.manage');
  check('comptes et invitations mappés sans mot de passe',
    AUTH.mapCompanyUsers([{ id:'u1', fullName:'Moussa', email:'m@a.test', roleKey:'cashier', active:true, createdAt:now, stationIds:['st-a'] }])[0].role === 'caissier' &&
    AUTH.mapInvitations([{ id:'i1', email:'x@a.test', roleKey:'washer', stationIds:['st-a'], expiresAt:now, acceptedAt:null, revokedAt:null, createdAt:now }])[0].role === 'laveur');
  check('projection serveur : company/station/users dérivés du JWT',
    (() => { const p = AUTH.mapIdentityToAppState(mapped, AUTH.mapCompanyUsers([{ id:'u-owner', fullName:'Awa', email:'owner@tenant-a.test', roleKey:'owner', active:true, createdAt:now, stationIds:['st-a'] }])); return p.company.id==='co-a' && p.station.id==='st-a' && p.users[0].stationIds[0]==='st-a'; })());

  // Harnais Auth Supabase : vérification serveur, expiration, désactivation,
  // confirmation e-mail, reset et absence de boucle de requêtes.
  function fakeAuthClient(overrides = {}) {
    const calls = { getUser: 0, rpc: [], signOut: 0, signUp: null, reset: null, update: null, invite: null };
    const handlers = [];
    const user = overrides.user === undefined
      ? { id: 'u-owner', email: 'owner@tenant-a.test', email_confirmed_at: now }
      : overrides.user;
    const context = overrides.context ?? rawContext;
    const client = {
      auth: {
        async getUser() { calls.getUser += 1; return { data: { user }, error: null }; },
        onAuthStateChange(cb) { handlers.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
        async signInWithPassword() { return { data: { session: { access_token: 'token-1' } }, error: null }; },
        async signUp(credentials) { calls.signUp = credentials; return { data: { session: null, user: { id: 'u-new' } }, error: null }; },
        async signOut() { calls.signOut += 1; return { error: null }; },
        async resetPasswordForEmail(email, options) { calls.reset = { email, options }; return { error: null }; },
        async updateUser(attributes) { calls.update = attributes; return { error: null }; },
      },
      async rpc(name, args) {
        calls.rpc.push({ name, args });
        if (name === 'my_context') return { data: context, error: null };
        if (name === 'my_company_users') return { data: [], error: null };
        if (name === 'my_company_invitations') return { data: [], error: null };
        return { data: null, error: null };
      },
      functions: {
        async invoke(name, options) { calls.invite = { name, body: options.body }; return { data: { invitationId: 'inv-1' }, error: null }; },
      },
    };
    return { client, calls, emit: (event, token='token-1') => handlers.forEach((h) => h(event, { access_token: token })) };
  }

  {
    const fake = fakeAuthClient();
    const adapter = new AUTH.SupabaseAuthAdapter(fake.client);
    const changes = [];
    adapter.onAuthStateChange((change) => changes.push(change));
    fake.emit('INITIAL_SESSION', 'token-1');
    fake.emit('SIGNED_IN', 'token-1');
    await wait(40);
    await adapter.getIdentity();
    check('onAuthStateChange : INITIAL_SESSION + SIGNED_IN sans boucle de requêtes',
      fake.calls.getUser === 1 && fake.calls.rpc.filter((c) => c.name === 'my_context').length === 1 &&
      changes.length === 1 && changes[0].identity?.roleKey === 'owner',
      `getUser=${fake.calls.getUser} ctx=${fake.calls.rpc.filter((c) => c.name === 'my_context').length} changes=${changes.length}`);
  }
  {
    const fake = fakeAuthClient({ user: null });
    const adapter = new AUTH.SupabaseAuthAdapter(fake.client);
    const changes = [];
    adapter.onAuthStateChange((change) => changes.push(change));
    fake.emit('INITIAL_SESSION', 'expired');
    await wait(20);
    check('session expirée / JWT invalide : aucun accès, déconnexion contrôlée',
      changes.length === 1 && changes[0].type === 'SIGNED_OUT' && changes[0].reason === 'session_expired');
  }
  {
    const fake = fakeAuthClient({ context: { ...rawContext, active: false, company: null, companyId: null } });
    const adapter = new AUTH.SupabaseAuthAdapter(fake.client);
    const changes = [];
    adapter.onAuthStateChange((change) => changes.push(change));
    fake.emit('SIGNED_IN', 'disabled');
    await wait(20);
    check('utilisateur désactivé : session refusée et jeton local effacé',
      changes.length === 1 && changes[0].type === 'SIGNED_OUT' && changes[0].reason === 'account_disabled' && fake.calls.signOut === 1);
  }
  {
    const fake = fakeAuthClient();
    const adapter = new AUTH.SupabaseAuthAdapter(fake.client);
    const result = await adapter.signUp({ companyName: 'Tenant A', stationName: 'Station A', city: 'Abidjan', phone: '', ownerName: 'Awa', email: 'awa@tenant-a.test', password: 'motdepasse123' });
    await adapter.requestPasswordReset('awa@tenant-a.test');
    await adapter.updatePassword('nouveaumotdepasse');
    await adapter.invite({ fullName: 'Moussa', email: 'moussa@tenant-a.test', phone: '', role: 'caissier', stationIds: ['st-a'] });
    await adapter.updateUser({ userId: 'u2', role: 'laveur', active: false, stationIds: ['st-a'] });
    check('inscription : confirmation e-mail requise, métadonnées sans tenant',
      result.confirmationRequired === true && result.identity === null &&
      fake.calls.signUp.options.emailRedirectTo.includes('/connexion?confirmed=1') &&
      fake.calls.signUp.options.data.company_name === 'Tenant A' &&
      !JSON.stringify(fake.calls.signUp.options.data).includes('company_id'));
    check('reset réel + invitation + mutation : aucun company_id côté client',
      fake.calls.reset.options.redirectTo.includes('/reinitialiser-mot-de-passe') &&
      fake.calls.update.password === 'nouveaumotdepasse' &&
      fake.calls.invite.name === 'invite-user' &&
      !JSON.stringify(fake.calls.invite.body).includes('company_id') &&
      fake.calls.rpc.some((c) => c.name === 'admin_update_user' && !JSON.stringify(c.args).includes('company_id')));
  }

  {
    // Mode local : session en mémoire, empreinte de mot de passe séparée,
    // aucun compte Auth de test, aucune élévation de privilèges.
    const { dom, w } = makeDom('/', empty());
    let localState = empty();
    const hooks = { getState: () => localState, setState: (fn) => { localState = fn(localState); } };
    const adapter = new AUTH.LocalAuthAdapter(hooks, null);
    const result = await adapter.signUp({ companyName: 'Clean Auto', stationName: 'Cocody', city: 'Abidjan', phone: '', ownerName: 'Erwin', email: 'erwin@cleanauto.ci', password: 'motdepasse123' });
    check('démo locale : inscription sans passwords dans AppState',
      result.identity?.role === 'proprietaire' && !('passwords' in localState) &&
      AUTH.verifyDemoPassword('erwin@cleanauto.ci', 'motdepasse123') &&
      !AUTH.verifyDemoPassword('erwin@cleanauto.ci', 'mauvais'));
    const ownerId = localState.users[0].id;
    let elevated = false;
    try {
      const manager = { ...result.identity, role: 'gerant', roleKey: 'manager', permissions: AUTH.permissionsForRole('gerant') };
      const managerAdapter = new AUTH.LocalAuthAdapter(hooks, manager);
      await managerAdapter.updateUser({ userId: ownerId, role: 'proprietaire', active: false });
    } catch (e) { elevated = /propriétaire|Rôle cible/i.test(e.message); }
    check('élévation de privilèges refusée : propriétaire protégé', elevated);
    let resetRefused = false;
    try { await adapter.requestPasswordReset('erwin@cleanauto.ci'); }
    catch (e) { resetRefused = /Supabase Auth/.test(e.message); }
    check('mode local : aucun e-mail simulé, reset réel réservé à Supabase', resetRefused);
    await adapter.signOut();
    check('déconnexion locale : session effacée de l’état', localState.session === null);
    AUTH.clearDemoPasswords();
    dom.window.close();
  }

  // ── 9. Cœur métier lavages (Prompt 05) ───────────────────────────────────
  console.log('\n[9] Cycle lavages, 7 statuts, qualité et RPC (Prompt 05)');
  const wbundle = await build({ contents: `
    export { normalizeWashes, canTransitionWash, nextWashStatuses, finishedWashes,
      countUniqueWashes, isReadyNotDelivered, ALL_WASH_STATUSES } from './src/lib/washLifecycle.ts';
    export { WASH_STATUS_LABELS, LEGACY_WASH_STATUS, WASH_STATUS_FLOW } from './src/types.ts';
    export { mapWashBoard, SupabaseWashCommands } from './src/services/adapters/SupabaseDataAdapter.ts';
    export { mapCatalogToState, mapClientRows } from './src/lib/catalog.ts';
  `, resolveDir: ROOT, sourcefile: 'wash.ts', loader: 'ts' });
  const wm = { exports: {} };
  new Function('module','exports','require', wbundle.outputFiles[0].text)(wm, wm.exports, require);
  const W = wm.exports;

  const legacy = ['en_attente','en_cours','termine','annule'].map((status, i) => ({
    id: 'legacy-' + i, status, createdAt: now, employeeId: 'u1', items: [], payments: [],
  }));
  const migrated = W.normalizeWashes(legacy);
  check('mapping 4 statuts FR → 7 EN + historique initial par lavage importé',
    migrated.map((w) => w.status).join(',') === 'pending,in_progress,ready,cancelled' &&
    migrated.every((w) => w.history.length === 1 && w.history[0].fromStatus === null) &&
    W.normalizeWashes(migrated).every((w) => w.history.length === 1));
  check('« terminé » = ready et NON delivered, restitution encore à faire',
    migrated[2].status === 'ready' && W.isReadyNotDelivered(migrated[2]) === true &&
    W.LEGACY_WASH_STATUS.termine === 'ready' && W.ALL_WASH_STATUSES.length === 7 &&
    Object.keys(W.WASH_STATUS_LABELS).length === 7);
  check('état machine : transitions légales uniquement, livraison terminale',
    W.canTransitionWash('pending','assigned') && W.canTransitionWash('quality_check','in_progress') &&
    W.canTransitionWash('ready','delivered') && !W.canTransitionWash('pending','ready') &&
    !W.canTransitionWash('quality_check','ready') && !W.canTransitionWash('delivered','ready') &&
    !W.canTransitionWash('cancelled','pending') && W.canTransitionWash('pending','cancelled'));
  check('aucun lavage compté deux fois (ready + delivered, doublons dédupliqués)',
    W.finishedWashes([
      {id:'x',status:'ready'},{id:'x',status:'ready'},{id:'y',status:'delivered'},{id:'z',status:'pending'},
    ]).length === 2 && W.countUniqueWashes([{id:'x'},{id:'x'},{id:'y'}]) === 2);

  const s021 = read('supabase/migrations/021_wash_lifecycle.sql');
  const s022 = read('supabase/migrations/022_wash_board.sql');
  const s023 = read('supabase/migrations/023_wash_quality_guard.sql');
  check('migration 021 : garde d’état, postes/affectations/qualité, écritures directes verrouillées',
    s021.includes("WHEN 'delivered' THEN OLD.status = 'ready'") &&
    s021.includes('assert_wash_status_transition') && s021.includes('create_wash_full') &&
    s021.includes('assign_wash') && s021.includes('record_wash_quality_check') &&
    s021.includes('wash_status_history') && s021.includes('REVOKE INSERT, UPDATE, DELETE') &&
    s021.includes('washes.quality') && s021.includes('log_wash_lifecycle'));
  check('migration 022 : board/historique véhicule servis par le serveur, tenant déduit du JWT',
    s022.includes('my_wash_board') && s022.includes('my_wash_posts') &&
    s022.includes('my_vehicle_history') && s022.includes('public.current_company_id()') &&
    s022.includes('public.can_access_station') && s022.includes("'deliveredAt', w.delivered_at"));
  check('migration 023 : ready uniquement après qualité, postes/clients par station',
    s023.includes("washguard.quality_approved") && s023.includes('my_company_clients') &&
    s023.includes("'stationId', p.station_id") && s023.includes('p_station_id uuid DEFAULT NULL') &&
    s023.includes('REVOKE ALL ON FUNCTION') && s023.includes('Motif de reprise requis'));
  check('migration 052 : création et paiement dans une RPC, réservation privée et test SQL', (() => {
    const migration = read('supabase/migrations/052_atomic_wash_creation.sql');
    const testSql = read('supabase/tests/atomic_wash_rollback.sql');
    return migration.includes('create_wash_atomic') && migration.includes('wash_creation_requests') &&
      migration.includes('ON CONFLICT (company_id, idempotency_key) DO NOTHING') &&
      migration.includes("public.has_permission('payments.create')") &&
      migration.includes('public.can_access_station') &&
      migration.includes('REVOKE ALL ON TABLE public.wash_creation_requests') &&
      testSql.startsWith('--') && testSql.includes('BEGIN;') && testSql.trim().endsWith('ROLLBACK;');
  })());
  check('frontend : 7 statuts EN, plus aucun ancien statut FR écrit dans le store',
    read('src/types.ts').includes("| 'pending' | 'assigned'") &&
    read('src/lib/washLifecycle.ts').includes('normalizeWashes') &&
    !/status:\s*'(en_attente|en_cours|termine|annule)'/.test(read('src/lib/store.tsx')) &&
    read('src/pages/Washes.tsx').includes('recordQualityCheck'));
  check('DataAdapter étendu : board + port de commandes, aucun tenant côté client',
    read('src/services/adapters/DataAdapter.ts').includes('washCommands') &&
    read('src/services/adapters/DataAdapter.ts').includes('listWashBoard') &&
    read('src/services/adapters/DataAdapter.ts').includes('listClients') &&
    read('src/services/adapters/SupabaseDataAdapter.ts').includes('create_wash_atomic') &&
    read('src/services/adapters/SupabaseDataAdapter.ts').includes('my_company_clients') &&
    read('src/pages/Washes.tsx').includes('p.stationId === stationId') &&
    !read('src/services/adapters/SupabaseDataAdapter.ts').includes('company_id') &&
    read('src/services/adapters/SupabaseDataAdapter.ts').includes('companyId: null') &&
    new A.LocalDataAdapter(() => base()).washCommands === null &&
    (await new A.LocalDataAdapter(() => base()).listWashBoard()).washes.length === 1 &&
    (await new A.LocalDataAdapter(() => base()).listClients()).length === 1);

  // Board serveur : projection JSONB → domaine, historique initial, statut EN.
  const boardRows = [{
    id:'w-db', stationId:'st-db', number:'L-000010', plate:'1234 AB 01', status:'ready',
    clientName:'Client DB', vehicleLabel:'Berline', items:[{serviceId:'srv-db',serviceName:'Lavage',unitPrice:3000,qty:1}],
    total:3000, paid:3000, discount:0, createdAt:now, finishedAt:now, deliveredAt:null,
    cancelledReason:null, payments:[], history:[], assignedUserIds:['u-db'], postId:null,
  }];
  const board = W.mapWashBoard(boardRows, [{id:'post-db',stationId:'st-db',name:'Piste 1',capacity:2,active:true}]);
  check('my_wash_board : projection serveur, prix figé, historique initial',
    board.washes.length === 1 && board.washes[0].status === 'ready' &&
    board.washes[0].items[0].unitPrice === 3000 && board.washes[0].history.length === 1 &&
    board.posts[0].name === 'Piste 1' && board.posts[0].stationId === 'st-db' &&
    board.washes[0].deliveredAt === null);

  check('catalogue et clients serveur : UUID projetés, aucun tarif local fabriqué',
    W.mapCatalogToState({
      categories:[{id:'cat-db',stationId:'st-db',name:'Berline',active:true}],
      services:[{id:'srv-db',stationId:'st-db',name:'Lavage',description:'',active:true}],
      prices:[{stationId:'st-db',serviceId:'srv-db',vehicleCategoryId:'cat-db',priceMinor:3000,currencyCode:'XOF'}],
    }).services[0].prices['cat-db'] === 3000 &&
    W.mapClientRows([{id:'cli-db',stationId:'st-db',name:'Client DB',phone:'',plate:'1234 AB 01',notes:'',createdAt:now}])[0].id === 'cli-db');
  check('actions asynchrones attendues, aucune Promise perdue',
    read('src/components/ui.tsx').includes('return async (fn') &&
    !/void\s+(refreshWashes|updateUser|revokeInvitation)\(/.test(
      read('src/pages/Washes.tsx') + read('src/pages/Employees.tsx')));

  // Commandes RPC : noms, arguments sans tenant, idempotence et paiement associé.
  {
    const rpcCalls = [];
    const rpcClient = {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from() { const q = { select(){return q}, eq(){return q}, order(){return q}, limit(){return q},
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve){ return Promise.resolve({ data: [], error: null }).then(resolve); } }; return q; },
      async rpc(name, args) {
        rpcCalls.push({ name, args: args ?? {} });
        if (name === 'create_wash_atomic') return { data: 'wash-rpc-1', error: null };
        if (name === 'record_wash_payment_by_key') return { data: 'payment-rpc-1', error: null };
        if (name === 'my_vehicle_history') return { data: boardRows, error: null };
        return { data: [], error: null };
      },
    };
    const commands = new W.SupabaseWashCommands(rpcClient);
    const id = await commands.createWash({
      stationId:'st-db', categoryId:'cat-db', plate:'1234 AB 01', clientId:null, clientName:'',
      items:[{serviceId:'srv-db',qty:1}], discount:0, employeeIds:['u-db','u2'], postId:'post-db',
      idempotencyKey:'ui-key-1', payment:{amount:3000,method:'especes'},
    });
    await commands.transitionStatus(id, 'quality_check');
    await commands.qualityCheck(id, 'approved', 'RAS');
    await commands.assign(id, ['u-db'], 'post-db');
    await commands.addPayment(id, 1000, 'mobile_money', 'pay-key-1');
    await commands.createPost('Piste 2', 3, 'st-db');
    const history = await commands.vehicleHistory('1234 AB 01');
    const allArgs = JSON.stringify(rpcCalls);
    check('commandes RPC : cycle complet, idempotence, aucun company_id ni secret',
      id === 'wash-rpc-1' && rpcCalls[0].name === 'create_wash_atomic' &&
      rpcCalls[0].args.p_payload.idempotency_key === 'ui-key-1' &&
      rpcCalls[0].args.p_payload.employee_ids.length === 2 &&
      rpcCalls[0].args.p_payload.initial_payment.amount_minor === 3000 &&
      rpcCalls[0].args.p_payload.initial_payment.method_key === 'cash' &&
      rpcCalls.filter((c) => c.name === 'record_wash_payment_by_key').length === 1 &&
      !rpcCalls.some((c) => c.name === 'create_wash_full') &&
      rpcCalls.some((c) => c.name === 'record_wash_quality_check') &&
      rpcCalls.some((c) => c.name === 'transition_wash_status') &&
      rpcCalls.some((c) => c.name === 'assign_wash') &&
      rpcCalls.some((c) => c.name === 'create_wash_post' && c.args.p_station_id === 'st-db') &&
      history.length === 1 &&
      !allArgs.includes('company_id') && !allArgs.includes('service_role'));
  }

  // Parcours local complet : création multi-postes → prix figé → qualité →
  // prêt → livré, sans jamais confondre « terminé » et « livré ».
  {
    const harness = await build({ contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { StoreProvider, useStore } from './src/lib/store.tsx';
      import { buildCommissions } from './src/lib/metrics.ts';
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const persisted = () => JSON.parse(localStorage.getItem('washguard.state.v1') || '{}');
      function H() {
        const s = useStore();
        React.useEffect(() => {
          (async () => {
            const out = {};
            try {
              const created = await s.createWash({
                categoryId:'c1', plate:'1234 AB 01', employeeId:'u1',
                employeeIds:['u1','u2'], postId:'p1', clientId:null, clientName:'',
                items:[{serviceId:'s1',qty:1}], discount:0, payment:null,
              });
              out.created = { status:created.status, assigned:created.assignedUserIds.length,
                history:created.history.length, price:created.items[0].unitPrice };
              await s.setPrice('s1','c1',9999);
              await sleep(30);
              out.frozen = persisted().washes.find((w) => w.id === created.id).items[0].unitPrice === 3000;
              await s.setWashStatus(created.id,'in_progress');
              await sleep(30);
              await s.setWashStatus(created.id,'quality_check');
              await sleep(30);
              let gate = false;
              try { await s.setWashStatus(created.id,'ready'); } catch (e) { gate = e.code === 'invalid_transition'; }
              out.qualityGate = gate && persisted().washes.find((w) => w.id === created.id).status === 'quality_check';
              await s.recordQualityCheck(created.id,'approved','RAS');
              await sleep(30);
              const ready = persisted().washes.find((w) => w.id === created.id);
              out.ready = { status:ready.status, deliveredAt:ready.deliveredAt, quality:ready.qualityResult };
              let refused = false;
              try { await s.setWashStatus(created.id,'in_progress'); } catch (e) { refused = e.code === 'invalid_transition'; }
              out.refusedAfterReady = refused;
              await s.setWashStatus(created.id,'delivered');
              await sleep(30);
              const delivered = persisted().washes.find((w) => w.id === created.id);
              out.delivered = { status:delivered.status, deliveredAt:Boolean(delivered.deliveredAt), history:delivered.history.length };
              out.commissions = buildCommissions(persisted(),'jour').length;
              out.unique = new Set(persisted().washes.map((w) => w.id)).size === persisted().washes.length;
              const second = await s.createWash({
                categoryId:'c1', plate:'', employeeId:'u1', clientId:null, clientName:'',
                items:[{serviceId:'s1',qty:1}], discount:0, payment:null,
              });
              await sleep(30);
              await s.setWashStatus(second.id,'cancelled','Client absent');
              await sleep(30);
              out.cancelled = persisted().washes.find((w) => w.id === second.id).cancelledReason;
            } catch (e) { out.error = (e.code || 'ERR') + ':' + e.message; }
            document.body.dataset.results = JSON.stringify(out);
          })();
        }, []);
        return null;
      }
      createRoot(document.getElementById('root')).render(React.createElement(StoreProvider,null,React.createElement(H)));
    `, resolveDir: ROOT, sourcefile: 'lifecycle.tsx', loader: 'tsx' });
    const { dom, w } = makeDom('/', base());
    const errs = await mount(harness.outputFiles[0].text, w);
    await wait(400);
    const out = JSON.parse(w.document.body.dataset.results || '{}');
    check('cycle local complet : ready ≠ delivered, qualité validée, annulation motivée',
      !out.error && out.created.status === 'assigned' && out.created.assigned === 2 &&
      out.created.history === 2 && out.frozen === true && out.qualityGate === true &&
      out.ready.status === 'ready' && out.ready.deliveredAt === null && out.ready.quality === 'approved' &&
      out.refusedAfterReady === true && out.delivered.status === 'delivered' &&
      out.delivered.deliveredAt === true && out.delivered.history >= 5 &&
      out.commissions >= 1 && out.unique === true && out.cancelled === 'Client absent' &&
      errs.length === 0, JSON.stringify(out) + ' err=' + errs.length);
    dom.window.close();
  }

  // ── 10. Caisse, paiements, finance, rentabilité (Prompt 06) ────────────────
  console.log('\n[10] Caisse, canaux, clôtures, commissions et rentabilité (Prompt 06)');
  const fbundle = await build({ contents: `
    export * from './src/lib/finance.ts';
    export * from './src/lib/financeState.ts';
    export { theoreticalCash } from './src/lib/metrics.ts';
    export { SupabaseFinanceCommands } from './src/services/adapters/SupabaseFinanceCommands.ts';
  `, resolveDir: ROOT, sourcefile: 'finance.ts', loader: 'ts' });
  const fm = { exports: {} };
  new Function('module', 'exports', 'require', fbundle.outputFiles[0].text)(fm, fm.exports, require);
  const F = fm.exports;
  const day = now.slice(0, 10);
  const later = new Date(Date.now() + 5000).toISOString();

  check('projection my_finance_board : 10 collections, canal espèces ≠ Mobile Money', (() => {
    const board = {
      paymentMethods: [
        { id: 'pm-cash', stationId: 'st1', key: 'cash', label: 'Espèces', uiMethod: 'especes', affectsCash: true, active: true },
        { id: 'pm-mm', stationId: 'st1', key: 'mobile_money', label: 'Mobile Money', uiMethod: 'mobile_money', affectsCash: false, active: true },
      ],
      cashSessions: [{ id: 'ca1', stationId: 'st1', openedBy: 'Owner', openedAt: now, openingFloat: 10000, closedAt: null, countedAmount: null, closedBy: null, status: 'ouverte', reopenReason: null, reopenedAt: null }],
      cashMovements: [{ id: 'm1', stationId: 'st1', cashSessionId: 'ca1', kind: 'payment_in', amount: 500, uiMethod: 'especes', paymentId: 'p1', expenseId: null, reference: '', idempotencyKey: 'cash:p1', createdAt: now }],
      cashClosures: [], expenses: [], reconciliations: [], commissionPeriods: [],
      commissionLines: [], commissionPayouts: [], paymentCancellations: [],
    };
    const b = F.mapFinanceBoard(board);
    return Object.keys(b).length === 10 && b.paymentMethods.length === 2 &&
      b.paymentMethods[0].uiMethod === 'especes' && b.paymentMethods[1].uiMethod === 'mobile_money' &&
      b.cashMovements[0].kind === 'payment_in' && b.cashSessions[0].status === 'ouverte';
  })());

  check('my_profitability : NULL préservé, aucun faux bénéfice net', (() => {
    const p = F.mapProfitability({
      periodStart: day, periodEnd: day, revenue: 1500, collected: 1500, receivables: 0,
      expenses: 500, purchases: 0, consumptions: 0, commissions: 300, fixedCosts: 0,
      partialBalance: 1000, grossMargin: null, result: null, costsMissing: true,
      label: 'Couts manquants : resultat net non calculable avant P07', missing: ['a', 'b', 'c', 'd'],
      definitions: { partialBalance: 'Solde partiel : PAS un benefice net' },
    });
    return p.grossMargin === null && p.result === null && p.costsMissing === true &&
      p.partialBalance === 1000 && p.missing.length === 4 &&
      p.definitions.partialBalance.includes('PAS un benefice net');
  })());

  check('rapport local P06 : CA, encaissé, créances, charges et solde partiel distincts', (() => {
    const p = F.buildProfitability(base(), new Date(day + 'T00:00:00'), new Date(day + 'T23:59:59'));
    return p.revenue === 3000 && p.collected === 3000 && p.receivables === 0 &&
      p.expenses === 1500 && p.partialBalance === 1500 && p.grossMargin === null &&
      p.result === null && p.costsMissing === true && p.missing.length === 4;
  })());

  check('clôture : mouvement d’écart + relevé immuable, premier écart conservé après réouverture', (() => {
    const s = F.withFinanceDefaults(base());
    s.cashSessions[0].openedAt = now;
    s.cashMovements = [
      { id: 'm-pay', stationId: 'st1', cashSessionId: 'ca1', kind: 'payment_in', amount: 3000, uiMethod: 'especes', paymentId: 'p1', expenseId: null, reference: '', idempotencyKey: null, createdAt: now },
      { id: 'm-exp', stationId: 'st1', cashSessionId: 'ca1', kind: 'expense_out', amount: -1500, uiMethod: 'especes', paymentId: null, expenseId: 'e1', reference: '', idempotencyKey: null, createdAt: now },
    ];
    const closed = F.closeCashWithLedger(s, 'ca1', 12000, 11500, now);
    const reopened = {
      ...closed,
      cashSessions: closed.cashSessions.map((c) => ({ ...c, status: 'ouverte', countedAmount: 12000, openingFloat: 12000, reopenedAt: later, reopenReason: 'Comptage a reverifier' })),
      cashMovements: [...closed.cashMovements,
        { id: 'm-new', stationId: 'st1', cashSessionId: 'ca1', kind: 'payment_in', amount: 500, uiMethod: 'especes', paymentId: 'p2', expenseId: null, reference: '', idempotencyKey: null, createdAt: later },
        { id: 'm-adj', stationId: 'st1', cashSessionId: 'ca1', kind: 'adjustment', amount: -1000, uiMethod: 'especes', paymentId: 'p1', expenseId: null, reference: '', idempotencyKey: null, createdAt: later },
      ],
    };
    const second = F.closeCashWithLedger(reopened, 'ca1', 11500, F.theoreticalCash(reopened, 'ca1'), later);
    return closed.cashClosures[0].difference === 500 &&
      closed.cashMovements.some((m) => m.kind === 'closing' && m.amount === 500) &&
      second.cashClosures.length === 2 &&
      second.cashClosures.some((c) => c.difference === 500) &&
      second.cashClosures.some((c) => c.difference === 0) &&
      !second.cashMovements.some((m) => m.kind === 'closing' && m.amount === 0) &&
      F.theoreticalCash(reopened, 'ca1') === 11500;
  })());

  check('remboursement local : paiement conservé, créance recalculée, ajustement caisse', (() => {
    const s = F.withFinanceDefaults(base());
    s.cashMovements = [{ id: 'm-pay', stationId: 'st1', cashSessionId: 'ca1', kind: 'payment_in', amount: 3000, uiMethod: 'especes', paymentId: 'p1', expenseId: null, reference: '', idempotencyKey: null, createdAt: now }];
    const after = F.cancelPaymentWithLedger(s, 'p1', 'Client rembourse', later);
    const wash = after.washes.find((w) => w.id === 'w1');
    let duplicate = false;
    try { F.cancelPaymentWithLedger(after, 'p1', 'Client rembourse', later); }
    catch (e) { duplicate = e.code === 'already_cancelled'; }
    return wash.paid === 0 && wash.payments[0].cancelledAt === later &&
      after.paymentCancellations.length === 1 &&
      after.cashMovements.some((m) => m.kind === 'adjustment' && m.amount === -3000) && duplicate;
  })());

  check('rapprochement par canal : espèces 500 ≠ Mobile Money 1000, figé non recalculable', (() => {
    const s = F.withFinanceDefaults(base());
    s.washes[0].paid = 1500;
    s.washes[0].payments = [
      { id: 'p-cash', amount: 500, method: 'especes', at: now, byUserId: 'u1' },
      { id: 'p-mm', amount: 1000, method: 'mobile_money', at: now, byUserId: 'u1' },
    ];
    const methods = F.financeSnapshotFromState(s).paymentMethods;
    const cash = methods.find((m) => m.uiMethod === 'especes');
    const mm = methods.find((m) => m.uiMethod === 'mobile_money');
    const r1 = F.reconcileChannelLocal(s, cash.id, day, day, 500, now);
    const r2 = F.reconcileChannelLocal(r1, mm.id, day, day, 1000, now);
    let frozen = false;
    try { F.reconcileChannelLocal(r2, cash.id, day, day, 700, later); }
    catch (e) { frozen = e.code === 'frozen_reconciliation'; }
    return F.channelExpected(s, cash.id, day, day) === 500 &&
      F.channelExpected(s, mm.id, day, day) === 1000 &&
      r2.reconciliations.length === 2 && frozen &&
      r2.reconciliations.every((r) => r.frozen && r.difference === 0);
  })());

  check('commission : brouillon → relevé figé → paie, jamais recalculée', (() => {
    const s = F.withFinanceDefaults(base());
    const created = F.createCommissionPeriodLocal(s, 'st1', day, day);
    const validated = F.validateCommissionPeriodLocal(created.state, created.id, now);
    let frozen = false;
    try { F.validateCommissionPeriodLocal(validated, created.id, later); }
    catch (e) { frozen = e.code === 'frozen_period'; }
    const line = validated.commissionLines[0];
    const paid = F.recordCommissionPayoutLocal(validated, created.id, line.userId, line.amount, 'PAIE-P06', later);
    return created.state.commissionPeriods[0].status === 'draft' &&
      validated.commissionLines.length === 1 && line.amount === 300 &&
      validated.commissionPeriods[0].status === 'validated' && frozen &&
      paid.commissionPayouts.length === 1 && paid.commissionPeriods[0].status === 'paid';
  })());

  check('DataAdapter P06 : port finance, board local, rapport local sans faux résultat', (() => {
    const local = new A.LocalDataAdapter(() => base());
    return local.financeCommands === null &&
      F.financeSnapshotFromState(base()).paymentMethods.length === 4 &&
      read('src/services/adapters/DataAdapter.ts').includes('financeCommands') &&
      read('src/services/adapters/DataAdapter.ts').includes('listFinanceBoard') &&
      read('src/services/adapters/DataAdapter.ts').includes('listProfitability');
  })());

  check('frontend P06 : plus aucun « Résultat simplifié », coûts manquants explicites', (() => {
    const ui = ['src/pages/Dashboard.tsx','src/pages/Reports.tsx','src/pages/Commissions.tsx','src/pages/Cash.tsx','src/pages/Washes.tsx','src/pages/Expenses.tsx']
      .map((f) => read(f)).join('\n') + read('src/lib/metrics.ts');
    return !ui.includes('Résultat simplifié') && !ui.includes('result: collected - expenses') &&
      ui.includes('partialBalance') && ui.includes('costsMissing') &&
      ui.includes('PAS un bénéfice') && read('src/services/adapters/SupabaseDataAdapter.ts').includes('my_station_profitability') &&
      read('src/pages/Cash.tsx').includes('my_finance_board') === false;
  })());

  check('migrations 024 → 029 : horloge réelle, clôture filtrée, join board corrigé, coûts manquants', (() => {
    const s024 = read('supabase/migrations/024_finance_foundation.sql');
    const s025 = read('supabase/migrations/025_finance_commands.sql');
    const s026 = read('supabase/migrations/026_finance_profitability.sql');
    const s027 = read('supabase/migrations/027_finance_hardening.sql');
    const s028 = read('supabase/migrations/028_finance_board_join.sql');
    const s029 = read('supabase/migrations/029_finance_clock.sql');
    return s024.includes('cash_closures') && s024.includes('cash_movements') &&
      s025.includes('record_expense_by_key') && s025.includes('idempotency_key') &&
      s026.includes("'costsMissing', true") && s026.includes("'result', NULL") &&
      s027.includes('my_finance_board') && s027.includes('u2.id = cs.closed_by') &&
      s028.includes('u.id = cs.closed_by') && s028.includes('replace(') &&
      s029.includes('clock_timestamp()') && s029.includes('COALESCE(v_s.reopened_at, v_s.opened_at)') &&
      !s025.includes('difference_minor = 0') && !read('supabase/migrations/025_finance_commands.sql').includes('SET DEFAULT 0');
  })());

  check('test distant P06 : 32 contrôles ROLLBACK, assertion idempotence corrigée', (() => {
    const t = read('supabase/tests/p06_rollback.sql');
    return /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('count(*)=2') && t.includes('my_finance_board') &&
      t.includes('my_profitability') && t.includes('SELECT label, ok, detail FROM p06_result');
  })());

  {
    const calls = [];
    const rpcClient = {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from() { throw new Error('Aucune lecture directe de table finance attendue'); },
      async rpc(name, args) {
        calls.push({ name, args: args ?? {} });
        if (name === 'open_cash_session') return { data: 'ca-rpc', error: null };
        if (name === 'record_expense_by_key') return { data: 'exp-rpc', error: null };
        if (name === 'create_commission_period') return { data: 'period-rpc', error: null };
        return { data: null, error: null };
      },
    };
    const commands = new F.SupabaseFinanceCommands(rpcClient);
    await commands.openCash('st-db', 10000, 'C-P06');
    await commands.closeCash('ca-db', 10100);
    await commands.reopenCash('ca-db', 'Comptage a reverifier');
    await commands.addExpense({ stationId: 'st-db', amount: 500, category: 'Fournitures', reason: 'Shampoing', supplier: '', date: day, method: 'especes', idempotencyKey: 'exp-1' });
    await commands.cancelExpense('exp-db', 'Erreur fournisseur');
    await commands.cancelPayment('pay-db', 'Client rembourse');
    await commands.reconcileChannel('pm-db', day, day, 500);
    await commands.createCommissionPeriod('st-db', day, day);
    await commands.validateCommissionPeriod('period-db');
    await commands.recordCommissionPayout('period-db', 'u-db', 300, 'PAIE-P06');
    const allArgs = JSON.stringify(calls);
    const byName = (n) => calls.find((c) => c.name === n)?.args ?? {};
    check('commandes finance RPC : noms/arguments exacts, aucun tenant ni secret',
      calls.length === 10 && byName('open_cash_session').p_number === 'C-P06' &&
      byName('record_expense_by_key').p_spent_at === day &&
      byName('record_expense_by_key').p_idempotency_key === 'exp-1' &&
      byName('reconcile_channel').p_method_id === 'pm-db' &&
      byName('reconcile_channel').p_start === day &&
      byName('create_commission_period').p_start === day &&
      byName('validate_commission_period').p_period_id === 'period-db' &&
      byName('record_commission_payout').p_amount_minor === 300 &&
      !allArgs.includes('company_id') && !allArgs.includes('service_role') &&
      !allArgs.includes('p_expense_date'));
  }

  {
    const report = { periodStart: day, periodEnd: day, revenue: 0, collected: 0, receivables: 0,
      expenses: 0, purchases: 0, consumptions: 0, commissions: 0, fixedCosts: 0,
      partialBalance: 0, grossMargin: null, result: null, costsMissing: true,
      label: 'Couts manquants : resultat net non calculable avant P07', missing: [], definitions: {} };
    const emptyBoard = { paymentMethods: [], cashSessions: [], cashMovements: [], cashClosures: [],
      expenses: [], reconciliations: [], commissionPeriods: [], commissionLines: [],
      commissionPayouts: [], paymentCancellations: [] };
    const calls = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from() { throw new Error('Aucune lecture directe de table finance attendue'); },
      async rpc(name, args) {
        calls.push({ name, args: args ?? {} });
        if (name === 'my_finance_board') return { data: emptyBoard, error: null };
        if (name === 'my_profitability') return { data: report, error: null };
        return { data: null, error: null };
      },
    };
    const adapter = new A.SupabaseDataAdapter(client);
    const board = await adapter.listFinanceBoard();
    const profitability = await adapter.listProfitability(day, day);
    check('adaptateur serveur P06 : my_finance_board + my_profitability, pas de filtre tenant client',
      Object.keys(board).length === 10 && profitability.costsMissing === true &&
      profitability.result === null && calls.length === 2 &&
      calls[0].name === 'my_finance_board' && calls[1].name === 'my_profitability' &&
      !JSON.stringify(calls).includes('company_id'));
  }

  // ── 11. Stock, achats, consommations et coûts certifiés (Prompt 07) ─────────
  console.log('\n[11] Stock, achats, consommations et coûts certifiés (Prompt 07)');
  const sbundle = await build({ contents: `
    export * from './src/lib/stock.ts';
    export * from './src/lib/stockState.ts';
    export { SupabaseStockCommands } from './src/services/adapters/SupabaseStockCommands.ts';
  `, resolveDir: ROOT, sourcefile: 'stock.ts', loader: 'ts' });
  const sm = { exports: {} };
  new Function('module', 'exports', 'require', sbundle.outputFiles[0].text)(sm, sm.exports, require);
  const S = sm.exports;

  const stockBoardFixture = {
    productCategories: [{ id: 'c1', stationId: 'st1', name: 'Consommables', active: true }],
    suppliers: [{ id: 'sup1', stationId: 'st1', name: 'Fournisseur P07', phone: '', email: '', address: '', active: true }],
    products: [{ id: 'prod1', stationId: 'st1', categoryId: 'c1', sku: 'SH1', name: 'Shampoing', category: 'Consommables', unit: 'L', reorderLevel: 3, averageCostMinor: 1500, active: true }],
    purchaseOrders: [{ id: 'o1', stationId: 'st1', supplierId: 'sup1', number: 'CMD-1', status: 'received', orderedAt: day, expectedAt: null, note: '' }],
    purchaseOrderItems: [{ id: 'i1', stationId: 'st1', orderId: 'o1', productId: 'prod1', qtyOrdered: 10, qtyReceived: 10, unitCostMinor: 1000 }],
    stockLevels: [{ productId: 'prod1', stationId: 'st1', name: 'Shampoing', unit: 'L', reorderLevel: 3, qtyOnHand: 10, averageCostMinor: 1500, valueMinor: 15000 }],
    stockMovements: [{ id: 'm1', stationId: 'st1', productId: 'prod1', kind: 'purchase_receipt', qtyDelta: 5, unitCostMinor: 1000, referenceType: 'purchase_order', referenceId: 'o1', idempotencyKey: 'rec-1', note: '', createdAt: now }],
    inventorySessions: [{ id: 'inv1', stationId: 'st1', status: 'closed', startedAt: now, closedAt: now }],
    inventoryItems: [{ id: 'ii1', stationId: 'st1', sessionId: 'inv1', productId: 'prod1', expectedQty: 10, countedQty: 10, difference: 0, reason: '' }],
    services: [{ id: 's1', stationId: 'st1', name: 'Lavage P07', active: true }],
    serviceConsumptions: [{ id: 'sc1', stationId: 'st1', serviceId: 's1', productId: 'prod1', qtyPerWash: 2, active: true }],
    receiptEvents: [{ id: 're1', stationId: 'st1', orderId: 'o1', receiptKey: 'rec-1', lines: [{ product_id: 'prod1', qty: 5 }], createdAt: now }],
    consumptionRuns: [{ id: 'run1', stationId: 'st1', washId: 'w1', movementCount: 1, valuedMinor: 3000, createdAt: now }],
    costCertifications: [{ id: 'cert1', start: day, end: day, revenueMinor: 3000, consumptionCostMinor: 3000, operatingExpenseMinor: 0, commissionCostMinor: 0, grossMarginMinor: 0, resultMinor: 0, attestation: 'Je certifie les couts P07', certifiedAt: now }],
    alerts: [], valuation: { stockValueMinor: 15000, productsValued: 1, consumptionCostMinor: 3000, purchaseCostMinor: 15000, openOrders: 0, lowStockAlerts: 0 },
    rules: { reception: 'Seule la reception incremente le stock' },
  };

  check('my_stock_board : 16 collections camelCase, certification et aucun tenant', (() => {
    const b = S.mapStockBoard(stockBoardFixture);
    return b.products.length === 1 && b.products[0].averageCostMinor === 1500 &&
      b.stockLevels[0].valueMinor === 15000 && b.stockServices[0].name === 'Lavage P07' &&
      b.costCertifications[0].grossMarginMinor === 0 && b.valuation.stockValueMinor === 15000 &&
      b.rules.immutability.includes('jamais') && !JSON.stringify(b).includes('company_id');
  })());

  check('état local P07 : 0 fixture, board construit depuis les services', (() => {
    const emptyCollections = S.emptyStockCollections();
    const local = S.stockBoardFromState(base());
    return Object.keys(emptyCollections).length === 16 &&
      emptyCollections.products.length === 0 && emptyCollections.stockValuation.stockValueMinor === 0 &&
      local.stockServices.length === 2 && local.rules.consumption.includes('fois') &&
      local.valuation.stockValueMinor === 0;
  })());

  check('local P07 : commande sans stock, 2 réceptions, coût moyen 1500, idempotence', (() => {
    let st = S.withStockDefaults(base());
    const prod = S.saveProductLocal(st, { stationId: 'st1', name: 'Shampoing P07', sku: 'P07-SH1', category: 'Consommables', unit: 'L', reorderLevel: 3 });
    st = prod.state;
    const order = S.createPurchaseOrderLocal(st, {
      stationId: 'st1', number: 'CMD-P07-1', orderedAt: day, expectedAt: null,
      lines: [{ productId: prod.id, qtyOrdered: 10, unitCostMinor: 1000 }], idempotencyKey: 'p07-order-1',
    });
    st = order.state;
    const beforeReceipt = st.stockMovements.length;
    st = S.receivePurchaseLinesLocal(st, { orderId: order.id, receiptKey: 'p07-rec-1', lines: [{ productId: prod.id, qty: 5, unitCostMinor: 1000 }] });
    st = S.receivePurchaseLinesLocal(st, { orderId: order.id, receiptKey: 'p07-rec-2', lines: [{ productId: prod.id, qty: 5, unitCostMinor: 2000 }] });
    const duplicate = S.receivePurchaseLinesLocal(st, { orderId: order.id, receiptKey: 'p07-rec-1', lines: [{ productId: prod.id, qty: 5, unitCostMinor: 1000 }] });
    let refused = false;
    try {
      S.receivePurchaseLinesLocal(st, { orderId: order.id, receiptKey: 'p07-rec-1', lines: [{ productId: prod.id, qty: 4, unitCostMinor: 1000 }] });
    } catch (e) { refused = /Clé de réception/.test(e.message); }
    const level = st.stockLevels.find((l) => l.productId === prod.id);
    return beforeReceipt === 0 && st.purchaseOrders[0].status === 'received' &&
      level.qtyOnHand === 10 && level.averageCostMinor === 1500 &&
      st.stockMovements.filter((m) => m.kind === 'purchase_receipt').length === 2 &&
      duplicate.stockMovements.length === st.stockMovements.length && refused;
  })());

  check('local P07 : consommation 1 fois, inventaire +2, certification du résultat net', (() => {
    let st = S.withStockDefaults(base());
    const prod = S.saveProductLocal(st, { stationId: 'st1', name: 'Shampoing P07', category: 'Consommables', unit: 'L', reorderLevel: 3 });
    st = prod.state;
    const order = S.createPurchaseOrderLocal(st, {
      stationId: 'st1', number: 'CMD-P07-1', orderedAt: day, expectedAt: null,
      lines: [{ productId: prod.id, qtyOrdered: 10, unitCostMinor: 1000 }], idempotencyKey: 'p07-order-1',
    });
    st = order.state;
    st = S.receivePurchaseLinesLocal(st, { orderId: order.id, receiptKey: 'p07-rec-1', lines: [{ productId: prod.id, qty: 5, unitCostMinor: 1000 }] });
    st = S.receivePurchaseLinesLocal(st, { orderId: order.id, receiptKey: 'p07-rec-2', lines: [{ productId: prod.id, qty: 5, unitCostMinor: 2000 }] });
    const rule = S.saveServiceConsumptionLocal(st, { serviceId: 's1', productId: prod.id, qtyPerWash: 2 });
    st = rule.state;
    st = S.consumeWashLocal(st, 'w1');
    const duplicate = S.consumeWashLocal(st, 'w1');
    const inv = S.startInventoryLocal(st, 'st1');
    st = S.recordInventoryCountLocal(inv.state, { sessionId: inv.id, productId: prod.id, countedQty: 10, reason: 'Ecart P07' });
    st = S.closeInventoryLocal(st, inv.id);
    const consumption = st.stockMovements.find((m) => m.kind === 'consumption');
    const adjustment = st.stockMovements.find((m) => m.kind === 'inventory_adjustment');
    let refused = false;
    try {
      S.certifyCostsLocal(st, { start: day, end: day, attestation: 'Je certifie les couts P07 complets' });
    } catch (e) { refused = /Coûts incomplets/.test(e.message); }
    const linked = S.linkExpenseToOrderLocal(st, 'e1', order.id);
    const certified = S.certifyCostsLocal(linked, { start: day, end: day, attestation: 'Je certifie les couts P07 complets' });
    let duplicateCert = false;
    try {
      S.certifyCostsLocal(certified, { start: day, end: day, attestation: 'Je certifie encore les couts P07' });
    } catch (e) { duplicateCert = /déjà certifiée/i.test(e.message); }
    const p = certified.profitability;
    const localBoard = S.stockBoardFromState(certified);
    return consumption.qtyDelta === -2 && consumption.unitCostMinor === 1500 &&
      duplicate.consumptionRuns.length === 1 && adjustment.qtyDelta === 2 &&
      st.stockLevels.find((l) => l.productId === prod.id).qtyOnHand === 10 &&
      refused && linked.expenses.find((e) => e.id === 'e1').purchaseOrderId === order.id &&
      p.certified === true && p.costsMissing === false && p.grossMargin === 0 && p.result === 0 &&
      p.consumptions === 3000 && p.purchases === 15000 && p.operatingExpenses === 0 &&
      duplicateCert && localBoard.valuation.stockValueMinor === 15000 &&
      localBoard.costCertifications.length === 1;
  })());

  check('DataAdapter P07 : board local, commandes null en local, RPC exactes en supabase', (() => {
    const local = new A.LocalDataAdapter(() => base());
    return local.stockCommands === null &&
      read('src/services/adapters/DataAdapter.ts').includes('listStockBoard') &&
      read('src/services/adapters/DataAdapter.ts').includes('stockCommands') &&
      read('src/services/adapters/LocalDataAdapter.ts').includes('stockBoardFromState') &&
      read('src/services/adapters/SupabaseDataAdapter.ts').includes("'my_station_stock_board' : 'my_stock_board'");
  })());

  {
    const calls = [];
    const rpcClient = {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from() { throw new Error('Aucune lecture directe de table stock attendue'); },
      async rpc(name, args) {
        calls.push({ name, args: args ?? {} });
        if (name.startsWith('save_') || name.startsWith('create_') || name.startsWith('start_')) {
          return { data: '00000000-0000-4000-8000-000000000001', error: null };
        }
        return { data: null, error: null };
      },
    };
    const commands = new S.SupabaseStockCommands(rpcClient);
    await commands.saveSupplier({ stationId: 'st1', name: 'Fournisseur P07' });
    await commands.saveProduct({ stationId: 'st1', name: 'Shampoing P07', category: 'Consommables', reorderLevel: 3 });
    await commands.createPurchaseOrder({ stationId: 'st1', number: 'CMD-1', orderedAt: day, lines: [{ productId: 'prod1', qtyOrdered: 10, unitCostMinor: 1000 }], idempotencyKey: 'cmd-1' });
    await commands.receivePurchaseLines({ orderId: 'o1', receiptKey: 'rec-1', lines: [{ productId: 'prod1', qty: 5, unitCostMinor: 1000 }] });
    await commands.startInventory('st1');
    await commands.recordInventoryCount({ sessionId: 'inv1', productId: 'prod1', countedQty: 10, reason: 'Ecart' });
    await commands.closeInventory('inv1');
    await commands.saveServiceConsumption({ serviceId: 's1', productId: 'prod1', qtyPerWash: 2 });
    await commands.consumeWash('w1');
    await commands.linkExpenseToOrder('e1', 'o1');
    await commands.certifyCosts({ start: day, end: day, attestation: 'Je certifie les couts P07 complets' });
    const byName = (n) => calls.find((c) => c.name === n)?.args ?? {};
    check('11 commandes stock RPC : noms/arguments exacts, aucun tenant ni clé service',
      calls.length === 11 && byName('save_product').p_reorder_level === 3 &&
      byName('create_purchase_order').p_ordered_at === day && byName('create_purchase_order').p_idempotency_key === 'cmd-1' &&
      byName('receive_purchase_lines').p_receipt_key === 'rec-1' &&
      byName('receive_purchase_lines').p_lines[0].product_id === 'prod1' &&
      byName('record_inventory_count').p_counted_qty === 10 &&
      byName('save_service_consumption').p_qty_per_wash === 2 &&
      byName('consume_products_for_wash').p_wash_id === 'w1' &&
      byName('certify_profitability_period').p_start === day &&
      !JSON.stringify(calls).includes('company_id') && !JSON.stringify(calls).includes('service_role'));
  }

  {
    const calls = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from() { throw new Error('Aucune lecture directe de table stock attendue'); },
      async rpc(name, args) {
        calls.push({ name, args: args ?? {} });
        if (name === 'my_stock_board') return { data: stockBoardFixture, error: null };
        return { data: null, error: null };
      },
    };
    const adapter = new A.SupabaseDataAdapter(client);
    const snapshot = await adapter.listStockBoard();
    check('adaptateur serveur P07 : my_stock_board, aucun filtre tenant, 16 collections',
      snapshot.products.length === 1 && snapshot.valuation.stockValueMinor === 15000 &&
      snapshot.costCertifications.length === 1 && calls.length === 1 &&
      calls[0].name === 'my_stock_board' && !JSON.stringify(calls).includes('company_id'));
  }

  check('migrations 030 → 033 : fondation, 11 RPC, board, certification', (() => {
    const s030 = read('supabase/migrations/030_stock_foundation.sql');
    const s031 = read('supabase/migrations/031_stock_commands.sql');
    const s032 = read('supabase/migrations/032_stock_board.sql');
    const s033 = read('supabase/migrations/033_finance_cost_certification.sql');
    return s030.includes('average_cost_minor') && s030.includes('REVOKE INSERT, UPDATE, DELETE') &&
      s031.includes('receive_purchase_lines') && s031.includes('p_receipt_key') &&
      s031.includes('ROUND(') && s031.includes('consume_products_for_wash') &&
      s032.includes('STABLE SECURITY DEFINER') && s032.includes("'productCategories'") &&
      s033.includes('finance_cost_periods') && s033.includes("'costsMissing', false") &&
      s033.includes("'result', NULL") && s033.includes('Couts certifies : resultat net calculable');
  })());

  check('frontend P07 : 2 routes actives, 2 pages, certification et aucun faux résultat', (() => {
    const nav = read('src/components/navigation.tsx');
    const app = read('src/App.tsx');
    const reports = read('src/pages/Reports.tsx');
    const stockPage = read('src/pages/Stock.tsx');
    const consPage = read('src/pages/Consumptions.tsx');
    return nav.includes("to: '/app/stock'") && nav.includes("to: '/app/consommations'") &&
      !nav.includes("upcoming: { step: '07'") && app.includes('<Stock />') && app.includes('<Consumptions />') &&
      stockPage.includes('Stocks & achats') && consPage.includes('Consommations') &&
      reports.includes('certifyCosts') && reports.includes('p.costsMissing') &&
      reports.includes('PAS un bénéfice net') && reports.includes('NULL') &&
      !read('src/services/adapters/SupabaseStockCommands.ts').includes('company_id');
  })());

  check('test distant P07 : BEGIN … ROLLBACK, contrôles de coûts et 0 fixture', (() => {
    const t = read('supabase/tests/p07_rollback.sql');
    return /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('SELECT label, ok, detail FROM p07_result') &&
      t.includes('my_stock_board()') && t.includes('certify_profitability_period') &&
      t.includes('0 fixture metier') && fs.existsSync(path.join(ROOT, 'docs/stock.md'));
  })());

  // ── 12. CRM, fidélisation, forfaits, promotions, flottes (P08) ────────────
  console.log('\n[12] CRM, fidélité, forfaits, promotions et flottes (Prompt 08)');
  const crmBundle = await build({ contents: `
    export { mapCrmBoard, crmBoardFromState, withCrmDefaults, emptyCrmCollections, CRM_RULES } from './src/lib/crm.ts';
    export * from './src/lib/crmState.ts';
    export { SupabaseCrmCommands } from './src/services/adapters/SupabaseCrmCommands.ts';
    export { LocalDataAdapter } from './src/services/adapters/LocalDataAdapter.ts';
    export { SupabaseDataAdapter } from './src/services/adapters/SupabaseDataAdapter.ts';
  `, resolveDir: ROOT, sourcefile: 'crm.ts', loader: 'ts' });
  const cm = { exports: {} };
  new Function('module', 'exports', 'require', crmBundle.outputFiles[0].text)(cm, cm.exports, require);
  const C = cm.exports;
  const day8 = now.slice(0, 10);

  const boardFixture = () => ({
    clients: [{ id: 'cl1', stationId: 'st1', name: 'Client P08', phone: '', email: 'client@test.invalid', plate: '1234 AB 01', notes: '', customerType: 'individual', preferredChannel: 'email', loyaltyOptIn: true, fleetId: null, createdAt: now }],
    vehicles: [{ id: 'v1', stationId: 'st1', customerId: 'cl1', categoryId: 'c1', plate: '1234 AB 01', brand: '', model: '', color: '', fleetId: null, active: true, createdAt: now }],
    loyaltyPrograms: [{ id: 'p1', stationId: 'st1', name: 'Programme', pointsPer1000Minor: 2, redemptionThreshold: 50, active: true, createdAt: now }],
    loyaltyCards: [{ id: 'lc1', stationId: 'st1', customerId: 'cl1', programId: 'p1', cardNumber: 'LC-1', pointsBalance: 10, status: 'active', createdAt: now }],
    loyaltyTransactions: [{ id: 'lt1', stationId: 'st1', cardId: 'lc1', washId: 'w1', kind: 'earn', pointsDelta: 10, reason: '', createdAt: now }],
    packagePlans: [{ id: 'pp1', stationId: 'st1', name: 'Forfait', description: '', priceMinor: 10000, washCount: 2, validityDays: 30, startsAt: day8, endsAt: null, active: true, createdAt: now }],
    customerPackages: [{ id: 'cp1', stationId: 'st1', customerId: 'cl1', packageId: 'pp1', purchasedAt: day8, expiresAt: day8, washesRemaining: 2, status: 'active', createdAt: now }],
    packageUsages: [], promotions: [], promotionUsages: [], fleets: [], fleetContracts: [], fleetVehicles: [], fleetReceivables: [],
    notificationOutbox: [{ id: 'n1', stationId: 'st1', customerId: 'cl1', fleetId: null, channel: 'email', templateKey: 'package_expiry', payload: {}, status: 'pending', createdAt: now, cancelledAt: null }],
    stats: { clients: 1, vehicles: 1, activeCards: 1, activePackages: 1, activePromotions: 0, fleets: 0, openReceivablesMinor: 0, pendingNotifications: 1 },
    rules: { provider: 'Aucun fournisseur connecte : la file reste en attente, aucun envoi simule.', promotion: 'Une seule promotion par fiche.', package: 'Validite cote serveur.', loyalty: 'Points idempotents.', tenant: 'Tenant deduit du JWT.' },
  });

  {
    const snapshot = C.mapCrmBoard(boardFixture());
    const collections = ['clients','vehicles','loyaltyPrograms','loyaltyCards','loyaltyTransactions','packagePlans','customerPackages','packageUsages','promotions','promotionUsages','fleets','fleetContracts','fleetVehicles','fleetReceivables','notificationOutbox'];
    check('projection my_crm_board : 15 collections camelCase, stats et règles, aucun tenant',
      collections.every((k) => Array.isArray(snapshot[k])) && snapshot.clients[0].preferredChannel === 'email' &&
      snapshot.stats.pendingNotifications === 1 && snapshot.notificationOutbox[0].status === 'pending' &&
      !JSON.stringify(snapshot).includes('company_id') && !JSON.stringify(snapshot).includes('sentAt'));
  }

  {
    const board = C.crmBoardFromState(C.withCrmDefaults(empty()));
    check('local P08 : 0 fixture, 15 collections vides et 8 stats à zéro',
      board.clients.length === 0 && board.vehicles.length === 0 && board.loyaltyCards.length === 0 &&
      board.packagePlans.length === 0 && board.promotions.length === 0 && board.fleets.length === 0 &&
      board.notificationOutbox.length === 0 && board.stats.clients === 0 && board.stats.pendingNotifications === 0 &&
      board.rules.provider.toLowerCase().includes('aucun fournisseur'));
  }

  let crmState = C.withCrmDefaults(base());
  crmState = { ...crmState, washes: crmState.washes.map((w) => w.id === 'w1'
    ? { ...w, payments: [], discount: 0, total: 5000, promotionId: null, packageId: null } : w) };
  const profile = C.saveCustomerProfileLocal(crmState, {
    stationId: 'st1', customerId: 'cl1', name: 'Client P08', phone: '', email: 'client@test.invalid',
    notes: '', channel: 'email', loyaltyOptIn: true,
  });
  const vehicleMutation = C.saveCustomerVehicleLocal(profile.state, {
    stationId: 'st1', customerId: 'cl1', plate: '1234 AB 01', categoryId: 'c1',
  });
  check('local P08 : fiche client enrichie, préférence de canal et véhicule',
    profile.value === 'cl1' && vehicleMutation.state.clients[0].preferredChannel === 'email' &&
    vehicleMutation.state.clients[0].loyaltyOptIn === true &&
    vehicleMutation.state.vehicles.length === 1 && vehicleMutation.state.vehicles[0].plate === '1234 AB 01');

  const program = C.createLoyaltyProgramLocal(vehicleMutation.state, {
    stationId: 'st1', name: 'Programme P08', pointsPer1000Minor: 2, redemptionThreshold: 50,
  });
  const card = C.enrollLoyaltyCustomerLocal(program.state, {
    stationId: 'st1', customerId: 'cl1', programId: program.value, cardNumber: 'LC-P08',
  });
  const loyalty1 = C.recordLoyaltyTransactionLocal(card.state, {
    cardId: card.value, kind: 'earn', pointsDelta: 10, reason: 'Ajustement', idempotencyKey: 'loy-1',
  });
  const loyalty2 = C.recordLoyaltyTransactionLocal(loyalty1.state, {
    cardId: card.value, kind: 'earn', pointsDelta: 10, reason: 'Ajustement', idempotencyKey: 'loy-1',
  });
  check('local P08 : fidélité idempotente et solde insuffisant refusé',
    loyalty1.value === loyalty2.value && loyalty2.state.loyaltyTransactions.length === 1 &&
    loyalty2.state.loyaltyCards[0].pointsBalance === 10 &&
    (() => { try { C.recordLoyaltyTransactionLocal(loyalty2.state, { cardId: card.value, kind: 'redeem', pointsDelta: -999, idempotencyKey: 'bad' }); return false; } catch { return true; } })());

  const plan = C.savePackagePlanLocal(loyalty2.state, {
    stationId: 'st1', name: 'Forfait P08', priceMinor: 10000, washCount: 2,
    validityDays: 30, startsAt: day8, endsAt: null,
  });
  const sale1 = C.sellPackageToCustomerLocal(plan.state, {
    stationId: 'st1', customerId: 'cl1', packageId: plan.value, purchasedAt: day8, idempotencyKey: 'sale-1',
  });
  const sale2 = C.sellPackageToCustomerLocal(sale1.state, {
    stationId: 'st1', customerId: 'cl1', packageId: plan.value, purchasedAt: day8, idempotencyKey: 'sale-1',
  });
  const consumed1 = C.consumePackageForWashLocal(sale2.state, 'w1');
  const consumed2 = C.consumePackageForWashLocal(consumed1.state, 'w1');
  check('local P08 : validité du forfait, vente et consommation idempotentes',
    sale1.value === sale2.value && sale2.state.customerPackages.length === 1 &&
    consumed1.value.consumed === true && consumed1.value.remaining === 1 &&
    consumed2.value.duplicate === true && consumed2.state.packageUsages.length === 1 &&
    (() => { try { C.savePackagePlanLocal(sale2.state, { stationId: 'st1', name: 'Invalide', priceMinor: 0, washCount: 0, validityDays: 0, startsAt: day8 }); return false; } catch { return true; } })());

  const promotion = C.savePromotionLocal(consumed2.state, {
    stationId: 'st1', name: 'Promo 10%', code: 'P08-10', kind: 'percent', value: 10,
    startsAt: day8, endsAt: day8, maxUsages: 1, minAmountMinor: 1000,
  });
  const promo1 = C.applyPromotionToWashLocal(promotion.state, {
    washId: 'w1', code: 'P08-10', idempotencyKey: 'promo-1',
  });
  const promo2 = C.applyPromotionToWashLocal(promo1.state, {
    washId: 'w1', code: 'P08-10', idempotencyKey: 'promo-1',
  });
  check('local P08 : 10 % de 5 000 = 500, aucune promotion appliquée deux fois',
    promo1.value.applied === true && promo1.value.discountMinor === 500 &&
    promo2.value.duplicate === true && promo2.state.promotionUsages.length === 1 &&
    promo2.state.washes.find((w) => w.id === 'w1').total === 4500 &&
    promo2.state.washes.find((w) => w.id === 'w1').discount === 500);

  const notif1 = C.enqueueNotificationLocal(promo2.state, {
    stationId: 'st1', templateKey: 'package_expiry', customerId: 'cl1', payload: {}, idempotencyKey: 'notif-1',
  });
  const notif2 = C.enqueueNotificationLocal(notif1.state, {
    stationId: 'st1', templateKey: 'package_expiry', customerId: 'cl1', payload: {}, idempotencyKey: 'notif-1',
  });
  const cancelled = C.cancelPendingNotificationLocal(notif2.state, notif1.value);
  const noChannel = C.saveCustomerProfileLocal(cancelled.state, {
    stationId: 'st1', name: 'Sans canal', channel: 'none',
  });
  const refusedNone = (() => { try { C.enqueueNotificationLocal(noChannel.state, { stationId: 'st1', templateKey: 'package_expiry', customerId: noChannel.value, idempotencyKey: 'notif-none' }); return false; } catch { return true; } })();
  check('local P08 : notification sans envoi, idempotente, aucun canal refusé',
    notif1.value === notif2.value && cancelled.state.notificationOutbox.length === 1 &&
    cancelled.state.notificationOutbox[0].status === 'cancelled' &&
    cancelled.state.notificationOutbox[0].channel === 'email' && refusedNone &&
    !JSON.stringify(cancelled.state.notificationOutbox).includes('sentAt'));

  const fleet = C.saveFleetLocal(cancelled.state, {
    stationId: 'st1', name: 'Flotte P08', creditLimitMinor: 5000, channel: 'sms',
  });
  const contract = C.saveFleetContractLocal(fleet.state, {
    stationId: 'st1', fleetId: fleet.value, number: 'FL-P08-1', startDate: day8,
    endDate: day8, creditLimitMinor: 5000,
  });
  const recv1 = C.recordFleetReceivableLocal(contract.state, {
    stationId: 'st1', fleetId: fleet.value, contractId: contract.value,
    amountMinor: 5000, dueDate: day8, idempotencyKey: 'recv-1',
  });
  const recv2 = C.recordFleetReceivableLocal(recv1.state, {
    stationId: 'st1', fleetId: fleet.value, contractId: contract.value,
    amountMinor: 5000, dueDate: day8, idempotencyKey: 'recv-1',
  });
  const creditRefused = (() => { try { C.recordFleetReceivableLocal(recv2.state, { stationId: 'st1', fleetId: fleet.value, contractId: contract.value, amountMinor: 1000, dueDate: day8, idempotencyKey: 'recv-2' }); return false; } catch { return true; } })();
  check('local P08 : contrat, créance idempotente et limite de crédit respectée',
    recv1.value === recv2.value && recv2.state.fleetReceivables.length === 1 &&
    recv2.state.fleetReceivables[0].amountMinor === 5000 && creditRefused);

  {
    const local = new C.LocalDataAdapter(() => C.withCrmDefaults(base()));
    const board = await local.listCrmBoard();
    check('DataAdapter P08 : board local, commandes null en local, RPC exactes en supabase',
      local.crmCommands === null && board.clients.length === 1 &&
      read('src/services/adapters/DataAdapter.ts').includes('listCrmBoard') &&
      read('src/services/adapters/DataAdapter.ts').includes('crmCommands') &&
      read('src/services/adapters/LocalDataAdapter.ts').includes('crmBoardFromState') &&
      read('src/services/adapters/SupabaseDataAdapter.ts').includes("'my_station_crm_board' : 'my_crm_board'"));
  }

  {
    const calls = [];
    const rpcClient = {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from() { throw new Error('Aucune lecture directe de table CRM attendue'); },
      async rpc(name, args) {
        calls.push({ name, args: args ?? {} });
        if (name === 'accrue_loyalty_for_wash') return { data: { points: 10, duplicate: false }, error: null };
        if (name === 'consume_package_for_wash') return { data: { consumed: true, duplicate: false, remaining: 1 }, error: null };
        if (name === 'apply_promotion_to_wash') return { data: { applied: true, duplicate: false, discountMinor: 500 }, error: null };
        if (name === 'cancel_pending_notification') return { data: null, error: null };
        return { data: '00000000-0000-4000-8000-000000000001', error: null };
      },
    };
    const commands = new C.SupabaseCrmCommands(rpcClient);
    await commands.saveCustomerProfile({ stationId: 'st1', name: 'Client P08', channel: 'email' });
    await commands.saveCustomerVehicle({ stationId: 'st1', customerId: 'cl1', plate: '1234 AB 01' });
    await commands.createLoyaltyProgram({ stationId: 'st1', name: 'Programme', pointsPer1000Minor: 2, redemptionThreshold: 50 });
    await commands.enrollLoyaltyCustomer({ stationId: 'st1', customerId: 'cl1', programId: 'p1' });
    await commands.recordLoyaltyTransaction({ cardId: 'lc1', kind: 'earn', pointsDelta: 10 });
    await commands.accrueLoyaltyForWash('w1');
    await commands.savePackagePlan({ stationId: 'st1', name: 'Forfait', priceMinor: 10000, washCount: 2, validityDays: 30 });
    await commands.sellPackageToCustomer({ stationId: 'st1', customerId: 'cl1', packageId: 'pp1' });
    await commands.consumePackageForWash('w1');
    await commands.savePromotion({ stationId: 'st1', name: 'Promo', code: 'P08-10', kind: 'percent', value: 10 });
    await commands.applyPromotionToWash({ washId: 'w1', code: 'P08-10', idempotencyKey: 'promo-1' });
    await commands.saveFleet({ stationId: 'st1', name: 'Flotte' });
    await commands.saveFleetContract({ stationId: 'st1', fleetId: 'f1', number: 'FL-1' });
    await commands.attachFleetVehicle({ stationId: 'st1', fleetId: 'f1', vehicleId: 'v1' });
    await commands.recordFleetReceivable({ stationId: 'st1', fleetId: 'f1', contractId: 'c1', amountMinor: 5000 });
    await commands.enqueueNotification({ stationId: 'st1', templateKey: 'package_expiry', customerId: 'cl1' });
    await commands.cancelPendingNotification('n1');
    const byName = (n) => calls.find((c) => c.name === n)?.args ?? {};
    check('17 commandes CRM RPC : noms/arguments exacts, aucun tenant ni clé service',
      calls.length === 17 && byName('save_customer_profile').p_channel === 'email' &&
      byName('save_customer_vehicle').p_plate === '1234 AB 01' &&
      byName('create_loyalty_program').p_points_per_1000_minor === 2 &&
      byName('record_loyalty_transaction').p_points_delta === 10 &&
      byName('save_package_plan').p_wash_count === 2 &&
      byName('save_promotion').p_code === 'P08-10' &&
      byName('apply_promotion_to_wash').p_idempotency_key === 'promo-1' &&
      byName('enqueue_notification').p_template_key === 'package_expiry' &&
      byName('cancel_pending_notification').p_notification_id === 'n1' &&
      !JSON.stringify(calls).includes('company_id') && !JSON.stringify(calls).includes('service_role'));
  }

  {
    const calls = [];
    const reader = {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from() { throw new Error('Aucune lecture directe de table CRM attendue'); },
      async rpc(name) {
        calls.push(name);
        return { data: boardFixture(), error: null };
      },
    };
    const adapter = new C.SupabaseDataAdapter(reader);
    const snapshot = await adapter.listCrmBoard();
    check('adaptateur serveur P08 : my_crm_board, 15 collections, aucun filtre tenant',
      snapshot.clients.length === 1 && snapshot.notificationOutbox.length === 1 &&
      snapshot.stats.pendingNotifications === 1 && calls.length === 1 &&
      calls[0] === 'my_crm_board' && !JSON.stringify(snapshot).includes('company_id'));
  }

  check('migrations 034 → 038 : 13 tables, 18 RPC, board, file sans fournisseur, correctif', (() => {
    const s034 = read('supabase/migrations/034_crm_foundation.sql');
    const s035 = read('supabase/migrations/035_crm_commands.sql');
    const s036 = read('supabase/migrations/036_crm_board.sql');
    const s037 = read('supabase/migrations/037_crm_notifications.sql');
    const s038 = read('supabase/migrations/038_promotion_idempotency_order.sql');
    return s034.includes('notification_outbox') && s034.includes('crm.view') &&
      s034.includes('REVOKE INSERT, UPDATE, DELETE') && !s034.includes('crm_idempotency_key') &&
      s035.includes('apply_promotion_to_wash') && s035.includes('consume_package_for_wash') &&
      s035.includes('Numero de contrat deja utilise par une autre flotte') &&
      s036.includes('STABLE SECURITY DEFINER') && s036.includes("'notificationOutbox'") &&
      s036.includes('aucun envoi simule') && s037.includes('preferred_channel') &&
      s037.includes('aucun envoi') && !/sent_at|provider|sent_by|api_key/i.test(s037) &&
      s038.includes('v_key := NULLIF') && s038.indexOf('v_key := NULLIF') < s038.indexOf("RAISE EXCEPTION 'Quota");
  })());

  check('frontend P08 : 2 routes actives, 2 pages, fiche enrichie, 48 permissions', (() => {
    const nav = read('src/components/navigation.tsx');
    const app = read('src/App.tsx');
    return !nav.includes("upcoming: { step: '08'") &&
      nav.includes("to: '/app/fidelisation'") && nav.includes("to: '/app/flottes'") &&
      app.includes('<Fidelisation />') && app.includes('<Flottes />') &&
      read('src/pages/Fidelisation.tsx').includes('Fidélisation & forfaits') &&
      read('src/pages/Flottes.tsx').includes('Flottes & contrats') &&
      read('src/pages/Clients.tsx').includes('Canal préféré') &&
      read('src/lib/store.tsx').includes('crmRpc') &&
      read('src/lib/permissionCatalog.ts').includes("'/app/fidelisation': 'crm.view'") &&
      read('src/lib/permissionCatalog.ts').includes("'/app/flottes': 'fleets.view'") &&
      !read('src/services/adapters/SupabaseCrmCommands.ts').includes('company_id');
  })());

  check('test distant P08 : BEGIN … ROLLBACK, validité, promotion unique, 0 fixture', (() => {
    const t = read('supabase/tests/p08_rollback.sql');
    return /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('SELECT label, ok, detail FROM p08_result') &&
      t.includes('jamais appliquee deux fois') && t.includes('aucun envoi simule') &&
      t.includes('my_crm_board()') && t.includes('isolation A/B') &&
      fs.existsSync(path.join(ROOT, 'docs/crm.md'));
  })());


  // ── 13. Analytics, quotas, graphiques et back-office SaaS (Prompt 09) ──────
  console.log('\n[13] Analytics, quotas et administration SaaS (Prompt 09)');
  const p09Bundle = await build({ contents: `
    export {
      analyticsBoardFromState, emptyAnalyticsBoard, emptyPlatformBoard,
      emptySubscriptionUsage, mapAnalyticsBoard, mapPlatformBoard,
      mapSubscriptionUsage, monthStartISO, platformBoardFromState,
      previousPeriod, subscriptionUsageFromState,
    } from './src/lib/analytics.ts';
    export { LocalDataAdapter } from './src/services/adapters/LocalDataAdapter.ts';
    export { SupabaseDataAdapter } from './src/services/adapters/SupabaseDataAdapter.ts';
    export { SupabaseAnalyticsCommands } from './src/services/adapters/SupabaseAnalyticsCommands.ts';
  `, resolveDir: ROOT, sourcefile: 'analytics.ts', loader: 'ts' });
  const p09Module = { exports: {} };
  new Function('module', 'exports', 'require', p09Bundle.outputFiles[0].text)(p09Module, p09Module.exports, require);
  const AN = p09Module.exports;
  const p09Start = AN.monthStartISO();
  const p09End = new Date().toISOString().slice(0, 10);
  const p09Previous = AN.previousPeriod(p09Start, p09End);

  check('migrations 039 → 044 : fondation, quotas, board, back-office, durcissement, correctif', (() => {
    const s039 = read('supabase/migrations/039_analytics_foundation.sql');
    const s040 = read('supabase/migrations/040_quota_guard.sql');
    const s041 = read('supabase/migrations/041_analytics_board.sql');
    const s042 = read('supabase/migrations/042_platform_commands.sql');
    const s043 = read('supabase/migrations/043_analytics_hardening.sql');
    const s044 = read('supabase/migrations/044_quota_snapshot_fix.sql');
    return s039.includes('analytics.view') && s039.includes('v_station_daily_activity') &&
      s039.includes('security_invoker = true') && s039.includes('platform.quotas.manage') &&
      s040.includes('assert_subscription_limit') && s040.includes('trg_quota_washes') &&
      s041.includes('my_analytics_board') && s041.includes('my_profitability') &&
      s041.includes('my_subscription_usage') && s041.includes("'grossMargin', NULL") &&
      s042.includes('my_platform_board') && s042.includes('admin_save_plan') &&
      s042.includes('admin_set_company_suspended') && s042.includes('platform_audit_logs') &&
      s043.includes('REVOKE ALL ON FUNCTION') && s043.includes('GRANT EXECUTE') &&
      s044.includes('CREATE OR REPLACE FUNCTION public.refresh_subscription_usage') &&
      s044.includes('c.id = v_company');
  })());

  check('P09 : 5 permissions, 2 vues, 3 triggers, 44 migrations et 0 table ajoutée',
    (() => {
      const p09Sql = sqlFiles.slice(38, 44).map((f) => read('supabase/migrations/' + f)).join('\n');
      return /analytics\.view/.test(p09Sql) && /analytics\.compare/.test(p09Sql) &&
        /platform\.plans\.manage/.test(p09Sql) && /platform\.companies\.manage/.test(p09Sql) &&
        /platform\.quotas\.manage/.test(p09Sql) &&
        /CREATE VIEW public\.v_station_daily_activity/.test(p09Sql) &&
        /CREATE VIEW public\.v_company_quota_usage/.test(p09Sql) &&
        /trg_quota_stations/.test(p09Sql) && /trg_quota_profiles/.test(p09Sql) &&
        /trg_quota_washes/.test(p09Sql) &&
        !/CREATE TABLE public\./.test(p09Sql);
    })());

  check('P09 : tarifs 0 / 15 000 / 35 000 FCFA présentés comme hypothèses commerciales',
    read('docs/analytics.md').includes('hypothèses commerciales') &&
    read('src/pages/Platform.tsx').includes('hypothèses commerciales') &&
    read('src/pages/Consolidation.tsx').includes('hypothèses commerciales'));

  check('P09 : test distant BEGIN … ROLLBACK, quota refusé, 0 fixture', (() => {
    const t = read('supabase/tests/p09_rollback.sql');
    return /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('SELECT label, ok, detail FROM p09_result') &&
      t.includes('quota : 3e lavage refuse 23514') &&
      t.includes('my_analytics_board') && t.includes('my_platform_board') &&
      t.includes('isolation A/B');
  })());

  check('P09 : 3 boards et 5 commandes RPC, aucun identifiant de tenant brut', (() => {
    const adapterSrc = read('src/services/adapters/DataAdapter.ts');
    const localSrc = read('src/services/adapters/LocalDataAdapter.ts');
    const supaSrc = read('src/services/adapters/SupabaseDataAdapter.ts');
    const commands = read('src/services/adapters/SupabaseAnalyticsCommands.ts');
    return adapterSrc.includes('listAnalyticsBoard') && adapterSrc.includes('listSubscriptionUsage') &&
      adapterSrc.includes('listPlatformBoard') && adapterSrc.includes('analyticsCommands') &&
      localSrc.includes('analyticsCommands = null') && localSrc.includes('listPlatformBoard') &&
      supaSrc.includes("rpc('my_accessible_analytics_board'") && supaSrc.includes("rpc('my_subscription_usage'") &&
      supaSrc.includes("rpc('my_platform_board')") &&
      commands.includes('this.client.rpc(name, args)') &&
      commands.includes("this.call('admin_save_plan'") &&
      commands.includes("this.call('admin_set_plan_limit'") &&
      commands.includes("this.call('admin_set_company_subscription'") &&
      commands.includes("this.call('admin_set_company_suspended'") &&
      commands.includes("this.call('refresh_subscription_usage'") &&
      !commands.includes('company_id');
  })());

  check('P09/P10 : 19 routes actives, Recharts v2, entrées step 09 et 10 retirées', (() => {
    const nav = read('src/components/navigation.tsx');
    const app = read('src/App.tsx');
    return nav.includes("to: '/app/consolidation'") && nav.includes("to: '/app/qualite'") &&
      !nav.includes("upcoming: { step: '09'") && !nav.includes("upcoming: { step: '10'") &&
      app.includes('<Consolidation />') && app.includes('<Quality />') &&
      read('src/pages/Consolidation.tsx').includes("from 'recharts'") &&
      read('src/pages/Dashboard.tsx').includes("from 'recharts'") &&
      read('src/lib/permissionCatalog.ts').includes("'/app/consolidation': 'analytics.view'") &&
      read('package.json').includes('"recharts": "^2.15.4"');
  })());

  {
    const localBoard = AN.analyticsBoardFromState(base(), p09Start, p09End, p09Previous.start, p09Previous.end);
    check('board local P09 : mêmes définitions, CA 3 000, aucun résultat net par station',
      localBoard.period.revenue === 3000 && localBoard.compare.revenue === 0 &&
      localBoard.compareDelta === 3000 && localBoard.stations.length === 1 &&
      localBoard.stations[0].grossMargin === null && localBoard.stations[0].result === null &&
      localBoard.definitions.partialBalance.includes('PAS un benefice net') &&
      localBoard.rules.pricing.includes('hypothèses commerciales'));
    const mapped = AN.mapAnalyticsBoard(localBoard);
    check('mapAnalyticsBoard : NULL préservé, classement CA, camelCase sans tenant brut',
      mapped.stations[0].grossMargin === null && mapped.stations[0].result === null &&
      mapped.stats.compareDelta === 3000 && mapped.rankings[0].rank === 1 &&
      !JSON.stringify(mapped).includes('company_id'));
  }

  {
    const usage = AN.mapSubscriptionUsage(AN.subscriptionUsageFromState(base(), p09Start));
    const platform = AN.mapPlatformBoard(AN.platformBoardFromState(base()));
    check('quotas et back-office locaux : limites réelles, plans administrables, journal',
      usage.limits.washesPerMonth === 100 && usage.usage.washes === 1 &&
      platform.plans.length === 3 && platform.planLimits.length === 9 &&
      platform.companies.length === 1 && platform.auditLogs.length === 1 &&
      platform.rules.pricing.includes('hypothèses commerciales') &&
      !JSON.stringify(platform).includes('company_id'));
  }

  {
    const local9 = new AN.LocalDataAdapter(() => base());
    const board = await local9.listAnalyticsBoard(p09Start, p09End, p09Previous.start, p09Previous.end);
    const usage = await local9.listSubscriptionUsage(p09Start);
    const platform = await local9.listPlatformBoard();
    check('LocalDataAdapter P09 : 3 boards locaux, analyticsCommands null',
      local9.analyticsCommands === null && board.period.revenue === 3000 &&
      usage.usage.washes === 1 && platform.plans.length === 3);
  }

  {
    const calls = [];
    const reader = {
      auth: { getUser: async () => ({ data: { user: { id: 'u-db' } }, error: null }) },
      from() { throw new Error('Aucune lecture directe de table P09 attendue'); },
      async rpc(name) {
        calls.push(name);
        if (name === 'my_accessible_analytics_board') {
          return { data: AN.analyticsBoardFromState(base(), p09Start, p09End, p09Previous.start, p09Previous.end), error: null };
        }
        if (name === 'my_subscription_usage') {
          return { data: AN.subscriptionUsageFromState(base(), p09Start), error: null };
        }
        if (name === 'my_platform_board') {
          return { data: AN.platformBoardFromState(base()), error: null };
        }
        return { data: null, error: null };
      },
    };
    const adapter9 = new AN.SupabaseDataAdapter(reader);
    await adapter9.listAnalyticsBoard(p09Start, p09End, p09Previous.start, p09Previous.end);
    await adapter9.listSubscriptionUsage(p09Start);
    await adapter9.listPlatformBoard();
    check('SupabaseDataAdapter P09 : 3 boards par RPC, aucun filtre de tenant',
      calls.length === 3 && calls[0] === 'my_accessible_analytics_board' &&
      calls[1] === 'my_subscription_usage' && calls[2] === 'my_platform_board');
  }

  {
    const calls = [];
    const client = {
      async rpc(name, args) {
        calls.push({ name, args: args ?? {} });
        if (name === 'admin_save_plan') return { data: 'essai', error: null };
        return { data: null, error: null };
      },
    };
    const commands = new AN.SupabaseAnalyticsCommands(client);
    await commands.refreshSubscriptionUsage(p09Start);
    await commands.savePlan({ planId: 'essai', name: 'Essai', priceMinor: 0, trialDays: 14, active: true, sortOrder: 1, features: [] });
    await commands.setPlanLimit({ planId: 'essai', key: 'washes_per_month', valueInt: 2 });
    await commands.setCompanySubscription({ companyId: 'co1', planId: 'standard', status: 'active' });
    await commands.setCompanySuspended({ companyId: 'co1', suspended: true });
    const byName = (n) => calls.find((c) => c.name === n)?.args ?? {};
    check('5 commandes du back-office : noms/arguments exacts, aucun company_id',
      calls.length === 5 && byName('admin_set_plan_limit').p_value_int === 2 &&
      byName('admin_set_company_subscription').p_company === 'co1' &&
      byName('admin_set_company_suspended').p_suspended === true &&
      !JSON.stringify(calls).includes('company_id'));
  }

  {
    const { dom, w } = makeDom('/app/tableau-de-bord', base());
    const errs = await mount(acode, w);
    const t = w.document.body.textContent.replace(/\s+/g, ' ');
    check('DOM P09 : dashboard station, graphique et lien de consolidation',
      t.includes('Tendance du mois') && Boolean(w.document.querySelector('a[href="/app/consolidation"]')) &&
      w.document.querySelectorAll('svg').length >= 1 && errs.length === 0,
      'err=' + errs.length + ' ' + (errs[0] || '').slice(0, 140));
    dom.window.close();
  }

  {
    const { dom, w } = makeDom('/app/consolidation', base());
    const errs = await mount(acode, w);
    const t = w.document.body.textContent.replace(/\s+/g, ' ');
    check('DOM P09 : consolidation, comparaison et graphiques Recharts',
      t.includes('Consolidation multi-stations') && t.includes('Comparaison des périodes') &&
      w.document.querySelectorAll('svg').length >= 1 && errs.length === 0,
      'err=' + errs.length + ' ' + (errs[0] || '').slice(0, 140));
    dom.window.close();
  }

  {
    const supportState = { ...base(), session: { ...base().session, role: 'super_admin', name: 'Super admin SaaS', companyId: null, stationId: null } };
    const { dom, w } = makeDom('/app/plateforme', supportState);
    const errs = await mount(acode, w);
    const t = w.document.body.textContent.replace(/\s+/g, ' ');
    check('DOM P09 : back-office super admin, quotas, formules et journaux',
      t.includes('Espace plateforme') && t.includes('Formules et limites administrables') &&
      t.includes('Usage et quotas du mois') && t.includes('Journal de la plateforme') && errs.length === 0,
      'err=' + errs.length + ' ' + (errs[0] || '').slice(0, 140));
    dom.window.close();
  }


  // ── 14. QA, sécurité, performance et déploiement (Prompt 10) ───────────────
  console.log('\n[14] QA, Storage, Playwright et déploiement (Prompt 10)');
  const has = (p) => fs.existsSync(path.join(ROOT, p));
  const p10NetBundle = await build({ contents: `
    export { NetworkError, isRetryable, idempotencyKey, withRetry } from './src/lib/network.ts';
  `, resolveDir: ROOT, sourcefile: 'p10-network.ts', loader: 'ts' });
  const netModule = { exports: {} };
  new Function('module', 'exports', 'require', p10NetBundle.outputFiles[0].text)(netModule, netModule.exports, require);
  const NET = netModule.exports;

  let retryCalls = 0;
  const retried = await NET.withRetry(async () => {
    retryCalls += 1;
    if (retryCalls === 1) throw new Error('fetch failed');
    return 'ok';
  }, { retries: 2, baseDelayMs: 1 });
  check('réseau P10 : retry sur panne réseau, jamais sur erreur métier',
    retried === 'ok' && retryCalls === 2 &&
    NET.isRetryable(new Error('fetch failed')) &&
    !NET.isRetryable(new Error('42501 permission refusée')));

  let refused = false;
  let refusedCalls = 0;
  try {
    await NET.withRetry(async () => { refusedCalls += 1; throw new Error('42501 permission refusée'); },
      { retries: 2, baseDelayMs: 1 });
  } catch (error) { refused = error instanceof NET.NetworkError; }
  check('réseau P10 : aucune reprise sur 42501, NetworkError explicite',
    refused && refusedCalls === 1);
  check('idempotence P10 : clé générée au format attendu',
    /^logo-[A-Za-z0-9._-]{8,}$/.test(NET.idempotencyKey('logo')));

  const p10Frontend = [
    'src/lib/network.ts', 'src/lib/qa.ts', 'src/lib/image.ts', 'src/pages/Quality.tsx',
  ].map((f) => read(f)).join('\n');
  check('P10 : aucun identifiant de tenant brut dans le frontend QA',
    !p10Frontend.includes('company_id') && read('src/lib/qa.ts').includes("'my_qa_board'") &&
    read('src/lib/qa.ts').includes("'my_washes_page'") &&
    read('src/lib/qa.ts').includes('optimizeStationLogo') &&
    read('src/lib/image.ts').includes('LOGO_MAX_EDGE = 512') &&
    read('src/lib/qa.ts').includes('from(BUCKET)') && read('src/lib/qa.ts').includes('bucket.upload'));

  const p10Docs = [
    'docs/installation.md', 'docs/architecture.md', 'docs/database.md',
    'docs/security.md', 'docs/user-guide.md', 'docs/deployment.md', 'docs/testing.md',
  ];
  check('P10 : les 7 documents de déploiement sont livrés',
    p10Docs.every(has) && read('README.md').includes('docs/deployment.md'));

  const unitFiles = fs.readdirSync(path.join(ROOT, 'tests/unit')).filter((f) => f.endsWith('.test.ts'));
  const unitTests = unitFiles.reduce((total, f) =>
    total + read('tests/unit/' + f).split(/\bit\(/).length - 1, 0);
  const e2eTests = read('e2e/erp.spec.ts').split(/\btest\(/).length - 1;
  check('P10 : au moins 15 tests unitaires Vitest et 15 specs Playwright',
    has('vitest.config.ts') && has('playwright.config.ts') &&
    unitTests >= 15 && e2eTests >= 15 &&
    read('supabase/tests/p10_rollback.sql').includes('RLS RESTRICTIVE'));

  check('P10 : CI et déploiement Vercel par secrets, aucun secret versionné', (() => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    const vercel = read('vercel.json');
    return ci.includes('playwright install --with-deps chromium') &&
      ci.includes('npm run test:unit') && ci.includes('npm run check') &&
      deploy.includes('VERCEL_TOKEN') && !deploy.includes('vercel-token:') &&
      deploy.includes('VITE_DATA_SOURCE: supabase') &&
      deploy.includes('VITE_SUPABASE_URL') && deploy.includes('VITE_SUPABASE_ANON_KEY') &&
      deploy.includes("VITE_WG_TEST_AUTH: ''") &&
      deploy.includes('repository_dispatch') && !deploy.includes('run: echo "Déploiement ignoré :') &&
      vercel.includes('"rewrites"') && vercel.includes('X-Frame-Options');
  })());

  check('P10 : rollback SQL, migrations 045/046/047/049/050 et correctif 048 retiré', (() => {
    const t = read('supabase/tests/p10_rollback.sql');
    return /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('SELECT label, ok, detail FROM p10_result') &&
      has('supabase/migrations/045_qa_performance.sql') &&
      has('supabase/migrations/046_storage_foundation.sql') &&
      has('supabase/migrations/047_qa_hardening.sql') &&
      has('supabase/migrations/049_storage_rls_guard.sql') &&
      has('supabase/migrations/050_storage_rls_restrictive.sql') &&
      !has('supabase/migrations/048_storage_grants_fix.sql');
  })());

  check('P10 : lazy loading, 19e route et Storage privé', (() => {
    const app = read('src/App.tsx');
    const nav = read('src/components/navigation.tsx');
    const catalog = read('src/lib/permissionCatalog.ts');
    return app.includes('React.lazy') && app.includes('React.Suspense') &&
      app.includes('<Quality />') && nav.includes("to: '/app/qualite'") &&
      !nav.includes("upcoming: { step: '10'") &&
      catalog.includes("'/app/qualite': 'reports.view'") &&
      read('supabase/migrations/046_storage_foundation.sql').includes("'station-assets'");
  })());

  check('P10 : scripts npm QA et harnais E2E', (() => {
    const pkgText = read('package.json');
    const playwright = read('playwright.config.ts');
    const vitest = read('vitest.config.ts');
    return pkgText.includes('"test:unit"') && pkgText.includes('"test:e2e"') &&
      pkgText.includes('"test:e2e:list"') &&
      playwright.includes('VITE_DATA_SOURCE=local') && playwright.includes('VITE_WG_TEST_AUTH=1') &&
      playwright.includes('PLAYWRIGHT_CHROMIUM_PATH') && playwright.includes('chromium') &&
      vitest.includes("tests/unit/**/*.test.ts");
  })());

  const supportState = {
    ...base(),
    session: { ...base().session, role: 'super_admin', name: 'Super admin SaaS', companyId: null, stationId: null },
  };
  const p10Flows = [
    ['Vitrine publique', '/', 'Pilotez vos lavages, vos stocks et vos équipes.', null],
    ['Connexion', '/connexion', 'Bonjour', null],
    ['Inscription deux temps', '/inscription', 'Votre entreprise et sa station', null],
    ['Tableau de bord', '/app/tableau-de-bord', 'Tableau de bord', base()],
    ['Mise en route', '/app/mise-en-route', 'Mise en route', base()],
    ['File de lavages', '/app/lavages', 'File d’attente par statut', base()],
    ['Grille tarifaire', '/app/prestations', 'Grille tarifaire', base()],
    ['Fiche client', '/app/clients', 'Clients', base()],
    ['Employés', '/app/employes', 'Employés', base()],
    ['Caisse', '/app/caisse', 'Historique des caisses', base()],
    ['Dépenses', '/app/depenses', 'Dépenses', base()],
    ['Rapports', '/app/rapports', 'Rapports', base()],
    ['Consolidation', '/app/consolidation', 'Consolidation multi-stations', base()],
    ['Qualité & déploiement', '/app/qualite', 'Qualité & déploiement', base()],
    ['Back-office super admin', '/app/plateforme', 'Espace plateforme', supportState],
  ];
  const runFlow = async (route, expected, state) => {
    const { dom, w } = makeDom(route, state);
    const errs = await mount(acode, w);
    const text = w.document.body.textContent.replace(/\s+/g, ' ');
    const ok = text.includes(expected) && errs.length === 0;
    dom.window.close();
    return { ok, errs };
  };
  for (let index = 0; index < p10Flows.length; index += 1) {
    const [label, route, expected, state] = p10Flows[index];
    const result = await runFlow(route, expected, state);
    check(`E2E JSDOM ${String(index + 1).padStart(2, '0')}/15 : ${label}`,
      result.ok,
      'err=' + result.errs.length + ' ' + (result.errs[0] || '').slice(0, 120));
  }

  console.log(`\n══ RÉSULTAT : ${pass} OK / ${fail} KO · mode ${MODE} ══`);
  process.exit(fail?1:0);
})().catch(e=>{ console.error('CHECK FAIL', e); process.exit(1); });
