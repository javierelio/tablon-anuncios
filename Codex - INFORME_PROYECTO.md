# Informe de traspaso del proyecto

## 1. Proposito del documento

Este documento resume el objetivo original, el estado actual y las decisiones tomadas durante el desarrollo de la aplicacion web **Tablon de Anuncios Westmarch**.

Esta pensado para que otra IA o desarrollador pueda continuar el proyecto sin necesitar el historial completo de conversacion.

## 2. Vision del proyecto

La aplicacion es un tablon de anuncios medieval para campanas de rol tipo westmarch.

El objetivo principal es permitir este flujo:

1. El Dungeon Master crea una campana.
2. El Dungeon Master crea tablones dentro de esa campana.
3. El Dungeon Master publica anuncios diegeticos como si los hubieran escrito PNJ del mundo.
4. Los jugadores entran con cuentas creadas por el DM.
5. El jugador ve solo las campanas a las que esta vinculado.
6. El jugador elige uno de sus personajes asignados por el DM.
7. El jugador lee un anuncio publico.
8. El jugador pulsa **Arrancar anuncio** con un personaje concreto.
9. El anuncio pasa a estado **arrancado**.
10. Se registra jugador, personaje y fecha.
11. El DM recibe una notificacion interna.
12. El DM puede ver quien lo arranco y puede revertir la accion.

La prioridad era construir primero un MVP funcional con datos persistentes, roles y permisos claros. No se han implementado aun funciones avanzadas como comentarios, calendario del mundo, reputacion de facciones, invitaciones por enlace, subida de imagenes, mapas o generador automatico de anuncios.

## 3. Estetica y experiencia visual

La direccion visual solicitada es fantasia grimdark:

- Madera envejecida.
- Pergaminos y papel usado.
- Clavos, lacres y metal oscuro.
- Iluminacion tenue.
- Colores terrosos, negros, grises, rojos apagados y dorados viejos.
- Sensacion inmersiva sin sacrificar legibilidad.

Se implemento una interfaz con:

- Fondo oscuro con textura sutil.
- Layout de aplicacion con barra superior, navegacion lateral, panel principal y panel derecho.
- Tablon central con apariencia de madera.
- Anuncios como pergaminos irregulares clavados con un icono de clavo.
- Estados visuales en los anuncios:
  - `disponible`: pergamino completo.
  - `arrancado`: pergamino rasgado / borde roto.
  - `completado`: sello de lacre.
  - `archivado`: aspecto apagado y envejecido.
- Detalle del anuncio en pergamino grande.
- Panel privado del DM separado visualmente.

Fuentes usadas en `public/styles.css`:

- `IM Fell English` para titulos.
- `MedievalSharp` para el aspecto manuscrito.
- Fallbacks serif si Google Fonts no carga.

Nota: se decidio evitar una apariencia de hoja de libreta moderna. Los carteles actuales usan degradados, manchas, bordes irregulares y textura de pergamino.

## 4. Stack tecnico actual

El proyecto es una aplicacion web local sin framework ni dependencias externas del repositorio.

Componentes:

- Servidor: Node.js con `http`, `fs`, `path`, `crypto`.
- Base de datos: SQLite mediante `node:sqlite`.
- Frontend: HTML, CSS y JavaScript vanilla.
- Persistencia: archivo SQLite local en `data/tablon.sqlite`.

Archivos principales:

- `server.js`: servidor HTTP, API, autenticacion, permisos, consultas y mutaciones SQLite.
- `schema.sql`: esquema base de datos.
- `public/index.html`: HTML base.
- `public/app.js`: aplicacion frontend completa.
- `public/styles.css`: estilos visuales grimdark/pergamino.
- `public/assets/nail.svg`: clavo de los anuncios.
- `public/assets/wax-seal.svg`: sello de lacre.
- `public/assets/board-mark.svg`: marca decorativa del tablon.
- `README.md`: instrucciones resumidas.
- `INFORME_PROYECTO.md`: este informe.

No hay `package.json` actualmente.

## 5. Arranque local

Comando esperado:

```bash
node server.js
```

URL:

```text
http://127.0.0.1:4173/
```

Tambien funciona normalmente:

