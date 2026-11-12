-- 054 — Périmètre explicite par station, sans changer les RPC consolidées historiques.
-- La station vient de la sélection UI, mais n'est JAMAIS une autorisation :
-- elle doit appartenir à l'entreprise active et être accessible au JWT.
-- À déployer avant le frontend correspondant, après 051–053.
CREATE OR REPLACE FUNCTION public.assert_my_station(p_station_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_company_id() IS NULL
    OR p_station_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.stations s
      WHERE s.id = p_station_id AND s.company_id = public.current_company_id()
        AND s.deleted_at IS NULL
    ) OR NOT public.can_access_station(p_station_id) THEN
    RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_my_station(uuid) FROM PUBLIC, anon, authenticated;


-- Le contexte reste filtré par can_access_station, et expose les coordonnées
-- propres à chaque station plutôt que de réutiliser celles de la première.
CREATE OR REPLACE FUNCTION public.my_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_profile public.user_profiles%ROWTYPE;
  v_role_key text;
  v_permissions text[];
  v_company_json jsonb;
  v_stations jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('userId', NULL, 'authenticated', false);
  END IF;
  SELECT * INTO v_profile FROM public.user_profiles WHERE id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', v_user, 'authenticated', true, 'profileReady', false,
      'isPlatformAdmin', v_admin, 'company', NULL, 'stations', '[]'::jsonb, 'permissions', '[]'::jsonb);
  END IF;
  SELECT key INTO v_role_key FROM public.roles WHERE id = v_profile.role_id;
  IF v_admin THEN
    SELECT array_agg(key ORDER BY key) INTO v_permissions FROM public.permissions;
  ELSE
    SELECT COALESCE(array_agg(rp.permission_id ORDER BY rp.permission_id), ARRAY[]::text[])
      INTO v_permissions
      FROM public.role_permissions rp WHERE rp.role_id = v_profile.role_id;
  END IF;
  SELECT to_jsonb(c) - 'updated_at' - 'deleted_at' INTO v_company_json
    FROM public.companies c WHERE c.id = v_company;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'city', s.city, 'address', s.address, 'phone', s.phone,
      'hours', s.hours, 'activated', s.activated, 'activatedAt', s.activated_at, 'logoPath', s.logo_path
    ) ORDER BY s.created_at), '[]'::jsonb)
    INTO v_stations
    FROM public.stations s
    WHERE s.company_id = v_company AND s.deleted_at IS NULL
      AND (v_admin OR public.can_access_station(s.id));
  RETURN jsonb_build_object(
    'userId', v_user,
    'authenticated', true,
    'profileReady', true,
    'active', v_profile.active AND COALESCE(v_company_json->>'suspended', 'false') <> 'true',
    'email', COALESCE((SELECT email FROM auth.users WHERE id = v_user), v_profile.email),
    'fullName', v_profile.full_name,
    'roleKey', COALESCE(v_role_key, ''),
    'isPlatformAdmin', v_admin,
    'company', v_company_json,
    'companyId', v_company,
    'stations', v_stations,
    'permissions', to_jsonb(COALESCE(v_permissions, ARRAY[]::text[]))
  );
END $$;
REVOKE ALL ON FUNCTION public.my_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_context() TO authenticated;

-- Liste minimale pour l’affectation, distincte de l’annuaire RH.
-- Elle ne révèle ni e-mail ni téléphone ; seuls les comptes actifs ayant
-- réellement une affectation à cette station sont éligibles aux commandes.
CREATE OR REPLACE FUNCTION public.my_station_assignable_users(p_station_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF NOT public.has_permission('washes.assign') THEN
    RAISE EXCEPTION 'Permission washes.assign requise' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'roleKey', r.key
  ) ORDER BY p.full_name, p.id), '[]'::jsonb) INTO v_result
  FROM public.user_profiles p
  JOIN public.user_station_assignments a ON a.user_id = p.id
    AND a.company_id = v_company AND a.station_id = p_station_id
  JOIN public.roles r ON r.id = p.role_id
  WHERE p.company_id = v_company AND p.active AND p.deleted_at IS NULL;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.my_station_clients(p_station_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Aucune entreprise rattachée à ce compte' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'stationId', c.station_id, 'name', c.name, 'phone', c.phone,
    'plate', COALESCE((
      SELECT v.plate FROM public.vehicles v
      WHERE v.customer_id = c.id AND v.deleted_at IS NULL AND v.plate <> ''
      ORDER BY v.created_at DESC LIMIT 1
    ), ''),
    'notes', c.notes, 'createdAt', c.created_at
  ) ORDER BY c.name), '[]'::jsonb)
  INTO v_result
  FROM public.customers c
  WHERE c.company_id = v_company
    AND c.station_id = p_station_id AND public.can_access_station(c.station_id) AND c.deleted_at IS NULL;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.my_station_wash_posts(p_station_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Aucune entreprise rattachée à ce compte' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'stationId', p.station_id, 'name', p.name,
    'capacity', p.capacity, 'active', p.active
  ) ORDER BY p.name), '[]'::jsonb)
  INTO v_result
  FROM public.wash_posts p
  WHERE p.company_id = v_company
    AND p.station_id = p_station_id AND public.can_access_station(p.station_id) AND p.deleted_at IS NULL;
  RETURN v_result;
END $$;


CREATE OR REPLACE FUNCTION public.my_station_wash_board(p_station_id uuid, p_plate text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(q.w ORDER BY q.created_at DESC), '[]'::jsonb) INTO v_result FROM (
    SELECT w.created_at, jsonb_build_object(
      'id', w.id, 'stationId', w.station_id, 'number', w.number,
      'clientId', w.customer_id, 'clientName', w.customer_name,
      'vehicleCategoryId', w.vehicle_category_id, 'vehicleLabel', w.vehicle_label,
      'plate', w.plate,
      'employeeId', COALESCE((SELECT a.user_id::text FROM public.wash_assignments a
        WHERE a.wash_id = w.id AND a.unassigned_at IS NULL ORDER BY a.assigned_at LIMIT 1), ''),
      'assignedUserIds', COALESCE((SELECT jsonb_agg(a.user_id::text ORDER BY a.assigned_at)
        FROM public.wash_assignments a WHERE a.wash_id = w.id AND a.unassigned_at IS NULL), '[]'::jsonb),
      'postId', (SELECT a.post_id::text FROM public.wash_assignments a
        WHERE a.wash_id = w.id AND a.unassigned_at IS NULL AND a.post_id IS NOT NULL
        ORDER BY a.assigned_at LIMIT 1),
      'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'serviceId', i.service_id, 'serviceName', i.service_name,
        'unitPrice', i.unit_price_minor, 'qty', i.qty) ORDER BY i.created_at)
        FROM public.wash_items i WHERE i.wash_id = w.id), '[]'::jsonb),
      'discount', w.discount_minor, 'total', w.total_minor, 'paid', w.paid_minor,
      'status', w.status, 'createdAt', w.created_at, 'finishedAt', w.finished_at,
      'cancelledReason', w.cancelled_reason, 'deliveredAt', w.delivered_at,
      'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', pay.id, 'amount', pay.amount_minor,
        'method', public.payment_method_ui_key(pm.key),
        'at', pay.created_at, 'byUserId', pay.created_by,
        'idempotencyKey', pay.idempotency_key,
        'cancelledAt', pc.created_at, 'cancelReason', pc.reason
      ) ORDER BY pay.created_at)
        FROM public.payments pay
        LEFT JOIN public.payment_methods pm ON pm.id = pay.payment_method_id
        LEFT JOIN public.payment_cancellations pc ON pc.payment_id = pay.id
        WHERE pay.wash_id = w.id), '[]'::jsonb),
      'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', h.id, 'fromStatus', h.from_status, 'toStatus', h.to_status,
        'reason', h.reason, 'at', h.created_at, 'actorUserId', h.actor_user_id
      ) ORDER BY h.created_at) FROM public.wash_status_history h WHERE h.wash_id = w.id), '[]'::jsonb),
      'qualityResult', (SELECT q.result FROM public.wash_quality_checks q
        WHERE q.wash_id = w.id ORDER BY q.checked_at DESC LIMIT 1),
      'qualityNotes', (SELECT q.notes FROM public.wash_quality_checks q
        WHERE q.wash_id = w.id ORDER BY q.checked_at DESC LIMIT 1)
    ) AS w
    FROM public.washes w
    WHERE w.company_id = v_company
      AND w.station_id = p_station_id AND public.can_access_station(w.station_id) AND w.deleted_at IS NULL
      AND (p_plate IS NULL OR upper(btrim(w.plate)) = upper(btrim(p_plate)))
    ORDER BY w.created_at DESC LIMIT 200
  ) q;
  RETURN v_result;
