-- =============================================================================
-- Migration: 20240101000012_create_clients.sql
-- Description: Creates the clients table for managing customer records per
--              organization. Supports both PF and PJ clients, with address,
--              contact details, and employee responsibility tracking (single
--              legacy FK + modern JSONB array).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: clients
-- -----------------------------------------------------------------------------
CREATE TABLE public.clients (
  -- Primary key
  id                       uuid          NOT NULL DEFAULT gen_random_uuid(),

  -- Tenant scoping
  organization_id          uuid          NOT NULL,

  -- Identity
  name                     varchar(200)  NOT NULL,
  person_type              varchar(2)    NOT NULL,  -- 'pf' = individual, 'pj' = company
  tax_id                   varchar(18),             -- CPF or CNPJ

  -- Contact
  phone                    varchar(20)   NOT NULL,
  email                    varchar(200),

  -- Address
  zip_code                 varchar(9),
  street                   varchar(200),
  address_number           varchar(10),
  address_complement       varchar(100),
  neighborhood             varchar(100),
  city                     varchar(100),
  state                    char(2),                 -- Brazilian UF code, e.g. 'SP'

  -- Responsible employee assignment
  -- DEPRECATED: single FK retained for backwards compatibility; use responsible_employees instead
  employee_responsible_id  uuid,

  -- Modern multi-employee assignment.
  -- Shape: [{"employee_id": "<uuid>"}, ...]
  responsible_employees    jsonb,

  -- Free-form notes
  notes                    text,

  -- Audit columns
  created_at               timestamptz   NOT NULL DEFAULT now(),
  created_by               varchar(200),
  updated_at               timestamptz   NOT NULL DEFAULT now(),
  updated_by               varchar(200),
  deleted_at               timestamptz,
  deleted_by               varchar(200),

  -- Constraints
  CONSTRAINT clients_pkey PRIMARY KEY (id),

  CONSTRAINT clients_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id)
    ON DELETE CASCADE,

  -- clients_employee_responsible_id_fkey é criada na migration 013, depois de public.employees existir.

  CONSTRAINT clients_person_type_check
    CHECK (person_type IN ('pf', 'pj'))
);

-- -----------------------------------------------------------------------------
-- COMMENTS
-- -----------------------------------------------------------------------------
COMMENT ON TABLE  public.clients                          IS 'Customer records scoped per organization.';
COMMENT ON COLUMN public.clients.person_type             IS 'pf = Pessoa Física (individual), pj = Pessoa Jurídica (company).';
COMMENT ON COLUMN public.clients.tax_id                  IS 'CPF (individuals) or CNPJ (companies) — stored without punctuation.';
COMMENT ON COLUMN public.clients.employee_responsible_id IS 'DEPRECATED — legacy single responsible employee FK. Prefer responsible_employees JSONB array.';
COMMENT ON COLUMN public.clients.responsible_employees   IS 'JSON array of responsible employees: [{"employee_id": "<uuid>"}].';

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------

-- Org-scoped active-record index
CREATE INDEX idx_clients_organization_id
  ON public.clients (organization_id)
  WHERE deleted_at IS NULL;

-- Fast lookup by tax_id (CPF/CNPJ) within active records
CREATE INDEX idx_clients_tax_id
  ON public.clients (tax_id)
  WHERE deleted_at IS NULL;

-- Fast lookup by phone within active records
CREATE INDEX idx_clients_phone
  ON public.clients (phone)
  WHERE deleted_at IS NULL;

-- Fast lookup / search by name within active records
CREATE INDEX idx_clients_name
  ON public.clients (name)
  WHERE deleted_at IS NULL;

-- FK index: legacy employee_responsible_id (no partial — NULL rows still need join support)
CREATE INDEX idx_clients_employee_responsible_id
  ON public.clients (employee_responsible_id);

-- -----------------------------------------------------------------------------
-- AUTO-UPDATE TRIGGER: updated_at
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select_same_org"
  ON public.clients
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

CREATE POLICY "clients_insert_same_org"
  ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_organization_id());

CREATE POLICY "clients_update_same_org"
  ON public.clients
  FOR UPDATE TO authenticated
  USING  (organization_id = public.current_user_organization_id())
  WITH CHECK (organization_id = public.current_user_organization_id());

CREATE POLICY "clients_delete_same_org"
  ON public.clients
  FOR DELETE TO authenticated
  USING (organization_id = public.current_user_organization_id());
