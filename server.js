const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'tablon.sqlite');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_DAYS = 7;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
db.exec('PRAGMA foreign_keys = ON');

// Tabla de acceso de personajes a tablones (compatible con BDs antiguas)
db.exec(`
  CREATE TABLE IF NOT EXISTS character_board_access (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (character_id, board_id)
  )
`);

// Tabla many-to-many: un personaje puede pertenecer a varias campañas
db.exec(`
  CREATE TABLE IF NOT EXISTS character_campaigns (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    campaign_id  INTEGER NOT NULL REFERENCES campaigns(id)  ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (character_id, campaign_id)
  )
`);

// Tabla many-to-many: varios masters pueden gestionar una campaña
db.exec(`
  CREATE TABLE IF NOT EXISTS campaign_dms (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (campaign_id, user_id)
  )
`);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some(column => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('campaign_players', 'dm_notes', "TEXT NOT NULL DEFAULT ''");
ensureColumn('characters', 'dm_notes', "TEXT NOT NULL DEFAULT ''");
ensureColumn('characters', 'status', "TEXT NOT NULL DEFAULT 'activo'");
ensureColumn('characters', 'death_note', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'email', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'dm_password_hint', "TEXT NOT NULL DEFAULT ''"); // Última contraseña en texto, solo visible para el DM

db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
      if (body.length > 1_000_000) {
        reject(new HttpError(413, 'Petición demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, 'JSON no válido.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (typeof body[field] !== 'string' || !body[field].trim()) {
      throw new HttpError(400, `Falta el campo ${field}.`);
    }
  }
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map(tag => String(tag).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map(tag => tag.trim()).filter(Boolean);
  }
  return [];
}

function parseTags(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowUser(row) {
  return row ? {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email || '',
    role: row.role,
    createdAt: row.created_at
  } : null;
}

function getAuthUser(req) {
  const header = req.headers.authorization || '';
  const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
  if (!token) return null;

  const row = db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), now());

  return rowUser(row);
}

function createSession(userId) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, tokenHash(token), expires, now());
  return token;
}

function requireUser(req) {
  const user = getAuthUser(req);
  if (!user) throw new HttpError(401, 'Debes iniciar sesión.');
  return user;
}

function requireDm(user) {
  if (user.role !== 'dm' && user.role !== 'admin') {
    throw new HttpError(403, 'Solo el Dungeon Master puede hacer eso.');
  }
}

function requireAdmin(user) {
  if (user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer eso.');
}

function requirePlayer(user) {
  if (user.role !== 'player') throw new HttpError(403, 'Solo un jugador puede hacer eso.');
}

function getCampaignForUser(campaignId, user) {
  const id = Number(campaignId);
  let row;
  if (user.role === 'admin') {
    row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  } else if (user.role === 'dm') {
    row = db.prepare(`
      SELECT c.* FROM campaigns c
      WHERE c.id = ? AND (
        c.dm_id = ?
        OR EXISTS (SELECT 1 FROM campaign_dms cd WHERE cd.campaign_id = c.id AND cd.user_id = ?)
      )
    `).get(id, user.id, user.id);
  } else {
    row = db.prepare(`
      SELECT c.*
      FROM campaigns c
      JOIN campaign_players cp ON cp.campaign_id = c.id
      WHERE c.id = ? AND cp.player_id = ? AND cp.status = 'active'
    `).get(id, user.id);
  }
  if (!row) throw new HttpError(404, 'Campaña no encontrada o sin permiso.');
  return row;
}

function getBoardForUser(boardId, user) {
  const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(Number(boardId));
  if (!row) throw new HttpError(404, 'Tablón no encontrado.');
  getCampaignForUser(row.campaign_id, user);
  if (user.role === 'player') {
    // Un jugador puede acceder al tablón si alguno de sus personajes (en esa campaña) tiene acceso.
    // Si un personaje no tiene ninguna entrada en character_board_access, ve todos los tablones.
    const canAccess = db.prepare(`
      SELECT 1 FROM characters ch
      JOIN character_campaigns cc ON cc.character_id = ch.id
      WHERE ch.user_id = ? AND cc.campaign_id = ?
      AND (
        NOT EXISTS (SELECT 1 FROM character_board_access WHERE character_id = ch.id)
        OR EXISTS (SELECT 1 FROM character_board_access WHERE character_id = ch.id AND board_id = ?)
      )
      LIMIT 1
    `).get(user.id, row.campaign_id, row.id);
    if (!canAccess) throw new HttpError(404, 'Tablón no encontrado.');
  }
  return row;
}

function getAnnouncementForUser(announcementId, user) {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(Number(announcementId));
  if (!row) throw new HttpError(404, 'Anuncio no encontrado.');
  getCampaignForUser(row.campaign_id, user);
  if (user.role === 'player') {
    if (row.status === 'archivado' || row.hidden_from_players) {
      throw new HttpError(404, 'Anuncio no encontrado.');
    }
    // Un anuncio arrancado solo lo puede ver el jugador que lo arrancó
    if (row.status === 'arrancado') {
      const myPull = db.prepare(`
        SELECT 1 FROM pull_records
        WHERE announcement_id = ? AND player_id = ? AND active = 1
      `).get(row.id, user.id);
      if (!myPull) throw new HttpError(404, 'Anuncio no encontrado.');
    }
  }
  return row;
}

function campaignDto(row) {
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM boards WHERE campaign_id = ?) AS board_count,
      (SELECT COUNT(*) FROM announcements WHERE campaign_id = ?) AS announcement_count,
      (SELECT COUNT(*) FROM campaign_players WHERE campaign_id = ? AND status = 'active') AS player_count,
      (SELECT COUNT(*) FROM character_campaigns WHERE campaign_id = ?) AS character_count
  `).get(row.id, row.id, row.id, row.id);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    dmId: row.dm_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats
  };
}

function boardDto(row) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS announcement_count,
      SUM(CASE WHEN status = 'disponible' THEN 1 ELSE 0 END) AS available_count,
      SUM(CASE WHEN status = 'arrancado' THEN 1 ELSE 0 END) AS pulled_count
    FROM announcements
    WHERE board_id = ?
  `).get(row.id);

  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    description: row.description,
    type: row.type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats: {
      announcementCount: stats.announcement_count || 0,
      availableCount: stats.available_count || 0,
      pulledCount: stats.pulled_count || 0
    }
  };
}

function getCharacterForDm(charId, user) {
  requireDm(user);
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(charId));
  if (!row) throw new HttpError(404, 'Personaje no encontrado.');
  if (user.role !== 'admin') {
    const hasAccess = db.prepare(`
      SELECT 1 FROM character_campaigns cc
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE cc.character_id = ? AND (
        c.dm_id = ?
        OR EXISTS (SELECT 1 FROM campaign_dms cd WHERE cd.campaign_id = c.id AND cd.user_id = ?)
      ) LIMIT 1
    `).get(row.id, user.id, user.id);
    if (!hasAccess) throw new HttpError(403, 'No tienes permiso sobre este personaje.');
  }
  return row;
}

function getBoardAccessIds(characterId) {
  return db.prepare('SELECT board_id FROM character_board_access WHERE character_id = ?')
    .all(characterId).map(r => r.board_id);
}

function setBoardAccess(characterId, boardIds) {
  const timestamp = now();
  db.prepare('DELETE FROM character_board_access WHERE character_id = ?').run(characterId);
  for (const boardId of boardIds) {
    db.prepare(`
      INSERT OR IGNORE INTO character_board_access (character_id, board_id, created_at)
      VALUES (?, ?, ?)
    `).run(characterId, boardId, timestamp);
  }
}

function pullForAnnouncement(announcementId) {
  return db.prepare(`
    SELECT pr.*, u.display_name AS player_name, u.username, ch.name AS character_name
    FROM pull_records pr
    JOIN users u ON u.id = pr.player_id
    JOIN characters ch ON ch.id = pr.character_id
    WHERE pr.announcement_id = ? AND pr.active = 1
  `).get(announcementId);
}

