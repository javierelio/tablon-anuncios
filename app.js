const app = document.getElementById('app');

const storageKeys = {
  token: 'tablon.token',
  campaign: 'tablon.campaign',
  board: 'tablon.board',
  activeCharacters: 'tablon.activeCharacters'
};

const state = {
  token: localStorage.getItem(storageKeys.token),
  user: null,
  authMode: 'login',
  view: 'boards',
  campaigns: [],
  boards: [],
  boardAnnouncements: {},
  allAnnouncements: [],
  announcements: [],
  characters: [],
  players: [],
  notifications: [],
  selectedCampaignId: Number(localStorage.getItem(storageKeys.campaign) || 0),
  selectedBoardId: Number(localStorage.getItem(storageKeys.board) || 0),
  activeCharacters: readJsonStorage(storageKeys.activeCharacters, {}),
  filters: {
    tag: 'all',
    status: 'all'
  },
  modal: null,
  toast: null
};

let toastTimer = null;

const labels = {
  disponible: 'Disponible',
  arrancado: 'Arrancado',
  completado: 'Completado',
  archivado: 'Archivado',
  bajo: 'Bajo',
  moderado: 'Moderado',
  alto: 'Alto',
  mortal: 'Mortal',
  idea: 'Idea',
  preparada: 'Preparada',
  en_juego: 'En juego',
  resuelta: 'Resuelta',
  descartada: 'Descartada'
};

const boardTypes = [
  'facción',
  'población',
  'región',
  'gremio',
  'rumor',
  'taberna',
  'autoridad local',
  'otro'
];

const navByRole = {
  dm: [
    ['boards', 'Tablón'],
    ['characters', 'Jugadores'],
    ['notifications', 'Avisos'],
    ['campaigns', 'Campañas']
  ],
  player: [
    ['boards', 'Tablón'],
    ['characters', 'Personajes'],
    ['pulled', 'Mis encargos']
  ]
};

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function shortText(value, length = 150) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function hasValue(value) {
  return String(value ?? '').trim().length > 0;
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function selectedCampaign() {
  return state.campaigns.find(campaign => campaign.id === state.selectedCampaignId) || null;
}

function selectedBoard() {
  return state.boards.find(board => board.id === state.selectedBoardId) || null;
}

function activeCharacterId() {
  return Number(state.activeCharacters[state.selectedCampaignId] || 0);
}

function activeCharacter() {
  const id = activeCharacterId();
  return state.characters.find(character => character.id === id) || null;
}

async function api(path, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {})
  };
  if (state.token) headers.authorization = `Bearer ${state.token}`;

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login' && path !== '/api/register') {
      logout(false);
    }
    throw new Error(data.error || 'La petición falló.');
  }
  return data;
}

function setToast(message, isError = false) {
  state.toast = { message, isError };
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    render();
  }, 3200);
}

function logout(renderAfter = true) {
  localStorage.removeItem(storageKeys.token);
  state.token = null;
  state.user = null;
  state.campaigns = [];
  state.boards = [];
  state.announcements = [];
  state.allAnnouncements = [];
  state.boardAnnouncements = {};
  state.characters = [];
  state.players = [];
  state.notifications = [];
  state.modal = null;
  if (renderAfter) render();
}

async function loadWorkspace() {
  const { campaigns } = await api('/api/campaigns');
  state.campaigns = campaigns;

  if (!state.campaigns.some(campaign => campaign.id === state.selectedCampaignId)) {
    state.selectedCampaignId = state.campaigns[0]?.id || 0;
  }
  localStorage.setItem(storageKeys.campaign, String(state.selectedCampaignId || ''));

  if (state.user?.role === 'dm') {
    const { notifications } = await api('/api/notifications');
    state.notifications = notifications;
  } else {
    state.notifications = [];
  }

  await loadCampaignContext();
}

async function loadCampaignContext() {
  const campaign = selectedCampaign();
  state.boards = [];
  state.characters = [];
  state.players = [];
  state.announcements = [];
  state.allAnnouncements = [];
  state.boardAnnouncements = {};
  if (!campaign) return;

  const boardPromise = api(`/api/campaigns/${campaign.id}/boards`);
  const characterPromise = api(`/api/campaigns/${campaign.id}/characters`);
  const playerPromise = state.user.role === 'dm'
    ? api(`/api/campaigns/${campaign.id}/players`)
    : Promise.resolve({ players: [] });

  const [{ boards }, { characters }, { players }] = await Promise.all([
    boardPromise,
    characterPromise,
    playerPromise
  ]);

  state.boards = boards;
  state.characters = characters;
  state.players = players;

  if (!state.boards.some(board => board.id === state.selectedBoardId)) {
    state.selectedBoardId = state.boards[0]?.id || 0;
  }
  localStorage.setItem(storageKeys.board, String(state.selectedBoardId || ''));

  await loadAllAnnouncements();
}

async function loadAllAnnouncements() {
  state.boardAnnouncements = {};
  state.allAnnouncements = [];
  state.announcements = [];
  if (!state.boards.length) return;

  const entries = await Promise.all(state.boards.map(async board => {
    const { announcements } = await api(`/api/boards/${board.id}/announcements`);
    return [board.id, announcements.map(announcement => ({
      ...announcement,
      boardName: board.name,
      boardType: board.type
    }))];
  }));

  for (const [boardId, announcements] of entries) {
    state.boardAnnouncements[boardId] = announcements;
    state.allAnnouncements.push(...announcements);
  }
  state.announcements = state.boardAnnouncements[state.selectedBoardId] || [];
}

async function init() {
  if (state.token) {
    try {
      const { user } = await api('/api/me');
      state.user = user;
      await loadWorkspace();
    } catch {
      logout(false);
    }
  }
  render();
}

function render() {
  app.innerHTML = state.user ? renderApp() : renderAuth();
}

function renderAuth() {
  return `
    <section class="auth-screen">
      <div class="auth-visual">
        <div class="auth-brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <h1>Tablón de Anuncios</h1>
          <p>Campañas westmarch con encargos turbios, tablones por facción y notas privadas para quien sostiene la pantalla tras la mesa.</p>
        </div>
      </div>
      <div class="auth-card">
        ${renderLoginForm()}
        <div class="hint-box">
          <strong>Cuentas de prueba</strong><br>
          DM: <code>dm</code> / <code>dm123</code><br>
          Jugador: <code>jugador</code> / <code>jugador123</code><br>
          Los jugadores nuevos los crea el DM y les pasa su contraseña inicial por mensaje privado.
        </div>
      </div>
      ${renderToast()}
    </section>
  `;
}

function renderLoginForm() {
  return `
    <form class="form-grid" data-form="login">
      <label>Usuario
        <input name="username" autocomplete="username" required value="dm">
      </label>
      <label>Contraseña
        <input name="password" type="password" autocomplete="current-password" required value="dm123">
      </label>
      <button class="metal-button primary" type="submit">Iniciar sesión</button>
    </form>
  `;
}