END $$;


CREATE OR REPLACE FUNCTION public.my_station_finance_board(p_station_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF NOT (
    public.has_permission('reports.view') OR public.has_permission('cash.open')
    OR public.has_permission('cash.close') OR public.has_permission('cash.reopen')
    OR public.has_permission('expenses.create') OR public.has_permission('expenses.cancel')
    OR public.has_permission('commissions.view')
  ) THEN
    RAISE EXCEPTION 'Permission finance requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'paymentMethods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', pm.id, 'stationId', pm.station_id, 'key', pm.key, 'label', pm.label,
      'uiMethod', public.payment_method_ui_key(pm.key),
      'affectsCash', pm.affects_cash, 'active', pm.active
    ) ORDER BY pm.key) FROM public.payment_methods pm
      WHERE pm.company_id = v_company AND pm.station_id = p_station_id AND public.can_access_station(pm.station_id)), '[]'::jsonb),
    'cashSessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', cs.id, 'stationId', cs.station_id, 'number', cs.number,
      'openedBy', COALESCE(u.full_name, ''), 'openedAt', cs.opened_at,
      'openingFloat', cs.opening_float_minor, 'closedAt', cs.closed_at,
      'countedAmount', cs.counted_minor, 'closedBy', COALESCE(u2.full_name, ''),
      'status', CASE WHEN cs.status = 'open' THEN 'ouverte' ELSE 'cloturee' END,
      'reopenReason', cs.reopen_reason, 'reopenedAt', cs.reopened_at
    ) ORDER BY cs.opened_at DESC) FROM public.cash_sessions cs
      LEFT JOIN public.user_profiles u ON u.id = cs.opened_by
      LEFT JOIN public.user_profiles u2 ON u2.id = cs.closed_by
      WHERE cs.company_id = v_company AND cs.station_id = p_station_id AND public.can_access_station(cs.station_id) AND (public.has_permission('reports.view') OR public.has_permission('cash.open') OR public.has_permission('cash.close') OR public.has_permission('cash.reopen') OR public.has_permission('expenses.create'))), '[]'::jsonb),
    'cashMovements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'stationId', m.station_id, 'cashSessionId', m.cash_session_id,
      'kind', m.kind, 'amount', m.amount_minor,
      'uiMethod', public.payment_method_ui_key(pm.key),
      'paymentId', m.payment_id, 'expenseId', m.expense_id,
      'reference', m.reference, 'idempotencyKey', m.idempotency_key,
      'createdAt', m.created_at
    ) ORDER BY m.created_at) FROM public.cash_movements m
      LEFT JOIN public.payment_methods pm ON pm.id = m.payment_method_id
      WHERE m.company_id = v_company AND m.station_id = p_station_id AND public.can_access_station(m.station_id) AND (public.has_permission('reports.view') OR public.has_permission('cash.open') OR public.has_permission('cash.close') OR public.has_permission('cash.reopen') OR public.has_permission('expenses.create'))), '[]'::jsonb),
    'cashClosures', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'cashSessionId', c.cash_session_id,
      'counted', c.counted_minor, 'theoretical', c.theoretical_minor,
      'difference', c.difference_minor, 'closedBy', COALESCE(u.full_name, ''),
      'createdAt', c.created_at
    ) ORDER BY c.created_at DESC) FROM public.cash_closures c
      LEFT JOIN public.user_profiles u ON u.id = c.closed_by
      WHERE c.company_id = v_company AND c.station_id = p_station_id AND public.can_access_station(c.station_id) AND (public.has_permission('reports.view') OR public.has_permission('cash.open') OR public.has_permission('cash.close') OR public.has_permission('cash.reopen') OR public.has_permission('expenses.create'))), '[]'::jsonb),
    'expenses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'stationId', e.station_id, 'amount', e.amount_minor,
      'category', COALESCE(c.name, 'Autre'), 'reason', e.reason,
      'supplier', COALESCE(e.supplier, ''), 'date', e.spent_at,
      'method', public.payment_method_ui_key(pm.key),
      'cashSessionId', e.cash_session_id,
      'status', CASE WHEN e.status = 'cancelled' THEN 'annulee' ELSE 'enregistree' END,
      'cancelReason', e.cancel_reason, 'createdBy', COALESCE(u.full_name, ''),
      'createdAt', e.created_at, 'idempotencyKey', e.idempotency_key, 'purchaseOrderId', e.purchase_order_id
    ) ORDER BY e.created_at DESC) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      LEFT JOIN public.payment_methods pm ON pm.id = e.payment_method_id
      LEFT JOIN public.user_profiles u ON u.id = e.created_by
      WHERE e.company_id = v_company AND e.station_id = p_station_id AND public.can_access_station(e.station_id) AND (public.has_permission('reports.view') OR public.has_permission('expenses.create') OR public.has_permission('expenses.cancel') OR public.has_permission('cash.open') OR public.has_permission('cash.close'))), '[]'::jsonb),
    'reconciliations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'stationId', r.station_id, 'methodId', r.payment_method_id,
      'uiMethod', public.payment_method_ui_key(pm.key),
      'start', r.period_start, 'end', r.period_end,
      'expected', r.expected_minor, 'counted', r.counted_minor,
      'difference', r.difference_minor, 'frozen', r.frozen,
      'validatedAt', r.validated_at
    ) ORDER BY r.period_start DESC) FROM public.channel_reconciliations r
      LEFT JOIN public.payment_methods pm ON pm.id = r.payment_method_id
      WHERE r.company_id = v_company AND r.station_id = p_station_id AND public.can_access_station(r.station_id) AND (public.has_permission('reports.view') OR public.has_permission('cash.close'))), '[]'::jsonb),
    'commissionPeriods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', cp.id, 'stationId', cp.station_id, 'start', cp.period_start,
      'end', cp.period_end, 'status', cp.status, 'validatedAt', cp.validated_at
    ) ORDER BY cp.period_start DESC) FROM public.commission_periods cp
      WHERE cp.company_id = v_company AND cp.station_id = p_station_id AND public.can_access_station(cp.station_id) AND public.has_permission('commissions.view')), '[]'::jsonb),
    'commissionLines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', ec.id, 'periodId', ec.period_id, 'userId', ec.user_id,
      'userName', COALESCE(u.full_name, 'Employe'), 'washes', ec.washes_count,
      'base', ec.base_minor, 'rate', ec.rate, 'rateOrigin', ec.rate_origin,
      'amount', ec.amount_minor, 'createdAt', ec.created_at
    ) ORDER BY ec.created_at) FROM public.employee_commissions ec
      LEFT JOIN public.user_profiles u ON u.id = ec.user_id
      WHERE ec.company_id = v_company AND ec.station_id = p_station_id AND public.can_access_station(ec.station_id) AND public.has_permission('commissions.view')), '[]'::jsonb),
    'commissionPayouts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', po.id, 'periodId', po.period_id, 'userId', po.user_id,
      'amount', po.amount_minor, 'reference', COALESCE(po.reference, ''),
      'paidAt', po.paid_at
    ) ORDER BY po.paid_at) FROM public.commission_payouts po
      WHERE po.company_id = v_company AND po.station_id = p_station_id AND public.can_access_station(po.station_id) AND public.has_permission('commissions.view')), '[]'::jsonb),
    'paymentCancellations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', pc.id, 'paymentId', pc.payment_id, 'amount', pc.amount_minor,
      'reason', pc.reason, 'at', pc.created_at
    ) ORDER BY pc.created_at) FROM public.payment_cancellations pc
      WHERE pc.company_id = v_company AND pc.station_id = p_station_id AND public.can_access_station(pc.station_id) AND (public.has_permission('reports.view') OR public.has_permission('cash.close') OR public.has_permission('payments.cancel'))), '[]'::jsonb)
  );
END $$;


