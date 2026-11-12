-- 052 — Une seule transaction pour la fiche et son paiement initial.
-- À appliquer avant le frontend qui appelle create_wash_atomic. Les anciennes
-- RPC restent disponibles pour les anciens clients ; elles ne deviennent pas
-- atomiques pour autant. Aucun tenant n'est fourni par le navigateur.

-- Une réservation ne devient visible qu'au COMMIT de la fiche ET du paiement.
-- La contrainte unique sérialise également deux appels simultanés de même clé.
-- Le condensat ne conserve ni plaque ni nom du client dans cette table.
CREATE TABLE public.wash_creation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  wash_id uuid REFERENCES public.washes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);
ALTER TABLE public.wash_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wash_creation_requests FROM PUBLIC, anon, authenticated;

-- La liste des moyens comprend aussi les canaux distincts Wave, Orange Money
-- et MTN MoMo. Ce helper est interne : les commandes appelantes contrôlent
-- leurs permissions et leur station avant de lui passer le tenant vérifié.
CREATE OR REPLACE FUNCTION public.ensure_payment_method(
  p_company uuid, p_station uuid, p_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_label text; v_kind text; v_cash boolean; v_id uuid;
BEGIN
  CASE p_key
    WHEN 'cash' THEN v_label := 'Espèces'; v_kind := 'cash'; v_cash := true;
    WHEN 'mobile_money' THEN v_label := 'Mobile Money'; v_kind := 'mobile_money'; v_cash := false;
    WHEN 'wave' THEN v_label := 'Wave'; v_kind := 'mobile_money'; v_cash := false;
    WHEN 'orange_money' THEN v_label := 'Orange Money'; v_kind := 'mobile_money'; v_cash := false;
    WHEN 'mtn_momo' THEN v_label := 'MTN MoMo'; v_kind := 'mobile_money'; v_cash := false;
    WHEN 'card' THEN v_label := 'Carte'; v_kind := 'card'; v_cash := false;
    WHEN 'transfer' THEN v_label := 'Virement'; v_kind := 'transfer'; v_cash := false;
    ELSE RAISE EXCEPTION 'Moyen de paiement invalide' USING ERRCODE = '23514';
  END CASE;
  INSERT INTO public.payment_methods (company_id, station_id, key, label, kind, affects_cash)
  VALUES (p_company, p_station, p_key, v_label, v_kind, v_cash)
  ON CONFLICT (station_id, key) DO UPDATE SET
    active = true, label = EXCLUDED.label, kind = EXCLUDED.kind, affects_cash = EXCLUDED.affects_cash
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ensure_payment_method(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Les boards de lavage et finance utilisent cette projection : conserver la
-- distinction entre canaux jusqu'au navigateur et au rapprochement affiché.
CREATE OR REPLACE FUNCTION public.payment_method_ui_key(p_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_key
    WHEN 'cash' THEN 'especes'
    WHEN 'mobile_money' THEN 'mobile_money'
    WHEN 'wave' THEN 'wave'
    WHEN 'orange_money' THEN 'orange_money'
    WHEN 'mtn_momo' THEN 'mtn_momo'
    WHEN 'card' THEN 'carte'
    WHEN 'transfer' THEN 'virement'
    ELSE 'mobile_money'
  END
$$;

-- Utilisé pour les paiements initiaux et les encaissements ultérieurs.
CREATE OR REPLACE FUNCTION public.record_wash_payment_by_key(
  p_wash_id uuid, p_amount_minor bigint, p_method_key text,
  p_reference text DEFAULT '', p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_wash record; v_method uuid;
BEGIN
  IF NOT public.has_permission('payments.create') THEN
    RAISE EXCEPTION 'Permission payments.create requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_wash FROM public.washes WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
  END IF;
  v_method := public.ensure_payment_method(v_company, v_wash.station_id, p_method_key);
  RETURN public.record_payment(p_wash_id, p_amount_minor, v_method, p_reference, p_idempotency_key);
END $$;
REVOKE ALL ON FUNCTION public.record_wash_payment_by_key(uuid, bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_wash_payment_by_key(uuid, bigint, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_wash_atomic(p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_user uuid := auth.uid();
  v_station uuid;
  v_key text;
  v_hash text;
  v_employees jsonb;
  v_initial jsonb;
  v_amount bigint;
  v_method text;
  v_request uuid;
  v_existing public.wash_creation_requests%ROWTYPE;
  v_wash uuid;
  v_payment uuid;
  v_payment_key text;
BEGIN
  IF v_user IS NULL OR v_company IS NULL OR NOT public.has_permission('washes.create') THEN
    RAISE EXCEPTION 'Permission washes.create requise' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Fiche invalide' USING ERRCODE = '23514';
  END IF;
  v_station := NULLIF(p_payload->>'station_id', '')::uuid;
  v_key := p_payload->>'idempotency_key';
  IF v_key IS NULL OR v_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
    RAISE EXCEPTION 'Clé d’idempotence invalide' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stations
    WHERE id = v_station AND company_id = v_company AND deleted_at IS NULL)
    OR NOT public.can_access_station(v_station) THEN
    RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
  END IF;
  v_employees := COALESCE(p_payload->'employee_ids', '[]'::jsonb);
  IF jsonb_typeof(v_employees) <> 'array' THEN
    RAISE EXCEPTION 'Affectations invalides' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(v_employees) > 0 AND NOT public.has_permission('washes.assign') THEN
    RAISE EXCEPTION 'Permission washes.assign requise' USING ERRCODE = '42501';
  END IF;
  v_initial := NULLIF(p_payload->'initial_payment', 'null'::jsonb);
  IF v_initial IS NOT NULL THEN
    IF NOT public.has_permission('payments.create') THEN
      RAISE EXCEPTION 'Permission payments.create requise' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(v_initial) <> 'object' THEN
      RAISE EXCEPTION 'Paiement initial invalide' USING ERRCODE = '23514';
    END IF;
    v_amount := (v_initial->>'amount_minor')::bigint;
    v_method := v_initial->>'method_key';
    IF v_amount IS NULL OR v_amount <= 0 OR v_method IS NULL OR v_method NOT IN
      ('cash','mobile_money','wave','orange_money','mtn_momo','card','transfer') THEN
      RAISE EXCEPTION 'Paiement initial invalide' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- jsonb a un ordre de clés canonique : un rejeu identique peut retrouver le
  -- résultat, mais une clé réutilisée avec d'autres données est refusée.
  v_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  INSERT INTO public.wash_creation_requests (company_id, station_id, user_id, idempotency_key, payload_hash)
  VALUES (v_company, v_station, v_user, v_key, v_hash)
  ON CONFLICT (company_id, idempotency_key) DO NOTHING RETURNING id INTO v_request;
  IF v_request IS NULL THEN
    SELECT * INTO v_existing FROM public.wash_creation_requests
    WHERE company_id = v_company AND idempotency_key = v_key;
    IF NOT FOUND OR v_existing.user_id IS DISTINCT FROM v_user
      OR v_existing.station_id IS DISTINCT FROM v_station
      OR v_existing.payload_hash IS DISTINCT FROM v_hash
      OR v_existing.wash_id IS NULL THEN
      RAISE EXCEPTION 'Clé d’idempotence déjà utilisée pour une autre opération' USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.washes
      WHERE id = v_existing.wash_id AND company_id = v_company AND station_id = v_station) THEN
      RAISE EXCEPTION 'Résultat de création introuvable' USING ERRCODE = '23514';
    END IF;
    RETURN v_existing.wash_id;
  END IF;

  -- Une clé déjà utilisée par un ancien client peut correspondre à une fiche
  -- créée avant l'échec de son paiement : ne pas l'adopter ni en créer une
  -- seconde. L'opérateur doit vérifier cette ancienne opération séparément.
  IF EXISTS (SELECT 1 FROM public.washes WHERE company_id = v_company AND idempotency_key = v_key) THEN
    RAISE EXCEPTION 'Clé déjà utilisée par une ancienne fiche : vérifiez cette fiche' USING ERRCODE = '23505';
  END IF;
  -- La réservation ci-dessus porte l'idempotence. Ne pas réutiliser la clé du
  -- client dans l'ancienne RPC : elle pourrait désigner une fiche préexistante
  -- créée par un ancien client, éventuellement dans une autre station.
  v_wash := public.create_wash_full(p_payload || jsonb_build_object('idempotency_key', NULL));
  IF v_initial IS NOT NULL THEN
    v_payment_key := 'atomic-initial:' || v_request::text;
    IF EXISTS (SELECT 1 FROM public.payments WHERE company_id = v_company AND idempotency_key = v_payment_key) THEN
      RAISE EXCEPTION 'Clé de paiement déjà utilisée' USING ERRCODE = '23505';
    END IF;
    v_payment := public.record_wash_payment_by_key(v_wash, v_amount, v_method, '', v_payment_key);
    -- record_payment accepte aussi des clés existantes : ne jamais accepter ici
    -- un paiement pointant vers une autre fiche, station, méthode ou montant.
    IF NOT EXISTS (
      SELECT 1 FROM public.payments p JOIN public.payment_methods pm ON pm.id = p.payment_method_id
      WHERE p.id = v_payment AND p.company_id = v_company AND p.station_id = v_station
        AND p.wash_id = v_wash AND p.amount_minor = v_amount AND pm.key = v_method
    ) THEN
      RAISE EXCEPTION 'Collision de paiement initial' USING ERRCODE = '23505';
    END IF;
  END IF;
  UPDATE public.wash_creation_requests SET wash_id = v_wash WHERE id = v_request;
  RETURN v_wash;
END $$;
REVOKE ALL ON FUNCTION public.create_wash_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wash_atomic(jsonb) TO authenticated;
