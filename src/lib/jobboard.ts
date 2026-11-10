import { safeHttpUrl } from '../../shared/url';
import type { Match } from './types';

// "Send to JobBoard": hand an Interested role to JobBoard (peterselj.github.io/JobBoard), a
// referral-first tracker for the roles you're pursuing. It's opt-in per person (off by default), because
// not everyone who uses JobSnipe uses JobBoard. The link opens
// JobBoard's Add opportunity form filled in; nothing is saved there until you press Save.

export const JOBBOARD = 'https://peterselj.github.io/JobBoard/';

/**
 * The switch used to be remembered per browser. If it was on here, report that once (and forget
 * it), so it can be carried over to the account.
 */
export function takeBrowserSetting(store: Pick<Storage, 'getItem' | 'removeItem'> = localStorage): boolean {
  try {
    const on = store.getItem('jobsnipe.sendToJobBoard') === '1';
    store.removeItem('jobsnipe.sendToJobBoard');
    return on;
  } catch {
    return false;
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
