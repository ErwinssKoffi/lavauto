-- 022 — Prompt 05 : lectures serveur du tableau de bord des lavages
-- Le frontend ne reçoit aucun company_id : les fonctions dérivent le tenant
-- du JWT, appliquent la portée station et projettent directement les clés UI.

CREATE OR REPLACE FUNCTION public.my_wash_posts() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Aucune entreprise rattachée à ce compte' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'capacity', p.capacity, 'active', p.active
  ) ORDER BY p.name), '[]'::jsonb)
  INTO v_result
  FROM public.wash_posts p
  WHERE (p.company_id = v_company OR public.is_platform_admin())
    AND public.can_access_station(p.station_id) AND p.deleted_at IS NULL;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.my_wash_board() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Aucune entreprise rattachée à ce compte' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(q.w ORDER BY q.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT w.created_at, jsonb_build_object(
      'id', w.id,
      'stationId', w.station_id,
      'number', w.number,
      'clientId', w.customer_id,
      'clientName', w.customer_name,
      'vehicleCategoryId', w.vehicle_category_id,
      'vehicleLabel', w.vehicle_label,
      'plate', w.plate,
      'employeeId', COALESCE((
        SELECT a.user_id::text FROM public.wash_assignments a
        WHERE a.wash_id = w.id AND a.unassigned_at IS NULL ORDER BY a.assigned_at LIMIT 1
      ), ''),
      'assignedUserIds', COALESCE((
        SELECT jsonb_agg(a.user_id::text ORDER BY a.assigned_at) FROM public.wash_assignments a
        WHERE a.wash_id = w.id AND a.unassigned_at IS NULL
      ), '[]'::jsonb),
      'postId', (
        SELECT a.post_id::text FROM public.wash_assignments a
        WHERE a.wash_id = w.id AND a.unassigned_at IS NULL AND a.post_id IS NOT NULL
        ORDER BY a.assigned_at LIMIT 1
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'serviceId', i.service_id, 'serviceName', i.service_name,
          'unitPrice', i.unit_price_minor, 'qty', i.qty
        ) ORDER BY i.created_at) FROM public.wash_items i WHERE i.wash_id = w.id
      ), '[]'::jsonb),
      'discount', w.discount_minor,
      'total', w.total_minor,
      'paid', w.paid_minor,
      'status', w.status,
      'createdAt', w.created_at,
      'finishedAt', w.finished_at,
      'cancelledReason', w.cancelled_reason,
      'deliveredAt', w.delivered_at,
      'payments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', pay.id, 'amount', pay.amount_minor,
          'method', CASE pm.key
            WHEN 'cash' THEN 'especes'
            WHEN 'mobile_money' THEN 'mobile_money'
            WHEN 'card' THEN 'carte'
            WHEN 'transfer' THEN 'virement'
            ELSE 'mobile_money' END,
          'at', pay.created_at, 'byUserId', pay.created_by
        ) ORDER BY pay.created_at)
        FROM public.payments pay LEFT JOIN public.payment_methods pm ON pm.id = pay.payment_method_id
        WHERE pay.wash_id = w.id
      ), '[]'::jsonb),
      'history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', h.id, 'fromStatus', h.from_status, 'toStatus', h.to_status,
          'reason', h.reason, 'at', h.created_at, 'actorUserId', h.actor_user_id
        ) ORDER BY h.created_at) FROM public.wash_status_history h WHERE h.wash_id = w.id
      ), '[]'::jsonb),
      'qualityResult', (
        SELECT q.result FROM public.wash_quality_checks q
        WHERE q.wash_id = w.id ORDER BY q.checked_at DESC LIMIT 1
      ),
      'qualityNotes', (
        SELECT q.notes FROM public.wash_quality_checks q
        WHERE q.wash_id = w.id ORDER BY q.checked_at DESC LIMIT 1
      )
    ) AS w
    FROM public.washes w
    WHERE (w.company_id = v_company OR public.is_platform_admin())
      AND public.can_access_station(w.station_id) AND w.deleted_at IS NULL
    ORDER BY w.created_at DESC
    LIMIT 200
  ) q;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.my_vehicle_history(p_plate text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plate text := upper(btrim(COALESCE(p_plate,''))); v_result jsonb;
BEGIN
  IF v_plate = '' THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(t.w ORDER BY t.w->>'createdAt' DESC), '[]'::jsonb)
  INTO v_result
  FROM jsonb_array_elements(public.my_wash_board()) AS t(w)
  WHERE upper(COALESCE(t.w->>'plate','')) = v_plate;
  RETURN v_result;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('my_wash_posts','my_wash_board','my_vehicle_history')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
