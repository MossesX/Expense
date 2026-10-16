/**
 * @file The permission matrix — the administrator's grid of who may open
 * what: one row per account, one column per REGISTERED module, plus the two
 * capability columns (`canMessage`, `canEditProfile`).
 *
 * The module columns come from the LIVE registry (`registry.modules()`, the
 * same source the Core Inspector reads) — never a hardcoded list, so a module
 * registered tomorrow grows a column with no edit here. The registry is
 * mutated during client boot, so it is read once after mount, the same
 * arrangement `/demo` uses.
 *
 * Each cell reflects the target's `effectivePermissions` — fetched per user
 * from `GET /api/accounts/permissions?user=…` rather than re-deriving the
 * default-allow rule from the sparse grants (the types file is explicit that
 * consumers must not re-implement it). Writes go through
 * `POST /api/accounts/permissions`; every response carries the fresh verdict,
 * which replaces the row — no optimistic flip, so what the switch shows is
 * always what the server decided, and a refusal (surfaced verbatim) leaves
 * the switch where it truly is.
 *
 * Administrators' rows render locked-on with a tooltip: they pass every check
 * by role, and a switch that pretended otherwise would be the matrix lying.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, registry, token } from "@axf/core";

import { useAccountsSettings } from "./settings";
import { useAccountsState } from "./store";
import type { EffectivePermissions } from "./lib/types";

const ADMIN_TIP = "Administrators always pass every permission check — the role, not a grant.";

type Capability = "canMessage" | "canEditProfile";
const CAPABILITIES: readonly { key: Capability; label: string }[] = [
  { key: "canMessage", label: "Messaging" },
  { key: "canEditProfile", label: "Edit profile" },
];

interface PermissionsAnswer {
  ok?: boolean;
  permissions?: EffectivePermissions;
  error?: string;
}

export default function PermissionMatrix() {
  const { users } = useAccountsState();
  const settings = useAccountsSettings();

  // The live registry, read after mount — boot populates it before React runs,
  // but reading at render would bake an empty SSR answer into hydration.
  const [modules, setModules] = React.useState<readonly { id: string; title: string }[] | null>(null);
  React.useEffect(() => {
    setModules(registry.modules().map((m) => ({ id: m.id, title: m.title })));
  }, []);

  const [perms, setPerms] = React.useState<Record<string, EffectivePermissions>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busyCell, setBusyCell] = React.useState<string | null>(null);

  const usernames = React.useMemo(() => users.map((u) => u.username).join("\n"), [users]);

  // One verdict per roster row. Refetched when the roster changes (an added or
  // removed account changes the row set, a role edit changes a verdict).
  React.useEffect(() => {
    if (!usernames) return;
    let stale = false;
    void (async () => {
      const names = usernames.split("\n");
      const fetched = await Promise.all(
        names.map(async (name) => {
          try {
            const res = await fetch(`/api/accounts/permissions?user=${encodeURIComponent(name)}`);
            const body = (await res.json()) as PermissionsAnswer;
            if (!res.ok || !body.ok || !body.permissions) {
              throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            return [name, body.permissions] as const;
          } catch (err) {
            throw new Error(`could not read permissions for ${name}: ${String(err)}`);
          }
        }),
      ).catch((err: Error) => err);
      if (stale) return;
      if (fetched instanceof Error) {
        setError(fetched.message);
      } else {
        setPerms(Object.fromEntries(fetched));
        setError(null);
      }
    })();
    return () => {
      stale = true;
    };
  }, [usernames]);

  /** POST one grant flip and adopt the verdict the server answers with. */
  const write = async (username: string, cellKey: string, body: Record<string, unknown>) => {
    setBusyCell(cellKey);
    setError(null);
    try {
      const res = await fetch("/api/accounts/permissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, ...body }),
      });
      const answer = (await res.json()) as PermissionsAnswer;
      if (!res.ok || !answer.ok || !answer.permissions) {
        // The server is the guard — its refusal text lands here verbatim.
        setError(answer.error ?? `write failed (HTTP ${res.status})`);
      } else {
        setPerms((prev) => ({ ...prev, [username]: answer.permissions! }));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyCell(null);
    }
  };

  const headCell = { fontSize: 11, color: token("dim"), whiteSpace: "nowrap" } as const;

  return (
    <Stack sx={{ gap: 1 }}>
      <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>
        Permission matrix
        <Typography component="span" sx={{ fontSize: 11.5, color: token("dim"), ml: 1 }}>
          which registered modules each account may open
        </Typography>
      </Typography>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}

      {modules === null ? (
        <CircularProgress size={20} />
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size={settings.denseTables ? "small" : "medium"} sx={{ width: "auto" }}>
            <TableHead>
              <TableRow>
                <TableCell sx={headCell}>Account</TableCell>
                {modules.map((m) => (
                  <TableCell key={m.id} align="center" sx={headCell}>
                    <Tooltip title={m.id}>
                      <span>{m.title}</span>
                    </Tooltip>
                  </TableCell>
                ))}
                {CAPABILITIES.map((c) => (
                  <TableCell key={c.key} align="center" sx={{ ...headCell, fontStyle: "italic" }}>
                    {c.label}
                  </TableCell>
                ))}
                <TableCell sx={headCell}>Summary</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => {
                const p = perms[u.username];
                const admin = p?.administrator ?? u.role === "administrator";
                const revoked = p?.deniedModules.length ?? 0;
                return (
                  <TableRow key={u.username} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                        {u.screenname ?? u.username}
                      </Typography>
                      <Typography sx={{ fontSize: 10.5, color: token("dim"), fontFamily: token("mono") }}>
                        {u.username} · {u.role}
                      </Typography>
                    </TableCell>

                    {modules.map((m) => {
                      const cellKey = `${u.username}:${m.id}`;
                      if (admin) {
                        return (
                          <TableCell key={m.id} align="center">
                            <Tooltip title={ADMIN_TIP}>
                              <span>
                                <Switch size="small" checked disabled />
                              </span>
                            </Tooltip>
                          </TableCell>
                        );
                      }
                      const allowed = p ? !p.deniedModules.includes(m.id) : true;
                      return (
                        <TableCell key={m.id} align="center">
                          <Switch
                            size="small"
                            checked={allowed}
                            disabled={!p || busyCell === cellKey}
                            slotProps={{ input: { "aria-label": `${u.username} may open ${m.id}` } }}
                            onChange={(_, next) =>
                              void write(u.username, cellKey, {
                                action: "set-module",
                                moduleId: m.id,
                                allowed: next,
                              })
                            }
                          />
                        </TableCell>
                      );
                    })}

                    {CAPABILITIES.map((c) => {
                      const cellKey = `${u.username}:${c.key}`;
                      if (admin) {
                        return (
                          <TableCell key={c.key} align="center">
                            <Tooltip title={ADMIN_TIP}>
                              <span>
                                <Switch size="small" checked disabled />
                              </span>
                            </Tooltip>
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={c.key} align="center">
                          <Switch
                            size="small"
                            checked={p ? p[c.key] : true}
                            disabled={!p || busyCell === cellKey}
                            slotProps={{ input: { "aria-label": `${u.username} ${c.label}` } }}
                            onChange={(_, next) =>
                              void write(u.username, cellKey, {
                                action: "set-capability",
                                capability: c.key,
                                allowed: next,
                              })
                            }
                          />
                        </TableCell>
                      );
                    })}

                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {admin ? (
                        <Typography sx={{ fontSize: 11.5, color: token("dim") }}>always full</Typography>
                      ) : revoked > 0 ? (
                        <Stack direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
                          <Glyph id="icon-eye-off" size={13} />
                          <Typography sx={{ fontSize: 11.5, color: token("warn") }}>
                            {revoked} module{revoked === 1 ? "" : "s"} revoked
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography sx={{ fontSize: 11.5, color: token("dim") }}>full access</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Stack>
  );
}