```text
http://localhost:4173/
```

El puerto por defecto es `4173`.

Variables soportadas por el servidor:

- `PORT`: puerto alternativo.
- `HOST`: host alternativo. Por defecto `127.0.0.1`.

En algunas sesiones de Codex Desktop, `node` puede no estar en el `PATH`. En ese caso se puede usar el runtime incluido:

```bash
/Users/javierelio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

Si aparece un error parecido a `listen EPERM: operation not permitted 127.0.0.1:4173`, no es necesariamente un bug de la app. Suele ser el sandbox bloqueando que el proceso escuche en un puerto local. En Codex hay que ejecutar el servidor con permiso escalado.

## 6. Cuentas de prueba

La semilla inicial crea:

- DM: `dm` / `dm123`
- Jugador: `jugador` / `jugador123`

En la base de datos local revisada el 18 de junio de 2026 hay tambien un usuario:

- Jugador: `Elsa`

El DM crea o vincula jugadores desde la interfaz y despues les pasa la contrasena inicial por mensaje privado fuera de la app.

## 7. Estado actual de la base local

Lectura realizada sobre `data/tablon.sqlite`:

- `users`: 3
- `campaigns`: 1
- `campaign_players`: 2
- `boards`: 1
- `characters`: 3
- `announcements`: 2
- `pull_records`: 0
- `notifications`: 0

Datos locales actuales:

- Campana:
  - `Westmarch Dragon Muerto`
- Tablon:
  - `Tablon de Dragon Muerto`, tipo `autoridad local`
- Jugadores vinculados:
  - `jugador`, nombre visible `Elena de las Marismas`, notas DM: `Jugador de prueba restaurado.`
  - `Elsa`, nombre visible `Piratilla`, notas DM: `titotitotii`
- Personajes:
  - `Personaje de prueba`, jugador `Elsa`
  - `Bruna de la Turbera`, jugador `jugador`, humana rastreadora, notas DM restauradas.
  - `Odrik sin Campana`, jugador `jugador`, enano exsacristan, notas DM restauradas.
- Anuncios:
  - `Se busca cazador`, estado `disponible`
  - `Quita Maxin`, estado `disponible`

Importante: el esquema declarado actual ya no usa campos publicos separados de firma, lugar, recompensa visible ni peligro. Sin embargo, la base SQLite existente conserva columnas antiguas en `announcements`:

- `fictional_author`
- `related_place`
- `visible_reward`
- `danger_level`

Estas columnas antiguas no se usan desde `server.js` ni desde `public/app.js`. Conviene tenerlo en cuenta si se hace una migracion limpia futura.

## 8. Modelo de datos

El esquema principal esta en `schema.sql`.

### `users`

Usuarios de la app.

Campos principales:

- `id`
- `username`
- `display_name`
- `role`: `dm` o `player`
- `password_hash`
- `password_salt`
- `created_at`

Las contrasenas se guardan hasheadas con PBKDF2-SHA256 y salt.

### `sessions`

Sesiones de login por token.

Campos:

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `created_at`

El token real se entrega al frontend, pero en SQLite se guarda solo el hash SHA-256.

### `campaigns`

Campanas gestionadas por un DM.

Campos:

- `id`
- `dm_id`
- `name`
- `description`
- `created_at`
- `updated_at`

Una campana pertenece a un DM.

### `campaign_players`

Relacion entre campanas y jugadores autorizados.

Campos:

- `id`
- `campaign_id`
- `player_id`
- `status`: `active` o `removed`
- `dm_notes`
- `created_at`

Tiene restriccion unica `(campaign_id, player_id)`.

Actualmente, al eliminar un jugador de una campana se borra la fila de relacion y sus personajes de esa campana. No se borra la cuenta global de `users`.

### `boards`

Tablones dentro de una campana.

Campos:

- `id`
- `campaign_id`
- `name`
- `description`
- `type`
- `created_at`
- `updated_at`

Tipos previstos:

- `faccion`
- `poblacion`
- `region`
- `gremio`
- `rumor`
- `taberna`
- `autoridad local`
- `otro`

En el codigo algunos tipos usan acentos en espanol.

### `characters`

Personajes de jugadores dentro de campanas.

Campos:

- `id`
- `user_id`
- `campaign_id`
- `name`
- `ancestry`
- `archetype`
- `notes`
- `dm_notes`
- `created_at`
- `updated_at`

Decision importante: los personajes ya no los crea el jugador. Los crea y gestiona el DM dentro de cada jugador.

Cada personaje pertenece a:

- Un usuario jugador.
- Una campana concreta.

Solo el DM ve `dm_notes`.

### `announcements`

Anuncios publicados en tablones.

Campos publicos actuales:

- `id`
- `campaign_id`
- `board_id`
- `created_by`
- `title`
- `public_text`
- `tags`
- `status`
- `world_date`
- `hidden_from_players`
- `created_at`
- `updated_at`

Campos privados del DM:

- `real_summary`
- `narrative_hook`
- `secret_information`
- `involved_npcs`
- `relevant_locations`
- `possible_complications`
- `real_reward`
- `ignored_consequences`
- `dm_notes`
- `prep_state`

Estados del anuncio:

- `disponible`
- `arrancado`
- `completado`
- `archivado`

Estados internos de preparacion:

- `idea`
- `preparada`
- `en_juego`
- `resuelta`
- `descartada`

Campos eliminados del modelo funcional:

- Firma / autor ficticio separado.
- Lugar separado.
- Recompensa visible separada.
- Nivel de peligro.
- Etiqueta o filtro de peligro.

La decision actual es que firma, lugar, recompensa y peligro se escriban dentro del texto diegetico si hacen falta.

### `pull_records`

Registro de la accion de arrancar un anuncio.

Campos:

- `id`
- `announcement_id`
- `campaign_id`
- `board_id`
- `player_id`
- `character_id`
- `pulled_at`
- `active`
- `reverted_at`
- `reverted_by`

Existe un indice unico parcial:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_pull_per_announcement
ON pull_records(announcement_id)
WHERE active = 1;
```

