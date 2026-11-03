// Temporary: learn how Getro boards search (run in CI, which can reach them).
const UA = { 'user-agent': 'Mozilla/5.0 (JobSnipe probe)' };
const cut = (s, n = 800) => (typeof s === 'string' ? s : JSON.stringify(s)).slice(0, n);
for (const host of ['jobs.generalcatalyst.com', 'portfoliojobs.a16z.com']) {
  console.log(`\n===== ${host}`);
  const r = await fetch(`https://${host}/jobs`, { headers: UA });
  const html = await r.text();
  console.log('page', r.status, html.length, 'getro', html.includes('getro'), 'consider', html.includes('consider'));
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) { console.log(cut(html.replace(/\s+/g, ' '), 1500)); continue; }
  const d = JSON.parse(m[1]);
  const n = d.props.pageProps.network;
  console.log('network keys', Object.keys(n ?? {}));
  console.log('network', cut({ id: n?.id, slug: n?.slug, name: n?.name, url: n?.url, domain: n?.domain }));
  const api = d.props.pageProps.initialState?.api;
  console.log('api state', cut(api, 400));
  const urls = [...new Set(html.match(/https?:\/\/[a-z0-9.-]*getro[a-z0-9.-]*\/[a-z0-9/_.-]{0,60}/gi) ?? [])].slice(0, 15);
  console.log('getro urls', urls);
  const id = n?.id;
  const tries = [
    ['POST', `https://api.getro.com/api/v2/collections/${id}/search/jobs`, { hitsPerPage: 3, page: 0, filters: { page: 0 }, query: 'product manager' }],
    ['GET', `https://api.getro.com/api/v2/collections/${id}/search/jobs?hitsPerPage=3&page=0&query=product%20manager`],
    ['POST', `https://api.getro.com/v2/collections/${id}/search/jobs`, { hitsPerPage: 3, page: 0, query: 'product manager' }],
  ];
  for (const [method, url, body] of tries) {
    try {
      const a = await fetch(url, { method, headers: { ...UA, 'content-type': 'application/json', accept: 'application/json', origin: `https://${host}`, referer: `https://${host}/jobs` }, body: body && JSON.stringify(body) });
      const t = await a.text();
      console.log('try', method, url, a.status, cut(t, 1800));
    } catch (e) { console.log('try', url, 'error', e.message); }
  }
  // What the page does when you search: query string form.
  const q = await fetch(`https://${host}/jobs?q=product%20manager`, { headers: UA });
  const qh = await q.text();
  const qm = qh.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (qm) { const j = JSON.parse(qm[1]).props.pageProps.initialState.jobs; console.log('?q= total', j.total, 'found', j.found.length, j.found.slice(0, 3).map((x) => x.title)); }
}
