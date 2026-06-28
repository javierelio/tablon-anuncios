PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dm', 'player')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dm_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  dm_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, player_id)
);

CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'otro',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ancestry TEXT NOT NULL DEFAULT '',
  archetype TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  dm_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  public_text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible', 'arrancado', 'completado', 'archivado')),
  world_date TEXT NOT NULL DEFAULT '',
  hidden_from_players INTEGER NOT NULL DEFAULT 0,
  real_summary TEXT NOT NULL DEFAULT '',
  narrative_hook TEXT NOT NULL DEFAULT '',
  secret_information TEXT NOT NULL DEFAULT '',
  involved_npcs TEXT NOT NULL DEFAULT '',
  relevant_locations TEXT NOT NULL DEFAULT '',
  possible_complications TEXT NOT NULL DEFAULT '',
  real_reward TEXT NOT NULL DEFAULT '',
  ignored_consequences TEXT NOT NULL DEFAULT '',
  dm_notes TEXT NOT NULL DEFAULT '',
  prep_state TEXT NOT NULL DEFAULT 'idea' CHECK (prep_state IN ('idea', 'preparada', 'en_juego', 'resuelta', 'descartada')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pull_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  pulled_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  reverted_at TEXT,
  reverted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_pull_per_announcement
ON pull_records(announcement_id)
WHERE active = 1;

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  announcement_id INTEGER REFERENCES announcements(id) ON DELETE CASCADE,
  pull_record_id INTEGER REFERENCES pull_records(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'announcement_pulled',
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_dm ON campaigns(dm_id);
CREATE INDEX IF NOT EXISTS idx_boards_campaign ON boards(campaign_id);
CREATE INDEX IF NOT EXISTS idx_announcements_board ON announcements(board_id);
CREATE INDEX IF NOT EXISTS idx_announcements_campaign ON announcements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_characters_campaign_user ON characters(campaign_id, user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
