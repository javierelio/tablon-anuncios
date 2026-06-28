# Revisión global del Tablón de Anuncios Westmarch

> Revisado el 2026-06-26 — server.js (~1890 líneas) y app.js (~2591 líneas) leídos al completo.

---

## BUGS CRÍTICOS (rompen funcionalidad real del admin)

### B1 · GET `/api/campaigns/:id/boards` excluye al admin
**Archivo:** `server.js` línea 1253

```js
const rows = user.role === 'dm'
  ? db.prepare('SELECT * FROM boards …').all(campaign.id)
  : db.prepare(/* query filtrada por personajes del jugador */).all(campaign.id, user.id);
```

El admin cae en la rama del jugador. Como el admin no tiene personajes, recibe 0 tablones. La vista de tablones queda vacía cuando el admin navega a una campaña.

**Fix:** cambiar la condición a `user.role !== 'player'`.

---

### B2 · GET `/api/campaigns/:id/characters` excluye al admin
**Archivo:** `server.js` línea 1377

Mismo patrón. El admin cae en la rama de jugador y obtiene solo los personajes cuyo `user_id = admin.id` — que son ninguno.

**Fix:** cambiar la condición a `user.role !== 'player'`.

---

### B3 · `announcementDto()` excluye al admin de los campos privados
**Archivo:** `server.js` línea ~401

```js
if (includePrivate && user.role === 'dm') { // admin no entra aquí
```

Cuando el admin abre un anuncio, el panel privado (gancho narrativo, recompensa real, notas del DM…) llega vacío desde el servidor.

**Fix:**
```js
if (includePrivate && (user.role === 'dm' || user.role === 'admin')) {
```

---

### B4 · PUT `/api/characters/:id/board-access` bloquea al admin con 403
**Archivo:** `server.js` línea 1636

```js
if (campaign.dm_id !== user.id)
  throw new HttpError(403, 'No puedes editar ese personaje.');
```

`admin.id` nunca es igual a `campaign.dm_id`, así que cualquier intento del admin de guardar permisos de tablón falla con 403.

**Fix:** añadir excepción para admin:
```js
if (user.role !== 'admin' && campaign.dm_id !== user.id)
  throw new HttpError(403, 'No puedes editar ese personaje.');
```

---

### B5 · `renderNotificationsView()` muestra el dashboard al admin
**Archivo:** `app.js` línea 1090

```js
if (state.user.role !== 'dm') return renderDashboardView();
```

El admin tiene "Avisos" en su navegación pero al abrirlo ve el dashboard (que además llama a `campaignStats()` con datos que puede no tener cargados).

**Fix:**
```js
if (state.user.role === 'player') return renderDashboardView();
```

---

### B6 · `renderRightRail()` muestra la barra lateral del jugador al admin
**Archivo:** `app.js` línea 513

```js
state.user.role === 'dm' ? renderDmSideCards() : renderPlayerSideCards()
```

El admin ve el selector de personaje activo y "Mis encargos arrancados" — controles irrelevantes para su rol. No ve notificaciones ni el widget de acceso a tablones.

**Fix:**
```js
(state.user.role === 'dm' || state.user.role === 'admin')
  ? renderDmSideCards()
  : renderPlayerSideCards()
```

---

### B7 · `renderAnnouncementDetail()` no muestra acciones al admin
**Archivo:** `app.js` línea 1689

```js
${state.user.role === 'dm' ? `
  <section class="private-field">
    <strong>Acciones del DM</strong>  …editar, completar, archivar, eliminar…
  </section>
  …campos privados…
` : ''}
```

El admin abre un anuncio y no puede editarlo, cambiarle el estado ni ver los campos privados desde el modal.

**Fix:** cambiar `state.user.role === 'dm'` por `state.user.role !== 'player'` en todas las ramas de ese bloque.

---

### B8 · `renderBoardsView()` no muestra botones de gestión al admin
**Archivo:** `app.js` líneas 818-820

```js
${state.user.role === 'dm' ? `<button … Nuevo tablón>` : ''}
${state.user.role === 'dm' && board ? `<button … Editar tablón>` : ''}
${state.user.role === 'dm' && board ? `<button … Nuevo anuncio>` : ''}
```