Esto impide que un mismo anuncio tenga mas de un arrancado activo.

### `notifications`

Avisos internos del DM.

Campos:

- `id`
- `user_id`
- `campaign_id`
- `announcement_id`
- `pull_record_id`
- `type`
- `message`
- `read_at`
- `created_at`

Actualmente se usan para notificar al DM cuando un jugador arranca un anuncio.

## 9. Roles y permisos

### Dungeon Master

Puede:

- Crear, editar y eliminar campanas propias.
- Crear, editar y eliminar tablones dentro de sus campanas.
- Crear, editar, eliminar, archivar y cambiar estado de anuncios.
- Ver todos los campos publicos y privados de anuncios.
- Crear o vincular jugadores a campanas.
- Guardar notas privadas sobre jugadores.
- Eliminar jugadores de una campana.
- Crear, editar y eliminar personajes para jugadores.
- Asignar personajes a campanas.
- Guardar notas privadas sobre personajes.
- Ver notificaciones internas.
- Marcar notificaciones como leidas.
- Revertir un anuncio arrancado.

### Jugador

Puede:

- Iniciar sesion si el DM le creo una cuenta.
- Ver solo campanas a las que esta vinculado.
- Ver solo tablones de esas campanas.
- Ver solo anuncios no archivados y no ocultos.
- Ver solo campos publicos de anuncios.
- Ver sus propios personajes asignados por el DM.
- Elegir personaje activo.
- Arrancar un anuncio disponible usando uno de sus personajes propios de esa campana.
- Ver sus anuncios arrancados.

No puede:

- Registrarse por su cuenta.
- Crear personajes.
- Editar o eliminar personajes.
- Crear, editar o eliminar campanas, tablones o anuncios.
- Ver notas privadas del DM.
- Ver anuncios archivados u ocultos.
- Arrancar anuncios con personajes de otra cuenta o de otra campana.

## 10. API actual

Todas las rutas de API estan en `server.js`.

La autenticacion usa cabecera:

```http
Authorization: Bearer <token>
```

### Autenticacion

- `POST /api/login`
  - Body: `username`, `password`
  - Devuelve: `token`, `user`
