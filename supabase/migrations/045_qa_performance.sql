-- 045 — Prompt 10 : EXPLAIN, index complémentaires et pagination serveur.
-- Additif : aucune réécriture 001–044, aucune donnée de démonstration,
-- aucun compte, aucun secret, aucun fournisseur externe.
-- Les index ciblent les tris LIMIT/OFFSET des boards et des journaux.

CREATE INDEX IF NOT EXISTS ix_p10_washes_page
  ON public.washes (company_id, station_id, created_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_p10_payments_page
  ON public.payments (company_id, station_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS ix_p10_expenses_page
  ON public.expenses (company_id, station_id, spent_at DESC, id)
  WHERE status = 'recorded';

CREATE INDEX IF NOT EXISTS ix_p10_audit_page
  ON public.audit_logs (company_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS ix_p10_platform_audit_page
  ON public.platform_audit_logs (created_at DESC, id);

-- Pagination serveur : le tenant est relu depuis auth.uid(), jamais fourni
-- par le navigateur. La réponse est camelCase et sans identifiant brut.
CREATE OR REPLACE FUNCTION public.my_washes_page(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF v_user IS NULL OR NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_to < p_from THEN
    RAISE EXCEPTION 'Periode inversee' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.washes w
  WHERE w.deleted_at IS NULL
    AND (v_admin OR w.company_id = v_company)
    AND (p_from IS NULL OR w.created_at::date >= p_from)
    AND (p_to IS NULL OR w.created_at::date <= p_to)
    AND (p_status IS NULL OR w.status = p_status);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'washId', w.id,
    'number', w.number,
    'status', w.status,
    'total', w.total_minor,
    'paid', w.paid_minor,
    'createdAt', w.created_at,
    'stationId', w.station_id,
    'customerName', w.customer_name,
    'plate', w.plate
  ) ORDER BY w.created_at DESC, w.id), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT w.*
    FROM public.washes w
    WHERE w.deleted_at IS NULL
      AND (v_admin OR w.company_id = v_company)
      AND (p_from IS NULL OR w.created_at::date >= p_from)
      AND (p_to IS NULL OR w.created_at::date <= p_to)
      AND (p_status IS NULL OR w.status = p_status)
    ORDER BY w.created_at DESC, w.id
    LIMIT v_limit OFFSET v_offset
  ) w;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'hasMore', (v_offset + v_limit) < v_total,
    'rules', jsonb_build_object(
      'tenant', 'Entreprise relue depuis auth.uid(), jamais fournie par le navigateur',
      'pagination', 'LIMIT OFFSET cote serveur, 100 lignes maximum par page'
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.my_washes_page(integer, integer, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_washes_page(integer, integer, date, date, text) TO authenticated;
