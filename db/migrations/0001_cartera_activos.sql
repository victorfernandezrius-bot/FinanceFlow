-- ============================================
-- Feature: Cartera de Inversión
-- Tabla de posiciones (holdings) de la cartera del usuario.
--
-- Aplicar en LOCAL:
--   wrangler d1 execute cp-db --local --file=db/migrations/0001_cartera_activos.sql
-- Aplicar en PRODUCCIÓN (solo tras validar en local y hacer merge a main):
--   wrangler d1 execute cp-db --remote --file=db/migrations/0001_cartera_activos.sql
--
-- Nota: usuario_id es TEXT (no INTEGER) para referenciar users(id), que es TEXT
-- (UUID) en este proyecto. El resto de PKs de la app son TEXT; aquí usamos un id
-- autoincremental porque el id lo genera la BD (el cliente no lo envía en el POST).
-- ============================================

CREATE TABLE IF NOT EXISTS cartera_activos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  nombre TEXT,
  tipo_activo TEXT NOT NULL, -- 'accion' | 'etf' | 'fondo' | 'cripto'
  cantidad REAL NOT NULL,
  precio_medio_compra REAL NOT NULL,
  moneda TEXT DEFAULT 'EUR',
  broker_origen TEXT,
  fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cartera_usuario ON cartera_activos(usuario_id);
