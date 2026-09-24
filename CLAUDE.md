# Plan: Simplified Per-User Module Access Editor

## Context

The current per-user module permission system is over-engineered for what the user actually needs:
- Complex `{ view, create, update, delete, export, print }` per module
- Role default indicators, per-action checkboxes, reset logic
- Many UX bugs from stale state / spread-merge issues
- The user explicitly wants to remove "default" indicators

The user wants a **simple module-level toggle**: assign modules a user can access, and the role determines what actions they can do within those modules. No per-action control needed.

---

## New Design

### Data Model

**New stored value:** `PerUserModulePermissions = Partial<Record<AppModule, true>>` — a dict of module names where the value is always `true`. `true` = "this module is explicitly assigned". Absent = no explicit assignment (fall back to role defaults).

The stored value in `extra_data` looks like:
```json
{ "profile": true, "orders": true, "vehicles": true }
```

The permission check is simply: `if (assignedModules?.[module]) return true` — any truthy entry grants full access to the module.

The `types.ts` `ModulePermissions` type is no longer used for overrides (server normalizes any partial objects to `true` on write).

### Permission Resolution

**`hasPermission`** — `toModulePermissions` returns a dict of assigned modules. If module key exists (truthy) → grant all actions. Otherwise → role matrix.

```typescript
export function hasPermission(subject: PermissionSubject, module: AppModule, action: keyof ModulePermissions): boolean {
    const assigned = toModulePermissions(subject);
    if (assigned?.[normalizeAppModule(module)]) return true;
    return hasRolePermission(subject, module, action);
}
```

**`hasPageAccess`** — unchanged (delegates to `hasPermission`).

### Starter Modules

When opening the editor for a **new user** (create flow), `profile` is auto-assigned by default so every user can access Akun Saya.

When opening the editor for an **existing user with no overrides**, `profile` is auto-assigned by default. The OWNER explicitly assigns additional modules.

The checkbox for a module that the user's role already grants access to is **pre-checked and read-only** (grayed) — the OWNER cannot hide a module that the role grants. Only modules NOT in the role matrix can be assigned/removed.

### Key UX Behavior

| Module | Role grants access? | Checkbox state | OWNER can hide? |
|---|---|---|---|
| Orders | Yes (OPERASIONAL) | Pre-checked, disabled | No — role grants it |
| Kenderaan | No (FINANCE) | Unchecked, editable | Yes — explicitly assign |
| Akun Saya | Yes (all roles) | Pre-checked, disabled | No — role grants it |

---

## Files to Modify

### 1. `src/lib/rbac.ts`

**`toModulePermissions`** — unchanged (already returns `undefined` for empty objects).

**`hasPermission`** — simplify: if module key exists in override dict → grant all actions. Otherwise fall back to role matrix.

**`getModulePermissions`** — for assigned modules returns `{ view: true, create: true, update: true, delete: true, export: true, print: true }`. For unassigned modules, role defaults.

**`hasPageAccess`** — unchanged (delegates to `hasPermission`).

### 2. `src/lib/api/support-workflows.ts`

Normalize incoming `modulePermissions` on user update — upgrade any module entry to `true`:
```typescript
if (Object.prototype.hasOwnProperty.call(nextUpdates, 'modulePermissions')) {
    if (nextUpdates.modulePermissions === null || typeof nextUpdates.modulePermissions !== 'object' || Array.isArray(nextUpdates.modulePermissions)) {
        delete nextUpdates.modulePermissions;
    } else {
        for (const [mod, val] of Object.entries(nextUpdates.modulePermissions)) {
            // Any truthy value (including existing ModulePermissions object) becomes true
            nextUpdates.modulePermissions[mod] = true as any;
        }
        if (Object.keys(nextUpdates.modulePermissions).length === 0) {
            delete nextUpdates.modulePermissions;
        }
    }
}
```

### 3. `src/app/(admin)/_components/ModulePermissionsEditor.tsx` — complete rewrite

**Props:** `role: InternalUserRole`, `assigned: AppModule[]`, `onChange: (assigned: AppModule[]) => void`

**Logic:**
- `isRoleDefault(module)` — calls `hasAnyRoleAccess(role, module)` from the old logic
- If `isRoleDefault` → checkbox pre-checked, `disabled` (can't hide role grants)
- If not `isRoleDefault` → editable checkbox, toggle adds/removes from array
- `profile` always shown (all roles have it) — `disabled` for all roles

**UI:** Flat list grouped by category, each row = `[✓/✗] Module Label`. No sub-rows.

**New user flow (page.tsx passes `initialAssigned=['profile']`).**

**Existing user flow (page.tsx passes `assigned=[...Object.keys(u.modulePermissions ?? {}), 'profile']`).**

### 4. `src/app/(admin)/settings/users/page.tsx`

- State: `assignedModules: AppModule[]` instead of `modulePermissions: PerUserModulePermissions`
- `openNew`: `setAssignedModules(['profile'])`
- `openEdit`: `setAssignedModules([...(u.modulePermissions ? Object.keys(u.modulePermissions) : []), 'profile'])`
- `handleSave`: send `modulePermissions: Object.fromEntries(assignedModules.map(m => [m, true]))`
- Remove `permissionsReset` flag entirely
- `ModulePermissionsEditor` receives `assigned={form.assignedModules}` + `onChange={assigned => setForm(f => ({ ...f, assignedModules: assigned }))}`

---

## What Stays the Same

- `app_users.extra_data` JSONB storage — no schema migration
- `SessionUser.modulePermissions` field (still stored as `Partial<Record<string, true>>`)
- Session endpoint fresh DB fetch
- `buildSessionUser` / `createSession` in auth.ts
- `src/proxy.ts` route guard
- `src/app/api/data/route.ts` permission checks
- All 41+ client pages using `hasPermission(user, ...)` calls
- The `MODULE_GROUPS` structure in the editor (same categories)

## Verification

1. **Typecheck:** `npm run typecheck` — no errors
2. **Dev server:** `npm run dev`
3. **Assign module:** Login as OWNER → `/settings/users` → Edit OPERASIONAL user → expand "Atur Akses Modul" → check "Kenderaan" (role doesn't grant it) → Save → login as that user → sidebar shows Kenderaan
4. **Role default still shows:** that user also sees Order/Resi (OPERASIONAL role grants it)
5. **Can't hide role module:** in editor, "Order / Resi" is checked and disabled (OPERASIONAL has access by role)
6. **Reset:** click "Reset semua" → Save → user reverts to role defaults only (no explicit assignments)
7. **New user:** create user → editor shows only "Akun Saya" (profile) pre-checked