function renderRegisterForm() {
  return `
    <form class="form-grid" data-form="register">
      <label>Usuario
        <input name="username" autocomplete="username" required minlength="3">
      </label>
      <label>Nombre visible
        <input name="displayName" required>
      </label>
      <label>Contraseña
        <input name="password" type="password" autocomplete="new-password" required minlength="6">
      </label>
      <button class="metal-button primary" type="submit">Crear jugador</button>
    </form>
  `;
}

function renderApp() {
  return `
    <div class="app-layout">
      ${renderTopbar()}
      ${renderLeftRail()}
      <main class="main-area">
        ${renderMain()}
      </main>
      ${renderRightRail()}
      ${renderModal()}
      ${renderToast()}
    </div>
  `;
}

function renderTopbar() {
  const campaign = selectedCampaign();
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div>
          <div class="brand-title">Tablón de Anuncios</div>
          <div class="brand-subtitle">${campaign ? escapeHtml(campaign.name) : 'Westmarch grimdark'}</div>
        </div>
      </div>
      <div class="user-strip">
        <span class="role-badge">${state.user.role === 'dm' ? 'Dungeon Master' : 'Jugador'}</span>
        <span>${escapeHtml(state.user.displayName)}</span>
        <button class="ghost-button" type="button" data-action="logout">Salir</button>
      </div>
    </header>
  `;
}

function renderLeftRail() {
  const nav = navByRole[state.user.role];
  return `
    <aside class="left-rail">
      <nav class="nav-stack" aria-label="Navegación">
        ${nav.map(([view, label]) => `
          <button class="nav-button ${state.view === view ? 'active' : ''}" type="button" data-action="nav" data-view="${view}">
            ${label}
          </button>
        `).join('')}
      </nav>
      <hr style="border:0;border-top:1px solid rgba(164,136,67,.18);margin:1rem 0;">
      <div class="campaign-list">
        ${state.campaigns.map(campaign => `
          <button class="campaign-button ${campaign.id === state.selectedCampaignId ? 'active' : ''}" type="button" data-action="select-campaign" data-id="${campaign.id}">
            ${escapeHtml(campaign.name)}
            <span>${campaign.stats.board_count} tablones, ${campaign.stats.announcement_count} anuncios</span>
          </button>
        `).join('') || `<div class="muted">No hay campañas todavía.</div>`}
        ${state.user.role === 'dm' ? `<button class="metal-button" type="button" data-action="open-modal" data-modal="campaign-form">Nueva campaña</button>` : ''}
      </div>
    </aside>
  `;
}

function renderRightRail() {
  const campaign = selectedCampaign();
  return `
    <aside class="right-rail">
      <div class="side-stack">
        ${campaign ? renderCampaignSideCard(campaign) : ''}
        ${state.user.role === 'dm' ? renderDmSideCards() : renderPlayerSideCards()}
      </div>
    </aside>
  `;
}

function renderCampaignSideCard(campaign) {
  return `
    <section class="side-card">
      <h3>${escapeHtml(campaign.name)}</h3>
      <p class="muted">${escapeHtml(campaign.description || 'Sin descripción.')}</p>
      <div class="notice-tags">
        <span class="tag">${campaign.stats.player_count} jugadores</span>
        <span class="tag">${campaign.stats.character_count} personajes</span>
        <span class="tag">${campaign.stats.board_count} tablones</span>
      </div>
    </section>
  `;
}

function renderDmSideCards() {
  const unread = state.notifications.filter(notification => !notification.readAt);
  return `
    <section class="side-card">
      <h3>Avisos internos</h3>
      ${state.notifications.slice(0, 5).map(notification => `
        <div class="notification-item ${notification.readAt ? '' : 'unread'}">
          <span>${escapeHtml(notification.message)}</span>
          <small class="muted">${formatDate(notification.createdAt)}</small>
          ${notification.readAt ? '' : `<button class="ghost-button" type="button" data-action="mark-read" data-id="${notification.id}">Marcar leído</button>`}
        </div>
      `).join('') || `<p class="muted">Sin avisos nuevos.</p>`}
      ${unread.length ? `<p class="muted">${unread.length} sin leer</p>` : ''}
    </section>
    <section class="side-card">
      <h3>Jugadores</h3>
      ${state.players.map(player => `
        <div class="pulled-item">
          <strong>${escapeHtml(player.displayName)}</strong>
          <small class="muted">@${escapeHtml(player.username)}</small>
        </div>
      `).join('') || `<p class="muted">Añade jugadores por nombre de usuario.</p>`}
      ${selectedCampaign() ? `<button class="metal-button" type="button" data-action="open-modal" data-modal="player-form">Crear/vincular jugador</button>` : ''}
    </section>
  `;
}

function renderPlayerSideCards() {
  const active = activeCharacter();
  const pulled = myPulledAnnouncements();
  return `
    <section class="side-card">
      <h3>Personaje activo</h3>
      ${renderCharacterSelect()}
      ${active ? `<p class="muted">${escapeHtml(active.ancestry || 'Sin linaje')} ${escapeHtml(active.archetype || '')}</p>` : `<p class="muted">Elige un personaje asignado por el DM.</p>`}
    </section>
    <section class="side-card">
      <h3>Encargos arrancados</h3>
      ${pulled.slice(0, 5).map(announcement => `
        <button class="nav-button" type="button" data-action="open-announcement" data-id="${announcement.id}">
          ${escapeHtml(announcement.title)}
          <span>${escapeHtml(announcement.pull?.characterName || '')}</span>
        </button>
      `).join('') || `<p class="muted">Todavía no hay pergaminos arrancados.</p>`}
    </section>
  `;
}

function renderMain() {
  if (!state.campaigns.length) {
    return renderNoCampaigns();
  }
  if (!selectedCampaign()) {
    return renderNoCampaigns();
  }

  if (state.view === 'campaigns') return renderCampaignsView();
  if (state.view === 'boards') return renderBoardsView();
  if (state.view === 'characters') return renderCharactersView();
  if (state.view === 'notifications') return renderNotificationsView();
  if (state.view === 'pulled') return renderPulledView();
  // Vista por defecto: tablón (para DM y jugador)
  return renderBoardsView();
}

function renderNoCampaigns() {
  return `
    <section class="empty-state">
      <div>
        <h2 class="section-title">Sin campañas en el tablón</h2>
        <p>${state.user.role === 'dm' ? 'Crea la primera campaña para clavar los primeros avisos.' : 'Tu cuenta aún no está vinculada a ninguna campaña.'}</p>
        ${state.user.role === 'dm' ? `<button class="metal-button primary" type="button" data-action="open-modal" data-modal="campaign-form">Crear campaña</button>` : ''}
      </div>
    </section>
  `;
}

function renderDashboardView() {
  const campaign = selectedCampaign();
  const stats = campaignStats();
  return `
    <section class="view-header">
      <div>
        <h2>${state.user.role === 'dm' ? 'Dashboard del DM' : 'Dashboard del jugador'}</h2>
        <p>${escapeHtml(campaign.description)}</p>
      </div>
      <div class="actions">
        ${state.user.role === 'dm' ? `<button class="metal-button primary" type="button" data-action="open-modal" data-modal="announcement-form">Nuevo anuncio</button>` : ''}
        ${state.user.role === 'player' ? `<button class="metal-button primary" type="button" data-action="nav" data-view="boards">Ir al tablón</button>` : ''}
      </div>
    </section>
    ${renderStats(stats)}
    <section class="list-grid">
      ${state.boards.map(board => `
        <article class="list-card">
          <h3>${escapeHtml(board.name)}</h3>
          <p>${escapeHtml(board.description || 'Sin descripción.')}</p>
          <div class="notice-tags">
            <span class="tag">${escapeHtml(board.type)}</span>
            <span class="tag">${board.stats.announcementCount} anuncios</span>
            <span class="tag">${board.stats.pulledCount} arrancados</span>
          </div>
          <button class="ghost-button" type="button" data-action="select-board" data-id="${board.id}" data-view="boards">Abrir</button>
        </article>
      `).join('') || `<div class="empty-state">No hay tablones en esta campaña.</div>`}
    </section>
  `;
}

function renderStats(stats) {
  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${stats.boards}</div><div class="stat-label">Tablones</div></div>
      <div class="stat-card"><div class="stat-value">${stats.available}</div><div class="stat-label">Disponibles</div></div>
      <div class="stat-card"><div class="stat-value">${stats.pulled}</div><div class="stat-label">Arrancados</div></div>
      <div class="stat-card"><div class="stat-value">${stats.characters}</div><div class="stat-label">Personajes</div></div>
    </div>
  `;
}