- `POST /api/register`
  - Actualmente bloqueado con `403`.
  - Mensaje: el registro de jugadores lo gestiona el DM.
- `GET /api/me`
  - Devuelve el usuario autenticado.
- `POST /api/logout`
  - Borra la sesion actual.

### Campanas

- `GET /api/campaigns`
  - DM: campanas donde `dm_id = user.id`.
  - Jugador: campanas donde aparece en `campaign_players` con `status = active`.
- `POST /api/campaigns`
  - Solo DM.
  - Crea campana.
- `GET /api/campaigns/:id`
  - DM propietario o jugador vinculado.
- `PUT /api/campaigns/:id`
  - Solo DM propietario.
- `DELETE /api/campaigns/:id`
  - Solo DM propietario.

### Tablones

- `GET /api/campaigns/:id/boards`
  - DM propietario o jugador vinculado.
- `POST /api/campaigns/:id/boards`
  - Solo DM.
- `PUT /api/boards/:id`
  - Solo DM.
- `DELETE /api/boards/:id`
  - Solo DM.

### Anuncios

- `GET /api/boards/:id/announcements`
  - DM: todos los anuncios del tablon.
  - Jugador: solo `status != archivado` y `hidden_from_players = 0`.
- `POST /api/boards/:id/announcements`
  - Solo DM.
- `GET /api/announcements/:id`
  - DM: incluye `private`.
  - Jugador: no incluye `private` y falla si esta archivado u oculto.
- `PUT /api/announcements/:id`
  - Solo DM.
- `DELETE /api/announcements/:id`
  - Solo DM.
- `POST /api/announcements/:id/status`
  - Solo DM.
  - Cambia estado a `disponible`, `arrancado`, `completado` o `archivado`.
- `POST /api/announcements/:id/pull`
  - Solo jugador.
  - Requiere `characterId`.
  - Valida que el personaje pertenezca al jugador y campana.
  - Crea `pull_records`.
  - Cambia anuncio a `arrancado`.
  - Crea notificacion para el DM.
- `POST /api/announcements/:id/revert`
  - Solo DM.
  - Desactiva el `pull_record`.
  - Devuelve el anuncio a `disponible`.

### Personajes

- `GET /api/campaigns/:id/characters`
  - DM: todos los personajes de la campana, con `dmNotes`.
  - Jugador: solo sus personajes, sin `dmNotes`.
- `POST /api/campaigns/:id/characters`
  - Solo DM.
  - Requiere `name` y `playerUsername`.
  - Puede recibir `campaignId` para asignar a una campana concreta.
- `PUT /api/characters/:id`
  - Solo DM.
  - Permite cambiar propietario via `playerUsername`.
  - Permite cambiar campana via `campaignId`.
  - Si el personaje tenia anuncios arrancados activos y cambia de usuario o campana, se revierten esos arrancados.
- `DELETE /api/characters/:id`
  - Solo DM.
  - Si el personaje tenia anuncios arrancados activos, se revierten antes de borrar.

### Jugadores

- `GET /api/campaigns/:id/players`
  - Solo DM.
  - Lista jugadores vinculados a la campana con notas privadas DM.
- `POST /api/campaigns/:id/players`
  - Solo DM.
  - Crea o vincula jugador.
  - Si el `username` ya existe como jugador, se vincula aunque se haya escrito contrasena.
  - Si no existe, se requiere `displayName` y `password`.
  - La contrasena inicial debe tener al menos 6 caracteres.
- `DELETE /api/campaigns/:campaignId/players/:playerId`
  - Solo DM.
  - Elimina el vinculo con la campana.
  - Borra los personajes de ese jugador en esa campana.
  - Revierte arrancados activos asociados.
  - No borra la cuenta global en `users`.

### Notificaciones

- `GET /api/notifications`
  - Solo DM.
  - Devuelve hasta 100 notificaciones recientes.
- `POST /api/notifications/:id/read`
  - Solo DM.
  - Marca una notificacion como leida.

## 11. Frontend actual

El frontend esta en `public/app.js`.

### Estado global

El objeto `state` guarda:

