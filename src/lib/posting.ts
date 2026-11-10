import { parseBoardUrl } from '../../shared/ats';
import { money } from '../../shared/format';
import { safeHttpUrl } from '../../shared/url';
import type { Match } from './types';

// "Tailor resume": hand a role to ResumeMachine (peterselj.github.io/resumemachine), which tailors
// your resume inside your own AI assistant. It wants the posting's full text, so for jobs on
// Greenhouse, Lever and Ashby the text is read from the board's public API and put on your
// clipboard, ready to paste. For other sites you copy it from the job page yourself.

export const RESUMEMACHINE = 'https://peterselj.github.io/resumemachine/';

type Role = Pick<Match, 'id' | 'title' | 'company' | 'url' | 'where' | 'comp'>;

/** HTML as readable text, without running or loading anything in it. */
export function htmlToText(html: string): string {
  const withBreaks = html.replace(/<li[^>]*>/gi, '\n- ').replace(/<br\s*\/?>|<\/(p|div|h[1-6]|ul|ol|tr)>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  doc.querySelectorAll('script, style').forEach((el) => el.remove());
  const text = doc.body.textContent ?? '';
  return text.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Where a role's posting lives: from our own id ("greenhouse:acme:123") or, failing that, its link. */
function locate(m: Role): { ats: string; board: string; id: string } | undefined {
  const parts = m.id.split(':');
  if (parts.length >= 3 && ['greenhouse', 'lever', 'ashby'].includes(parts[0])) {
    return { ats: parts[0], board: parts.slice(1, -1).join(':'), id: parts[parts.length - 1] };
  }
  const board = parseBoardUrl(m.url);
  const u = safeHttpUrl(m.url);
  if (!board || !u) return undefined;
  const url = new URL(u);
  const id = url.searchParams.get('gh_jid') ?? url.pathname.match(/\/jobs\/(\d+)/)?.[1] ?? url.pathname.match(/\/([0-9a-f]{8}-[0-9a-f-]{27})/i)?.[1];
  return id ? { ats: board.ats, board: board.board, id } : undefined;
}

/** The posting's description as text, when its board lets the page read it. */
export async function postingDescription(m: Role, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<string | undefined> {
  const at = locate(m);
  if (!at) return undefined;
  const get = async (api: string) => {
    try {
      const res = await fetchImpl(api, { signal: AbortSignal.timeout(15_000) });
      return res.ok ? await res.json() : undefined;
    } catch {
      return undefined;
    }
  };
  const b = encodeURIComponent(at.board);
  if (at.ats === 'greenhouse') {
    const j = await get(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs/${encodeURIComponent(at.id)}`);
    // Greenhouse sends the description as HTML that has itself been escaped, so it's decoded twice.
    if (!j?.content) return undefined;
    const once = htmlToText(j.content);
    return once.includes('<') ? htmlToText(once) : once;
  }
  if (at.ats === 'lever') {
    const j = await get(`https://api.lever.co/v0/postings/${b}/${encodeURIComponent(at.id)}`);
    if (!j?.descriptionPlain && !j?.lists) return undefined;
    const lists = (j.lists ?? []).map((l: { text?: string; content?: string }) => `${l.text ?? ''}\n${htmlToText(l.content ?? '')}`);
    return [j.descriptionPlain, ...lists, j.additionalPlain].filter(Boolean).join('\n\n').trim();
  }
  const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${b}`);
  const j = d?.jobs?.find((x: { id?: string; jobUrl?: string }) => x.id === at.id || x.jobUrl === m.url);
  return j?.descriptionPlain ?? (j?.descriptionHtml ? htmlToText(j.descriptionHtml) : undefined);
}

/** What goes on the clipboard: the role's facts, then the posting. */
export function postingForResume(m: Role, description: string): string {
  const facts = [`Job posting: ${m.title} at ${m.company}`, m.where && `Location: ${m.where}`, m.comp && `Pay: ${money(m.comp)}`, m.url && `Link: ${m.url}`];
  return `${facts.filter(Boolean).join('\n')}\n\n${description}`;
}

/** ResumeMachine's page, told which role is coming and whether its text is already on the clipboard. */
export function resumeMachineLink(m: Role, copied: boolean): string {
  const q = new URLSearchParams({ from: 'jobsnipe', title: m.title, company: m.company });
  if (safeHttpUrl(m.url)) q.set('job', m.url);
  if (copied) q.set('copied', '1');
  return `${RESUMEMACHINE}?${q}`;
}