El admin no puede crear tablones, editarlos ni publicar anuncios.

**Fix:** reemplazar las tres condiciones con `state.user.role !== 'player'`.

---

### B9 · `renderCharactersView()` no deriva al admin a la vista de DM
**Archivo:** `app.js` línea 974

```js
function renderCharactersView() {
  if (state.user.role === 'dm') return renderDmPlayersView();
  // admin cae aquí ↓ y ve "Mis personajes" (lista vacía)
```

El admin ve una vista de jugador vacía en lugar de la gestión de jugadores.

**Fix:**
```js
if (state.user.role === 'dm' || state.user.role === 'admin') return renderDmPlayersView();
```

---

### B10 · Guardar acceso a tablones desde el formulario de personaje no funciona para el admin
**Archivo:** `app.js` línea 2334

```js
if (existingId && state.user.role === 'dm') {
  // guardar board access
}
```

Si el admin edita un personaje, la sección de tablones se guarda sin errores pero el guardado real nunca ocurre.

**Fix:**
```js
if (existingId && (state.user.role === 'dm' || state.user.role === 'admin')) {
```

---

## BUGS MODERADOS (inconsistencias de datos)

### B11 · `setAnnouncementStatus()` permite poner 'arrancado' sin pull_record
**Archivo:** `server.js`

El DM puede cambiar manualmente el estado de un anuncio a `'arrancado'` usando el endpoint `/status`. El resultado es que el anuncio aparece como arrancado pero no existe `pull_record` activo, lo que provoca:
- El modal de detalle no muestra "Arrancado por …"
- El botón "Revertir arrancado" falla con 404.
- El jugador que lo tenía antes queda en un estado inconsistente.

**Fix:** bloquear `'arrancado'` en ese endpoint (solo `disponible`, `completado`, `archivado`), o crear automáticamente un pull_record anónimo.

---

### B12 · `pullAnnouncement()` solo notifica al DM original de la campaña
**Archivo:** `server.js` línea 1054

```js
db.prepare('INSERT INTO notifications …').run(dmId, …)
// dmId = campaign.dm_id (DM original, nunca los co-DMs de campaign_dms)
```

Los co-DMs asignados vía `campaign_dms` no reciben la notificación cuando un jugador arranca un anuncio.

**Fix:** iterar sobre todos los DMs de la campaña e insertar una notificación por cada uno.

---

### B13 · Admin puede asignar una campaña a un usuario sin rol DM
**Archivo:** `server.js`, función `createCampaign()`

Cuando el admin crea una campaña con `body.dmId`, no se valida que ese ID corresponda a un usuario con `role = 'dm'`. Se podría asignar un jugador o el propio admin.

---

## CÓDIGO MUERTO / ALCANZABLE

Estas funciones existen en `app.js` pero ningún botón ni ruta de navegación las invoca:

- `renderDashboardView()` — vista de dashboard con stats
- `renderCampaignDetailView()` — detalle de una campaña
- `renderRegisterForm()` — formulario de registro (el registro está deshabilitado por diseño)

No son bugs activos pero añaden peso al fichero y pueden crear confusión.

---

## PROBLEMAS DE UX

### U1 · Sin confirmación al quitar un DM desde la tarjeta de campaña
El botón `✕` junto al nombre del DM en la vista de admin-campaigns llama a `remove-campaign-dm` directamente, sin `confirm()`. Un clic accidental desvincula al DM sin posibilidad de deshacer.

### U2 · El admin no puede eliminar un DM
La vista de administración de DMs solo ofrece "Editar". No hay forma de borrar un DM. Esto puede ser intencionado (borrado peligroso) pero al menos debería haber una opción de desactivar.

### U3 · El admin no puede eliminar campañas
La vista `admin-campaigns` no tiene botón de eliminar campaña. El admin tendría que navegar a la vista de campañas del DM (que no aparece en su navegación).

### U4 · Hint de credenciales de prueba en producción
En la pantalla de login se muestra siempre:
```
Cuentas de prueba
DM: dm / dm123
Jugador: jugador / jugador123
```
Si algún día la app se expone en red local, esta caja revela credenciales válidas. Considerar ocultarla con una variable de entorno o eliminarla.

