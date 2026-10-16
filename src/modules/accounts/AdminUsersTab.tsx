/**
 * @file The Users tab — the suite's heaviest surface: a searchable, sortable,
 * SERVER-PAGED roster on the left, the full detail pane on the right, split by
 * core's `PaneLayout`.
 *
 * ## The table renders a page, never the population
 *
 * Every filter, every sort and every slice happens on the server
 * (`/api/accounts/admin/users`); this file holds one page and a total. That is
 * not a nicety — a studio with thousands of members must not ship thousands of
 * rows to draw fifty, and a client-side filter would have to. The consequence
 * to keep in mind while reading: `page.rows` is a WINDOW, so anything computed
 * from it (a count, a "select all") would be computing over the window and not
 * over the roster. Nothing here does, and nothing added later should.
 *
 * Both joins are requested — `withStorage` and `withPolicy` — because the
 * detail pane reads both and the route scopes them to the page. The one sort
 * that measures everything (`storage`) is a deliberate opt-in the administrator
 * makes by clicking that column, exactly as the route's header describes.
 *
 * ## Selection is a username, not a row
 *
 * A row object goes stale the moment anything writes; a username does not. The
 * detail pane is handed the row from the CURRENT page, so after any write the
 * page is re-read and the detail re-renders from fresh bytes rather than from
 * whatever the table was holding when the click happened.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, PaneLayout, definePanes, token } from "@axf/core";

import AdminUserDetail from "./AdminUserDetail";
import { useAccountsSettings } from "./settings";
import {
  createUser,
  fetchUserPage,
  fmtBytes,
  fmtWhen,
  type AdminUserPage,
  type AdminUserRow,
  type UserSortKey,
  type UserStateFilter,
} from "./adminApi";
import type { AccountRole } from "./lib/types";

/** Module-scope, as the layout contract requires: a tree built inside the
 *  component would be a new object every render and the latch would key on a
 *  signature that never settles. */
const TREE = definePanes({
  kind: "split",
  direction: "row",
  weights: [52, 48],
  children: [
    { kind: "pane", id: "roster", minSize: 380 },
    { kind: "pane", id: "detail", minSize: 340 },
  ],
});

const COLUMNS: readonly { key: UserSortKey; label: string; numeric?: boolean }[] = [
  { key: "screenname", label: "Member" },
  { key: "role", label: "Role" },
  { key: "storage", label: "Storage", numeric: true },
  { key: "lastLoginAt", label: "Last login" },
];

const STATES: readonly { value: UserStateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "pending", label: "Pending entry" },
  { value: "online", label: "Online" },
];

/* =============================== create dialog =============================== */

/**
 * Creating an account goes through the AUDITED admin route rather than the
 * member-facing store relay, because "who added this person" is exactly the
 * question the trail exists to answer.
 */
function CreateUserDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [username, setUsername] = React.useState("");
  const [tempPassword, setTempPassword] = React.useState("");
  const [role, setRole] = React.useState<AccountRole>("member");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    const res = await createUser(username.trim(), tempPassword, role);
    setBusy(false);
    if (res.ok) onDone(res.data.username);
    else setError(res.error);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Add member</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField
            label="Username"
            size="small"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            helperText="2–32 characters: letters, digits, . _ -"
            slotProps={{ htmlInput: { autoCapitalize: "none", autoCorrect: "off" } }}
          />
          <TextField
            label="Temp password"
            size="small"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            helperText="At least 6 characters. They sign in with it once and are forced to choose their own; the screenname is their own choice on first entry."
          />
          <TextField
            select
            label="Role"
            size="small"
            value={role}
            onChange={(e) => setRole(e.target.value as AccountRole)}
          >
            <MenuItem value="member">member</MenuItem>
            <MenuItem value="administrator">administrator</MenuItem>
          </TextField>
          {error && (
            <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: token("dim") }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || !username.trim() || tempPassword.length < 6}
          onClick={() => void go()}
        >
          {busy ? <CircularProgress size={16} /> : "Add member"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ================================= the tab =================================== */

/**
 * `?user=` and `?card=` — where the member context menu lands (P10).
 *
 * Read from `window.location` in an effect rather than through
 * `useSearchParams`, for the reason `AccountsModule` gives about the same
 * choice: the hook imposes a Suspense boundary on every ancestor, and this is
 * used once, client-side, to pick an initial selection.
 *
 * The username is applied to the SEARCH as well as to the selection, and that is
 * not belt-and-braces: this roster renders a server page, so a member on page
 * four is not among the rows a fresh mount holds and selecting them would leave
 * the detail pane saying they are not on this page. Filtering to them is what
 * makes the link land.
 */
function useRequestedMember(): { user: string; card: string | null } | null {
  const [asked, setAsked] = React.useState<{ user: string; card: string | null } | null>(null);
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const user = params.get("user");
    if (user) setAsked({ user, card: params.get("card") });
  }, []);
  return asked;
}