CREATE OR REPLACE FUNCTION public.my_station_stock_board(p_station_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
BEGIN
  PERFORM public.assert_my_station(p_station_id);
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
      WHERE c.company_id = v_company AND c.deleted_at IS NULL
        AND c.station_id = p_station_id AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'stationId', p.station_id, 'categoryId', p.category_id,
      'sku', p.sku, 'name', p.name, 'category', p.category, 'unit', p.unit,
      'reorderLevel', p.reorder_level, 'averageCostMinor', p.average_cost_minor,
      'active', p.active
    )) FROM public.products p
      WHERE p.company_id = v_company AND p.deleted_at IS NULL
        AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'suppliers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'stationId', s.station_id, 'name', s.name, 'phone', s.phone,
      'email', s.email, 'address', s.address, 'active', s.active
    )) FROM public.suppliers s
      WHERE s.company_id = v_company AND s.deleted_at IS NULL
        AND s.station_id = p_station_id AND public.can_access_station(s.station_id)), '[]'::jsonb),
    'purchaseOrders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'stationId', o.station_id, 'supplierId', o.supplier_id,
      'number', o.number, 'status', o.status, 'orderedAt', o.ordered_at,
      'expectedAt', o.expected_at, 'note', o.note
    )) FROM public.purchase_orders o
      WHERE o.company_id = v_company
        AND o.station_id = p_station_id AND public.can_access_station(o.station_id)), '[]'::jsonb),
    'purchaseOrderItems', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'stationId', i.station_id, 'orderId', i.order_id,
      'productId', i.product_id, 'qtyOrdered', i.qty_ordered,
      'qtyReceived', i.qty_received, 'unitCostMinor', i.unit_cost_minor
    )) FROM public.purchase_order_items i
      WHERE i.company_id = v_company
        AND i.station_id = p_station_id AND public.can_access_station(i.station_id)), '[]'::jsonb),
    'stockLevels', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'productId', p.id, 'stationId', p.station_id, 'name', p.name,
      'unit', p.unit, 'reorderLevel', p.reorder_level,
      'qtyOnHand', COALESCE(s.qty_on_hand, 0),
      'averageCostMinor', p.average_cost_minor,
      'valueMinor', COALESCE(s.qty_on_hand, 0) * p.average_cost_minor
    )) FROM public.products p
      LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
      WHERE p.company_id = v_company AND p.deleted_at IS NULL AND p.active
        AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'stockMovements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'stationId', m.station_id, 'productId', m.product_id,
      'kind', m.kind, 'qtyDelta', m.qty_delta, 'unitCostMinor', m.unit_cost_minor,
      'referenceType', m.reference_type, 'referenceId', m.reference_id,
      'idempotencyKey', m.idempotency_key, 'note', m.note, 'createdAt', m.created_at
    )) FROM (
      SELECT x.* FROM public.stock_movements x
      WHERE x.company_id = v_company
        AND x.station_id = p_station_id AND public.can_access_station(x.station_id)
      ORDER BY x.created_at DESC LIMIT 100
    ) m), '[]'::jsonb),
    'inventorySessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'stationId', s.station_id, 'status', s.status,
      'startedAt', s.started_at, 'closedAt', s.closed_at
    )) FROM public.inventory_sessions s
      WHERE s.company_id = v_company
        AND s.station_id = p_station_id AND public.can_access_station(s.station_id)), '[]'::jsonb),
    'inventoryItems', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'stationId', i.station_id, 'sessionId', i.session_id,
      'productId', i.product_id, 'expectedQty', i.expected_qty,
      'countedQty', i.counted_qty, 'difference', i.difference, 'reason', i.reason
    )) FROM public.inventory_items i
      WHERE i.company_id = v_company
        AND i.station_id = p_station_id AND public.can_access_station(i.station_id)), '[]'::jsonb),
    'services', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'stationId', s.station_id, 'name', s.name, 'active', s.active
    )) FROM public.services s
      WHERE s.company_id = v_company AND s.deleted_at IS NULL
        AND s.station_id = p_station_id AND public.can_access_station(s.station_id)), '[]'::jsonb),
    'serviceConsumptions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'serviceId', c.service_id,
      'productId', c.product_id, 'qtyPerWash', c.qty_per_wash, 'active', c.active
    )) FROM public.service_product_consumptions c
      WHERE c.company_id = v_company
        AND c.station_id = p_station_id AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'receiptEvents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'stationId', r.station_id, 'orderId', r.order_id,
      'receiptKey', r.receipt_key, 'lines', r.lines, 'createdAt', r.created_at
    )) FROM public.stock_receipt_events r
      WHERE r.company_id = v_company
        AND r.station_id = p_station_id AND public.can_access_station(r.station_id)), '[]'::jsonb),
    'consumptionRuns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'stationId', r.station_id, 'washId', r.wash_id,
      'movementCount', r.movement_count, 'valuedMinor', r.valued_minor,
      'createdAt', r.created_at
    )) FROM public.stock_consumption_runs r
      WHERE r.company_id = v_company
        AND r.station_id = p_station_id AND public.can_access_station(r.station_id)), '[]'::jsonb),
    'costCertifications', '[]'::jsonb,
    'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'productId', p.id, 'stationId', p.station_id, 'name', p.name,
      'qtyOnHand', COALESCE(s.qty_on_hand, 0), 'reorderLevel', p.reorder_level,
      'severity', CASE WHEN COALESCE(s.qty_on_hand, 0) = 0 THEN 'rupture' ELSE 'seuil' END
    )) FROM public.products p
      LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
      WHERE p.company_id = v_company AND p.deleted_at IS NULL AND p.active
        AND p.reorder_level > 0 AND COALESCE(s.qty_on_hand, 0) <= p.reorder_level
        AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'valuation', jsonb_build_object(
      'stockValueMinor', COALESCE((SELECT SUM(COALESCE(s.qty_on_hand, 0) * p.average_cost_minor)
        FROM public.products p
        LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
        WHERE p.company_id = v_company AND p.deleted_at IS NULL
          AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), 0),
      'productsValued', COALESCE((SELECT count(*) FROM public.products p
        WHERE p.company_id = v_company AND p.deleted_at IS NULL
          AND p.average_cost_minor > 0
          AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), 0),
      'consumptionCostMinor', COALESCE((SELECT SUM(-m.qty_delta * m.unit_cost_minor)
        FROM public.stock_movements m
        WHERE m.company_id = v_company AND m.kind = 'consumption'
          AND m.station_id = p_station_id AND public.can_access_station(m.station_id)), 0),
      'purchaseCostMinor', COALESCE((SELECT SUM(m.qty_delta * m.unit_cost_minor)
        FROM public.stock_movements m
        WHERE m.company_id = v_company AND m.kind = 'purchase_receipt'
          AND m.station_id = p_station_id AND public.can_access_station(m.station_id)), 0),
      'openOrders', COALESCE((SELECT count(*) FROM public.purchase_orders o
        WHERE o.company_id = v_company AND o.status IN ('sent', 'partially_received')
          AND o.station_id = p_station_id AND public.can_access_station(o.station_id)), 0),
      'lowStockAlerts', COALESCE((SELECT count(*) FROM public.products p
        LEFT JOIN public.stock_levels s ON s.station_id = p.station_id AND s.product_id = p.id
        WHERE p.company_id = v_company AND p.deleted_at IS NULL AND p.active
          AND p.reorder_level > 0 AND COALESCE(s.qty_on_hand, 0) <= p.reorder_level
          AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), 0)
    ),
    'rules', jsonb_build_object(
      'reception', 'Seule la réception incrémente le stock ; une commande ne le fait jamais',
      'immutability', 'Un mouvement n’est jamais modifié ni supprimé ; un écart crée un nouveau mouvement',
      'consumption', 'Une consommation théorique est générée au plus une fois par fiche et par produit',
      'costing', 'Coût moyen pondéré mis à jour à chaque réception, figé sur chaque mouvement de consommation'
    )
  );
END $$;


