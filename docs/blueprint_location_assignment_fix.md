# Blueprint: Fix Employee Location Assignment (Add & Edit)

**Date:** 2026-08-01  
**Scope:** `AddEmployeeDialog.tsx`, `EditEmployeeDialog.tsx`  
**No backend changes required.**

---

## Problem Summary

HR can't reliably assign or edit employee locations because of three compounding bugs:

1. **No way to clear filters** — once a city or project is selected in either form, there is no way to reset the filter to show all available locations.
2. **Edit form wipes existing assignments when changing filters** — `setWorkCity` and `setProject` both call `setSelectedLocationIds([])`, destroying already-selected locations the moment HR touches a filter.
3. **Existing locations hidden when filters are active** — `filteredLocations` only renders locations that match the active city/project filter. If an employee's assigned locations belong to a different city or project than what's currently in the filter, those checkboxes become invisible — HR can't see, keep, or remove them.

---

## Root Cause Analysis

### Bug 1 — No clear affordance on Select fields

Both forms use a `<Select>` for city (`work_city`) and project (`project_id`). Neither dropdown provides a "Show All" / clear option. Once a value is chosen, HR is locked into a filtered view with no escape.

**Location:**
- [AddEmployeeDialog.tsx:416–428](../src/components/forms/AddEmployeeDialog.tsx#L416) — city select  
- [AddEmployeeDialog.tsx:553–565](../src/components/forms/AddEmployeeDialog.tsx#L553) — project select  
- [EditEmployeeDialog.tsx:479–487](../src/components/forms/EditEmployeeDialog.tsx#L479) — city select  
- [EditEmployeeDialog.tsx:588–600](../src/components/forms/EditEmployeeDialog.tsx#L588) — project select  

---

### Bug 2 — Filter change destroys selections in Edit form

`setWorkCity` and `setProject` in **EditEmployeeDialog** hard-reset `selectedLocationIds` and `primaryLocationId` to empty on every filter change:

```ts
// EditEmployeeDialog.tsx:205-225
const setWorkCity = (value: string | null) => {
  setSelectedLocationIds([]);   // ← DESTRUCTIVE in edit mode
  setPrimaryLocationId("");     // ← DESTRUCTIVE in edit mode
  setForm((prev) => ({ ... }));
};
const setProject = (value: string | null) => {
  setSelectedLocationIds([]);   // ← DESTRUCTIVE in edit mode
  setPrimaryLocationId("");     // ← DESTRUCTIVE in edit mode
  setForm((prev) => ({ ... }));
};
```

In the **Add** form this is fine (starting fresh). In the **Edit** form it means changing the filter to find additional locations silently discards what was already assigned.

---

### Bug 3 — filteredLocations hides assigned locations

The `filteredLocations` memo (identical in both forms) applies the city AND project filter unconditionally:

```ts
// EditEmployeeDialog.tsx:233-240
const filteredLocations = useMemo(() => {
  return locations.filter((location) => {
    const matchesCity    = !form.work_city  || locationCity === form.work_city;
    const matchesProject = !form.project_id || locationMatchesCompany(location, selectedProject);
    return matchesCity && matchesProject;
  });
}, [...]);
```

If an employee was assigned to location X (city: Jeddah) but the edit form opens with `work_city = "Riyadh"`, location X never appears in the rendered list. The checkbox is invisible; `selectedLocationIds` still holds the ID in state, but HR has no way to manage it.

---

## Solution Design

### Fix 1 — Add a "Show All" clear option to each Select (both forms)

Add a sentinel `SelectItem` at the top of each dropdown with `value=""`. Selecting it calls the existing handler with `null`/`""`, which already resets the filter to "no filter" (since `!form.work_city` and `!form.project_id` are both falsy-checks in `filteredLocations`).

**City select — add above city list:**
```tsx
<SelectItem value="">كل المدن</SelectItem>
```
Handler call: `onValueChange={(value) => setWorkCity(value || null)}`

**Project select — add above company list:**
```tsx
<SelectItem value="">كل المشاريع</SelectItem>
```
Handler call: `onValueChange={(value) => setProject(value || null)}`

This change is identical in both `AddEmployeeDialog` and `EditEmployeeDialog`.

---

### Fix 2 — Remove destructive reset from Edit form filter handlers

In `EditEmployeeDialog` only, remove the `setSelectedLocationIds([])` and `setPrimaryLocationId("")` calls from `setWorkCity` and `setProject`. The filter is for **display navigation** only — it should never modify what is already selected.

**Before (EditEmployeeDialog.tsx:205-225):**
```ts
const setWorkCity = (value: string | null) => {
  setSelectedLocationIds([]);
  setPrimaryLocationId("");
  setForm((prev) => ({
    ...prev,
    work_city: value ?? "",
    city: value ?? "",
    province: value ?? "",
    location_id: "",
  }));
};
const setProject = (value: string | null) => {
  setSelectedLocationIds([]);
  setPrimaryLocationId("");
  setForm((prev) => ({
    ...prev,
    project_id: value ?? "",
    company_id: value ?? "",
    location_id: "",
  }));
};
```

**After:**
```ts
const setWorkCity = (value: string | null) => {
  setForm((prev) => ({
    ...prev,
    work_city: value ?? "",
    city: value ?? "",
    province: value ?? "",
  }));
};
const setProject = (value: string | null) => {
  setForm((prev) => ({
    ...prev,
    project_id: value ?? "",
    company_id: value ?? "",
  }));
};
```

Note: `location_id` is also removed from these resets since it represents the primary location — wiping it on a filter change is wrong.

---

### Fix 3 — Always include assigned locations in filteredLocations (Edit form only)

Modify `filteredLocations` in `EditEmployeeDialog` to always pass through any location whose ID is already in `selectedLocationIds`, before applying the city/project filter to the rest:

**Before (EditEmployeeDialog.tsx:233-240):**
```ts
const filteredLocations = useMemo(() => {
  return locations.filter((location) => {
    const locationCity = inferLocationCity(location);
    const matchesCity    = !form.work_city  || locationCity === form.work_city;
    const matchesProject = !form.project_id || locationMatchesCompany(location, selectedProject);
    return matchesCity && matchesProject;
  });
}, [form.project_id, form.work_city, locations, selectedProject]);
```

**After:**
```ts
const filteredLocations = useMemo(() => {
  return locations.filter((location) => {
    const locationId = String(location.id);
    if (selectedLocationIds.includes(locationId)) return true; // always show assigned
    const locationCity = inferLocationCity(location);
    const matchesCity    = !form.work_city  || locationCity === form.work_city;
    const matchesProject = !form.project_id || locationMatchesCompany(location, selectedProject);
    return matchesCity && matchesProject;
  });
}, [form.project_id, form.work_city, locations, selectedProject, selectedLocationIds]);
```

This guarantees HR can always see and manage the employee's current assignments regardless of what filter is active.

---

## Visual UX Improvement (optional but recommended)

In the Edit form location panel, add a visual indicator on locations that are "assigned from a different filter" so HR knows why they appear outside the current filter. A small grey badge "خارج الفلتر" next to the location name would suffice:

```tsx
{!filteredByCurrentFilter && (
  <span className="text-xs text-gray-400 mr-1">(خارج الفلتر)</span>
)}
```

Compute `filteredByCurrentFilter` from whether the location matches the active city/project filter independent of the `selectedLocationIds` passthrough.

---

## File Change Summary

| File | Changes |
|---|---|
| `src/components/forms/AddEmployeeDialog.tsx` | Fix 1 only: add "كل المدن" and "كل المشاريع" clear options |
| `src/components/forms/EditEmployeeDialog.tsx` | Fix 1 + Fix 2 + Fix 3 |

---

## Implementation Steps

### Step 1 — AddEmployeeDialog: clear options (Fix 1)

1. City select (around line 418): add `<SelectItem value="">كل المدن</SelectItem>` as the first item inside `<SelectContent>`.
2. Project select (around line 560): add `<SelectItem value="">كل المشاريع</SelectItem>` as the first item inside `<SelectContent>`.
3. Ensure both `onValueChange` handlers call the setter with `value || null` so an empty string still triggers the "no filter" path.

### Step 2 — EditEmployeeDialog: clear options (Fix 1)

Identical to Step 1 but in `EditEmployeeDialog.tsx` (city ~line 482, project ~line 595).

### Step 3 — EditEmployeeDialog: remove destructive resets (Fix 2)

Edit `setWorkCity` and `setProject` in `EditEmployeeDialog.tsx` (lines 205-225):
- Remove the `setSelectedLocationIds([])` line from both
- Remove the `setPrimaryLocationId("")` line from both
- Remove `location_id: ""` from both form resets (primary location should not be auto-cleared by a display filter)

### Step 4 — EditEmployeeDialog: fix filteredLocations passthrough (Fix 3)

Edit the `filteredLocations` useMemo in `EditEmployeeDialog.tsx` (lines 233-240):
- Add `selectedLocationIds` to the dependency array
- Add the early-return guard: `if (selectedLocationIds.includes(locationId)) return true`

### Step 5 — Test the following scenarios

| Scenario | Expected result |
|---|---|
| Add form: select city → select "كل المدن" | All org locations appear |
| Add form: select project → select "كل المشاريع" | Locations not filtered by project |
| Edit form: open employee with Jeddah locations | Jeddah locations show checked |
| Edit form: change city filter to Riyadh | Jeddah locations remain visible and checked |
| Edit form: uncheck a Jeddah location while Riyadh filter is active | Location unchecks successfully |
| Edit form: save | Only the currently checked locations are saved |
| Edit form: change project filter, then save without touching checkboxes | Original location assignments preserved |

---

## No Backend Changes Required

The backend already handles multi-location assignment correctly via `update_employee_master` (partial smart-update) and the `employee_locations` junction table. All fixes are purely frontend UI/state management.
