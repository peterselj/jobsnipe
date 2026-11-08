// Temporary: learn how Consider job boards serve their jobs (run in CI, which can reach them).
const UA = { 'user-agent': 'Mozilla/5.0 (JobSnipe probe)' };
const cut = (s, n = 1500) => (typeof s === 'string' ? s : JSON.stringify(s)).slice(0, n);
const host = 'jobs.sequoiacap.com';
const html = await (await fetch(`https://${host}/jobs`, { headers: UA })).text();
console.log('page bytes', html.length);
// Script and data hints in the page
console.log('scripts', [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).slice(0, 12));
for (const k of ['api-boards', 'boardId', 'board_id', 'parentSlug', 'serverInitialData', '__INITIAL', 'window.']) {
  const i = html.indexOf(k);
  if (i >= 0) console.log(`ctx ${k}:`, cut(html.slice(Math.max(0, i - 150), i + 350).replace(/\s+/g, ' '), 500));
}
// Find API paths mentioned in the page's own script bundles
const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => new URL(m[1], `https://${host}`).href).slice(0, 8);
for (const s of srcs) {
  try {
    const js = await (await fetch(s, { headers: UA })).text();
    const apis = [...new Set(js.match(/["'`]\/api-boards\/[a-z0-9/_-]+["'`]/gi) ?? [])];
    if (apis.length) console.log('bundle', s, apis.slice(0, 30));
    const i = js.indexOf('search-jobs');
    if (i >= 0) console.log('search-jobs ctx', cut(js.slice(Math.max(0, i - 600), i + 900), 1500));
  } catch (e) { console.log('bundle err', s, e.message); }
}
// Guess: the search endpoint
for (const body of [
  { meta: { size: 3 }, board: { id: 'sequoia-capital', isParent: true }, query: { promoteFeatured: true } },
  { meta: { size: 3 }, board: { id: 'sequoia-capital', isParent: true }, query: { keywords: ['product manager'] } },
]) {
  const r = await fetch(`https://${host}/api-boards/search-jobs`, { method: 'POST', headers: { ...UA, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  console.log('search', r.status, cut(await r.text(), 3000));
}