- Token.
- Usuario.
- Vista activa.
- Campanas.
- Tablones.
- Anuncios por tablon.
- Todos los anuncios de la campana.
- Personajes.
- Jugadores.
- Notificaciones.
- Campana seleccionada.
- Tablon seleccionado.
- Personajes activos por campana.
- Filtros.
- Modal activo.
- Toast activo.

Persistencia en `localStorage`:

- `tablon.token`
- `tablon.campaign`
- `tablon.board`
- `tablon.activeCharacters`

### Vistas para DM

Navegacion:

- Dashboard
- Campanas
- Campana
- Tablones
- Jugadores
- Avisos

Pantallas implementadas:

- Login.
- Dashboard del DM.
- Vista de campanas.
- Vista de una campana.
- Vista de tablones.
- Vista de tablon con anuncios.
- Detalle de anuncio con panel privado.
- Formulario de campana.
- Formulario de tablon.
- Formulario de anuncio.
- Gestion de jugadores.
- Creacion/vinculacion de jugador.
- Creacion/edicion/eliminacion de personajes dentro de jugadores.
- Panel de notificaciones.

### Vistas para jugador

Navegacion:

- Dashboard
- Campanas
- Tablones
- Personajes
- Mis encargos

Pantallas implementadas:

- Login.
- Dashboard del jugador.
- Campanas autorizadas.
- Tablones disponibles.
- Anuncios visibles.
- Selector de personaje activo.
- Detalle de anuncio publico.
- Accion **Arrancar anuncio**.
- Lista de anuncios arrancados por sus personajes.
- Vista de personajes asignados por el DM.

### Formularios actuales

Campana:

- Nombre.
- Descripcion.

Tablon:

- Nombre.
- Tipo.
- Descripcion.

Anuncio:

- Titulo visible.
- Estado.
- Texto diegetico.
- Etiquetas.
- Fecha dentro del mundo.
- Checkbox `Oculto para jugadores`.
- Estado interno.
- Recompensa real.
- Resumen real.
- Gancho narrativo.
- Informacion secreta.
- PNJ implicados.
- Localizaciones relevantes.
- Posibles complicaciones.
- Consecuencias si se ignora.
- Notas privadas del DM.

Jugador:

- Nombre de usuario.
- Nombre visible.
- Contrasena inicial.
- Notas privadas del DM.

Personaje:

- Campana.
- Username del jugador propietario.
- Nombre.
- Linaje.
- Arquetipo.
- Notas visibles para jugador.
- Notas privadas del DM.

## 12. Cambios realizados durante la conversacion

### MVP inicial

Se construyo una aplicacion local con:

- Login.
- Roles DM y jugador.
- Campanas.
- Tablones.
- Anuncios.
- Campos publicos y privados para el DM.
- Personajes.
- Accion de arrancar anuncio.
- Notificaciones internas al DM.
- Datos persistentes en SQLite.

### Cambio de responsabilidad sobre personajes

Solicitud del usuario:

> Deberia ser el DM quien pueda crear y eliminar personajes, y pasarle el password por DM al jugador.

Resultado:

- El registro publico de jugadores queda bloqueado.
- El DM crea/vincula jugadores.
- El DM crea, edita y elimina personajes.
- Los jugadores solo ven sus personajes asignados.
- El mensaje de login explica que el DM pasa la contrasena inicial.

### Peligro opcional y campos vacios

Solicitud:

> El nivel de peligro debe ser opcional. Los campos que no se hayan completado, no deben ser visibles para los jugadores.

Resultado:

- El detalle publico solo muestra lineas opcionales si tienen valor para jugadores.
- Posteriormente el nivel de peligro se elimino por completo.

### Carteles mas medievales

Solicitud:

> El diseno del cartel que tenga un aspecto mas medieval, como un pergamino. Ahora parece una hoja de una libreta Moleskine.

Resultado:

- `notice-card` y `parchment-detail` fueron redisenados como pergaminos.
- Bordes irregulares con `clip-path`.
- Gradientes de manchas y envejecido.
- Clavo superior.
- Estados visuales mas fuertes.

### Eliminacion de firma, lugar y recompensa publica

Solicitud:

> Elimina los campos de firma, lugar, y recompensa. Ya lo incluire en el texto si es necesario.

