/* PostgreSQL NATIF, uniquement sur un cluster temporaire vide et local.
 * WG_ATOMIC_TEST_SOCKET=/tmp/... PGPORT=... npm run test:postgres:concurrency
 * La base éphémère et les rôles simulés sont créés puis supprimés. Ne jamais
 * pointer vers un cluster existant/partagé : les rôles sont propres au cluster.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

async function main() {
  const requested = process.env.WG_ATOMIC_TEST_SOCKET;
  if (!requested) throw new Error('WG_ATOMIC_TEST_SOCKET doit désigner le socket Unix d’un cluster de test temporaire et vide.');
  const socket = fs.realpathSync(requested);
  const relative = path.relative('/tmp', socket);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Le socket du cluster de test doit se trouver sous /tmp ; aucune connexion TCP ou distante.');
  }
  const port = Number(process.env.PGPORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port PostgreSQL invalide.');
  const dbName = `washguard_atomic_test_${crypto.randomBytes(8).toString('hex')}`;
  const options = { host: socket, port, user: 'postgres', ssl: false, connectionTimeoutMillis: 5000 };
  const admin = new Client({ ...options, database: 'postgres' });
  const clients = [];
  let createdDb = false;
  let createdRoles = false;
  await admin.connect();
  try {
    const cluster = await admin.query(`
      SELECT current_database() AS database, inet_server_addr() IS NULL AS local_socket,
        (SELECT count(*)::int FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> 'postgres') AS extra_databases,
        (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS existing_roles,
        (SELECT count(*)::int FROM pg_namespace WHERE nspname IN ('auth','storage','supabase_migrations')) AS existing_schemas,
        (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')) AS public_objects
    `);
    assert.deepEqual(cluster.rows[0], { database: 'postgres', local_socket: true, extra_databases: 0, existing_roles: 0, existing_schemas: 0, public_objects: 0 },
      'Utilisez un cluster PostgreSQL temporaire vierge ; aucun cluster existant ou distant.');
    await admin.query(`CREATE DATABASE "${dbName}"`);
    createdDb = true;
    const makeClient = async () => {
      const client = new Client({ ...options, database: dbName });
      await client.connect();
      clients.push(client);
      return client;
    };
    const setup = await makeClient();
    // La surface Auth/Storage et les rôles sont simulés comme dans PGlite.
    await setup.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA auth;
      CREATE SCHEMA storage;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
      $$;
      CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, "public" boolean, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text NOT NULL, owner uuid, metadata jsonb, UNIQUE(bucket_id,name));
      CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
        SELECT (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1]
      $$;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public, auth, storage, supabase_migrations TO anon, authenticated, service_role;
      GRANT SELECT ON auth.users TO authenticated;
      GRANT SELECT ON supabase_migrations.schema_migrations TO authenticated;
      GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
    `);
    createdRoles = true;
    const migrationsDir = path.resolve('supabase/migrations');
    const files = fs.readdirSync(migrationsDir).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();
    assert.equal(files.at(-1), '057_subscription_entitlements.sql');
    assert.ok(files.includes('053_whatsapp_wash_notifications.sql') && files.includes('054_station_scope_and_metrics.sql'));
    // Garder les contrôles historiques sur le schéma 052 ; les migrations
    // suivantes sont appliquées après leurs contrôles respectifs.
    for (const file of files.filter((name) => name < '053_')) {
      await setup.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await setup.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [file.slice(0, 3)]);
    }
    const results = await setup.query(fs.readFileSync('supabase/tests/atomic_wash_rollback.sql', 'utf8'));
    const sqlChecks = results.find((result) => result.fields?.some((field) => field.name === 'label'))?.rows;
    assert.equal(sqlChecks?.length, 30);
    assert.deepEqual(sqlChecks.filter((row) => !row.ok), []);
    console.log('PostgreSQL natif : 30/30 contrôles SQL en rollback.');

    const owner = '11111111-1111-4111-8111-111111111111';
    const category = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const service = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    await setup.query(`INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES ($1,$2,$3::jsonb)`,
      [owner, 'concurrency@test.invalid', JSON.stringify({ company_name: 'Test atomique', station_name: 'Station test', owner_name: 'Owner' })]);
    const scope = (await setup.query(`SELECT p.company_id, a.station_id FROM public.user_profiles p
      JOIN public.user_station_assignments a ON a.user_id=p.id WHERE p.id=$1`, [owner])).rows[0];
    await setup.query('UPDATE public.stations SET activated=true WHERE id=$1', [scope.station_id]);
    await setup.query('INSERT INTO public.vehicle_categories (id,company_id,station_id,name) VALUES ($1,$2,$3,$4)', [category, scope.company_id, scope.station_id, 'Berline']);
    await setup.query('INSERT INTO public.services (id,company_id,station_id,name) VALUES ($1,$2,$3,$4)', [service, scope.company_id, scope.station_id, 'Lavage']);
    await setup.query('INSERT INTO public.service_prices (company_id,station_id,service_id,vehicle_category_id,price_minor) VALUES ($1,$2,$3,$4,3000)',
      [scope.company_id, scope.station_id, service, category]);
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [owner]);
    await setup.query('SELECT public.open_cash_session($1,10000,$2)', [scope.station_id, 'C-CONCURRENCY']);
    const first = await makeClient();
    const second = await makeClient();
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const makePayload = (key, plate) => ({
      station_id: scope.station_id, category_id: category, plate, customer_id: null, customer_name: '',
      discount_minor: 0, items: [{ serviceId: service, qty: 1 }], employee_ids: [owner], post_id: null,
      idempotency_key: key, initial_payment: { amount_minor: 1000, method_key: 'cash' },
    });
    async function begin(client) {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [owner]);
      await client.query('SET LOCAL ROLE authenticated');
    }
    async function waitForLock() {
      for (let i = 0; i < 100; i += 1) {
        const state = await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [secondPid]);
        if (state.rows[0]?.wait_event_type === 'Lock') return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('La deuxième transaction n’a pas attendu le verrou d’idempotence.');
    }
    async function race(key, changed, rollbackFirst) {
      const original = makePayload(key, `PLATE-${key}`);
      await begin(first);
      await begin(second);
      const a = await first.query('SELECT public.create_wash_atomic($1::jsonb) AS id', [JSON.stringify(original)]);
      const other = changed ? { ...original, plate: 'AUTRE-PLAQUE' } : original;
      // Attacher immédiatement un handler pour éviter une rejection non gérée.
      const bPromise = second.query('SELECT public.create_wash_atomic($1::jsonb) AS id', [JSON.stringify(other)])
        .then((result) => ({ result }), (error) => ({ error }));
      await waitForLock();
      await first.query(rollbackFirst ? 'ROLLBACK' : 'COMMIT');
      const b = await bPromise;
      if (changed) {
        assert.equal(b.error?.code, '23505');
        await second.query('ROLLBACK');
      } else {
        assert.ok(!b.error, b.error?.message);
        if (!rollbackFirst) assert.equal(b.result.rows[0].id, a.rows[0].id);
        else assert.notEqual(b.result.rows[0].id, a.rows[0].id);
        await second.query('COMMIT');
      }
      const counts = (await setup.query(`SELECT count(DISTINCT w.id)::int AS washes,
        count(DISTINCT p.id)::int AS payments, count(DISTINCT m.id)::int AS movements,
        count(DISTINCT r.id)::int AS requests, min(w.paid_minor)::int AS paid
        FROM public.wash_creation_requests r JOIN public.washes w ON w.id=r.wash_id
        LEFT JOIN public.payments p ON p.wash_id=w.id
        LEFT JOIN public.cash_movements m ON m.payment_id=p.id
        WHERE r.company_id=$1 AND r.idempotency_key=$2`, [scope.company_id, key])).rows[0];
      assert.deepEqual(counts, { washes: 1, payments: 1, movements: 1, requests: 1, paid: 1000 });
    }
    await race('ui-concurrent-same', false, false);
    console.log('Concurrence : deux requêtes identiques -> une fiche, un paiement et un mouvement.');
    await race('ui-concurrent-changed', true, false);
    console.log('Concurrence : même clé avec contenu différent -> second appel refusé.');
    await race('ui-concurrent-rollback', false, true);
    console.log('Concurrence : rollback de la première transaction -> seconde transaction unique.');

    await setup.query(fs.readFileSync(path.join(migrationsDir, '053_whatsapp_wash_notifications.sql'), 'utf8'));
    await setup.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('053')`);
    // Les fixtures Auth créent leurs propres tenants ; ne pas hériter du JWT
    // de l'owner utilisé par les courses précédentes.
    await setup.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    const waResults = await setup.query(fs.readFileSync('supabase/tests/whatsapp_wash_rollback.sql', 'utf8'));
    const waChecks = waResults.find((result) => result.fields?.some((field) => field.name === 'label'))?.rows;
    assert.equal(waChecks?.length, 51);
    assert.deepEqual(waChecks.filter((row) => !row.ok), []);
    console.log(`PostgreSQL natif : ${waChecks.length}/${waChecks.length} contrôles WhatsApp SQL en rollback.`);
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [owner]);

    const createCustomer = async (name, phone) => (await setup.query(
      'SELECT public.save_customer_profile($1,$2,$3) AS id', [scope.station_id, name, phone],
    )).rows[0].id;
    const createReadyWash = async (customer, number) => {
      const id = crypto.randomUUID();
      await setup.query(`INSERT INTO public.washes
        (id,company_id,station_id,number,customer_id,customer_name,vehicle_category_id,vehicle_label,total_minor,status,created_by)
        VALUES ($1,$2,$3,$4,$5,'Client', $6,'Berline',1000,'quality_check',$7)`,
      [id, scope.company_id, scope.station_id, number, customer, category, owner]);
      await setup.query(`SELECT public.record_wash_quality_check($1,'approved','')`, [id]);
      return id;
    };
    const c1 = await createCustomer('Client claim test', '+2250700000001');
    await setup.query(`SELECT public.save_customer_whatsapp_consent($1,true,'Accord explicite au comptoir',$2)`, [c1, '+2250700000001']);
    const w1 = await createReadyWash(c1, 'WA-CONCURRENCY-1');
    await first.query('BEGIN'); await first.query('SET LOCAL ROLE service_role');
    const claimA = await first.query('SELECT public.claim_wash_whatsapp($1,$2) AS claim', [scope.company_id, '123456']);
    await second.query('BEGIN'); await second.query('SET LOCAL ROLE service_role');
    await second.query(`SET LOCAL statement_timeout='3s'`);
    const claimB = await second.query('SELECT public.claim_wash_whatsapp($1,$2) AS claim', [scope.company_id, '123456']);
    assert.equal(claimA.rows[0].claim?.washNumber, 'WA-CONCURRENCY-1');
    assert.equal(claimB.rows[0].claim, null, 'Un second worker ne doit pas réclamer la même ligne.');
    await first.query('COMMIT'); await second.query('COMMIT');
    assert.equal((await setup.query('SELECT count(*)::int AS n FROM public.wash_whatsapp_notifications WHERE wash_id=$1 AND status=$2', [w1, 'sending'])).rows[0].n, 1);
    console.log('Concurrence WhatsApp : deux workers -> un seul claim, sans attente ni doublon.');

    const c2 = await createCustomer('Client manuel test', '+2250700000002');
    const w2 = await createReadyWash(c2, 'WA-CONCURRENCY-2'); // blocage initial sans accord
    await setup.query(`SELECT public.save_customer_whatsapp_consent($1,true,'Accord explicite du client',$2)`, [c2, '+2250700000002']);
    await begin(first); await begin(second);
    const manualA = await first.query('SELECT public.enqueue_wash_whatsapp($1,$2) AS id', [w2, 'manual-concurrency-key-one']);
    const manualBPromise = second.query('SELECT public.enqueue_wash_whatsapp($1,$2) AS id', [w2, 'manual-concurrency-key-two'])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock();
    await first.query('COMMIT');
    const manualB = await manualBPromise;
    assert.ok(!manualB.error, manualB.error?.message);
    assert.equal(manualA.rows[0].id, manualB.result.rows[0].id);
    await second.query('COMMIT');
    console.log('Concurrence WhatsApp : deux clics manuels -> une seule demande en attente.');

    await begin(first);
    await first.query(`SELECT public.save_customer_whatsapp_consent($1,false,'Retrait explicite du client',NULL)`, [c2]);
    await second.query('BEGIN'); await second.query('SET LOCAL ROLE service_role');
    await second.query(`SET LOCAL statement_timeout='3s'`);
    const duringRevoke = await second.query('SELECT public.claim_wash_whatsapp($1,$2) AS claim', [scope.company_id, '123456']);
    assert.equal(duringRevoke.rows[0].claim, null, 'Un retrait en cours empêche le claim du client verrouillé.');
    await first.query('COMMIT'); await second.query('COMMIT');
    assert.equal((await setup.query('SELECT status FROM public.wash_whatsapp_notifications WHERE id=$1', [manualA.rows[0].id])).rows[0].status, 'cancelled');
    console.log('Concurrence WhatsApp : retrait en cours bloque le claim et annule la demande.');

    const c3 = await createCustomer('Client restitution test', '+2250700000003');
    await setup.query(`SELECT public.save_customer_whatsapp_consent($1,true,'Accord explicite du client',$2)`, [c3, '+2250700000003']);
    const w3 = await createReadyWash(c3, 'WA-CONCURRENCY-3');
    await begin(first);
    await first.query(`SELECT public.transition_wash_status($1,'delivered','')`, [w3]);
    await second.query('BEGIN'); await second.query('SET LOCAL ROLE service_role');
    await second.query(`SET LOCAL statement_timeout='3s'`);
    const duringDelivery = await second.query('SELECT public.claim_wash_whatsapp($1,$2) AS claim', [scope.company_id, '123456']);
    assert.equal(duringDelivery.rows[0].claim, null, 'Une restitution en cours empêche le claim de la fiche verrouillée.');
    await first.query('COMMIT'); await second.query('COMMIT');
    assert.equal((await setup.query('SELECT status FROM public.wash_whatsapp_notifications WHERE wash_id=$1', [w3])).rows[0].status, 'cancelled');
    console.log('Concurrence WhatsApp : restitution en cours bloque le claim et annule la demande.');

    const c4 = await createCustomer('Client livraison tardive test', '+2250700000004');
    await setup.query(`SELECT public.save_customer_whatsapp_consent($1,true,'Accord explicite du client',$2)`, [c4, '+2250700000004']);
    const w4 = await createReadyWash(c4, 'WA-CONCURRENCY-4');
    const auto4 = (await setup.query('SELECT public.claim_wash_whatsapp($1,$2) AS claim', [scope.company_id, '123456'])).rows[0].claim.id;
    await setup.query(`SELECT public.finish_wash_whatsapp($1,$2,'failed',NULL,'http_400:meta_132000')`, [scope.company_id, auto4]);
    await begin(first);
    const manual4 = (await first.query('SELECT public.enqueue_wash_whatsapp($1,$2) AS id', [w4, 'manual-late-delivery-key'])).rows[0].id;
    await second.query('BEGIN'); await second.query('SET LOCAL ROLE service_role');
    const webhookPromise = second.query(`SELECT public.apply_wash_whatsapp_status($1,'123456',$2,'wamid.late-race','delivered',1700000006,NULL) AS applied`, [scope.company_id, auto4])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock();
    await first.query('COMMIT');
    const webhook = await webhookPromise;
    assert.ok(!webhook.error, webhook.error?.message);
    assert.equal(webhook.result.rows[0].applied, true);
    await second.query('COMMIT');
    const lateRows = (await setup.query('SELECT id,status,reason_code FROM public.wash_whatsapp_notifications WHERE id=ANY($1::uuid[])', [[auto4, manual4]])).rows;
    assert.equal(lateRows.find((row) => row.id === auto4).status, 'delivered');
    assert.equal(lateRows.find((row) => row.id === manual4).status, 'cancelled');
    assert.equal(lateRows.find((row) => row.id === manual4).reason_code, 'delivery_confirmed_elsewhere');
    console.log('Concurrence WhatsApp : livraison tardive annule une relance manuelle encore en attente.');

    // L'opérateur a confirmé l'ancien numéro ; un autre utilisateur modifie la
    // fiche avant l'enregistrement de l'accord. Aucun consentement ne doit être
    // attribué au nouveau numéro, même si la requête attend le verrou client.
    const c5 = await createCustomer('Client changement de numéro test', '+2250700000005');
    await begin(first);
    await first.query(`SELECT public.save_customer_profile($1,'Client changement de numéro test',$2,'','','none',false,$3)`,
      [scope.station_id, '+2250700999999', c5]);
    await begin(second);
    const consentPromise = second.query(`SELECT public.save_customer_whatsapp_consent($1,true,'Accord pour ancien numéro',$2)`,
      [c5, '+2250700000005']).then((result) => ({ result }), (error) => ({ error }));
    await waitForLock();
    await first.query('COMMIT');
    const consent = await consentPromise;
    assert.equal(consent.error?.code, '23514');
    await second.query('ROLLBACK');
    const customerAfter = (await setup.query(`SELECT phone, whatsapp_consent_granted,
      (SELECT count(*)::int FROM public.whatsapp_consent_events WHERE customer_id=$1) AS events
      FROM public.customers WHERE id=$1`, [c5])).rows[0];
    assert.deepEqual(customerAfter, { phone: '+2250700999999', whatsapp_consent_granted: false, events: 0 });
    console.log('Concurrence WhatsApp : numéro modifié avant accord -> refus, aucune preuve créée.');

    for (const file of files.filter((name) => name >= '054_' && name < '057_')) {
      await setup.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await setup.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [file.slice(0, 3)]);
    }
    await setup.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    const scopeResults = await setup.query(fs.readFileSync('supabase/tests/station_scope_rollback.sql', 'utf8'));
    const scopeChecks = scopeResults.find((result) => result.fields?.some((field) => field.name === 'label'))?.rows;
    assert.ok(scopeChecks?.length >= 40, 'Les assertions station et finance sont présentes.');
    assert.deepEqual(scopeChecks.filter((row) => !row.ok), []);
    console.log(`PostgreSQL natif : ${scopeChecks.length}/${scopeChecks.length} contrôles stations et finance en rollback.`);
    const setupResults = await setup.query(fs.readFileSync('supabase/tests/station_setup_rollback.sql', 'utf8'));
    const setupChecks = setupResults.find((result) => result.fields?.some((field) => field.name === 'label'))?.rows;
    assert.ok(setupChecks?.length >= 40, 'Les assertions de configuration sont présentes.');
    assert.deepEqual(setupChecks.filter((row) => !row.ok), []);
    console.log(`PostgreSQL natif : ${setupChecks.length}/${setupChecks.length} contrôles configuration en rollback.`);
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [owner]);

    const financeWash = crypto.randomUUID();
    await setup.query(`INSERT INTO public.washes
      (id,company_id,station_id,number,vehicle_category_id,total_minor,status,created_by)
      VALUES ($1,$2,$3,'FINANCE-CONCURRENT',$4,1000,'pending',$5)`,
    [financeWash, scope.company_id, scope.station_id, category, owner]);
    await begin(first); await begin(second);
    const payA = await first.query(`SELECT public.record_wash_payment_by_key($1,600,'cash','','finance-race-pay') AS id`, [financeWash]);
    const payBPromise = second.query(`SELECT public.record_wash_payment_by_key($1,600,'cash','','finance-race-pay') AS id`, [financeWash])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const payB = await payBPromise;
    assert.ok(!payB.error, payB.error?.message);
    assert.equal(payA.rows[0].id, payB.result.rows[0].id);
    await second.query('COMMIT');
    const paid = (await setup.query(`SELECT paid_minor::int AS paid,
      (SELECT count(*)::int FROM public.payments WHERE idempotency_key='finance-race-pay') AS payments,
      (SELECT count(*)::int FROM public.cash_movements WHERE payment_id=$2) AS movements
      FROM public.washes WHERE id=$1`, [financeWash, payA.rows[0].id])).rows[0];
    assert.deepEqual(paid, { paid: 600, payments: 1, movements: 1 });
    console.log('Concurrence finance : même clé -> un paiement et un mouvement.');

    await begin(first); await begin(second);
    await first.query(`SELECT public.record_wash_payment_by_key($1,300,'cash','','finance-race-rest-1')`, [financeWash]);
    const surplusPromise = second.query(`SELECT public.record_wash_payment_by_key($1,300,'cash','','finance-race-rest-2')`, [financeWash])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const surplus = await surplusPromise;
    assert.equal(surplus.error?.code, '23514'); await second.query('ROLLBACK');
    assert.equal((await setup.query('SELECT paid_minor::int AS paid FROM public.washes WHERE id=$1', [financeWash])).rows[0].paid, 900);
    console.log('Concurrence finance : deux paiements différents ne dépassent pas le solde.');

    await begin(first); await begin(second);
    const expenseA = await first.query(`SELECT public.record_expense_by_key($1,100,'Eau','Réparation','',current_date,'cash','finance-race-expense') AS id`, [scope.station_id]);
    const expenseBPromise = second.query(`SELECT public.record_expense_by_key($1,100,'Eau','Réparation','',current_date,'cash','finance-race-expense') AS id`, [scope.station_id])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const expenseB = await expenseBPromise;
    assert.ok(!expenseB.error, expenseB.error?.message);
    assert.equal(expenseA.rows[0].id, expenseB.result.rows[0].id);
    await second.query('COMMIT');
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.expenses WHERE idempotency_key='finance-race-expense'`)).rows[0].n, 1);
    console.log('Concurrence finance : même clé de dépense -> une seule écriture.');

    // 056 : le catalogue, les paiements directs et ceux par clé prennent le
    // même verrou de station AVANT lavage/caisse. Tout reste dans ce cluster.
    const raceWash = crypto.randomUUID();
    await setup.query(`INSERT INTO public.washes
      (id,company_id,station_id,number,vehicle_category_id,total_minor,status,created_by)
      VALUES ($1,$2,$3,'SETUP-LOCK-RACE',$4,3000,'pending',$5)`,
    [raceWash, scope.company_id, scope.station_id, category, owner]);
    const setMethods = (client, methods) => client.query(
      'SELECT public.save_station_setup($1,$2::jsonb)', [scope.station_id, JSON.stringify({ paymentMethods: methods })]);
    await setMethods(setup, ['especes', 'wave']);
    const cashMethod = (await setup.query(`SELECT id FROM public.payment_methods WHERE station_id=$1 AND key='cash'`, [scope.station_id])).rows[0].id;

    // Ancien scénario d'interblocage : A tient station ; B appelait l'ancienne
    // RPC, tenait lavage puis attendait station ; A attendait alors lavage.
    await begin(first); await first.query(`SET LOCAL statement_timeout='5s'`);
    await setMethods(first, ['especes', 'wave']);
    await begin(second); await second.query(`SET LOCAL statement_timeout='5s'`);
    const directPending = second.query(`SELECT public.record_payment($1,200,$2,'','setup-direct-race') AS id`, [raceWash, cashMethod])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock();
    const byKey = await first.query(`SELECT public.record_wash_payment_by_key($1,200,'cash','','setup-bykey-race') AS id`, [raceWash]);
    await first.query('COMMIT');
    const direct = await directPending;
    assert.ok(!direct.error, direct.error?.message); await second.query('COMMIT');
    assert.notEqual(direct.result.rows[0].id, byKey.rows[0].id);
    assert.equal((await setup.query('SELECT paid_minor::int AS paid FROM public.washes WHERE id=$1', [raceWash])).rows[0].paid, 400);
    console.log('Concurrence 056 : RPC directe et RPC par clé sans inversion lavage/station.');

    // La désélection gagne le verrou : un nouveau paiement direct attend puis
    // échoue ; un ancien paiement idempotent demeure relisible.
    await begin(first); await setMethods(first, ['wave']);
    await begin(second); await second.query(`SET LOCAL statement_timeout='5s'`);
    const disabledDirectPending = second.query(`SELECT public.record_payment($1,200,$2,'','setup-disabled-direct')`, [raceWash, cashMethod])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const disabledDirect = await disabledDirectPending;
    assert.equal(disabledDirect.error?.code, '23514'); await second.query('ROLLBACK');
    assert.equal((await setup.query(`SELECT public.record_payment($1,200,$2,'','setup-direct-race') AS id`, [raceWash, cashMethod])).rows[0].id, direct.result.rows[0].id);
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.payments WHERE idempotency_key='setup-disabled-direct'`)).rows[0].n, 0);
    console.log('Concurrence 056 : retrait avant paiement direct -> refus, rejeu historique préservé.');

    // Même garantie pour une dépense : son éventuelle catégorie temporaire est
    // annulée avec la commande si le canal disparaît pendant l'attente.
    await begin(first); await setMethods(first, ['especes']);
    await begin(second); await second.query(`SET LOCAL statement_timeout='5s'`);
    const expenseDisabledPending = second.query(`SELECT public.record_expense_by_key($1,100,'Catégorie course','Achat test','',current_date,'wave','setup-expense-disabled')`, [scope.station_id])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const expenseDisabled = await expenseDisabledPending;
    assert.equal(expenseDisabled.error?.code, '23514'); await second.query('ROLLBACK');
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.expense_categories WHERE station_id=$1 AND name='Catégorie course'`, [scope.station_id])).rows[0].n, 0);
    console.log('Concurrence 056 : retrait avant dépense -> refus et aucune catégorie orpheline.');

    await setMethods(setup, ['especes', 'wave']);
    const deniedPayload = { ...makePayload('setup-initial-disabled-race', '1801 AB 01'), initial_payment: { amount_minor: 1000, method_key: 'wave' } };
    await begin(first); await setMethods(first, ['especes']);
    await begin(second); await second.query(`SET LOCAL statement_timeout='5s'`);
    const initialDisabledPending = second.query('SELECT public.create_wash_atomic($1::jsonb) AS id', [JSON.stringify(deniedPayload)])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const initialDisabled = await initialDisabledPending;
    assert.equal(initialDisabled.error?.code, '23514'); await second.query('ROLLBACK');
    const noRequest = (await setup.query(`SELECT
      (SELECT count(*)::int FROM public.wash_creation_requests WHERE idempotency_key=$1) AS requests,
      (SELECT count(*)::int FROM public.washes WHERE plate=$2) AS washes`, [deniedPayload.idempotency_key, deniedPayload.plate])).rows[0];
    assert.deepEqual(noRequest, { requests: 0, washes: 0 });
    console.log('Concurrence 056 : retrait avant paiement initial -> rollback complet.');

    // Le total et les lignes d'une fiche sont basés sur la même version du
    // prix, et une modification ultérieure ne change pas l'historique.
    await setMethods(setup, ['especes', 'wave']);
    await begin(first); await first.query('SELECT public.save_station_price($1,$2,$3,4500)', [scope.station_id, service, category]);
    const pricePayload = { ...makePayload('setup-price-after-race', '1802 AB 01'), initial_payment: null };
    await begin(second); await second.query(`SET LOCAL statement_timeout='5s'`);
    const priceCreationPending = second.query('SELECT public.create_wash_atomic($1::jsonb) AS id', [JSON.stringify(pricePayload)])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const priceCreation = await priceCreationPending;
    assert.ok(!priceCreation.error, priceCreation.error?.message); await second.query('COMMIT');
    const firstPrice = (await setup.query(`SELECT w.total_minor::int AS total, i.unit_price_minor::int AS unit
      FROM public.washes w JOIN public.wash_items i ON i.wash_id=w.id WHERE w.id=$1`, [priceCreation.result.rows[0].id])).rows[0];
    assert.deepEqual(firstPrice, { total: 4500, unit: 4500 });

    await begin(first);
    const oldPricePayload = { ...makePayload('setup-price-before-race', '1803 AB 01'), initial_payment: null };
    const oldPriceWash = (await first.query('SELECT public.create_wash_atomic($1::jsonb) AS id', [JSON.stringify(oldPricePayload)])).rows[0].id;
    await begin(second); await second.query(`SET LOCAL statement_timeout='5s'`);
    const laterPricePending = second.query('SELECT public.save_station_price($1,$2,$3,5500)', [scope.station_id, service, category])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const laterPrice = await laterPricePending;
    assert.ok(!laterPrice.error, laterPrice.error?.message); await second.query('COMMIT');
    const frozenPrice = (await setup.query(`SELECT w.total_minor::int AS total, i.unit_price_minor::int AS unit
      FROM public.washes w JOIN public.wash_items i ON i.wash_id=w.id WHERE w.id=$1`, [oldPriceWash])).rows[0];
    assert.deepEqual(frozenPrice, { total: 4500, unit: 4500 });
    console.log('Concurrence 056 : modification tarif/fiche sérialisée dans les deux sens.');

    // 057 est appliquée seulement après les recettes historiques : chacune
    // vérifie ainsi le schéma qu'elle cible, dans la même base éphémère.
    await setup.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    await setup.query(fs.readFileSync(path.join(migrationsDir, '057_subscription_entitlements.sql'), 'utf8'));
    await setup.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('057')`);
    for (const [file, minimum] of [['subscription_entitlements_rollback.sql', 20], ['subscription_guards_rollback.sql', 25], ['whatsapp_expired_rollback.sql', 50], ['identity_subscription_rollback.sql', 14], ['invitation_revocation_rollback.sql', 15]]) {
      const result = await setup.query(fs.readFileSync(path.join('supabase/tests', file), 'utf8'));
      const checks = result.find((item) => item.fields?.some((field) => field.name === 'label'))?.rows;
      assert.ok(checks?.length >= minimum, `${file}: contrôles absents`);
      assert.deepEqual(checks.filter((row) => !row.ok), [], `${file}: assertions échouées`);
      console.log(`PostgreSQL natif : ${checks.length}/${checks.length} contrôles ${file} en rollback.`);
    }

    // Retrait expiré, réactivation et claim utilisent de vraies transactions
    // séparées. Les rôles Auth/Storage et Meta restent simulés localement.
    const waRaceOwner = crypto.randomUUID();
    const waRaceAdmin = crypto.randomUUID();
    await setup.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ($1,'wa-race-owner@test.invalid',$2::jsonb),($3,'wa-race-admin@test.invalid','{"invitation":true}'::jsonb)`,
    [waRaceOwner, JSON.stringify({ company_name: 'Retraits WhatsApp', station_name: 'Station retraits', owner_name: 'Owner retraits' }), waRaceAdmin]);
    await setup.query('INSERT INTO public.platform_admins(user_id) VALUES ($1)', [waRaceAdmin]);
    const waRaceScope = (await setup.query(`SELECT p.company_id,a.station_id FROM public.user_profiles p
      JOIN public.user_station_assignments a ON a.user_id=p.id WHERE p.id=$1`, [waRaceOwner])).rows[0];
    const waRaceOperator = crypto.randomUUID();
    await setup.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'wa-race-cashier@test.invalid','{"invitation":true}'::jsonb)`, [waRaceOperator]);
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [waRaceOwner]);
    await setup.query(`INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id,active)
      SELECT $1,$2,'Caissier courses','wa-race-cashier@test.invalid',id,true FROM public.roles WHERE company_id IS NULL AND key='cashier'`,
    [waRaceOperator, waRaceScope.company_id]);
    await setup.query(`INSERT INTO public.user_station_assignments(company_id,user_id,station_id) VALUES($1,$2,$3)`,
      [waRaceScope.company_id, waRaceOperator, waRaceScope.station_id]);
    await setup.query('UPDATE public.stations SET activated=true WHERE id=$1', [waRaceScope.station_id]);
    const waRaceCategory = (await setup.query(`SELECT public.save_station_category($1,NULL,'Catégorie retraits',true) AS id`,
      [waRaceScope.station_id])).rows[0].id;
    const prepareWaRace = async (suffix, phone) => {
      await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [waRaceOwner]);
      const customer = (await setup.query(`SELECT public.save_customer_profile($1,$2,$3) AS id`,
        [waRaceScope.station_id, `Client retrait ${suffix}`, phone])).rows[0].id;
      await setup.query(`SELECT public.save_customer_whatsapp_consent($1,true,'Accord explicite au comptoir',$2)`, [customer, phone]);
      const wash = crypto.randomUUID();
      await setup.query(`INSERT INTO public.washes(id,company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
        VALUES($1,$2,$3,$4,$5,$6,1000,'quality_check',$7)`,
      [wash, waRaceScope.company_id, waRaceScope.station_id, `WA-EXP-RACE-${suffix}`, customer, waRaceCategory, waRaceOwner]);
      await setup.query(`SELECT public.record_wash_quality_check($1,'approved','')`, [wash]);
      const notification = (await setup.query(`SELECT id FROM public.wash_whatsapp_notifications WHERE wash_id=$1`, [wash])).rows[0].id;
      return { customer, wash, notification };
    };
    const beginWa = async (client, actor) => {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [actor]);
      await client.query('SET LOCAL ROLE authenticated');
      await client.query(`SET LOCAL statement_timeout='8s'`);
    };
    const beginWaService = async (client) => {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('request.jwt.claim.sub','',true)`);
      await client.query('SET LOCAL ROLE service_role');
      await client.query(`SET LOCAL statement_timeout='8s'`);
    };
    const waive = (client, customer, proof) => client.query(
      `SELECT public.save_customer_whatsapp_consent($1,false,$2,NULL) AS id`, [customer, proof]);
    const waStatus = async (fixture) => (await setup.query(`SELECT c.whatsapp_consent_granted AS granted,n.status,n.reason_code AS reason
      FROM public.customers c JOIN public.wash_whatsapp_notifications n ON n.customer_id=c.id
      WHERE c.id=$1 AND n.id=$2`, [fixture.customer, fixture.notification])).rows[0];

    // Le retrait prend le client puis le verrou partagé de l'abonnement ; un
    // claim saute le client verrouillé et la réactivation doit attendre.
    const waFirst = await prepareWaRace('withdrawal-first', '+2250700100001');
    await setup.query(`UPDATE public.subscriptions SET trial_ends_at=clock_timestamp()-interval '1 second' WHERE company_id=$1`, [waRaceScope.company_id]);
    const waRenewal1 = (await setup.query(`SELECT public.request_subscription_plan('standard') AS id`)).rows[0].id;
    await beginWa(first, waRaceOwner);
    await waive(first, waFirst.customer, 'Retrait avant réactivation');
    await beginWaService(second);
    const claimDuringWithdraw = (await second.query(`SELECT public.claim_wash_whatsapp($1,'123456') AS claim`, [waRaceScope.company_id])).rows[0].claim;
    assert.equal(claimDuringWithdraw, null, 'Un client dont le retrait est en cours ne doit pas être réclamé.');
    await second.query('COMMIT');
    await beginWa(second, waRaceAdmin);
    const renewalAfterWithdrawPending = second.query('SELECT public.admin_decide_subscription_request($1,true)', [waRenewal1])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const renewalAfterWithdraw = await renewalAfterWithdrawPending;
    assert.ok(!renewalAfterWithdraw.error, renewalAfterWithdraw.error?.message); await second.query('COMMIT');
    assert.deepEqual(await waStatus(waFirst), { granted: false, status: 'cancelled', reason: 'consent_revoked' });
    await beginWaService(first);
    assert.equal((await first.query(`SELECT public.claim_wash_whatsapp($1,'123456') AS claim`, [waRaceScope.company_id])).rows[0].claim, null);
    await first.query('COMMIT');
    console.log('Concurrence 057 WhatsApp : retrait expiré d’abord -> claim évité, réactivation attendue, aucune ancienne demande réexpédiée.');

    // La réactivation gagne le verrou d'abonnement : le retrait attend, relit
    // la période active puis annule toujours la demande avant tout futur claim.
    const waSecond = await prepareWaRace('reactivation-first', '+2250700100002');
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE company_id=$1`, [waRaceScope.company_id]);
    const waRenewal2 = (await setup.query(`SELECT public.request_subscription_plan('standard') AS id`)).rows[0].id;
    await beginWa(first, waRaceAdmin);
    await first.query('SELECT public.admin_decide_subscription_request($1,true)', [waRenewal2]);
    await beginWa(second, waRaceOwner);
    const withdrawAfterRenewalPending = waive(second, waSecond.customer, 'Retrait pendant réactivation')
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const withdrawAfterRenewal = await withdrawAfterRenewalPending;
    assert.ok(!withdrawAfterRenewal.error, withdrawAfterRenewal.error?.message);
    // Même après validation de la formule, tant que le retrait n'est pas
    // commité le worker ne peut pas récupérer l'ancien consentement visible.
    await beginWaService(setup);
    assert.equal((await setup.query(`SELECT public.claim_wash_whatsapp($1,'123456') AS claim`, [waRaceScope.company_id])).rows[0].claim, null);
    await setup.query('COMMIT');
    await second.query('COMMIT');
    assert.deepEqual(await waStatus(waSecond), { granted: false, status: 'cancelled', reason: 'consent_revoked' });
    await beginWaService(first);
    assert.equal((await first.query(`SELECT public.claim_wash_whatsapp($1,'123456') AS claim`, [waRaceScope.company_id])).rows[0].claim, null);
    await first.query('COMMIT');
    console.log('Concurrence 057 WhatsApp : réactivation d’abord -> retrait sérialisé, backlog annulé.');

    // Si le rôle ou l'affectation sont retirés avant la prise du verrou, la
    // demande attend et doit être refusée après commit, sans preuve partielle.
    const beginWaAdminDirect = async (client) => {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [waRaceAdmin]);
      await client.query(`SET LOCAL statement_timeout='8s'`);
    };
    const waPermission = await prepareWaRace('permission-first', '+2250700100011');
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE company_id=$1`, [waRaceScope.company_id]);
    await beginWaAdminDirect(first);
    await first.query(`UPDATE public.user_profiles SET role_id=(SELECT id FROM public.roles WHERE company_id IS NULL AND key='washer') WHERE id=$1`, [waRaceOperator]);
    await beginWa(second, waRaceOperator);
    const afterPermissionChangePending = waive(second, waPermission.customer, 'Retrait après changement de rôle')
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const afterPermissionChange = await afterPermissionChangePending;
    assert.equal(afterPermissionChange.error?.code, '42501'); await second.query('ROLLBACK');
    assert.deepEqual(await waStatus(waPermission), { granted: true, status: 'pending', reason: null });
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.whatsapp_consent_events WHERE customer_id=$1 AND kind='revoked'`, [waPermission.customer])).rows[0].n, 0);
    await beginWa(first, waRaceOwner); await waive(first, waPermission.customer, 'Retrait par responsable autorisé'); await first.query('COMMIT');
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [waRaceAdmin]);
    await setup.query(`UPDATE public.user_profiles SET role_id=(SELECT id FROM public.roles WHERE company_id IS NULL AND key='cashier') WHERE id=$1`, [waRaceOperator]);
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date+30 WHERE company_id=$1`, [waRaceScope.company_id]);

    const waStation = await prepareWaRace('station-first', '+2250700100012');
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE company_id=$1`, [waRaceScope.company_id]);
    await beginWaAdminDirect(first);
    await first.query(`DELETE FROM public.user_station_assignments WHERE user_id=$1 AND station_id=$2`, [waRaceOperator, waRaceScope.station_id]);
    await beginWa(second, waRaceOperator);
    const afterStationChangePending = waive(second, waStation.customer, 'Retrait après désaffectation')
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const afterStationChange = await afterStationChangePending;
    assert.equal(afterStationChange.error?.code, '42501'); await second.query('ROLLBACK');
    assert.deepEqual(await waStatus(waStation), { granted: true, status: 'pending', reason: null });
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.whatsapp_consent_events WHERE customer_id=$1 AND kind='revoked'`, [waStation.customer])).rows[0].n, 0);
    await beginWa(first, waRaceOwner); await waive(first, waStation.customer, 'Retrait par responsable autorisé'); await first.query('COMMIT');
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [waRaceAdmin]);
    await setup.query(`INSERT INTO public.user_station_assignments(company_id,user_id,station_id) VALUES($1,$2,$3)`,
      [waRaceScope.company_id, waRaceOperator, waRaceScope.station_id]);
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date+30 WHERE company_id=$1`, [waRaceScope.company_id]);

    const waPermissionLast = await prepareWaRace('permission-last', '+2250700100013');
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE company_id=$1`, [waRaceScope.company_id]);
    await beginWa(first, waRaceOperator);
    await waive(first, waPermissionLast.customer, 'Retrait avant désactivation du caissier');
    await beginWaAdminDirect(second);
    const disableAfterWithdrawPending = second.query(`UPDATE public.user_profiles SET active=false WHERE id=$1`, [waRaceOperator])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const disableAfterWithdraw = await disableAfterWithdrawPending;
    assert.ok(!disableAfterWithdraw.error, disableAfterWithdraw.error?.message); await second.query('COMMIT');
    assert.deepEqual(await waStatus(waPermissionLast), { granted: false, status: 'cancelled', reason: 'consent_revoked' });
    assert.equal((await setup.query(`SELECT active FROM public.user_profiles WHERE id=$1`, [waRaceOperator])).rows[0].active, false);
    console.log('Concurrence 057 WhatsApp : rôle, station et désactivation ordonnés avec le retrait.');
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [waRaceAdmin]);
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date+30 WHERE company_id=$1`, [waRaceScope.company_id]);

    // Une décision qui s'annule pendant l'attente ne doit pas empêcher le
    // retrait : la garde revoit l'expiration après libération du verrou.
    const waRollback = await prepareWaRace('reactivation-rollback', '+2250700100003');
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE company_id=$1`, [waRaceScope.company_id]);
    const waRenewal3 = (await setup.query(`SELECT public.request_subscription_plan('standard') AS id`)).rows[0].id;
    await beginWa(first, waRaceAdmin);
    await first.query('SELECT public.admin_decide_subscription_request($1,true)', [waRenewal3]);
    await beginWa(second, waRaceOwner);
    const withdrawAfterRollbackPending = waive(second, waRollback.customer, 'Retrait après décision annulée')
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('ROLLBACK');
    const withdrawAfterRollback = await withdrawAfterRollbackPending;
    assert.ok(!withdrawAfterRollback.error, withdrawAfterRollback.error?.message); await second.query('COMMIT');
    assert.deepEqual(await waStatus(waRollback), { granted: false, status: 'cancelled', reason: 'consent_revoked' });
    assert.equal((await setup.query('SELECT public.subscription_writable($1) AS writable', [waRaceScope.company_id])).rows[0].writable, false);
    console.log('Concurrence 057 WhatsApp : réactivation annulée -> retrait expiré et annulation conservés.');

    // Préparer une quatrième fiche active puis laisser réellement expirer la
    // période pendant qu'un worker conserve le claim. Le retrait attend le
    // verrou client : il ne peut pas rappeler le POST déjà autorisé.
    await setup.query(`UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date+30 WHERE company_id=$1`, [waRaceScope.company_id]);
    const waClaimFirst = await prepareWaRace('claim-first', '+2250700100004');
    await setup.query(`UPDATE public.subscriptions SET plan_id='essai',status='trial',trial_ends_at=clock_timestamp()+interval '5 seconds'
      WHERE company_id=$1`, [waRaceScope.company_id]);
    await beginWaService(first);
    const claimed = (await first.query(`SELECT public.claim_wash_whatsapp($1,'123456') AS claim`, [waRaceScope.company_id])).rows[0].claim;
    assert.equal(claimed?.id, waClaimFirst.notification);
    const waRemaining = (await setup.query(`SELECT EXTRACT(epoch FROM trial_ends_at-clock_timestamp())::float AS seconds
      FROM public.subscriptions WHERE company_id=$1`, [waRaceScope.company_id])).rows[0].seconds;
    assert.ok(waRemaining > 0, 'Le claim doit précéder l’expiration réelle.');
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(waRemaining * 1000) + 150));
    await beginWa(second, waRaceOwner);
    const withdrawAfterClaimPending = waive(second, waClaimFirst.customer, 'Retrait après claim déjà engagé')
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const withdrawAfterClaim = await withdrawAfterClaimPending;
    assert.ok(!withdrawAfterClaim.error, withdrawAfterClaim.error?.message); await second.query('COMMIT');
    assert.deepEqual(await waStatus(waClaimFirst), { granted: false, status: 'sending', reason: null });
    await beginWaService(first);
    await first.query(`SELECT public.finish_wash_whatsapp($1,$2,'accepted','wamid.wa-race',NULL)`,
      [waRaceScope.company_id, waClaimFirst.notification]);
    assert.equal((await first.query(`SELECT public.apply_wash_whatsapp_status($1,'123456',$2,'wamid.wa-race','delivered',1700000000,NULL) AS applied`,
      [waRaceScope.company_id, waClaimFirst.notification])).rows[0].applied, true);
    await first.query('COMMIT');
    assert.deepEqual(await waStatus(waClaimFirst), { granted: false, status: 'delivered', reason: null });
    assert.equal((await setup.query(`SELECT e.created_at >= n.claimed_at AS ordered FROM public.whatsapp_consent_events e
      JOIN public.wash_whatsapp_notifications n ON n.customer_id=e.customer_id
      WHERE e.id=$1 AND n.id=$2`, [withdrawAfterClaim.result.rows[0].id, waClaimFirst.notification])).rows[0].ordered, true);
    console.log('Concurrence 057 WhatsApp : claim avant expiration puis retrait -> transmission non rappelée, callback tardif conservé.');
    await setup.query(`SELECT set_config('request.jwt.claim.sub','',false)`);

    // Un tenant distinct permet de régler de petits quotas sans dépendre des
    // fiches créées par les scénarios historiques ci-dessus.
    const qOwner = crypto.randomUUID();
    const qAdmin = crypto.randomUUID();
    const qStaff = crypto.randomUUID();
    await setup.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ($1,'quota-owner@test.invalid',$2::jsonb),($3,'quota-admin@test.invalid','{"invitation":true}'::jsonb)`,
    [qOwner, JSON.stringify({ company_name: 'Quota entreprise', station_name: 'Quota station', owner_name: 'Owner quota' }), qAdmin]);
    await setup.query('INSERT INTO public.platform_admins(user_id) VALUES ($1)', [qAdmin]);
    const quotaScope = (await setup.query(`SELECT p.company_id, a.station_id FROM public.user_profiles p
      JOIN public.user_station_assignments a ON a.user_id=p.id WHERE p.id=$1`, [qOwner])).rows[0];
    const qCategory = crypto.randomUUID();
    const qService = crypto.randomUUID();
    await setup.query('UPDATE public.stations SET activated=true WHERE id=$1', [quotaScope.station_id]);
    await setup.query('INSERT INTO public.vehicle_categories(id,company_id,station_id,name) VALUES($1,$2,$3,$4)',
      [qCategory, quotaScope.company_id, quotaScope.station_id, 'Berline quota']);
    await setup.query('INSERT INTO public.services(id,company_id,station_id,name) VALUES($1,$2,$3,$4)',
      [qService, quotaScope.company_id, quotaScope.station_id, 'Lavage quota']);
    await setup.query('INSERT INTO public.service_prices(company_id,station_id,service_id,vehicle_category_id,price_minor) VALUES($1,$2,$3,$4,2000)',
      [quotaScope.company_id, quotaScope.station_id, qService, qCategory]);
    await setup.query(`UPDATE public.plan_limits SET value_int=CASE key WHEN 'stations' THEN 2 WHEN 'employees' THEN 2 ELSE 1 END
      WHERE plan_id='essai' AND key IN ('stations','employees','washes_per_month')`);
    const beginAs = async (client, actor) => {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [actor]);
      await client.query('SET LOCAL ROLE authenticated');
      await client.query(`SET LOCAL statement_timeout='8s'`);
    };
    const reserve = (client, email) => client.query('SELECT public.reserve_user_invitation($1,$2,$3,$4,$5::uuid[]) AS id',
      [email, 'Invité test', '', 'cashier', [quotaScope.station_id]]);

    await beginAs(first, qOwner); await beginAs(second, qOwner);
    const firstReservation = (await reserve(first, 'quota-one@test.invalid')).rows[0].id;
    const secondReservationPending = reserve(second, 'quota-two@test.invalid')
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const secondReservation = await secondReservationPending;
    assert.equal(secondReservation.error?.code, '23514'); await second.query('ROLLBACK');
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.invitation_reservations
      WHERE company_id=$1 AND status='reserved'`, [quotaScope.company_id])).rows[0].n, 1);
    console.log('Concurrence 057 : deux invitations pour une place -> une réservation, aucun dépassement.');

    await setup.query('BEGIN'); await setup.query('SET LOCAL ROLE service_role');
    await setup.query('SELECT public.release_user_invitation($1)', [firstReservation]); await setup.query('COMMIT');
    await setup.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'quota-staff@test.invalid','{"invitation":true}'::jsonb)`, [qStaff]);
    await setup.query(`INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id,active)
      SELECT $1,$2,'Employé inactif','quota-staff@test.invalid',id,false FROM public.roles WHERE key='cashier' AND company_id IS NULL`,
    [qStaff, quotaScope.company_id]);
    await beginAs(first, qOwner); await beginAs(second, qOwner);
    await first.query('SELECT public.admin_update_user($1,NULL,true,NULL)', [qStaff]);
    const reactivatePending = reserve(second, 'quota-three@test.invalid')
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const reactivateRace = await reactivatePending;
    assert.equal(reactivateRace.error?.code, '23514'); await second.query('ROLLBACK');
    assert.equal((await setup.query('SELECT active FROM public.user_profiles WHERE id=$1', [qStaff])).rows[0].active, true);
    console.log('Concurrence 057 : réactivation et invitation partagent le quota comptes.');

    await setup.query('GRANT SELECT,INSERT,UPDATE ON public.stations TO service_role');
    await first.query('BEGIN'); await first.query('SET LOCAL ROLE service_role');
    await second.query('BEGIN'); await second.query('SET LOCAL ROLE service_role');
    await second.query(`SET LOCAL statement_timeout='8s'`);
    await first.query('INSERT INTO public.stations(company_id,name) VALUES($1,$2)', [quotaScope.company_id, 'Deuxième station']);
    const stationPending = second.query('INSERT INTO public.stations(company_id,name) VALUES($1,$2)', [quotaScope.company_id, 'Station en trop'])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const stationRace = await stationPending;
    assert.equal(stationRace.error?.code, '23514'); await second.query('ROLLBACK');
    assert.equal((await setup.query('SELECT count(*)::int AS n FROM public.stations WHERE company_id=$1 AND deleted_at IS NULL', [quotaScope.company_id])).rows[0].n, 2);
    console.log('Concurrence 057 : deux créations de station pour une place -> une seule.');

    const quotaPayload = (key, plate) => ({
      station_id: quotaScope.station_id, category_id: qCategory, plate, customer_id: null, customer_name: '',
      discount_minor: 0, items: [{ serviceId: qService, qty: 1 }], employee_ids: [qOwner], post_id: null,
      idempotency_key: key, initial_payment: null,
    });
    await beginAs(first, qOwner); await beginAs(second, qOwner);
    await first.query('SELECT public.create_wash_atomic($1::jsonb)', [JSON.stringify(quotaPayload('quota-wash-first', 'QUOTA-A'))]);
    const washPending = second.query('SELECT public.create_wash_atomic($1::jsonb)', [JSON.stringify(quotaPayload('quota-wash-second', 'QUOTA-B'))])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const washRace = await washPending;
    assert.equal(washRace.error?.code, '23514'); await second.query('ROLLBACK');
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.washes
      WHERE company_id=$1 AND status<>'cancelled' AND deleted_at IS NULL`, [quotaScope.company_id])).rows[0].n, 1);
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.wash_creation_requests
      WHERE company_id=$1 AND idempotency_key='quota-wash-second'`, [quotaScope.company_id])).rows[0].n, 0);
    console.log('Concurrence 057 : quota mensuel atomique, tentative excédentaire entièrement annulée.');

    // La décision gagne d'abord : une commande stock lancée sur l'ancienne
    // formule doit relire le droit après attente et refuser l'insertion.
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [qOwner]);
    const downgrade = (await setup.query(`SELECT public.request_subscription_plan('standard') AS id`)).rows[0].id;
    await beginAs(first, qAdmin);
    await first.query('SELECT public.admin_decide_subscription_request($1,true)', [downgrade]);
    await beginAs(second, qOwner);
    const deniedProductPending = second.query(`SELECT public.save_product($1,'Produit trop tard','after-downgrade','','unité',0,true,NULL)`, [quotaScope.station_id])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const deniedProduct = await deniedProductPending;
    assert.equal(deniedProduct.error?.code, '42501'); await second.query('ROLLBACK');
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.products WHERE company_id=$1 AND sku='after-downgrade'`, [quotaScope.company_id])).rows[0].n, 0);
    console.log('Concurrence 057 : décision Standard puis écriture Premium -> écriture refusée après attente.');

    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [qOwner]);
    const upgrade = (await setup.query(`SELECT public.request_subscription_plan('premium') AS id`)).rows[0].id;
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [qAdmin]);
    await setup.query('SELECT public.admin_decide_subscription_request($1,true)', [upgrade]);
    await setup.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [qOwner]);
    const secondDowngrade = (await setup.query(`SELECT public.request_subscription_plan('standard') AS id`)).rows[0].id;
    await beginAs(first, qOwner);
    const heldProduct = (await first.query(`SELECT public.save_product($1,'Produit conservé','before-downgrade','','unité',0,true,NULL) AS id`, [quotaScope.station_id])).rows[0].id;
    await beginAs(second, qAdmin);
    const decisionPending = second.query('SELECT public.admin_decide_subscription_request($1,true)', [secondDowngrade])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const decisionRace = await decisionPending;
    assert.ok(!decisionRace.error, decisionRace.error?.message); await second.query('COMMIT');
    assert.equal((await setup.query('SELECT count(*)::int AS n FROM public.products WHERE id=$1', [heldProduct])).rows[0].n, 1);
    await beginAs(first, qOwner);
    assert.equal((await first.query('SELECT count(*)::int AS n FROM public.products WHERE id=$1', [heldProduct])).rows[0].n, 0);
    await first.query('COMMIT');
    console.log('Concurrence 057 : écriture Premium engagée avant décision -> conservée puis masquée en Standard.');

    // Acceptation et révocation portent sur la même ligne : tester les deux
    // ordres avec de vraies transactions, pas seulement des appels séquentiels.
    await setup.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    const revOwner = crypto.randomUUID();
    await setup.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'race-revoke-owner@test.invalid',$2::jsonb)`,
      [revOwner, JSON.stringify({ company_name: 'Révocation courses', station_name: 'Station courses', owner_name: 'Owner courses' })]);
    const revScope = (await setup.query(`SELECT p.company_id,a.station_id FROM public.user_profiles p
      JOIN public.user_station_assignments a ON a.user_id=p.id WHERE p.id=$1`, [revOwner])).rows[0];
    const prepareRevocation = async (email, hashDigit) => {
      const userId = crypto.randomUUID();
      await beginAs(first, revOwner);
      const reservationId = (await first.query(`SELECT public.reserve_user_invitation($1,'Invité course','','cashier',$2::uuid[]) AS id`,
        [email, [revScope.station_id]])).rows[0].id;
      await first.query('COMMIT');
      await setup.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3::jsonb)`,
        [userId, email, JSON.stringify({ invitation: true, invitation_reservation_id: reservationId })]);
      await setup.query('BEGIN'); await setup.query('SET LOCAL ROLE service_role');
      const invitation = (await setup.query('SELECT public.finalize_user_invitation($1,$2,$3) AS value',
        [reservationId, userId, hashDigit.repeat(64)])).rows[0].value.invitationId;
      await setup.query('COMMIT');
      return { userId, invitation };
    };
    const revokedFirst = await prepareRevocation('race-revoked-first@test.invalid', '7');
    await beginAs(first, revOwner);
    await first.query('SELECT public.revoke_invitation($1)', [revokedFirst.invitation]);
    await beginAs(second, revokedFirst.userId);
    const acceptanceAfterRevokePending = second.query('SELECT public.accept_my_invitations()')
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const acceptanceAfterRevoke = await acceptanceAfterRevokePending;
    assert.ok(!acceptanceAfterRevoke.error, acceptanceAfterRevoke.error?.message); await second.query('COMMIT');
    assert.deepEqual((await setup.query(`SELECT i.revoked_at IS NOT NULL AS revoked,
      i.accepted_at IS NOT NULL AS accepted,p.active FROM public.user_invitations i
      JOIN public.user_profiles p ON p.id=$2 WHERE i.id=$1`, [revokedFirst.invitation, revokedFirst.userId])).rows[0],
    { revoked: true, accepted: false, active: false });

    const acceptedFirst = await prepareRevocation('race-accepted-first@test.invalid', '6');
    await beginAs(first, acceptedFirst.userId);
    await first.query('SELECT public.accept_my_invitations()');
    await beginAs(second, revOwner);
    const revokeAfterAcceptancePending = second.query('SELECT public.revoke_invitation($1)', [acceptedFirst.invitation])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    const revokeAfterAcceptance = await revokeAfterAcceptancePending;
    assert.equal(revokeAfterAcceptance.error?.code, 'P0002'); await second.query('ROLLBACK');
    assert.deepEqual((await setup.query(`SELECT i.revoked_at IS NOT NULL AS revoked,
      i.accepted_at IS NOT NULL AS accepted,p.active FROM public.user_invitations i
      JOIN public.user_profiles p ON p.id=$2 WHERE i.id=$1`, [acceptedFirst.invitation, acceptedFirst.userId])).rows[0],
    { revoked: false, accepted: true, active: true });
    console.log('Concurrence 057 : acceptation et révocation sérialisées dans les deux sens.');

    // L'horloge réelle, et pas la date de début de la requête, tranche lorsque
    // celle-ci attend sur le verrou au moment exact de la fin de l'essai.
    await setup.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    await setup.query(`UPDATE public.subscriptions SET plan_id='essai',status='trial',trial_ends_at=clock_timestamp()+interval '3 seconds'
      WHERE company_id=$1`, [quotaScope.company_id]);
    await first.query('BEGIN');
    await first.query('SELECT id FROM public.subscriptions WHERE company_id=$1 FOR UPDATE', [quotaScope.company_id]);
    await beginAs(second, qOwner);
    const expiredPending = second.query('SELECT public.save_customer_profile($1,$2)', [quotaScope.station_id, 'Client après échéance'])
      .then((result) => ({ result }), (error) => ({ error }));
    await waitForLock();
    const remaining = (await setup.query(`SELECT EXTRACT(epoch FROM trial_ends_at-clock_timestamp())::float AS seconds
      FROM public.subscriptions WHERE company_id=$1`, [quotaScope.company_id])).rows[0].seconds;
    assert.ok(remaining > 0, 'La commande doit être en attente AVANT l’échéance de l’essai.');
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining * 1000) + 150));
    await first.query('COMMIT');
    const expiredRace = await expiredPending;
    assert.equal(expiredRace.error?.code, '42501'); await second.query('ROLLBACK');
    assert.equal((await setup.query(`SELECT count(*)::int AS n FROM public.customers WHERE company_id=$1 AND name='Client après échéance'`, [quotaScope.company_id])).rows[0].n, 0);
    console.log('Concurrence 057 : opération en attente à l’échéance -> refus après expiration réelle.');
  } finally {
    for (const client of clients.reverse()) await client.end().catch(() => {});
    if (createdDb) await admin.query(`DROP DATABASE "${dbName}"`);
    if (createdRoles) await admin.query('DROP ROLE anon, authenticated, service_role');
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
