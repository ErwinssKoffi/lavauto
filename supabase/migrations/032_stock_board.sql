-- 032 — Prompt 07 : projection serveur unique du stock, sans filtre client.
-- Aucune donnée n'est fabriquée : la RPC lit les tables autorisées et expose
-- uniquement des clés camelCase, sans identifiant d'entreprise.

CREATE OR REPLACE FUNCTION public.my_stock_board() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
BEGIN
  IF NOT public.has_permission('inventory.view') THEN
    RAISE EXCEPTION 'Permission inventory.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'productCategories', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'name', c.name, 'active', c.active
    )) FROM public.product_categories c
      WHERE (c.company_id = v_company OR v_admin) AND c.deleted_at IS NULL
        AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'stationId', p.station_id, 'categoryId', p.category_id,
      'sku', p.sku, 'name', p.name, 'category', p.category, 'unit', p.unit,
      'reorderLevel', p.reorder_level, 'averageCostMinor', p.average_cost_minor,
      'active', p.active
    )) FROM public.products p
      WHERE (p.company_id = v_company OR v_admin) AND p.deleted_at IS NULL
        AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'suppliers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'stationId', s.station_id, 'name', s.name, 'phone', s.phone,
      'email', s.email, 'address', s.address, 'active', s.active
    )) FROM public.suppliers s
      WHERE (s.company_id = v_company OR v_admin) AND s.deleted_at IS NULL
        AND public.can_access_station(s.station_id)), '[]'::jsonb),
    'purchaseOrders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'stationId', o.station_id, 'supplierId', o.supplier_id,
      'number', o.number, 'status', o.status, 'orderedAt', o.ordered_at,
      'expectedAt', o.expected_at, 'note', o.note
    )) FROM public.purchase_orders o
      WHERE (o.company_id = v_company OR v_admin)
        AND public.can_access_station(o.station_id)), '[]'::jsonb),
    'purchaseOrderItems', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'stationId', i.station_id, 'orderId', i.order_id,
      'productId', i.product_id, 'qtyOrdered', i.qty_ordered,
      'qtyReceived', i.qty_received, 'unitCostMinor', i.unit_cost_minor
    )) FROM public.purchase_order_items i
      WHERE (i.company_id = v_company OR v_admin)
        AND public.can_access_station(i.station_id)), '[]'::jsonb),
    'stockLevels', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'productId', p.id, 'stationId', p.station_id, 'name', p.name,
      'unit', p.unit, 'reorderLevel', p.reorder_level,
      'qtyOnHand', COALESCE(s.qty_on_hand, 0),
      'averageCostMinor', p.average_cost_minor,
      'valueMinor', COALESCE(s.qty_on_hand, 0) * p.average_cost_minor
    )) FROM public.products p
      LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
      WHERE (p.company_id = v_company OR v_admin) AND p.deleted_at IS NULL AND p.active
        AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'stockMovements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'stationId', m.station_id, 'productId', m.product_id,
      'kind', m.kind, 'qtyDelta', m.qty_delta, 'unitCostMinor', m.unit_cost_minor,
      'referenceType', m.reference_type, 'referenceId', m.reference_id,
      'idempotencyKey', m.idempotency_key, 'note', m.note, 'createdAt', m.created_at
    )) FROM (
      SELECT x.* FROM public.stock_movements x
      WHERE (x.company_id = v_company OR v_admin)
        AND public.can_access_station(x.station_id)
      ORDER BY x.created_at DESC LIMIT 100
    ) m), '[]'::jsonb),
    'inventorySessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'stationId', s.station_id, 'status', s.status,
      'startedAt', s.started_at, 'closedAt', s.closed_at
    )) FROM public.inventory_sessions s
      WHERE (s.company_id = v_company OR v_admin)
        AND public.can_access_station(s.station_id)), '[]'::jsonb),
    'inventoryItems', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'stationId', i.station_id, 'sessionId', i.session_id,
      'productId', i.product_id, 'expectedQty', i.expected_qty,
      'countedQty', i.counted_qty, 'difference', i.difference, 'reason', i.reason
    )) FROM public.inventory_items i
      WHERE (i.company_id = v_company OR v_admin)
        AND public.can_access_station(i.station_id)), '[]'::jsonb),
    'services', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'stationId', s.station_id, 'name', s.name, 'active', s.active
    )) FROM public.services s
      WHERE (s.company_id = v_company OR v_admin) AND s.deleted_at IS NULL
        AND public.can_access_station(s.station_id)), '[]'::jsonb),
    'serviceConsumptions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'serviceId', c.service_id,
      'productId', c.product_id, 'qtyPerWash', c.qty_per_wash, 'active', c.active
    )) FROM public.service_product_consumptions c
      WHERE (c.company_id = v_company OR v_admin)
        AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'receiptEvents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'stationId', r.station_id, 'orderId', r.order_id,
      'receiptKey', r.receipt_key, 'lines', r.lines, 'createdAt', r.created_at
    )) FROM public.stock_receipt_events r
      WHERE (r.company_id = v_company OR v_admin)
        AND public.can_access_station(r.station_id)), '[]'::jsonb),
    'consumptionRuns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'stationId', r.station_id, 'washId', r.wash_id,
      'movementCount', r.movement_count, 'valuedMinor', r.valued_minor,
      'createdAt', r.created_at
    )) FROM public.stock_consumption_runs r
      WHERE (r.company_id = v_company OR v_admin)
        AND public.can_access_station(r.station_id)), '[]'::jsonb),
    'costCertifications', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'start', f.start_date, 'end', f.end_date,
      'revenueMinor', f.revenue_minor, 'consumptionCostMinor', f.consumption_cost_minor,
      'operatingExpenseMinor', f.operating_expense_minor,
      'commissionCostMinor', f.commission_cost_minor,
      'grossMarginMinor', f.gross_margin_minor, 'resultMinor', f.result_minor,
      'attestation', f.attestation, 'certifiedAt', f.certified_at
    )) FROM public.finance_cost_periods f
      WHERE f.company_id = v_company OR v_admin), '[]'::jsonb),
    'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'productId', p.id, 'stationId', p.station_id, 'name', p.name,
      'qtyOnHand', COALESCE(s.qty_on_hand, 0), 'reorderLevel', p.reorder_level,
      'severity', CASE WHEN COALESCE(s.qty_on_hand, 0) = 0 THEN 'rupture' ELSE 'seuil' END
    )) FROM public.products p
      LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
      WHERE (p.company_id = v_company OR v_admin) AND p.deleted_at IS NULL AND p.active
        AND p.reorder_level > 0 AND COALESCE(s.qty_on_hand, 0) <= p.reorder_level
        AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'valuation', jsonb_build_object(
      'stockValueMinor', COALESCE((SELECT SUM(COALESCE(s.qty_on_hand, 0) * p.average_cost_minor)
        FROM public.products p
        LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
        WHERE (p.company_id = v_company OR v_admin) AND p.deleted_at IS NULL
          AND public.can_access_station(p.station_id)), 0),
      'productsValued', COALESCE((SELECT count(*) FROM public.products p
        WHERE (p.company_id = v_company OR v_admin) AND p.deleted_at IS NULL
          AND p.average_cost_minor > 0
          AND public.can_access_station(p.station_id)), 0),
      'consumptionCostMinor', COALESCE((SELECT SUM(-m.qty_delta * m.unit_cost_minor)
        FROM public.stock_movements m
        WHERE (m.company_id = v_company OR v_admin) AND m.kind = 'consumption'
          AND public.can_access_station(m.station_id)), 0),
      'purchaseCostMinor', COALESCE((SELECT SUM(m.qty_delta * m.unit_cost_minor)
        FROM public.stock_movements m
        WHERE (m.company_id = v_company OR v_admin) AND m.kind = 'purchase_receipt'
          AND public.can_access_station(m.station_id)), 0),
      'openOrders', COALESCE((SELECT count(*) FROM public.purchase_orders o
        WHERE (o.company_id = v_company OR v_admin) AND o.status IN ('sent', 'partially_received')
          AND public.can_access_station(o.station_id)), 0),
      'lowStockAlerts', COALESCE((SELECT count(*) FROM public.products p
        LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
        WHERE (p.company_id = v_company OR v_admin) AND p.deleted_at IS NULL AND p.active
          AND p.reorder_level > 0 AND COALESCE(s.qty_on_hand, 0) <= p.reorder_level
          AND public.can_access_station(p.station_id)), 0)
    ),
    'rules', jsonb_build_object(
      'reception', 'Seule la réception incrémente le stock ; une commande ne le fait jamais',
      'immutability', 'Un mouvement n’est jamais modifié ni supprimé ; un écart crée un nouveau mouvement',
      'consumption', 'Une consommation théorique est générée au plus une fois par fiche et par produit',
      'costing', 'Coût moyen pondéré mis à jour à chaque réception, figé sur chaque mouvement de consommation'
    )
  );
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'my_stock_board'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