Resultado:

- Se eliminaron del formulario y DTO funcional.
- Ya no se usan en API ni UI.
- La decision es escribir esos datos en `public_text` cuando proceda.

### Tipografia manuscrita medieval

Solicitud:

> Busca un tipo de letra que sea legible pero a la vez que tenga un aspecto de manuscrito medieval.

Resultado:

- Se incorporaron `IM Fell English` y `MedievalSharp`.
- Los pergaminos usan una fuente con aspecto manuscrito pero legible.

### Eliminacion de etiqueta/filtro de peligro

Solicitud:

> Elimina tambien la etiqueta de peligro.

Resultado:

- Se elimino el campo `danger_level` del esquema nuevo.
- Se elimino del formulario, filtros, DTO y render.
- La base local antigua aun conserva columna `danger_level`, pero no se usa.

### Creacion manual de jugador por username

Solicitud:

> A la hora de crear un personaje, dejame introducir manualmente el nombre del jugador, que sera el username.

Resultado:

- El formulario de personaje pide `Jugador propietario`.
- Se introduce manualmente el `username`.
- El servidor valida que el username pertenezca a un jugador vinculado a la campana.

### Creador de jugadores con multiples personajes

Solicitud:

> El creador de personajes deberia ser un creador de jugadores (users). Dentro de cada jugador deberia haber la opcion de incluir varios personajes.

Resultado:

- La vista DM `Personajes` paso a ser `Jugadores`.
- Cada jugador aparece como tarjeta.
- Dentro de cada jugador se listan sus personajes.
- Boton `Anadir personaje` dentro de cada jugador.

### Eliminacion de jugadores

Solicitud:

> Deberia poder eliminar a jugadores.

Resultado:

- Se anadio boton `Eliminar jugador`.
- El servidor desvincula al jugador de la campana.
- Borra sus personajes de esa campana.
- Revierte anuncios arrancados activos asociados.
- No borra el usuario global de la tabla `users`.

### Bug de creacion de jugadores y notas privadas

Solicitud:

> Revisa un bug: no me deja crear jugadores porque me dice que ya existe. Dame tambien un campo de notas que solo vea el DM.

Resultado:

- `createOrLinkPlayer` se ajusto para vincular usuarios existentes en vez de fallar.
- Si el username existe, se vincula a la campana.
- La contrasena solo se usa si el usuario no existe.
- Se anadio `dm_notes` a `campaign_players`.
- Se anadio `dm_notes` a `characters`.
- Solo el DM recibe esos campos.

### Asignacion de personajes a campanas

Solicitud:

> Tendria que poder asignar a los personajes a campanas.

Resultado:

- El formulario de personaje incluye selector de campana.
- `createCharacter` acepta `campaignId`.
- `updateCharacter` permite mover personaje entre campanas.
- Se valida que el jugador propietario este vinculado a la campana elegida.
- Si moverlo deja arrancados activos incoherentes, se revierten.

### Restauracion de jugador de prueba

Solicitud:

> Por error me he cargado el jugador de prueba que habias creado. Vuelvelo a crear. Revisa la creacion de jugadores y personajes porque no funciona.

Resultado:

- Se restauro `jugador` / `jugador123`.
- Se restauraron personajes de ejemplo:
  - `Bruna de la Turbera`
  - `Odrik sin Campana`
- Se verifico la vista de gestion de jugadores.

### Problemas recurrentes de preview

Varias veces el usuario pidio volver a levantar el servidor.

Observaciones:

- El servidor local se cae o queda parado entre sesiones.
- Si el navegador integrado muestra una pagina de error interna (`ERR_CONNECTION_REFUSED`), a veces recargar esa misma pestana falla porque queda en una URL `data:` de error.
- Solucion practica: levantar `server.js` y abrir una pestana nueva a `http://127.0.0.1:4173/`.
- En sandbox puede requerir permiso para escuchar en `127.0.0.1:4173`.

## 13. Decisiones funcionales importantes

### Los jugadores no se registran solos

Se bloqueo `POST /api/register`.

Motivo:

- El usuario decidio que el DM crea jugadores y pasa contrasenas por mensaje privado.

