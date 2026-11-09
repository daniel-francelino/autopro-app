-- =============================================================================
-- Migration: 20240101000013_create_employees.sql
-- Description: Creates the employees table for managing staff records per
--              organization. Covers payroll configuration (salary, installments),
--              commission rules (percentage or fixed, revenue or profit basis,
--              per-category overrides), minimum guarantee, PIX payment details,
--              and termination tracking.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: employees
-- -----------------------------------------------------------------------------
CREATE TABLE public.employees (
  -- Primary key
  id                              uuid          NOT NULL DEFAULT gen_random_uuid(),

  -- Tenant scoping
  organization_id                 uuid          NOT NULL,

  -- Identity
  name                            varchar(200)  NOT NULL,
  person_type                     varchar(2)    NOT NULL,  -- 'pf' = individual, 'pj' = company
  tax_id                          varchar(18)   NOT NULL,  -- CPF or CNPJ

  -- Contact
  phone                           varchar(20)   NOT NULL,
  email                           varchar(200),

  -- Address
  zip_code                        varchar(9),
  street                          varchar(200),
  address_number                  varchar(10),
  address_complement              varchar(100),
  neighborhood                    varchar(100),
  city                            varchar(100),
  state                           char(2),                 -- Brazilian UF code, e.g. 'SP'

  -- -------------------------------------------------------------------------
  -- Salary / Fixed Compensation
  -- -------------------------------------------------------------------------
  has_salary                      boolean       NOT NULL DEFAULT false,
  salary_amount                   numeric(15,2),           -- Total monthly salary
  payment_day                     int,                     -- Day of month for payment (1–31)

  -- If salary is split into multiple payments, define each installment here.
  -- Shape: [{"day": 15, "amount": 1500.00}, {"day": 30, "amount": 1500.00}]
  salary_installments             jsonb,

  -- -------------------------------------------------------------------------
  -- Commission
  -- -------------------------------------------------------------------------
  has_commission                  boolean       NOT NULL DEFAULT false,

  -- 'percentage' = rate applied to base, 'fixed_amount' = flat value per sale/order
  commission_type                 varchar(20),

  commission_amount               numeric(15,2),           -- Rate (%) or fixed amount (R$)

  -- Whether commission is calculated on gross revenue or net profit
  commission_base                 varchar(10),

  -- Per-category commission overrides.
  -- Shape: string[] array of product_categories.id values
  commission_categories           jsonb,

  -- -------------------------------------------------------------------------
  -- Minimum Guarantee (Piso / Garantia Mínima)
  -- -------------------------------------------------------------------------
  has_minimum_guarantee           boolean       NOT NULL DEFAULT false,
  minimum_guarantee_amount        numeric(15,2),

  -- Shape: [{"day": 15, "amount": 500.00}, {"day": 30, "amount": 500.00}]
  minimum_guarantee_installments  jsonb,

  -- -------------------------------------------------------------------------
  -- PIX Payment Details
  -- -------------------------------------------------------------------------
  -- Key type: cpf, cnpj, email, phone, random_key
  pix_key_type                    varchar(20),
  pix_key                         varchar(150),

  -- -------------------------------------------------------------------------
  -- Termination
  -- -------------------------------------------------------------------------
  termination_date                date,
  termination_reason              text,

  -- Audit columns
  created_at                      timestamptz   NOT NULL DEFAULT now(),
  created_by                      varchar(200),
  updated_at                      timestamptz   NOT NULL DEFAULT now(),
  updated_by                      varchar(200),
  deleted_at                      timestamptz,
  deleted_by                      varchar(200),

  -- Constraints
  CONSTRAINT employees_pkey PRIMARY KEY (id),

  CONSTRAINT employees_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id)
    ON DELETE CASCADE,

  CONSTRAINT employees_person_type_check
    CHECK (person_type IN ('pf', 'pj')),

  CONSTRAINT employees_payment_day_check
    CHECK (payment_day IS NULL OR payment_day BETWEEN 1 AND 31),

  CONSTRAINT employees_commission_type_check
    CHECK (
      commission_type IS NULL OR
      commission_type IN ('percentage', 'fixed_amount')
    ),

  CONSTRAINT employees_commission_base_check
    CHECK (
      commission_base IS NULL OR
      commission_base IN ('revenue', 'profit')
    ),

  CONSTRAINT employees_pix_key_type_check
    CHECK (
      pix_key_type IS NULL OR
      pix_key_type IN ('cpf', 'cnpj', 'email', 'phone', 'random_key')
    )
);

