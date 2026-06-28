# Documento de Traspaso del Proyecto

> Guía completa para continuar el desarrollo en otra cuenta de Lovable (o en local con tu propio backend).

---

## 1. Resumen del proyecto

App web para gestionar **partidas de rol** con dos espacios principales:

- **Tablones (boards)**: espacios compartidos donde los jugadores ven crónicas, personajes y notas a los que su personaje tiene acceso.
- **Panel de DM (Dungeon Master)**: gestión de crónicas, jugadores, personajes y permisos de acceso por tablón.

Autenticación por email/contraseña (Supabase Auth), con sesión persistida en `localStorage`. Hay roles `dm` y `player` (gestionados por una tabla `user_roles` separada, con función `has_role` SECURITY DEFINER).

---

## 2. Stack técnico

- **Framework**: TanStack Start v1 (React 19 + Vite 7, SSR habilitado salvo en `_authenticated`).
- **Estilos**: Tailwind CSS v4 + shadcn/ui (en `src/components/ui/*`).
- **Routing**: file-based en `src/routes/` (no editar `src/routeTree.gen.ts`, se genera).
- **Backend**: Supabase (Lovable Cloud) → Postgres + Auth + RLS.
- **Server logic**: `createServerFn` de `@tanstack/react-start` (NO usar Edge Functions para lógica interna). Middleware `requireSupabaseAuth` para fns que requieren usuario autenticado.
- **Estado servidor**: TanStack Query.
- **Gestor de paquetes**: `bun`.

---

## 3. Estructura de carpetas relevante

```
src/
├── routes/
│   ├── __root.tsx          # Layout raíz, head, providers, onAuthStateChange
│   ├── index.tsx           # Redirige a /boards o /login según sesión (client-side)
│   ├── login.tsx           # Login / signup (email+password)
│   ├── boards.tsx          # Lista de tablones accesibles para el usuario
│   └── dm.tsx              # Panel DM (821 líneas, gestiona todo: crónicas, jugadores, personajes, accesos)
├── lib/
│   ├── boards.functions.ts     # listAccessibleBoards (requireSupabaseAuth)
│   ├── dm.functions.ts         # Server fns del jugador (listMyCharacters, etc.)
│   ├── dm-admin.functions.ts   # Server fns del DM (CRUD crónicas/jugadores/personajes/accesos)
│   ├── config.server.ts        # Helpers server-only
│   └── api/example.functions.ts
├── integrations/supabase/      # AUTO-GENERADO, no editar
│   ├── client.ts               # Cliente browser (publishable key)
│   ├── client.server.ts        # Admin client (service role) — sólo dentro de handlers
│   ├── auth-middleware.ts      # requireSupabaseAuth
│   ├── auth-attacher.ts        # attachSupabaseAuth (bearer token)
│   └── types.ts
├── components/ui/              # shadcn (no tocar salvo extender)
├── router.tsx                  # QueryClient + router setup
├── start.ts                    # Registra functionMiddleware: [attachSupabaseAuth]
├── server.ts                   # Entry SSR
└── styles.css                  # Tokens de diseño Tailwind v4
supabase/
└── migrations/                 # 3 migraciones acumuladas (schema + RLS + grants)
```

---

## 4. Modelo de datos (Postgres / Supabase)

Tablas en `public` (todas con RLS habilitada y GRANTs explícitos):

- `profiles` (id, display_name, …) — FK a `auth.users`, autocreado por trigger.
- `user_roles` (user_id, role enum `app_role`: `dm` | `player`) — **roles SIEMPRE aquí, nunca en profiles**.
- `chronicles` (id, dm_id, name, description, …) — crónicas del DM.
- `boards` (id, chronicle_id, name, …) — tablones por crónica.
- `characters` (id, player_id, chronicle_id, name, sheet_json, …).
- `character_board_access` (character_id, board_id) — qué personaje ve qué tablón.

**Funciones SECURITY DEFINER** (evitan recursión RLS):
- `public.has_role(_user_id uuid, _role app_role) → boolean`
- `public.user_has_board_access(_user_id uuid, _board_id uuid) → boolean`

Las migraciones completas están en `supabase/migrations/` dentro del ZIP.

---

## 5. Variables de entorno

**Cliente (públicas, ya en `.env` autogenerado):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

**Servidor (en secrets de Supabase / Lovable Cloud):**
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (sólo dentro de handlers; nunca expuesto al cliente)
- `SUPABASE_DB_URL`
- `LOVABLE_API_KEY` (si se usa Lovable AI Gateway)

> En Lovable Cloud el service role key no es accesible manualmente; se inyecta automáticamente. En otra cuenta, recrear el proyecto Supabase y reconectar.