function campaignStats() {
  return {
    boards: state.boards.length,
    available: state.allAnnouncements.filter(announcement => announcement.status === 'disponible').length,
    pulled: state.allAnnouncements.filter(announcement => announcement.status === 'arrancado').length,
    characters: state.characters.length
  };
}

function renderCampaignsView() {
  return `
    <section class="view-header">
      <div>
        <h2>Vista de campañas</h2>
        <p>Campañas autorizadas para esta cuenta.</p>
      </div>
      ${state.user.role === 'dm' ? `<button class="metal-button primary" type="button" data-action="open-modal" data-modal="campaign-form">Nueva campaña</button>` : ''}
    </section>
    <section class="list-grid">
      ${state.campaigns.map(campaign => `
        <article class="list-card">
          <h3>${escapeHtml(campaign.name)}</h3>
          <p>${escapeHtml(campaign.description || 'Sin descripción.')}</p>
          <div class="notice-tags">
            <span class="tag">${campaign.stats.board_count} tablones</span>
            <span class="tag">${campaign.stats.player_count} jugadores</span>
            <span class="tag">${campaign.stats.character_count} personajes</span>
          </div>
          <div class="actions">
            <button class="ghost-button" type="button" data-action="select-campaign" data-id="${campaign.id}">Abrir</button>
            ${state.user.role === 'dm' ? `<button class="ghost-button" type="button" data-action="edit-campaign" data-id="${campaign.id}">Editar</button>` : ''}
            ${state.user.role === 'dm' ? `<button class="danger-button" type="button" data-action="delete-campaign" data-id="${campaign.id}">Eliminar</button>` : ''}
          </div>
        </article>
      `).join('')}
    </section>
  `;
}

function renderCampaignDetailView() {
  const campaign = selectedCampaign();
  return `
    <section class="view-header">
      <div>
        <h2>${escapeHtml(campaign.name)}</h2>
        <p>${escapeHtml(campaign.description)}</p>
      </div>
      <div class="actions">
        ${state.user.role === 'dm' ? `<button class="ghost-button" type="button" data-action="edit-campaign" data-id="${campaign.id}">Editar campaña</button>` : ''}
        ${state.user.role === 'dm' ? `<button class="metal-button" type="button" data-action="open-modal" data-modal="board-form">Nuevo tablón</button>` : ''}
      </div>
    </section>
    ${renderStats(campaignStats())}
    <section class="list-grid">
      <article class="list-card">
        <h3>Tablones asociados</h3>
        ${state.boards.map(board => `
          <div class="pulled-item">
            <strong>${escapeHtml(board.name)}</strong>
            <span class="muted">${escapeHtml(board.type)} · ${board.stats.announcementCount} anuncios</span>
          </div>
        `).join('') || `<p class="muted">Sin tablones.</p>`}
      </article>
      <article class="list-card">
        <h3>Jugadores vinculados</h3>
        ${state.players.map(player => `
          <div class="pulled-item">
            <strong>${escapeHtml(player.displayName)}</strong>
            <span class="muted">@${escapeHtml(player.username)}</span>
          </div>
        `).join('') || `<p class="muted">${state.user.role === 'dm' ? 'Sin jugadores vinculados.' : 'Lista privada del DM.'}</p>`}
        ${state.user.role === 'dm' ? `<button class="ghost-button" type="button" data-action="open-modal" data-modal="player-form">Crear/vincular jugador</button>` : ''}
      </article>
      <article class="list-card">
        <h3>Personajes por jugador</h3>
        ${state.characters.map(character => `
          <div class="pulled-item">
            <strong>${escapeHtml(character.name)}</strong>
            <span class="muted">${escapeHtml(character.playerName || state.user.displayName)}</span>
          </div>
        `).join('') || `<p class="muted">Sin personajes.</p>`}
      </article>
    </section>
  `;
}

function renderBoardsView() {
  const board = selectedBoard();
  return `
    <section class="view-header">
      <div>
        <h2>${board ? escapeHtml(board.name) : 'Tablones'}</h2>
        <p>${board ? escapeHtml(board.description || board.type) : 'No hay tablones en esta campaña.'}</p>
      </div>
      <div class="actions">
        ${state.user.role === 'dm' ? `<button class="metal-button" type="button" data-action="open-modal" data-modal="board-form">Nuevo tablón</button>` : ''}
        ${state.user.role === 'dm' && board ? `<button class="ghost-button" type="button" data-action="edit-board" data-id="${board.id}">Editar tablón</button>` : ''}
        ${state.user.role === 'dm' && board ? `<button class="metal-button primary" type="button" data-action="open-modal" data-modal="announcement-form">Nuevo anuncio</button>` : ''}
      </div>
    </section>
    ${renderBoardTabs()}
    ${board ? renderFilters() : ''}
    ${renderBoardSurface()}
  `;
}

