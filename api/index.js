'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Tablón de Anuncios Westmarch — handler Vercel + Turso
//  Para desarrollo local sigue usando: node server.js  (SQLite local)
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@libsql/client');
const crypto = require('node:crypto');

// ─── CLIENTE TURSO ────────────────────────────────────────────────────────────
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── HELPERS DE CONSULTA ──────────────────────────────────────────────────────
async function get(sql, args = []) {
  const { rows } = await db.execute({ sql, args });
  return rows[0] ?? null;
}
async function all(sql, args = []) {
  const { rows } = await db.execute({ sql, args });
  return rows;
}
async function run(sql, args = []) {
  return db.execute({ sql, args });
}

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('dm', 'player', 'admin')),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    dm_password_hint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dm_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campaign_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    dm_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (campaign_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'otro',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ancestry TEXT NOT NULL DEFAULT '',
    archetype TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    dm_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'activo',
    death_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
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
  )`,
  `CREATE TABLE IF NOT EXISTS pull_records (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_active_pull_per_announcement ON pull_records(announcement_id) WHERE active = 1`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    announcement_id INTEGER REFERENCES announcements(id) ON DELETE CASCADE,
    pull_record_id INTEGER REFERENCES pull_records(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'announcement_pulled',
    message TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS character_board_access (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (character_id, board_id)
  )`,
  `CREATE TABLE IF NOT EXISTS character_campaigns (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (character_id, campaign_id)
  )`,
  `CREATE TABLE IF NOT EXISTS campaign_dms (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (campaign_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_dm ON campaigns(dm_id)`,
  `CREATE INDEX IF NOT EXISTS idx_boards_campaign ON boards(campaign_id)`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_board ON announcements(board_id)`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_campaign ON announcements(campaign_id)`,
  `CREATE INDEX IF NOT EXISTS idx_characters_campaign_user ON characters(campaign_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at)`,
];

// ─── INICIALIZACIÓN ───────────────────────────────────────────────────────────
async function initialize() {
  await run('PRAGMA foreign_keys = ON');
  for (const sql of SCHEMA) {
    try { await run(sql); } catch { /* ya existe */ }
  }
  await seedDatabase();
  await ensureAdminUser();
  await migrateData();
}

