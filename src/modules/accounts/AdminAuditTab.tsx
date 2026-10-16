/**
 * @file The Audit tab — **the trail, queried**: who did what, to whom, when.
 *
 * A filter bar over `/api/accounts/admin/audit`, a paged table newest-first, and
 * a per-row expando for the fields a column cannot hold.
 *
 * ## Every filter is the SERVER'S
 *
 * Nothing here filters an array. The route ANDs actor, subject, verbs, a time
 * range and a free-text needle across both log generations and answers a page
 * plus a total — so "1–50 of 312" is 312 matching records, not 312 records that
 * happened to be fetched. A client-side filter over a page would say "no
 * results" about a window rather than about the trail, which is the one wrong
 * answer an audit surface must never give.
 *
 * ## The verb list and the name pickers come from the server too
 *
 * `verbs` arrives in every answer (the declared union) and the two name pickers
 * are populated from `facets`, which reads the whole trail and is therefore
 * asked for ONCE, on the first load, not on every page. A hard-coded verb list
 * would fall behind the day a new verb is recorded, and a filter that cannot
 * name an administrator is a filter that says they did nothing.
 *
 * ## `truncated` is surfaced, loudly
 *
 * The log rotates and keeps two generations. When a rotated generation exists
 * the route says the trail MAY reach further back than this window — it cannot
 * tell the first rotation (nothing lost) from the second (the oldest generation
 * dropped), and it errs toward saying so. That warning is repeated here rather
 * than swallowed: "no earlier activity" from a log that quietly rolled over is
 * a lie that costs nothing to tell and everything to believe.
 *
 * ## Read-only, like the route
 *
 * There is no delete, no edit, no "add note". An entry an administrator can
 * remove is an entry nobody can rely on, and the route has no verb for it.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select, { type SelectChangeEvent } from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { useAccountsSettings } from "./settings";
import { fetchAudit, fmtBytes, fmtWhen, type AuditEntryWire, type AuditPageWire } from "./adminApi";

/** Page sizes. The route caps at its own maximum and says so in every answer;
 *  these stay well inside it. */
const PAGE_SIZES = [25, 50, 100, 200];

/** How a verb reads to a person. A verb with no entry here renders as itself —
 *  a new server-side verb must show up as a row, never vanish because this map
 *  had not heard of it. */
const VERB_LABEL: Record<string, string> = {
  "file-list": "listed a directory",
  "file-view": "viewed a file",
  "file-download": "downloaded a file",
  "policy-set": "pinned a policy field",
  "policy-clear": "un-pinned a policy field",
  "user-create": "created an account",
  "user-role": "changed a role",
  "password-reset": "issued a temp password",
  "profile-edit": "edited a profile",
};

/** Colour by what the verb DOES, not by which subsystem it is in: reads are
 *  neutral, writes are the accent, a credential is a warning. */
function verbColor(verb: string): string {
  if (verb.startsWith("file-")) return token("dim");
  if (verb === "password-reset") return token("warn");
  return token("accent");
}

/** A `datetime-local` value → what the route takes. The input has no timezone,
 *  so `Date.parse` reads it as local time, which is what the person typing it
 *  meant; epoch ms is sent so the wire never carries an ambiguous stamp. */
function localToEpoch(value: string): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? String(t) : undefined;
}

/** The one-line summary a row shows without being expanded. */
function summarize(entry: AuditEntryWire): string {
  if (entry.path) return `${entry.root ? `${entry.root}/` : ""}${entry.path}`;
  if (entry.field) return `${entry.field}: ${entry.from ?? "—"} → ${entry.to ?? "—"}`;
  if (entry.root) return entry.root;
  return entry.detail ?? "";
}

/** One expanded record — every field that is present, and nothing invented for
 *  the ones that are not. */
