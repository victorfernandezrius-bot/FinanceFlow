-- 0002 · Registro de auditoría de eventos sensibles (solo ADITIVA: tabla nueva)
-- Eventos: login, login_failed, password_changed, password_reset, plan_changed,
-- account_deleted. Lo escribe el Worker sin bloquear la petición; sin esta tabla,
-- las escrituras fallan en silencio (solo se registran en el log del Worker).
-- Retención: el cron diario borra las entradas de más de 365 días. Al borrar una
-- cuenta se borran sus entradas y queda solo el evento account_deleted (sin IP).
--
-- Aplicar en producción (idempotente):
--   npx wrangler d1 execute cp-db --remote --file=db/migrations/0002_audit_log.sql
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    event TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event, created_at);
