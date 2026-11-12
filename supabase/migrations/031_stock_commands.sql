-- 031 — Prompt 07 : catalogue, commandes, réceptions partielles, inventaires,
-- consommations théoriques. Toutes les RPC déduisent le tenant du JWT.

CREATE OR REPLACE FUNCTION public.assert_stock_station(p_station_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  IF p_station_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.stations s
    WHERE s.id = p_station_id AND s.company_id = v_company AND s.deleted_at IS NULL
  ) OR NOT public.can_access_station(p_station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_product_category(
  p_station_id uuid, p_name text, p_active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_name text := btrim(COALESCE(p_name, '')); v_id uuid;
BEGIN
  IF NOT public.has_permission('catalog.manage') THEN
    RAISE EXCEPTION 'Permission catalog.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_stock_station(p_station_id);
  IF length(v_name) < 2 THEN RAISE EXCEPTION 'Categorie invalide' USING ERRCODE = '23514'; END IF;
  SELECT id INTO v_id FROM public.product_categories
  WHERE station_id = p_station_id AND company_id = v_company
    AND lower(name) = lower(v_name) AND deleted_at IS NULL;
  IF FOUND THEN
    UPDATE public.product_categories SET active = p_active, updated_at = clock_timestamp() WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.product_categories (company_id, station_id, name, active)
  VALUES (v_company, p_station_id, v_name, p_active) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_supplier(
  p_station_id uuid, p_name text, p_phone text DEFAULT '', p_email text DEFAULT '',
  p_address text DEFAULT '', p_active boolean DEFAULT true, p_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_name text := btrim(COALESCE(p_name, '')); v_id uuid;
BEGIN
  IF NOT public.has_permission('inventory.receive') THEN
    RAISE EXCEPTION 'Permission inventory.receive requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_stock_station(p_station_id);
  IF length(v_name) < 2 THEN RAISE EXCEPTION 'Fournisseur invalide' USING ERRCODE = '23514'; END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.suppliers SET name = v_name, phone = COALESCE(p_phone, ''),
      email = COALESCE(p_email, ''), address = COALESCE(p_address, ''),
      active = p_active, updated_at = clock_timestamp()
    WHERE id = p_id AND company_id = v_company AND station_id = p_station_id AND deleted_at IS NULL;
    IF FOUND THEN RETURN p_id; END IF;
    RAISE EXCEPTION 'Fournisseur introuvable' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.suppliers (company_id, station_id, name, phone, email, address, active)
  VALUES (v_company, p_station_id, v_name, COALESCE(p_phone, ''), COALESCE(p_email, ''), COALESCE(p_address, ''), p_active)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_product(
  p_station_id uuid, p_name text, p_sku text DEFAULT '', p_category text DEFAULT '',
  p_unit text DEFAULT 'unité', p_reorder_level integer DEFAULT 0,
  p_active boolean DEFAULT true, p_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_category text := btrim(COALESCE(p_category, ''));
  v_category_id uuid; v_id uuid;
BEGIN
  IF NOT public.has_permission('catalog.manage') THEN
    RAISE EXCEPTION 'Permission catalog.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_stock_station(p_station_id);
  IF length(v_name) < 2 OR COALESCE(p_reorder_level, 0) < 0 THEN
    RAISE EXCEPTION 'Produit invalide' USING ERRCODE = '23514';
  END IF;
  IF v_category <> '' THEN
    v_category_id := public.save_product_category(p_station_id, v_category, true);
  END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.products SET name = v_name, sku = COALESCE(p_sku, ''),
      category = v_category, category_id = v_category_id, unit = COALESCE(NULLIF(btrim(p_unit), ''), 'unité'),
      reorder_level = p_reorder_level, active = p_active, updated_at = clock_timestamp()
    WHERE id = p_id AND company_id = v_company AND station_id = p_station_id AND deleted_at IS NULL;
    IF FOUND THEN RETURN p_id; END IF;
    RAISE EXCEPTION 'Produit introuvable' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.products (company_id, station_id, name, sku, category, category_id,
    unit, reorder_level, active)
  VALUES (v_company, p_station_id, v_name, COALESCE(p_sku, ''), v_category, v_category_id,
    COALESCE(NULLIF(btrim(p_unit), ''), 'unité'), p_reorder_level, p_active)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_station_id uuid, p_number text, p_lines jsonb,
  p_supplier_id uuid DEFAULT NULL, p_ordered_at date DEFAULT current_date,
  p_expected_at date DEFAULT NULL, p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_number text := btrim(COALESCE(p_number, ''));
  v_line jsonb; v_order uuid; v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF NOT public.has_permission('inventory.receive') THEN
    RAISE EXCEPTION 'Permission inventory.receive requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_stock_station(p_station_id);
  IF length(v_number) < 2 OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
    OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Commande incomplete' USING ERRCODE = '23514';
  END IF;
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_order FROM public.purchase_orders
    WHERE company_id = v_company AND idempotency_key = v_key;
    IF FOUND THEN RETURN v_order; END IF;
  END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Fournisseur hors perimetre' USING ERRCODE = '42501'; END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) <> 'object'
      OR NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = (v_line->>'product_id')::uuid AND p.company_id = v_company
          AND p.station_id = p_station_id AND p.deleted_at IS NULL
      )
      OR COALESCE((v_line->>'qty_ordered')::integer, 0) <= 0
      OR COALESCE((v_line->>'unit_cost_minor')::bigint, -1) < 0 THEN
      RAISE EXCEPTION 'Ligne de commande invalide' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_lines)) <> (
    SELECT count(DISTINCT value->>'product_id') FROM jsonb_array_elements(p_lines)
  ) THEN RAISE EXCEPTION 'Produit duplique dans la commande' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.purchase_orders (company_id, station_id, supplier_id, number, status,
    ordered_at, expected_at, created_by, idempotency_key, note)
  VALUES (v_company, p_station_id, p_supplier_id, v_number, 'sent',
    COALESCE(p_ordered_at, current_date), p_expected_at, auth.uid(), v_key,
    'Creee sans incrementer le stock') RETURNING id INTO v_order;
  INSERT INTO public.purchase_order_items (company_id, station_id, order_id, product_id,
    qty_ordered, unit_cost_minor)
  SELECT v_company, p_station_id, v_order, (value->>'product_id')::uuid,
    (value->>'qty_ordered')::integer, COALESCE((value->>'unit_cost_minor')::bigint, 0)
  FROM jsonb_array_elements(p_lines);
  RETURN v_order;
END $$;

CREATE OR REPLACE FUNCTION public.receive_purchase_lines(
  p_order_id uuid, p_lines jsonb, p_receipt_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_key text := btrim(COALESCE(p_receipt_key, ''));
  v_order record; v_item record; v_line record; v_raw jsonb; v_event uuid;
  v_product uuid; v_qty integer; v_cost bigint; v_movement_key text;
  v_old_qty integer; v_old_avg bigint; v_new_avg bigint;
  v_received integer := 0; v_count integer := 0; v_status text;
BEGIN
  IF NOT public.has_permission('inventory.receive') THEN
    RAISE EXCEPTION 'Permission inventory.receive requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Aucune entreprise rattachee' USING ERRCODE = '42501'; END IF;
  IF length(v_key) < 3 OR length(v_key) > 120 OR p_lines IS NULL
    OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Reception incomplete' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_order FROM public.purchase_orders
  WHERE id = p_order_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable' USING ERRCODE = 'P0002'; END IF;
  IF v_order.status = 'cancelled' THEN RAISE EXCEPTION 'Commande annulee' USING ERRCODE = '23514'; END IF;
  IF NOT public.can_access_station(v_order.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  FOR v_raw IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_raw) <> 'object'
      OR COALESCE((v_raw->>'qty')::integer, 0) <= 0
      OR (v_raw->>'unit_cost_minor' IS NOT NULL
        AND COALESCE((v_raw->>'unit_cost_minor')::bigint, -1) < 0) THEN
      RAISE EXCEPTION 'Ligne de reception invalide' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  INSERT INTO public.stock_receipt_events (company_id, station_id, order_id, receipt_key, lines, created_by)
  VALUES (v_company, v_order.station_id, p_order_id, v_key, p_lines, auth.uid())
  ON CONFLICT (company_id, receipt_key) DO NOTHING RETURNING id INTO v_event;
  IF v_event IS NULL THEN
    SELECT order_id, lines INTO v_order FROM public.stock_receipt_events
    WHERE company_id = v_company AND receipt_key = v_key;
    IF v_order.order_id <> p_order_id OR v_order.lines IS DISTINCT FROM p_lines THEN
      RAISE EXCEPTION 'Cle de reception deja utilisee avec un autre contenu' USING ERRCODE = '23514';
    END IF;
    SELECT status INTO v_status FROM public.purchase_orders WHERE id = p_order_id;
    RETURN jsonb_build_object('receivedQty', 0, 'lines', 0, 'status', v_status, 'duplicate', true);
  END IF;
  FOR v_line IN
    SELECT (e.value->>'product_id')::uuid AS product_id,
           SUM((e.value->>'qty')::integer)::integer AS qty,
           MIN(NULLIF(e.value->>'unit_cost_minor', '')::bigint) AS min_cost,
           MAX(NULLIF(e.value->>'unit_cost_minor', '')::bigint) AS max_cost
    FROM jsonb_array_elements(p_lines) AS e(value)
    GROUP BY 1
  LOOP
    v_product := v_line.product_id;
    v_qty := v_line.qty;
    IF v_line.min_cost IS DISTINCT FROM v_line.max_cost THEN
      RAISE EXCEPTION 'Cout unitaire incoherent pour un meme produit' USING ERRCODE = '23514';
    END IF;
    v_movement_key := 'receipt:' || v_key || ':' || v_product::text;
    IF EXISTS (SELECT 1 FROM public.stock_movements
      WHERE company_id = v_company AND idempotency_key = v_movement_key) THEN CONTINUE; END IF;
    SELECT * INTO v_item FROM public.purchase_order_items
    WHERE order_id = p_order_id AND product_id = v_product AND company_id = v_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de commande inconnue' USING ERRCODE = '23514'; END IF;
    IF v_qty > v_item.qty_ordered - v_item.qty_received THEN
      RAISE EXCEPTION 'Quantite recue superieure au reste a recevoir' USING ERRCODE = '23514';
    END IF;
    v_cost := COALESCE(v_line.max_cost, v_item.unit_cost_minor, 0);
    v_old_qty := 0; v_old_avg := 0;
    SELECT qty_on_hand INTO v_old_qty FROM public.stock_levels
    WHERE station_id = v_order.station_id AND product_id = v_product FOR UPDATE;
    IF NOT FOUND THEN v_old_qty := 0; END IF;
    SELECT average_cost_minor INTO v_old_avg FROM public.products
    WHERE id = v_product AND company_id = v_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produit introuvable' USING ERRCODE = 'P0002'; END IF;
    v_new_avg := CASE WHEN v_old_qty + v_qty > 0 THEN
      ROUND(((v_old_qty::numeric * v_old_avg) + (v_qty::numeric * v_cost)) / (v_old_qty + v_qty))::bigint
      ELSE v_cost END;
    UPDATE public.products SET average_cost_minor = v_new_avg, updated_at = clock_timestamp()
    WHERE id = v_product AND company_id = v_company;
    INSERT INTO public.stock_movements (company_id, station_id, product_id, kind, qty_delta,
      unit_cost_minor, reference_type, reference_id, idempotency_key, created_by, note)
    VALUES (v_company, v_order.station_id, v_product, 'purchase_receipt', v_qty, v_cost,
      'purchase_order', p_order_id, v_movement_key, auth.uid(), 'Reception ' || v_key);
    INSERT INTO public.stock_levels (company_id, station_id, product_id, qty_on_hand)
    VALUES (v_company, v_order.station_id, v_product, v_qty)
    ON CONFLICT (station_id, product_id) DO UPDATE
      SET qty_on_hand = public.stock_levels.qty_on_hand + EXCLUDED.qty_on_hand,
          updated_at = clock_timestamp();
    UPDATE public.purchase_order_items SET qty_received = qty_received + v_qty
    WHERE order_id = p_order_id AND product_id = v_product AND company_id = v_company;
    v_received := v_received + v_qty;
    v_count := v_count + 1;
  END LOOP;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public.purchase_order_items
    WHERE order_id = p_order_id AND qty_received < qty_ordered
  ) THEN 'received' ELSE 'partially_received' END INTO v_status;
  UPDATE public.purchase_orders SET status = v_status, updated_at = clock_timestamp()
  WHERE id = p_order_id AND company_id = v_company;
  RETURN jsonb_build_object('receivedQty', v_received, 'lines', v_count,
    'status', v_status, 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_order_id uuid, p_lines jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key text := 'legacy:' || md5(p_order_id::text || ':' || COALESCE(p_lines::text, ''));
BEGIN
  PERFORM public.receive_purchase_lines(p_order_id, p_lines, v_key);
END $$;

CREATE OR REPLACE FUNCTION public.start_inventory_session(p_station_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_session uuid;
BEGIN
  IF NOT public.has_permission('inventory.adjust') THEN
    RAISE EXCEPTION 'Permission inventory.adjust requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_stock_station(p_station_id);
  INSERT INTO public.inventory_sessions (company_id, station_id, status, created_by)
  VALUES (v_company, p_station_id, 'open', auth.uid()) RETURNING id INTO v_session;
  INSERT INTO public.inventory_items (company_id, station_id, session_id, product_id,
    expected_qty, counted_qty)
  SELECT v_company, p_station_id, v_session, p.id,
    COALESCE(s.qty_on_hand, 0), COALESCE(s.qty_on_hand, 0)
  FROM public.products p
  LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
  WHERE p.company_id = v_company AND p.station_id = p_station_id
    AND p.deleted_at IS NULL AND p.active;
  RETURN v_session;
END $$;

CREATE OR REPLACE FUNCTION public.record_inventory_count(
  p_session_id uuid, p_product_id uuid, p_counted_qty integer, p_reason text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_session record;
BEGIN
  IF NOT public.has_permission('inventory.adjust') THEN
    RAISE EXCEPTION 'Permission inventory.adjust requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.inventory_sessions
  WHERE id = p_session_id AND company_id = v_company AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventaire ouvert introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_session.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_counted_qty, -1) < 0 THEN
    RAISE EXCEPTION 'Comptage negatif interdit' USING ERRCODE = '23514';
  END IF;
  UPDATE public.inventory_items SET counted_qty = p_counted_qty,
    reason = COALESCE(p_reason, '')
  WHERE session_id = p_session_id AND product_id = p_product_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produit hors inventaire' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.close_inventory_session(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_session record; v_item record;
  v_on_hand integer; v_avg bigint; v_count integer := 0; v_differences integer := 0;
BEGIN
  IF NOT public.has_permission('inventory.adjust') THEN
    RAISE EXCEPTION 'Permission inventory.adjust requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.inventory_sessions
  WHERE id = p_session_id AND company_id = v_company AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventaire ouvert introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_session.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  FOR v_item IN SELECT * FROM public.inventory_items
    WHERE session_id = p_session_id AND company_id = v_company ORDER BY product_id LOOP
    v_count := v_count + 1;
    IF v_item.difference = 0 THEN CONTINUE; END IF;
    v_on_hand := 0; v_avg := 0;
    SELECT qty_on_hand INTO v_on_hand FROM public.stock_levels
    WHERE station_id = v_session.station_id AND product_id = v_item.product_id FOR UPDATE;
    IF NOT FOUND THEN v_on_hand := 0; END IF;
    SELECT average_cost_minor INTO v_avg FROM public.products WHERE id = v_item.product_id;
    IF v_on_hand + v_item.difference < 0 THEN
      RAISE EXCEPTION 'Ajustement refusé : stock negatif interdit' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.stock_movements (company_id, station_id, product_id, kind, qty_delta,
      unit_cost_minor, reference_type, reference_id, idempotency_key, created_by, note)
    VALUES (v_company, v_session.station_id, v_item.product_id, 'inventory_adjustment',
      v_item.difference, COALESCE(v_avg, 0), 'inventory_session', p_session_id,
      'inventory:' || p_session_id::text || ':' || v_item.product_id::text, auth.uid(),
      COALESCE(NULLIF(v_item.reason, ''), 'Ecart d inventaire'));
    INSERT INTO public.stock_levels (company_id, station_id, product_id, qty_on_hand)
    VALUES (v_company, v_session.station_id, v_item.product_id, v_item.difference)
    ON CONFLICT (station_id, product_id) DO UPDATE
      SET qty_on_hand = public.stock_levels.qty_on_hand + EXCLUDED.qty_on_hand,
          updated_at = clock_timestamp();
    v_differences := v_differences + 1;
  END LOOP;
  UPDATE public.inventory_sessions SET status = 'closed', closed_at = clock_timestamp()
  WHERE id = p_session_id AND company_id = v_company;
  RETURN jsonb_build_object('countedProducts', v_count, 'adjustments', v_differences,
    'status', 'closed');
END $$;

CREATE OR REPLACE FUNCTION public.save_service_consumption(
  p_service_id uuid, p_product_id uuid, p_qty_per_wash numeric, p_active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_service record; v_product record; v_id uuid;
BEGIN
  IF NOT public.has_permission('catalog.manage') THEN
    RAISE EXCEPTION 'Permission catalog.manage requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL OR COALESCE(p_qty_per_wash, 0) <= 0 THEN
    RAISE EXCEPTION 'Consommation theorique invalide' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_service FROM public.services
  WHERE id = p_service_id AND company_id = v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prestation introuvable' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_product FROM public.products
  WHERE id = p_product_id AND company_id = v_company
    AND station_id = v_service.station_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produit hors station' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_service.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.service_product_consumptions (company_id, station_id, service_id,
    product_id, qty_per_wash, active)
  VALUES (v_company, v_service.station_id, p_service_id, p_product_id, p_qty_per_wash, p_active)
  ON CONFLICT (service_id, product_id) DO UPDATE
    SET qty_per_wash = EXCLUDED.qty_per_wash, active = EXCLUDED.active,
        updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.consume_products_for_wash(p_wash_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_wash record; v_lines jsonb; v_line jsonb;
  v_product uuid; v_qty integer; v_cost bigint; v_key text; v_total bigint;
BEGIN
  IF NOT public.has_permission('inventory.consume') THEN
    RAISE EXCEPTION 'Permission inventory.consume requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_wash FROM public.washes
  WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF v_wash.status NOT IN ('ready', 'delivered') THEN
    RAISE EXCEPTION 'Consommation reservee aux fiches terminees ou livrees' USING ERRCODE = '23514';
  END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', q.product_id, 'qty', q.qty, 'unit_cost_minor', p.average_cost_minor
  )), '[]'::jsonb) INTO v_lines
  FROM (
    SELECT spc.product_id, SUM(CEIL(spc.qty_per_wash * wi.qty))::integer AS qty
    FROM public.wash_items wi
    JOIN public.service_product_consumptions spc
      ON spc.service_id = wi.service_id AND spc.active
      AND spc.company_id = v_company AND spc.station_id = v_wash.station_id
    WHERE wi.wash_id = p_wash_id AND wi.company_id = v_company
    GROUP BY spc.product_id
  ) q JOIN public.products p ON p.id = q.product_id AND p.company_id = v_company;
  IF jsonb_array_length(v_lines) = 0 THEN RETURN; END IF;
  SELECT COALESCE(SUM((x.value->>'qty')::integer * (x.value->>'unit_cost_minor')::bigint), 0)
  INTO v_total FROM jsonb_array_elements(v_lines) AS x(value);
  INSERT INTO public.stock_consumption_runs (company_id, station_id, wash_id,
    movement_count, valued_minor, created_by)
  VALUES (v_company, v_wash.station_id, p_wash_id, jsonb_array_length(v_lines), v_total, auth.uid())
  ON CONFLICT (wash_id) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
    v_product := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'qty')::integer;
    v_cost := (v_line->>'unit_cost_minor')::bigint;
    v_key := 'wash:' || p_wash_id::text || ':' || v_product::text;
    IF EXISTS (SELECT 1 FROM public.stock_movements
      WHERE company_id = v_company AND idempotency_key = v_key) THEN CONTINUE; END IF;
    UPDATE public.stock_levels SET qty_on_hand = qty_on_hand - v_qty, updated_at = clock_timestamp()
    WHERE station_id = v_wash.station_id AND product_id = v_product AND qty_on_hand >= v_qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock insuffisant pour le produit %', v_product USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.stock_movements (company_id, station_id, product_id, kind, qty_delta,
      unit_cost_minor, reference_type, reference_id, idempotency_key, created_by, note)
    VALUES (v_company, v_wash.station_id, v_product, 'consumption', -v_qty, v_cost,
      'wash', p_wash_id, v_key, auth.uid(), 'Consommation theorique');
  END LOOP;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'save_product_category','save_supplier','save_product','create_purchase_order',
      'receive_purchase_lines','receive_purchase_order','start_inventory_session',
      'record_inventory_count','close_inventory_session','save_service_consumption',
      'consume_products_for_wash'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'assert_stock_station'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