### Los personajes son gestionados por el DM

Motivo:

- El DM controla que personajes existen en cada campana.
- Evita que jugadores creen personajes no autorizados.

### Firma, lugar, recompensa y peligro van dentro del texto diegetico

Motivo:

- La app no debe forzar campos publicos que el DM puede querer escribir de forma narrativa.
- Se simplifica la ficha visible para jugadores.
- Los campos vacios no deben ensuciar el anuncio.

### Las notas privadas nunca se envian a jugadores

Implementacion:

- `announcementDto(row, user, includePrivate)` solo anade `private` si `includePrivate` es verdadero y `user.role === 'dm'`.
- `characterDto(row, includePrivate)` solo anade `dmNotes` si se pide desde contexto DM.
- Los players no tienen endpoint para listar jugadores de una campana.

## 14. Seguridad actual y limitaciones

Lo que ya existe:

- Contrasenas hasheadas con PBKDF2-SHA256.
- Sesiones por token aleatorio.
- Token guardado hasheado en SQLite.
- Expiracion de sesion a 7 dias.
- Validacion de rol en servidor.
- Validacion de acceso a campanas por DM propietario o jugador vinculado.
- Filtrado de campos privados en DTOs.
- Prevencion de doble arrancado activo por indice unico parcial.

Limitaciones:

- No hay HTTPS porque es app local.
- No hay CSRF, aunque se usa Bearer token desde frontend local.
- No hay gestion de recuperacion de contrasenas.
- No hay cambio de contrasena desde UI.
- No hay roles multiples por campana.
- No hay tests automatizados.
- No hay migrador versionado. Solo `schema.sql` y `ensureColumn` para dos columnas nuevas.
- `node:sqlite` sigue mostrando aviso experimental en algunas versiones de Node.
- La base local puede conservar columnas antiguas no usadas.

## 15. Puntos conocidos a vigilar

### `renderRegisterForm` sigue existiendo aunque el registro este bloqueado

En `public/app.js` aun existe la funcion `renderRegisterForm`, pero `renderAuth` solo muestra `renderLoginForm`.

No causa problema. Si se quiere limpiar, puede eliminarse la funcion y el manejo `formName === 'register'`, ya que `POST /api/register` esta bloqueado.

### Etiquetas antiguas de peligro en `labels`

El objeto `labels` aun contiene:

- `bajo`
- `moderado`
- `alto`
- `mortal`

No se usan actualmente tras eliminar peligro. Se pueden limpiar en una futura pasada.

### Base local con columnas legacy

La DB existente conserva:

- `fictional_author`
- `related_place`
- `visible_reward`
- `danger_level`

El codigo ya no las usa. Si otra IA hace cambios de esquema, debe evitar reintroducir esos campos salvo que el usuario lo pida.

### Eliminacion de jugador no borra cuenta global

Esto es intencional por ahora. La accion elimina al jugador de la campana, borra sus personajes de esa campana y revierte sus arrancados activos. El usuario global queda en `users`.

Si el usuario pide "borrar completamente un jugador", habria que crear una accion distinta y pensar consecuencias sobre otras campanas.

### Cambio manual de estado a `arrancado`

El DM puede poner un anuncio en `arrancado` desde el selector de estado o botones, pero eso no crea necesariamente un `pull_record`.

El flujo correcto con registro es que un jugador use **Arrancar anuncio**. Si se quiere robustez, podria impedirse poner `arrancado` manualmente o pedir personaje/jugador al DM.

### Servidor local recurrentemente apagado

El usuario suele pedir "vuelve a levantarlo".

Accion practica:

1. Comprobar si escucha el puerto `4173`.
2. Si no, ejecutar `node server.js` o el Node incluido.
3. Si aparece `EPERM`, pedir permiso escalado.
4. Verificar `HTTP/1.1 200 OK`.
5. Si el navegador integrado sigue en error, abrir una pestana nueva a `http://127.0.0.1:4173/`.

## 16. Mejoras futuras propuestas

Prioridad alta:

- Crear tests basicos de API para login, permisos, crear jugador, crear personaje, arrancar anuncio y notificacion.
- Anadir migraciones versionadas para limpiar columnas antiguas y evolucionar SQLite sin depender de `ensureColumn`.
- Crear accion de cambio de contrasena para jugadores gestionada por DM.
- Mejorar gestion de "eliminar jugador" distinguiendo desvincular de borrar cuenta global.
- Validar estados para evitar `arrancado` sin `pull_record`.
- Mejorar feedback al DM cuando vincula un usuario existente.

Prioridad media:

- Historial de misiones completadas.
- Comentarios o coordinacion entre jugadores sobre un anuncio.
- Invitaciones por enlace.
- Calendario del mundo.
- Reputacion con facciones.
- Filtros avanzados por multiples etiquetas.
- Ordenacion por fecha de publicacion del mundo o fecha real.
- Vista de archivo.

Prioridad baja / futura:

- Subida de imagenes o mapas.
- Generador automatico de anuncios.
- Exportar campana o anuncios a Markdown/PDF.
- Temas visuales por campana, faccion o region.

## 17. Recomendaciones para otra IA que continue

Antes de tocar codigo:

1. Leer `README.md`.
2. Leer este informe.
3. Leer `schema.sql`.
4. Revisar `server.js` alrededor de permisos y DTOs antes de modificar campos privados.
5. Revisar `public/app.js` alrededor de formularios y render de detalle.
6. No reintroducir firma, lugar, recompensa visible ni peligro salvo nueva peticion expresa.
7. Mantener la regla: el DM crea jugadores y personajes.
8. Mantener la regla: los jugadores no ven notas privadas.

Cuando se cambie un campo:

1. Actualizar `schema.sql`.
2. Si afecta a bases ya creadas, anadir migracion o `ensureColumn`.
3. Actualizar DTOs en `server.js`.
4. Actualizar formularios en `public/app.js`.
5. Actualizar render publico y privado.
6. Probar como DM.
7. Probar como jugador.

Cuando se cambie permisos:

1. Hacer la validacion en servidor, no solo en frontend.
2. Verificar que `getCampaignForUser`, `getBoardForUser` y `getAnnouncementForUser` siguen protegiendo acceso.
3. Confirmar que DTOs no filtran datos privados por error.

Cuando se cambie el flujo de arrancar anuncio:

1. Revisar `pullAnnouncement`.
2. Revisar `revertPull`.
3. Revisar indice `idx_active_pull_per_announcement`.
4. Revisar notificaciones.
5. Revisar estados visuales en `styles.css`.

## 18. Checklist de verificacion manual recomendada

Como DM:

1. Entrar con `dm` / `dm123`.
2. Crear o abrir campana.
3. Crear tablon.
4. Crear jugador nuevo con username y contrasena.
5. Anadir notas DM al jugador.
6. Crear personaje dentro de ese jugador.
7. Anadir notas visibles y notas privadas DM al personaje.
8. Crear anuncio con texto publico y campos privados.
9. Confirmar que el anuncio aparece en el tablon.
10. Confirmar que el detalle muestra panel privado.

Como jugador:

1. Entrar con el usuario creado.
2. Confirmar que solo ve campanas vinculadas.
3. Confirmar que ve su personaje asignado.
4. Abrir tablon.
5. Abrir anuncio.
6. Confirmar que no ve campos privados.
7. Arrancar anuncio con personaje.
8. Confirmar estado `arrancado`.

De nuevo como DM:

1. Ver notificacion nueva.
2. Abrir anuncio.
3. Ver jugador/personaje que arranco.
4. Revertir arrancado.
5. Confirmar que vuelve a `disponible`.

## 19. Resumen ejecutivo

El MVP esta construido y cubre el flujo central:

DM publica anuncio -> jugador lo lee -> jugador lo arranca con personaje -> DM recibe aviso -> DM puede revisar y revertir.

La app ya tiene persistencia SQLite, login, roles, permisos, campanas, tablones, anuncios, jugadores gestionados por DM, personajes asignados a campanas, notas privadas y estetica grimdark de pergamino.

Lo mas importante para continuar es no romper la separacion entre informacion publica y privada, no devolver notas del DM a jugadores, y recordar que los jugadores no crean ni cuentas ni personajes por si mismos.