let _init = null;
const ensureInit = () => { if (!_init) _init = initialize(); return _init; };

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => new Date().toISOString();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  const actual = hashPassword(password, salt).hash;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHash, 'hex'));
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) { reject(new HttpError(413, 'Petición demasiado grande.')); req.destroy(); }
    });
    req.on('end', () => {
      if (!body.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch { reject(new HttpError(400, 'JSON no válido.')); }
    });
    req.on('error', reject);
  });
}
function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}
function requireFields(body, fields) {
  for (const field of fields) {
    if (typeof body[field] !== 'string' || !body[field].trim())
      throw new HttpError(400, `Falta el campo ${field}.`);
  }
}
function asText(v) { return typeof v === 'string' ? v.trim() : ''; }
function normalizeTags(v) {
  if (Array.isArray(v)) return v.map(t => String(t).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}
function parseTags(v) {
  try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────
function rowUser(row) {
  return row ? {
    id: Number(row.id), username: row.username, displayName: row.display_name,
    email: row.email || '', role: row.role, createdAt: row.created_at,
  } : null;
}

async function getAuthUser(req) {
  const [, token] = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [];
  if (!token) return null;
  const row = await get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [tokenHash(token), now()]
  );
  return rowUser(row);
}

async function createSession(userId) {
  await run('DELETE FROM sessions WHERE expires_at <= ?', [now()]);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await run(
    `INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    [userId, tokenHash(token), expires, now()]
  );
  return token;
}

async function requireUser(req) {
  const user = await getAuthUser(req);
  if (!user) throw new HttpError(401, 'Debes iniciar sesión.');
  return user;
}
function requireDm(user) {
  if (user.role !== 'dm' && user.role !== 'admin')
    throw new HttpError(403, 'Solo el Dungeon Master puede hacer eso.');
}
function requireAdmin(user) {
  if (user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer eso.');
}
function requirePlayer(user) {
  if (user.role !== 'player') throw new HttpError(403, 'Solo un jugador puede hacer eso.');
}

async function getCampaignForUser(campaignId, user) {
  const id = Number(campaignId);
  let row;
  if (user.role === 'admin') {
    row = await get('SELECT * FROM campaigns WHERE id = ?', [id]);
  } else if (user.role === 'dm') {
    row = await get(`
      SELECT c.* FROM campaigns c WHERE c.id = ? AND (
        c.dm_id = ?
        OR EXISTS (SELECT 1 FROM campaign_dms cd WHERE cd.campaign_id = c.id AND cd.user_id = ?)
      )`, [id, user.id, user.id]);
  } else {
    row = await get(`
      SELECT c.* FROM campaigns c
      JOIN campaign_players cp ON cp.campaign_id = c.id
      WHERE c.id = ? AND cp.player_id = ? AND cp.status = 'active'`,
      [id, user.id]);
  }
  if (!row) throw new HttpError(404, 'Campaña no encontrada o sin permiso.');
  return row;
}

async function getBoardForUser(boardId, user) {
  const row = await get('SELECT * FROM boards WHERE id = ?', [Number(boardId)]);
  if (!row) throw new HttpError(404, 'Tablón no encontrado.');
  await getCampaignForUser(row.campaign_id, user);
  if (user.role === 'player') {
    const canAccess = await get(`
      SELECT 1 FROM characters ch
      JOIN character_campaigns cc ON cc.character_id = ch.id
      WHERE ch.user_id = ? AND cc.campaign_id = ?
      AND (
        NOT EXISTS (SELECT 1 FROM character_board_access WHERE character_id = ch.id)
        OR EXISTS (SELECT 1 FROM character_board_access WHERE character_id = ch.id AND board_id = ?)
      ) LIMIT 1`, [user.id, row.campaign_id, row.id]);
    if (!canAccess) throw new HttpError(404, 'Tablón no encontrado.');
  }
  return row;
}

async function getAnnouncementForUser(announcementId, user) {
  const row = await get('SELECT * FROM announcements WHERE id = ?', [Number(announcementId)]);
  if (!row) throw new HttpError(404, 'Anuncio no encontrado.');
  await getCampaignForUser(row.campaign_id, user);
  if (user.role === 'player') {
    if (row.status === 'archivado' || row.hidden_from_players) throw new HttpError(404, 'Anuncio no encontrado.');
    if (row.status === 'arrancado') {
      const myPull = await get(
        `SELECT 1 FROM pull_records WHERE announcement_id = ? AND player_id = ? AND active = 1`,
        [row.id, user.id]
      );
      if (!myPull) throw new HttpError(404, 'Anuncio no encontrado.');
    }
  }
  return row;
}

async function campaignDto(row) {
  const stats = await get(`
    SELECT
      (SELECT COUNT(*) FROM boards WHERE campaign_id = ?) AS board_count,
      (SELECT COUNT(*) FROM announcements WHERE campaign_id = ?) AS announcement_count,
      (SELECT COUNT(*) FROM campaign_players WHERE campaign_id = ? AND status = 'active') AS player_count,
      (SELECT COUNT(*) FROM character_campaigns WHERE campaign_id = ?) AS character_count`,
    [row.id, row.id, row.id, row.id]
  );
  return {
    id: Number(row.id), name: row.name, description: row.description,
    dmId: row.dm_id, createdAt: row.created_at, updatedAt: row.updated_at, stats,
  };
}

async function boardDto(row) {
  const stats = await get(`
    SELECT COUNT(*) AS announcement_count,
      SUM(CASE WHEN status = 'disponible' THEN 1 ELSE 0 END) AS available_count,
      SUM(CASE WHEN status = 'arrancado' THEN 1 ELSE 0 END) AS pulled_count
    FROM announcements WHERE board_id = ?`, [row.id]);
  return {
    id: Number(row.id), campaignId: row.campaign_id, name: row.name,
    description: row.description, type: row.type,
    createdAt: row.created_at, updatedAt: row.updated_at,
    stats: {
      announcementCount: Number(stats?.announcement_count ?? 0),
      availableCount: Number(stats?.available_count ?? 0),
      pulledCount: Number(stats?.pulled_count ?? 0),
    },
  };
}

async function pullForAnnouncement(announcementId) {
  return get(`
    SELECT pr.*, u.display_name AS player_name, u.username, ch.name AS character_name
    FROM pull_records pr
    JOIN users u ON u.id = pr.player_id
    JOIN characters ch ON ch.id = pr.character_id
    WHERE pr.announcement_id = ? AND pr.active = 1`, [announcementId]);
}

async function announcementDto(row, user, includePrivate = false) {
  const pull = await pullForAnnouncement(row.id);
  const dto = {
    id: Number(row.id), campaignId: row.campaign_id, boardId: row.board_id,
    title: row.title, publicText: row.public_text,
    tags: parseTags(row.tags), status: row.status,
    worldDate: row.world_date, hiddenFromPlayers: Boolean(row.hidden_from_players),
    createdAt: row.created_at, updatedAt: row.updated_at,
    pull: pull ? {
      id: pull.id, playerId: pull.player_id, playerName: pull.player_name,
      username: pull.username, characterId: pull.character_id,
      characterName: pull.character_name, pulledAt: pull.pulled_at,
    } : null,
  };
  if (includePrivate && (user.role === 'dm' || user.role === 'admin')) {
    dto.private = {
      realSummary: row.real_summary, narrativeHook: row.narrative_hook,
      secretInformation: row.secret_information, involvedNpcs: row.involved_npcs,
      relevantLocations: row.relevant_locations, possibleComplications: row.possible_complications,
      realReward: row.real_reward, ignoredConsequences: row.ignored_consequences,
      dmNotes: row.dm_notes, prepState: row.prep_state,
    };
  }
  return dto;
}

const VALID_CHAR_STATUSES = ['activo', 'retirado', 'muerto', 'desaparecido'];

function characterDto(row, includePrivate = false) {
  const dto = {
    id: Number(row.id), userId: row.user_id, campaignId: row.campaign_id,
    name: row.name, ancestry: row.ancestry, archetype: row.archetype,
    notes: row.notes, status: row.status || 'activo', deathNote: row.death_note || '',
    playerName: row.player_name, username: row.username,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
  if (includePrivate) dto.dmNotes = row.dm_notes || '';
  return dto;
}

function notificationDto(row) {
  return {
    id: row.id, campaignId: row.campaign_id, announcementId: row.announcement_id,
    pullRecordId: row.pull_record_id, type: row.type,
    message: row.message, readAt: row.read_at, createdAt: row.created_at,
  };
}

async function insertUser(username, displayName, role, password) {
  const { salt, hash } = hashPassword(password);
  const result = await run(
    `INSERT INTO users (username, display_name, role, password_hash, password_salt, dm_password_hint, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
    [username.toLowerCase().trim(), displayName, role, hash, salt, password, now()]
  );
  return Number(result.lastInsertRowid);
}

async function getBoardAccessIds(characterId) {
  const rows = await all('SELECT board_id FROM character_board_access WHERE character_id = ?', [characterId]);
  return rows.map(r => Number(r.board_id));
}

async function setBoardAccess(characterId, boardIds) {
  const timestamp = now();
  const tx = await db.transaction('write');
  try {
    await tx.execute({ sql: 'DELETE FROM character_board_access WHERE character_id = ?', args: [characterId] });
    for (const boardId of boardIds) {
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO character_board_access (character_id, board_id, created_at) VALUES (?, ?, ?)',
        args: [characterId, boardId, timestamp],
      });
    }
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
}

async function getCharacterForDm(charId, user) {
  requireDm(user);
  const row = await get('SELECT * FROM characters WHERE id = ?', [Number(charId)]);
  if (!row) throw new HttpError(404, 'Personaje no encontrado.');
  if (user.role !== 'admin') {
    const hasAccess = await get(`
      SELECT 1 FROM character_campaigns cc
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE cc.character_id = ? AND (
        c.dm_id = ?
        OR EXISTS (SELECT 1 FROM campaign_dms cd WHERE cd.campaign_id = c.id AND cd.user_id = ?)
      ) LIMIT 1`, [row.id, user.id, user.id]);
    if (!hasAccess) throw new HttpError(403, 'No tienes permiso sobre este personaje.');
  }
  return row;
}

// ─── SEED & ADMIN ─────────────────────────────────────────────────────────────
async function seedDatabase() {
  const countRow = await get('SELECT COUNT(*) AS count FROM users');
  if (Number(countRow.count) > 0) return;

  const tx = await db.transaction('write');
  try {
    const created = now();
    const { salt: s1, hash: h1 } = hashPassword('dm123');
    const r1 = await tx.execute({
      sql: `INSERT INTO users (username, display_name, role, password_hash, password_salt, dm_password_hint, email, created_at)
            VALUES ('dm', 'Maestre del Tablón', 'dm', ?, ?, 'dm123', '', ?)`,
      args: [h1, s1, created],
    });
    const dmId = Number(r1.lastInsertRowid);

    const { salt: s2, hash: h2 } = hashPassword('jugador123');
    const r2 = await tx.execute({
      sql: `INSERT INTO users (username, display_name, role, password_hash, password_salt, dm_password_hint, email, created_at)
            VALUES ('jugador', 'Elena de las Marismas', 'player', ?, ?, 'jugador123', '', ?)`,
      args: [h2, s2, created],
    });
    const playerId = Number(r2.lastInsertRowid);

    const r3 = await tx.execute({
      sql: `INSERT INTO campaigns (dm_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [dmId, 'Marcas de Ceniza', 'Una comarca de aldeas húmedas, deudas viejas y caminos donde nadie canta después del ocaso.', created, created],
    });
    const campaignId = Number(r3.lastInsertRowid);

    await tx.execute({ sql: `INSERT INTO campaign_players (campaign_id, player_id, status, created_at) VALUES (?, ?, 'active', ?)`, args: [campaignId, playerId, created] });
    await tx.execute({ sql: `INSERT INTO campaign_dms (campaign_id, user_id, created_at) VALUES (?, ?, ?)`, args: [campaignId, dmId, created] });

    const r4 = await tx.execute({
      sql: `INSERT INTO boards (campaign_id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, 'taberna', ?, ?)`,
      args: [campaignId, 'Taberna del Diente Negro', 'La pared junto al hogar, ennegrecida por humo y promesas incumplidas.', created, created],
    });
    const tavernBoardId = Number(r4.lastInsertRowid);

    const r5 = await tx.execute({
      sql: `INSERT INTO boards (campaign_id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, 'gremio', ?, ?)`,
      args: [campaignId, 'Gremio de Carreteros', 'Tablas con sellos de ruta, quejas de porteadores y avisos escritos con manos temblorosas.', created, created],
    });
    const roadBoardId = Number(r5.lastInsertRowid);

    const r6 = await tx.execute({
      sql: `INSERT INTO boards (campaign_id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, 'autoridad local', ?, ?)`,
      args: [campaignId, 'Alguacilazgo de Vado Hondo', 'Órdenes clavadas torcidas bajo una lámpara de aceite que nunca parece bastar.', created, created],
    });
    const lawBoardId = Number(r6.lastInsertRowid);

    await tx.execute({
      sql: `INSERT INTO characters (user_id, campaign_id, name, ancestry, archetype, notes, created_at, updated_at)
            VALUES (?, ?, 'Bruna de la Turbera', 'Humana', 'Rastreadora', 'No duerme bien cerca del agua estancada.', ?, ?)`,
      args: [playerId, campaignId, created, created],
    });

    const anSql = `INSERT INTO announcements (campaign_id, board_id, created_by, title, public_text, tags, status,
      world_date, real_summary, narrative_hook, secret_information, involved_npcs, relevant_locations,
      possible_complications, real_reward, ignored_consequences, dm_notes, prep_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await tx.execute({ sql: anSql, args: [
      campaignId, tavernBoardId, dmId,
      'Plata limpia por ganado muerto',
      'Se pagará plata limpia a quien encuentre qué está matando al ganado al norte del vado. No preguntéis por los cuerpos.',
      JSON.stringify(['investigación', 'caza de monstruos', 'rural', 'rumor']), 'disponible', 'Día 17 de Nieblas',
      'Un carnicero local alimenta a una criatura nacida de un pacto fallido para mantener el matadero próspero.',
      'Las reses aparecen abiertas con precisión ritual, no devoradas.',
      'Marta sabe más de lo que admite: su hijo firmó el pacto y ahora está desaparecido.',
      'Marta Frunce; Simo el Carnicero; el hijo de Marta, Elian.',
      'Vado Norte; matadero viejo; cañaverales junto al río.',
      'Los aldeanos culpan a forasteros; el carnicero puede ofrecer un soborno.',
      'Una bolsa de plata ennegrecida y acceso a carne salada para futuras expediciones.',
      'La criatura empezará a tomar niños cuando el ganado no baste.',
      'Mantener el tono sucio y cotidiano. No convertirlo en una caza heroica.',
      'preparada', created, created,
    ]});

    await tx.execute({ sql: anSql, args: [
      campaignId, roadBoardId, dmId,
      'La cuarta caravana saldrá igual',
      'El Gremio de Carreteros busca escolta para cruzar el Camino Hundido. Tres caravanas han desaparecido. La cuarta saldrá igual.',
      JSON.stringify(['escolta', 'exploración', 'urgente', 'facción']), 'disponible', 'Última luna menguante',
      'El gremio oculta que las caravanas transportaban reliquias robadas a un priorato hundido.',
      'La ruta está marcada por ruedas que no coinciden con ningún carro vivo.',
      'Los desaparecidos no están muertos: trabajan para pagar una deuda con algo bajo el camino.',
      'Roven Cuerda; hermana Ilda; una cuadrilla de carreteros endeudados.',
      'Camino Hundido; priorato sumergido; mojón de los siete clavos.',
      'La carga puede maldecir a quien la toque sin guantes de hierro.',
      'Dinero, una ruta segura temporal y una reliquia menor si negocian bien.',
      'El Camino Hundido se cerrará por completo y aislará Vado Hondo.',
      'Ideal para viaje tenso, niebla baja y decisiones sobre carga robada.',
      'idea', created, created,
    ]});

    await tx.execute({ sql: anSql, args: [
      campaignId, lawBoardId, dmId,
      'Orden sobre el pozo viejo',
      'Por orden del alguacil: queda prohibido acercarse al pozo viejo tras la puesta de sol. Recompensa por información útil.',
      JSON.stringify(['investigación', 'autoridad local', 'rumor']), 'disponible', 'Bando del tercer día',
      'El alguacil intenta tapar que usó el pozo para deshacerse de pruebas de un juicio falso.',
      'Cada noche alguien desde el fondo recita nombres de vecinos vivos.',
      'La voz no es un muerto: es una testigo encerrada en una cámara de contrabandistas.',
      'Alguacil Brecht; Nara la aguadora; Tom el pregonero.',
      'Pozo viejo; archivo húmedo del alguacilazgo; túnel de los curtidores.',
      'Si liberan a la testigo, media guardia local intentará silenciarla.',
      'Licencias, favores o chantaje político.',
      'Brecht ejecutará a un inocente para cerrar el asunto.',
      'Buen anuncio corto para una sesión de intriga de una noche.',
      'preparada', created, created,
    ]});

    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
}

async function ensureAdminUser() {
  const existing = await get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing) return;
  const pwd = crypto.randomBytes(6).toString('hex');
  const { salt, hash } = hashPassword(pwd);
  await run(
    `INSERT INTO users (username, display_name, role, email, password_hash, password_salt, dm_password_hint, created_at)
     VALUES ('javier', 'Javier (Admin)', 'admin', 'javierelio@outlook.com', ?, ?, ?, ?)`,
    [hash, salt, pwd, now()]
  );
  console.log(`\n⚔  ADMIN CREADO — Usuario: javier / Contraseña: ${pwd}\n`);
}

async function migrateData() {
  const campaigns = await all('SELECT id, dm_id FROM campaigns WHERE dm_id IS NOT NULL');
  for (const c of campaigns) {
    await run('INSERT OR IGNORE INTO campaign_dms (campaign_id, user_id, created_at) VALUES (?, ?, ?)',
      [c.id, c.dm_id, now()]);
  }
  const chars = await all('SELECT id, campaign_id FROM characters WHERE campaign_id IS NOT NULL');
  for (const ch of chars) {
    await run('INSERT OR IGNORE INTO character_campaigns (character_id, campaign_id, created_at) VALUES (?, ?, ?)',
      [ch.id, ch.campaign_id, now()]);
  }
}

// ─── BUSINESS LOGIC ───────────────────────────────────────────────────────────
async function createCampaign(body, user) {
  requireDm(user);
  requireFields(body, ['name']);
  const timestamp = now();
  let ownerDmId = user.id;
  if (user.role === 'admin' && Number(body.dmId)) {
    const targetDm = await get("SELECT id FROM users WHERE id = ? AND role = 'dm'", [Number(body.dmId)]);
    if (!targetDm) throw new HttpError(400, 'El usuario especificado no existe o no tiene rol de Maestro.');
    ownerDmId = Number(targetDm.id);
  }
  const result = await run(
    `INSERT INTO campaigns (dm_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [ownerDmId, asText(body.name), asText(body.description), timestamp, timestamp]
  );
  const campaignId = Number(result.lastInsertRowid);
  await run('INSERT OR IGNORE INTO campaign_dms (campaign_id, user_id, created_at) VALUES (?, ?, ?)',
    [campaignId, ownerDmId, timestamp]);
  return campaignDto(await get('SELECT * FROM campaigns WHERE id = ?', [campaignId]));
}

async function updateCampaign(id, body, user) {
  requireDm(user);
  const campaign = await getCampaignForUser(id, user);
  await run(`UPDATE campaigns SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
    [asText(body.name) || campaign.name, asText(body.description), now(), campaign.id]);
  return campaignDto(await get('SELECT * FROM campaigns WHERE id = ?', [campaign.id]));
}

async function createBoard(campaignId, body, user) {
  requireDm(user);
  const campaign = await getCampaignForUser(campaignId, user);
  requireFields(body, ['name']);
  const timestamp = now();
  const result = await run(
    `INSERT INTO boards (campaign_id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [campaign.id, asText(body.name), asText(body.description), asText(body.type) || 'otro', timestamp, timestamp]
  );
  return boardDto(await get('SELECT * FROM boards WHERE id = ?', [Number(result.lastInsertRowid)]));
}

async function updateBoard(id, body, user) {
  requireDm(user);
  const board = await getBoardForUser(id, user);
  await run(`UPDATE boards SET name = ?, description = ?, type = ?, updated_at = ? WHERE id = ?`,
    [asText(body.name) || board.name, asText(body.description), asText(body.type) || 'otro', now(), board.id]);
  return boardDto(await get('SELECT * FROM boards WHERE id = ?', [board.id]));
}

async function createAnnouncement(boardId, body, user) {
  requireDm(user);
  const board = await getBoardForUser(boardId, user);
  requireFields(body, ['title', 'publicText']);
  const timestamp = now();
  const tags = JSON.stringify(normalizeTags(body.tags));
  const result = await run(
    `INSERT INTO announcements (campaign_id, board_id, created_by, title, public_text, tags, status, world_date,
      hidden_from_players, real_summary, narrative_hook, secret_information, involved_npcs, relevant_locations,
      possible_complications, real_reward, ignored_consequences, dm_notes, prep_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [board.campaign_id, board.id, user.id, asText(body.title), asText(body.publicText), tags,
     asText(body.status) || 'disponible', asText(body.worldDate), body.hiddenFromPlayers ? 1 : 0,
     asText(body.realSummary), asText(body.narrativeHook), asText(body.secretInformation),
     asText(body.involvedNpcs), asText(body.relevantLocations), asText(body.possibleComplications),
     asText(body.realReward), asText(body.ignoredConsequences), asText(body.dmNotes),
     asText(body.prepState) || 'idea', timestamp, timestamp]
  );
  const row = await get('SELECT * FROM announcements WHERE id = ?', [Number(result.lastInsertRowid)]);
  return announcementDto(row, user, true);
}

async function updateAnnouncement(id, body, user) {
  requireDm(user);
  const announcement = await getAnnouncementForUser(id, user);
  const tags = JSON.stringify(normalizeTags(body.tags));
  await run(
    `UPDATE announcements SET title = ?, public_text = ?, tags = ?, status = ?, world_date = ?,
      hidden_from_players = ?, real_summary = ?, narrative_hook = ?, secret_information = ?,
      involved_npcs = ?, relevant_locations = ?, possible_complications = ?, real_reward = ?,
      ignored_consequences = ?, dm_notes = ?, prep_state = ?, updated_at = ? WHERE id = ?`,
    [asText(body.title) || announcement.title, asText(body.publicText) || announcement.public_text,
     tags, asText(body.status) || announcement.status, asText(body.worldDate), body.hiddenFromPlayers ? 1 : 0,
     asText(body.realSummary), asText(body.narrativeHook), asText(body.secretInformation),
     asText(body.involvedNpcs), asText(body.relevantLocations), asText(body.possibleComplications),
     asText(body.realReward), asText(body.ignoredConsequences), asText(body.dmNotes),
     asText(body.prepState) || 'idea', now(), announcement.id]
  );
  const row = await get('SELECT * FROM announcements WHERE id = ?', [announcement.id]);
  return announcementDto(row, user, true);
}

async function setAnnouncementStatus(id, status, user) {
  requireDm(user);
  const allowed = new Set(['disponible', 'completado', 'archivado']);
  if (!allowed.has(status)) throw new HttpError(400, 'Estado no válido. Usa disponible, completado o archivado.');
  const announcement = await getAnnouncementForUser(id, user);
  await run('UPDATE announcements SET status = ?, updated_at = ? WHERE id = ?', [status, now(), announcement.id]);
  const row = await get('SELECT * FROM announcements WHERE id = ?', [announcement.id]);
  return announcementDto(row, user, true);
}

async function createCharacter(campaignId, body, user) {
  requireDm(user);
  await getCampaignForUser(campaignId, user);
  const targetCampaign = await getCampaignForUser(Number(body.campaignId) || campaignId, user);
  requireFields(body, ['name', 'playerUsername']);
  const player = await get(`
    SELECT u.* FROM users u
    JOIN campaign_players cp ON cp.player_id = u.id
    WHERE LOWER(u.username) = LOWER(?) AND u.role = 'player' AND cp.campaign_id = ? AND cp.status = 'active'`,
    [asText(body.playerUsername).trim(), targetCampaign.id]);
  if (!player) throw new HttpError(400, 'Ese username no corresponde a un jugador vinculado a la campaña.');
  const timestamp = now();
  const result = await run(
    `INSERT INTO characters (user_id, campaign_id, name, ancestry, archetype, notes, dm_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [player.id, targetCampaign.id, asText(body.name), asText(body.ancestry), asText(body.archetype),
     asText(body.notes), asText(body.dmNotes), timestamp, timestamp]
  );
  const charId = Number(result.lastInsertRowid);
  await run('INSERT OR IGNORE INTO character_campaigns (character_id, campaign_id, created_at) VALUES (?, ?, ?)',
    [charId, targetCampaign.id, timestamp]);
  const row = await get(`
    SELECT ch.*, u.display_name AS player_name, u.username FROM characters ch
    JOIN users u ON u.id = ch.user_id WHERE ch.id = ?`, [charId]);
  return characterDto(row, true);
}

async function updateCharacter(id, body, user) {
  requireDm(user);
  const row = await get('SELECT * FROM characters WHERE id = ?', [Number(id)]);
  if (!row) throw new HttpError(404, 'Personaje no encontrado.');
  const campaign = await getCampaignForUser(row.campaign_id, user);
  const targetCampaign = body.campaignId !== undefined && Number(body.campaignId)
    ? await getCampaignForUser(Number(body.campaignId), user) : campaign;

  let playerId = row.user_id;
  if (body.playerUsername !== undefined && asText(body.playerUsername)) {
    const player = await get(`
      SELECT u.* FROM users u JOIN campaign_players cp ON cp.player_id = u.id
      WHERE u.username = ? AND u.role = 'player' AND cp.campaign_id = ? AND cp.status = 'active'`,
      [asText(body.playerUsername), targetCampaign.id]);
    if (!player) throw new HttpError(400, 'Ese username no corresponde a un jugador vinculado a la campaña.');
    playerId = player.id;
  }

  const newStatus = body.status && VALID_CHAR_STATUSES.includes(body.status) ? body.status : row.status || 'activo';
  const goingInactive = newStatus !== 'activo' && (row.status || 'activo') === 'activo';
  const ownershipChanging = playerId !== row.user_id || targetCampaign.id !== row.campaign_id;
  const timestamp = now();

  const tx = await db.transaction('write');
  try {
    if (goingInactive || ownershipChanging) {
      const activePulls = await all(
        `SELECT announcement_id FROM pull_records WHERE character_id = ? AND active = 1`, [row.id]
      );
      await tx.execute({
        sql: `UPDATE pull_records SET active = 0, reverted_at = ?, reverted_by = ? WHERE character_id = ? AND active = 1`,
        args: [timestamp, user.id, row.id],
      });
      for (const pull of activePulls) {
        await tx.execute({
          sql: `UPDATE announcements SET status = 'disponible', updated_at = ? WHERE id = ?`,
          args: [timestamp, pull.announcement_id],
        });
      }
    }
    await tx.execute({
      sql: `UPDATE characters SET user_id = ?, campaign_id = ?, name = ?, ancestry = ?, archetype = ?,
            notes = ?, dm_notes = ?, status = ?, death_note = ?, updated_at = ? WHERE id = ?`,
      args: [playerId, targetCampaign.id, asText(body.name) || row.name, asText(body.ancestry),
             asText(body.archetype), asText(body.notes), asText(body.dmNotes), newStatus,
             asText(body.deathNote), timestamp, row.id],
    });
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }

  const updated = await get(`
    SELECT ch.*, u.display_name AS player_name, u.username FROM characters ch
    JOIN users u ON u.id = ch.user_id WHERE ch.id = ?`, [row.id]);
  return characterDto(updated, true);
}

async function createOrLinkPlayer(campaignId, body, user) {
  requireDm(user);
  const campaign = await getCampaignForUser(campaignId, user);
  requireFields(body, ['username']);
  let player = await get("SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND role = 'player'", [asText(body.username).trim()]);
  const password = asText(body.password);
  let created = false;
  if (password) {
    if (!player) {
      requireFields(body, ['displayName', 'password']);
      if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
      const playerId = await insertUser(asText(body.username), asText(body.displayName), 'player', password);
      player = await get("SELECT * FROM users WHERE id = ? AND role = 'player'", [playerId]);
      created = true;
    }
  }
  if (!player) throw new HttpError(404, 'Jugador no encontrado. Escribe una contraseña inicial para crearlo.');
  await run(`
    INSERT INTO campaign_players (campaign_id, player_id, status, dm_notes, created_at)
    VALUES (?, ?, 'active', ?, ?)
    ON CONFLICT(campaign_id, player_id) DO UPDATE SET status = 'active', dm_notes = excluded.dm_notes`,
    [campaign.id, player.id, asText(body.dmNotes), now()]);
  return { id: player.id, username: player.username, displayName: player.display_name, status: 'active', dmNotes: asText(body.dmNotes), created };
}

async function removePlayerFromCampaign(campaignId, playerId, user) {
  requireDm(user);
  const campaign = await getCampaignForUser(campaignId, user);
  const player = await get(`
    SELECT u.* FROM users u JOIN campaign_players cp ON cp.player_id = u.id
    WHERE u.id = ? AND u.role = 'player' AND cp.campaign_id = ? AND cp.status = 'active'`,
    [Number(playerId), campaign.id]);
  if (!player) throw new HttpError(404, 'Jugador no encontrado en esta campaña.');
  const timestamp = now();

  const tx = await db.transaction('write');
  try {
    const activePulls = await all(`
      SELECT pr.announcement_id FROM pull_records pr JOIN characters ch ON ch.id = pr.character_id
      WHERE pr.campaign_id = ? AND pr.player_id = ? AND pr.active = 1`, [campaign.id, player.id]);
    await tx.execute({
      sql: `UPDATE pull_records SET active = 0, reverted_at = ?, reverted_by = ?
            WHERE campaign_id = ? AND player_id = ? AND active = 1`,
      args: [timestamp, user.id, campaign.id, player.id],
    });
    for (const pull of activePulls) {
      await tx.execute({
        sql: `UPDATE announcements SET status = 'disponible', updated_at = ? WHERE id = ?`,
        args: [timestamp, pull.announcement_id],
      });
    }
    await tx.execute({
      sql: `DELETE FROM character_campaigns WHERE campaign_id = ? AND character_id IN (SELECT id FROM characters WHERE user_id = ?)`,
      args: [campaign.id, player.id],
    });
    await tx.execute({ sql: `DELETE FROM campaign_players WHERE campaign_id = ? AND player_id = ?`, args: [campaign.id, player.id] });
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }

  return { id: player.id, username: player.username, displayName: player.display_name };
}

async function pullAnnouncement(id, body, user) {
  requirePlayer(user);
  const announcement = await getAnnouncementForUser(id, user);
  if (announcement.status !== 'disponible') throw new HttpError(409, 'Este anuncio ya no está disponible.');

  const characterId = Number(body.characterId);
  const character = await get(`
    SELECT ch.* FROM characters ch JOIN character_campaigns cc ON cc.character_id = ch.id
    WHERE ch.id = ? AND ch.user_id = ? AND cc.campaign_id = ?`,
    [characterId, user.id, announcement.campaign_id]);
  if (!character) throw new HttpError(403, 'Ese personaje no pertenece a tu cuenta o campaña.');
  if ((character.status || 'activo') !== 'activo') {
    const labels = { muerto: 'ha muerto', retirado: 'está retirado', desaparecido: 'está desaparecido' };
    throw new HttpError(409, `${character.name} ${labels[character.status] || 'no está activo'} y no puede aceptar encargos.`);
  }

  const timestamp = now();
  const campaignDmIds = (await all(`SELECT DISTINCT user_id FROM campaign_dms WHERE campaign_id = ?`, [announcement.campaign_id])).map(r => Number(r.user_id));
  const legacyCampaign = await get('SELECT dm_id FROM campaigns WHERE id = ?', [announcement.campaign_id]);
  if (legacyCampaign?.dm_id && !campaignDmIds.includes(Number(legacyCampaign.dm_id))) {
    campaignDmIds.push(Number(legacyCampaign.dm_id));
  }

  const tx = await db.transaction('write');
  try {
    const r = await tx.execute({
      sql: `INSERT INTO pull_records (announcement_id, campaign_id, board_id, player_id, character_id, pulled_at, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)`,
      args: [announcement.id, announcement.campaign_id, announcement.board_id, user.id, character.id, timestamp],
    });
    await tx.execute({
      sql: `UPDATE announcements SET status = 'arrancado', updated_at = ? WHERE id = ?`,
      args: [timestamp, announcement.id],
    });
    const pullRecordId = Number(r.lastInsertRowid);
    const message = `${user.displayName} arrancó "${announcement.title}" con ${character.name}.`;
    for (const dmId of campaignDmIds) {
      await tx.execute({
        sql: `INSERT INTO notifications (user_id, campaign_id, announcement_id, pull_record_id, type, message, created_at)
              VALUES (?, ?, ?, ?, 'announcement_pulled', ?, ?)`,
        args: [dmId, announcement.campaign_id, announcement.id, pullRecordId, message, timestamp],
      });
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    if (String(e.message).includes('idx_active_pull_per_announcement')) throw new HttpError(409, 'Este anuncio ya fue arrancado.');
    throw e;
  }

  const row = await get('SELECT * FROM announcements WHERE id = ?', [announcement.id]);
  return announcementDto(row, user, false);
}

async function revertPull(id, user) {
  requireDm(user);
  const announcement = await getAnnouncementForUser(id, user);
  const pull = await pullForAnnouncement(announcement.id);
  if (!pull) throw new HttpError(404, 'No hay registro activo para revertir.');
  const timestamp = now();

  const tx = await db.transaction('write');
  try {
    await tx.execute({
      sql: `UPDATE pull_records SET active = 0, reverted_at = ?, reverted_by = ? WHERE id = ?`,
      args: [timestamp, user.id, pull.id],
    });
    await tx.execute({
      sql: `UPDATE announcements SET status = 'disponible', updated_at = ? WHERE id = ?`,
      args: [timestamp, announcement.id],
    });
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }

  const row = await get('SELECT * FROM announcements WHERE id = ?', [announcement.id]);
  return announcementDto(row, user, true);
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
async function handleApi(req, res, url) {
  const { pathname } = url;

  // ── Rutas públicas ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readJson(req);
    requireFields(body, ['username', 'password']);
    const row = await get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [asText(body.username).trim()]);
    if (!row || !verifyPassword(asText(body.password), row.password_salt, row.password_hash))
      throw new HttpError(401, 'Credenciales incorrectas.');
    const token = await createSession(Number(row.id));
    send(res, 200, { token, user: rowUser(row) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/forgot-password') {
    const body = await readJson(req);
    requireFields(body, ['email']);
    const row = await get("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND role IN ('dm','admin')", [asText(body.email).trim()]);
    if (row) {
      const rawToken = crypto.randomBytes(24).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await run('DELETE FROM password_resets WHERE user_id = ?', [row.id]);
      await run('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
        [row.id, tokenHash(rawToken), expires, now()]);
      send(res, 200, { resetToken: rawToken });
    } else {
      send(res, 200, { resetToken: null });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reset-password') {
    const body = await readJson(req);
    requireFields(body, ['token', 'password']);
    const raw = asText(body.token).trim();
    const resetRow = await get('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?', [tokenHash(raw), now()]);
    if (!resetRow) throw new HttpError(400, 'Código inválido o caducado.');
    const newPwd = asText(body.password);
    if (newPwd.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
    const { salt, hash } = hashPassword(newPwd);
    await run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, resetRow.user_id]);
    await run('DELETE FROM password_resets WHERE user_id = ?', [resetRow.user_id]);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    throw new HttpError(403, 'El registro de jugadores lo gestiona el Dungeon Master.');
  }

  // ── Rutas autenticadas ──────────────────────────────────────────────────────
  const user = await requireUser(req);

  if (req.method === 'GET' && pathname === '/api/me') {
    send(res, 200, { user }); return;
  }

  if (req.method === 'PUT' && pathname === '/api/me') {
    const body = await readJson(req);
    const updates = {};
    if (body.email !== undefined) updates.email = asText(body.email).trim().toLowerCase();
    if (body.displayName !== undefined && asText(body.displayName)) updates.display_name = asText(body.displayName);
    if (body.newPassword) {
      if (!body.currentPassword) throw new HttpError(400, 'Indica tu contraseña actual.');
      const row = await get('SELECT * FROM users WHERE id = ?', [user.id]);
      if (!verifyPassword(asText(body.currentPassword), row.password_salt, row.password_hash))
        throw new HttpError(401, 'Contraseña actual incorrecta.');
      if (asText(body.newPassword).length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres.');
      const { salt, hash } = hashPassword(asText(body.newPassword));
      updates.password_hash = hash;
      updates.password_salt = salt;
    }
    if (Object.keys(updates).length) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await run(`UPDATE users SET ${sets} WHERE id = ?`, [...Object.values(updates), user.id]);
    }
    const updated = await get('SELECT * FROM users WHERE id = ?', [user.id]);
    send(res, 200, { user: rowUser(updated) }); return;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    const [, token] = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [];
    if (token) await run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
    send(res, 200, { ok: true }); return;
  }

  // ── Campañas ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/campaigns') {
    let rows;
    if (user.role === 'admin') {
      rows = await all('SELECT * FROM campaigns ORDER BY updated_at DESC');
    } else if (user.role === 'dm') {
      rows = await all(`
        SELECT DISTINCT c.* FROM campaigns c
        WHERE c.dm_id = ? OR EXISTS (SELECT 1 FROM campaign_dms cd WHERE cd.campaign_id = c.id AND cd.user_id = ?)
        ORDER BY c.updated_at DESC`, [user.id, user.id]);
    } else {
      rows = await all(`
        SELECT c.* FROM campaigns c JOIN campaign_players cp ON cp.campaign_id = c.id
        WHERE cp.player_id = ? AND cp.status = 'active' ORDER BY c.updated_at DESC`, [user.id]);
    }
    send(res, 200, { campaigns: await Promise.all(rows.map(campaignDto)) }); return;
  }

  if (req.method === 'POST' && pathname === '/api/campaigns') {
    const body = await readJson(req);
    send(res, 201, { campaign: await createCampaign(body, user) }); return;
  }

  let match = pathname.match(/^\/api\/campaigns\/(\d+)$/);
  if (match && req.method === 'GET') {
    const campaign = await getCampaignForUser(match[1], user);
    send(res, 200, { campaign: await campaignDto(campaign) }); return;
  }
  if (match && req.method === 'PUT') {
    const body = await readJson(req);
    send(res, 200, { campaign: await updateCampaign(match[1], body, user) }); return;
  }
  if (match && req.method === 'DELETE') {
    requireDm(user);
    const campaign = await getCampaignForUser(match[1], user);
    await run('DELETE FROM campaigns WHERE id = ?', [campaign.id]);
    send(res, 200, { ok: true }); return;
  }

  // ── Tablones ────────────────────────────────────────────────────────────────
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/boards$/);
  if (match && req.method === 'GET') {
    const campaign = await getCampaignForUser(match[1], user);
    const rows = user.role !== 'player'
      ? await all('SELECT * FROM boards WHERE campaign_id = ? ORDER BY created_at ASC', [campaign.id])
      : await all(`
          SELECT DISTINCT b.* FROM boards b WHERE b.campaign_id = ?
          AND EXISTS (
            SELECT 1 FROM characters ch JOIN character_campaigns cc ON cc.character_id = ch.id
            WHERE ch.user_id = ? AND cc.campaign_id = b.campaign_id
            AND (
              NOT EXISTS (SELECT 1 FROM character_board_access cba WHERE cba.character_id = ch.id)
              OR EXISTS (SELECT 1 FROM character_board_access cba WHERE cba.character_id = ch.id AND cba.board_id = b.id)
            )
          ) ORDER BY b.created_at ASC`, [campaign.id, user.id]);
    send(res, 200, { boards: await Promise.all(rows.map(boardDto)) }); return;
  }
  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 201, { board: await createBoard(match[1], body, user) }); return;
  }

  match = pathname.match(/^\/api\/boards\/(\d+)$/);
  if (match && req.method === 'PUT') {
    const body = await readJson(req);
    send(res, 200, { board: await updateBoard(match[1], body, user) }); return;
  }
  if (match && req.method === 'DELETE') {
    requireDm(user);
    const board = await getBoardForUser(match[1], user);
    await run('DELETE FROM boards WHERE id = ?', [board.id]);
    send(res, 200, { ok: true }); return;
  }

  // ── Anuncios ────────────────────────────────────────────────────────────────
  match = pathname.match(/^\/api\/boards\/(\d+)\/announcements$/);
  if (match && req.method === 'GET') {
    const board = await getBoardForUser(match[1], user);
    let rows;
    if (user.role === 'player') {
      rows = await all(`
        SELECT * FROM announcements WHERE board_id = ? AND status != 'archivado'
        AND hidden_from_players = 0
        AND (status != 'arrancado' OR EXISTS (
          SELECT 1 FROM pull_records pr WHERE pr.announcement_id = announcements.id AND pr.player_id = ? AND pr.active = 1
        )) ORDER BY created_at DESC`, [board.id, user.id]);
    } else {
      rows = await all(`SELECT * FROM announcements WHERE board_id = ? ORDER BY created_at DESC`, [board.id]);
    }
    const includePrivate = user.role !== 'player';
    send(res, 200, { announcements: await Promise.all(rows.map(r => announcementDto(r, user, includePrivate))) }); return;
  }
  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 201, { announcement: await createAnnouncement(match[1], body, user) }); return;
  }

  match = pathname.match(/^\/api\/announcements\/(\d+)$/);
  if (match && req.method === 'GET') {
    const row = await getAnnouncementForUser(match[1], user);
    send(res, 200, { announcement: await announcementDto(row, user, user.role !== 'player') }); return;
  }
  if (match && req.method === 'PUT') {
    const body = await readJson(req);
    send(res, 200, { announcement: await updateAnnouncement(match[1], body, user) }); return;
  }
  if (match && req.method === 'DELETE') {
    requireDm(user);
    const announcement = await getAnnouncementForUser(match[1], user);
    await run('DELETE FROM announcements WHERE id = ?', [announcement.id]);
    send(res, 200, { ok: true }); return;
  }

  match = pathname.match(/^\/api\/announcements\/(\d+)\/status$/);
  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 200, { announcement: await setAnnouncementStatus(match[1], asText(body.status), user) }); return;
  }

  match = pathname.match(/^\/api\/announcements\/(\d+)\/pull$/);
  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 200, { announcement: await pullAnnouncement(match[1], body, user) }); return;
  }

  match = pathname.match(/^\/api\/announcements\/(\d+)\/revert$/);
  if (match && req.method === 'POST') {
    send(res, 200, { announcement: await revertPull(match[1], user) }); return;
  }

  // ── Personajes ──────────────────────────────────────────────────────────────
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/characters$/);
  if (match && req.method === 'GET') {
    const campaign = await getCampaignForUser(match[1], user);
    const rows = user.role !== 'player'
      ? await all(`
          SELECT ch.*, u.display_name AS player_name, u.username FROM characters ch
          JOIN users u ON u.id = ch.user_id JOIN character_campaigns cc ON cc.character_id = ch.id
          WHERE cc.campaign_id = ? ORDER BY u.display_name, ch.name`, [campaign.id])
      : await all(`
          SELECT ch.*, u.display_name AS player_name, u.username FROM characters ch
          JOIN users u ON u.id = ch.user_id JOIN character_campaigns cc ON cc.character_id = ch.id
          WHERE cc.campaign_id = ? AND ch.user_id = ? ORDER BY ch.name`, [campaign.id, user.id]);
    send(res, 200, { characters: rows.map(r => characterDto(r, user.role !== 'player')) }); return;
  }
  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 201, { character: await createCharacter(match[1], body, user) }); return;
  }

  match = pathname.match(/^\/api\/characters\/(\d+)$/);
  if (match && req.method === 'PUT') {
    const body = await readJson(req);
    send(res, 200, { character: await updateCharacter(match[1], body, user) }); return;
  }
  if (match && req.method === 'DELETE') {
    requireDm(user);
    const row = await get('SELECT * FROM characters WHERE id = ?', [Number(match[1])]);
    if (!row) throw new HttpError(404, 'Personaje no encontrado.');
    await getCampaignForUser(row.campaign_id, user);
    const timestamp = now();
    const tx = await db.transaction('write');
    try {
      const activePulls = await all('SELECT announcement_id FROM pull_records WHERE character_id = ? AND active = 1', [row.id]);
      await tx.execute({ sql: `UPDATE pull_records SET active = 0, reverted_at = ?, reverted_by = ? WHERE character_id = ? AND active = 1`, args: [timestamp, user.id, row.id] });
      for (const pull of activePulls) {
        await tx.execute({ sql: `UPDATE announcements SET status = 'disponible', updated_at = ? WHERE id = ?`, args: [timestamp, pull.announcement_id] });
      }
      await tx.execute({ sql: 'DELETE FROM characters WHERE id = ?', args: [row.id] });
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    send(res, 200, { ok: true }); return;
  }

  // ── Jugadores ───────────────────────────────────────────────────────────────
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/players$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const campaign = await getCampaignForUser(match[1], user);
    const players = await all(`
      SELECT u.id, u.username, u.display_name, u.dm_password_hint, cp.status, cp.dm_notes, cp.created_at
      FROM campaign_players cp JOIN users u ON u.id = cp.player_id
      WHERE cp.campaign_id = ? ORDER BY u.display_name`, [campaign.id]);
    send(res, 200, { players: players.map(r => ({
      id: r.id, username: r.username, displayName: r.display_name,
      status: r.status, dmNotes: r.dm_notes || '', dmPasswordHint: r.dm_password_hint || '', createdAt: r.created_at,
    })) }); return;
  }
  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 201, { player: await createOrLinkPlayer(match[1], body, user) }); return;
  }

  match = pathname.match(/^\/api\/campaigns\/(\d+)\/players\/(\d+)$/);
  if (match && req.method === 'DELETE') {
    send(res, 200, { player: await removePlayerFromCampaign(match[1], match[2], user) }); return;
  }

  match = pathname.match(/^\/api\/players\/(\d+)\/password$/);
  if (match && req.method === 'PUT') {
    requireDm(user);
    const body = await readJson(req);
    requireFields(body, ['password']);
    const newPwd = asText(body.password);
    if (newPwd.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
    const player = await get("SELECT * FROM users WHERE id = ? AND role = 'player'", [Number(match[1])]);
    if (!player) throw new HttpError(404, 'Jugador no encontrado.');
    const { salt, hash } = hashPassword(newPwd);
    await run('UPDATE users SET password_hash = ?, password_salt = ?, dm_password_hint = ? WHERE id = ?',
      [hash, salt, newPwd, player.id]);
    send(res, 200, { ok: true }); return;
  }

  // ── Personajes: asignación y acceso a tablones ──────────────────────────────
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/linkable-characters$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const campaign = await getCampaignForUser(match[1], user);
    const rows = await all(`
      SELECT ch.*, u.display_name AS player_name, u.username,
        CASE WHEN cc2.campaign_id IS NOT NULL THEN 1 ELSE 0 END AS in_campaign
      FROM characters ch JOIN users u ON u.id = ch.user_id
      JOIN character_campaigns cc ON cc.character_id = ch.id
      JOIN campaigns c ON c.id = cc.campaign_id
      LEFT JOIN character_campaigns cc2 ON cc2.character_id = ch.id AND cc2.campaign_id = ?
      WHERE (c.dm_id = ? OR EXISTS (SELECT 1 FROM campaign_dms cd WHERE cd.campaign_id = c.id AND cd.user_id = ?) OR ? = 'admin')
      GROUP BY ch.id ORDER BY u.display_name, ch.name`,
      [campaign.id, user.id, user.id, user.role]);
    send(res, 200, { characters: rows.map(r => ({ ...characterDto(r, true), inCampaign: Boolean(r.in_campaign) })) }); return;
  }

  match = pathname.match(/^\/api\/boards\/(\d+)\/characters$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const board = await getBoardForUser(match[1], user);
    const rows = await all(`
      SELECT ch.*, u.display_name AS player_name, u.username,
        CASE WHEN cba.board_id IS NOT NULL THEN 1 ELSE 0 END AS has_access,
        (SELECT COUNT(*) FROM character_board_access WHERE character_id = ch.id) AS restriction_count
      FROM characters ch JOIN users u ON u.id = ch.user_id
      JOIN character_campaigns cc ON cc.character_id = ch.id
      LEFT JOIN character_board_access cba ON cba.character_id = ch.id AND cba.board_id = ?
      WHERE cc.campaign_id = ? ORDER BY u.display_name, ch.name`,
      [board.id, board.campaign_id]);
    send(res, 200, { characters: rows.map(r => ({
      ...characterDto(r, true),
      hasAccess: Number(r.restriction_count) === 0 || Boolean(r.has_access),
      explicitAccess: Boolean(r.has_access),
      hasRestrictions: Number(r.restriction_count) > 0,
    })) }); return;
  }

  match = pathname.match(/^\/api\/campaigns\/(\d+)\/players\/(\d+)\/characters$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const campaign = await getCampaignForUser(match[1], user);
    const rows = await all(`
      SELECT ch.*, u.display_name AS player_name, u.username,
        CASE WHEN cc.campaign_id IS NOT NULL THEN 1 ELSE 0 END AS in_campaign
      FROM characters ch JOIN users u ON u.id = ch.user_id
      LEFT JOIN character_campaigns cc ON cc.character_id = ch.id AND cc.campaign_id = ?
      WHERE ch.user_id = ? ORDER BY ch.name`, [campaign.id, Number(match[2])]);
    send(res, 200, { characters: rows.map(r => ({ ...characterDto(r, true), inCampaign: Boolean(r.in_campaign) })) }); return;
  }

  match = pathname.match(/^\/api\/campaigns\/(\d+)\/characters\/(\d+)\/assign$/);
  if (match && req.method === 'POST') {
    requireDm(user);
    const campaign = await getCampaignForUser(match[1], user);
    const charRow = await get('SELECT * FROM characters WHERE id = ?', [Number(match[2])]);
    if (!charRow) throw new HttpError(404, 'Personaje no encontrado.');
    await run('INSERT OR IGNORE INTO character_campaigns (character_id, campaign_id, created_at) VALUES (?, ?, ?)',
      [charRow.id, campaign.id, now()]);
    send(res, 200, { ok: true }); return;
  }

  match = pathname.match(/^\/api\/campaigns\/(\d+)\/characters\/(\d+)\/unassign$/);
  if (match && req.method === 'POST') {
    requireDm(user);
    const campaign = await getCampaignForUser(match[1], user);
    const charId = Number(match[2]);
    const timestamp = now();
    const tx = await db.transaction('write');
    try {
      const activePulls = await all('SELECT announcement_id FROM pull_records WHERE character_id = ? AND campaign_id = ? AND active = 1', [charId, campaign.id]);
      await tx.execute({ sql: 'UPDATE pull_records SET active = 0, reverted_at = ?, reverted_by = ? WHERE character_id = ? AND campaign_id = ? AND active = 1', args: [timestamp, user.id, charId, campaign.id] });
      for (const pull of activePulls) {
        await tx.execute({ sql: `UPDATE announcements SET status = 'disponible', updated_at = ? WHERE id = ?`, args: [timestamp, pull.announcement_id] });
      }
      await tx.execute({ sql: 'DELETE FROM character_campaigns WHERE character_id = ? AND campaign_id = ?', args: [charId, campaign.id] });
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    send(res, 200, { ok: true }); return;
  }

  match = pathname.match(/^\/api\/characters\/(\d+)\/board-access$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const row = await get('SELECT * FROM characters WHERE id = ?', [Number(match[1])]);
    if (!row) throw new HttpError(404, 'Personaje no encontrado.');
    await getCampaignForUser(row.campaign_id, user);
    send(res, 200, { boardIds: await getBoardAccessIds(row.id) }); return;
  }
  if (match && req.method === 'PUT') {
    requireDm(user);
    const row = await get('SELECT * FROM characters WHERE id = ?', [Number(match[1])]);
    if (!row) throw new HttpError(404, 'Personaje no encontrado.');
    const campaign = await getCampaignForUser(row.campaign_id, user);
    if (user.role !== 'admin' && campaign.dm_id !== user.id) throw new HttpError(403, 'No puedes editar ese personaje.');
    const body = await readJson(req);
    const boardIds = Array.isArray(body.boardIds) ? body.boardIds.map(Number).filter(Boolean) : [];
    await setBoardAccess(row.id, boardIds);
    send(res, 200, { boardIds: await getBoardAccessIds(row.id) }); return;
  }

  match = pathname.match(/^\/api\/characters\/(\d+)\/board-access\/(\d+)$/);
  if (match && req.method === 'POST') {
    const charRow = await getCharacterForDm(match[1], user);
    const boardRow = await get('SELECT * FROM boards WHERE id = ?', [Number(match[2])]);
    if (!boardRow) throw new HttpError(404, 'Tablón no encontrado.');
    await run('INSERT OR IGNORE INTO character_board_access (character_id, board_id, created_at) VALUES (?, ?, ?)',
      [charRow.id, boardRow.id, now()]);
    send(res, 200, { boardIds: await getBoardAccessIds(charRow.id) }); return;
  }
  if (match && req.method === 'DELETE') {
    const charRow = await getCharacterForDm(match[1], user);
    await run('DELETE FROM character_board_access WHERE character_id = ? AND board_id = ?', [charRow.id, Number(match[2])]);
    send(res, 200, { boardIds: await getBoardAccessIds(charRow.id) }); return;
  }

  // ── Notificaciones ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/notifications') {
    requireDm(user);
    const rows = await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [user.id]);
    send(res, 200, { notifications: rows.map(notificationDto) }); return;
  }

  match = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (match && req.method === 'POST') {
    requireDm(user);
    const row = await get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [Number(match[1]), user.id]);
    if (!row) throw new HttpError(404, 'Notificación no encontrada.');
    await run('UPDATE notifications SET read_at = ? WHERE id = ?', [now(), row.id]);
    const updated = await get('SELECT * FROM notifications WHERE id = ?', [row.id]);
    send(res, 200, { notification: notificationDto(updated) }); return;
  }

  if (req.method === 'POST' && pathname === '/api/notifications/read-all') {
    requireDm(user);
    await run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [now(), user.id]);
    send(res, 200, { ok: true }); return;
  }

  // ── Historial ───────────────────────────────────────────────────────────────
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/pull-history$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const campaign = await getCampaignForUser(match[1], user);
    const rows = await all(`
      SELECT pr.id, pr.pulled_at, pr.reverted_at, pr.active,
        a.title AS announcement_title, a.id AS announcement_id,
        u.display_name AS player_name, u.username, ch.name AS character_name,
        b.name AS board_name, ru.display_name AS reverted_by_name
      FROM pull_records pr
      JOIN announcements a ON a.id = pr.announcement_id
      JOIN users u ON u.id = pr.player_id
      JOIN characters ch ON ch.id = pr.character_id
      JOIN boards b ON b.id = pr.board_id
      LEFT JOIN users ru ON ru.id = pr.reverted_by
      WHERE pr.campaign_id = ? ORDER BY pr.pulled_at DESC LIMIT 200`, [campaign.id]);
    send(res, 200, { history: rows.map(r => ({
      id: r.id, announcementId: r.announcement_id, announcementTitle: r.announcement_title,
      boardName: r.board_name, playerName: r.player_name, username: r.username,
      characterName: r.character_name, pulledAt: r.pulled_at, revertedAt: r.reverted_at,
      revertedByName: r.reverted_by_name, active: Boolean(r.active),
    })) }); return;
  }

  // ── Admin: DMs ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/admin/dms') {
    requireAdmin(user);
    const rows = await all(`
      SELECT u.*, COUNT(DISTINCT cd.campaign_id) AS campaign_count FROM users u
      LEFT JOIN campaign_dms cd ON cd.user_id = u.id WHERE u.role = 'dm'
      GROUP BY u.id ORDER BY u.display_name`);
    send(res, 200, { dms: rows.map(r => ({ ...rowUser(r), campaignCount: Number(r.campaign_count) })) }); return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/dms') {
    requireAdmin(user);
    const body = await readJson(req);
    requireFields(body, ['username', 'displayName', 'password']);
    const pwd = asText(body.password);
    if (pwd.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
    const existing = await get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [asText(body.username).trim()]);
    if (existing) throw new HttpError(409, 'Ese nombre de usuario ya existe.');
    const newId = await insertUser(asText(body.username), asText(body.displayName), 'dm', pwd);
    if (asText(body.email)) {
      await run('UPDATE users SET email = ? WHERE id = ?', [asText(body.email).toLowerCase().trim(), newId]);
    }
    const newRow = await get('SELECT * FROM users WHERE id = ?', [newId]);
    send(res, 201, { dm: rowUser(newRow) }); return;
  }

  match = pathname.match(/^\/api\/admin\/dms\/(\d+)$/);
  if (match && req.method === 'PUT') {
    requireAdmin(user);
    const body = await readJson(req);
    const dm = await get("SELECT * FROM users WHERE id = ? AND role = 'dm'", [Number(match[1])]);
    if (!dm) throw new HttpError(404, 'Maestro no encontrado.');
    const updates = {};
    if (body.displayName) updates.display_name = asText(body.displayName);
    if (body.email !== undefined) updates.email = asText(body.email).toLowerCase().trim();
    if (body.password) {
      const pwd = asText(body.password);
      if (pwd.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
      const { salt, hash } = hashPassword(pwd);
      updates.password_hash = hash; updates.password_salt = salt; updates.dm_password_hint = pwd;
    }
    if (Object.keys(updates).length) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await run(`UPDATE users SET ${sets} WHERE id = ?`, [...Object.values(updates), dm.id]);
    }
    const updated = await get('SELECT * FROM users WHERE id = ?', [dm.id]);
    send(res, 200, { dm: rowUser(updated) }); return;
  }

  if (match && req.method === 'DELETE') {
    requireAdmin(user);
    const dm = await get("SELECT * FROM users WHERE id = ? AND role = 'dm'", [Number(match[1])]);
    if (!dm) throw new HttpError(404, 'Maestro no encontrado.');
    const countRow = await get('SELECT COUNT(*) AS n FROM campaign_dms WHERE user_id = ?', [dm.id]);
    if (Number(countRow.n) > 0) throw new HttpError(409, 'Este maestro tiene campañas asignadas. Desvinculalas antes de eliminar la cuenta.');
    await run('DELETE FROM sessions WHERE user_id = ?', [dm.id]);
    await run('DELETE FROM users WHERE id = ?', [dm.id]);
    send(res, 200, { ok: true }); return;
  }

  // ── Admin: Campañas ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/admin/campaigns') {
    requireAdmin(user);
    const rows = await all('SELECT * FROM campaigns ORDER BY updated_at DESC');
    const result = await Promise.all(rows.map(async row => {
      const dms = await all(`
        SELECT u.id, u.username, u.display_name AS displayName FROM campaign_dms cd
        JOIN users u ON u.id = cd.user_id WHERE cd.campaign_id = ? ORDER BY u.display_name`, [row.id]);
      return { ...await campaignDto(row), dms };
    }));
    send(res, 200, { campaigns: result }); return;
  }

  match = pathname.match(/^\/api\/admin\/campaigns\/(\d+)\/dms$/);
  if (match && req.method === 'GET') {
    requireAdmin(user);
    const dms = await all(`
      SELECT u.id, u.username, u.display_name AS displayName FROM campaign_dms cd
      JOIN users u ON u.id = cd.user_id WHERE cd.campaign_id = ? ORDER BY u.display_name`, [Number(match[1])]);
    send(res, 200, { dms }); return;
  }
  if (match && req.method === 'POST') {
    requireAdmin(user);
    const body = await readJson(req);
    const campaign = await get('SELECT * FROM campaigns WHERE id = ?', [Number(match[1])]);
    if (!campaign) throw new HttpError(404, 'Campaña no encontrada.');
    const dm = await get("SELECT * FROM users WHERE id = ? AND role = 'dm'", [Number(body.userId)]);
    if (!dm) throw new HttpError(404, 'Maestro no encontrado.');
    await run('INSERT OR IGNORE INTO campaign_dms (campaign_id, user_id, created_at) VALUES (?, ?, ?)',
      [campaign.id, dm.id, now()]);
    const dms = await all(`
      SELECT u.id, u.username, u.display_name AS displayName FROM campaign_dms cd
      JOIN users u ON u.id = cd.user_id WHERE cd.campaign_id = ? ORDER BY u.display_name`, [campaign.id]);
    send(res, 200, { dms }); return;
  }

  match = pathname.match(/^\/api\/admin\/campaigns\/(\d+)\/dms\/(\d+)$/);
  if (match && req.method === 'DELETE') {
    requireAdmin(user);
    await run('DELETE FROM campaign_dms WHERE campaign_id = ? AND user_id = ?', [Number(match[1]), Number(match[2])]);
    send(res, 200, { ok: true }); return;
  }

  // ── Admin: Perfil ───────────────────────────────────────────────────────────
  if (req.method === 'PUT' && pathname === '/api/admin/me') {
    requireAdmin(user);
    const body = await readJson(req);
    const updates = {};
    if (body.email !== undefined) updates.email = asText(body.email).toLowerCase().trim();
    if (body.displayName !== undefined && asText(body.displayName)) updates.display_name = asText(body.displayName);
    if (body.newPassword) {
      if (!body.currentPassword) throw new HttpError(400, 'Indica tu contraseña actual.');
      const row = await get('SELECT * FROM users WHERE id = ?', [user.id]);
      if (!verifyPassword(asText(body.currentPassword), row.password_salt, row.password_hash))
        throw new HttpError(401, 'Contraseña actual incorrecta.');
      if (asText(body.newPassword).length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres.');
      const { salt, hash } = hashPassword(asText(body.newPassword));
      updates.password_hash = hash; updates.password_salt = salt;
    }
    if (Object.keys(updates).length) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await run(`UPDATE users SET ${sets} WHERE id = ?`, [...Object.values(updates), user.id]);
    }
    const updated = await get('SELECT * FROM users WHERE id = ?', [user.id]);
    send(res, 200, { user: rowUser(updated) }); return;
  }

  // ── Backup (no disponible en Vercel — usa el panel de Turso) ────────────────
  if (req.method === 'GET' && pathname === '/api/backup') {
    requireAdmin(user);
    send(res, 501, { error: 'En Vercel el backup se gestiona desde el panel de Turso (turso.tech/databases).' }); return;
  }

  throw new HttpError(404, 'Ruta no encontrada.');
}

// ─── HANDLER VERCEL ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  await ensureInit();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    await handleApi(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    send(res, status, { error: error.message || 'Error interno.', status });
    if (status === 500) console.error(error);
  }
};