CREATE OR REPLACE FUNCTION public.my_station_crm_board(p_station_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF NOT (
    public.has_permission('crm.view') OR public.has_permission('customers.view')
    OR public.has_permission('loyalty.view') OR public.has_permission('packages.view')
    OR public.has_permission('promotions.view') OR public.has_permission('fleets.view')
  ) THEN
    RAISE EXCEPTION 'Permission CRM requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'name', c.name,
      'phone', c.phone, 'email', c.email, 'plate', COALESCE((
        SELECT v.plate FROM public.vehicles v
        WHERE v.customer_id = c.id AND v.deleted_at IS NULL AND v.plate <> ''
        ORDER BY v.created_at DESC LIMIT 1
      ), ''), 'notes', c.notes, 'customerType', c.customer_type,
      'preferredChannel', c.preferred_channel, 'loyaltyOptIn', c.loyalty_opt_in,
      'fleetId', c.fleet_id, 'createdAt', c.created_at
    ) ORDER BY c.name) FROM public.customers c
      WHERE c.company_id = v_company
        AND c.deleted_at IS NULL AND c.station_id = p_station_id AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'vehicles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'stationId', v.station_id, 'customerId', v.customer_id,
      'categoryId', v.vehicle_category_id, 'plate', v.plate,
      'brand', v.brand, 'model', v.model, 'color', v.color,
      'fleetId', v.fleet_id, 'active', v.is_active, 'createdAt', v.created_at
    ) ORDER BY v.plate, v.created_at) FROM public.vehicles v
      WHERE v.company_id = v_company
        AND v.deleted_at IS NULL AND v.station_id = p_station_id AND public.can_access_station(v.station_id)), '[]'::jsonb),
    'loyaltyPrograms', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'stationId', p.station_id, 'name', p.name,
      'pointsPer1000Minor', p.points_per_1000_minor,
      'redemptionThreshold', p.redemption_threshold, 'active', p.active,
      'createdAt', p.created_at
    ) ORDER BY p.name) FROM public.loyalty_programs p
      WHERE p.company_id = v_company
        AND p.deleted_at IS NULL AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'loyaltyCards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'customerId', c.customer_id,
      'programId', c.program_id, 'cardNumber', c.card_number,
      'pointsBalance', c.points_balance, 'status', c.status, 'createdAt', c.created_at
    ) ORDER BY c.card_number) FROM public.loyalty_cards c
      WHERE c.company_id = v_company
        AND c.station_id = p_station_id AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'loyaltyTransactions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'stationId', t.station_id, 'cardId', t.card_id,
      'washId', t.wash_id, 'kind', t.kind, 'pointsDelta', t.points_delta,
      'reason', t.reason, 'createdAt', t.created_at
    ) ORDER BY t.created_at DESC) FROM public.loyalty_transactions t
      WHERE t.company_id = v_company
        AND t.station_id = p_station_id AND public.can_access_station(t.station_id)), '[]'::jsonb),
    'packagePlans', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'stationId', p.station_id, 'name', p.name,
      'description', p.description, 'priceMinor', p.price_minor,
      'washCount', p.wash_count, 'validityDays', p.validity_days,
      'startsAt', p.starts_at, 'endsAt', p.ends_at, 'active', p.active,
      'createdAt', p.created_at
    ) ORDER BY p.name) FROM public.packages p
      WHERE p.company_id = v_company
        AND p.deleted_at IS NULL AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'customerPackages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'customerId', c.customer_id,
      'packageId', c.package_id, 'purchasedAt', c.purchased_at,
      'expiresAt', c.expires_at, 'washesRemaining', c.washes_remaining,
      'status', c.status, 'createdAt', c.created_at
    ) ORDER BY c.expires_at, c.created_at) FROM public.customer_packages c
      WHERE c.company_id = v_company
        AND c.station_id = p_station_id AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'packageUsages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', u.id, 'stationId', u.station_id,
      'customerPackageId', u.customer_package_id, 'washId', u.wash_id,
      'createdAt', u.created_at
    ) ORDER BY u.created_at DESC) FROM public.package_usages u
      WHERE u.company_id = v_company
        AND u.station_id = p_station_id AND public.can_access_station(u.station_id)), '[]'::jsonb),
    'promotions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'stationId', p.station_id, 'name', p.name, 'code', p.code,
      'kind', p.kind, 'value', p.value, 'minAmountMinor', p.min_amount_minor,
      'maxUsages', p.max_usages, 'usageCount', p.usage_count,
      'startsAt', p.starts_at, 'endsAt', p.ends_at, 'active', p.active,
      'createdAt', p.created_at
    ) ORDER BY p.code) FROM public.promotions p
      WHERE p.company_id = v_company
        AND p.deleted_at IS NULL AND p.station_id = p_station_id AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'promotionUsages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', u.id, 'stationId', u.station_id, 'promotionId', u.promotion_id,
      'washId', u.wash_id, 'customerId', u.customer_id,
      'discountMinor', u.discount_minor, 'createdAt', u.created_at
    ) ORDER BY u.created_at DESC) FROM public.promotion_usages u
      WHERE u.company_id = v_company
        AND u.station_id = p_station_id AND public.can_access_station(u.station_id)), '[]'::jsonb),
    'fleets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'stationId', f.station_id, 'name', f.name,
      'contactName', f.contact_name, 'phone', f.phone, 'email', f.email,
      'creditLimitMinor', f.credit_limit_minor, 'preferredChannel', f.preferred_channel,
      'active', f.active, 'createdAt', f.created_at
    ) ORDER BY f.name) FROM public.fleets f
      WHERE f.company_id = v_company
        AND f.deleted_at IS NULL AND f.station_id = p_station_id AND public.can_access_station(f.station_id)), '[]'::jsonb),
    'fleetContracts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'fleetId', c.fleet_id,
      'number', c.number, 'startDate', c.start_date, 'endDate', c.end_date,
      'discountPercent', c.discount_percent, 'creditLimitMinor', c.credit_limit_minor,
      'status', c.status, 'createdAt', c.created_at
    ) ORDER BY c.number) FROM public.fleet_contracts c
      WHERE c.company_id = v_company
        AND c.station_id = p_station_id AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'fleetVehicles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'stationId', v.station_id, 'fleetId', v.fleet_id,
      'vehicleId', v.vehicle_id, 'contractId', v.contract_id,
      'active', v.active, 'createdAt', v.created_at
    ) ORDER BY v.created_at) FROM public.fleet_vehicles v
      WHERE v.company_id = v_company
        AND v.station_id = p_station_id AND public.can_access_station(v.station_id)), '[]'::jsonb),
    'fleetReceivables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'stationId', r.station_id, 'fleetId', r.fleet_id,
      'contractId', r.contract_id, 'washId', r.wash_id,
      'amountMinor', r.amount_minor, 'dueDate', r.due_date,
      'status', r.status, 'settledAt', r.settled_at, 'createdAt', r.created_at
    ) ORDER BY r.due_date, r.created_at) FROM public.fleet_receivables r
      WHERE r.company_id = v_company
        AND r.station_id = p_station_id AND public.can_access_station(r.station_id)), '[]'::jsonb),
    'notificationOutbox', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'stationId', n.station_id, 'customerId', n.customer_id,
      'fleetId', n.fleet_id, 'channel', n.channel,
      'templateKey', n.template_key, 'payload', n.payload,
      'status', n.status, 'createdAt', n.created_at, 'cancelledAt', n.cancelled_at
    ) ORDER BY n.created_at DESC) FROM public.notification_outbox n
      WHERE n.company_id = v_company
        AND n.station_id = p_station_id AND public.can_access_station(n.station_id)), '[]'::jsonb),
    'stats', jsonb_build_object(
      'clients', (SELECT count(*) FROM public.customers c
        WHERE c.company_id = v_company AND c.deleted_at IS NULL
          AND c.station_id = p_station_id AND public.can_access_station(c.station_id)),
      'vehicles', (SELECT count(*) FROM public.vehicles v
        WHERE v.company_id = v_company AND v.deleted_at IS NULL
          AND v.station_id = p_station_id AND public.can_access_station(v.station_id)),
      'activeCards', (SELECT count(*) FROM public.loyalty_cards c
        WHERE c.company_id = v_company AND c.status = 'active'
          AND c.station_id = p_station_id AND public.can_access_station(c.station_id)),
      'activePackages', (SELECT count(*) FROM public.customer_packages c
        WHERE c.company_id = v_company AND c.status = 'active'
          AND c.expires_at >= current_date AND c.station_id = p_station_id AND public.can_access_station(c.station_id)),
      'activePromotions', (SELECT count(*) FROM public.promotions p
        WHERE p.company_id = v_company AND p.active AND p.deleted_at IS NULL
          AND current_date BETWEEN p.starts_at AND p.ends_at
          AND p.station_id = p_station_id AND public.can_access_station(p.station_id)),
      'fleets', (SELECT count(*) FROM public.fleets f
        WHERE f.company_id = v_company AND f.deleted_at IS NULL
          AND f.station_id = p_station_id AND public.can_access_station(f.station_id)),
      'openReceivablesMinor', (SELECT COALESCE(SUM(r.amount_minor), 0) FROM public.fleet_receivables r
        WHERE r.company_id = v_company AND r.status = 'open'
          AND r.station_id = p_station_id AND public.can_access_station(r.station_id)),
      'pendingNotifications', (SELECT count(*) FROM public.notification_outbox n
        WHERE n.company_id = v_company AND n.status = 'pending'
          AND n.station_id = p_station_id AND public.can_access_station(n.station_id))
    ),
    'rules', jsonb_build_object(
      'provider', 'Aucun fournisseur connecte : la file reste en attente, aucun envoi simule.',
      'promotion', 'Une promotion par fiche, jamais apres encaissement, quota et validite verifies cote serveur.',
      'package', 'Achat dans la fenetre du forfait, consommation seulement avant expiration et une seule fois par fiche.',
      'loyalty', 'Points calcules sur le montant avant remise, transaction immuable et idempotente.',
      'tenant', 'Entreprise et station deduites du JWT : aucun identifiant de tenant cote navigateur.'
    )
  );
