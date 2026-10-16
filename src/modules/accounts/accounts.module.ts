/**
 * @file Composes Accounts' decl with its screen — the only place the two halves
 * meet, per the standing module pattern.
 */
import { defineModule } from "@axf/core";

import { ACCOUNTS_DECL } from "./accounts.decl";
import AccountsModule from "./AccountsModule";

export const ACCOUNTS_MODULE = defineModule({ ...ACCOUNTS_DECL, component: AccountsModule });
