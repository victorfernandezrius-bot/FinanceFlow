-- 0003 · Verificación de email por código de 6 dígitos (solo ADITIVA: columnas nuevas)
-- Modo estricto: una cuenta de email/contraseña no recibe sesión hasta verificar el
-- email. El código se guarda solo como HMAC (verify_code_hash), caduca a los 10 min
-- (verify_code_expires_at) y admite 5 intentos (verify_attempts, contador atómico en D1).
-- verify_sent_at impone 60 s entre envíos.
--
-- Todos los usuarios existentes quedan verificados (email_verified_at = created_at),
-- así que aplicarla no deja a nadie fuera. El Worker solo bloquea si
-- email_verified_at es exactamente NULL: sin esta migración la columna no existe y
-- nadie queda bloqueado, pero el registro nuevo SÍ la necesita (aplícala antes del Worker).
--
-- Aplicar UNA vez en producción:
--   npx wrangler d1 execute cp-db --remote --file=db/migrations/0003_email_verification.sql
-- Si responde "duplicate column name: email_verified_at", ya estaba aplicada.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN verify_code_hash TEXT;
ALTER TABLE users ADD COLUMN verify_code_expires_at TEXT;
ALTER TABLE users ADD COLUMN verify_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verify_sent_at TEXT;

UPDATE users SET email_verified_at = COALESCE(created_at, datetime('now'))
WHERE email_verified_at IS NULL;
