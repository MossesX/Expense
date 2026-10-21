/**
 * @file The grid's hideable columns — one list the grid, the Columns dialog
 * (header View button and the context menu's View…) and the toggle commands
 * all read (owner, 2026-10-16, dialog 2026-10-21).
 *
 * The hidden set is a SETTING (`hiddenColumns`, comma-separated ids) rather
 * than component state, so it survives a reload and a floated grid agrees
 * with a docked one. Date and Merchant are not in the list: a row with
 * neither is not a transaction anyone can recognise, and a view that can
 * hide every column is a view that can be emptied by accident.
 */
import { GRID_COLUMNS, type GridColumn } from "./expenses.decl";
import { expensesSettings, getExpensesSettings } from "./settings";

// The list itself lives on the decl (data only, so the context menu's View
// submenu is generated from it there); this module adds the behaviour.
export { GRID_COLUMNS, type GridColumn };

const KNOWN = new Set(GRID_COLUMNS.map((c) => c.id));

/** The hidden ids a `hiddenColumns` value names — unknown ids dropped. */
export function hiddenSet(csv: string): Set<string> {
  return new Set(csv.split(",").map((s) => s.trim()).filter((s) => KNOWN.has(s)));
}

export const isColumnShown = (id: string, csv = getExpensesSettings().hiddenColumns): boolean => !hiddenSet(csv).has(id);

export function setColumnShown(id: string, shown: boolean): void {
  const hidden = hiddenSet(getExpensesSettings().hiddenColumns);
  if (shown) hidden.delete(id);
  else hidden.add(id);
  expensesSettings.set("hiddenColumns", GRID_COLUMNS.filter((c) => hidden.has(c.id)).map((c) => c.id).join(","));
}

export const toggleColumn = (id: string): void => setColumnShown(id, !isColumnShown(id));

export const showAllColumns = (): void => expensesSettings.set("hiddenColumns", "");