END $$;
-- Les attestations historiques n'indiquent pas leur périmètre : NULL signifie
-- « inconnu », jamais « toutes les stations ». Les nouvelles attestations
-- figent la liste exacte des stations au moment du calcul.
ALTER TABLE public.finance_cost_periods
  ADD COLUMN IF NOT EXISTS certification_station_ids uuid[];

CREATE OR REPLACE FUNCTION public.certify_profitability_period(
  p_start date, p_end date, p_attestation text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_station_ids uuid[];
  v_attestation text := btrim(COALESCE(p_attestation, ''));
  v_ambiguous integer; v_unvalued integer; v_draft integer;
  v_revenue bigint; v_consumptions bigint; v_operating bigint;
  v_commissions bigint; v_fixed bigint; v_gross bigint; v_result bigint;
  v_movement_count integer; v_valued_consumptions integer;
BEGIN
  IF NOT (public.has_permission('reports.view') AND public.has_permission('settings.manage')) THEN
    RAISE EXCEPTION 'Permissions reports.view + settings.manage requises' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Certification impossible sans entreprise rattachee' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
    OR p_end < p_start OR p_end - p_start > 366 OR length(v_attestation) < 15 THEN
    RAISE EXCEPTION 'Periode ou attestation invalide' USING ERRCODE = '23514';
  END IF;
  -- Une attestation « entreprise » doit couvrir toutes ses stations ; un
  -- rôle limité à une partie ne peut pas figer une période au nom des autres.
  SELECT array_agg(s.id ORDER BY s.id) INTO v_station_ids FROM public.stations s
    WHERE s.company_id = v_company AND s.deleted_at IS NULL;
  IF v_station_ids IS NULL OR EXISTS (SELECT 1 FROM unnest(v_station_ids) AS station(id)
    WHERE NOT public.can_access_station(station.id)) THEN
    RAISE EXCEPTION 'La certification exige l’accès à toutes les stations de l’entreprise' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_cost_periods
    WHERE company_id = v_company AND start_date = p_start AND end_date = p_end) THEN
    RAISE EXCEPTION 'Periode deja certifiee : relevé immuable' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_ambiguous FROM public.expenses e
  LEFT JOIN public.expense_categories c ON c.id = e.category_id
  WHERE e.company_id = v_company AND e.station_id = ANY(v_station_ids)
    AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
    AND COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NULL;
  SELECT count(*) INTO v_unvalued FROM public.stock_movements m
  WHERE m.company_id = v_company AND m.station_id = ANY(v_station_ids)
    AND m.created_at::date BETWEEN p_start AND p_end
    AND (
      (m.kind IN ('purchase_receipt', 'consumption') AND m.unit_cost_minor <= 0)
      OR (m.kind = 'inventory_adjustment' AND m.qty_delta > 0 AND m.unit_cost_minor <= 0)
    );
  SELECT count(*) INTO v_draft FROM public.commission_periods cp
  WHERE cp.company_id = v_company AND cp.station_id = ANY(v_station_ids)
    AND cp.status = 'draft' AND cp.period_start <= p_end AND cp.period_end >= p_start;
  IF v_ambiguous > 0 OR v_unvalued > 0 OR v_draft > 0 THEN
    RAISE EXCEPTION 'Couts incomplets : achats non rattaches %, mouvements non valorises %, periodes brouillon %',
      v_ambiguous, v_unvalued, v_draft USING ERRCODE = '23514';
  END IF;
  SELECT
    COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
      WHERE w.company_id = v_company AND w.station_id = ANY(v_station_ids)
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(-m.qty_delta * m.unit_cost_minor) FROM public.stock_movements m
      WHERE m.company_id = v_company AND m.station_id = ANY(v_station_ids)
        AND m.kind = 'consumption' AND m.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE e.company_id = v_company AND e.station_id = ANY(v_station_ids)
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND NOT (COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NOT NULL)), 0),
    COALESCE((SELECT SUM(ec.amount_minor) FROM public.employee_commissions ec
      JOIN public.commission_periods cp ON cp.id = ec.period_id
      WHERE ec.company_id = v_company AND ec.station_id = ANY(v_station_ids)
        AND cp.status IN ('validated', 'paid')
        AND ec.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE e.company_id = v_company AND e.station_id = ANY(v_station_ids)
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND NOT (COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NOT NULL)
        AND lower(COALESCE(c.name, '')) IN
          ('loyer', 'salaires', 'eau', 'electricite', 'électricité', 'assurance', 'abonnement')), 0)
  INTO v_revenue, v_consumptions, v_operating, v_commissions, v_fixed;
  SELECT count(*) INTO v_movement_count FROM public.stock_movements m
  WHERE m.company_id = v_company AND m.station_id = ANY(v_station_ids)
    AND m.created_at::date BETWEEN p_start AND p_end;
  SELECT count(*) INTO v_valued_consumptions FROM public.stock_movements m
  WHERE m.company_id = v_company AND m.station_id = ANY(v_station_ids)
    AND m.kind = 'consumption' AND m.unit_cost_minor > 0
    AND m.created_at::date BETWEEN p_start AND p_end;
  v_gross := v_revenue - v_consumptions;
  v_result := v_gross - v_operating - v_commissions;
  INSERT INTO public.finance_cost_periods (company_id, start_date, end_date, revenue_minor,
    consumption_cost_minor, operating_expense_minor, commission_cost_minor, fixed_cost_minor,
    gross_margin_minor, result_minor, stock_movement_count, valued_consumptions,
    attestation, certified_by, certification_station_ids)
  VALUES (v_company, p_start, p_end, v_revenue, v_consumptions, v_operating,
    v_commissions, v_fixed, v_gross, v_result, v_movement_count, v_valued_consumptions,
    v_attestation, auth.uid(), v_station_ids);
  RETURN jsonb_build_object(
    'certified', true, 'periodStart', p_start::text, 'periodEnd', p_end::text,
    'revenue', v_revenue, 'consumptions', v_consumptions,
    'operatingExpenses', v_operating, 'commissions', v_commissions,
    'grossMargin', v_gross, 'result', v_result, 'costsMissing', false,
    'label', 'Couts certifies : resultat net calculable'
  );
END $$;