-- -----------------------------------------------------------------------------
-- COMMENTS
-- -----------------------------------------------------------------------------
COMMENT ON TABLE  public.employees                             IS 'Employee / staff records scoped per organization.';
COMMENT ON COLUMN public.employees.person_type                IS 'pf = Pessoa Física (CLT/MEI individual), pj = Pessoa Jurídica (contracted company).';
COMMENT ON COLUMN public.employees.tax_id                     IS 'CPF (PF) or CNPJ (PJ) — stored without punctuation.';
COMMENT ON COLUMN public.employees.payment_day                IS 'Day of the month on which the fixed salary is paid. Must be between 1 and 31.';
COMMENT ON COLUMN public.employees.salary_installments        IS 'Optional split schedule: [{"day": int, "amount": numeric}]. Overrides single payment_day when present.';
COMMENT ON COLUMN public.employees.commission_type            IS 'percentage = applied over commission_base amount; fixed_amount = flat value per qualifying event.';
COMMENT ON COLUMN public.employees.commission_base            IS 'revenue = gross sales value; profit = net margin.';
COMMENT ON COLUMN public.employees.commission_categories      IS 'JSON string array of product_categories.id values that qualify for this employee''s commission rate.';
COMMENT ON COLUMN public.employees.minimum_guarantee_amount   IS 'Minimum guaranteed earnings per period (piso salarial).';
COMMENT ON COLUMN public.employees.minimum_guarantee_installments IS 'Split schedule for minimum guarantee payments: [{"day": int, "amount": numeric}].';
COMMENT ON COLUMN public.employees.pix_key_type               IS 'PIX key type: cpf, cnpj, email, phone, random_key.';
COMMENT ON COLUMN public.employees.termination_date           IS 'Date the employee was terminated / contract ended. NULL means currently active.';

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------

-- Org-scoped active-record index
CREATE INDEX idx_employees_organization_id
  ON public.employees (organization_id)
  WHERE deleted_at IS NULL;

-- Fast lookup by tax_id within active records (CPF/CNPJ uniqueness checks)
CREATE INDEX idx_employees_tax_id
  ON public.employees (tax_id)
  WHERE deleted_at IS NULL;

-- Composite: filter active vs terminated employees per org
CREATE INDEX idx_employees_org_termination_date
  ON public.employees (organization_id, termination_date)
  WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- AUTO-UPDATE TRIGGER: updated_at
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employees_select_same_org"
  ON public.employees
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

CREATE POLICY "employees_insert_same_org"
  ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_organization_id());

CREATE POLICY "employees_update_same_org"
  ON public.employees
  FOR UPDATE TO authenticated
  USING  (organization_id = public.current_user_organization_id())
  WITH CHECK (organization_id = public.current_user_organization_id());

CREATE POLICY "employees_delete_same_org"
  ON public.employees
  FOR DELETE TO authenticated
  USING (organization_id = public.current_user_organization_id());

-- FK de clients -> employees (movida da migration 012, que rodava antes de employees existir).
ALTER TABLE public.clients
  ADD CONSTRAINT clients_employee_responsible_id_fkey
    FOREIGN KEY (employee_responsible_id)
    REFERENCES public.employees (id)
    ON DELETE SET NULL;
