-- ============================================
-- SCHEMA FinanceFlow / Contabilidad Personal
-- Aplicar con: wrangler d1 execute cp-db --remote --file=db/schema.sql
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT,
    auth_provider TEXT DEFAULT 'email',
    google_sub TEXT,
    picture TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_expires_at TEXT,
    premium_trial_expires_at TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL,
    descripcion TEXT DEFAULT '',
    saldo_inicial REAL DEFAULT 0,
    saldo_actual REAL DEFAULT 0,
    is_fixed_cost INTEGER DEFAULT 0,
    fixed_monthly_amount REAL,
    fixed_due_day INTEGER,
    is_bank_account INTEGER DEFAULT 0,
    auto_created_by_rule TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user_tipo ON accounts(user_id, tipo);

CREATE TABLE IF NOT EXISTS movements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    cantidad REAL NOT NULL,
    descripcion TEXT NOT NULL,
    fecha TEXT NOT NULL,
    cuenta_id TEXT,
    cuenta_destino_id TEXT,
    categoria TEXT,
    origen TEXT DEFAULT 'manual',
    auto_categorized INTEGER DEFAULT 0,
    applied_rule TEXT,
    rule_name TEXT,
    manually_categorized INTEGER DEFAULT 0,
    bank_reference TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_movements_user ON movements(user_id);
CREATE INDEX IF NOT EXISTS idx_movements_user_fecha ON movements(user_id, fecha);
CREATE INDEX IF NOT EXISTS idx_movements_cuenta ON movements(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_movements_bankref ON movements(user_id, bank_reference);

CREATE TABLE IF NOT EXISTS categorization_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL,
    account_type TEXT,
    account_id TEXT,
    account_name TEXT,
    enabled INTEGER DEFAULT 1,
    is_default INTEGER DEFAULT 0,
    created_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rules_user ON categorization_rules(user_id);

CREATE TABLE IF NOT EXISTS autocontrol_plan (
    user_id TEXT PRIMARY KEY,
    plan_data TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS autocontrol_associations (
    user_id TEXT PRIMARY KEY,
    associations_data TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    scenario_data TEXT NOT NULL,
    created_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenarios_user ON scenarios(user_id);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT,
    title TEXT,
    message TEXT,
    data TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS bank_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    bank_code TEXT,
    bank_name TEXT,
    institution_id TEXT,
    requisition_id TEXT,
    gocardless_account_id TEXT,
    linked_account_id TEXT,
    status TEXT DEFAULT 'pending',
    is_active INTEGER DEFAULT 0,
    last_sync_at TEXT,
    created_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bankconn_user ON bank_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_bankconn_requisition ON bank_connections(requisition_id);

CREATE TABLE IF NOT EXISTS import_info (
    user_id TEXT NOT NULL,
    bank_code TEXT NOT NULL,
    last_import_at TEXT,
    last_import_count INTEGER DEFAULT 0,
    total_imported INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, bank_code),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stripe_events (
    event_id TEXT PRIMARY KEY,
    type TEXT,
    processed_at TEXT,
    payload TEXT
);
