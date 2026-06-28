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
  view: localStorage.getItem('tablon.view') || 'boards',
  campaigns: [],
  boards: [],
  boardAnnouncements: {},
  allAnnouncements: [],
  announcements: [],
  characters: [],
  boardCharacters: [],
  players: [],
  notifications: [],
  selectedCampaignId: Number(localStorage.getItem(storageKeys.campaign) || 0),
  selectedBoardId: Number(localStorage.getItem(storageKeys.board) || 0),
  activeCharacters: readJsonStorage(storageKeys.activeCharacters, {}),
  filters: {
    tag: 'all',
    status: 'all',
    search: '',
    hideResolved: false
  },
  modal: null,
  toast: null,
  loading: false,
  mobileRailOpen: false,
  adminDms: [],
  adminCampaigns: [],
  pullHistory: []
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
  admin: [
    ['admin-dms', '⚔ Maestros'],
    ['admin-campaigns', '🗺 Campañas'],
    ['boards', '📋 Tablones'],
    ['characters', '🧙 Jugadores'],
    ['players', '👤 Cuentas'],
    ['notifications', '🔔 Avisos'],
    ['history', '📜 Historial']
  ],
  dm: [
    ['boards', 'Tablón'],
    ['characters', 'Jugadores'],
    ['notifications', 'Avisos'],
    ['history', 'Historial'],
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

const charStatusLabels = {
  activo:       'Activo',
  retirado:     'Retirado',
  muerto:       'Muerto',
  desaparecido: 'Desaparecido'
};

function charStatusBadge(status) {
  const s = status || 'activo';
  return `<span class="char-status char-status-${s}">${charStatusLabels[s] || s}</span>`;
}

function isCharacterPlayable(ch) {
  return !ch.status || ch.status === 'activo';
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

  if (state.user?.role === 'dm' || state.user?.role === 'admin') {
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
  const playerPromise = (state.user.role === 'dm' || state.user.role === 'admin')
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
  await loadBoardCharacters();
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

async function loadBoardCharacters() {
  state.boardCharacters = [];
  const board = selectedBoard();
  if (!board || (state.user?.role !== 'dm' && state.user?.role !== 'admin')) return;
  try {
    const { characters } = await api(`/api/boards/${board.id}/characters`);
    state.boardCharacters = characters;
  } catch { state.boardCharacters = []; }
}

async function init() {
  if (state.token) {
    try {
      const { user } = await api('/api/me');
      state.user = user;
      // Si el admin no tiene vista guardada o la vista guardada no existe en su nav, mandarlo a la vista admin
      if (user.role === 'admin') {
        const adminViews = new Set(navByRole.admin.map(([v]) => v));
        if (!adminViews.has(state.view)) {
          state.view = 'admin-dms';
          localStorage.setItem('tablon.view', state.view);
        }
      }
      await loadWorkspace();
      if (state.view === 'admin-dms') await loadAdminDms();
      if (state.view === 'admin-campaigns') { await loadAdminCampaigns(); await loadAdminDms(); }
    } catch {
      logout(false);
    }
  }
  render();

  // Polling automático: refresca anuncios y notificaciones cada 45 segundos
  setInterval(async () => {
    if (!state.user || !state.token) return;
    try {
      await loadAllAnnouncements();
      if (state.user.role === 'dm' || state.user.role === 'admin') {
        const { notifications } = await api('/api/notifications');
        state.notifications = notifications;
      }
      render();
    } catch { /* silencioso — la sesión puede haber expirado */ }
  }, 45000);
}

function render() {
  app.innerHTML = state.user ? renderApp() : renderAuth();
}

function passwordInput(name, autocomplete, placeholder = '', required = false) {
  return `
    <div class="password-wrap">
      <input name="${name}" type="password" autocomplete="${autocomplete}"
        ${placeholder ? `placeholder="${placeholder}"` : ''}
        ${required ? 'required' : ''}>
      <button type="button" class="password-toggle" data-action="toggle-password"
        aria-label="Mostrar contraseña">👁</button>
    </div>
  `;
}

function renderAuth() {
  const forms = {
    login: renderLoginForm,
    forgot: renderForgotForm,
    reset: renderResetForm
  };
  const form = (forms[state.authMode] || renderLoginForm)();
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
        ${form}
        ${state.authMode === 'login' ? `
          <p class="muted" style="font-size:.8rem;text-align:center">Los jugadores nuevos los crea el DM.<br>El nombre de usuario no distingue mayúsculas.</p>
        ` : ''}
      </div>
      ${renderToast()}
    </section>
  `;
}

function renderLoginForm() {
  return `
    <form class="form-grid" data-form="login">
      <h2 style="color:var(--gold);margin:0 0 .5rem">Acceder</h2>
      <label>Usuario
        <input name="username" autocomplete="username" required>
      </label>
      <label>Contraseña
        ${passwordInput('password', 'current-password')}
      </label>
      <button class="metal-button primary" type="submit">Iniciar sesión</button>
      <button class="ghost-button" type="button" data-action="auth-mode" data-mode="forgot"
        style="font-size:.82rem;text-align:left;padding:0;background:none;border:none;color:var(--muted);cursor:pointer">
        ¿Olvidaste tu contraseña?
      </button>
    </form>
  `;
}

function renderForgotForm() {
  return `
    <form class="form-grid" data-form="forgot-password">
      <h2 style="color:var(--gold);margin:0 0 .5rem">Recuperar contraseña</h2>
      <p class="muted">Introduce el correo que registraste como DM. Recibirás un código para restablecer tu contraseña.</p>
      <label>Correo del DM
        <input name="email" type="email" autocomplete="email" required placeholder="tu@correo.com">
      </label>
      <button class="metal-button primary" type="submit">Solicitar código</button>
      <button class="ghost-button" type="button" data-action="auth-mode" data-mode="login">Volver al login</button>
    </form>
  `;
}

function renderResetForm() {
  return `
    <form class="form-grid" data-form="reset-password">
      <h2 style="color:var(--gold);margin:0 0 .5rem">Nueva contraseña</h2>
      <p class="muted">Pega el código de recuperación y elige una nueva contraseña.</p>
      <label>Código de recuperación
        <input name="token" required placeholder="Código de 48 caracteres">
      </label>
      <label>Nueva contraseña
        ${passwordInput('password', 'new-password')}
      </label>
      <button class="metal-button primary" type="submit">Cambiar contraseña</button>
      <button class="ghost-button" type="button" data-action="auth-mode" data-mode="login">Volver al login</button>
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
        ${passwordInput('password', 'new-password')}
      </label>
      <button class="metal-button primary" type="submit">Crear jugador</button>
    </form>
  `;
}

function renderApp() {
  return `
    <div class="app-layout">
      ${state.loading ? '<div class="loading-bar" aria-hidden="true"></div>' : ''}
      ${renderTopbar()}
      ${renderLeftRail()}
      <main class="main-area">
        ${renderMain()}
      </main>
      <div class="mobile-overlay ${state.mobileRailOpen ? 'is-open' : ''}" data-action="close-mobile-rail"></div>
      ${renderRightRail()}
      ${renderModal()}
      ${renderToast()}
    </div>
  `;
}

function renderTopbar() {
  const campaign = selectedCampaign();
  const mobileCampaignSelect = state.campaigns.length > 0 ? `
    <select class="mobile-campaign-select" data-action="mobile-campaign" title="Campaña activa">
      ${state.campaigns.map(c => `<option value="${c.id}" ${c.id === state.selectedCampaignId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
    </select>
  ` : '';
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div>
          <div class="brand-title">Tablón de Anuncios</div>
          <div class="brand-subtitle">${campaign ? escapeHtml(campaign.name) : 'Westmarch grimdark'}</div>
        </div>
      </div>
      ${mobileCampaignSelect}
      <div class="user-strip">
        <span class="role-badge ${state.user.role === 'admin' ? 'admin-badge' : ''}">${state.user.role === 'admin' ? '⚔ Admin' : state.user.role === 'dm' ? 'Dungeon Master' : 'Jugador'}</span>
        <span class="desktop-name">${escapeHtml(state.user.displayName)}</span>
        ${(state.user.role === 'dm' || state.user.role === 'admin') ? `<button class="ghost-button desktop-name" type="button" data-action="open-dm-profile" style="font-size:.8rem">⚙ Perfil</button>` : ''}
        <button class="ghost-button mobile-rail-btn" type="button" data-action="toggle-mobile-rail" aria-label="Info del tablón" style="display:none">
          ${state.mobileRailOpen ? '✕' : '☰'}
        </button>
        <button class="ghost-button" type="button" data-action="logout">Salir</button>
      </div>
    </header>
  `;
}

function renderLeftRail() {
  const nav = navByRole[state.user.role];
  const unreadCount = state.notifications.filter(n => !n.readAt).length;
  return `
    <aside class="left-rail">
      <nav class="nav-stack" aria-label="Navegación">
        ${nav.map(([view, label]) => {
          const isNotif = view === 'notifications';
          const badge = isNotif && unreadCount > 0
            ? `<span class="nav-badge">${unreadCount}</span>`
            : '';
          return `
            <button class="nav-button ${state.view === view ? 'active' : ''}" type="button" data-action="nav" data-view="${view}">
              ${label}${badge}
            </button>`;
        }).join('')}
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
    <aside class="right-rail ${state.mobileRailOpen ? 'is-open' : ''}">
      <div class="side-stack">
        ${campaign ? renderCampaignSideCard(campaign) : ''}
        ${(state.user.role === 'dm' || state.user.role === 'admin') ? renderDmSideCards() : renderPlayerSideCards()}
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
  const board = selectedBoard();
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
    ${board && state.view === 'boards' ? renderBoardCharactersSideCard(board) : renderCampaignCharactersSideCard()}
  `;
}

function renderCampaignCharactersSideCard() {
  return `
    <section class="side-card">
      <h3>Personajes</h3>
      ${state.characters.map(ch => `
        <div class="pulled-item">
          <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
            <button class="ghost-button" style="padding:0;font-size:.88rem;font-weight:600;color:var(--ink);background:none;border:none;cursor:pointer;text-align:left" type="button"
              data-action="edit-character" data-id="${ch.id}">${escapeHtml(ch.name)}</button>
            ${charStatusBadge(ch.status)}
          </div>
          <small class="muted">${escapeHtml(ch.playerName || '')}${ch.ancestry ? ' · ' + escapeHtml(ch.ancestry) : ''}</small>
        </div>
      `).join('') || `<p class="muted">Sin personajes en esta campaña.</p>`}
      ${selectedCampaign() ? `<button class="metal-button" style="margin-top:.5rem" type="button" data-action="open-link-character-modal">Añadir personaje</button>` : ''}
    </section>
  `;
}

function renderBoardCharactersSideCard(board) {
  const chars = state.boardCharacters || [];
  // Acceso explícito: tienen una entrada específica para este tablón
  const explicit = chars.filter(c => c.explicitAccess);
  // Acceso global (sin restricciones): ven todos los tablones
  const global = chars.filter(c => c.hasAccess && !c.explicitAccess);
  // Sin acceso: tienen restricciones pero no a este tablón
  const noAccess = chars.filter(c => !c.hasAccess);
  // Dropdown: personajes que no tienen acceso explícito a este tablón
  const grantable = chars.filter(c => !c.explicitAccess);

  return `
    <section class="side-card">
      <h3>Acceso a este tablón</h3>
      ${explicit.map(ch => `
        <div class="pulled-item">
          <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
            <button class="ghost-button" style="padding:0;font-size:.88rem;font-weight:600;color:var(--ink);background:none;border:none;cursor:pointer;text-align:left" type="button"
              data-action="edit-character" data-id="${ch.id}">${escapeHtml(ch.name)}</button>
            ${charStatusBadge(ch.status)}
          </div>
          <small class="muted">${escapeHtml(ch.playerName || '')} · acceso explícito</small>
          <div class="actions" style="margin-top:.3rem">
            <button class="danger-button" style="font-size:.75rem;padding:.2rem .5rem" type="button"
              data-action="revoke-board-access" data-char-id="${ch.id}" data-board-id="${board.id}">Revocar</button>
          </div>
        </div>
      `).join('')}
      ${global.map(ch => `
        <div class="pulled-item">
          <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
            <button class="ghost-button" style="padding:0;font-size:.88rem;font-weight:600;color:var(--ink);background:none;border:none;cursor:pointer;text-align:left" type="button"
              data-action="edit-character" data-id="${ch.id}">${escapeHtml(ch.name)}</button>
            ${charStatusBadge(ch.status)}
          </div>
          <small class="muted">${escapeHtml(ch.playerName || '')} · acceso global</small>
        </div>
      `).join('')}
      ${!explicit.length && !global.length ? `<p class="muted">Ningún personaje tiene acceso.</p>` : ''}
      ${noAccess.length ? `<p class="muted" style="font-size:.78rem;margin-top:.4rem">${noAccess.length} personaje${noAccess.length > 1 ? 's' : ''} sin acceso.</p>` : ''}

      ${grantable.length ? `
        <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border)">
          <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:.35rem">Dar acceso a:</label>
          <div style="display:flex;gap:.4rem;align-items:center">
            <select id="grant-char-select" style="flex:1;background:var(--bg-3);color:var(--ink);border:1px solid var(--border);border-radius:var(--radius);padding:.3rem .5rem;font-size:.85rem">
              ${grantable.map(ch => `<option value="${ch.id}">${escapeHtml(ch.name)} (${escapeHtml(ch.playerName || '')})</option>`).join('')}
            </select>
            <button class="metal-button primary" style="white-space:nowrap;padding:.3rem .6rem;font-size:.82rem" type="button"
              data-action="grant-board-access" data-board-id="${board.id}">Dar acceso</button>
          </div>
        </div>
      ` : ''}
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
  // Vistas admin — no necesitan campaña seleccionada
  if (state.view === 'admin-dms') return renderAdminDmsView();
  if (state.view === 'admin-campaigns') return renderAdminCampaignsView();

  if (!state.campaigns.length) return renderNoCampaigns();
  if (!selectedCampaign()) return renderNoCampaigns();

  if (state.view === 'campaigns') return renderCampaignsView();
  if (state.view === 'boards') return renderBoardsView();
  if (state.view === 'characters') return renderCharactersView();
  if (state.view === 'players') return renderDmPlayersView();
  if (state.view === 'notifications') return renderNotificationsView();
  if (state.view === 'pulled') return renderPulledView();
  if (state.view === 'history') return renderHistoryView();
  return renderBoardsView();
}

function renderNoCampaigns() {
  const isDmLike = state.user.role === 'dm' || state.user.role === 'admin';
  return `
    <section class="empty-state">
      <div>
        <h2 class="section-title">Sin campañas en el tablón</h2>
        <p>${isDmLike ? 'Crea la primera campaña para clavar los primeros avisos.' : 'Tu cuenta aún no está vinculada a ninguna campaña.'}</p>
        ${state.user.role === 'admin' ? `<button class="metal-button" type="button" data-action="nav" data-view="admin-campaigns">Ver campañas</button>` : ''}
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
        ${state.user.role !== 'player' ? `<button class="metal-button" type="button" data-action="open-modal" data-modal="board-form">Nuevo tablón</button>` : ''}
        ${state.user.role !== 'player' && board ? `<button class="ghost-button" type="button" data-action="edit-board" data-id="${board.id}">Editar tablón</button>` : ''}
        ${state.user.role !== 'player' && board ? `<button class="metal-button primary" type="button" data-action="open-modal" data-modal="announcement-form">Nuevo anuncio</button>` : ''}
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
  // Jugadores: barra de búsqueda + selector de personaje activo
  if (state.user.role === 'player') {
    return renderPlayerBoardHeader();
  }
  // DM / admin: filtros completos
  const tags = [...new Set(state.announcements.flatMap(announcement => announcement.tags || []))].sort();
  return `
    <div class="filter-row">
      <label style="flex:1.4;min-width:140px">Buscar
        <input type="search" placeholder="Título, texto o etiqueta…"
          data-action="filter" data-filter="search"
          value="${escapeHtml(state.filters.search)}"
          style="width:100%">
      </label>
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
      <label class="checkbox-row" style="align-self:flex-end;white-space:nowrap;gap:.4rem">
        <input type="checkbox" data-action="filter" data-filter="hideResolved" ${state.filters.hideResolved ? 'checked' : ''}>
        Ocultar resueltos
      </label>
    </div>
  `;
}

function renderPlayerBoardHeader() {
  const active = state.characters.filter(isCharacterPlayable);
  const inactive = state.characters.filter(c => !isCharacterPlayable(c));
  const activeId = activeCharacterId();
  const activeChar = state.characters.find(c => c.id === activeId);

  if (state.characters.length === 0) {
    return `<div class="player-board-header"><p class="muted">El DM aún no te ha asignado ningún personaje.</p></div>`;
  }

  return `
    <div class="player-board-header">
      <div class="active-char-display">
        <span class="active-char-label">Jugando como</span>
        <span class="active-char-name">${activeChar ? escapeHtml(activeChar.name) : '—'}</span>
        ${activeChar ? charStatusBadge(activeChar.status) : ''}
      </div>
      <label class="char-switcher">
        <select data-action="active-character">
          <option value="">Elegir personaje…</option>
          ${active.map(ch => `
            <option value="${ch.id}" ${ch.id === activeId ? 'selected' : ''}>${escapeHtml(ch.name)}</option>
          `).join('')}
          ${inactive.length ? `<optgroup label="── No disponibles ──">
            ${inactive.map(ch => `<option value="${ch.id}" disabled>${escapeHtml(ch.name)} (${charStatusLabels[ch.status] || ch.status})</option>`).join('')}
          </optgroup>` : ''}
        </select>
      </label>
      <label style="flex:1;min-width:120px">
        <input type="search" placeholder="Buscar encargo…"
          data-action="filter" data-filter="search"
          value="${escapeHtml(state.filters.search)}"
          style="width:100%">
      </label>
    </div>
  `;
}

function renderCharacterSelect() {
  if (state.user.role !== 'player') return '';
  const active = state.characters.filter(isCharacterPlayable);
  const inactive = state.characters.filter(c => !isCharacterPlayable(c));
  return `
    <label>Personaje
      <select data-action="active-character">
        <option value="">Sin elegir</option>
        ${active.map(ch => `
          <option value="${ch.id}" ${ch.id === activeCharacterId() ? 'selected' : ''}>
            ${escapeHtml(ch.name)}
          </option>
        `).join('')}
        ${inactive.length ? `<optgroup label="── No disponibles ──">
          ${inactive.map(ch => `
            <option value="${ch.id}" disabled>
              ${escapeHtml(ch.name)} (${charStatusLabels[ch.status] || ch.status})
            </option>
          `).join('')}
        </optgroup>` : ''}
      </select>
    </label>
  `;
}

function filteredAnnouncements() {
  const search = state.filters.search.trim().toLowerCase();
  if (state.user.role === 'player') {
    // Para jugadores el servidor ya filtra por visibilidad; solo aplicamos búsqueda de texto
    if (!search) return state.announcements;
    return state.announcements.filter(a =>
      a.title.toLowerCase().includes(search) ||
      (a.publicText || '').toLowerCase().includes(search)
    );
  }
  return state.announcements.filter(announcement => {
    const tagOk = state.filters.tag === 'all' || announcement.tags.includes(state.filters.tag);
    const statusOk = state.filters.status === 'all' || announcement.status === state.filters.status;
    const resolvedOk = !state.filters.hideResolved ||
      (announcement.status !== 'completado' && announcement.status !== 'archivado');
    const searchOk = !search ||
      announcement.title.toLowerCase().includes(search) ||
      (announcement.publicText || '').toLowerCase().includes(search) ||
      (announcement.tags || []).some(t => t.toLowerCase().includes(search));
    return tagOk && statusOk && resolvedOk && searchOk;
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
        ${announcements.map(renderAnnouncementCard).join('') || `
          <div class="empty-state">
            <div>
              <p>${state.user.role === 'player' ? 'No hay encargos disponibles en este tablón.' : 'No hay anuncios con esos filtros.'}</p>
            </div>
          </div>`
        }
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
      ${state.user.role !== 'player' ? `<span class="status-pill">${labels[announcement.status] || announcement.status}</span>` : ''}
      <h3>${escapeHtml(announcement.title)}</h3>
      <p>${escapeHtml(shortText(announcement.publicText))}</p>
      ${tagPills.length ? `<div class="notice-tags">${tagPills.join('')}</div>` : ''}
    </button>
  `;
}

function renderCharactersView() {
  if (state.user.role === 'dm' || state.user.role === 'admin') return renderDmPlayersView();

  const active = state.characters.filter(isCharacterPlayable);
  const inactive = state.characters.filter(c => !isCharacterPlayable(c));

  return `
    <section class="view-header">
      <div>
        <h2>Mis personajes</h2>
        <p>Personajes que el DM te ha asignado en esta campaña.</p>
      </div>
    </section>
    ${state.characters.length === 0 ? `
      <div class="empty-state">
        <div>
          <h2 class="section-title">Sin personajes</h2>
          <p>El DM aún no te ha asignado ningún personaje en esta campaña.</p>
        </div>
      </div>
    ` : `
      ${active.length ? `
        <h3 class="section-title">Activos</h3>
        <section class="list-grid">
          ${active.map(ch => renderPlayerCharacterCard(ch, true)).join('')}
        </section>
      ` : ''}
      ${inactive.length ? `
        <h3 class="section-title" style="margin-top:1rem">Retirados / Caídos</h3>
        <section class="list-grid">
          ${inactive.map(ch => renderPlayerCharacterCard(ch, false)).join('')}
        </section>
      ` : ''}
    `}
  `;
}

function renderPlayerCharacterCard(ch, isActive) {
  return `
    <article class="list-card ${isActive ? '' : 'char-card-inactive'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
        <h3 style="margin:0">${escapeHtml(ch.name)}</h3>
        ${charStatusBadge(ch.status)}
      </div>
      <p class="muted">${[ch.ancestry, ch.archetype].filter(Boolean).map(escapeHtml).join(' · ') || 'Sin linaje'}</p>
      ${ch.deathNote ? `<div class="char-death-note">${escapeHtml(ch.deathNote)}</div>` : ''}
      ${ch.notes ? `<p style="font-size:.85rem;color:var(--ink)">${escapeHtml(ch.notes)}</p>` : ''}
    </article>
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
              <button class="metal-button primary" type="button" data-action="add-character-to-player" data-username="${escapeHtml(player.username)}">Crear personaje</button>
              <button class="metal-button" type="button" data-action="manage-player-characters" data-id="${player.id}" data-name="${escapeHtml(player.displayName)}">Gestionar personajes</button>
              <button class="ghost-button" type="button" data-action="edit-player" data-id="${player.id}">Notas DM</button>
              <button class="ghost-button" type="button" data-action="reset-player-password" data-id="${player.id}" data-name="${escapeHtml(player.displayName)}">🔑 Contraseña</button>
              <button class="danger-button" type="button" data-action="delete-player" data-id="${player.id}" data-name="${escapeHtml(player.displayName)}">Eliminar jugador</button>
            </div>
            <div class="character-stack">
              ${characters.map(character => `
                <div class="pulled-item ${isCharacterPlayable(character) ? '' : 'char-card-inactive'}">
                  <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">
                    <button class="ghost-button" style="padding:0;font-size:.92rem;font-weight:700;color:var(--ink);background:none;border:none;cursor:pointer;text-align:left" type="button"
                      data-action="edit-character" data-id="${character.id}">${escapeHtml(character.name)}</button>
                    ${charStatusBadge(character.status)}
                  </div>
                  <span class="muted">${escapeHtml(character.ancestry || 'Sin linaje')} ${escapeHtml(character.archetype || '')}</span>
                  ${character.deathNote ? `<div class="char-death-note">${escapeHtml(shortText(character.deathNote, 120))}</div>` : ''}
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
  if (state.user.role === 'player') return renderDashboardView();
  const unread = state.notifications.filter(n => !n.readAt);
  return `
    <section class="view-header">
      <div>
        <h2>Panel de notificaciones</h2>
        <p>Avisos internos generados cuando un jugador arranca un anuncio.</p>
      </div>
      ${unread.length > 1 ? `<button class="ghost-button" type="button" data-action="mark-all-read">Marcar todas como leídas (${unread.length})</button>` : ''}
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
    'announcement-detail': renderAnnouncementDetail,
    'player-characters': renderPlayerCharactersModal,
    'link-character': renderLinkCharacterModal,
    'recovery-token': renderRecoveryTokenModal,
    'dm-profile': renderDmProfileModal,
    'player-password': renderPlayerPasswordModal,
    'dm-form': renderDmForm,
    'admin-campaign-dms': renderAdminCampaignDmsModal
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
            ${editing && character.userId ? `
              <button class="ghost-button" type="button" style="margin-top:.35rem;font-size:.8rem"
                data-action="edit-player" data-id="${character.userId}">→ Ver ficha de jugador</button>
            ` : ''}
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
        ${editing ? `
          <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
          <h3 class="section-title">Estado del personaje</h3>
          <div class="form-grid two-cols">
            <label>Estado
              <select name="status">
                ${Object.entries(charStatusLabels).map(([val, label]) =>
                  `<option value="${val}" ${(character.status || 'activo') === val ? 'selected' : ''}>${label}</option>`
                ).join('')}
              </select>
            </label>
            <label>Nota final <small class="muted">(muerte, retiro…)</small>
              <input name="deathNote" value="${escapeHtml(character.deathNote || '')}" placeholder="Cómo fue su final">
            </label>
          </div>
          <p class="muted">Si el personaje pasa a un estado no activo, sus encargos pendientes se revierten automáticamente.</p>
        ` : ''}
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

function renderRecoveryTokenModal() {
  const { token } = state.modal.data || {};
  return `
    ${modalHeader('Código de recuperación')}
    <div class="modal-body">
      <p>Copia este código y úsalo en el formulario de recuperación. Caduca en 1 hora.</p>
      <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius);padding:.75rem;font-family:monospace;font-size:.85rem;word-break:break-all;color:var(--gold)">${escapeHtml(token || '')}</div>
      <div class="actions">
        <button class="metal-button primary" type="button" data-action="copy-recovery-token" data-token="${escapeHtml(token || '')}">Copiar código</button>
        <button class="ghost-button" type="button" data-action="close-modal">Cerrar</button>
      </div>
    </div>
  `;
}

function renderDmProfileModal() {
  const user = state.user || {};
  return `
    ${modalHeader('Mi perfil')}
    <div class="modal-body">
      <form class="form-grid" data-form="dm-profile">
        <label>Nombre visible
          <input name="displayName" required value="${escapeHtml(user.displayName || '')}">
        </label>
        <label>Correo (para recuperación de contraseña)
          <input name="email" type="email" autocomplete="email" value="${escapeHtml(user.email || '')}" placeholder="tu@correo.com">
        </label>
        <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
        <h3 class="section-title">Cambiar contraseña</h3>
        <label>Contraseña actual
          ${passwordInput('currentPassword', 'current-password')}
        </label>
        <label>Nueva contraseña <small class="muted">(mínimo 6 caracteres)</small>
          ${passwordInput('newPassword', 'new-password')}
        </label>
        <p class="muted">Deja los campos de contraseña vacíos para no cambiarla.</p>
        ${state.user.role === 'admin' ? `
          <hr style="border:0;border-top:1px solid var(--border);margin:.25rem 0">
          <h3 class="section-title">Copia de seguridad</h3>
          <p class="muted">Descarga un volcado de la base de datos SQLite para guardar tus datos.</p>
          <div class="actions">
            <button class="metal-button" type="button" data-action="download-backup">⬇ Descargar backup</button>
          </div>
        ` : ''}
        <div class="actions">
          <button class="metal-button primary" type="submit">Guardar</button>
          <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderPlayerPasswordModal() {
  const { playerId, playerName } = state.modal.data || {};
  return `
    ${modalHeader(`Cambiar contraseña — ${escapeHtml(playerName || '')}`)}
    <div class="modal-body">
      <form class="form-grid" data-form="player-password">
        <input type="hidden" name="playerId" value="${playerId}">
        <label>Nueva contraseña <small class="muted">(mínimo 6 caracteres)</small>
          ${passwordInput('password', 'new-password', '', true)}
        </label>
        <div class="actions">
          <button class="metal-button primary" type="submit">Cambiar contraseña</button>
          <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderLinkCharacterModal() {
  const { characters = [] } = state.modal.data || {};
  const notInCampaign = characters.filter(c => !c.inCampaign);
  const inCampaign = characters.filter(c => c.inCampaign);
  return `
    ${modalHeader('Añadir personaje a campaña')}
    <div class="modal-body">
      ${notInCampaign.length ? `
        <h3 class="section-title">Personajes disponibles</h3>
        <p class="muted">Personajes de tus otras campañas que puedes añadir a ésta.</p>
        <div class="card-list">
          ${notInCampaign.map(ch => `
            <div class="private-field">
              <strong>${escapeHtml(ch.name)}</strong>
              <span class="muted">${escapeHtml(ch.playerName || '')}${ch.ancestry ? ' · ' + escapeHtml(ch.ancestry) : ''}${ch.archetype ? ' ' + escapeHtml(ch.archetype) : ''}</span>
              <div class="actions">
                <button class="metal-button primary" type="button" data-action="quick-assign-character" data-id="${ch.id}">Añadir a esta campaña</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<p class="muted">No hay personajes de otras campañas disponibles para añadir.</p>`}
      ${inCampaign.length ? `
        <h3 class="section-title" style="margin-top:.85rem">Ya en esta campaña</h3>
        <div class="card-list">
          ${inCampaign.map(ch => `
            <div class="private-field">
              <strong>${escapeHtml(ch.name)}</strong>
              <span class="muted">${escapeHtml(ch.playerName || '')}${ch.ancestry ? ' · ' + escapeHtml(ch.ancestry) : ''}</span>
              <span style="font-size:.78rem;color:var(--gold)">✓ ya asignado</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="actions" style="margin-top:.85rem;padding-top:.75rem;border-top:1px solid var(--border)">
        <button class="ghost-button" type="button" data-action="open-modal" data-modal="player-form">Crear jugador nuevo</button>
        <button class="ghost-button" type="button" data-action="close-modal">Cerrar</button>
      </div>
    </div>
  `;
}

function renderPlayerCharactersModal() {
  const { playerId, playerName, characters = [] } = state.modal.data || {};
  const inCampaign = characters.filter(c => c.inCampaign);
  const notInCampaign = characters.filter(c => !c.inCampaign);

  return `
    ${modalHeader(`Personajes de ${escapeHtml(playerName || '')}`)}
    <div class="modal-body">
      ${inCampaign.length ? `
        <h3 class="section-title">En esta campaña</h3>
        <div class="card-list">
          ${inCampaign.map(ch => `
            <div class="private-field ${isCharacterPlayable(ch) ? '' : 'char-card-inactive'}">
              <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
                <strong>${escapeHtml(ch.name)}</strong>
                ${charStatusBadge(ch.status)}
              </div>
              <span class="muted">${escapeHtml(ch.ancestry || 'Sin linaje')} ${escapeHtml(ch.archetype || '')}</span>
              ${ch.deathNote ? `<div class="char-death-note">${escapeHtml(shortText(ch.deathNote, 100))}</div>` : ''}
              ${ch.notes ? `<span class="muted">${escapeHtml(shortText(ch.notes, 100))}</span>` : ''}
              <div class="actions">
                <button class="ghost-button" type="button" data-action="edit-character" data-id="${ch.id}">Editar</button>
                <button class="danger-button" type="button" data-action="unassign-character" data-id="${ch.id}" data-player-id="${playerId}" data-player-name="${escapeHtml(playerName)}">Quitar de campaña</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<p class="muted">Este jugador no tiene personajes en esta campaña todavía.</p>`}

      ${notInCampaign.length ? `
        <h3 class="section-title" style="margin-top:.75rem">Otros personajes del jugador</h3>
        <p class="muted">Personajes creados en otras campañas. Puedes asignarlos a esta campaña.</p>
        <div class="card-list">
          ${notInCampaign.map(ch => `
            <div class="private-field ${isCharacterPlayable(ch) ? '' : 'char-card-inactive'}">
              <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
                <strong>${escapeHtml(ch.name)}</strong>
                ${charStatusBadge(ch.status)}
              </div>
              <span class="muted">${escapeHtml(ch.ancestry || 'Sin linaje')} ${escapeHtml(ch.archetype || '')}</span>
              ${ch.deathNote ? `<div class="char-death-note">${escapeHtml(shortText(ch.deathNote, 80))}</div>` : ''}
              <div class="actions">
                <button class="metal-button" type="button" data-action="assign-character" data-id="${ch.id}" data-player-id="${playerId}" data-player-name="${escapeHtml(playerName)}">Añadir a esta campaña</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="actions" style="margin-top:.75rem; padding-top:.75rem; border-top:1px solid var(--border)">
        <button class="metal-button primary" type="button" data-action="add-character-to-player" data-username="${escapeHtml(state.players.find(p => p.id === playerId)?.username || '')}">Crear nuevo personaje</button>
        <button class="ghost-button" type="button" data-action="close-modal">Cerrar</button>
      </div>
    </div>
  `;
}

function renderPlayerForm() {
  const player = state.modal.data || {};
  const editing = Boolean(player.id);
  return `
    ${modalHeader(editing ? `Ficha: ${escapeHtml(player.displayName || player.username || '')}` : 'Crear o vincular jugador')}
    <div class="modal-body">
      <form class="form-grid" data-form="player">
        ${editing ? `<input type="hidden" name="playerId" value="${player.id}">` : ''}
        <div class="form-grid two-cols">
          <label>Nombre de usuario
            <input name="username" required placeholder="jugador" value="${escapeHtml(player.username || '')}"
              ${editing ? 'readonly style="opacity:.6;cursor:default"' : ''}>
          </label>
          <label>Nombre visible
            <input name="displayName" placeholder="Nombre del jugador" value="${escapeHtml(player.displayName || '')}">
          </label>
        </div>
        ${editing ? `
          <hr style="border:0;border-top:1px solid var(--border);margin:.15rem 0">
          <label>Nueva contraseña <small class="muted">(dejar en blanco para no cambiarla)</small>
            ${passwordInput('newPassword', 'new-password', 'Mínimo 6 caracteres')}
          </label>
        ` : `
          <label>Contraseña inicial
            <input name="password" type="text" minlength="6" placeholder="Solo si estás creando un jugador nuevo">
          </label>
        `}
        <label>Notas privadas del DM
          <textarea name="dmNotes">${escapeHtml(player.dmNotes || '')}</textarea>
        </label>
        ${editing ? '' : `<p class="muted">Si el usuario ya existe, se vinculará a esta campaña; la contraseña solo se usa al crear usuarios nuevos.</p>`}
        ${editing ? renderCredentialsCopyBlock(player) : ''}
        <div class="actions">
          <button class="metal-button primary" type="submit">${editing ? 'Guardar cambios' : 'Guardar jugador'}</button>
          <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderCredentialsCopyBlock(player) {
  const hasHint = Boolean(player.dmPasswordHint);
  const credText = hasHint
    ? `Usuario: ${player.username}\nContraseña: ${player.dmPasswordHint}`
    : '';
  return `
    <div class="credentials-block">
      <div class="credentials-header">
        <span class="credentials-label">📋 Credenciales para compartir</span>
        ${hasHint ? `
          <button class="metal-button" type="button"
            data-action="copy-credentials"
            data-text="${escapeHtml(credText)}">
            Copiar
          </button>
        ` : ''}
      </div>
      ${hasHint ? `
        <div class="credentials-preview">
          <code>Usuario: ${escapeHtml(player.username)}</code>
          <code>Contraseña: ${'•'.repeat(Math.min(player.dmPasswordHint.length, 12))}</code>
        </div>
        <p class="muted" style="font-size:.75rem;margin-top:.25rem">La contraseña se muestra enmascarada aquí. El botón copia la contraseña real.</p>
      ` : `
        <p class="muted" style="font-size:.8rem">
          Sin contraseña registrada. Establece una contraseña desde esta ficha y quedará guardada para copiar.
        </p>
      `}
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
              ${state.user.role !== 'player' ? `<div class="actions"><button class="danger-button" type="button" data-action="revert-pull" data-id="${announcement.id}">Revertir arrancado</button></div>` : ''}
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
          ${state.user.role !== 'player' ? `
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

app.addEventListener('input', event => {
  const control = event.target.closest('[data-action="filter"][data-filter="search"]');
  if (!control) return;
  state.filters.search = control.value;
  render();
});

async function handleClick(control) {
  const action = control.dataset.action;

  if (action === 'auth-mode') {
    state.authMode = control.dataset.mode;
    render();
    return;
  }

  if (action === 'toggle-password') {
    const wrap = control.closest('.password-wrap');
    const input = wrap?.querySelector('input');
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
      control.textContent = input.type === 'password' ? '👁' : '🙈';
    }
    return;
  }

  if (action === 'logout') {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    logout();
    return;
  }

  if (action === 'nav') {
    state.view = control.dataset.view;
    localStorage.setItem('tablon.view', state.view);
    state.mobileRailOpen = false;
    if (state.view === 'admin-dms') {
      render();
      await loadAdminDms();
    } else if (state.view === 'admin-campaigns') {
      render();
      await loadAdminCampaigns();
      if (!state.adminDms.length) await loadAdminDms();
    } else if (state.view === 'history') {
      render();
      await loadPullHistory();
    }
    render();
    return;
  }

  if (action === 'edit-dm') {
    const dm = state.adminDms.find(d => d.id === Number(control.dataset.id));
    if (dm) state.modal = { type: 'dm-form', data: dm };
    render();
    return;
  }

  if (action === 'delete-dm') {
    const name = control.dataset.name || 'este maestro';
    if (!confirm(`¿Eliminar la cuenta de ${name}? Asegúrate antes de que no tenga campañas asignadas.`)) return;
    await api(`/api/admin/dms/${control.dataset.id}`, { method: 'DELETE' });
    await loadAdminDms();
    render();
    setToast('Cuenta de maestro eliminada.');
    return;
  }

  if (action === 'manage-campaign-dms') {
    const campaignId = Number(control.dataset.id);
    const campaign = state.adminCampaigns.find(c => c.id === campaignId);
    if (!state.adminDms.length) await loadAdminDms();
    state.modal = {
      type: 'admin-campaign-dms',
      data: { campaignId, campaignName: campaign?.name || '', currentDms: campaign?.dms || [] }
    };
    render();
    return;
  }

  if (action === 'admin-open-campaign') {
    const campaignId = Number(control.dataset.id);
    state.selectedCampaignId = campaignId;
    localStorage.setItem(storageKeys.campaign, String(campaignId));
    state.view = 'boards';
    await loadCampaignContext();
    render();
    return;
  }

  if (action === 'remove-campaign-dm') {
    const campaignId = Number(control.dataset.campaignId);
    const userId = Number(control.dataset.userId);
    if (!confirm('¿Quitar este maestro de la campaña?')) return;
    await api(`/api/admin/campaigns/${campaignId}/dms/${userId}`, { method: 'DELETE' });
    await loadAdminCampaigns();
    render();
    setToast('Maestro desvinculado de la campaña.');
    return;
  }

  if (action === 'remove-campaign-dm-modal') {
    const campaignId = Number(control.dataset.campaignId);
    const userId = Number(control.dataset.userId);
    await api(`/api/admin/campaigns/${campaignId}/dms/${userId}`, { method: 'DELETE' });
    await loadAdminCampaigns();
    // Actualizar datos del modal sin cerrarlo
    const campaign = state.adminCampaigns.find(c => c.id === campaignId);
    if (campaign) state.modal.data.currentDms = campaign.dms;
    render();
    setToast('Maestro quitado.');
    return;
  }

  if (action === 'add-campaign-dm-modal') {
    const campaignId = Number(control.dataset.campaignId);
    const select = document.getElementById('admin-dm-select');
    const userId = select ? Number(select.value) : 0;
    if (!userId) return;
    const { dms } = await api(`/api/admin/campaigns/${campaignId}/dms`, { method: 'POST', body: { userId } });
    await loadAdminCampaigns();
    const campaign = state.adminCampaigns.find(c => c.id === campaignId);
    if (campaign) state.modal.data.currentDms = dms;
    render();
    setToast('Maestro asignado a la campaña.');
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
    state.filters.search = '';
    state.view = control.dataset.view || 'boards';
    await loadBoardCharacters();
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

  if (action === 'open-link-character-modal') {
    const { characters } = await api(`/api/campaigns/${state.selectedCampaignId}/linkable-characters`);
    state.modal = { type: 'link-character', data: { characters } };
    render();
    return;
  }

  if (action === 'quick-assign-character') {
    const charId = Number(control.dataset.id);
    await api(`/api/campaigns/${state.selectedCampaignId}/characters/${charId}/assign`, { method: 'POST' });
    const { characters } = await api(`/api/campaigns/${state.selectedCampaignId}/linkable-characters`);
    state.modal = { type: 'link-character', data: { characters } };
    await loadWorkspace();
    setToast('Personaje añadido a esta campaña.');
    return;
  }

  if (action === 'manage-player-characters') {
    const playerId = Number(control.dataset.id);
    const playerName = control.dataset.name || '';
    const { characters } = await api(`/api/campaigns/${state.selectedCampaignId}/players/${playerId}/characters`);
    state.modal = { type: 'player-characters', data: { playerId, playerName, characters } };
    render();
    return;
  }

  if (action === 'assign-character') {
    const charId = Number(control.dataset.id);
    const playerId = Number(control.dataset.playerId);
    const playerName = control.dataset.playerName || '';
    await api(`/api/campaigns/${state.selectedCampaignId}/characters/${charId}/assign`, { method: 'POST' });
    // Refrescar el modal con los datos actualizados
    const { characters } = await api(`/api/campaigns/${state.selectedCampaignId}/players/${playerId}/characters`);
    state.modal = { type: 'player-characters', data: { playerId, playerName, characters } };
    await loadWorkspace();
    setToast('Personaje añadido a esta campaña.');
    return;
  }

  if (action === 'unassign-character') {
    const charId = Number(control.dataset.id);
    const playerId = Number(control.dataset.playerId);
    const playerName = control.dataset.playerName || '';
    if (!confirm('¿Quitar este personaje de la campaña? Sus encargos activos quedarán revertidos.')) return;
    await api(`/api/campaigns/${state.selectedCampaignId}/characters/${charId}/unassign`, { method: 'POST' });
    const { characters } = await api(`/api/campaigns/${state.selectedCampaignId}/players/${playerId}/characters`);
    state.modal = { type: 'player-characters', data: { playerId, playerName, characters } };
    await loadWorkspace();
    setToast('Personaje desasignado de esta campaña.');
    return;
  }

  if (action === 'copy-recovery-token') {
    try {
      await navigator.clipboard.writeText(control.dataset.token || '');
      setToast('Código copiado al portapapeles.');
    } catch {
      setToast('Copia manualmente el código de arriba.', true);
    }
    return;
  }

  if (action === 'copy-credentials') {
    const text = control.dataset.text || '';
    try {
      await navigator.clipboard.writeText(text);
      setToast('Credenciales copiadas al portapapeles.');
    } catch {
      // Fallback: seleccionar texto en un input temporal
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); setToast('Credenciales copiadas.'); }
      catch { setToast('No se pudo copiar. Anótalas manualmente.', true); }
      document.body.removeChild(ta);
    }
    return;
  }

  if (action === 'open-dm-profile') {
    state.modal = { type: 'dm-profile', data: {} };
    render();
    return;
  }

  if (action === 'download-backup') {
    try {
      const response = await fetch('/api/backup', {
        headers: { authorization: `Bearer ${state.token}` }
      });
      if (!response.ok) throw new Error('Error al generar el backup.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tablon-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast('Backup descargado.');
    } catch (err) {
      setToast(err.message, true);
    }
    return;
  }

  if (action === 'reset-player-password') {
    const playerId = Number(control.dataset.id);
    const playerName = control.dataset.name || '';
    state.modal = { type: 'player-password', data: { playerId, playerName } };
    render();
    return;
  }

  if (action === 'toggle-mobile-rail') {
    state.mobileRailOpen = !state.mobileRailOpen;
    render();
    return;
  }

  if (action === 'close-mobile-rail') {
    state.mobileRailOpen = false;
    render();
    return;
  }

  if (action === 'grant-board-access') {
    const boardId = Number(control.dataset.boardId);
    const select = document.getElementById('grant-char-select');
    const charId = Number(select?.value);
    if (!charId) { setToast('Elige un personaje.', true); return; }
    await api(`/api/characters/${charId}/board-access/${boardId}`, { method: 'POST' });
    await loadBoardCharacters();
    setToast('Acceso concedido.');
    render();
    return;
  }

  if (action === 'revoke-board-access') {
    const boardId = Number(control.dataset.boardId);
    const charId = Number(control.dataset.charId);
    if (!confirm('¿Revocar el acceso explícito de este personaje a este tablón?')) return;
    await api(`/api/characters/${charId}/board-access/${boardId}`, { method: 'DELETE' });
    await loadBoardCharacters();
    setToast('Acceso revocado.');
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

  if (action === 'mark-all-read') {
    await api('/api/notifications/read-all', { method: 'POST' });
    await loadWorkspace();
    render();
    setToast('Todas las notificaciones marcadas como leídas.');
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
    const filterKey = control.dataset.filter;
    if (filterKey === 'hideResolved') {
      state.filters.hideResolved = control.checked;
    } else {
      state.filters[filterKey] = control.value;
    }
    render();
    return;
  }
  if (action === 'active-character') {
    const chosenId = Number(control.value || 0);
    const ch = state.characters.find(c => c.id === chosenId);
    if (ch && !isCharacterPlayable(ch)) {
      setToast(`${escapeHtml(ch.name)} no puede aceptar encargos (${charStatusLabels[ch.status] || ch.status}).`, true);
      render(); // resetea el select
      return;
    }
    state.activeCharacters[state.selectedCampaignId] = chosenId;
    localStorage.setItem(storageKeys.activeCharacters, JSON.stringify(state.activeCharacters));
    render();
    return;
  }
  if (action === 'mobile-campaign') {
    const id = Number(control.value);
    if (id && id !== state.selectedCampaignId) {
      state.selectedCampaignId = id;
      localStorage.setItem(storageKeys.campaign, String(id));
      await loadWorkspace();
    }
  }
}

function validateForm(form) {
  // Limpia errores previos
  form.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));
  form.querySelectorAll('.field-error-msg').forEach(el => el.remove());

  const invalid = [];
  form.querySelectorAll('[required]').forEach(field => {
    const isEmpty = field.type === 'checkbox' ? !field.checked : !field.value.trim();
    if (isEmpty) {
      // Marca el campo en rojo
      field.classList.add('field-invalid');
      const wrap = field.closest('label') || field.closest('.password-wrap') || field.parentElement;
      wrap.classList.add('field-invalid');
      // Añade mensaje de error
      const msg = document.createElement('div');
      msg.className = 'field-error-msg';
      msg.textContent = 'Este campo es obligatorio';
      wrap.insertAdjacentElement('afterend', msg);
      invalid.push(field);
      // Limpia el error cuando el usuario empieza a escribir
      field.addEventListener('input', () => {
        field.classList.remove('field-invalid');
        wrap.classList.remove('field-invalid');
        msg.remove();
      }, { once: true });
    }
  });

  if (invalid.length) {
    invalid[0].focus();
    return false;
  }
  return true;
}

async function handleSubmit(form) {
  const formName = form.dataset.form;

  // Validación visual de campos requeridos (excepto login para no interrumpir flujo básico)
  if (formName !== 'login' && formName !== 'forgot-password' && formName !== 'reset-password') {
    if (!validateForm(form)) return;
  }

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

  if (formName === 'forgot-password') {
    const response = await api('/api/forgot-password', { method: 'POST', body: data });
    if (response.resetToken) {
      state.authMode = 'reset';
      state.modal = {
        type: 'recovery-token',
        data: { token: response.resetToken }
      };
    } else {
      setToast('No hay ninguna cuenta DM con ese correo.', true);
    }
    render();
    return;
  }

  if (formName === 'reset-password') {
    await api('/api/reset-password', { method: 'POST', body: data });
    state.authMode = 'login';
    setToast('Contraseña cambiada. Ya puedes iniciar sesión.');
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
    if (existingId && (state.user.role === 'dm' || state.user.role === 'admin')) {
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
    const playerId = data.playerId ? Number(data.playerId) : null;
    const newPassword = (data.newPassword || '').trim();

    // Si estamos editando y hay nueva contraseña, cambiarla primero
    if (playerId && newPassword) {
      if (newPassword.length < 6) {
        setToast('La contraseña debe tener al menos 6 caracteres.', true);
        return;
      }
      await api(`/api/players/${playerId}/password`, { method: 'PUT', body: { password: newPassword } });
    }

    const response = await api(`/api/campaigns/${state.selectedCampaignId}/players`, {
      method: 'POST',
      body: data
    });
    state.modal = null;
    await loadWorkspace();
    const pwMsg = playerId && newPassword ? ' Contraseña actualizada.' : '';
    setToast(response.player.created
      ? 'Jugador creado y vinculado. Pásale la contraseña inicial por mensaje privado.'
      : `Cambios guardados.${pwMsg}`
    );
    return;
  }

  if (formName === 'player-password') {
    const playerId = Number(data.playerId);
    await api(`/api/players/${playerId}/password`, { method: 'PUT', body: { password: data.password } });
    state.modal = null;
    render();
    setToast('Contraseña del jugador actualizada.');
    return;
  }

  if (formName === 'dm-form') {
    const dmId = data.dmId ? Number(data.dmId) : null;
    const body = {};
    if (data.displayName) body.displayName = data.displayName;
    if (data.username) body.username = data.username;
    if (data.email) body.email = data.email;
    if (data.password) body.password = data.password;
    const response = dmId
      ? await api(`/api/admin/dms/${dmId}`, { method: 'PUT', body })
      : await api('/api/admin/dms', { method: 'POST', body });
    state.modal = null;
    await loadAdminDms();
    render();
    setToast(dmId ? 'Maestro actualizado.' : 'Maestro creado. Ya puede iniciar sesión.');
    return;
  }

  if (formName === 'dm-profile') {
    const body = {};
    if (data.displayName) body.displayName = data.displayName;
    if (data.email) body.email = data.email;
    if (data.newPassword) {
      body.currentPassword = data.currentPassword;
      body.newPassword = data.newPassword;
    }
    const response = await api('/api/me', { method: 'PUT', body });
    state.user = response.user;
    state.modal = null;
    render();
    setToast('Perfil actualizado.');
    return;
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

// ═══════════════════════════════════════════════════════
//  FUNCIONES DE ADMINISTRADOR
// ═══════════════════════════════════════════════════════

async function loadAdminDms() {
  try {
    const { dms } = await api('/api/admin/dms');
    state.adminDms = dms;
  } catch { state.adminDms = []; }
}

async function loadAdminCampaigns() {
  try {
    const { campaigns } = await api('/api/admin/campaigns');
    state.adminCampaigns = campaigns;
  } catch { state.adminCampaigns = []; }
}

function renderAdminDmsView() {
  return `
    <section class="view-header">
      <div>
        <h2>Maestros</h2>
        <p class="muted">Cuentas de Dungeon Master. Cada maestro puede gestionar las campañas a las que está asignado.</p>
      </div>
      <button class="metal-button primary" type="button" data-action="open-modal" data-modal="dm-form">+ Nuevo maestro</button>
    </section>

    <div class="list-grid">
      ${state.adminDms.map(dm => `
        <article class="list-card">
          <h3>${escapeHtml(dm.displayName)}</h3>
          <p>@${escapeHtml(dm.username)}</p>
          <div class="notice-tags">
            <span class="tag">${dm.campaignCount ?? 0} campaña${dm.campaignCount !== 1 ? 's' : ''}</span>
            ${dm.email ? `<span class="tag">${escapeHtml(dm.email)}</span>` : '<span class="tag muted">Sin correo</span>'}
          </div>
          <div class="actions" style="margin-top:.5rem">
            <button class="metal-button" type="button" data-action="edit-dm" data-id="${dm.id}">Editar</button>
            <button class="danger-button" type="button" data-action="delete-dm" data-id="${dm.id}" data-name="${escapeHtml(dm.displayName || dm.username)}">Eliminar</button>
          </div>
        </article>
      `).join('') || `<div class="empty-state" style="min-height:100px"><p>No hay maestros registrados todavía.</p></div>`}
    </div>
  `;
}

function renderAdminCampaignsView() {
  return `
    <section class="view-header">
      <div>
        <h2>Campañas</h2>
        <p class="muted">Asigna Dungeon Masters a cada campaña y accede al tablón de cualquiera.</p>
      </div>
      <button class="metal-button primary" type="button" data-action="open-modal" data-modal="campaign-form">+ Nueva campaña</button>
    </section>

    <div class="list-grid">
      ${state.adminCampaigns.map(c => `
        <article class="list-card">
          <h3>${escapeHtml(c.name)}</h3>
          <p>${escapeHtml(c.description || 'Sin descripción.')}</p>
          <div class="notice-tags" style="margin-top:.3rem">
            <span class="tag">${c.stats.board_count} tablones</span>
            <span class="tag">${c.stats.player_count} jugadores</span>
            <span class="tag">${c.stats.announcement_count} anuncios</span>
          </div>
          <div style="margin-top:.55rem">
            <div class="section-title" style="margin-bottom:.3rem">Maestros asignados</div>
            <div class="notice-tags">
              ${c.dms.length
                ? c.dms.map(dm => `<span class="tag" style="display:inline-flex;align-items:center;gap:.3rem">
                    ${escapeHtml(dm.displayName || dm.username)}
                    <button class="ghost-button" type="button" style="padding:0;font-size:.75rem;min-height:0;line-height:1"
                      data-action="remove-campaign-dm" data-campaign-id="${c.id}" data-user-id="${dm.id}">✕</button>
                  </span>`).join('')
                : `<span class="muted" style="font-size:.8rem">Sin maestro asignado</span>`}
            </div>
          </div>
          <div class="actions" style="margin-top:.6rem">
            <button class="metal-button" type="button" data-action="manage-campaign-dms" data-id="${c.id}">Gestionar maestros</button>
            <button class="ghost-button" type="button" data-action="admin-open-campaign" data-id="${c.id}">Ir al tablón →</button>
          </div>
        </article>
      `).join('') || `<div class="empty-state" style="min-height:100px"><p>No hay campañas todavía.</p></div>`}
    </div>
  `;
}

function renderDmForm() {
  const dm = state.modal?.data || {};
  const editing = Boolean(dm.id);
  return `
    ${modalHeader(editing ? `Editar maestro: ${escapeHtml(dm.displayName || dm.username)}` : 'Nuevo maestro')}
    <div class="modal-body">
      <form class="form-grid" data-form="dm-form">
        ${editing ? `<input type="hidden" name="dmId" value="${dm.id}">` : ''}
        <label>Nombre visible
          <input name="displayName" required value="${escapeHtml(dm.displayName || '')}">
        </label>
        <label>Usuario
          <input name="username" autocomplete="off" ${editing ? 'readonly style="opacity:.6"' : 'required minlength="3"'}
            value="${escapeHtml(dm.username || '')}">
        </label>
        <label>Correo (recuperación de contraseña)
          <input name="email" type="email" value="${escapeHtml(dm.email || '')}">
        </label>
        ${editing
          ? `<label>${passwordInput('password', 'new-password', 'Dejar vacío para no cambiar')}</label>`
          : `<label>Contraseña inicial ${passwordInput('password', 'new-password', '', true)}</label>`}
        <button class="metal-button primary" type="submit">${editing ? 'Guardar cambios' : 'Crear maestro'}</button>
      </form>
    </div>
  `;
}

function renderAdminCampaignDmsModal() {
  const { campaignId, campaignName, currentDms } = state.modal?.data || {};
  const assignedIds = new Set((currentDms || []).map(d => d.id));
  const available = state.adminDms.filter(d => !assignedIds.has(d.id));

  return `
    ${modalHeader(`Maestros: ${escapeHtml(campaignName || '')}`)}
    <div class="modal-body">
      <p class="section-title">Maestros actuales</p>
      <div class="card-list" style="margin-bottom:.85rem">
        ${(currentDms || []).map(dm => `
          <div class="list-card" style="flex-direction:row;align-items:center;justify-content:space-between;padding:.5rem .8rem">
            <div>
              <strong style="color:var(--gold)">${escapeHtml(dm.displayName || dm.username)}</strong>
              <span class="muted" style="margin-left:.4rem;font-size:.78rem">@${escapeHtml(dm.username)}</span>
            </div>
            <button class="danger-button" type="button"
              data-action="remove-campaign-dm-modal" data-campaign-id="${campaignId}" data-user-id="${dm.id}">Quitar</button>
          </div>
        `).join('') || `<p class="muted">Sin maestros asignados.</p>`}
      </div>

      ${available.length ? `
        <p class="section-title">Añadir maestro</p>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <select id="admin-dm-select" style="flex:1;min-width:160px">
            ${available.map(d => `<option value="${d.id}">${escapeHtml(d.displayName || d.username)}</option>`).join('')}
          </select>
          <button class="metal-button primary" type="button"
            data-action="add-campaign-dm-modal" data-campaign-id="${campaignId}">Asignar</button>
        </div>
      ` : `<p class="muted" style="font-size:.83rem">Todos los maestros disponibles ya están asignados a esta campaña.</p>`}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
//  HISTORIAL DE ENCARGOS
// ═══════════════════════════════════════════════════════

async function loadPullHistory() {
  if (!state.selectedCampaignId) return;
  try {
    const { history } = await api(`/api/campaigns/${state.selectedCampaignId}/pull-history`);
    state.pullHistory = history;
  } catch { state.pullHistory = []; }
}

function renderHistoryView() {
  const campaign = selectedCampaign();
  if (!campaign) return renderNoCampaigns();
  const active = state.pullHistory.filter(r => r.active);
  const reverted = state.pullHistory.filter(r => !r.active && r.revertedAt);
  const completed = state.pullHistory.filter(r => !r.active && !r.revertedAt);

  const renderRow = r => `
    <article class="list-card" style="padding:.6rem .85rem">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
        <div>
          <button class="ghost-button" style="padding:0;font-size:.92rem;font-weight:700;color:var(--gold);background:none;border:none;cursor:pointer;text-align:left"
            type="button" data-action="open-announcement" data-id="${r.announcementId}">${escapeHtml(r.announcementTitle)}</button>
          <span class="muted" style="font-size:.78rem;margin-left:.4rem">${escapeHtml(r.boardName)}</span>
        </div>
        <span class="tag" style="font-size:.75rem;white-space:nowrap">${r.active ? '🟡 Activo' : r.revertedAt ? '↩ Revertido' : '✓ Cerrado'}</span>
      </div>
      <div class="muted" style="font-size:.82rem;margin-top:.2rem">
        <strong>${escapeHtml(r.characterName)}</strong> · ${escapeHtml(r.playerName)} (@${escapeHtml(r.username)})
      </div>
      <div class="muted" style="font-size:.76rem;margin-top:.15rem">
        Arrancado: ${formatDate(r.pulledAt)}
        ${r.revertedAt ? ` · Revertido: ${formatDate(r.revertedAt)} por ${escapeHtml(r.revertedByName || '—')}` : ''}
      </div>
    </article>
  `;

  return `
    <section class="view-header">
      <div>
        <h2>Historial de encargos</h2>
        <p class="muted">Todos los anuncios arrancados en <strong>${escapeHtml(campaign.name)}</strong> — activos, revertidos y cerrados.</p>
      </div>
    </section>

    ${state.pullHistory.length === 0 ? `
      <div class="empty-state"><div><p>No hay encargos registrados todavía en esta campaña.</p></div></div>
    ` : `
      ${active.length ? `
        <h3 class="section-title">En curso (${active.length})</h3>
        <section class="list-grid">${active.map(renderRow).join('')}</section>
      ` : ''}
      ${reverted.length ? `
        <h3 class="section-title" style="margin-top:1rem">Revertidos (${reverted.length})</h3>
        <section class="list-grid">${reverted.map(renderRow).join('')}</section>
      ` : ''}
      ${completed.length ? `
        <h3 class="section-title" style="margin-top:1rem">Cerrados / Completados (${completed.length})</h3>
        <section class="list-grid">${completed.map(renderRow).join('')}</section>
      ` : ''}
    `}
  `;
}

init();
