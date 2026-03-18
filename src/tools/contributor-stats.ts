import { z } from "zod";

const InputSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  days: z
    .number()
    .optional()
    .default(90)
    .describe("Number of days to look back for activity (default: 90)"),
  token: z
    .string()
    .optional()
    .describe("GitHub personal access token (optional, raises rate limit)"),
});

type Input = z.infer<typeof InputSchema>;

interface ContributorStat {
  author: {
    login: string;
    html_url: string;
    avatar_url: string;
  };
  total: number;
  weeks: {
    w: number;
    a: number;
    d: number;
    c: number;
  }[];
}

interface PullRequestItem {
  number: number;
  title: string;
  user: { login: string };
  created_at: string;
  merged_at: string | null;
  state: string;
}

interface ReviewItem {
  user: { login: string };
  state: string;
  submitted_at: string;
}

async function githubFetch(
  url: string,
  token?: string
): Promise<{ data: unknown; status: number }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mcp-github-tools",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  const data = await response.json();
  return { data, status: response.status };
}

async function fetchAllPages<T>(
  baseUrl: string,
  token?: string,
  maxPages: number = 3
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const separator = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${separator}per_page=100&page=${page}`;
    const res = await githubFetch(url, token);
    if (res.status !== 200) break;
    const data = res.data as T[];
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 100) break;
  }
  return results;
}

export async function getContributorStats(input: Input): Promise<string> {
  const { owner, repo, days, token } = input;
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const cutoffISO = cutoff.toISOString();

  // Fetch contributor stats, recent PRs (merged and open), and recent closed PRs
  const [statsRes, recentMergedPRs, recentOpenPRs] = await Promise.all([
    githubFetch(`${base}/stats/contributors`, token),
    fetchAllPages<PullRequestItem>(
      `${base}/pulls?state=closed&sort=updated&direction=desc`,
      token,
      3
    ),
    fetchAllPages<PullRequestItem>(
      `${base}/pulls?state=open&sort=updated&direction=desc`,
      token,
      2
    ),
  ]);

  if (statsRes.status === 404) {
    return `Repository ${owner}/${repo} not found.`;
  }
  if (statsRes.status === 403) {
    return `Rate limit exceeded. Provide a GitHub token to increase your limit.`;
  }
  // GitHub returns 202 when stats are being computed
  if (statsRes.status === 202) {
    return `GitHub is computing contributor statistics for ${owner}/${repo}. Try again in a few seconds.`;
  }

  const allStats = (statsRes.data as ContributorStat[]) || [];

  if (!Array.isArray(allStats) || allStats.length === 0) {
    return `No contributor statistics available for ${owner}/${repo}.`;
  }

  // Filter weeks within the time range
  const cutoffTimestamp = Math.floor(cutoff.getTime() / 1000);

  interface ContributorActivity {
    username: string;
    profileUrl: string;
    totalCommitsAllTime: number;
    commitsInPeriod: number;
    additionsInPeriod: number;
    deletionsInPeriod: number;
    prsOpened: number;
    prsMerged: number;
    reviewCount: number;
  }

  const activityMap: Record<string, ContributorActivity> = {};

  for (const stat of allStats) {
    if (!stat.author) continue;

    const recentWeeks = stat.weeks.filter((w) => w.w >= cutoffTimestamp);
    const commitsInPeriod = recentWeeks.reduce((sum, w) => sum + w.c, 0);
    const additionsInPeriod = recentWeeks.reduce((sum, w) => sum + w.a, 0);
    const deletionsInPeriod = recentWeeks.reduce((sum, w) => sum + w.d, 0);

    if (commitsInPeriod > 0 || additionsInPeriod > 0) {
      activityMap[stat.author.login] = {
        username: stat.author.login,
        profileUrl: stat.author.html_url,
        totalCommitsAllTime: stat.total,
        commitsInPeriod,
        additionsInPeriod,
        deletionsInPeriod,
        prsOpened: 0,
        prsMerged: 0,
        reviewCount: 0,
      };
    }
  }

  // Count PRs
  const allPRs = [...recentMergedPRs, ...recentOpenPRs];
  for (const pr of allPRs) {
    const login = pr.user.login;
    if (new Date(pr.created_at) < cutoff) continue;

    if (!activityMap[login]) {
      activityMap[login] = {
        username: login,
        profileUrl: `https://github.com/${login}`,
        totalCommitsAllTime: 0,
        commitsInPeriod: 0,
        additionsInPeriod: 0,
        deletionsInPeriod: 0,
        prsOpened: 0,
        prsMerged: 0,
        reviewCount: 0,
      };
    }
    activityMap[login].prsOpened++;
    if (pr.merged_at) {
      activityMap[login].prsMerged++;
    }
  }

  // Fetch reviews for recent merged PRs (limited to first 10 for rate limiting)
  const mergedPRsInRange = recentMergedPRs
    .filter((pr) => pr.merged_at && new Date(pr.merged_at) >= cutoff)
    .slice(0, 10);

  const reviewPromises = mergedPRsInRange.map((pr) =>
    githubFetch(`${base}/pulls/${pr.number}/reviews?per_page=50`, token).then(
      (res) => (res.status === 200 ? (res.data as ReviewItem[]) : [])
    )
  );
  const allReviews = await Promise.all(reviewPromises);

  for (const reviews of allReviews) {
    for (const review of reviews) {
      if (!review.user) continue;
      const login = review.user.login;
      if (!activityMap[login]) {
        activityMap[login] = {
          username: login,
          profileUrl: `https://github.com/${login}`,
          totalCommitsAllTime: 0,
          commitsInPeriod: 0,
          additionsInPeriod: 0,
          deletionsInPeriod: 0,
          prsOpened: 0,
          prsMerged: 0,
          reviewCount: 0,
        };
      }
      activityMap[login].reviewCount++;
    }
  }

  // Sort contributors by activity
  const contributors = Object.values(activityMap).sort((a, b) => {
    const scoreA = a.commitsInPeriod * 3 + a.prsMerged * 5 + a.reviewCount * 2;
    const scoreB = b.commitsInPeriod * 3 + b.prsMerged * 5 + b.reviewCount * 2;
    return scoreB - scoreA;
  });

  // Determine first-time contributors (only have activity in recent weeks)
  const firstTimeContributors: string[] = [];
  for (const stat of allStats) {
    if (!stat.author) continue;
    const login = stat.author.login;
    const nonRecentWeeks = stat.weeks.filter(
      (w) => w.w < cutoffTimestamp && w.c > 0
    );
    const recentWeeks = stat.weeks.filter(
      (w) => w.w >= cutoffTimestamp && w.c > 0
    );
    if (nonRecentWeeks.length === 0 && recentWeeks.length > 0) {
      firstTimeContributors.push(login);
    }
  }

  // Aggregate stats
  const totalCommitsInPeriod = contributors.reduce(
    (s, c) => s + c.commitsInPeriod,
    0
  );
  const totalPRsOpened = contributors.reduce((s, c) => s + c.prsOpened, 0);
  const totalPRsMerged = contributors.reduce((s, c) => s + c.prsMerged, 0);
  const totalReviews = contributors.reduce((s, c) => s + c.reviewCount, 0);

  const report = {
    repository: `${owner}/${repo}`,
    period: {
      days,
      from: cutoff.toISOString().split("T")[0],
      to: new Date().toISOString().split("T")[0],
    },
    summary: {
      activeContributors: contributors.length,
      totalCommits: totalCommitsInPeriod,
      totalPRsOpened: totalPRsOpened,
      totalPRsMerged: totalPRsMerged,
      totalReviews: totalReviews,
      firstTimeContributors: firstTimeContributors.length,
    },
    firstTimeContributors,
    topContributors: contributors.slice(0, 25),
  };

  return JSON.stringify(report, null, 2);
}

export const contributorStatsTool = {
  name: "github_contributor_stats",
  description:
    "Get contributor statistics for a GitHub repository: commits, PRs, reviews, and first-time contributors within a configurable time window.",
  inputSchema: InputSchema,
  handler: getContributorStats,
};
