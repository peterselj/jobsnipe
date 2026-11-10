// Temporary: learn the shape of three public job-board APIs (run in CI, which can reach them).
const UA = { 'user-agent': 'JobSnipe/0.1 (personal job alerts)', accept: 'application/json' };
const cut = (s, n = 1400) => (typeof s === 'string' ? s : JSON.stringify(s)).slice(0, n);
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 160 ? v.slice(0, 160) + '…' : v)));
async function get(url) {
  const r = await fetch(url, { headers: UA });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch {}
  return { status: r.status, cors: r.headers.get('access-control-allow-origin'), etag: r.headers.get('etag'), j, t };
}
console.log('===== SmartRecruiters');
for (const c of ['SWIGGY', 'Visa', 'nosuchcompanyzzz9']) {
  const r = await get(`https://api.smartrecruiters.com/v1/companies/${c}/postings?limit=2&offset=0`);
  console.log(c, r.status, 'cors', r.cors, 'etag', r.etag, 'keys', r.j && Object.keys(r.j), 'total', r.j?.totalFound);
  if (r.j?.content?.[0]) {
    console.log(' first', cut(strip(r.j.content[0])));
    const d = await get(`https://api.smartrecruiters.com/v1/companies/${c}/postings/${r.j.content[0].id}`);
    console.log(' detail', d.status, 'keys', d.j && Object.keys(d.j), cut(strip({ postingUrl: d.j?.postingUrl, applyUrl: d.j?.applyUrl, location: d.j?.location, compensation: d.j?.compensation, sections: d.j?.jobAd && Object.keys(d.j.jobAd.sections ?? {}) })));
  }
}
console.log('===== Workable');
for (const c of ['workable', 'hugging-face', 'nosuchcompanyzzz9']) {
  const r = await get(`https://apply.workable.com/api/v1/widget/accounts/${c}?details=true`);
  console.log(c, r.status, 'cors', r.cors, 'etag', r.etag, 'keys', r.j && Object.keys(r.j), 'jobs', r.j?.jobs?.length, r.j ? '' : cut(r.t, 150));
  if (r.j?.jobs?.[0]) console.log(' first', cut(strip(r.j.jobs[0])));
}
console.log('===== Recruitee');
for (const c of ['recruitee', 'bunq', 'nosuchcompanyzzz9']) {
  const r = await get(`https://${c}.recruitee.com/api/offers/`);
  console.log(c, r.status, 'cors', r.cors, 'etag', r.etag, 'keys', r.j && Object.keys(r.j), 'offers', r.j?.offers?.length, r.j ? '' : cut(r.t, 150));
  if (r.j?.offers?.[0]) console.log(' first', cut(strip(r.j.offers[0]), 1800));
}
