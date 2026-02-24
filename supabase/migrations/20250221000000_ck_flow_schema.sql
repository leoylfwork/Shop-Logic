-- CK-Flow 2.0 — Postgres schema for Supabase
-- Aligned with SYSTEM_RULES.md and WORKFLOWS.md
-- Multi-tenant (shops), multi-role users, repair orders (mechanic/body), event logs, messages, bays, payments, attachments.

-- =============================================================================
-- Extensions (Supabase usually has these; enable if missing)
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 0. Helper: updated_at trigger function
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1. Shops (multi-tenant)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'shops_updated_at'
  ) THEN
    CREATE TRIGGER shops_updated_at
    BEFORE UPDATE ON public.shops
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- =============================================================================
-- 2. Profiles (extends auth.users; one role per user, one shop per user)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('advisor', 'foreman', 'owner')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_shop_id ON public.profiles(shop_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'profiles_updated_at'
  ) THEN
    CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- =============================================================================
-- 3. Vehicles (VIN cache and decoded data; optional normalization)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vin text NOT NULL,
  decoded_data jsonb,
  decoded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vin)
);

COMMENT ON COLUMN public.vehicles.decoded_data IS
'VIN decode: year, make, model, engine, trim, transmission, drivetrain, body_style, plant';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'vehicles_updated_at'
  ) THEN
    CREATE TRIGGER vehicles_updated_at
    BEFORE UPDATE ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- =============================================================================
-- 4. Bays (work slots per shop; work_type = MECHANIC or BODY)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.bays (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name text NOT NULL,
  work_type text NOT NULL CHECK (work_type IN ('MECHANIC', 'BODY')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bays_shop_work ON public.bays(shop_id, work_type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'bays_updated_at'
  ) THEN
    CREATE TRIGGER bays_updated_at
    BEFORE UPDATE ON public.bays
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- =============================================================================
-- 5. Repair Orders (central entity; mode = work_type; payment_status for History)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.repair_orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,

  work_type text NOT NULL CHECK (work_type IN ('MECHANIC', 'BODY')),

  status text NOT NULL CHECK (status IN (
    'TO_DO', 'PENDING', 'IN_PROGRESS', 'DONE',
    'BODY_WORK', 'PAINTING', 'FINISHING_UP', 'MECHANIC_WORK'
  )),

  is_insurance_case boolean NOT NULL DEFAULT false,

  payment_status text CHECK (payment_status IN ('paid', 'voided')),
  payment_method text CHECK (payment_method IN ('CASH', 'CHEQUE', 'ABANDONED')),
  payment_amount numeric(12, 2),
  settled_at timestamptz,

  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vin text NOT NULL DEFAULT '',

  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  info text NOT NULL DEFAULT '',

  urgent boolean NOT NULL DEFAULT false,
  mileage int,
  delivery_date date,

  bay_id uuid REFERENCES public.bays(id) ON DELETE SET NULL,
  last_entered_bay_at timestamptz,
  total_time_in_bay_ms bigint NOT NULL DEFAULT 0,

  order_index int NOT NULL DEFAULT 0,
  grid_position int,

  calendar_event_id text,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repair_orders_shop_work ON public.repair_orders(shop_id, work_type);
CREATE INDEX IF NOT EXISTS idx_repair_orders_status ON public.repair_orders(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_repair_orders_bay ON public.repair_orders(bay_id) WHERE bay_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repair_orders_settled ON public.repair_orders(settled_at) WHERE settled_at IS NOT NULL;

COMMENT ON COLUMN public.repair_orders.payment_status IS
'Scheme A: History = status=DONE AND payment_status IN (paid, voided). No ARCHIVED status.';
COMMENT ON COLUMN public.repair_orders.is_insurance_case IS
'Virtual INSURANCE column: filter WHERE is_insurance_case = true; same RO appears in status column too.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'repair_orders_updated_at'
  ) THEN
    CREATE TRIGGER repair_orders_updated_at
    BEFORE UPDATE ON public.repair_orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- =============================================================================
-- 5a. Cross-table integrity: bay must belong to same shop (trigger-based)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validate_ro_bay_same_shop()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow null
  IF NEW.bay_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Ensure bay exists and belongs to same shop
  IF NOT EXISTS (
    SELECT 1
    FROM public.bays b
    WHERE b.id = NEW.bay_id
      AND b.shop_id = NEW.shop_id
  ) THEN
    RAISE EXCEPTION 'Invalid bay_id: bay must belong to same shop_id'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_ro_bay_same_shop'
  ) THEN
    CREATE TRIGGER trg_validate_ro_bay_same_shop
    BEFORE INSERT OR UPDATE OF bay_id, shop_id ON public.repair_orders
    FOR EACH ROW EXECUTE FUNCTION public.validate_ro_bay_same_shop();
  END IF;
END $$;

-- =============================================================================
-- 6. Event Log (append-only, immutable; backend writes on every state change)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.event_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_order_id uuid NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('activity', 'diagnostic')),
  type text NOT NULL CHECK (type IN ('SYSTEM', 'USER', 'AI')),
  text text NOT NULL DEFAULT '',
  image_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_log_repair_order ON public.event_log(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_event_log_created ON public.event_log(repair_order_id, created_at);

COMMENT ON TABLE public.event_log IS
'Append-only. Backend writes on status change, bay assign, payment, attachment. entry_type: activity = operational log, diagnostic = AI chat.';

-- =============================================================================
-- 7. Messages (per repair order; realtime)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_order_id uuid NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_repair_order ON public.messages(repair_order_id);

-- =============================================================================
-- 8. Attachments (per repair order; file in Storage, metadata here for AI)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.attachments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_order_id uuid NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime_type text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'attachments',
  storage_path text NOT NULL,
  file_size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_repair_order ON public.attachments(repair_order_id);

COMMENT ON TABLE public.attachments IS
'Metadata only; files in Supabase Storage. storage_path e.g. {repair_order_id}/{id}_{name}. AI reads list + fetches via signed URL.';

-- =============================================================================
-- 8b. Storage bucket for attachments (Supabase Storage)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 9. History view (Scheme A: query only, no ARCHIVED status)
-- =============================================================================
CREATE OR REPLACE VIEW public.history_repair_orders AS
SELECT *
FROM public.repair_orders
WHERE status = 'DONE'
  AND payment_status IN ('paid', 'voided');

COMMENT ON VIEW public.history_repair_orders IS
'Scheme A: History = DONE + payment_status paid|voided. Frontend uses this for Archive/History view.';

-- =============================================================================
-- 10. Insurance “virtual column” (optional view for clarity)
-- =============================================================================
CREATE OR REPLACE VIEW public.insurance_repair_orders AS
SELECT *
FROM public.repair_orders
WHERE is_insurance_case = true;

COMMENT ON VIEW public.insurance_repair_orders IS
'Virtual INSURANCE column: same rows also appear under their actual status column.';

-- =============================================================================
-- 11. Row Level Security (RLS) — scope all by shop
-- =============================================================================
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- Helper: current user's shop_id (assumes profile exists for auth.uid())
CREATE OR REPLACE FUNCTION public.current_user_shop_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shop_id FROM public.profiles WHERE id = auth.uid()
$$;

-- Shops: user can only see their own shop
DROP POLICY IF EXISTS shops_select_own ON public.shops;
CREATE POLICY shops_select_own ON public.shops
  FOR SELECT USING (id = public.current_user_shop_id());

-- Profiles: same shop; user can insert/update own row (e.g. on signup)
DROP POLICY IF EXISTS profiles_select_own_shop ON public.profiles;
CREATE POLICY profiles_select_own_shop ON public.profiles
  FOR SELECT USING (shop_id = public.current_user_shop_id());

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- Vehicles: shared VIN cache; any authenticated user can read; insert/update for cache writes
DROP POLICY IF EXISTS vehicles_select ON public.vehicles;
CREATE POLICY vehicles_select ON public.vehicles
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS vehicles_insert ON public.vehicles;
CREATE POLICY vehicles_insert ON public.vehicles
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS vehicles_update ON public.vehicles;
CREATE POLICY vehicles_update ON public.vehicles
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Bays: by shop
DROP POLICY IF EXISTS bays_all_own_shop ON public.bays;
CREATE POLICY bays_all_own_shop ON public.bays
  FOR ALL USING (shop_id = public.current_user_shop_id());

-- Repair orders: by shop
DROP POLICY IF EXISTS repair_orders_all_own_shop ON public.repair_orders;
CREATE POLICY repair_orders_all_own_shop ON public.repair_orders
  FOR ALL USING (shop_id = public.current_user_shop_id());

-- Event log: via repair_order -> shop
DROP POLICY IF EXISTS event_log_select_own_shop ON public.event_log;
CREATE POLICY event_log_select_own_shop ON public.event_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.repair_orders ro
      WHERE ro.id = event_log.repair_order_id
        AND ro.shop_id = public.current_user_shop_id()
    )
  );

