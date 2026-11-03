// Temporary: learn how the VC job boards serve their jobs (run in CI, which can reach them).
const hosts = process.argv.slice(2);
const UA = { 'user-agent': 'Mozilla/5.0 (JobSnipe probe)' };
const cut = (s, n = 600) => (typeof s === 'string' ? s : JSON.stringify(s)).slice(0, n);
for (const host of hosts) {
  console.log(`\n===== ${host}`);
  try {
    const r = await fetch(`https://${host}/jobs`, { headers: UA, redirect: 'follow' });
    const html = await r.text();
    console.log('page', r.status, r.url, html.length, 'bytes');
    for (const k of ['getro', 'consider', 'pallet', '__NEXT_DATA__', 'api.getro.com', 'cdn.getro.com']) console.log(' has', k, html.includes(k));
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      const d = JSON.parse(m[1]);
      const pp = d.props?.pageProps ?? {};
      console.log(' pageProps keys', Object.keys(pp));
      const st = pp.initialState ?? pp;
      console.log(' state keys', Object.keys(st));
      if (st.network) console.log(' network', cut({ id: st.network.id, slug: st.network.slug, name: st.network.name, domain: st.network.domain, url: st.network.url }));
      const jobs = st.jobs ?? pp.jobs;
      if (jobs) {
        console.log(' jobs keys', Object.keys(jobs));
        const list = jobs.found ?? jobs.list ?? jobs.items ?? jobs.results;
        if (Array.isArray(list) && list[0]) console.log(' first job', cut(list[0], 1500));
        console.log(' total', jobs.total ?? jobs.count ?? jobs.totalCount);
      }
      const id = st.network?.id;
      if (id) {
        for (const body of [{ hitsPerPage: 3, page: 0, filters: {}, query: 'product manager' }]) {
          const a = await fetch(`https://api.getro.com/api/v2/collections/${id}/search/jobs`, {
            method: 'POST', headers: { ...UA, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
          });
          const t = await a.text();
          console.log(' api', a.status, a.headers.get('etag'), cut(t, 2500));
        }
      }
    } else {
      const apis = [...new Set(html.match(/https?:\/\/[a-z0-9.-]*(api|consider|getro)[a-z0-9.-]*\/[^"' )]{0,80}/gi) ?? [])].slice(0, 10);
      console.log(' api-ish urls', apis);
    }
  } catch (e) {
    console.log(' error', e.message);
  }
}
