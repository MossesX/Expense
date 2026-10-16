"use client";

/** A small, dependency-free Markdown renderer for assistant replies — ported
 *  from xGallery's `Markdown.tsx`: headings, lists, code, tables, bold,
 *  italics, links. Styled through one `sx` block so it follows the theme. */
import * as React from "react";

import Box from "@mui/material/Box";

import { token } from "@axf/core";

export function Markdown({ text }: { text: string }) {
  return (
    <Box
      sx={{
        fontSize: 13,
        lineHeight: 1.55,
        "& p": { m: "0 0 8px" },
        "& h2, & h3, & h4": { m: "12px 0 6px", fontSize: 13.5, fontWeight: 700 },
        "& ul, & ol": { m: "0 0 8px", pl: 2.4 },
        "& li": { mb: 0.3 },
        "& code": { fontFamily: token("mono"), fontSize: 12, background: token("panel2"), px: 0.5, borderRadius: "3px" },
        "& pre": { m: "0 0 8px", p: 1, background: token("panel2"), borderRadius: 1, overflow: "auto", border: `1px solid ${token("edge")}` },
        "& pre code": { background: "transparent", p: 0 },
        "& blockquote": { m: "0 0 8px", pl: 1.2, borderLeft: `2px solid ${token("edge")}`, color: token("dim") },
        "& table": { borderCollapse: "collapse", mb: 1, fontSize: 12 },
        "& th, & td": { border: `1px solid ${token("edge")}`, px: 0.8, py: 0.3, textAlign: "left" },
        "& a": { color: token("accent") },
        "& hr": { border: 0, borderTop: `1px solid ${token("edge")}`, my: 1 }
      }}
    >
      {parseBlocks(text)}
    </Box>
  );
}

function parseBlocks(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} data-lang={lang || undefined}>
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(4, h[1].length + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      out.push(<Tag key={key++}>{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*+])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/.test(lines[i]) : /^\s*[-*+]\s+/.test(lines[i]))) {
        let item = lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </List>
      );
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={key++}>{inline(q.join(" "))}</blockquote>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(
        <table key={key++}>
          <thead>
            <tr>
              {header.map((c, j) => (
                <th key={j}>{inline(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, j) => (
              <tr key={j}>
                {r.map((c, k) => (
                  <td key={k}>{inline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !/^\s*\|/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }
  return out;
}

const splitRow = (line: string): string[] => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<React.Fragment key={k++}>{text.slice(last, m.index)}</React.Fragment>);
    const tok = m[0];
    if (tok.startsWith("`")) parts.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**") || tok.startsWith("__")) parts.push(<strong key={k++}>{inline(tok.slice(2, -2))}</strong>);
    else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      parts.push(
        <a key={k++} href={mm[2]} target="_blank" rel="noreferrer">
          {mm[1]}
        </a>
      );
    } else if (tok.startsWith("http")) {
      parts.push(
        <a key={k++} href={tok} target="_blank" rel="noreferrer">
          {tok}
        </a>
      );
    } else parts.push(<em key={k++}>{inline(tok.slice(1, -1))}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<React.Fragment key={k++}>{text.slice(last)}</React.Fragment>);
  return parts;
}