export default function AdminUsersTab() {
  const settings = useAccountsSettings();

  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [role, setRole] = React.useState<"" | AccountRole>("");
  const [state, setState] = React.useState<UserStateFilter>("all");
  const [sort, setSort] = React.useState<UserSortKey>("username");
  const [dir, setDir] = React.useState<"asc" | "desc">("asc");
  const [offset, setOffset] = React.useState(0);
  const [limit, setLimit] = React.useState(25);

  const [page, setPage] = React.useState<AdminUserPage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Applied ONCE. After that the roster is the person's — a deep link must not
  // keep dragging them back to the member they arrived on.
  const requested = useRequestedMember();
  const applied = React.useRef(false);
  React.useEffect(() => {
    if (applied.current || !requested) return;
    applied.current = true;
    setSearch(requested.user);
    setQuery(requested.user);
    setSelected(requested.user);
  }, [requested]);

  // Typing is not a request. The search box settles first, and the settled
  // value is what the query depends on — otherwise every keystroke is a page
  // read, and a fast typist out-runs their own answers.
  React.useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetchUserPage({
      q: query,
      role,
      state,
      sort,
      dir,
      offset,
      limit,
      withStorage: true,
      withPolicy: true,
    });
    setLoading(false);
    if (res.ok) {
      setPage(res.data);
      setError(null);
    } else setError(res.error);
  }, [query, role, state, sort, dir, offset, limit]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const rows = page?.rows ?? [];
  const current = selected ? (rows.find((r) => r.username === selected) ?? null) : null;

  const onSort = (key: UserSortKey) => {
    if (key === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setDir("asc");
    }
    setOffset(0);
  };

  const roster = (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, p: 1.25, flexWrap: "wrap" }}>
        <TextField
          placeholder="Search members…"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Glyph id="icon-search" size={13} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: 200, "& .MuiInputBase-input": { fontSize: 12.5 } }}
        />
        <TextField
          select
          size="small"
          label="Role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as "" | AccountRole);
            setOffset(0);
          }}
          sx={{ width: 130, "& .MuiInputBase-input": { fontSize: 12.5 } }}
        >
          <MenuItem value="" sx={{ fontSize: 12.5 }}>
            Any
          </MenuItem>
          <MenuItem value="member" sx={{ fontSize: 12.5 }}>
            member
          </MenuItem>
          <MenuItem value="administrator" sx={{ fontSize: 12.5 }}>
            administrator
          </MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="State"
          value={state}
          onChange={(e) => {
            setState(e.target.value as UserStateFilter);
            setOffset(0);
          }}
          sx={{ width: 150, "& .MuiInputBase-input": { fontSize: 12.5 } }}
        >
          {STATES.map((s) => (
            <MenuItem key={s.value} value={s.value} sx={{ fontSize: 12.5 }}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Re-read this page">
          <span>
            <IconButton size="small" disabled={loading} onClick={() => void load()}>
              {loading ? <CircularProgress size={13} /> : <Glyph id="icon-sync" size={14} />}
            </IconButton>
          </span>
        </Tooltip>
        <Button
          variant="contained"
          size="small"
          startIcon={<Glyph id="icon-plus" size={12} />}
          onClick={() => setCreating(true)}
          sx={{ textTransform: "none", fontSize: 12.5 }}
        >
          Add member
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12, mx: 1.25, mb: 1 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert
          severity="success"
          variant="outlined"
          sx={{ fontSize: 12, mx: 1.25, mb: 1 }}
          onClose={() => setNotice(null)}
        >
          {notice}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Table size={settings.denseTables ? "small" : "medium"} stickyHeader>
          <TableHead>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableCell
                  key={c.key}
                  align={c.numeric ? "right" : "left"}
                  sx={{ fontSize: 11.5, color: token("dim"), whiteSpace: "nowrap" }}
                >
                  <TableSortLabel
                    active={sort === c.key}
                    direction={sort === c.key ? dir : "asc"}
                    onClick={() => onSort(c.key)}
                  >
                    {c.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.username}
                hover
                selected={r.username === selected}
                onClick={() => setSelected(r.username)}
                // The member area, and the username the rows act on. Marked on
                // the ROW rather than the table, so `MenuContext.data.user` is
                // the member the pointer is over and not whichever one the
                // table happened to draw first.
                data-axf-area="accounts.user-row"
                data-axf-user={r.username}
                sx={{ cursor: "pointer" }}
              >
                <TableCell>
                  <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                    <Box
                      component="span"
                      aria-label={r.online ? "online" : "offline"}
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: r.online ? token("ok") : "transparent",
                        border: `1.5px solid ${r.online ? token("ok") : token("dim")}`,
                      }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                        {r.screenname ?? r.username}
                      </Typography>
                      <Typography
                        sx={{ fontSize: 10.5, color: token("dim"), fontFamily: token("mono") }}
                      >
                        {r.username}
                        {r.disabled ? " · disabled" : ""}
                        {r.mustChangePassword ? " · temp password" : ""}
                        {r.awaitingFirstPassword ? " · no password yet" : ""}
                      </Typography>
                    </Box>
                    {r.policy?.suspended && r.policy.lapsed !== true && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label="suspended"
                        sx={{ height: 18, fontSize: 10, color: token("warn"), borderColor: token("warn") }}
                      />
                    )}
                  </Stack>
                </TableCell>
                <TableCell sx={{ fontSize: 12 }}>{r.role}</TableCell>
                <TableCell align="right" sx={{ fontSize: 12, fontFamily: token("mono") }}>
                  {r.storage === undefined ? (
                    "—"
                  ) : r.storage === null ? (
                    // Measured and absent is not zero: nobody has ever scanned
                    // this member, and a quota refuses nobody on the strength
                    // of a measurement that does not exist.
                    <Tooltip title="Never scanned">
                      <Typography component="span" sx={{ fontSize: 12, color: token("dim") }}>
                        unscanned
                      </Typography>
                    </Tooltip>
                  ) : (
                    fmtBytes(r.storage.totalBytes)
                  )}
                </TableCell>
                <TableCell sx={{ fontSize: 12, color: token("dim"), whiteSpace: "nowrap" }}>
                  {fmtWhen(r.lastLoginAt)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length}>
                  <Typography sx={{ fontSize: 12.5, color: token("dim"), py: 1 }}>
                    {query || role || state !== "all"
                      ? "No member matches those filters."
                      : "No accounts yet."}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <TablePagination
        component="div"
        count={page?.total ?? 0}
        page={limit > 0 ? Math.floor(offset / limit) : 0}
        rowsPerPage={limit}
        rowsPerPageOptions={[25, 50, 100, 200]}
        onPageChange={(_, next) => setOffset(next * limit)}
        onRowsPerPageChange={(e) => {
          setLimit(Number(e.target.value));
          setOffset(0);
        }}
        sx={{
          borderTop: `1px solid ${token("edge")}`,
          "& .MuiTablePagination-toolbar": { minHeight: 40 },
          "& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows": { fontSize: 11.5 },
        }}
      />
    </Stack>
  );

  const detail = (
    <Box sx={{ height: "100%", minHeight: 0, overflow: "auto" }}>
      {current ? (
        <AdminUserDetail
          row={current}
          onChanged={() => void load()}
          // Only while the link's own selection is still the one on screen: a
          // `?card=storage` link that kept scrolling to storage every time the
          // administrator clicked a different member would be the deep link
          // refusing to let go, which is what `applied` above exists to stop.
          focusCard={requested && requested.user === current.username ? requested.card : null}
        />
      ) : (
        <Stack sx={{ p: 3, gap: 1, alignItems: "flex-start" }}>
          <Typography sx={{ fontSize: 12.5, color: token("dim") }}>
            {selected
              ? `“${selected}” is not on this page any more — the filters or the page moved. Select somebody from the list.`
              : "Select a member to see their profile, storage, sessions, policy and module access."}
          </Typography>
        </Stack>
      )}
    </Box>
  );

  return (
    <>
      <Box sx={{ flex: 1, minHeight: 420, display: "flex" }}>
        <PaneLayout
          tree={TREE}
          storageKey="accounts-admin-users"
          renderPane={(id) => (id === "roster" ? roster : detail)}
        />
      </Box>

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onDone={(name) => {
            setCreating(false);
            setNotice(`Added ${name}. Hand them the temp password — their first sign-in is forced through change-password.`);
            setSelected(name);
            void load();
          }}
        />
      )}
    </>
  );
}
