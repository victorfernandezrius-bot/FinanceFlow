-- ============================================
-- Feature: Tesorería — calendario de cobros y pagos recurrentes
--
-- 1) accounts.admite_cobros / admite_pagos: la cuenta (ingreso / gasto) puede
--    contener cobros / pagos recurrentes. D1 los devuelve como 1/0.
-- 2) movements.compromiso_id: vínculo del movimiento con la serie que originó
--    o liquida.
-- 3) tesoreria_compromisos: series futuras. Las ocurrencias NO se guardan, se
--    calculan al vuelo (api/tesoreria-logic.js).
--
-- ATENCIÓN: ALTER TABLE ... ADD COLUMN no es idempotente en SQLite. Antes de
-- aplicar, comprobar que las columnas no existen:
--   SELECT name FROM pragma_table_info('accounts')  WHERE name IN ('admite_cobros','admite_pagos');
--   SELECT name FROM pragma_table_info('movements') WHERE name='compromiso_id';
-- Si devuelven filas, NO volver a ejecutar este fichero.
--
-- Aplicar en STAGING:
--   npx wrangler d1 execute cp-db-staging --remote --file=db/migrations/0005_tesoreria.sql
-- ============================================

-- Flags en cuentas: la cuenta puede contener cobros / pagos recurrentes
ALTER TABLE accounts ADD COLUMN admite_cobros INTEGER DEFAULT 0;
ALTER TABLE accounts ADD COLUMN admite_pagos  INTEGER DEFAULT 0;

-- Vínculo movimiento → compromiso (el movimiento que originó o liquida la serie)
ALTER TABLE movements ADD COLUMN compromiso_id TEXT;

CREATE TABLE IF NOT EXISTS tesoreria_compromisos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('cobro','pago')),
  cuenta_id TEXT NOT NULL,              -- cuenta de ingreso (cobro) o gasto (pago)
  concepto TEXT NOT NULL,
  importe REAL NOT NULL CHECK (importe > 0),
  frecuencia TEXT NOT NULL CHECK (frecuencia IN ('mensual','trimestral','semestral','anual')),
  fecha_ancla TEXT NOT NULL,            -- YYYY-MM-DD (fecha del movimiento origen)
  fecha_fin TEXT,                       -- NULL = indefinido
  aviso_dias INTEGER NOT NULL DEFAULT 2,-- días de antelación para el push
  activo INTEGER NOT NULL DEFAULT 1,
  movimiento_origen_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tes_comp_user ON tesoreria_compromisos(user_id, activo);
CREATE INDEX IF NOT EXISTS idx_tes_comp_cuenta ON tesoreria_compromisos(user_id, cuenta_id);
