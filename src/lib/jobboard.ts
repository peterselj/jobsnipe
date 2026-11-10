import { safeHttpUrl } from '../../shared/url';
import type { Match } from './types';

// "Send to JobBoard": hand an Interested role to JobBoard (peterselj.github.io/JobBoard), a
// referral-first tracker for the roles you're pursuing. It's opt-in per browser, because JobBoard
// keeps its data in the browser too and not everyone who uses JobSnipe uses it. The link opens
// JobBoard's Add opportunity form filled in; nothing is saved there until you press Save.

export const JOBBOARD = 'https://peterselj.github.io/JobBoard/';

const PREF = 'jobsnipe.sendToJobBoard';

export function jobBoardEnabled(store: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return store.getItem(PREF) === '1';
  } catch {
    return false; // storage blocked: the button just stays off
  }
}

export function setJobBoardEnabled(on: boolean, store: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    if (on) store.setItem(PREF, '1');
    else store.removeItem(PREF);
  } catch {
    // storage blocked: nothing to remember
  }
}

/** JobBoard's Add opportunity form, filled in with this role. */
export function jobBoardLink(m: Pick<Match, 'title' | 'company' | 'url' | 'where' | 'comp'>): string {
  const q = new URLSearchParams({ add: '1', from: 'jobsnipe', company: m.company, role: m.title });
  const url = safeHttpUrl(m.url);
  if (url) q.set('url', url);
  if (m.where) q.set('location', m.where);
  if (m.comp) {
    q.set('compMin', String(Math.round(m.comp.min)));
    q.set('compMax', String(Math.round(m.comp.max)));
  }
  return `${JOBBOARD}?${q}`;
}