function announcementDto(row, user, includePrivate = false) {
  const pull = pullForAnnouncement(row.id);
  const dto = {
    id: row.id,
    campaignId: row.campaign_id,
    boardId: row.board_id,
    title: row.title,
    publicText: row.public_text,
    tags: parseTags(row.tags),
    status: row.status,
    worldDate: row.world_date,
    hiddenFromPlayers: Boolean(row.hidden_from_players),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pull: pull ? {
      id: pull.id,
      playerId: pull.player_id,
      playerName: pull.player_name,
      username: pull.username,
      characterId: pull.character_id,
      characterName: pull.character_name,
      pulledAt: pull.pulled_at
    } : null
  };

  if (includePrivate && (user.role === 'dm' || user.role === 'admin')) {
    dto.private = {
      realSummary: row.real_summary,
      narrativeHook: row.narrative_hook,
      secretInformation: row.secret_information,
      involvedNpcs: row.involved_npcs,
      relevantLocations: row.relevant_locations,
      possibleComplications: row.possible_complications,
      realReward: row.real_reward,
      ignoredConsequences: row.ignored_consequences,
      dmNotes: row.dm_notes,
      prepState: row.prep_state
    };
  }

  return dto;
}

const VALID_CHAR_STATUSES = ['activo', 'retirado', 'muerto', 'desaparecido'];

