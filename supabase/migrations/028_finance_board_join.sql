-- 028 — Prompt 06 : correction de la jointure `closed_by` de la projection
-- agrégée. La version distante de 027 utilisait par erreur l'alias `u` au lieu
-- de `u2` ; ce correctif est idempotent (rejouable depuis une base neuve).

DO $$
DECLARE
  v_old text := pg_get_functiondef('public.my_finance_board()'::regprocedure);
  v_new text := replace(
    v_old,
    'LEFT JOIN public.user_profiles u2 ON u.id = cs.closed_by',
    'LEFT JOIN public.user_profiles u2 ON u2.id = cs.closed_by'
  );
BEGIN
  IF v_new IS DISTINCT FROM v_old THEN
    EXECUTE v_new;
  END IF;
END $$;