---

## 6. Flujos clave

### 6.1. Autenticación
- `src/routes/login.tsx`: signup/login email+password vía `supabase.auth.signInWithPassword` / `signUp`.
- `src/routes/__root.tsx`: registra UN ÚNICO `onAuthStateChange` global, filtra a `SIGNED_IN | SIGNED_OUT | USER_UPDATED`, llama a `router.invalidate()` y selectivamente `queryClient.invalidateQueries()`.
- `src/routes/index.tsx`: redirección **client-side** (`useEffect` + `useNavigate`) a `/boards` o `/login`. NO usar `beforeLoad` con redirect porque rompe SSR/prerender.

### 6.2. Patrón de queries protegidas
En componentes públicos que consumen server fns con `requireSupabaseAuth`, gatear con sesión presente:

```ts
const [hasSession, setHasSession] = useState(false);
useEffect(() => {
  supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
  const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setHasSession(!!s));
  return () => sub.subscription.unsubscribe();
}, []);

useQuery({ queryKey: ["x"], queryFn: fetch, enabled: hasSession });
```
Esto evita el error `Unauthorized: No authorization header provided` en mount/logout.

### 6.3. Server functions
Todas las llamadas a DB pasan por `createServerFn` en `src/lib/*.functions.ts`. Las que requieren usuario usan `.middleware([requireSupabaseAuth])` y leen `context.supabase`, `context.userId`.

`src/start.ts` debe mantener `attachSupabaseAuth` en `functionMiddleware` (lo añade automáticamente la integración).

---

## 7. Histórico de bugs resueltos (contexto)

1. **"Credenciales erróneas" al login** → ajuste en `src/routes/login.tsx` y regeneración de `routeTree.gen.ts`.
2. **Internal server error al entrar** → revisado `__root.tsx` y `boards.tsx`; refactor del listener auth.
3. **Falta navegación entre crónicas y tablones / botón "editar jugador" abría editar crónica** → fix en `src/routes/dm.tsx` (handlers cruzados).
4. **`Unauthorized: No authorization header provided`** en `listAccessibleBoards` → añadido gating `enabled: hasSession` en `src/routes/boards.tsx`.
5. **Preview en blanco / Internal Server Error en `/`** → reemplazo de `beforeLoad` redirect por componente `IndexRedirect` client-side en `src/routes/index.tsx`.

---

## 8. Cómo continuar el desarrollo en otra cuenta

### Opción A: Remix dentro de Lovable
1. En la cuenta origen, activar **Public remixing** (Project Settings → General).
2. En la cuenta destino, abrir la URL del proyecto y pulsar **Remix**.
3. Activar Lovable Cloud en el nuevo proyecto — generará un nuevo Supabase con esquema vacío.
4. Aplicar las migraciones del ZIP (`supabase/migrations/*.sql`) en orden cronológico desde el chat ("aplica estas migraciones").
5. Reconfigurar Auth: deshabilitar "Confirm email" si se quiere login inmediato en pruebas.

### Opción B: Repo Git + Lovable nuevo
1. Conectar GitHub al proyecto origen y empujar a un repo.
2. En la cuenta destino, crear proyecto nuevo desde el repo GitHub.
3. Aplicar migraciones igual que en A.

### Opción C: Local (sin Lovable)
1. Descomprimir `proyecto-codigo-fuente.zip`.
2. `bun install`
3. Crear proyecto Supabase nuevo y aplicar migraciones (`supabase db push` o pegar SQL).
4. Crear `.env` con las VITE_* y SUPABASE_* del nuevo proyecto.
5. `bun run dev` → http://localhost:8080

---

## 9. Convenciones a respetar

- **Nunca** almacenar roles en `profiles`. Siempre en `user_roles` + `has_role()`.
- **Nunca** editar `src/integrations/supabase/*`, `src/routeTree.gen.ts`, `.env` ni `supabase/config.toml` (autogenerados).
- Toda nueva tabla en `public` requiere `GRANT` + `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` en la misma migración.
- Lógica de servidor → `createServerFn`, NO edge functions (salvo webhooks).
- Rutas protegidas → subcarpeta `src/routes/_authenticated/` (gate gestionado por la integración con `ssr: false`).
- Tokens de color/tipografía SOLO via `src/styles.css` y variantes shadcn — nada de `bg-white`/`text-black` hardcoded.

---

## 10. Adjuntos

- `proyecto-codigo-fuente.zip` — código fuente completo (src/, supabase/, configs). Sin `node_modules` ni `routeTree.gen.ts`.

---

¡Suerte con el traspaso!
