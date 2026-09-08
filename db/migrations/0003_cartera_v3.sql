-- ============================================
-- Feature: Cartera de Inversión v3 (análisis de cartera)
-- Tablas de atributos estáticos por instrumento, liquidez y caché de riesgo.
-- El enum tipo_activo se amplía en la validación del Worker (no hay CHECK en D1):
--   'accion' | 'etf' | 'fondo' | 'renta_fija' | 'derivado' | 'cripto' | 'liquidez'
--
-- Aplicar en LOCAL:
--   wrangler d1 execute cp-db --local --file=db/migrations/0003_cartera_v3.sql
-- ============================================

-- Atributos estáticos por activo (no por operación): sector, datos de renta fija
-- y de derivados. Entrada manual del usuario (no hay fuente de API).
CREATE TABLE IF NOT EXISTS cartera_instrumentos (
  usuario_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  nombre TEXT,
  tipo_activo TEXT NOT NULL,
  sector TEXT,                    -- manual (renta variable)
  -- Renta fija:
  rf_tipo_interes REAL,           -- % nominal (YTM / tipo de descuento)
  rf_cupon REAL,                  -- % sobre nominal
  rf_frecuencia_cupon TEXT,       -- 'anual'|'semestral'|'trimestral'
  rf_vencimiento TEXT,            -- YYYY-MM-DD
  rf_nominal REAL,
  -- Derivados:
  der_tipo TEXT,                  -- 'futuro' | 'opcion'
  der_vencimiento TEXT,           -- YYYY-MM-DD
  der_subyacente_cobertura TEXT,  -- ticker al que cubre (si futuro)
  der_tipo_opcion TEXT,           -- 'call' | 'put'
  der_prima REAL,
  PRIMARY KEY (usuario_id, ticker),
  FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Liquidez (efectivo) por moneda.
CREATE TABLE IF NOT EXISTS cartera_liquidez (
  usuario_id TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'EUR',
  saldo REAL NOT NULL DEFAULT 0,
  remunerada INTEGER DEFAULT 0,          -- 0/1 (D1 devuelve enteros; normalizar al leer)
  tipo_interes_anual REAL DEFAULT 0,     -- % nominal anual
  capitalizacion TEXT DEFAULT 'anual',   -- 'anual'|'semestral'|'trimestral'|'mensual'|'diaria'
  fecha_inicio TEXT,
  PRIMARY KEY (usuario_id, moneda),
  FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Caché del cálculo de riesgo diario (matriz var-cov, betas, volatilidades).
CREATE TABLE IF NOT EXISTS cartera_riesgo_cache (
  usuario_id TEXT NOT NULL,
  benchmark TEXT NOT NULL,
  fecha_calculo TEXT NOT NULL,
  payload TEXT NOT NULL,   -- JSON: {betas:{}, matriz:[[]], tickers:[], volatilidades:{}, ...}
  PRIMARY KEY (usuario_id, benchmark),
  FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE CASCADE
);