function characterDto(row, includePrivate = false) {
  const dto = {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    name: row.name,
    ancestry: row.ancestry,
    archetype: row.archetype,
    notes: row.notes,
    status: row.status || 'activo',
    deathNote: row.death_note || '',
    playerName: row.player_name,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (includePrivate) dto.dmNotes = row.dm_notes || '';
  return dto;
}

function notificationDto(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    announcementId: row.announcement_id,
    pullRecordId: row.pull_record_id,
    type: row.type,
    message: row.message,
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

function insertUser(username, displayName, role, password) {
  const { salt, hash } = hashPassword(password);
  const result = db.prepare(`
    INSERT INTO users (username, display_name, role, password_hash, password_salt, dm_password_hint, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username.toLowerCase().trim(), displayName, role, hash, salt, password, now());
  return Number(result.lastInsertRowid);
}

function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  db.exec('BEGIN');
  try {
    const dmId = insertUser('dm', 'Maestre del Tablón', 'dm', 'dm123');
    const playerId = insertUser('jugador', 'Elena de las Marismas', 'player', 'jugador123');
    const created = now();

    const campaignId = Number(db.prepare(`
      INSERT INTO campaigns (dm_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      dmId,
      'Marcas de Ceniza',
      'Una comarca de aldeas húmedas, deudas viejas y caminos donde nadie canta después del ocaso.',
      created,
      created
    ).lastInsertRowid);

    db.prepare(`
      INSERT INTO campaign_players (campaign_id, player_id, status, created_at)
      VALUES (?, ?, 'active', ?)
    `).run(campaignId, playerId, created);

    const tavernBoardId = Number(db.prepare(`
      INSERT INTO boards (campaign_id, name, description, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      campaignId,
      'Taberna del Diente Negro',
      'La pared junto al hogar, ennegrecida por humo y promesas incumplidas.',
      'taberna',
      created,
      created
    ).lastInsertRowid);

    const roadBoardId = Number(db.prepare(`
      INSERT INTO boards (campaign_id, name, description, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      campaignId,
      'Gremio de Carreteros',
      'Tablas con sellos de ruta, quejas de porteadores y avisos escritos con manos temblorosas.',
      'gremio',
      created,
      created
    ).lastInsertRowid);

    const lawBoardId = Number(db.prepare(`
      INSERT INTO boards (campaign_id, name, description, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      campaignId,
      'Alguacilazgo de Vado Hondo',
      'Órdenes clavadas torcidas bajo una lámpara de aceite que nunca parece bastar.',
      'autoridad local',
      created,
      created
    ).lastInsertRowid);

    db.prepare(`
      INSERT INTO characters (user_id, campaign_id, name, ancestry, archetype, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(playerId, campaignId, 'Bruna de la Turbera', 'Humana', 'Rastreadora', 'No duerme bien cerca del agua estancada.', created, created);

    db.prepare(`
      INSERT INTO characters (user_id, campaign_id, name, ancestry, archetype, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(playerId, campaignId, 'Odrik sin Campana', 'Enano', 'Exsacristán', 'Sabe leer epitafios y mentiras baratas.', created, created);

    const announcement = db.prepare(`
      INSERT INTO announcements (
        campaign_id, board_id, created_by, title, public_text, tags, status, world_date, real_summary, narrative_hook,
        secret_information, involved_npcs, relevant_locations, possible_complications,
        real_reward, ignored_consequences, dm_notes, prep_state, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    announcement.run(
      campaignId,
      tavernBoardId,
      dmId,
      'Plata limpia por ganado muerto',
      'Se pagará plata limpia a quien encuentre qué está matando al ganado al norte del vado. No preguntéis por los cuerpos.',
      JSON.stringify(['investigación', 'caza de monstruos', 'rural', 'rumor']),
      'disponible',
      'Día 17 de Nieblas',
      'Un carnicero local alimenta a una criatura nacida de un pacto fallido para mantener el matadero próspero.',
      'Las reses aparecen abiertas con precisión ritual, no devoradas.',
      'Marta sabe más de lo que admite: su hijo firmó el pacto y ahora está desaparecido.',
      'Marta Frunce; Simo el Carnicero; el hijo de Marta, Elian.',
      'Vado Norte; matadero viejo; cañaverales junto al río.',
      'Los aldeanos culpan a forasteros; el carnicero puede ofrecer un soborno.',
      'Una bolsa de plata ennegrecida y acceso a carne salada para futuras expediciones.',
      'La criatura empezará a tomar niños cuando el ganado no baste.',
      'Mantener el tono sucio y cotidiano. No convertirlo en una caza heroica.',
      'preparada',
      created,
      created
    );

    announcement.run(
      campaignId,
      roadBoardId,
      dmId,
      'La cuarta caravana saldrá igual',
      'El Gremio de Carreteros busca escolta para cruzar el Camino Hundido. Tres caravanas han desaparecido. La cuarta saldrá igual.',
      JSON.stringify(['escolta', 'exploración', 'urgente', 'facción']),
      'disponible',
      'Última luna menguante',
      'El gremio oculta que las caravanas transportaban reliquias robadas a un priorato hundido.',
      'La ruta está marcada por ruedas que no coinciden con ningún carro vivo.',
      'Los desaparecidos no están muertos: trabajan para pagar una deuda con algo bajo el camino.',
      'Roven Cuerda; hermana Ilda; una cuadrilla de carreteros endeudados.',
      'Camino Hundido; priorato sumergido; mojón de los siete clavos.',
      'La carga puede maldecir a quien la toque sin guantes de hierro.',
      'Dinero, una ruta segura temporal y una reliquia menor si negocian bien.',
      'El Camino Hundido se cerrará por completo y aislará Vado Hondo.',
      'Ideal para viaje tenso, niebla baja y decisiones sobre carga robada.',
      'idea',
      created,
      created
    );

    announcement.run(
      campaignId,
      lawBoardId,
      dmId,
      'Orden sobre el pozo viejo',
      'Por orden del alguacil: queda prohibido acercarse al pozo viejo tras la puesta de sol. Recompensa por información útil.',
      JSON.stringify(['investigación', 'autoridad local', 'rumor']),
      'disponible',
      'Bando del tercer día',
      'El alguacil intenta tapar que usó el pozo para deshacerse de pruebas de un juicio falso.',
      'Cada noche alguien desde el fondo recita nombres de vecinos vivos.',
      'La voz no es un muerto: es una testigo encerrada en una cámara de contrabandistas.',
      'Alguacil Brecht; Nara la aguadora; Tom el pregonero.',
      'Pozo viejo; archivo húmedo del alguacilazgo; túnel de los curtidores.',
      'Si liberan a la testigo, media guardia local intentará silenciarla.',
      'Licencias, favores o chantaje político.',
      'Brecht ejecutará a un inocente para cerrar el asunto.',
      'Buen anuncio corto para una sesión de intriga de una noche.',
      'preparada',
      created,
      created
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

seedDatabase();

// Asegurar cuenta de superadministrador al arrancar
function ensureAdminUser() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) return;

  const pwd = crypto.randomBytes(6).toString('hex'); // 12 chars hex, fácil de leer
  const { salt, hash } = hashPassword(pwd);
  const result = db.prepare(`
    INSERT INTO users (username, display_name, role, email, password_hash, password_salt, dm_password_hint, created_at)
    VALUES ('javier', 'Javier (Admin)', 'admin', 'javierelio@outlook.com', ?, ?, ?, ?)
  `).run(hash, salt, pwd, now());

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   ⚔  CUENTA DE ADMINISTRADOR CREADA  ⚔   ║');
  console.log('║                                          ║');
  console.log('║   Usuario:     javier                   ║');
  console.log(`║   Contraseña:  ${pwd}              ║`);
  console.log('║   Email:       javierelio@outlook.com   ║');
  console.log('║                                          ║');
  console.log('║   Cambia la contraseña tras el primer   ║');
  console.log('║   inicio de sesión.                     ║');
  console.log('╚══════════════════════════════════════════╝\n');
}
ensureAdminUser();

// Migrar dm_id existente a campaign_dms (idempotente)
{
  const campaigns = db.prepare('SELECT id, dm_id FROM campaigns WHERE dm_id IS NOT NULL').all();
  const insertCd = db.prepare(
    'INSERT OR IGNORE INTO campaign_dms (campaign_id, user_id, created_at) VALUES (?, ?, ?)'
  );
  for (const c of campaigns) insertCd.run(c.id, c.dm_id, now());
}

// Migrar personajes existentes a character_campaigns (idempotente)
{
  const staleChars = db.prepare('SELECT id, campaign_id FROM characters WHERE campaign_id IS NOT NULL').all();
  const insertCampChar = db.prepare(
    'INSERT OR IGNORE INTO character_campaigns (character_id, campaign_id, created_at) VALUES (?, ?, ?)'
  );
  for (const ch of staleChars) insertCampChar.run(ch.id, ch.campaign_id, now());
}

function createCampaign(body, user) {
  requireDm(user);
  requireFields(body, ['name']);
  const timestamp = now();
  // El admin puede crear una campaña ya asignada a un DM concreto
  let ownerDmId = user.id;
  if (user.role === 'admin' && Number(body.dmId)) {
    const targetDm = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'dm'").get(Number(body.dmId));
    if (!targetDm) throw new HttpError(400, 'El usuario especificado no existe o no tiene rol de Maestro.');
    ownerDmId = targetDm.id;
  }
  const result = db.prepare(`
    INSERT INTO campaigns (dm_id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(ownerDmId, asText(body.name), asText(body.description), timestamp, timestamp);
  const campaignId = Number(result.lastInsertRowid);
  // Auto-registrar al creador (o al DM elegido) en campaign_dms
  db.prepare('INSERT OR IGNORE INTO campaign_dms (campaign_id, user_id, created_at) VALUES (?, ?, ?)')
    .run(campaignId, ownerDmId, timestamp);
  return campaignDto(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId));
}

function updateCampaign(id, body, user) {
  requireDm(user);
  const campaign = getCampaignForUser(id, user);
  db.prepare(`
    UPDATE campaigns
    SET name = ?, description = ?, updated_at = ?
    WHERE id = ?
  `).run(asText(body.name) || campaign.name, asText(body.description), now(), campaign.id);
  return campaignDto(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign.id));
}

function createBoard(campaignId, body, user) {
  requireDm(user);
  const campaign = getCampaignForUser(campaignId, user);
  requireFields(body, ['name']);
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO boards (campaign_id, name, description, type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(campaign.id, asText(body.name), asText(body.description), asText(body.type) || 'otro', timestamp, timestamp);
  return boardDto(db.prepare('SELECT * FROM boards WHERE id = ?').get(Number(result.lastInsertRowid)));
}

function updateBoard(id, body, user) {
  requireDm(user);
  const board = getBoardForUser(id, user);
  db.prepare(`
    UPDATE boards
    SET name = ?, description = ?, type = ?, updated_at = ?
    WHERE id = ?
  `).run(
    asText(body.name) || board.name,
    asText(body.description),
    asText(body.type) || 'otro',
    now(),
    board.id
  );
  return boardDto(db.prepare('SELECT * FROM boards WHERE id = ?').get(board.id));
}

function createAnnouncement(boardId, body, user) {
  requireDm(user);
  const board = getBoardForUser(boardId, user);
  requireFields(body, ['title', 'publicText']);
  const timestamp = now();
  const tags = JSON.stringify(normalizeTags(body.tags));
  const result = db.prepare(`
    INSERT INTO announcements (
      campaign_id, board_id, created_by, title, public_text, tags, status, world_date, hidden_from_players,
      real_summary, narrative_hook, secret_information, involved_npcs, relevant_locations,
      possible_complications, real_reward, ignored_consequences, dm_notes, prep_state,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    board.campaign_id,
    board.id,
    user.id,
    asText(body.title),
    asText(body.publicText),
    tags,
    asText(body.status) || 'disponible',
    asText(body.worldDate),
    body.hiddenFromPlayers ? 1 : 0,
    asText(body.realSummary),
    asText(body.narrativeHook),
    asText(body.secretInformation),
    asText(body.involvedNpcs),
    asText(body.relevantLocations),
    asText(body.possibleComplications),
    asText(body.realReward),
    asText(body.ignoredConsequences),
    asText(body.dmNotes),
    asText(body.prepState) || 'idea',
    timestamp,
    timestamp
  );
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(Number(result.lastInsertRowid));
  return announcementDto(row, user, true);
}

function updateAnnouncement(id, body, user) {
  requireDm(user);
  const announcement = getAnnouncementForUser(id, user);
  const tags = JSON.stringify(normalizeTags(body.tags));
  db.prepare(`
    UPDATE announcements
    SET title = ?, public_text = ?, tags = ?, status = ?, world_date = ?, hidden_from_players = ?,
      real_summary = ?, narrative_hook = ?, secret_information = ?, involved_npcs = ?,
      relevant_locations = ?, possible_complications = ?, real_reward = ?, ignored_consequences = ?,
      dm_notes = ?, prep_state = ?, updated_at = ?
    WHERE id = ?
  `).run(
    asText(body.title) || announcement.title,
    asText(body.publicText) || announcement.public_text,
    tags,
    asText(body.status) || announcement.status,
    asText(body.worldDate),
    body.hiddenFromPlayers ? 1 : 0,
    asText(body.realSummary),
    asText(body.narrativeHook),
    asText(body.secretInformation),
    asText(body.involvedNpcs),
    asText(body.relevantLocations),
    asText(body.possibleComplications),
    asText(body.realReward),
    asText(body.ignoredConsequences),
    asText(body.dmNotes),
    asText(body.prepState) || 'idea',
    now(),
    announcement.id
  );
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcement.id);
  return announcementDto(row, user, true);
}

function setAnnouncementStatus(id, status, user) {
  requireDm(user);
  // 'arrancado' solo se puede establecer mediante pullAnnouncement() para mantener consistencia con pull_records
  const allowed = new Set(['disponible', 'completado', 'archivado']);
  if (!allowed.has(status)) throw new HttpError(400, 'Estado no válido. Usa disponible, completado o archivado.');
  const announcement = getAnnouncementForUser(id, user);
  db.prepare('UPDATE announcements SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, now(), announcement.id);
  return announcementDto(db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcement.id), user, true);
}

function createCharacter(campaignId, body, user) {
  requireDm(user);
  getCampaignForUser(campaignId, user);
  const targetCampaign = getCampaignForUser(Number(body.campaignId) || campaignId, user);
  requireFields(body, ['name', 'playerUsername']);
  const player = db.prepare(`
    SELECT u.*
    FROM users u
    JOIN campaign_players cp ON cp.player_id = u.id
    WHERE LOWER(u.username) = LOWER(?) AND u.role = 'player' AND cp.campaign_id = ? AND cp.status = 'active'
  `).get(asText(body.playerUsername).trim(), targetCampaign.id);
  if (!player) throw new HttpError(400, 'Ese username no corresponde a un jugador vinculado a la campaña.');

  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO characters (user_id, campaign_id, name, ancestry, archetype, notes, dm_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    player.id,
    targetCampaign.id,
    asText(body.name),
    asText(body.ancestry),
    asText(body.archetype),
    asText(body.notes),
    asText(body.dmNotes),
    timestamp,
    timestamp
  );
  const charId = Number(result.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO character_campaigns (character_id, campaign_id, created_at) VALUES (?, ?, ?)')
    .run(charId, targetCampaign.id, timestamp);
  return characterDto(db.prepare(`
    SELECT ch.*, u.display_name AS player_name, u.username
    FROM characters ch
    JOIN users u ON u.id = ch.user_id
    WHERE ch.id = ?
  `).get(charId), true);
}

function updateCharacter(id, body, user) {
  requireDm(user);
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, 'Personaje no encontrado.');
  const campaign = getCampaignForUser(row.campaign_id, user);
  // Admin siempre puede; DM sólo si tiene acceso a la campaña (ya verificado por getCampaignForUser)
  const targetCampaign = body.campaignId !== undefined && Number(body.campaignId)
    ? getCampaignForUser(Number(body.campaignId), user)
    : campaign;

  let playerId = row.user_id;
  if (body.playerUsername !== undefined && asText(body.playerUsername)) {
    const player = db.prepare(`
      SELECT u.*
      FROM users u
      JOIN campaign_players cp ON cp.player_id = u.id
      WHERE u.username = ? AND u.role = 'player' AND cp.campaign_id = ? AND cp.status = 'active'
    `).get(asText(body.playerUsername), targetCampaign.id);
    if (!player) throw new HttpError(400, 'Ese username no corresponde a un jugador vinculado a la campaña.');
    playerId = player.id;
  }

  const newStatus = body.status && VALID_CHAR_STATUSES.includes(body.status) ? body.status : row.status || 'activo';
  const goingInactive = newStatus !== 'activo' && (row.status || 'activo') === 'activo';
  const ownershipChanging = playerId !== row.user_id || targetCampaign.id !== row.campaign_id;

  const timestamp = now();
  db.exec('BEGIN');
  try {
    // Revocar pulls activos si el personaje pasa a no-activo O si cambia de dueño/campaña
    if (goingInactive || ownershipChanging) {
      const activePulls = db.prepare(`
        SELECT announcement_id FROM pull_records WHERE character_id = ? AND active = 1
      `).all(row.id);

      db.prepare(`
        UPDATE pull_records SET active = 0, reverted_at = ?, reverted_by = ?
        WHERE character_id = ? AND active = 1
      `).run(timestamp, user.id, row.id);

      for (const pull of activePulls) {
        db.prepare(`
          UPDATE announcements SET status = 'disponible', updated_at = ? WHERE id = ?
        `).run(timestamp, pull.announcement_id);
      }
    }

    db.prepare(`
      UPDATE characters
      SET user_id = ?, campaign_id = ?, name = ?, ancestry = ?, archetype = ?,
          notes = ?, dm_notes = ?, status = ?, death_note = ?, updated_at = ?
      WHERE id = ?
    `).run(
      playerId,
      targetCampaign.id,
      asText(body.name) || row.name,
      asText(body.ancestry),
      asText(body.archetype),
      asText(body.notes),
      asText(body.dmNotes),
      newStatus,
      asText(body.deathNote),
      timestamp,
      row.id
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return characterDto(db.prepare(`
    SELECT ch.*, u.display_name AS player_name, u.username
    FROM characters ch
    JOIN users u ON u.id = ch.user_id
    WHERE ch.id = ?
  `).get(row.id), true);
}

function createOrLinkPlayer(campaignId, body, user) {
  requireDm(user);
  const campaign = getCampaignForUser(campaignId, user);
  requireFields(body, ['username']);

  let player = db.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND role = 'player'").get(asText(body.username).trim());
  const password = asText(body.password);
  let created = false;

  if (password) {
    if (!player) {
      requireFields(body, ['displayName', 'password']);
      if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
      const playerId = insertUser(asText(body.username), asText(body.displayName), 'player', password);
      player = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'player'").get(playerId);
      created = true;
    }
  }

  if (!player) throw new HttpError(404, 'Jugador no encontrado. Escribe una contraseña inicial para crearlo.');

  db.prepare(`
    INSERT INTO campaign_players (campaign_id, player_id, status, dm_notes, created_at)
    VALUES (?, ?, 'active', ?, ?)
    ON CONFLICT(campaign_id, player_id) DO UPDATE SET status = 'active', dm_notes = excluded.dm_notes
  `).run(campaign.id, player.id, asText(body.dmNotes), now());

  return {
    id: player.id,
    username: player.username,
    displayName: player.display_name,
    status: 'active',
    dmNotes: asText(body.dmNotes),
    created
  };
}

function removePlayerFromCampaign(campaignId, playerId, user) {
  requireDm(user);
  const campaign = getCampaignForUser(campaignId, user);
  const player = db.prepare(`
    SELECT u.*
    FROM users u
    JOIN campaign_players cp ON cp.player_id = u.id
    WHERE u.id = ? AND u.role = 'player' AND cp.campaign_id = ? AND cp.status = 'active'
  `).get(Number(playerId), campaign.id);
  if (!player) throw new HttpError(404, 'Jugador no encontrado en esta campaña.');

  const timestamp = now();
  db.exec('BEGIN');
  try {
    const activePulls = db.prepare(`
      SELECT pr.announcement_id
      FROM pull_records pr
      JOIN characters ch ON ch.id = pr.character_id
      WHERE pr.campaign_id = ? AND pr.player_id = ? AND pr.active = 1
    `).all(campaign.id, player.id);

    db.prepare(`
      UPDATE pull_records
      SET active = 0, reverted_at = ?, reverted_by = ?
      WHERE campaign_id = ? AND player_id = ? AND active = 1
    `).run(timestamp, user.id, campaign.id, player.id);

    for (const pull of activePulls) {
      db.prepare(`
        UPDATE announcements
        SET status = 'disponible', updated_at = ?
        WHERE id = ?
      `).run(timestamp, pull.announcement_id);
    }

    // Desasociar personajes del jugador de esta campaña (los personajes se conservan globalmente)
    db.prepare(`
      DELETE FROM character_campaigns
      WHERE campaign_id = ?
        AND character_id IN (SELECT id FROM characters WHERE user_id = ?)
    `).run(campaign.id, player.id);
    db.prepare('DELETE FROM campaign_players WHERE campaign_id = ? AND player_id = ?')
      .run(campaign.id, player.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    id: player.id,
    username: player.username,
    displayName: player.display_name
  };
}

function pullAnnouncement(id, body, user) {
  requirePlayer(user);
  const announcement = getAnnouncementForUser(id, user);
  if (announcement.status !== 'disponible') throw new HttpError(409, 'Este anuncio ya no está disponible.');

  const characterId = Number(body.characterId);
  const character = db.prepare(`
    SELECT ch.*
    FROM characters ch
    JOIN character_campaigns cc ON cc.character_id = ch.id
    WHERE ch.id = ? AND ch.user_id = ? AND cc.campaign_id = ?
  `).get(characterId, user.id, announcement.campaign_id);
  if (!character) throw new HttpError(403, 'Ese personaje no pertenece a tu cuenta o campaña.');
  if ((character.status || 'activo') !== 'activo') {
    const labels = { muerto: 'ha muerto', retirado: 'está retirado', desaparecido: 'está desaparecido' };
    throw new HttpError(409, `${character.name} ${labels[character.status] || 'no está activo'} y no puede aceptar encargos.`);
  }

  const timestamp = now();

  // Reunir todos los DMs de la campaña (legacy dm_id + campaign_dms) para notificarlos
  const campaignDmIds = db.prepare(`
    SELECT DISTINCT user_id FROM campaign_dms WHERE campaign_id = ?
  `).all(announcement.campaign_id).map(r => r.user_id);
  // Incluir dm_id legacy si no está ya en campaign_dms
  const legacyCampaign = db.prepare('SELECT dm_id FROM campaigns WHERE id = ?').get(announcement.campaign_id);
  if (legacyCampaign?.dm_id && !campaignDmIds.includes(legacyCampaign.dm_id)) {
    campaignDmIds.push(legacyCampaign.dm_id);
  }

  db.exec('BEGIN');
  try {
    const result = db.prepare(`
      INSERT INTO pull_records (announcement_id, campaign_id, board_id, player_id, character_id, pulled_at, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(announcement.id, announcement.campaign_id, announcement.board_id, user.id, character.id, timestamp);

    db.prepare('UPDATE announcements SET status = ?, updated_at = ? WHERE id = ?')
      .run('arrancado', timestamp, announcement.id);

    const notifyStmt = db.prepare(`
      INSERT INTO notifications (user_id, campaign_id, announcement_id, pull_record_id, type, message, created_at)
      VALUES (?, ?, ?, ?, 'announcement_pulled', ?, ?)
    `);
    const pullRecordId = Number(result.lastInsertRowid);
    const message = `${user.displayName} arrancó "${announcement.title}" con ${character.name}.`;
    for (const dmId of campaignDmIds) {
      notifyStmt.run(dmId, announcement.campaign_id, announcement.id, pullRecordId, message, timestamp);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('idx_active_pull_per_announcement')) {
      throw new HttpError(409, 'Este anuncio ya fue arrancado.');
    }
    throw error;
  }

  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcement.id);
  return announcementDto(row, user, false);
}

function revertPull(id, user) {
  requireDm(user);
  const announcement = getAnnouncementForUser(id, user);
  const pull = pullForAnnouncement(announcement.id);
  if (!pull) throw new HttpError(404, 'No hay registro activo para revertir.');
  const timestamp = now();

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE pull_records
      SET active = 0, reverted_at = ?, reverted_by = ?
      WHERE id = ?
    `).run(timestamp, user.id, pull.id);
    db.prepare(`
      UPDATE announcements
      SET status = 'disponible', updated_at = ?
      WHERE id = ?
    `).run(timestamp, announcement.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return announcementDto(db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcement.id), user, true);
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readJson(req);
    requireFields(body, ['username', 'password']);
    const row = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(asText(body.username).trim());
    if (!row || !verifyPassword(asText(body.password), row.password_salt, row.password_hash)) {
      throw new HttpError(401, 'Credenciales incorrectas.');
    }
    const token = createSession(row.id);
    send(res, 200, { token, user: rowUser(row) });
    return;
  }

  // POST /api/forgot-password — genera token de recuperación (sin email, el token se muestra en pantalla)
  if (req.method === 'POST' && pathname === '/api/forgot-password') {
    const body = await readJson(req);
    requireFields(body, ['email']);
    const row = db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND role IN ('dm','admin')").get(asText(body.email).trim());
    // Siempre responde OK para no filtrar si el email existe
    if (row) {
      const rawToken = crypto.randomBytes(24).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.id);
      db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(row.id, tokenHash(rawToken), expires, now());
      send(res, 200, { resetToken: rawToken }); // Se muestra en pantalla (app local)
    } else {
      send(res, 200, { resetToken: null });
    }
    return;
  }

  // POST /api/reset-password — usa el token para fijar nueva contraseña
  if (req.method === 'POST' && pathname === '/api/reset-password') {
    const body = await readJson(req);
    requireFields(body, ['token', 'password']);
    const raw = asText(body.token).trim();
    const resetRow = db.prepare(`
      SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?
    `).get(tokenHash(raw), now());
    if (!resetRow) throw new HttpError(400, 'Código inválido o caducado.');
    const newPwd = asText(body.password);
    if (newPwd.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
    const { salt, hash } = hashPassword(newPwd);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, resetRow.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(resetRow.user_id);
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    throw new HttpError(403, 'El registro de jugadores lo gestiona el Dungeon Master.');
  }

  const user = requireUser(req);

  if (req.method === 'GET' && pathname === '/api/me') {
    send(res, 200, { user });
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/me') {
    const body = await readJson(req);
    const updates = {};
    if (body.email !== undefined) updates.email = asText(body.email).trim().toLowerCase();
    if (body.displayName !== undefined && asText(body.displayName)) updates.display_name = asText(body.displayName);
    if (body.newPassword) {
      if (!body.currentPassword) throw new HttpError(400, 'Indica tu contraseña actual.');
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      if (!verifyPassword(asText(body.currentPassword), row.password_salt, row.password_hash)) {
        throw new HttpError(401, 'Contraseña actual incorrecta.');
      }
      if (asText(body.newPassword).length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres.');
      const { salt, hash } = hashPassword(asText(body.newPassword));
      updates.password_hash = hash;
      updates.password_salt = salt;
    }
    if (Object.keys(updates).length) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...Object.values(updates), user.id);
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    send(res, 200, { user: rowUser(updated) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    const header = req.headers.authorization || '';
    const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/campaigns') {
    let rows;
    if (user.role === 'admin') {
      rows = db.prepare('SELECT * FROM campaigns ORDER BY updated_at DESC').all();
    } else if (user.role === 'dm') {
      rows = db.prepare(`
        SELECT DISTINCT c.* FROM campaigns c
        WHERE c.dm_id = ?
          OR EXISTS (SELECT 1 FROM campaign_dms cd WHERE cd.campaign_id = c.id AND cd.user_id = ?)
        ORDER BY c.updated_at DESC
      `).all(user.id, user.id);
    } else {
      rows = db.prepare(`
        SELECT c.*
        FROM campaigns c
        JOIN campaign_players cp ON cp.campaign_id = c.id
        WHERE cp.player_id = ? AND cp.status = 'active'
        ORDER BY c.updated_at DESC
      `).all(user.id);
    }
    send(res, 200, { campaigns: rows.map(campaignDto) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/campaigns') {
    const body = await readJson(req);
    send(res, 201, { campaign: createCampaign(body, user) });
    return;
  }

  let match = pathname.match(/^\/api\/campaigns\/(\d+)$/);
  if (match && req.method === 'GET') {
    const campaign = getCampaignForUser(match[1], user);
    send(res, 200, { campaign: campaignDto(campaign) });
    return;
  }

  if (match && req.method === 'PUT') {
    const body = await readJson(req);
    send(res, 200, { campaign: updateCampaign(match[1], body, user) });
    return;
  }

  if (match && req.method === 'DELETE') {
    requireDm(user);
    const campaign = getCampaignForUser(match[1], user);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign.id);
    send(res, 200, { ok: true });
    return;
  }

  match = pathname.match(/^\/api\/campaigns\/(\d+)\/boards$/);
  if (match && req.method === 'GET') {
    const campaign = getCampaignForUser(match[1], user);
    const rows = user.role !== 'player'
      ? db.prepare('SELECT * FROM boards WHERE campaign_id = ? ORDER BY created_at ASC').all(campaign.id)
      : db.prepare(`
          SELECT DISTINCT b.*
          FROM boards b
          WHERE b.campaign_id = ?
          AND EXISTS (
            SELECT 1 FROM characters ch
            JOIN character_campaigns cc ON cc.character_id = ch.id
            WHERE ch.user_id = ? AND cc.campaign_id = b.campaign_id
            AND (
              NOT EXISTS (SELECT 1 FROM character_board_access cba WHERE cba.character_id = ch.id)
              OR EXISTS (SELECT 1 FROM character_board_access cba WHERE cba.character_id = ch.id AND cba.board_id = b.id)
            )
          )
          ORDER BY b.created_at ASC
        `).all(campaign.id, user.id);
    send(res, 200, { boards: rows.map(boardDto) });
    return;
  }

  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 201, { board: createBoard(match[1], body, user) });
    return;
  }

  match = pathname.match(/^\/api\/boards\/(\d+)$/);
  if (match && req.method === 'PUT') {
    const body = await readJson(req);
    send(res, 200, { board: updateBoard(match[1], body, user) });
    return;
  }

  if (match && req.method === 'DELETE') {
    requireDm(user);
    const board = getBoardForUser(match[1], user);
    db.prepare('DELETE FROM boards WHERE id = ?').run(board.id);
    send(res, 200, { ok: true });
    return;
  }

  match = pathname.match(/^\/api\/boards\/(\d+)\/announcements$/);
  if (match && req.method === 'GET') {
    const board = getBoardForUser(match[1], user);
    let rows;
    if (user.role === 'player') {
      // Los jugadores ven: disponibles, completados y los arrancados propios.
      // Los arrancados por otro jugador quedan ocultos.
      rows = db.prepare(`
        SELECT * FROM announcements
        WHERE board_id = ?
          AND status != 'archivado'
          AND hidden_from_players = 0
          AND (
            status != 'arrancado'
            OR EXISTS (
              SELECT 1 FROM pull_records pr
              WHERE pr.announcement_id = announcements.id
                AND pr.player_id = ?
                AND pr.active = 1
            )
          )
        ORDER BY created_at DESC
      `).all(board.id, user.id);
    } else {
      rows = db.prepare(`
        SELECT * FROM announcements WHERE board_id = ? ORDER BY created_at DESC
      `).all(board.id);
    }
    send(res, 200, { announcements: rows.map(row => announcementDto(row, user, user.role !== 'player')) });
    return;
  }

  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 201, { announcement: createAnnouncement(match[1], body, user) });
    return;
  }

  match = pathname.match(/^\/api\/announcements\/(\d+)$/);
  if (match && req.method === 'GET') {
    const row = getAnnouncementForUser(match[1], user);
    send(res, 200, { announcement: announcementDto(row, user, user.role !== 'player') });
    return;
  }

  if (match && req.method === 'PUT') {
    const body = await readJson(req);
    send(res, 200, { announcement: updateAnnouncement(match[1], body, user) });
    return;
  }

  if (match && req.method === 'DELETE') {
    requireDm(user);
    const announcement = getAnnouncementForUser(match[1], user);
    db.prepare('DELETE FROM announcements WHERE id = ?').run(announcement.id);
    send(res, 200, { ok: true });
    return;
  }

  match = pathname.match(/^\/api\/announcements\/(\d+)\/status$/);
  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 200, { announcement: setAnnouncementStatus(match[1], asText(body.status), user) });
    return;
  }

  match = pathname.match(/^\/api\/announcements\/(\d+)\/pull$/);
  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 200, { announcement: pullAnnouncement(match[1], body, user) });
    return;
  }

  match = pathname.match(/^\/api\/announcements\/(\d+)\/revert$/);
  if (match && req.method === 'POST') {
    send(res, 200, { announcement: revertPull(match[1], user) });
    return;
  }

  match = pathname.match(/^\/api\/campaigns\/(\d+)\/characters$/);
  if (match && req.method === 'GET') {
    const campaign = getCampaignForUser(match[1], user);
    const rows = user.role !== 'player'
      ? db.prepare(`
          SELECT ch.*, u.display_name AS player_name, u.username
          FROM characters ch
          JOIN users u ON u.id = ch.user_id
          JOIN character_campaigns cc ON cc.character_id = ch.id
          WHERE cc.campaign_id = ?
          ORDER BY u.display_name, ch.name
        `).all(campaign.id)
      : db.prepare(`
          SELECT ch.*, u.display_name AS player_name, u.username
          FROM characters ch
          JOIN users u ON u.id = ch.user_id
          JOIN character_campaigns cc ON cc.character_id = ch.id
          WHERE cc.campaign_id = ? AND ch.user_id = ?
          ORDER BY ch.name
        `).all(campaign.id, user.id);
    send(res, 200, { characters: rows.map(row => characterDto(row, user.role === 'dm')) });
    return;
  }

  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 201, { character: createCharacter(match[1], body, user) });
    return;
  }

  match = pathname.match(/^\/api\/characters\/(\d+)$/);
  if (match && req.method === 'PUT') {
    const body = await readJson(req);
    send(res, 200, { character: updateCharacter(match[1], body, user) });
    return;
  }

  if (match && req.method === 'DELETE') {
    requireDm(user);
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(match[1]));
    if (!row) throw new HttpError(404, 'Personaje no encontrado.');
    // Verificar que el DM tiene acceso a la campaña primaria del personaje
    getCampaignForUser(row.campaign_id, user); // admin siempre pasa, dm verifica acceso


    db.exec('BEGIN');
    try {
      const activePulls = db.prepare(`
        SELECT announcement_id
        FROM pull_records
        WHERE character_id = ? AND active = 1
      `).all(row.id);

      db.prepare(`
        UPDATE pull_records
        SET active = 0, reverted_at = ?, reverted_by = ?
        WHERE character_id = ? AND active = 1
      `).run(now(), user.id, row.id);

      for (const pull of activePulls) {
        db.prepare(`
          UPDATE announcements
          SET status = 'disponible', updated_at = ?
          WHERE id = ?
        `).run(now(), pull.announcement_id);
      }

      db.prepare('DELETE FROM characters WHERE id = ?').run(row.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    send(res, 200, { ok: true });
    return;
  }

  match = pathname.match(/^\/api\/campaigns\/(\d+)\/players$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const campaign = getCampaignForUser(match[1], user);
    const players = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.dm_password_hint, cp.status, cp.dm_notes, cp.created_at
      FROM campaign_players cp
      JOIN users u ON u.id = cp.player_id
      WHERE cp.campaign_id = ?
      ORDER BY u.display_name
    `).all(campaign.id);
    send(res, 200, { players: players.map(row => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      status: row.status,
      dmNotes: row.dm_notes || '',
      dmPasswordHint: row.dm_password_hint || '',
      createdAt: row.created_at
    })) });
    return;
  }

  if (match && req.method === 'POST') {
    const body = await readJson(req);
    send(res, 201, { player: createOrLinkPlayer(match[1], body, user) });
    return;
  }

  match = pathname.match(/^\/api\/campaigns\/(\d+)\/players\/(\d+)$/);
  if (match && req.method === 'DELETE') {
    send(res, 200, { player: removePlayerFromCampaign(match[1], match[2], user) });
    return;
  }

  // PUT /api/players/:id/password — DM cambia la contraseña de un jugador
  match = pathname.match(/^\/api\/players\/(\d+)\/password$/);
  if (match && req.method === 'PUT') {
    requireDm(user);
    const body = await readJson(req);
    requireFields(body, ['password']);
    const newPwd = asText(body.password);
    if (newPwd.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
    const player = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'player'").get(Number(match[1]));
    if (!player) throw new HttpError(404, 'Jugador no encontrado.');
    const { salt, hash } = hashPassword(newPwd);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, dm_password_hint = ? WHERE id = ?').run(hash, salt, newPwd, player.id);
    send(res, 200, { ok: true });
    return;
  }

  // GET /api/campaigns/:id/linkable-characters — personajes de las campañas del DM, con flag inCampaign
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/linkable-characters$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const campaign = getCampaignForUser(match[1], user);
    const rows = db.prepare(`
      SELECT ch.*, u.display_name AS player_name, u.username,
        CASE WHEN cc2.campaign_id IS NOT NULL THEN 1 ELSE 0 END AS in_campaign
      FROM characters ch
      JOIN users u ON u.id = ch.user_id
      JOIN character_campaigns cc ON cc.character_id = ch.id
      JOIN campaigns c ON c.id = cc.campaign_id
      LEFT JOIN character_campaigns cc2 ON cc2.character_id = ch.id AND cc2.campaign_id = ?
      WHERE (
        c.dm_id = ?
        OR EXISTS (SELECT 1 FROM campaign_dms cd WHERE cd.campaign_id = c.id AND cd.user_id = ?)
        OR ? = 'admin'
      )
      GROUP BY ch.id
      ORDER BY u.display_name, ch.name
    `).all(campaign.id, user.id, user.id, user.role);
    send(res, 200, { characters: rows.map(row => ({
      ...characterDto(row, true),
      inCampaign: Boolean(row.in_campaign)
    })) });
    return;
  }

  // GET /api/boards/:id/characters — personajes con acceso a un tablón específico (DM)
  match = pathname.match(/^\/api\/boards\/(\d+)\/characters$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const board = getBoardForUser(match[1], user);
    // Todos los personajes de la campaña + flag de si tienen acceso a este tablón
    const rows = db.prepare(`
      SELECT ch.*, u.display_name AS player_name, u.username,
        CASE WHEN cba.board_id IS NOT NULL THEN 1 ELSE 0 END AS has_access,
        (SELECT COUNT(*) FROM character_board_access WHERE character_id = ch.id) AS restriction_count
      FROM characters ch
      JOIN users u ON u.id = ch.user_id
      JOIN character_campaigns cc ON cc.character_id = ch.id
      LEFT JOIN character_board_access cba ON cba.character_id = ch.id AND cba.board_id = ?
      WHERE cc.campaign_id = ?
      ORDER BY u.display_name, ch.name
    `).all(board.id, board.campaign_id);
    send(res, 200, { characters: rows.map(row => ({
      ...characterDto(row, true),
      hasAccess: row.restriction_count === 0 || Boolean(row.has_access),
      explicitAccess: Boolean(row.has_access),
      hasRestrictions: row.restriction_count > 0
    })) });
    return;
  }

  // GET /api/campaigns/:id/players/:playerId/characters — todos los personajes del jugador
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/players\/(\d+)\/characters$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const campaign = getCampaignForUser(match[1], user);
    const targetCampaignId = campaign.id;
    const playerId = Number(match[2]);
    const rows = db.prepare(`
      SELECT ch.*, u.display_name AS player_name, u.username,
        CASE WHEN cc.campaign_id IS NOT NULL THEN 1 ELSE 0 END AS in_campaign
      FROM characters ch
      JOIN users u ON u.id = ch.user_id
      LEFT JOIN character_campaigns cc ON cc.character_id = ch.id AND cc.campaign_id = ?
      WHERE ch.user_id = ?
      ORDER BY ch.name
    `).all(targetCampaignId, playerId);
    send(res, 200, { characters: rows.map(row => ({
      ...characterDto(row, true),
      inCampaign: Boolean(row.in_campaign)
    })) });
    return;
  }

  // POST /api/campaigns/:id/characters/:charId/assign — asignar personaje a campaña
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/characters\/(\d+)\/assign$/);
  if (match && req.method === 'POST') {
    requireDm(user);
    const campaign = getCampaignForUser(match[1], user);
    const charRow = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(match[2]));
    if (!charRow) throw new HttpError(404, 'Personaje no encontrado.');
    db.prepare('INSERT OR IGNORE INTO character_campaigns (character_id, campaign_id, created_at) VALUES (?, ?, ?)')
      .run(charRow.id, campaign.id, now());
    send(res, 200, { ok: true });
    return;
  }

  // POST /api/campaigns/:id/characters/:charId/unassign — desasignar personaje de campaña
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/characters\/(\d+)\/unassign$/);
  if (match && req.method === 'POST') {
    requireDm(user);
    const campaign = getCampaignForUser(match[1], user);
    // Revocar pulls activos de este personaje en esta campaña
    const charId = Number(match[2]);
    const timestamp = now();
    db.exec('BEGIN');
    try {
      const activePulls = db.prepare(`
        SELECT announcement_id FROM pull_records
        WHERE character_id = ? AND campaign_id = ? AND active = 1
      `).all(charId, campaign.id);
      db.prepare('UPDATE pull_records SET active = 0, reverted_at = ?, reverted_by = ? WHERE character_id = ? AND campaign_id = ? AND active = 1')
        .run(timestamp, user.id, charId, campaign.id);
      for (const pull of activePulls) {
        db.prepare('UPDATE announcements SET status = ?, updated_at = ? WHERE id = ?')
          .run('disponible', timestamp, pull.announcement_id);
      }
      db.prepare('DELETE FROM character_campaigns WHERE character_id = ? AND campaign_id = ?')
        .run(charId, campaign.id);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    send(res, 200, { ok: true });
    return;
  }

  match = pathname.match(/^\/api\/characters\/(\d+)\/board-access$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(match[1]));
    if (!row) throw new HttpError(404, 'Personaje no encontrado.');
    getCampaignForUser(row.campaign_id, user);
    send(res, 200, { boardIds: getBoardAccessIds(row.id) });
    return;
  }

  if (match && req.method === 'PUT') {
    requireDm(user);
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(match[1]));
    if (!row) throw new HttpError(404, 'Personaje no encontrado.');
    const campaign = getCampaignForUser(row.campaign_id, user);
    if (user.role !== 'admin' && campaign.dm_id !== user.id) throw new HttpError(403, 'No puedes editar ese personaje.');
    const body = await readJson(req);
    const boardIds = Array.isArray(body.boardIds) ? body.boardIds.map(Number).filter(Boolean) : [];
    setBoardAccess(row.id, boardIds);
    send(res, 200, { boardIds: getBoardAccessIds(row.id) });
    return;
  }

  // POST /api/characters/:id/board-access/:boardId  — dar acceso a un tablón
  // DELETE /api/characters/:id/board-access/:boardId — quitar acceso a un tablón
  match = pathname.match(/^\/api\/characters\/(\d+)\/board-access\/(\d+)$/);
  if (match && req.method === 'POST') {
    const charRow = getCharacterForDm(match[1], user);
    const boardRow = db.prepare('SELECT * FROM boards WHERE id = ?').get(Number(match[2]));
    if (!boardRow) throw new HttpError(404, 'Tablón no encontrado.');
    db.prepare('INSERT OR IGNORE INTO character_board_access (character_id, board_id, created_at) VALUES (?, ?, ?)').run(charRow.id, boardRow.id, now());
    send(res, 200, { boardIds: getBoardAccessIds(charRow.id) });
    return;
  }
  if (match && req.method === 'DELETE') {
    const charRow = getCharacterForDm(match[1], user);
    db.prepare('DELETE FROM character_board_access WHERE character_id = ? AND board_id = ?').run(charRow.id, Number(match[2]));
    send(res, 200, { boardIds: getBoardAccessIds(charRow.id) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/notifications') {
    requireDm(user);
    const rows = db.prepare(`
      SELECT *
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(user.id);
    send(res, 200, { notifications: rows.map(notificationDto) });
    return;
  }

  match = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (match && req.method === 'POST') {
    requireDm(user);
    const row = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(Number(match[1]), user.id);
    if (!row) throw new HttpError(404, 'Notificación no encontrada.');
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(now(), row.id);
    send(res, 200, { notification: notificationDto(db.prepare('SELECT * FROM notifications WHERE id = ?').get(row.id)) });
    return;
  }

  // ═══════════════════════════════════════
  //  RUTAS DE ADMINISTRADOR
  // ═══════════════════════════════════════

  // GET /api/admin/dms — lista de todos los masters
  if (req.method === 'GET' && pathname === '/api/admin/dms') {
    requireAdmin(user);
    const rows = db.prepare(`
      SELECT u.*, COUNT(DISTINCT cd.campaign_id) AS campaign_count
      FROM users u
      LEFT JOIN campaign_dms cd ON cd.user_id = u.id
      WHERE u.role = 'dm'
      GROUP BY u.id
      ORDER BY u.display_name
    `).all();
    send(res, 200, { dms: rows.map(row => ({ ...rowUser(row), campaignCount: row.campaign_count })) });
    return;
  }

  // POST /api/admin/dms — crear nuevo master
  if (req.method === 'POST' && pathname === '/api/admin/dms') {
    requireAdmin(user);
    const body = await readJson(req);
    requireFields(body, ['username', 'displayName', 'password']);
    const pwd = asText(body.password);
    if (pwd.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(asText(body.username).trim());
    if (existing) throw new HttpError(409, 'Ese nombre de usuario ya existe.');
    const newId = insertUser(asText(body.username), asText(body.displayName), 'dm', pwd);
    if (asText(body.email)) {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(asText(body.email).toLowerCase().trim(), newId);
    }
    const newRow = db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
    send(res, 201, { dm: rowUser(newRow) });
    return;
  }

  // PUT /api/admin/dms/:id — editar master
  match = pathname.match(/^\/api\/admin\/dms\/(\d+)$/);
  if (match && req.method === 'PUT') {
    requireAdmin(user);
    const body = await readJson(req);
    const dm = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'dm'").get(Number(match[1]));
    if (!dm) throw new HttpError(404, 'Maestro no encontrado.');
    const updates = {};
    if (body.displayName) updates.display_name = asText(body.displayName);
    if (body.email !== undefined) updates.email = asText(body.email).toLowerCase().trim();
    if (body.password) {
      const pwd = asText(body.password);
      if (pwd.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.');
      const { salt, hash } = hashPassword(pwd);
      updates.password_hash = hash;
      updates.password_salt = salt;
      updates.dm_password_hint = pwd;
    }
    if (Object.keys(updates).length) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...Object.values(updates), dm.id);
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(dm.id);
    send(res, 200, { dm: rowUser(updated) });
    return;
  }

  // GET /api/admin/campaigns — todas las campañas con sus masters
  if (req.method === 'GET' && pathname === '/api/admin/campaigns') {
    requireAdmin(user);
    const rows = db.prepare('SELECT * FROM campaigns ORDER BY updated_at DESC').all();
    const result = rows.map(row => {
      const dms = db.prepare(`
        SELECT u.id, u.username, u.display_name AS displayName
        FROM campaign_dms cd
        JOIN users u ON u.id = cd.user_id
        WHERE cd.campaign_id = ?
        ORDER BY u.display_name
      `).all(row.id);
      return { ...campaignDto(row), dms };
    });
    send(res, 200, { campaigns: result });
    return;
  }

  // GET /api/admin/campaigns/:id/dms — masters de una campaña concreta
  match = pathname.match(/^\/api\/admin\/campaigns\/(\d+)\/dms$/);
  if (match && req.method === 'GET') {
    requireAdmin(user);
    const dms = db.prepare(`
      SELECT u.id, u.username, u.display_name AS displayName
      FROM campaign_dms cd
      JOIN users u ON u.id = cd.user_id
      WHERE cd.campaign_id = ?
      ORDER BY u.display_name
    `).all(Number(match[1]));
    send(res, 200, { dms });
    return;
  }

  // POST /api/admin/campaigns/:id/dms — añadir master a campaña
  if (match && req.method === 'POST') {
    requireAdmin(user);
    const body = await readJson(req);
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(match[1]));
    if (!campaign) throw new HttpError(404, 'Campaña no encontrada.');
    const dm = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'dm'").get(Number(body.userId));
    if (!dm) throw new HttpError(404, 'Maestro no encontrado.');
    db.prepare('INSERT OR IGNORE INTO campaign_dms (campaign_id, user_id, created_at) VALUES (?, ?, ?)').run(campaign.id, dm.id, now());
    const dms = db.prepare(`
      SELECT u.id, u.username, u.display_name AS displayName
      FROM campaign_dms cd JOIN users u ON u.id = cd.user_id
      WHERE cd.campaign_id = ? ORDER BY u.display_name
    `).all(campaign.id);
    send(res, 200, { dms });
    return;
  }

  // DELETE /api/admin/campaigns/:id/dms/:userId — quitar master de campaña
  match = pathname.match(/^\/api\/admin\/campaigns\/(\d+)\/dms\/(\d+)$/);
  if (match && req.method === 'DELETE') {
    requireAdmin(user);
    db.prepare('DELETE FROM campaign_dms WHERE campaign_id = ? AND user_id = ?').run(Number(match[1]), Number(match[2]));
    send(res, 200, { ok: true });
    return;
  }

  // DELETE /api/admin/dms/:id — eliminar maestro (solo si no tiene campañas asignadas)
  match = pathname.match(/^\/api\/admin\/dms\/(\d+)$/);
  if (match && req.method === 'DELETE') {
    requireAdmin(user);
    const dm = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'dm'").get(Number(match[1]));
    if (!dm) throw new HttpError(404, 'Maestro no encontrado.');
    const campaignCount = db.prepare('SELECT COUNT(*) AS n FROM campaign_dms WHERE user_id = ?').get(dm.id).n;
    if (campaignCount > 0) throw new HttpError(409, 'Este maestro tiene campañas asignadas. Desvinculalas antes de eliminar la cuenta.');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(dm.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(dm.id);
    send(res, 200, { ok: true });
    return;
  }

  // POST /api/notifications/read-all — marcar todas las notificaciones del usuario como leídas
  if (req.method === 'POST' && pathname === '/api/notifications/read-all') {
    requireDm(user);
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), user.id);
    send(res, 200, { ok: true });
    return;
  }

  // GET /api/campaigns/:id/pull-history — historial de encargos de la campaña
  match = pathname.match(/^\/api\/campaigns\/(\d+)\/pull-history$/);
  if (match && req.method === 'GET') {
    requireDm(user);
    const campaign = getCampaignForUser(match[1], user);
    const rows = db.prepare(`
      SELECT
        pr.id, pr.pulled_at, pr.reverted_at, pr.active,
        a.title AS announcement_title, a.id AS announcement_id,
        u.display_name AS player_name, u.username,
        ch.name AS character_name,
        b.name AS board_name,
        ru.display_name AS reverted_by_name
      FROM pull_records pr
      JOIN announcements a ON a.id = pr.announcement_id
      JOIN users u ON u.id = pr.player_id
      JOIN characters ch ON ch.id = pr.character_id
      JOIN boards b ON b.id = pr.board_id
      LEFT JOIN users ru ON ru.id = pr.reverted_by
      WHERE pr.campaign_id = ?
      ORDER BY pr.pulled_at DESC
      LIMIT 200
    `).all(campaign.id);
    send(res, 200, { history: rows.map(r => ({
      id: r.id,
      announcementId: r.announcement_id,
      announcementTitle: r.announcement_title,
      boardName: r.board_name,
      playerName: r.player_name,
      username: r.username,
      characterName: r.character_name,
      pulledAt: r.pulled_at,
      revertedAt: r.reverted_at,
      revertedByName: r.reverted_by_name,
      active: Boolean(r.active)
    })) });
    return;
  }

  // GET /api/backup — descarga la base de datos SQLite (solo admin)
  if (req.method === 'GET' && pathname === '/api/backup') {
    requireAdmin(user);
    if (!fs.existsSync(DB_PATH)) throw new HttpError(404, 'Fichero de base de datos no encontrado.');
    const filename = `tablon-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store'
    });
    fs.createReadStream(DB_PATH).pipe(res);
    return;
  }

  // PUT /api/admin/me — el admin puede cambiar su propia contraseña/email
  if (req.method === 'PUT' && pathname === '/api/admin/me') {
    requireAdmin(user);
    const body = await readJson(req);
    const updates = {};
    if (body.email !== undefined) updates.email = asText(body.email).toLowerCase().trim();
    if (body.displayName !== undefined && asText(body.displayName)) updates.display_name = asText(body.displayName);
    if (body.newPassword) {
      if (!body.currentPassword) throw new HttpError(400, 'Indica tu contraseña actual.');
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      if (!verifyPassword(asText(body.currentPassword), row.password_salt, row.password_hash)) {
        throw new HttpError(401, 'Contraseña actual incorrecta.');
      }
      if (asText(body.newPassword).length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres.');
      const { salt, hash } = hashPassword(asText(body.newPassword));
      updates.password_hash = hash;
      updates.password_salt = salt;
    }
    if (Object.keys(updates).length) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...Object.values(updates), user.id);
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    send(res, 200, { user: rowUser(updated) });
    return;
  }

  throw new HttpError(404, 'Ruta no encontrada.');
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, url) {
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'content-type': mimeTypes[ext] || 'application/octet-stream',
    'cache-control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    const status = error.status || 500;
    send(res, status, {
      error: error.message || 'Error interno.',
      status
    });
    if (status === 500) console.error(error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Tablón de anuncios listo en http://${HOST}:${PORT}`);
});