function Detail({ entry }: { entry: AuditEntryWire }) {
  const fields: [string, string][] = [
    ["record", entry.id],
    ["when", `${fmtWhen(entry.at)} (${entry.at})`],
    ["actor", entry.actor],
    ["subject", entry.subject],
    ["verb", entry.verb],
    ...(entry.root ? ([["root", entry.root]] as [string, string][]) : []),
    ...(entry.path ? ([["path", entry.path]] as [string, string][]) : []),
    ...(entry.field ? ([["field", entry.field]] as [string, string][]) : []),
    ...(entry.from !== undefined ? ([["from", entry.from]] as [string, string][]) : []),
    ...(entry.to !== undefined ? ([["to", entry.to]] as [string, string][]) : []),
    ...(entry.bytes !== undefined
      ? ([["bytes", `${fmtBytes(entry.bytes)} (${entry.bytes})`]] as [string, string][])
      : []),
    ...(entry.detail ? ([["detail", entry.detail]] as [string, string][]) : []),
  ];

  return (
    <Box
      sx={{
        border: `1px solid ${token("edge")}`,
        borderRadius: token("radius"),
        background: token("panel2"),
        p: 1.25,
        my: 0.75,
      }}
    >
      <Stack sx={{ gap: 0.25 }}>
        {fields.map(([label, value]) => (
          <Stack key={label} direction="row" sx={{ gap: 1, alignItems: "baseline" }}>
            <Typography
              sx={{
                fontSize: 10.5,
                color: token("dim"),
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                width: 76,
                flexShrink: 0,
              }}
            >
              {label}
            </Typography>
            <Typography sx={{ fontSize: 11.5, fontFamily: token("mono"), wordBreak: "break-all" }}>
              {value}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

/* ================================== the tab =================================== */

export default function AdminAuditTab() {
  const settings = useAccountsSettings();

  // The applied query — what the last request was made with. The inputs below
  // write straight into it because every filter is a server round trip anyway;
  // there is no "apply" button to forget to press.
  const [actor, setActor] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [verbs, setVerbs] = React.useState<string[]>([]);
  const [since, setSince] = React.useState("");
  const [until, setUntil] = React.useState("");
  const [q, setQ] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [limit, setLimit] = React.useState(50);

  const [page, setPage] = React.useState<AuditPageWire | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);

  /** Facets read the whole trail, so they are fetched once and kept — the verb
   *  list rides along with every answer and is refreshed for free. */
  const [facets, setFacets] = React.useState<{ actors: string[]; subjects: string[] } | null>(null);
  const [allVerbs, setAllVerbs] = React.useState<string[]>([]);

  const run = React.useCallback(
    async (wantFacets: boolean) => {
      setBusy(true);
      const res = await fetchAudit({
        actor: actor || undefined,
        subject: subject || undefined,
        verbs,
        since: localToEpoch(since),
        until: localToEpoch(until),
        q: q || undefined,
        offset,
        limit,
        facets: wantFacets,
      });
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setPage(res.data);
      if (res.data.verbs.length > 0) setAllVerbs(res.data.verbs);
      if (res.data.facets) setFacets(res.data.facets);
    },
    [actor, subject, verbs, since, until, q, offset, limit],
  );

  // The facets flag is decided by whether they have ever been read, not by the
  // effect's dependencies — a filter change must not re-read the whole trail.
  const gotFacets = facets !== null;
  React.useEffect(() => {
    void run(!gotFacets);
    // `gotFacets` is deliberately not a dependency: it flips to true INSIDE this
    // effect's own call, and depending on it would fire a second, pointless
    // request every time the facets first arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const clearAll = () => {
    setActor("");
    setSubject("");
    setVerbs([]);
    setSince("");
    setUntil("");
    setQ("");
    setOffset(0);
  };

  const filtered =
    actor !== "" || subject !== "" || verbs.length > 0 || since !== "" || until !== "" || q !== "";

  const onVerbs = (e: SelectChangeEvent<string[]>) => {
    const value = e.target.value;
    setVerbs(typeof value === "string" ? value.split(",") : value);
    setOffset(0);
  };

  const entries = page?.entries ?? [];

  return (
    <Stack sx={{ gap: 1.5, maxWidth: 1180 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>Audit trail</Typography>
        <Tooltip title="Re-run the query">
          <span>
            <IconButton size="small" disabled={busy} onClick={() => void run(false)}>
              <Glyph id="icon-reload" size={14} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {/* -------------------------------- filters ------------------------------ */}
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", alignItems: "flex-start" }}>
        <TextField
          select
          size="small"
          label="Actor"
          value={actor}
          onChange={(e) => {
            setActor(e.target.value);
            setOffset(0);
          }}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="" sx={{ fontSize: 12.5 }}>
            Anyone
          </MenuItem>
          {(facets?.actors ?? []).map((name) => (
            <MenuItem key={name} value={name} sx={{ fontSize: 12.5 }}>
              {name}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Subject"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setOffset(0);
          }}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="" sx={{ fontSize: 12.5 }}>
            Anyone
          </MenuItem>
          {(facets?.subjects ?? []).map((name) => (
            <MenuItem key={name} value={name} sx={{ fontSize: 12.5 }}>
              {name}
            </MenuItem>
          ))}
        </TextField>

        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="audit-verbs">Verb</InputLabel>
          <Select
            labelId="audit-verbs"
            label="Verb"
            multiple
            value={verbs}
            onChange={onVerbs}
            renderValue={(selected) =>
              selected.length === allVerbs.length ? "every verb" : selected.join(", ")
            }
          >
            {allVerbs.map((verb) => (
              <MenuItem key={verb} value={verb}>
                <Checkbox size="small" checked={verbs.includes(verb)} />
                <ListItemText
                  primary={verb}
                  secondary={VERB_LABEL[verb]}
                  slotProps={{
                    primary: { sx: { fontSize: 12.5, fontFamily: token("mono") } },
                    secondary: { sx: { fontSize: 10.5 } },
                  }}
                />
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          type="datetime-local"
          size="small"
          label="From"
          value={since}
          onChange={(e) => {
            setSince(e.target.value);
            setOffset(0);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          type="datetime-local"
          size="small"
          label="To"
          value={until}
          onChange={(e) => {
            setUntil(e.target.value);
            setOffset(0);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <TextField
          size="small"
          label="Path, field or detail"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          sx={{ minWidth: 200 }}
        />

        <Button
          size="small"
          disabled={!filtered}
          onClick={clearAll}
          sx={{ fontSize: 11.5, textTransform: "none", mt: 0.5 }}
        >
          Clear
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}

      {page?.truncated && (
        <Alert severity="warning" variant="outlined" sx={{ fontSize: 12 }}>
          The log has rotated at least once. Records older than this window may have been dropped —
          the trail cannot tell a first rotation (nothing lost) from a later one, so treat the
          earliest entry here as the earliest it can still see, not as the earliest that happened.
        </Alert>
      )}

      {/* --------------------------------- table ------------------------------- */}
      {page === null ? (
        busy ? (
          <CircularProgress size={20} />
        ) : (
          !error && (
            <Typography sx={{ fontSize: 12, color: token("dim") }}>
              The trail could not be read.
            </Typography>
          )
        )
      ) : entries.length === 0 ? (
        <Box
          sx={{
            border: `1px dashed ${token("edge")}`,
            borderRadius: token("radius"),
            p: 2.5,
            maxWidth: 620,
          }}
        >
          <Typography sx={{ fontSize: 12.5 }}>
            {filtered
              ? "Nothing matches those filters. The trail itself may not be empty — clear them to see everything it holds."
              : "Nothing recorded. No administrator has browsed a member's files, moved a policy field, created an account or issued a credential since this log began."}
          </Typography>
        </Box>
      ) : (
        <>
          <Table size={settings.denseTables ? "small" : "medium"}>
            <TableHead>
              <TableRow>
                {["When", "Actor", "Did", "To", "What", ""].map((h) => (
                  <TableCell key={h} sx={{ fontSize: 11.5, color: token("dim") }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const expanded = open === entry.id;
                return (
                  <React.Fragment key={entry.id}>
                    <TableRow
                      hover
                      onClick={() => setOpen(expanded ? null : entry.id)}
                      sx={{ cursor: "pointer", "& td": { borderBottom: expanded ? "none" : undefined } }}
                    >
                      <TableCell sx={{ fontSize: 11.5, color: token("dim"), whiteSpace: "nowrap" }}>
                        {fmtWhen(entry.at)}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: token("mono") }}>
                        {entry.actor}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={VERB_LABEL[entry.verb] ?? entry.verb}
                          sx={{
                            height: 19,
                            fontSize: 10.5,
                            color: verbColor(entry.verb),
                            borderColor: verbColor(entry.verb),
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: token("mono") }}>
                        {entry.subject}
                      </TableCell>
                      <TableCell
                        sx={{
                          fontSize: 11.5,
                          fontFamily: token("mono"),
                          maxWidth: 340,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {summarize(entry)}
                      </TableCell>
                      <TableCell align="right" sx={{ width: 34 }}>
                        <Box
                          sx={{
                            display: "flex",
                            // The contract's chevron points down, which is the
                            // open state; closed turns it toward the row.
                            transform: expanded ? "none" : "rotate(-90deg)",
                            transition: "transform 120ms",
                          }}
                        >
                          <Glyph id="icon-chevron-down" size={11} />
                        </Box>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 0, borderBottom: expanded ? undefined : "none" }}>
                        <Collapse in={expanded} unmountOnExit>
                          <Detail entry={entry} />
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>

          <TablePagination
            component="div"
            count={page.total}
            page={Math.floor(page.offset / Math.max(1, page.limit))}
            rowsPerPage={page.limit}
            rowsPerPageOptions={PAGE_SIZES}
            onPageChange={(_, next) => setOffset(next * limit)}
            onRowsPerPageChange={(e) => {
              setLimit(Number(e.target.value));
              setOffset(0);
            }}
            sx={{ "& .MuiTablePagination-toolbar": { minHeight: 40 }, fontSize: 12 }}
          />
        </>
      )}
    </Stack>
  );
}