DROP POLICY IF EXISTS event_log_insert_own_shop ON public.event_log;
CREATE POLICY event_log_insert_own_shop ON public.event_log
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.repair_orders ro
      WHERE ro.id = event_log.repair_order_id
        AND ro.shop_id = public.current_user_shop_id()
    )
  );

-- Messages: via repair_order -> shop
DROP POLICY IF EXISTS messages_all_own_shop ON public.messages;
CREATE POLICY messages_all_own_shop ON public.messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.repair_orders ro
      WHERE ro.id = messages.repair_order_id
        AND ro.shop_id = public.current_user_shop_id()
    )
  );

-- Attachments: via repair_order -> shop
DROP POLICY IF EXISTS attachments_all_own_shop ON public.attachments;
CREATE POLICY attachments_all_own_shop ON public.attachments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.repair_orders ro
      WHERE ro.id = attachments.repair_order_id
        AND ro.shop_id = public.current_user_shop_id()
    )
  );

-- Storage RLS policies (NOTE: you must ENABLE RLS on storage.objects in Supabase UI if not already)
DROP POLICY IF EXISTS attachments_storage_select ON storage.objects;
CREATE POLICY attachments_storage_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'attachments'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.attachments a
      JOIN public.repair_orders ro ON ro.id = a.repair_order_id
      WHERE a.storage_path = storage.objects.name
        AND ro.shop_id = public.current_user_shop_id()
    )
  );

DROP POLICY IF EXISTS attachments_storage_insert ON storage.objects;
CREATE POLICY attachments_storage_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'attachments'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS attachments_storage_update ON storage.objects;
CREATE POLICY attachments_storage_update ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'attachments' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS attachments_storage_delete ON storage.objects;
CREATE POLICY attachments_storage_delete ON storage.objects
  FOR DELETE
  USING (bucket_id = 'attachments' AND auth.uid() IS NOT NULL);

-- =============================================================================
-- 12. Realtime (Supabase: enable for tables that need live updates)
-- =============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.repair_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attachments;

ALTER TABLE public.repair_orders REPLICA IDENTITY FULL;

-- =============================================================================
-- 14. Future: invoice compatibility
-- =============================================================================
-- Invoice can be added later without schema rewrite, e.g.:
--   invoices (id, repair_order_id, generated_at, ...)
--   invoice_lines (id, invoice_id, description, amount, ...)
-- Event log is append-only and can drive line items (labor, parts) for invoice generation.