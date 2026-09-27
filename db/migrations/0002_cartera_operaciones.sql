-- ============================================
-- Feature: Cartera de Inversión v2
-- Modelo basado en histórico de operaciones (compras/ventas). Las posiciones
-- abiertas y el precio medio dejan de almacenarse y pasan a CALCULARSE agregando
-- cartera_operaciones. cartera_activos (v1) queda obsoleta como fuente de verdad.
--
-- Aplicar en LOCAL:
--   wrangler d1 execute cp-db --local --file=db/migrations/0002_cartera_operaciones.sql
-- ============================================

-- A.1 — Histórico de operaciones (fuente de verdad).
CREATE TABLE IF NOT EXISTS cartera_operaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  tipo_activo TEXT NOT NULL,        -- 'accion' | 'etf' | 'fondo' | 'cripto'
  tipo_operacion TEXT NOT NULL,     -- 'compra' | 'venta'
  fecha TEXT NOT NULL,              -- YYYY-MM-DD
  cantidad REAL NOT NULL,
  precio REAL NOT NULL,             -- precio de ENTRADA en compras, de CIERRE en ventas
  comision REAL DEFAULT 0,
  moneda TEXT DEFAULT 'EUR',
  broker_origen TEXT,
  cierra_operacion_id INTEGER,      -- referencia informativa (venta que cierra posición)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_operaciones_usuario ON cartera_operaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_usuario_ticker ON cartera_operaciones(usuario_id, ticker);
CREATE INDEX IF NOT EXISTS idx_operaciones_fecha ON cartera_operaciones(usuario_id, fecha);

-- A.2 — Snapshot diario del valor total de cartera (para histórico y rentabilidad).
CREATE TABLE IF NOT EXISTS cartera_valor_diario (
  usuario_id TEXT NOT NULL,
  fecha TEXT NOT NULL,              -- YYYY-MM-DD
  valor_total REAL NOT NULL,
  PRIMARY KEY (usuario_id, fecha),
  FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE CASCADE
);

-- A.3 — Migrar datos de v1 (cartera_activos) a una 'compra' equivalente para no
-- perderlos. Idempotente: no re-inserta si ya existe una compra idéntica.
INSERT INTO cartera_operaciones
    (usuario_id, ticker, tipo_activo, tipo_operacion, fecha, cantidad, precio, comision, moneda, broker_origen, created_at)
SELECT
    ca.usuario_id, ca.ticker, ca.tipo_activo, 'compra',
    COALESCE(substr(ca.fecha_creacion, 1, 10), date('now')),
    ca.cantidad, ca.precio_medio_compra, 0, COALESCE(ca.moneda, 'EUR'),
    ca.broker_origen, COALESCE(ca.fecha_creacion, CURRENT_TIMESTAMP)
FROM cartera_activos ca
WHERE NOT EXISTS (
    SELECT 1 FROM cartera_operaciones o
    WHERE o.usuario_id = ca.usuario_id AND o.ticker = ca.ticker
      AND o.tipo_operacion = 'compra' AND o.precio = ca.precio_medio_compra
      AND o.cantidad = ca.cantidad
);
