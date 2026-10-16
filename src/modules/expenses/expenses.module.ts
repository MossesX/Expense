/**
 * @file The Expense Tracker — declaration composed with its component.
 *
 * The declaration lives in `expenses.decl.ts`, data-only, so the registry, the
 * peel and the suite resolver can read it without loading React. This file is
 * the ONLY place the declaration and the screen meet, and `defineModule`
 * validates the result.
 */
import { defineModule } from "@axf/core";

import ExpensesModule from "./ExpensesModule";
import { EXPENSES_DECL } from "./expenses.decl";

export const EXPENSES_MODULE = defineModule({
  ...EXPENSES_DECL,
  component: ExpensesModule
});