### U5 · No hay "Marcar todo como leído"
La vista de notificaciones obliga a marcar una por una. Con muchas notificaciones esto es tedioso.

### U6 · El modal de anuncio no muestra el tablón/campaña de origen
Al abrir un anuncio, el modal no indica en qué tablón o campaña está. Si el DM gestiona varias campañas puede perder contexto.

### U7 · Toast puede quedar detrás del modal
El `toast` se renderiza dentro de `.app-layout` pero los modales tienen backdrop. Si hay un error al hacer algo dentro de un modal, el toast puede quedar oculto detrás del overlay. Verificar z-index.

### U8 · Sin estado de carga durante operaciones async
Las llamadas a la API pueden tardar. No hay spinner ni indicación visual de que algo está pasando. Con lag de red (aunque sea local) la UI parece rota.

---

## NOTAS DE SEGURIDAD (app local, baja urgencia)

- **`dm_password_hint` en claro**: intencional por diseño, pero la contraseña del admin también queda guardada en texto plano en esa columna. Al menos para el admin se podría omitir el hint.
- **Sin rate limiting en `/api/login`**: permite fuerza bruta. Aceptable en LAN local.
- **Token de reset en el cuerpo de la respuesta**: el token bruto se envía en `{ resetToken: rawToken }` y se muestra en pantalla. Funcional para una app local (no hay email), pero no extrapolable a producción.

---

## PROPUESTAS DE MEJORA

### M1 · Polling automático (actualización sin recargar)
Actualmente los jugadores tienen que recargar la página para ver nuevos anuncios. Un `setInterval` de 30-60 segundos que llame a `loadAllAnnouncements()` lo resolvería sin necesidad de WebSockets.

### M2 · Filtro de búsqueda por texto en el tablón
Un `<input>` de búsqueda libre sobre `title` + `publicText` que filtre client-side sería muy útil cuando hay muchos anuncios.

### M3 · Paginación o carga perezosa de anuncios
`loadAllAnnouncements()` carga todos los anuncios de todos los tablones en paralelo al arrancar. Con campañas grandes esto puede ser lento. Cargar solo el tablón activo y los demás bajo demanda reduciría el tiempo de inicio.

### M4 · Indicador de "sin leer" en la navegación
Mostrar un punto rojo o un contador en el botón "Avisos" del nav cuando hay notificaciones sin leer, similar a como lo hace Discord.

### M5 · Exportar/respaldar la base de datos
Un botón en el perfil del admin que descargue el fichero `.sqlite` sería suficiente como copia de seguridad. El servidor solo tiene que servir el fichero estático con las cabeceras correctas.

### M6 · Historial de pull_records visible para el DM
Actualmente no hay forma de ver el historial completo de quién aceptó qué encargos en el pasado. Un endpoint `GET /api/campaigns/:id/history` con todos los pull_records (activos e inactivos) sería valioso para el DM.

### M7 · Ordenación de anuncios personalizable
Permitir ordenar el tablón por fecha de creación (más nuevo/más viejo primero), por estado, o por prioridad (campo que podría añadirse) daría más control al DM.

### M8 · Modo "ocultar resueltos" para el DM
Un toggle que oculte los anuncios completados/archivados del tablón sin necesidad de filtrar manualmente. El tablón quedaría más limpio en sesión.

---

## RESUMEN RÁPIDO

| Prioridad | Nº | Descripción |
|-----------|-----|-------------|
| 🔴 Crítico | B1-B10 | El rol admin está medio roto: no ve tablones, no ve personajes, no puede crear contenido, no ve campos privados |
| 🟠 Moderado | B11-B13 | Estado 'arrancado' manual inconsistente; notificaciones solo al DM original; sin validación de dmId |
| 🟡 UX | U1-U8 | Sin confirmación al quitar DM; no hay "marcar todo leído"; sin spinner de carga |
| 🟢 Mejora | M1-M8 | Polling, búsqueda, paginación, badge de avisos, backup, historial |

Los bugs críticos B1-B10 son todos correcciones de una línea (`'dm'` → `!== 'player'` o `|| 'admin'`). Se pueden resolver en una sola pasada de edición.
