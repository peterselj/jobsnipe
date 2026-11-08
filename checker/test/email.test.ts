import { describe, expect, it } from "vitest";
import { cleanJobUrl, jobsFromEmail, sourceLabel, type InboundEmail } from "../src/discover/email.js";

const email = (over: Partial<InboundEmail>): InboundEmail => ({
  id: 1, profile_id: "josh-id", from_name: null, from_address: null, subject: null, html: null, text_body: null,
  received_at: "2026-11-09T12:00:00.000Z", ...over,
});

// Shaped like a LinkedIn job alert: a table row per job, title link, then "Company · Place".
const LINKEDIN = `<html><body><table>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=x">Senior Product Manager, Payments</a></td></tr>
<tr><td><span>Northwind</span> &middot; <span>New York, NY (Hybrid)</span></td></tr>
<tr><td>Actively recruiting</td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4087654321/?trackingId=def">Staff Product Manager</a></td></tr>
<tr><td>Brightpath &middot; Toronto, ON (Remote)</td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/search/?keywords=pm">See all jobs</a></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/psettings/job-alerts">Manage alerts</a></td></tr>
</table></body></html>`;

// Shaped like an Indeed alert: title, then company and place on their own lines.
const INDEED = `<div><a href="https://www.indeed.com/rc/clk?jk=abc123&amp;from=ja">Lead Product Manager</a><br>Fieldline Robotics<br>Remote<br>$180,000 - $220,000 a year</div>
<div><a href="https://www.indeed.com/rc/clk?jk=def456&amp;from=ja">View job</a></div>`;

describe("job-alert emails", () => {
  it("reads LinkedIn alerts: title, company, place, and a clean link", () => {
    const jobs = jobsFromEmail(email({ from_name: "LinkedIn Job Alerts", from_address: "jobalerts-noreply@linkedin.com", html: LINKEDIN }));
    expect(jobs.map((j) => [j.title, j.company, j.locations, j.url, j.via])).toEqual([
      ["Senior Product Manager, Payments", "Northwind", ["New York, NY (Hybrid)", "Actively recruiting"], "https://www.linkedin.com/jobs/view/4012345678/", ["LinkedIn alert"]],
      ["Staff Product Manager", "Brightpath", ["Toronto, ON (Remote)"], "https://www.linkedin.com/jobs/view/4087654321/", ["LinkedIn alert"]],
    ]);
    expect(jobs[1].workplace).toBe("remote");
    expect(jobs[0].forProfile).toBe("josh-id");
  });

  it("reads Indeed alerts and skips links that aren't a job title", () => {
    const jobs = jobsFromEmail(email({ from_address: "alert@indeed.com", html: INDEED }));
    expect(jobs.map((j) => [j.title, j.company, j.locations[0], j.workplace, j.url])).toEqual([
      ["Lead Product Manager", "Fieldline Robotics", "Remote", "remote", "https://www.indeed.com/viewjob?jk=abc123"],
    ]);
  });

  it("reads plain-text emails, and links straight to company job boards", () => {
    const jobs = jobsFromEmail(email({ from_name: "Sequoia Capital Jobs", from_address: "jobs@consider.com", text_body: "Product Lead, Growth\nhttps://jobs.ashbyhq.com/acme/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e\nAcme · New York" }));
    // In plain text the link's own text is the address, so it can't be a title: nothing is guessed.
    expect(jobs).toEqual([]);
    const html = jobsFromEmail(email({ from_name: "Sequoia Capital Jobs", html: `<a href="https://jobs.ashbyhq.com/acme/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e">Product Lead, Growth</a><br>Acme · New York` }));
    expect(html.map((j) => [j.title, j.company, j.ats, j.board, j.via])).toEqual([["Product Lead, Growth", "Acme", "ashby", "acme", ["Sequoia Capital Jobs alert"]]]);
  });

  it("labels where alerts came from and drops tracking from links", () => {
    expect(sourceLabel({ from_name: "Wellfound", from_address: "team@wellfound.com" })).toBe("Wellfound alert");
    expect(sourceLabel({ from_name: null, from_address: "news@example.org" })).toBe("example.org alert");
    expect(cleanJobUrl("https://boards.greenhouse.io/acme/jobs/123?utm_source=x&gh_src=y")).toBe("https://boards.greenhouse.io/acme/jobs/123?gh_src=y");
  });
});
