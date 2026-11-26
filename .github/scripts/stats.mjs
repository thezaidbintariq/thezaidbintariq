// Builds dist/stats.svg + dist/stats-dark.svg — a flat, Claude-style "By the numbers" card.
import { mkdirSync, writeFileSync } from "node:fs";

const LOGIN = process.env.GH_LOGIN;
const TOKEN = process.env.GH_TOKEN;
const MOCK = process.env.MOCK_DATA; // path to JSON for local preview

const QUERY = `query($login:String!){ user(login:$login){
  followers{ totalCount }
  publicRepos: repositories(privacy:PUBLIC, ownerAffiliations:OWNER){ totalCount }
  repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
    nodes{ stargazerCount languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name } } } } }
  contributionsCollection{
    totalCommitContributions totalPullRequestContributions totalIssueContributions
    totalPullRequestReviewContributions restrictedContributionsCount
    contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } } } }`;

async function load() {
  if (MOCK) return JSON.parse((await import("node:fs")).readFileSync(MOCK, "utf8"));
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data.user;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : n.toLocaleString("en-US"));

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let i = days.length - 1, current = 0;
  if (i >= 0 && days[i].contributionCount === 0) i--; // today not counted yet
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;
  return { current, longest };
}

const THEMES = {
  light: { bg: "#FAF9F5", line: "#E8E6DC", ink: "#141413", muted: "#87867F", clay: "#D97757",
           langs: ["#D97757", "#141413", "#B5583A", "#87867F", "#E3A88C", "#D1CFC5"] },
  dark:  { bg: "#262624", line: "#3A3936", ink: "#FAF9F5", muted: "#A3A198", clay: "#D97757",
           langs: ["#D97757", "#FAF9F5", "#B5583A", "#A3A198", "#E3A88C", "#5E5D59"] },
};

function render(u, t) {
  const cc = u.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  const { current, longest } = streaks(days);
  const stars = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);

  const tiles = [
    ["Contributions", cc.contributionCalendar.totalContributions, "last 12 months"],
    ["Private work", cc.restrictedContributionsCount, `+ ${fmt(cc.totalCommitContributions)} public commits`],
    ["Pull requests", cc.totalPullRequestContributions, `${cc.totalPullRequestReviewContributions} reviewed`],
    ["Issues", cc.totalIssueContributions, "opened"],
    ["Current streak", current, current === 1 ? "day" : "days"],
    ["Longest streak", longest, longest === 1 ? "day" : "days"],
    ["Stars earned", stars, "on own repos"],
    ["Followers", u.followers.totalCount, `${u.publicRepos.totalCount} public repos`],
  ];

  // languages
  const sizes = {};
  for (const r of u.repositories.nodes) for (const e of r.languages.edges) sizes[e.node.name] = (sizes[e.node.name] || 0) + e.size;
  const total = Object.values(sizes).reduce((a, b) => a + b, 0) || 1;
  let langs = Object.entries(sizes).sort((a, b) => b[1] - a[1]);
  if (langs.length > 6) langs = [...langs.slice(0, 5), ["Other", langs.slice(5).reduce((a, [, s]) => a + s, 0)]];

  const W = 840, P = 32, colW = (W - P * 2) / 4, tileH = 92, top = 72;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="388" viewBox="0 0 ${W} 388" role="img" aria-label="GitHub stats for ${esc(LOGIN || "")}">
<style>
  .serif{font-family:Georgia,'Times New Roman',serif}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .fade{opacity:0;animation:in .5s ease-out forwards}
  @keyframes in{to{opacity:1}}
  @keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .bar{transform-box:fill-box;transform-origin:left;animation:grow .8s ease-out both}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="387" rx="14" fill="${t.bg}" stroke="${t.line}"/>
<text x="${P}" y="42" class="serif" font-size="22" fill="${t.ink}">By the numbers</text>
<circle cx="${W - P - 4}" cy="35" r="5" fill="${t.clay}"/>
<text x="${W - P - 16}" y="40" class="mono" font-size="11" fill="${t.muted}" text-anchor="end">updated ${new Date().toISOString().slice(0, 10)}</text>`;

  tiles.forEach(([label, val, sub], i) => {
    const c = i % 4, r = Math.floor(i / 4), x = P + c * colW, y = top + r * tileH;
    out += `
<g class="fade" style="animation-delay:${i * 60}ms">
  ${c > 0 ? `<line x1="${x}" y1="${y + 8}" x2="${x}" y2="${y + tileH - 12}" stroke="${t.line}"/>` : ""}
  <text x="${x + (c ? 18 : 0)}" y="${y + 20}" class="mono" font-size="10.5" letter-spacing="1.2" fill="${t.muted}">${esc(label.toUpperCase())}</text>
  <text x="${x + (c ? 18 : 0)}" y="${y + 58}" class="serif" font-size="34" fill="${i === 0 ? t.clay : t.ink}">${fmt(val)}</text>
  <text x="${x + (c ? 18 : 0)}" y="${y + 78}" class="mono" font-size="11" fill="${t.muted}">${esc(sub)}</text>
</g>`;
  });

  const ly = top + tileH * 2 + 14;
  out += `\n<line x1="${P}" y1="${ly - 4}" x2="${W - P}" y2="${ly - 4}" stroke="${t.line}"/>
<text x="${P}" y="${ly + 22}" class="mono" font-size="10.5" letter-spacing="1.2" fill="${t.muted}">LANGUAGES · PUBLIC REPOS</text>`;
  const barW = W - P * 2, by = ly + 36;
  let bx = P;
  langs.forEach(([name, s], i) => {
    const w = (s / total) * barW;
    out += `\n<rect class="bar" style="animation-delay:${300 + i * 80}ms" x="${bx.toFixed(1)}" y="${by}" width="${Math.max(w - 2, 1).toFixed(1)}" height="10" rx="2" fill="${t.langs[i]}"/>`;
    bx += w;
  });
  let lx = P;
  langs.forEach(([name, s], i) => {
    const pct = ((s / total) * 100).toFixed(1) + "%";
    out += `\n<g class="fade" style="animation-delay:${600 + i * 60}ms"><rect x="${lx}" y="${by + 30}" width="9" height="9" rx="2" fill="${t.langs[i]}"/><text x="${lx + 15}" y="${by + 39}" class="mono" font-size="11.5" fill="${t.ink}">${esc(name)} <tspan fill="${t.muted}">${pct}</tspan></text></g>`;
    lx += 15 + (name.length + pct.length + 1) * 7 + 22;
  });
  if (!langs.length) out += `\n<text x="${P}" y="${by + 10}" class="mono" font-size="11.5" fill="${t.muted}">No public language data yet</text>`;
  return out + "\n</svg>\n";
}

const user = await load();
mkdirSync("dist", { recursive: true });
writeFileSync("dist/stats.svg", render(user, THEMES.light));
writeFileSync("dist/stats-dark.svg", render(user, THEMES.dark));
console.log("wrote dist/stats.svg, dist/stats-dark.svg");
