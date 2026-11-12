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
    assert.equal(files.at(-1), '055_shared_form_validation.sql');
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

    for (const file of files.filter((name) => name >= '054_')) {
      await setup.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await setup.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [file.slice(0, 3)]);
    }
    await setup.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    const scopeResults = await setup.query(fs.readFileSync('supabase/tests/station_scope_rollback.sql', 'utf8'));
    const scopeChecks = scopeResults.find((result) => result.fields?.some((field) => field.name === 'label'))?.rows;
    assert.ok(scopeChecks?.length >= 40, 'Les assertions station et finance sont présentes.');
    assert.deepEqual(scopeChecks.filter((row) => !row.ok), []);
    console.log(`PostgreSQL natif : ${scopeChecks.length}/${scopeChecks.length} contrôles stations et finance en rollback.`);
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
  } finally {
    for (const client of clients.reverse()) await client.end().catch(() => {});
    if (createdDb) await admin.query(`DROP DATABASE "${dbName}"`);
    if (createdRoles) await admin.query('DROP ROLE anon, authenticated, service_role');
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
