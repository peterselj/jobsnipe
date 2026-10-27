import { isMap, isSeq, parseDocument, type Document } from 'yaml';
import type { CompanyConfig } from './types';

// Edits profiles/<id>.yaml in place: comments and formatting elsewhere in the file survive,
// and new entries use the same one-line `{ name: …, ats: …, board: … }` style.

function doc(text: string): Document {
  const d = parseDocument(text);
  if (d.errors.length) throw new Error(`Profile file has a YAML error: ${d.errors[0].message}`);
  return d;
}

function seq(d: Document) {
  let s = d.get('companies', true);
  if (!s) {
    d.set('companies', d.createNode([]));
    s = d.get('companies', true);
  }
  if (!isSeq(s)) throw new Error('"companies" in the profile file is not a list');
  return s;
}

export function listCompanies(text: string): CompanyConfig[] {
  const v = doc(text).toJS()?.companies;
  return Array.isArray(v) ? v : [];
}

const keyOf = (c: CompanyConfig) => (c.ats === 'none' ? `none:${c.name.toLowerCase()}` : `${c.ats}:${c.board?.toLowerCase()}`);

function node(d: Document, c: CompanyConfig) {
  const clean = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== ''));
  // Short entries stay on one line like the hand-written ones; entries with notes get a block.
  const n = d.createNode(clean);
  if (isMap(n)) n.flow = !clean.note && !clean.careers_url;
  return n;
}

export function addCompany(text: string, c: CompanyConfig): string {
  if (listCompanies(text).some((x) => keyOf(x) === keyOf(c))) {
    throw new Error(`Already watching ${c.name}.`);
  }
  const d = doc(text);
  seq(d).items.push(node(d, c));
  return d.toString();
}

/** Replace the entry at `index` (as returned by listCompanies), e.g. to point it at a different board. */
export function replaceCompany(text: string, index: number, c: CompanyConfig): string {
  const others = listCompanies(text).filter((_, i) => i !== index);
  if (others.some((x) => keyOf(x) === keyOf(c))) throw new Error(`Already watching that board.`);
  const d = doc(text);
  const s = seq(d);
  if (!s.items[index]) throw new Error('That company is no longer in the profile file; reload and try again.');
  s.items[index] = node(d, c);
  return d.toString();
}

export function removeCompany(text: string, index: number): string {
  const d = doc(text);
  const s = seq(d);
  if (!s.items[index]) throw new Error('That company is no longer in the profile file; reload and try again.');
  s.items.splice(index, 1);
  return d.toString();
}
