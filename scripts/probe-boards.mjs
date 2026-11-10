// Temporary: compact shapes of three public job-board APIs (run in CI).
const UA = { 'user-agent': 'JobSnipe/0.1 (personal job alerts)', accept: 'application/json' };
const shape = (o, d = 0) => o === null ? 'null' : Array.isArray(o) ? `[${o.length ? shape(o[0], d + 1) : ''}]` : typeof o === 'object' ? (d > 2 ? '{…}' : `{${Object.entries(o).map(([k, v]) => `${k}:${shape(v, d + 1)}`).join(',')}}`) : typeof o === 'string' ? `"${o.slice(0, 28)}"` : String(o);
async function get(url) { const r = await fetch(url, { headers: UA }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch {} return { status: r.status, cors: r.headers.get('access-control-allow-origin'), etag: !!r.headers.get('etag'), j, t }; }
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o && k in o).map((k) => [k, o[k]]));
for (const c of ['SWIGGY', 'Visa', 'nosuchcompanyzzz9']) {
  const r = await get(`https://api.smartrecruiters.com/v1/companies/${c}/postings?limit=100&offset=0`);
  console.log('SR', c, r.status, 'cors', r.cors, 'etag', r.etag, 'total', r.j?.totalFound, 'got', r.j?.content?.length, 'top', r.j && Object.keys(r.j).join());
  const p = r.j?.content?.[0];
  if (p) {
    console.log(' SR list', shape(pick(p, ['id', 'name', 'uuid', 'refNumber', 'company', 'releasedDate', 'location', 'ref', 'typeOfEmployment', 'experienceLevel', 'function'])).slice(0, 900));
    const d = await get(`https://api.smartrecruiters.com/v1/companies/${c}/postings/${p.id}`);
    console.log(' SR detail', d.status, shape(pick(d.j, ['postingUrl', 'applyUrl', 'compensation', 'location'])).slice(0, 500), 'sections', d.j?.jobAd && Object.keys(d.j.jobAd.sections ?? {}).join());
  }
}
for (const c of ['workable', 'hugging-face', 'nosuchcompanyzzz9']) {
  const r = await get(`https://apply.workable.com/api/v1/widget/accounts/${c}?details=true`);
  console.log('WK', c, r.status, 'cors', r.cors, 'etag', r.etag, 'top', r.j ? Object.keys(r.j).join() : r.t.slice(0, 80), 'jobs', r.j?.jobs?.length);
  const p = r.j?.jobs?.[0];
  if (p) console.log(' WK job', shape(Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'description'))).slice(0, 900), 'descLen', (p.description ?? '').length);
}
for (const c of ['bunq', 'nosuchcompanyzzz9']) {
  const r = await get(`https://${c}.recruitee.com/api/offers/`);
  console.log('RC', c, r.status, 'cors', r.cors, 'etag', r.etag, 'offers', r.j?.offers?.length);
  const p = r.j?.offers?.[0];
  if (p) console.log(' RC offer', shape(pick(p, ['id', 'slug', 'title', 'careers_url', 'careers_apply_url', 'location', 'city', 'country', 'country_code', 'state_code', 'remote', 'hybrid', 'on_site', 'published_at', 'created_at', 'status', 'salary', 'company_name', 'locations', 'department'])).slice(0, 1100));
}