-- Les attestations historiques sont rattachées à l'entreprise, sans liste
-- immuable des stations couvertes. Il serait faux de les distribuer à une
-- station (ou à un nouveau périmètre de stations). On expose les flux réels,
-- mais jamais de marge/résultat certifiés sur ce périmètre indéterminé.
CREATE OR REPLACE FUNCTION public.my_station_profitability(
  p_station_id uuid, p_start date, p_end date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_revenue bigint; v_collected bigint; v_receivables bigint; v_expenses bigint;
  v_purchases bigint; v_consumptions bigint; v_operating bigint;
  v_commissions bigint; v_fixed bigint;
  v_cert public.finance_cost_periods%ROWTYPE;
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF NOT public.has_permission('reports.view') THEN
    RAISE EXCEPTION 'Permission reports.view requise' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
    OR p_end < p_start OR p_end - p_start > 366 THEN
    RAISE EXCEPTION 'Période invalide : 366 jours maximum' USING ERRCODE = '23514';
  END IF;
  SELECT
    COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
      WHERE w.company_id = v_company AND w.station_id = p_station_id
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(p.amount_minor) FROM public.payments p
      WHERE p.company_id = v_company AND p.station_id = p_station_id
        AND p.created_at::date BETWEEN p_start AND p_end), 0)
      - COALESCE((SELECT SUM(pc.amount_minor) FROM public.payment_cancellations pc
        WHERE pc.company_id = v_company AND pc.station_id = p_station_id
          AND pc.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(GREATEST(w.total_minor - w.paid_minor, 0)) FROM public.washes w
      WHERE w.company_id = v_company AND w.station_id = p_station_id
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      WHERE e.company_id = v_company AND e.station_id = p_station_id
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(m.qty_delta * m.unit_cost_minor) FROM public.stock_movements m
      WHERE m.company_id = v_company AND m.station_id = p_station_id
        AND m.kind = 'purchase_receipt' AND m.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(-m.qty_delta * m.unit_cost_minor) FROM public.stock_movements m
      WHERE m.company_id = v_company AND m.station_id = p_station_id
        AND m.kind = 'consumption' AND m.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE e.company_id = v_company AND e.station_id = p_station_id
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND NOT (COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NOT NULL)), 0),
    COALESCE((SELECT SUM(ec.amount_minor) FROM public.employee_commissions ec
      JOIN public.commission_periods cp ON cp.id = ec.period_id
      WHERE ec.company_id = v_company AND ec.station_id = p_station_id
        AND cp.status IN ('validated', 'paid') AND ec.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE e.company_id = v_company AND e.station_id = p_station_id
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND NOT (COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NOT NULL)
        AND lower(COALESCE(c.name, '')) IN
          ('loyer','salaires','eau','electricite','électricité','assurance','abonnement')), 0)
  INTO v_revenue, v_collected, v_receivables, v_expenses, v_purchases,
       v_consumptions, v_operating, v_commissions, v_fixed;
  -- Une attestation entreprise ne certifie une station que si cette station
  -- était l'unique élément de son périmètre immuable.
  SELECT * INTO v_cert FROM public.finance_cost_periods
    WHERE company_id = v_company AND start_date = p_start AND end_date = p_end
      AND certification_station_ids = ARRAY[p_station_id];
  RETURN jsonb_build_object(
    'stationId', p_station_id, 'periodStart', p_start::text, 'periodEnd', p_end::text,
    'revenue', COALESCE(v_cert.revenue_minor, v_revenue), 'collected', v_collected, 'receivables', v_receivables,
    'expenses', v_expenses, 'purchases', v_purchases, 'consumptions', COALESCE(v_cert.consumption_cost_minor, v_consumptions),
    'operatingExpenses', COALESCE(v_cert.operating_expense_minor, v_operating),
    'commissions', COALESCE(v_cert.commission_cost_minor, v_commissions), 'fixedCosts', COALESCE(v_cert.fixed_cost_minor, v_fixed),
    'partialBalance', v_collected - v_expenses, 'grossMargin', v_cert.gross_margin_minor, 'result', v_cert.result_minor,
    'costsMissing', v_cert.id IS NULL, 'certified', v_cert.id IS NOT NULL,
    'certifiedAt', v_cert.certified_at, 'attestation', v_cert.attestation,
    'label', CASE WHEN v_cert.id IS NOT NULL THEN 'Coûts certifiés sur cette station' ELSE 'Attestation par station indisponible : résultat net non calculable' END,
    'missing', CASE WHEN v_cert.id IS NOT NULL THEN '[]'::jsonb ELSE jsonb_build_array('Attestation des coûts et du périmètre de cette station') END,
    'definitions', jsonb_build_object(
      'revenue', 'Total des fiches non annulées créées sur la période',
      'collected', 'Paiements de la période moins annulations de la période',
      'receivables', 'Reste dû actuel des fiches créées sur la période',
      'purchases', 'Acquisitions de stock, pas une charge de période',
      'consumptions', 'Consommations valorisées sur la période',
      'operatingExpenses', 'Charges hors achats de stock rattachés',
      'partialBalance', 'Encaissé net moins dépenses : PAS un bénéfice net',
      'grossMargin', 'Marge brute figée dans l’attestation',
      'result', 'Résultat net figé dans l’attestation pour ce périmètre'
    )
  );
END $$;

-- Agrégats sans limite de 200 fiches. Les montants sont regroupés selon la
-- date de paiement / d'annulation, et non selon la date de la fiche.
CREATE OR REPLACE FUNCTION public.my_station_metrics(
  p_station_id uuid, p_start date, p_end date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_finance boolean;
  v_trend jsonb; v_methods jsonb; v_day_methods jsonb; v_services jsonb; v_employees jsonb; v_clients jsonb;
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
    OR p_end < p_start OR p_end - p_start > 92 THEN
    RAISE EXCEPTION 'Période invalide : 92 jours maximum' USING ERRCODE = '23514';
  END IF;
  v_finance := public.has_permission('reports.view') OR public.has_permission('cash.open')
    OR public.has_permission('expenses.create') OR public.has_permission('commissions.view');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', d.day::date::text,
    'revenue', COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
      WHERE w.company_id = v_company AND w.station_id = p_station_id
        AND w.deleted_at IS NULL AND w.status <> 'cancelled' AND w.created_at::date = d.day::date), 0),
    'washCount', COALESCE((SELECT count(*) FROM public.washes w
      WHERE w.company_id = v_company AND w.station_id = p_station_id
        AND w.deleted_at IS NULL AND w.status <> 'cancelled' AND w.created_at::date = d.day::date), 0),
    'finishedCount', COALESCE((SELECT count(*) FROM public.washes w
      WHERE w.company_id = v_company AND w.station_id = p_station_id
        AND w.deleted_at IS NULL AND w.status IN ('ready','delivered') AND w.created_at::date = d.day::date), 0),
    'collected', CASE WHEN v_finance THEN
      COALESCE((SELECT SUM(p.amount_minor) FROM public.payments p
        WHERE p.company_id = v_company AND p.station_id = p_station_id AND p.created_at::date = d.day::date), 0)
      - COALESCE((SELECT SUM(c.amount_minor) FROM public.payment_cancellations c
        WHERE c.company_id = v_company AND c.station_id = p_station_id AND c.created_at::date = d.day::date), 0)
      ELSE NULL END,
    'expenses', CASE WHEN v_finance THEN
      COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
        WHERE e.company_id = v_company AND e.station_id = p_station_id
          AND e.status = 'recorded' AND e.spent_at = d.day::date), 0)
      ELSE NULL END
  ) ORDER BY d.day), '[]'::jsonb) INTO v_trend
  FROM generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') d(day);

  IF v_finance THEN
    WITH entries AS (
      SELECT public.payment_method_ui_key(pm.key) AS method, p.amount_minor AS amount, 1 AS n
      FROM public.payments p JOIN public.payment_methods pm ON pm.id = p.payment_method_id
      WHERE p.company_id = v_company AND p.station_id = p_station_id
        AND p.created_at::date BETWEEN p_start AND p_end
      UNION ALL
      SELECT public.payment_method_ui_key(pm.key), -c.amount_minor, 0
      FROM public.payment_cancellations c JOIN public.payments p ON p.id = c.payment_id
      JOIN public.payment_methods pm ON pm.id = p.payment_method_id
      WHERE c.company_id = v_company AND c.station_id = p_station_id
        AND c.created_at::date BETWEEN p_start AND p_end
    ), totals AS (
      SELECT method, SUM(amount) AS amount, SUM(n) AS n FROM entries GROUP BY method
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('method', method, 'amount', amount, 'count', n)
      ORDER BY amount DESC, method), '[]'::jsonb) INTO v_methods FROM totals;
    WITH entries AS (
      SELECT p.created_at::date AS day, public.payment_method_ui_key(pm.key) AS method, p.amount_minor AS amount, 1 AS n
      FROM public.payments p JOIN public.payment_methods pm ON pm.id = p.payment_method_id
      WHERE p.company_id = v_company AND p.station_id = p_station_id AND p.created_at::date BETWEEN p_start AND p_end
      UNION ALL
      SELECT c.created_at::date, public.payment_method_ui_key(pm.key), -c.amount_minor, 0
      FROM public.payment_cancellations c JOIN public.payments p ON p.id = c.payment_id
      JOIN public.payment_methods pm ON pm.id = p.payment_method_id
      WHERE c.company_id = v_company AND c.station_id = p_station_id AND c.created_at::date BETWEEN p_start AND p_end
    ), totals AS (SELECT day, method, SUM(amount) AS amount, SUM(n) AS n FROM entries GROUP BY day, method)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day::text, 'method', method, 'amount', amount, 'count', n)
      ORDER BY day, method), '[]'::jsonb) INTO v_day_methods FROM totals;
  ELSE
    v_methods := '[]'::jsonb;
    v_day_methods := '[]'::jsonb;
  END IF;

  WITH totals AS (
    SELECT i.service_id, i.service_name AS name, SUM(i.qty) AS qty,
      SUM(i.unit_price_minor * i.qty) AS revenue
    FROM public.wash_items i JOIN public.washes w ON w.id = i.wash_id
    WHERE w.company_id = v_company AND w.station_id = p_station_id
      AND w.deleted_at IS NULL AND w.status <> 'cancelled' AND w.created_at::date BETWEEN p_start AND p_end
    GROUP BY i.service_id, i.service_name
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', qty, 'revenue', revenue)
      ORDER BY qty DESC, name), '[]'::jsonb) INTO v_services FROM totals;

  WITH totals AS (
    SELECT a.user_id, COALESCE(u.full_name, 'Non affecté') AS name,
      count(*) AS n, SUM(w.total_minor) AS revenue
    FROM public.washes w
    LEFT JOIN LATERAL (SELECT x.user_id FROM public.wash_assignments x
      WHERE x.wash_id = w.id AND x.unassigned_at IS NULL ORDER BY x.assigned_at LIMIT 1) a ON true
    LEFT JOIN public.user_profiles u ON u.id = a.user_id
    WHERE w.company_id = v_company AND w.station_id = p_station_id
      AND w.deleted_at IS NULL AND w.status <> 'cancelled' AND w.created_at::date BETWEEN p_start AND p_end
    GROUP BY a.user_id, u.full_name
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('id', COALESCE(user_id::text, ''),
      'name', name, 'count', n, 'revenue', revenue) ORDER BY revenue DESC, name), '[]'::jsonb)
    INTO v_employees FROM totals;

  WITH totals AS (
    SELECT w.customer_id, COALESCE(c.name, w.customer_name, 'Client') AS name,
      count(*) AS n, SUM(w.total_minor) AS revenue
    FROM public.washes w LEFT JOIN public.customers c ON c.id = w.customer_id
    WHERE w.company_id = v_company AND w.station_id = p_station_id AND w.customer_id IS NOT NULL
      AND w.deleted_at IS NULL AND w.status <> 'cancelled' AND w.created_at::date BETWEEN p_start AND p_end
    GROUP BY w.customer_id, COALESCE(c.name, w.customer_name, 'Client')
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', n, 'revenue', revenue)
      ORDER BY revenue DESC, name), '[]'::jsonb) INTO v_clients FROM totals;
  -- Détail nominatif réservé aux personnes ayant accès aux rapports.
  RETURN jsonb_build_object('stationId', p_station_id, 'periodStart', p_start::text,
    'periodEnd', p_end::text, 'financeAvailable', v_finance, 'trend', v_trend,
    'byMethod', v_methods, 'byDayMethod', v_day_methods,
    'topServices', CASE WHEN public.has_permission('reports.view') THEN v_services ELSE '[]'::jsonb END,
    'byEmployee', CASE WHEN public.has_permission('reports.view') THEN v_employees ELSE '[]'::jsonb END,
    'bestClients', CASE WHEN public.has_permission('reports.view') THEN v_clients ELSE '[]'::jsonb END);
