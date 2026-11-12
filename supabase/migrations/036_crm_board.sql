-- 036 — Prompt 08 : projection CRM serveur, camelCase, sans identifiant de tenant.
-- Aucune donnée fabriquée, aucune écriture, aucun envoi de notification.
CREATE OR REPLACE FUNCTION public.my_crm_board() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
BEGIN
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
      WHERE (c.company_id = v_company OR v_admin)
        AND c.deleted_at IS NULL AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'vehicles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'stationId', v.station_id, 'customerId', v.customer_id,
      'categoryId', v.vehicle_category_id, 'plate', v.plate,
      'brand', v.brand, 'model', v.model, 'color', v.color,
      'fleetId', v.fleet_id, 'active', v.is_active, 'createdAt', v.created_at
    ) ORDER BY v.plate, v.created_at) FROM public.vehicles v
      WHERE (v.company_id = v_company OR v_admin)
        AND v.deleted_at IS NULL AND public.can_access_station(v.station_id)), '[]'::jsonb),
    'loyaltyPrograms', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'stationId', p.station_id, 'name', p.name,
      'pointsPer1000Minor', p.points_per_1000_minor,
      'redemptionThreshold', p.redemption_threshold, 'active', p.active,
      'createdAt', p.created_at
    ) ORDER BY p.name) FROM public.loyalty_programs p
      WHERE (p.company_id = v_company OR v_admin)
        AND p.deleted_at IS NULL AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'loyaltyCards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'customerId', c.customer_id,
      'programId', c.program_id, 'cardNumber', c.card_number,
      'pointsBalance', c.points_balance, 'status', c.status, 'createdAt', c.created_at
    ) ORDER BY c.card_number) FROM public.loyalty_cards c
      WHERE (c.company_id = v_company OR v_admin)
        AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'loyaltyTransactions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'stationId', t.station_id, 'cardId', t.card_id,
      'washId', t.wash_id, 'kind', t.kind, 'pointsDelta', t.points_delta,
      'reason', t.reason, 'createdAt', t.created_at
    ) ORDER BY t.created_at DESC) FROM public.loyalty_transactions t
      WHERE (t.company_id = v_company OR v_admin)
        AND public.can_access_station(t.station_id)), '[]'::jsonb),
    'packagePlans', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'stationId', p.station_id, 'name', p.name,
      'description', p.description, 'priceMinor', p.price_minor,
      'washCount', p.wash_count, 'validityDays', p.validity_days,
      'startsAt', p.starts_at, 'endsAt', p.ends_at, 'active', p.active,
      'createdAt', p.created_at
    ) ORDER BY p.name) FROM public.packages p
      WHERE (p.company_id = v_company OR v_admin)
        AND p.deleted_at IS NULL AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'customerPackages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'customerId', c.customer_id,
      'packageId', c.package_id, 'purchasedAt', c.purchased_at,
      'expiresAt', c.expires_at, 'washesRemaining', c.washes_remaining,
      'status', c.status, 'createdAt', c.created_at
    ) ORDER BY c.expires_at, c.created_at) FROM public.customer_packages c
      WHERE (c.company_id = v_company OR v_admin)
        AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'packageUsages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', u.id, 'stationId', u.station_id,
      'customerPackageId', u.customer_package_id, 'washId', u.wash_id,
      'createdAt', u.created_at
    ) ORDER BY u.created_at DESC) FROM public.package_usages u
      WHERE (u.company_id = v_company OR v_admin)
        AND public.can_access_station(u.station_id)), '[]'::jsonb),
    'promotions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'stationId', p.station_id, 'name', p.name, 'code', p.code,
      'kind', p.kind, 'value', p.value, 'minAmountMinor', p.min_amount_minor,
      'maxUsages', p.max_usages, 'usageCount', p.usage_count,
      'startsAt', p.starts_at, 'endsAt', p.ends_at, 'active', p.active,
      'createdAt', p.created_at
    ) ORDER BY p.code) FROM public.promotions p
      WHERE (p.company_id = v_company OR v_admin)
        AND p.deleted_at IS NULL AND public.can_access_station(p.station_id)), '[]'::jsonb),
    'promotionUsages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', u.id, 'stationId', u.station_id, 'promotionId', u.promotion_id,
      'washId', u.wash_id, 'customerId', u.customer_id,
      'discountMinor', u.discount_minor, 'createdAt', u.created_at
    ) ORDER BY u.created_at DESC) FROM public.promotion_usages u
      WHERE (u.company_id = v_company OR v_admin)
        AND public.can_access_station(u.station_id)), '[]'::jsonb),
    'fleets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'stationId', f.station_id, 'name', f.name,
      'contactName', f.contact_name, 'phone', f.phone, 'email', f.email,
      'creditLimitMinor', f.credit_limit_minor, 'preferredChannel', f.preferred_channel,
      'active', f.active, 'createdAt', f.created_at
    ) ORDER BY f.name) FROM public.fleets f
      WHERE (f.company_id = v_company OR v_admin)
        AND f.deleted_at IS NULL AND public.can_access_station(f.station_id)), '[]'::jsonb),
    'fleetContracts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'fleetId', c.fleet_id,
      'number', c.number, 'startDate', c.start_date, 'endDate', c.end_date,
      'discountPercent', c.discount_percent, 'creditLimitMinor', c.credit_limit_minor,
      'status', c.status, 'createdAt', c.created_at
    ) ORDER BY c.number) FROM public.fleet_contracts c
      WHERE (c.company_id = v_company OR v_admin)
        AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'fleetVehicles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'stationId', v.station_id, 'fleetId', v.fleet_id,
      'vehicleId', v.vehicle_id, 'contractId', v.contract_id,
      'active', v.active, 'createdAt', v.created_at
    ) ORDER BY v.created_at) FROM public.fleet_vehicles v
      WHERE (v.company_id = v_company OR v_admin)
        AND public.can_access_station(v.station_id)), '[]'::jsonb),
    'fleetReceivables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'stationId', r.station_id, 'fleetId', r.fleet_id,
      'contractId', r.contract_id, 'washId', r.wash_id,
      'amountMinor', r.amount_minor, 'dueDate', r.due_date,
      'status', r.status, 'settledAt', r.settled_at, 'createdAt', r.created_at
    ) ORDER BY r.due_date, r.created_at) FROM public.fleet_receivables r
      WHERE (r.company_id = v_company OR v_admin)
        AND public.can_access_station(r.station_id)), '[]'::jsonb),
    'notificationOutbox', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'stationId', n.station_id, 'customerId', n.customer_id,
      'fleetId', n.fleet_id, 'channel', n.channel,
      'templateKey', n.template_key, 'payload', n.payload,
      'status', n.status, 'createdAt', n.created_at, 'cancelledAt', n.cancelled_at
    ) ORDER BY n.created_at DESC) FROM public.notification_outbox n
      WHERE (n.company_id = v_company OR v_admin)
        AND public.can_access_station(n.station_id)), '[]'::jsonb),
    'stats', jsonb_build_object(
      'clients', (SELECT count(*) FROM public.customers c
        WHERE (c.company_id = v_company OR v_admin) AND c.deleted_at IS NULL
          AND public.can_access_station(c.station_id)),
      'vehicles', (SELECT count(*) FROM public.vehicles v
        WHERE (v.company_id = v_company OR v_admin) AND v.deleted_at IS NULL
          AND public.can_access_station(v.station_id)),
      'activeCards', (SELECT count(*) FROM public.loyalty_cards c
        WHERE (c.company_id = v_company OR v_admin) AND c.status = 'active'
          AND public.can_access_station(c.station_id)),
      'activePackages', (SELECT count(*) FROM public.customer_packages c
        WHERE (c.company_id = v_company OR v_admin) AND c.status = 'active'
          AND c.expires_at >= current_date AND public.can_access_station(c.station_id)),
      'activePromotions', (SELECT count(*) FROM public.promotions p
        WHERE (p.company_id = v_company OR v_admin) AND p.active AND p.deleted_at IS NULL
          AND current_date BETWEEN p.starts_at AND p.ends_at
          AND public.can_access_station(p.station_id)),
      'fleets', (SELECT count(*) FROM public.fleets f
        WHERE (f.company_id = v_company OR v_admin) AND f.deleted_at IS NULL
          AND public.can_access_station(f.station_id)),
      'openReceivablesMinor', (SELECT COALESCE(SUM(r.amount_minor), 0) FROM public.fleet_receivables r
        WHERE (r.company_id = v_company OR v_admin) AND r.status = 'open'
          AND public.can_access_station(r.station_id)),
      'pendingNotifications', (SELECT count(*) FROM public.notification_outbox n
        WHERE (n.company_id = v_company OR v_admin) AND n.status = 'pending'
          AND public.can_access_station(n.station_id))
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

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'my_crm_board'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
