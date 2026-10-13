// Minimal .xlsx reader (tolerates namespace-prefixed XML such as <x:sheet>, which some tools write): enough for a data-only workbook (strings, numbers, booleans, formula cached values).
// An .xlsx file is a zip of XML parts; we read the workbook's sheet list, the shared strings and each sheet's cells.
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

/** Text content of all <t> runs inside an XML fragment (handles rich text). */
const textOf = (xml) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decode(m[1])).join('');

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

export function readWorkbook(path) {
  const files = unzipSync(readFileSync(path));
  const read = (p) => {
    const f = files[p];
    if (!f) throw new Error(`xlsx part missing: ${p}`);
    return strFromU8(f);
  };
  const shared = files['xl/sharedStrings.xml']
    ? [...read('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1]))
    : [];
  const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<(?:\w+:)?Relationship\s[^>]*>/g)]
    .map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const sheets = new Map();
  for (const m of read('xl/workbook.xml').matchAll(/<(?:\w+:)?sheet\s[^>]*\/?>/g)) {
    const name = decode(attr(m[0], 'name'));
    const target = rels[attr(m[0], 'r:id')].replace(/^\/?(xl\/)?/, '');
    sheets.set(name, () => parseSheet(read(`xl/${target}`), shared));
  }
  return {
    sheetNames: [...sheets.keys()],
    /** Cells of a sheet as { "A1": value, ... }. */
    sheet(name) {
      const load = sheets.get(name);
      if (!load) throw new Error(`Missing sheet "${name}"`);
      return load();
    },
  };
}

function parseSheet(xml, shared) {
  const cells = {};
  for (const m of xml.matchAll(/<(?:\w+:)?c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
    const tag = ` ${m[1]}`;
    const ref = attr(tag, 'r');
    const type = attr(tag, 't');
    const body = m[2] ?? '';
    const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
    let value = null;
    if (type === 's') value = v !== undefined ? shared[Number(v)] : null;
    else if (type === 'inlineStr') value = textOf(body);
    else if (type === 'str') value = v !== undefined ? decode(v) : null;
    else if (type === 'b') value = v === '1';
    else if (type === 'e') value = null;
    else if (v !== undefined) value = Number(v);
    if (value !== null && value !== '') cells[ref] = value;
  }
  return cells;
}
