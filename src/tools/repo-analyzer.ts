import { z } from "zod";

const InputSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  token: z
    .string()
    .optional()
    .describe("GitHub personal access token (optional, raises rate limit)"),
});

type Input = z.infer<typeof InputSchema>;

interface GitHubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  language: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  license: { spdx_id: string; name: string } | null;
  default_branch: string;
  archived: boolean;
  topics: string[];
  size: number;
}

interface Contributor {
  login: string;
  contributions: number;
  html_url: string;
}

interface CommitActivity {
  week: number;
  total: number;
  days: number[];
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function computeActivityTrend(
  activities: CommitActivity[]
): { period: string; commits: number }[] {
  const recent = activities.slice(-8);
  return recent.map((week) => {
    const date = new Date(week.week * 1000);
    return {
      period: `Week of ${formatDate(date.toISOString())}`,
      commits: week.total,
    };
  });
}

export async function analyzeRepo(input: Input): Promise<string> {
  const { owner, repo, token } = input;
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  const [repoRes, langRes, contribRes, activityRes, pullsRes] =
    await Promise.all([
      githubFetch(base, token),
      githubFetch(`${base}/languages`, token),
      githubFetch(`${base}/contributors?per_page=10`, token),
      githubFetch(`${base}/stats/commit_activity`, token),
      githubFetch(`${base}/pulls?state=open&per_page=1`, token),
    ]);

  if (repoRes.status === 404) {
    return `Repository ${owner}/${repo} not found. Check the owner and repo name.`;
  }
  if (repoRes.status === 403) {
    return `Rate limit exceeded. Provide a GitHub token to increase your limit.`;
  }
  if (repoRes.status !== 200) {
    return `GitHub API returned status ${repoRes.status}. Try again later.`;
  }

  const repoData = repoRes.data as GitHubRepo;
  const languages = langRes.data as Record<string, number>;
  const contributors = (contribRes.data as Contributor[]) || [];
  const commitActivity = (activityRes.data as CommitActivity[]) || [];

  // Calculate language percentages
  const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0);
  const languageBreakdown = Object.entries(languages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([lang, bytes]) => ({
      language: lang,
      percentage: ((bytes / totalBytes) * 100).toFixed(1),
    }));

  // Activity trend
  const trend = Array.isArray(commitActivity)
    ? computeActivityTrend(commitActivity)
    : [];

  // Top contributors
  const topContributors = contributors.slice(0, 10).map((c) => ({
    username: c.login,
    contributions: c.contributions,
    profile: c.html_url,
  }));

  // Compute total recent commits
  const recentCommits = trend.reduce((sum, w) => sum + w.commits, 0);

  const report = {
    repository: {
      name: repoData.full_name,
      description: repoData.description || "No description provided",
      url: repoData.html_url,
      defaultBranch: repoData.default_branch,
      license: repoData.license?.name || "None",
      archived: repoData.archived,
      topics: repoData.topics || [],
      sizeKb: repoData.size,
    },
    metrics: {
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      openIssues: repoData.open_issues_count,
      watchers: repoData.watchers_count,
    },
    dates: {
      created: formatDate(repoData.created_at),
      lastUpdated: formatDate(repoData.updated_at),
      lastPushed: formatDate(repoData.pushed_at),
    },
    languages: languageBreakdown,
    topContributors,
    activityTrend: {
      recentWeeksCommits: recentCommits,
      weeklyBreakdown: trend,
    },
  };

  return JSON.stringify(report, null, 2);
}

export const repoAnalyzerTool = {
  name: "github_repo_analyzer",
  description:
    "Analyze a GitHub repository: stars, forks, issues, PRs, languages, top contributors, and activity trend. Works with any public repository.",
  inputSchema: InputSchema,
  handler: analyzeRepo,
};