function renderBoardTabs() {
  if (!state.boards.length) {
    return `<div class="empty-state">No hay tablones todavía.</div>`;
  }
  return `
    <div class="board-tabs">
      ${state.boards.map(board => `
        <button class="board-tab ${board.id === state.selectedBoardId ? 'active' : ''}" type="button" data-action="select-board" data-id="${board.id}">
          ${escapeHtml(board.name)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderFilters() {
  const tags = [...new Set(state.announcements.flatMap(announcement => announcement.tags || []))].sort();
  return `
    <div class="filter-row">
      <label>Etiqueta
        <select data-action="filter" data-filter="tag">
          <option value="all">Todas</option>
          ${tags.map(tag => `<option value="${escapeHtml(tag)}" ${state.filters.tag === tag ? 'selected' : ''}>${escapeHtml(tag)}</option>`).join('')}
        </select>
      </label>
      <label>Estado
        <select data-action="filter" data-filter="status">
          <option value="all">Todos</option>
          ${['disponible', 'arrancado', 'completado', 'archivado'].map(status => `<option value="${status}" ${state.filters.status === status ? 'selected' : ''}>${labels[status]}</option>`).join('')}
        </select>
      </label>
      ${state.user.role === 'player' ? renderCharacterSelect() : `<label>Vista<select disabled><option>Privada del DM</option></select></label>`}
    </div>
  `;
}

function renderCharacterSelect() {
  if (state.user.role !== 'player') return '';
  return `
    <label>Personaje
      <select data-action="active-character">
        <option value="">Sin elegir</option>
        ${state.characters.map(character => `
          <option value="${character.id}" ${character.id === activeCharacterId() ? 'selected' : ''}>
            ${escapeHtml(character.name)}
          </option>
        `).join('')}
      </select>
    </label>
  `;
}

function filteredAnnouncements() {
  return state.announcements.filter(announcement => {
    const tagOk = state.filters.tag === 'all' || announcement.tags.includes(state.filters.tag);
    const statusOk = state.filters.status === 'all' || announcement.status === state.filters.status;
    return tagOk && statusOk;
  });
}

function renderBoardSurface() {
  const board = selectedBoard();
  if (!board) {
    return `<section class="empty-state">Crea un tablón para empezar a clavar notas.</section>`;
  }
  const announcements = filteredAnnouncements();
  return `
    <section class="board-surface" aria-label="Tablón medieval">
      <div class="notice-grid">
        ${announcements.map(renderAnnouncementCard).join('') || `<div class="empty-state">No hay anuncios con esos filtros.</div>`}
      </div>
    </section>
  `;
}

function renderAnnouncementCard(announcement) {
  const tagPills = [
    ...(announcement.tags || []).slice(0, 4).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
  ];

  return `
    <button class="notice-card status-${announcement.status}" type="button" data-action="open-announcement" data-id="${announcement.id}">
      <span class="status-pill">${labels[announcement.status] || announcement.status}</span>
      <h3>${escapeHtml(announcement.title)}</h3>
      <p>${escapeHtml(shortText(announcement.publicText))}</p>
      ${tagPills.length ? `<div class="notice-tags">${tagPills.join('')}</div>` : ''}
    </button>
  `;
}

function renderCharactersView() {
  if (state.user.role === 'dm') return renderDmPlayersView();

  return `
    <section class="view-header">
      <div>
        <h2>Mis personajes</h2>
        <p>Personajes que el DM te ha asignado en esta campaña.</p>
      </div>
    </section>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Personaje</th>
            <th>Jugador</th>
            <th>Linaje</th>
            <th>Arquetipo</th>
            <th>Notas</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${state.characters.map(character => `
            <tr>
              <td>${escapeHtml(character.name)}</td>
              <td>${escapeHtml(character.playerName || state.user.displayName)}</td>
              <td>${escapeHtml(character.ancestry || '')}</td>
              <td>${escapeHtml(character.archetype || '')}</td>
              <td>${escapeHtml(shortText(character.notes, 90))}</td>
              <td>
                <div class="actions">
                </div>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="6">Sin personajes.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderDmPlayersView() {
  const charactersByUser = new Map();
  for (const character of state.characters) {
    const list = charactersByUser.get(character.userId) || [];
    list.push(character);
    charactersByUser.set(character.userId, list);
  }

  return `
    <section class="view-header">
      <div>
        <h2>Gestión de jugadores</h2>
        <p>Crea usuarios de jugador y añade varios personajes dentro de cada uno.</p>
      </div>
      <button class="metal-button primary" type="button" data-action="open-modal" data-modal="player-form">Crear/vincular jugador</button>
    </section>
    <section class="list-grid">
      ${state.players.map(player => {
        const characters = charactersByUser.get(player.id) || [];
        return `
          <article class="list-card">
            <h3>${escapeHtml(player.displayName)}</h3>
            <p>@${escapeHtml(player.username)}</p>
            ${player.dmNotes ? `<p class="muted"><strong>Notas DM:</strong> ${escapeHtml(shortText(player.dmNotes, 180))}</p>` : ''}
            <div class="actions">
              <button class="metal-button" type="button" data-action="add-character-to-player" data-username="${escapeHtml(player.username)}">Añadir personaje</button>
              <button class="ghost-button" type="button" data-action="edit-player" data-id="${player.id}">Notas DM</button>
              <button class="danger-button" type="button" data-action="delete-player" data-id="${player.id}" data-name="${escapeHtml(player.displayName)}">Eliminar jugador</button>
            </div>
            <div class="character-stack">
              ${characters.map(character => `
                <div class="pulled-item">
                  <strong>${escapeHtml(character.name)}</strong>
                  <span class="muted">${escapeHtml(character.ancestry || 'Sin linaje')} ${escapeHtml(character.archetype || '')}</span>
                  ${character.notes ? `<span class="muted">${escapeHtml(shortText(character.notes, 110))}</span>` : ''}
                  ${character.dmNotes ? `<span class="muted"><strong>Notas DM:</strong> ${escapeHtml(shortText(character.dmNotes, 110))}</span>` : ''}
                  <div class="actions">
                    <button class="ghost-button" type="button" data-action="edit-character" data-id="${character.id}">Editar</button>
                    <button class="danger-button" type="button" data-action="delete-character" data-id="${character.id}">Eliminar</button>
                  </div>
                </div>
              `).join('') || `<p class="muted">Sin personajes todavía.</p>`}
            </div>
          </article>
        `;
      }).join('') || `
        <div class="empty-state">
          <div>
            <h2 class="section-title">Sin jugadores</h2>
            <p>Crea el primer usuario de jugador para poder añadir personajes.</p>
            <button class="metal-button primary" type="button" data-action="open-modal" data-modal="player-form">Crear jugador</button>
          </div>
        </div>
      `}
    </section>
  `;
}

function renderNotificationsView() {
  if (state.user.role !== 'dm') return renderDashboardView();
  return `
    <section class="view-header">
      <div>
        <h2>Panel de notificaciones</h2>
        <p>Avisos internos generados cuando un jugador arranca un anuncio.</p>
      </div>
    </section>
    <section class="card-list">
      ${state.notifications.map(notification => `
        <article class="list-card">
          <h3>${notification.readAt ? 'Aviso leído' : 'Aviso sin leer'}</h3>
          <p>${escapeHtml(notification.message)}</p>
          <p class="muted">${formatDate(notification.createdAt)}</p>
          <div class="actions">
            ${notification.announcementId ? `<button class="ghost-button" type="button" data-action="open-announcement" data-id="${notification.announcementId}">Ver anuncio</button>` : ''}
            ${notification.readAt ? '' : `<button class="metal-button" type="button" data-action="mark-read" data-id="${notification.id}">Marcar leído</button>`}
          </div>
        </article>
      `).join('') || `<div class="empty-state">No hay notificaciones.</div>`}
    </section>
  `;
}

function renderPulledView() {
  const pulled = myPulledAnnouncements();
  return `
    <section class="view-header">
      <div>
        <h2>Mis encargos arrancados</h2>
        <p>Anuncios que alguno de tus personajes ha arrancado en esta campaña.</p>
      </div>
    </section>
    <section class="list-grid">
      ${pulled.map(announcement => `
        <article class="list-card">
          <h3>${escapeHtml(announcement.title)}</h3>
          <p>${escapeHtml(shortText(announcement.publicText, 190))}</p>
          <div class="notice-tags">
            <span class="tag">${escapeHtml(announcement.boardName)}</span>
            <span class="tag">${escapeHtml(announcement.pull?.characterName || '')}</span>
            <span class="tag">${formatDate(announcement.pull?.pulledAt)}</span>
          </div>
          <button class="ghost-button" type="button" data-action="open-announcement" data-id="${announcement.id}">Leer</button>
        </article>
      `).join('') || `<div class="empty-state">No has arrancado ningún anuncio en esta campaña.</div>`}
    </section>
  `;
}

function myPulledAnnouncements() {
  return state.allAnnouncements.filter(announcement => announcement.pull?.playerId === state.user.id);
}

function renderModal() {
  if (!state.modal) return '';
  const content = {
    'campaign-form': renderCampaignForm,
    'board-form': renderBoardForm,
    'announcement-form': renderAnnouncementForm,
    'character-form': renderCharacterForm,
    'player-form': renderPlayerForm,
    'announcement-detail': renderAnnouncementDetail
  }[state.modal.type]?.();

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="modal">
        ${content || ''}
      </section>
    </div>
  `;
}

function modalHeader(title) {
  return `
    <header class="modal-header">
      <h2 class="modal-title">${escapeHtml(title)}</h2>
      <button class="icon-button" type="button" data-action="close-modal" aria-label="Cerrar">×</button>
    </header>
  `;
}

function renderCampaignForm() {
  const campaign = state.modal.data || {};
  const editing = Boolean(campaign.id);
  return `
    ${modalHeader(editing ? 'Editar campaña' : 'Nueva campaña')}
    <div class="modal-body">
      <form class="form-grid" data-form="campaign">
        <label>Nombre de campaña
          <input name="name" required value="${escapeHtml(campaign.name || '')}">
        </label>
        <label>Descripción breve
          <textarea name="description">${escapeHtml(campaign.description || '')}</textarea>
        </label>
        <div class="actions">
          <button class="metal-button primary" type="submit">${editing ? 'Guardar campaña' : 'Crear campaña'}</button>
          <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderBoardForm() {
  const board = state.modal.data || {};
  const editing = Boolean(board.id);
  return `
    ${modalHeader(editing ? 'Editar tablón' : 'Nuevo tablón')}
    <div class="modal-body">
      <form class="form-grid" data-form="board">
        <div class="form-grid two-cols">
          <label>Nombre del tablón
            <input name="name" required value="${escapeHtml(board.name || '')}">
          </label>
          <label>Tipo
            <select name="type">
              ${boardTypes.map(type => `<option value="${escapeHtml(type)}" ${(board.type || 'otro') === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label>Descripción
          <textarea name="description">${escapeHtml(board.description || '')}</textarea>
        </label>
        <div class="actions">
          <button class="metal-button primary" type="submit">${editing ? 'Guardar tablón' : 'Crear tablón'}</button>
          <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
          ${editing ? `<button class="danger-button" type="button" data-action="delete-board" data-id="${board.id}">Eliminar tablón</button>` : ''}
        </div>
      </form>
    </div>
  `;
}

function renderAnnouncementForm() {
  const announcement = state.modal.data || {};
  const privateData = announcement.private || {};
  const editing = Boolean(announcement.id);
  const tags = Array.isArray(announcement.tags) ? announcement.tags.join(', ') : '';
  return `
    ${modalHeader(editing ? 'Editar anuncio' : 'Nuevo anuncio')}
    <div class="modal-body">
      <form class="form-grid" data-form="announcement">
        <div class="form-grid two-cols">
          <label>Título visible
            <input name="title" required value="${escapeHtml(announcement.title || '')}">
          </label>
          <label>Estado
            <select name="status">
              ${['disponible', 'arrancado', 'completado', 'archivado'].map(status => `<option value="${status}" ${(announcement.status || 'disponible') === status ? 'selected' : ''}>${labels[status]}</option>`).join('')}
            </select>
          </label>
        </div>
        <label>Texto diegético
          <textarea name="publicText" required>${escapeHtml(announcement.publicText || '')}</textarea>
        </label>
        <div class="form-grid two-cols">
          <label>Etiquetas
            <input name="tags" value="${escapeHtml(tags)}" placeholder="combate, rumor, urgente">
          </label>
          <label>Fecha dentro del mundo
            <input name="worldDate" value="${escapeHtml(announcement.worldDate || '')}">
          </label>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" name="hiddenFromPlayers" ${announcement.hiddenFromPlayers ? 'checked' : ''}>
          Oculto para jugadores
        </label>
        <h3 class="section-title">Información privada del DM</h3>
        <div class="form-grid two-cols">
          <label>Estado interno
            <select name="prepState">
              ${['idea', 'preparada', 'en_juego', 'resuelta', 'descartada'].map(prep => `<option value="${prep}" ${(privateData.prepState || 'idea') === prep ? 'selected' : ''}>${labels[prep]}</option>`).join('')}
            </select>
          </label>
          <label>Recompensa real
            <input name="realReward" value="${escapeHtml(privateData.realReward || '')}">
          </label>
        </div>
        <label>Resumen real de la aventura
          <textarea name="realSummary">${escapeHtml(privateData.realSummary || '')}</textarea>
        </label>
        <label>Gancho narrativo
          <textarea name="narrativeHook">${escapeHtml(privateData.narrativeHook || '')}</textarea>
        </label>
        <label>Información secreta
          <textarea name="secretInformation">${escapeHtml(privateData.secretInformation || '')}</textarea>
        </label>
        <div class="form-grid two-cols">
          <label>PNJ implicados
            <textarea name="involvedNpcs">${escapeHtml(privateData.involvedNpcs || '')}</textarea>
          </label>
          <label>Localizaciones relevantes
            <textarea name="relevantLocations">${escapeHtml(privateData.relevantLocations || '')}</textarea>
          </label>
          <label>Posibles complicaciones
            <textarea name="possibleComplications">${escapeHtml(privateData.possibleComplications || '')}</textarea>
          </label>
          <label>Consecuencias si se ignora
            <textarea name="ignoredConsequences">${escapeHtml(privateData.ignoredConsequences || '')}</textarea>
          </label>
        </div>
        <label>Notas privadas del DM
          <textarea name="dmNotes">${escapeHtml(privateData.dmNotes || '')}</textarea>
        </label>
        <div class="actions">
          <button class="metal-button primary" type="submit">${editing ? 'Guardar anuncio' : 'Publicar anuncio'}</button>
          <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
          ${editing ? `<button class="danger-button" type="button" data-action="delete-announcement" data-id="${announcement.id}">Eliminar anuncio</button>` : ''}
        </div>
      </form>
    </div>
  `;
}

function renderCharacterForm() {
  const character = state.modal.data || {};
  const editing = Boolean(character.id);
  const playerUsername = character.username || '';
  const targetCampaignId = character.campaignId || state.selectedCampaignId;
  // boardAccess: array de board IDs con acceso. null = sin restricción (todos)
  const boardAccess = character.boardAccess || null;

  const boardAccessSection = editing ? `
    <h3 class="section-title">Tablones accesibles</h3>
    <p class="muted">Marca los tablones a los que tiene acceso este personaje. Si no marcas ninguno, el personaje verá todos los tablones de la campaña.</p>
    <div class="form-grid two-cols">
      ${state.boards.map(board => `
        <label class="checkbox-row">
          <input type="checkbox" name="boardAccess" value="${board.id}"
            ${!boardAccess || boardAccess.includes(board.id) ? 'checked' : ''}>
          ${escapeHtml(board.name)}
          <span class="muted" style="font-size:0.8em">${escapeHtml(board.type)}</span>
        </label>
      `).join('')}
    </div>
    ${state.boards.length === 0 ? `<p class="muted">No hay tablones en esta campaña todavía.</p>` : ''}
  ` : '';

  return `
    ${modalHeader(editing ? 'Editar personaje' : 'Nuevo personaje')}
    <div class="modal-body">
      <form class="form-grid" data-form="character">
        <div class="form-grid two-cols">
          <label>Campaña
            <select name="campaignId" required>
              ${state.campaigns.map(campaign => `
                <option value="${campaign.id}" ${campaign.id === targetCampaignId ? 'selected' : ''}>
                  ${escapeHtml(campaign.name)}
                </option>
              `).join('')}
            </select>
          </label>
          <label>Jugador propietario
            <input name="playerUsername" required value="${escapeHtml(playerUsername)}" placeholder="username del jugador">
          </label>
        </div>
        <p class="muted">Escribe el username exacto de un jugador vinculado a la campaña elegida.</p>
        <div class="form-grid two-cols">
          <label>Nombre
            <input name="name" required value="${escapeHtml(character.name || '')}">
          </label>
          <label>Linaje
            <input name="ancestry" value="${escapeHtml(character.ancestry || '')}">
          </label>
          <label>Arquetipo
            <input name="archetype" value="${escapeHtml(character.archetype || '')}">
          </label>
        </div>
        <label>Notas visibles para el jugador
          <textarea name="notes">${escapeHtml(character.notes || '')}</textarea>
        </label>
        <label>Notas privadas del DM
          <textarea name="dmNotes">${escapeHtml(character.dmNotes || '')}</textarea>
        </label>
        ${boardAccessSection}
        <div class="actions">
          <button class="metal-button primary" type="submit">${editing ? 'Guardar personaje' : 'Crear personaje'}</button>
          <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
          ${editing ? `<button class="danger-button" type="button" data-action="delete-character" data-id="${character.id}">Eliminar personaje</button>` : ''}
        </div>
      </form>
    </div>
  `;
}

function renderPlayerForm() {
  const player = state.modal.data || {};
  const editing = Boolean(player.id);
  return `
    ${modalHeader(editing ? 'Notas del jugador' : 'Crear o vincular jugador')}
    <div class="modal-body">
      <form class="form-grid" data-form="player">
        <div class="form-grid two-cols">
          <label>Nombre de usuario
            <input name="username" required placeholder="jugador" value="${escapeHtml(player.username || '')}">
          </label>
          <label>Nombre visible
            <input name="displayName" placeholder="Nombre del jugador" value="${escapeHtml(player.displayName || '')}">
          </label>
        </div>
        <label>Contraseña inicial
          <input name="password" type="text" minlength="6" placeholder="Solo si estás creando un jugador nuevo">
        </label>
        <label>Notas privadas del DM
          <textarea name="dmNotes">${escapeHtml(player.dmNotes || '')}</textarea>
        </label>
        <p class="muted">Si el usuario ya existe, se vinculará a esta campaña aunque escribas contraseña; la contraseña solo se usa al crear usuarios nuevos.</p>
        <div class="actions">
          <button class="metal-button primary" type="submit">Guardar jugador</button>
          <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderPublicDetailLine(label, value, fallback) {
  if (!hasValue(value) && state.user.role !== 'dm') return '';
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || fallback)}</p>`;
}

function renderAnnouncementDetail() {
  const announcement = state.modal.data;
  const privateData = announcement.private || {};
  const playerCharacters = state.characters;
  const defaultCharacter = activeCharacterId() || playerCharacters[0]?.id || '';
  const publicTags = [
    ...(announcement.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
  ];
  return `
    ${modalHeader(announcement.title)}
    <div class="modal-body">
      <div class="detail-layout">
        <article class="parchment-detail status-${announcement.status}">
          <span class="status-pill">${labels[announcement.status] || announcement.status}</span>
          <h2>${escapeHtml(announcement.title)}</h2>
          <p>${nl2br(announcement.publicText)}</p>
          <hr>
          ${renderPublicDetailLine('Fecha', announcement.worldDate, 'Sin fechar')}
          ${publicTags.length ? `<div class="notice-tags">${publicTags.join('')}</div>` : ''}
        </article>
        <aside class="private-panel">
          ${announcement.pull ? `
            <section class="private-field">
              <strong>Arrancado por</strong>
              <span>${escapeHtml(announcement.pull.characterName)} (${escapeHtml(announcement.pull.playerName)})</span><br>
              <small class="muted">${formatDate(announcement.pull.pulledAt)}</small>
              ${state.user.role === 'dm' ? `<div class="actions"><button class="danger-button" type="button" data-action="revert-pull" data-id="${announcement.id}">Revertir arrancado</button></div>` : ''}
            </section>
          ` : ''}
          ${state.user.role === 'player' ? `
            <section class="private-field">
              <strong>Arrancar anuncio</strong>
              <label>Personaje
                <select id="pull-character">
                  ${playerCharacters.map(character => `<option value="${character.id}" ${character.id === defaultCharacter ? 'selected' : ''}>${escapeHtml(character.name)}</option>`).join('')}
                </select>
              </label>
              <div class="actions">
                <button class="metal-button primary" type="button" data-action="confirm-pull" data-id="${announcement.id}" ${announcement.status !== 'disponible' || !playerCharacters.length ? 'disabled' : ''}>Arrancar anuncio</button>
              </div>
              ${!playerCharacters.length ? `<p class="muted">Pide al DM que cree y te asigne un personaje para esta campaña.</p>` : ''}
            </section>
          ` : ''}
          ${state.user.role === 'dm' ? `
            <section class="private-field">
              <strong>Acciones del DM</strong>
              <div class="actions">
                <button class="ghost-button" type="button" data-action="edit-announcement" data-id="${announcement.id}">Editar</button>
                <button class="ghost-button" type="button" data-action="set-status" data-id="${announcement.id}" data-status="disponible">Disponible</button>
                <button class="ghost-button" type="button" data-action="set-status" data-id="${announcement.id}" data-status="completado">Completado</button>
                <button class="ghost-button" type="button" data-action="set-status" data-id="${announcement.id}" data-status="archivado">Archivar</button>
                <button class="danger-button" type="button" data-action="delete-announcement" data-id="${announcement.id}">Eliminar</button>
              </div>
            </section>
            ${renderPrivateField('Resumen real', privateData.realSummary)}
            ${renderPrivateField('Gancho narrativo', privateData.narrativeHook)}
            ${renderPrivateField('Información secreta', privateData.secretInformation)}
            ${renderPrivateField('PNJ implicados', privateData.involvedNpcs)}
            ${renderPrivateField('Localizaciones relevantes', privateData.relevantLocations)}
            ${renderPrivateField('Posibles complicaciones', privateData.possibleComplications)}
            ${renderPrivateField('Recompensa real', privateData.realReward)}
            ${renderPrivateField('Consecuencias si se ignora', privateData.ignoredConsequences)}
            ${renderPrivateField('Notas privadas', privateData.dmNotes)}
            ${renderPrivateField('Estado interno', labels[privateData.prepState] || privateData.prepState)}
          ` : ''}
        </aside>
      </div>
    </div>
  `;
}

function renderPrivateField(label, value) {
  return `
    <section class="private-field">
      <strong>${escapeHtml(label)}</strong>
      <span>${nl2br(value || 'Sin datos.')}</span>
    </section>
  `;
}

function renderToast() {
  if (!state.toast) return '';
  return `<div class="toast" role="status">${escapeHtml(state.toast.message)}</div>`;
}

app.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  handleClick(control, event).catch(error => setToast(error.message, true));
});

app.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  handleSubmit(form).catch(error => setToast(error.message, true));
});

app.addEventListener('change', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  handleChange(control).catch(error => setToast(error.message, true));
});

async function handleClick(control) {
  const action = control.dataset.action;

  if (action === 'auth-mode') {
    state.authMode = control.dataset.mode;
    render();
    return;
  }

  if (action === 'logout') {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    logout();
    return;
  }

  if (action === 'nav') {
    state.view = control.dataset.view;
    render();
    return;
  }

  if (action === 'select-campaign') {
    state.selectedCampaignId = Number(control.dataset.id);
    localStorage.setItem(storageKeys.campaign, String(state.selectedCampaignId));
    await loadCampaignContext();
    state.view = control.dataset.view || 'boards';
    render();
    return;
  }

  if (action === 'select-board') {
    state.selectedBoardId = Number(control.dataset.id);
    localStorage.setItem(storageKeys.board, String(state.selectedBoardId));
    state.announcements = state.boardAnnouncements[state.selectedBoardId] || [];
    state.view = control.dataset.view || 'boards';
    render();
    return;
  }

  if (action === 'open-modal') {
    const modalType = control.dataset.modal;
    if (modalType === 'announcement-form' && !selectedBoard()) {
      setToast('Crea o abre un tablón antes de publicar un anuncio.', true);
      return;
    }
    state.modal = { type: modalType, data: null };
    render();
    return;
  }

  if (action === 'close-modal') {
    state.modal = null;
    render();
    return;
  }

  if (action === 'edit-campaign') {
    const campaign = state.campaigns.find(item => item.id === Number(control.dataset.id));
    state.modal = { type: 'campaign-form', data: campaign };
    render();
    return;
  }

  if (action === 'edit-board') {
    const board = state.boards.find(item => item.id === Number(control.dataset.id));
    state.modal = { type: 'board-form', data: board };
    render();
    return;
  }

  if (action === 'edit-player') {
    const player = state.players.find(item => item.id === Number(control.dataset.id));
    state.modal = { type: 'player-form', data: player };
    render();
    return;
  }

  if (action === 'edit-character') {
    const character = state.characters.find(item => item.id === Number(control.dataset.id));
    if (!character) return;
    const { boardIds } = await api(`/api/characters/${character.id}/board-access`);
    state.modal = { type: 'character-form', data: { ...character, boardAccess: boardIds } };
    render();
    return;
  }

  if (action === 'add-character-to-player') {
    state.modal = {
      type: 'character-form',
      data: { username: control.dataset.username || '' }
    };
    render();
    return;
  }

  if (action === 'open-announcement') {
    const { announcement } = await api(`/api/announcements/${control.dataset.id}`);
    state.modal = { type: 'announcement-detail', data: announcement };
    render();
    return;
  }

  if (action === 'edit-announcement') {
    const { announcement } = await api(`/api/announcements/${control.dataset.id}`);
    state.modal = { type: 'announcement-form', data: announcement };
    render();
    return;
  }

  if (action === 'confirm-pull') {
    const select = document.getElementById('pull-character');
    const characterId = Number(select?.value || activeCharacterId());
    if (!characterId) {
      setToast('Elige un personaje antes de arrancar el anuncio.', true);
      return;
    }
    const { announcement } = await api(`/api/announcements/${control.dataset.id}/pull`, {
      method: 'POST',
      body: { characterId }
    });
    state.modal = { type: 'announcement-detail', data: announcement };
    await loadWorkspace();
    setToast('El pergamino queda arrancado y el DM recibe aviso.');
    return;
  }

  if (action === 'revert-pull') {
    const { announcement } = await api(`/api/announcements/${control.dataset.id}/revert`, { method: 'POST' });
    state.modal = { type: 'announcement-detail', data: announcement };
    await loadWorkspace();
    setToast('El anuncio vuelve a estar disponible.');
    return;
  }

  if (action === 'set-status') {
    const { announcement } = await api(`/api/announcements/${control.dataset.id}/status`, {
      method: 'POST',
      body: { status: control.dataset.status }
    });
    state.modal = { type: 'announcement-detail', data: announcement };
    await loadWorkspace();
    render();
    return;
  }

  if (action === 'mark-read') {
    await api(`/api/notifications/${control.dataset.id}/read`, { method: 'POST' });
    await loadWorkspace();
    render();
    return;
  }

  if (action === 'delete-campaign') {
    if (!confirm('¿Eliminar esta campaña y todo su contenido?')) return;
    await api(`/api/campaigns/${control.dataset.id}`, { method: 'DELETE' });
    state.selectedCampaignId = 0;
    await loadWorkspace();
    setToast('Campaña eliminada.');
    return;
  }

  if (action === 'delete-player') {
    const name = control.dataset.name || 'este jugador';
    if (!confirm(`¿Eliminar a ${name} de esta campaña? También se eliminarán sus personajes de esta campaña.`)) return;
    await api(`/api/campaigns/${state.selectedCampaignId}/players/${control.dataset.id}`, { method: 'DELETE' });
    state.modal = null;
    await loadWorkspace();
    setToast('Jugador eliminado de la campaña.');
    return;
  }

  if (action === 'delete-board') {
    if (!confirm('¿Eliminar este tablón y todos sus anuncios?')) return;
    await api(`/api/boards/${control.dataset.id}`, { method: 'DELETE' });
    state.modal = null;
    state.selectedBoardId = 0;
    await loadWorkspace();
    setToast('Tablón eliminado.');
    return;
  }

  if (action === 'delete-announcement') {
    if (!confirm('¿Eliminar este anuncio?')) return;
    await api(`/api/announcements/${control.dataset.id}`, { method: 'DELETE' });
    state.modal = null;
    await loadWorkspace();
    setToast('Anuncio eliminado.');
    return;
  }

  if (action === 'delete-character') {
    if (!confirm('¿Eliminar este personaje?')) return;
    await api(`/api/characters/${control.dataset.id}`, { method: 'DELETE' });
    state.modal = null;
    await loadWorkspace();
    setToast('Personaje eliminado.');
  }
}

async function handleChange(control) {
  const action = control.dataset.action;
  if (action === 'filter') {
    state.filters[control.dataset.filter] = control.value;
    render();
    return;
  }
  if (action === 'active-character') {
    state.activeCharacters[state.selectedCampaignId] = Number(control.value || 0);
    localStorage.setItem(storageKeys.activeCharacters, JSON.stringify(state.activeCharacters));
    render();
  }
}

async function handleSubmit(form) {
  const formName = form.dataset.form;
  const data = Object.fromEntries(new FormData(form).entries());

  if (formName === 'login') {
    const response = await api('/api/login', { method: 'POST', body: data });
    state.token = response.token;
    state.user = response.user;
    localStorage.setItem(storageKeys.token, state.token);
    await loadWorkspace();
    render();
    return;
  }

  if (formName === 'register') {
    const response = await api('/api/register', { method: 'POST', body: data });
    state.token = response.token;
    state.user = response.user;
    localStorage.setItem(storageKeys.token, state.token);
    await loadWorkspace();
    render();
    return;
  }

  if (formName === 'campaign') {
    const existingId = state.modal?.data?.id;
    const response = await api(existingId ? `/api/campaigns/${existingId}` : '/api/campaigns', {
      method: existingId ? 'PUT' : 'POST',
      body: data
    });
    state.selectedCampaignId = response.campaign.id;
    state.modal = null;
    await loadWorkspace();
    setToast(existingId ? 'Campaña actualizada.' : 'Campaña creada.');
    return;
  }

  if (formName === 'board') {
    const existingId = state.modal?.data?.id;
    const response = await api(existingId ? `/api/boards/${existingId}` : `/api/campaigns/${state.selectedCampaignId}/boards`, {
      method: existingId ? 'PUT' : 'POST',
      body: data
    });
    state.selectedBoardId = response.board.id;
    state.modal = null;
    await loadWorkspace();
    setToast(existingId ? 'Tablón actualizado.' : 'Tablón creado.');
    return;
  }

  if (formName === 'announcement') {
    const existingId = state.modal?.data?.id;
    const body = collectAnnouncementForm(form);
    const response = await api(existingId ? `/api/announcements/${existingId}` : `/api/boards/${state.selectedBoardId}/announcements`, {
      method: existingId ? 'PUT' : 'POST',
      body
    });
    state.modal = { type: 'announcement-detail', data: response.announcement };
    await loadWorkspace();
    setToast(existingId ? 'Anuncio actualizado.' : 'Anuncio publicado.');
    return;
  }

  if (formName === 'character') {
    const existingId = state.modal?.data?.id;
    const response = await api(existingId ? `/api/characters/${existingId}` : `/api/campaigns/${state.selectedCampaignId}/characters`, {
      method: existingId ? 'PUT' : 'POST',
      body: data
    });
    if (state.user.role === 'player') {
      state.activeCharacters[state.selectedCampaignId] = response.character.id;
      localStorage.setItem(storageKeys.activeCharacters, JSON.stringify(state.activeCharacters));
    }
    // Guardar acceso a tablones si estamos editando un personaje existente
    if (existingId && state.user.role === 'dm') {
      const checkedBoards = [...form.querySelectorAll('input[name="boardAccess"]:checked')].map(el => Number(el.value));
      const allBoards = [...form.querySelectorAll('input[name="boardAccess"]')].map(el => Number(el.value));
      // Si están todos marcados, guardamos lista vacía (sin restricción)
      const boardIds = checkedBoards.length === allBoards.length ? [] : checkedBoards;
      await api(`/api/characters/${existingId}/board-access`, { method: 'PUT', body: { boardIds } });
    }
    state.modal = null;
    await loadWorkspace();
    setToast(existingId ? 'Personaje actualizado.' : 'Personaje creado.');
    return;
  }

  if (formName === 'player') {
    const response = await api(`/api/campaigns/${state.selectedCampaignId}/players`, {
      method: 'POST',
      body: data
    });
    state.modal = null;
    await loadWorkspace();
    setToast(response.player.created ? 'Jugador creado y vinculado. Pásale la contraseña inicial por mensaje privado.' : 'Jugador vinculado a la campaña.');
  }
}

function collectAnnouncementForm(form) {
  const fd = new FormData(form);
  return {
    title: fd.get('title'),
    publicText: fd.get('publicText'),
    tags: fd.get('tags'),
    status: fd.get('status'),
    worldDate: fd.get('worldDate'),
    hiddenFromPlayers: fd.has('hiddenFromPlayers'),
    realSummary: fd.get('realSummary'),
    narrativeHook: fd.get('narrativeHook'),
    secretInformation: fd.get('secretInformation'),
    involvedNpcs: fd.get('involvedNpcs'),
    relevantLocations: fd.get('relevantLocations'),
    possibleComplications: fd.get('possibleComplications'),
    realReward: fd.get('realReward'),
    ignoredConsequences: fd.get('ignoredConsequences'),
    dmNotes: fd.get('dmNotes'),
    prepState: fd.get('prepState')
  };
}

init();