END $$;

-- Les totaux consolidés doivent être exactement la somme des stations visibles,
-- même si une ancienne attestation entreprise existe ou si l'accès a changé.
CREATE OR REPLACE FUNCTION public.my_accessible_profitability(p_start date, p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_station record; v_row jsonb;
  v_revenue bigint := 0; v_collected bigint := 0; v_receivables bigint := 0;
  v_expenses bigint := 0; v_purchases bigint := 0; v_consumptions bigint := 0;
  v_operating bigint := 0; v_commissions bigint := 0; v_fixed bigint := 0;
  v_station_ids uuid[]; v_cert public.finance_cost_periods%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT public.has_permission('reports.view') THEN
    RAISE EXCEPTION 'Permission reports.view requise' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
    OR p_end < p_start OR p_end - p_start > 366 THEN
    RAISE EXCEPTION 'Période invalide' USING ERRCODE = '23514';
  END IF;
  FOR v_station IN SELECT id FROM public.stations
    WHERE company_id = v_company AND deleted_at IS NULL AND public.can_access_station(id)
  LOOP
    v_row := public.my_station_profitability(v_station.id, p_start, p_end);
    v_revenue := v_revenue + (v_row->>'revenue')::bigint;
    v_collected := v_collected + (v_row->>'collected')::bigint;
    v_receivables := v_receivables + (v_row->>'receivables')::bigint;
    v_expenses := v_expenses + (v_row->>'expenses')::bigint;
    v_purchases := v_purchases + (v_row->>'purchases')::bigint;
    v_consumptions := v_consumptions + (v_row->>'consumptions')::bigint;
    v_operating := v_operating + (v_row->>'operatingExpenses')::bigint;
    v_commissions := v_commissions + (v_row->>'commissions')::bigint;
    v_fixed := v_fixed + (v_row->>'fixedCosts')::bigint;
  END LOOP;
  SELECT array_agg(id ORDER BY id) INTO v_station_ids FROM public.stations
    WHERE company_id = v_company AND deleted_at IS NULL AND public.can_access_station(id);
  SELECT * INTO v_cert FROM public.finance_cost_periods
    WHERE company_id = v_company AND start_date = p_start AND end_date = p_end
      AND certification_station_ids = v_station_ids;
  RETURN jsonb_build_object(
    'periodStart', p_start::text, 'periodEnd', p_end::text,
    'revenue', COALESCE(v_cert.revenue_minor, v_revenue), 'collected', v_collected, 'receivables', v_receivables,
    'expenses', v_expenses, 'purchases', v_purchases, 'consumptions', COALESCE(v_cert.consumption_cost_minor, v_consumptions),
    'operatingExpenses', COALESCE(v_cert.operating_expense_minor, v_operating),
    'commissions', COALESCE(v_cert.commission_cost_minor, v_commissions), 'fixedCosts', COALESCE(v_cert.fixed_cost_minor, v_fixed),
    'partialBalance', v_collected - v_expenses, 'grossMargin', v_cert.gross_margin_minor, 'result', v_cert.result_minor,
    'costsMissing', v_cert.id IS NULL, 'certified', v_cert.id IS NOT NULL,
    'certifiedAt', v_cert.certified_at, 'attestation', v_cert.attestation,
    'label', CASE WHEN v_cert.id IS NOT NULL THEN 'Coûts certifiés sur les stations accessibles' ELSE 'Périmètre de certification non conservé ou différent : résultat net non calculable' END,
    'missing', CASE WHEN v_cert.id IS NOT NULL THEN '[]'::jsonb ELSE jsonb_build_array('Attestation avec périmètre de stations immuable') END,
    'definitions', jsonb_build_object(
      'revenue', 'Total des fiches non annulées des stations accessibles',
      'collected', 'Paiements moins annulations de la période',
      'receivables', 'Reste dû des fiches créées sur la période',
      'partialBalance', 'Encaissé net moins dépenses : PAS un bénéfice net',
      'consumptions', 'Consommations valorisées sur la période',
      'grossMargin', 'Marge brute figée dans l’attestation',
      'result', 'Résultat net figé dans l’attestation pour ce périmètre'
    )
  );
END $$;

-- Les anciens clients ne doivent pas réutiliser une attestation de périmètre
-- inconnu ni exposer le résultat d'autres stations après retrait d'accès.
CREATE OR REPLACE FUNCTION public.my_profitability(
  p_start date DEFAULT (date_trunc('month', now()))::date,
  p_end date DEFAULT current_date
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.my_accessible_profitability(p_start, p_end)
$$;

CREATE OR REPLACE FUNCTION public.my_accessible_analytics_board(
  p_start date DEFAULT (date_trunc('month', now()))::date,
  p_end date DEFAULT current_date,
  p_compare_start date DEFAULT NULL,
  p_compare_end date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_period jsonb;
  v_compare jsonb := NULL;
  v_defs jsonb;
  v_stations jsonb := '[]'::jsonb;
  v_rankings jsonb := '[]'::jsonb;
  v_trend jsonb := '[]'::jsonb;
  v_stats jsonb;
  v_delta bigint;
BEGIN
  IF v_user IS NULL OR NOT (public.has_permission('analytics.view')
    AND public.has_permission('reports.view')) THEN
    RAISE EXCEPTION 'Permissions analytics.view et reports.view requises' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 92 THEN
    RAISE EXCEPTION 'Periode invalide : 92 jours maximum' USING ERRCODE = '23514';
  END IF;
  IF (p_compare_start IS NULL AND p_compare_end IS NOT NULL)
    OR (p_compare_start IS NOT NULL AND p_compare_end IS NULL) THEN
    RAISE EXCEPTION 'Periode de comparaison incomplete' USING ERRCODE = '23514';
  END IF;
  IF p_compare_start IS NOT NULL AND (p_compare_end < p_compare_start OR p_compare_end - p_compare_start > 92) THEN
    RAISE EXCEPTION 'Periode de comparaison inversee' USING ERRCODE = '23514';
  END IF;

  v_period := public.my_accessible_profitability(p_start, p_end);
  v_defs := COALESCE(v_period->'definitions', '{}'::jsonb);
  IF p_compare_start IS NOT NULL THEN
    v_compare := public.my_accessible_profitability(p_compare_start, p_compare_end);
    v_delta := COALESCE((v_period->>'revenue')::bigint, 0)
      - COALESCE((v_compare->>'revenue')::bigint, 0);
  END IF;

  WITH station_metrics AS (
    SELECT s.id, s.name, s.city,
      COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
        WHERE w.station_id = s.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
          AND w.created_at::date BETWEEN p_start AND p_end), 0) AS revenue,
      COALESCE((SELECT SUM(p.amount_minor) FROM public.payments p
        WHERE p.station_id = s.id AND p.created_at::date BETWEEN p_start AND p_end), 0)
      - COALESCE((SELECT SUM(pc.amount_minor) FROM public.payment_cancellations pc
        WHERE pc.station_id = s.id AND pc.created_at::date BETWEEN p_start AND p_end), 0) AS collected,
      COALESCE((SELECT SUM(GREATEST(w.total_minor - w.paid_minor, 0)) FROM public.washes w
        WHERE w.station_id = s.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
          AND w.created_at::date BETWEEN p_start AND p_end), 0) AS receivables,
      COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
        WHERE e.station_id = s.id AND e.status = 'recorded'
          AND e.spent_at BETWEEN p_start AND p_end), 0) AS expenses,
      COALESCE((SELECT SUM(-m.qty_delta * m.unit_cost_minor) FROM public.stock_movements m
        WHERE m.station_id = s.id AND m.kind = 'consumption'
          AND m.created_at::date BETWEEN p_start AND p_end), 0) AS consumptions,
      COALESCE((SELECT count(*) FROM public.washes w
        WHERE w.station_id = s.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
          AND w.created_at::date BETWEEN p_start AND p_end), 0) AS wash_count
    FROM public.stations s
    WHERE s.company_id = v_company
      AND s.deleted_at IS NULL
      AND public.can_access_station(s.id)
  ), ranked AS (
    SELECT *, row_number() OVER (ORDER BY revenue DESC, name) AS rank FROM station_metrics
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'rank', r.rank, 'stationId', r.id, 'name', r.name, 'city', r.city,
      'revenue', r.revenue, 'collected', r.collected, 'receivables', r.receivables,
      'expenses', r.expenses, 'consumptions', r.consumptions,
      'partialBalance', r.collected - r.expenses, 'washCount', r.wash_count,
      'grossMargin', NULL, 'result', NULL, 'certified', false
    ) ORDER BY r.rank), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'rank', r.rank, 'stationId', r.id, 'name', r.name,
      'revenue', r.revenue, 'washCount', r.wash_count, 'collected', r.collected
    ) ORDER BY r.rank), '[]'::jsonb)
  INTO v_stations, v_rankings
  FROM ranked r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', d.day::date::text,
    'revenue', COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
      WHERE w.company_id = v_company AND public.can_access_station(w.station_id)
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date = d.day::date), 0),
    'collected', COALESCE((SELECT SUM(p.amount_minor) FROM public.payments p
      WHERE p.company_id = v_company AND public.can_access_station(p.station_id)
        AND p.created_at::date = d.day::date), 0)
      - COALESCE((SELECT SUM(pc.amount_minor) FROM public.payment_cancellations pc
      WHERE pc.company_id = v_company AND public.can_access_station(pc.station_id)
        AND pc.created_at::date = d.day::date), 0),
    'expenses', COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      WHERE e.company_id = v_company AND public.can_access_station(e.station_id)
        AND e.status = 'recorded' AND e.spent_at = d.day::date), 0),
    'washCount', COALESCE((SELECT count(*) FROM public.washes w
      WHERE w.company_id = v_company AND public.can_access_station(w.station_id)
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date = d.day::date), 0)
  ) ORDER BY d.day), '[]'::jsonb)
  INTO v_trend
  FROM generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') AS d(day);

  v_stats := jsonb_build_object(
    'stations', jsonb_array_length(v_stations),
    'revenue', COALESCE((v_period->>'revenue')::bigint, 0),
    'collected', COALESCE((v_period->>'collected')::bigint, 0),
    'receivables', COALESCE((v_period->>'receivables')::bigint, 0),
    'partialBalance', COALESCE((v_period->>'partialBalance')::bigint, 0),
    'washCount', COALESCE((SELECT SUM((x->>'washCount')::integer)
      FROM jsonb_array_elements(v_trend) AS x), 0),
    'certified', COALESCE((v_period->>'certified')::boolean, false),
    'compareDelta', v_delta
  );

  RETURN jsonb_build_object(
    'periodStart', p_start::text, 'periodEnd', p_end::text,
    'compareStart', p_compare_start::text, 'compareEnd', p_compare_end::text,
    'period', v_period, 'compare', v_compare, 'compareDelta', v_delta,
    'stations', v_stations, 'rankings', v_rankings, 'trend', v_trend,
    'definitions', v_defs, 'stats', v_stats,
    'rules', jsonb_build_object(
      'netResult', 'Aucun résultat net sans attestation au périmètre de stations immuable',
      'comparison', 'Comparaison avec les memes definitions metier',
      'stations', 'Classement par chiffre d affaires, jamais par benefice net',
      'pricing', 'Tarifs 0 / 15000 / 35000 FCFA : hypotheses commerciales administrables'
    )
  );
