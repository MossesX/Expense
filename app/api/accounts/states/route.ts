/**
 * @file `/api/accounts/states` — named appearance states + factory reset, the
 * HTTP door onto the P1 state engine (`@axs/modules/accounts/lib/states`).
 *
 * Everything here is session-gated and acts on the SIGNED-IN user only — there
 * is no username in any body, so one user's states are structurally out of
 * another's reach. The server never invents appearance state: `save` persists
 * the CLIENT-captured snapshot from the body, `apply` hands a stored snapshot
 * back for the CLIENT to apply, and `factory-reset` returns the P0 default
 * snapshot after wiping — the engine writes no appearance itself.
 *
 * GET → `{ ok, states: SavedStateMeta[] }` (newest first, no snapshot bodies).
 *
 * POST `{ action, … }`:
 *   - `save`          { name, snapshot }  → validates + stores; same slug overwrites
 *   - `apply`         { slug }            → `{ ok, state }` with the stored snapshot
 *   - `delete`        { slug }            → removes the file
 *   - `factory-reset` { confirm }         → `confirm` must be the exact typed string
 *     `factory-reset <username>` (the refusal names it, like every "type the
 *     name to delete" gate) — then wipes the user's kv tree + module subtrees
 *     and returns `{ ok, snapshot }`, the default state to apply.
 *
 * Result unions map to status codes via `fail` (`refuse` is shaped for the
 * accounts store's result; the states engine carries the same `{ error,
 * status }` failure half). Body size is capped by `readJsonBody`; the engine
 * additionally caps name length, snapshot bytes and states per user.
 */

import { NextResponse, type NextRequest } from "next/server";
import { fail, readJsonBody, requireSession, str } from "@axs/modules/accounts/lib/http";
import { guardStorageWrite } from "@axs/modules/accounts/lib/policy";
import {
  deleteState,
  factoryReset,
  factoryResetConfirmation,
  listStates,
  loadState,
  saveState,
} from "@axs/modules/accounts/lib/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;
  return NextResponse.json({ ok: true, states: await listStates(gate.user) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;
  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const body = read.body as Record<string, unknown>;
  const action = str(body, "action");

  if (action === "save") {
    // THE STORAGE POLICY. `save` is this module's per-user storage WRITE, so
    // it is where the quota bites: the single-write cap first (`maxUploadMB`,
    // answered without touching the ledger) then `storageQuotaMB` through P1's
    // `checkQuota`. The ledger's own verdict travels in the response —
    // "over quota" without the numbers is a refusal a member cannot act on,
    // and `no-index` is how they are told the figure is unmeasured rather than
    // being left to assume it was checked.
    //
    // Measured off the serialised snapshot, which is what lands on disk. It is
    // an estimate of the DELTA only in the sense that an overwrite of the same
    // slug frees the old document; erring high refuses slightly early, which
    // is the right direction for a cap.
    const want = JSON.stringify(body.snapshot ?? null).length;
    const room = await guardStorageWrite(gate.user, want);
    if (!room.ok) {
      return NextResponse.json(
        { ok: false, error: room.error, policyRow: room.row, limit: room.value, verdict: room.verdict },
        { status: room.status },
      );
    }
    const result = await saveState(gate.user, str(body, "name"), body.snapshot);
    if (!result.ok) return fail(result.status, result.error);
    return NextResponse.json({ ok: true, state: result.value, storage: room.verdict });
  }

  if (action === "apply") {
    const result = await loadState(gate.user, str(body, "slug"));
    if (!result.ok) return fail(result.status, result.error);
    return NextResponse.json({ ok: true, state: result.value });
  }

  if (action === "delete") {
    const result = await deleteState(gate.user, str(body, "slug"));
    if (!result.ok) return fail(result.status, result.error);
    return NextResponse.json({ ok: true, deleted: result.value.slug });
  }

  if (action === "factory-reset") {
    const expected = factoryResetConfirmation(gate.user);
    if (str(body, "confirm") !== expected) {
      return fail(
        400,
        `factory reset is destructive — send { "confirm": "${expected}" } to proceed`,
      );
    }
    const result = await factoryReset(gate.user);
    if (!result.ok) return fail(result.status, result.error);
    return NextResponse.json({ ok: true, snapshot: result.value });
  }

  return fail(400, `unknown action "${action}"`);
}
