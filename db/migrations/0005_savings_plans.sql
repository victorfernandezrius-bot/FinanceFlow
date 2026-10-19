-- ============================================
-- Feature: Planes de Ahorro (PREMIUM) — Fase 0
--
-- Modelo: cada plan es un "sobre" dentro del saldo real de una cuenta de tipo
-- 'activo'. Una cuenta puede tener varios planes. Lo no asignado es ahorro libre.
--
--   asignado(cuenta) = SUM(savings_plan_allocations.cantidad) de sus planes vivos
--   ahorro_libre(cuenta) = accounts.saldo_actual - colchon_minimo - asignado(cuenta)
--
-- INVARIANTE:  asignado(cuenta) <= saldo_actual(cuenta) - colchon_minimo(cuenta)
--
-- El interés (savings_plans.interes_anual) es SOLO para la simulación/proyección:
-- NUNCA se suma a saldo_actual ni genera movimientos contables.
--
-- Aplicar en STAGING:
--   wrangler d1 execute cp-db-staging --remote --file=db/migrations/0005_savings_plans.sql
--
-- Los enums no llevan CHECK (igual que cartera v3): se validan en el Worker.
-- ============================================

-- --------------------------------------------
-- 1) Colchón mínimo (fondo de emergencia intocable) — es de la CUENTA
-- --------------------------------------------
-- OJO: SQLite/D1 no admite "ADD COLUMN IF NOT EXISTS". Si esta migración ya se
-- aplicó antes, esta línea fallará con "duplicate column name: colchon_minimo".
-- Ese error es esperado y se puede ignorar; el resto del fichero es idempotente.
ALTER TABLE accounts ADD COLUMN colchon_minimo REAL DEFAULT 0;

-- --------------------------------------------
-- 2) Planes de ahorro
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS savings_plans (
  id                TEXT PRIMARY KEY,          -- uuid generado en cliente (patrón de accounts/movements)
  user_id           TEXT NOT NULL,
  cuenta_ahorro_id  TEXT NOT NULL,             -- accounts.id, debe ser tipo='activo'
  nombre            TEXT NOT NULL,
  descripcion       TEXT DEFAULT '',

  -- Modos (ver validación en el Worker):
  --   'objetivo_fecha' -> usuario da objetivo_total + fecha_limite, la app calcula la cuota (PMT)
  --   'cuota_fija'     -> usuario da aportacion + objetivo_total, la app calcula los meses (n)
  modo              TEXT NOT NULL,
  objetivo_total    REAL NOT NULL,             -- meta en la divisa del usuario
  aportacion        REAL,                      -- NULL en 'objetivo_fecha' (se deriva)
  periodicidad      TEXT NOT NULL DEFAULT 'mensual',  -- 'mensual'|'trimestral'|'anual' (hoy solo mensual)
  dia_aportacion    INTEGER,                   -- 1-28, para recordatorios push (Fase 5)

  fecha_inicio      TEXT NOT NULL,             -- YYYY-MM-DD
  fecha_limite      TEXT,                      -- YYYY-MM-DD (obligatoria en modo 'objetivo_fecha')
  fecha_estimada    TEXT,                      -- YYYY-MM-DD, caché de la proyección (Fase 2)

  producto_tipo     TEXT,                      -- informativo: 'cuenta_remunerada'|'deposito'|'fondo'|'letras'|'otro'
  interes_anual     REAL DEFAULT 0,            -- % TAE — SOLO simulación
  capitalizacion    TEXT DEFAULT 'mensual',    -- 'mensual'|'anual'

  estado            TEXT NOT NULL DEFAULT 'activo',  -- 'activo'|'pausado'|'completado'|'cancelado'
  color             TEXT,
  icono             TEXT,                      -- clave de flow-icons.js

  completed_at      TEXT,
  closed_at         TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- RESTRICT: borrar una cuenta con planes debe FALLAR, no llevarse los planes por
  -- delante. El aviso amable lo da el Worker; esto es la red de seguridad.
  FOREIGN KEY (cuenta_ahorro_id) REFERENCES accounts(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_splans_user   ON savings_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_splans_cuenta ON savings_plans(user_id, cuenta_ahorro_id);
CREATE INDEX IF NOT EXISTS idx_splans_estado ON savings_plans(user_id, estado);

-- --------------------------------------------
-- 3) Libro auxiliar de asignaciones (append-only, cantidades CON SIGNO)
-- --------------------------------------------
-- asignado(plan) = SUM(cantidad). Nunca se hace UPDATE de una fila: se compensa
-- con otra fila de signo contrario. movement_id NULL = reasignación interna sin
-- que el dinero se mueva (asignar ahorro libre / desasignar al cerrar un plan).
--
-- NO hay FK a movements a propósito: si el usuario borra un movimiento, quiero
-- que la asignación quede huérfana y VISIBLE para el reconciliador, no que
-- desaparezca en silencio.
CREATE TABLE IF NOT EXISTS savings_plan_allocations (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  plan_id           TEXT NOT NULL,
  movement_id       TEXT,
  cuenta_ahorro_id  TEXT NOT NULL,             -- desnormalizado: cuenta del plan en ese instante
  tipo              TEXT NOT NULL,             -- 'aportacion'|'asignacion_libre'|'retiro'|'desasignacion'|'ajuste'
  cantidad          REAL NOT NULL,             -- + suma al sobre, - resta
  fecha             TEXT NOT NULL,             -- YYYY-MM-DD
  nota              TEXT,
  created_at        TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES savings_plans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_salloc_plan   ON savings_plan_allocations(user_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_salloc_mov    ON savings_plan_allocations(user_id, movement_id);
CREATE INDEX IF NOT EXISTS idx_salloc_cuenta ON savings_plan_allocations(user_id, cuenta_ahorro_id);
CREATE INDEX IF NOT EXISTS idx_salloc_fecha  ON savings_plan_allocations(plan_id, fecha);