END $$;

-- L'ancienne RPC reste compatible mais ne doit plus divulguer les lignes de
-- paie aux utilisateurs qui n'ont que cash.open. Elle consolide uniquement
-- les stations accessibles et applique les mêmes permissions par collection.
CREATE OR REPLACE FUNCTION public.my_finance_board() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_station record; v_board jsonb;
  v_key text; v_result jsonb := jsonb_build_object(
    'paymentMethods','[]'::jsonb,'cashSessions','[]'::jsonb,'cashMovements','[]'::jsonb,
    'cashClosures','[]'::jsonb,'expenses','[]'::jsonb,'reconciliations','[]'::jsonb,
    'commissionPeriods','[]'::jsonb,'commissionLines','[]'::jsonb,'commissionPayouts','[]'::jsonb,
    'paymentCancellations','[]'::jsonb);
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT (
    public.has_permission('reports.view') OR public.has_permission('cash.open')
    OR public.has_permission('cash.close') OR public.has_permission('cash.reopen')
    OR public.has_permission('expenses.create') OR public.has_permission('expenses.cancel')
    OR public.has_permission('commissions.view')) THEN
    RAISE EXCEPTION 'Permission finance requise' USING ERRCODE = '42501';
  END IF;
  FOR v_station IN SELECT id FROM public.stations WHERE company_id = v_company
    AND deleted_at IS NULL AND public.can_access_station(id)
  LOOP
    v_board := public.my_station_finance_board(v_station.id);
    FOR v_key IN SELECT jsonb_object_keys(v_result) LOOP
      v_result := jsonb_set(v_result, ARRAY[v_key], (v_result->v_key) || (v_board->v_key));
    END LOOP;
  END LOOP;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.my_finance_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_finance_board() TO authenticated;

-- Révoquer explicitement PUBLIC et anon ; les RPC existantes restent intactes.
REVOKE ALL ON FUNCTION public.my_station_assignable_users(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_station_clients(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_station_wash_posts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_station_wash_board(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_station_finance_board(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_station_stock_board(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_station_crm_board(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_station_profitability(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_station_metrics(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_accessible_profitability(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_accessible_analytics_board(date, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_station_assignable_users(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_station_clients(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_station_wash_posts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_station_wash_board(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_station_finance_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_station_stock_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_station_crm_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_station_profitability(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_station_metrics(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_accessible_profitability(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_accessible_analytics_board(date, date, date, date) TO authenticated;
