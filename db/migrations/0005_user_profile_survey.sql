-- 0005 · Cuestionario de perfil opcional tras el registro (solo ADITIVA: tabla nueva)
-- Una fila por usuario (user_id es la clave primaria): el POST /api/profile-survey hace
-- upsert, así que repetirlo nunca crea una segunda fila. Si el usuario pulsa "Saltar" no
-- se guarda nada. Los valores permitidos de cada columna los valida el Worker
-- (PROFILE_SURVEY_OPTIONS en api/worker.js): sin CHECK en SQL para poder cambiar las
-- opciones sin reconstruir la tabla.
-- Al borrar la cuenta se borra su fila (DELETE explícito en el Worker + ON DELETE CASCADE).
--
-- Aplicar en STAGING (idempotente):
--   npx wrangler d1 execute cp-db-staging --remote --file=db/migrations/0005_user_profile_survey.sql
-- En producción (cp-db) SOLO cuando se apruebe el paso a main, y ANTES de desplegar el Worker.
CREATE TABLE IF NOT EXISTS user_profile_survey (
    user_id TEXT PRIMARY KEY,
    age_range TEXT,
    life_situation TEXT,
    main_goal TEXT,
    monthly_income_range TEXT,
    current_method TEXT,
    completed_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
