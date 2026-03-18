import { z } from "zod";

const InputSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  max_issues: z
    .number()
    .optional()
    .default(50)
    .describe("Maximum number of open issues to analyze (default: 50)"),
  token: z
    .string()
    .optional()
    .describe("GitHub personal access token (optional, raises rate limit)"),
});

type Input = z.infer<typeof InputSchema>;

interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: { login: string };
  labels: { name: string; color: string }[];
  created_at: string;
  updated_at: string;
  comments: number;
  pull_request?: unknown;
  reactions: {
    "+1": number;
    "-1": number;
    total_count: number;
  };
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

interface CategorizedIssue {
  number: number;
  title: string;
  url: string;
  author: string;
  labels: string[];
  created: string;
  comments: number;
  reactions: number;
  category: string;
  suggestedPriority: string;
  ageInDays: number;
}

const KEYWORD_CATEGORIES: Record<string, string[]> = {
  bug: ["bug", "error", "crash", "broken", "fail", "fix", "issue", "wrong", "incorrect", "regression"],
  feature: ["feature", "request", "enhancement", "add", "support", "implement", "new"],
  documentation: ["doc", "documentation", "readme", "guide", "example", "tutorial", "typo"],
  performance: ["slow", "performance", "memory", "leak", "optimize", "speed", "latency"],
  security: ["security", "vulnerability", "cve", "exploit", "auth", "permission", "xss", "injection"],
  question: ["question", "how to", "help", "ask", "unclear", "confusion"],
  infrastructure: ["ci", "build", "deploy", "docker", "pipeline", "test", "lint", "config"],
};

function categorizeIssue(issue: Issue): string {
  // Check labels first
  const labelNames = issue.labels.map((l) => l.name.toLowerCase());

  for (const [category, keywords] of Object.entries(KEYWORD_CATEGORIES)) {
    if (labelNames.some((label) => keywords.some((kw) => label.includes(kw)))) {
      return category;
    }
  }

  // Then check title and body
  const text = `${issue.title} ${issue.body || ""}`.toLowerCase();
  for (const [category, keywords] of Object.entries(KEYWORD_CATEGORIES)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return category;
    }
  }

  return "uncategorized";
}

function suggestPriority(issue: Issue, ageInDays: number): string {
  const category = categorizeIssue(issue);
  const reactions = issue.reactions?.total_count || 0;
  const comments = issue.comments;

  // Security issues are always high priority
  if (category === "security") return "critical";

  // High engagement suggests importance
  if (reactions >= 10 || comments >= 10) return "high";

  // Bugs with some engagement
  if (category === "bug" && (reactions >= 3 || comments >= 3)) return "high";

  // Old issues with engagement
  if (ageInDays > 90 && (reactions >= 5 || comments >= 5)) return "medium";

  // Recent bugs
  if (category === "bug" && ageInDays < 7) return "medium";

  // Features with engagement
  if (category === "feature" && reactions >= 5) return "medium";

  return "low";
}

function findPotentialDuplicates(
  issues: Issue[]
): { issueA: number; issueB: number; reason: string }[] {
  const duplicates: { issueA: number; issueB: number; reason: string }[] = [];

  function tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );
  }

  function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    const intersection = new Set([...a].filter((x) => b.has(x)));
    const union = new Set([...a, ...b]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  const tokenized = issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    tokens: tokenize(`${issue.title} ${issue.body || ""}`),
  }));

  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      const similarity = jaccardSimilarity(
        tokenized[i].tokens,
        tokenized[j].tokens
      );
      if (similarity >= 0.45) {
        duplicates.push({
          issueA: tokenized[i].number,
          issueB: tokenized[j].number,
          reason: `Title/body similarity: ${(similarity * 100).toFixed(0)}% — "${tokenized[i].title}" and "${tokenized[j].title}"`,
        });
      }
    }
    if (duplicates.length >= 20) break;
  }

  return duplicates;
}

export async function triageIssues(input: Input): Promise<string> {
  const { owner, repo, max_issues, token } = input;
  const perPage = Math.min(max_issues, 100);
  const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=${perPage}&sort=created&direction=desc`;

  const res = await githubFetch(url, token);

  if (res.status === 404) {
    return `Repository ${owner}/${repo} not found.`;
  }
  if (res.status === 403) {
    return `Rate limit exceeded. Provide a GitHub token to increase your limit.`;
  }
  if (res.status !== 200) {
    return `GitHub API returned status ${res.status}.`;
  }

  const allItems = res.data as Issue[];
  // Filter out pull requests (GitHub issues API includes PRs)
  const issues = allItems.filter((i) => !i.pull_request);

  const now = Date.now();

  const categorized: CategorizedIssue[] = issues.map((issue) => {
    const ageInDays = Math.floor(
      (now - new Date(issue.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    const category = categorizeIssue(issue);
    const suggestedPriorityValue = suggestPriority(issue, ageInDays);

    return {
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      author: issue.user.login,
      labels: issue.labels.map((l) => l.name),
      created: issue.created_at,
      comments: issue.comments,
      reactions: issue.reactions?.total_count || 0,
      category,
      suggestedPriority: suggestedPriorityValue,
      ageInDays,
    };
  });

  // Group by category
  const byCategory: Record<string, CategorizedIssue[]> = {};
  for (const issue of categorized) {
    if (!byCategory[issue.category]) {
      byCategory[issue.category] = [];
    }
    byCategory[issue.category].push(issue);
  }

  // Group by priority
  const byPriority: Record<string, number> = {};
  for (const issue of categorized) {
    byPriority[issue.suggestedPriority] =
      (byPriority[issue.suggestedPriority] || 0) + 1;
  }

  // Find stale issues (no comments, old)
  const staleIssues = categorized
    .filter((i) => i.ageInDays > 60 && i.comments === 0)
    .sort((a, b) => b.ageInDays - a.ageInDays)
    .slice(0, 10)
    .map((i) => ({
      number: i.number,
      title: i.title,
      ageInDays: i.ageInDays,
    }));

  // Find duplicates
  const duplicates = findPotentialDuplicates(issues);

  // High priority issues
  const highPriority = categorized
    .filter(
      (i) =>
        i.suggestedPriority === "critical" || i.suggestedPriority === "high"
    )
    .sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        critical: 0,
        high: 1,
      };
      return (
        (priorityOrder[a.suggestedPriority] ?? 2) -
        (priorityOrder[b.suggestedPriority] ?? 2)
      );
    });

  const report = {
    repository: `${owner}/${repo}`,
    totalOpenIssuesAnalyzed: issues.length,
    summary: {
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([cat, items]) => [cat, items.length])
      ),
      byPriority,
    },
    highPriorityIssues: highPriority.slice(0, 15),
    potentialDuplicates: duplicates,
    staleIssues,
    allCategorized: categorized,
  };

  return JSON.stringify(report, null, 2);
}

export const issueTriageTool = {
  name: "github_issue_triage",
  description:
    "Analyze open issues in a GitHub repository: categorize by labels and keywords, suggest priorities, find potential duplicates, and identify stale issues.",
  inputSchema: InputSchema,
  handler: triageIssues,
};
