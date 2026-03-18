import { z } from "zod";

const InputSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  from: z
    .string()
    .describe(
      "Start reference: a tag name (e.g. v1.0.0), branch, or commit SHA"
    ),
  to: z
    .string()
    .optional()
    .default("HEAD")
    .describe(
      "End reference: a tag name, branch, or commit SHA (default: HEAD)"
    ),
  token: z
    .string()
    .optional()
    .describe("GitHub personal access token (optional, raises rate limit)"),
});

type Input = z.infer<typeof InputSchema>;

interface Commit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  author: { login: string; html_url: string } | null;
  html_url: string;
}

interface CompareResponse {
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits: Commit[];
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

const CONVENTIONAL_PATTERNS: Record<string, RegExp> = {
  breaking: /^BREAKING[\s-]CHANGE|^[\w]+!:/i,
  feature: /^feat(\(.+\))?:/i,
  fix: /^fix(\(.+\))?:/i,
  docs: /^docs(\(.+\))?:/i,
  style: /^style(\(.+\))?:/i,
  refactor: /^refactor(\(.+\))?:/i,
  perf: /^perf(\(.+\))?:/i,
  test: /^test(\(.+\))?:/i,
  build: /^build(\(.+\))?:/i,
  ci: /^ci(\(.+\))?:/i,
  chore: /^chore(\(.+\))?:/i,
  revert: /^revert(\(.+\))?:/i,
};

const CATEGORY_LABELS: Record<string, string> = {
  breaking: "Breaking Changes",
  feature: "New Features",
  fix: "Bug Fixes",
  docs: "Documentation",
  style: "Styling",
  refactor: "Code Refactoring",
  perf: "Performance Improvements",
  test: "Tests",
  build: "Build System",
  ci: "CI/CD",
  chore: "Maintenance",
  revert: "Reverts",
  other: "Other Changes",
};

interface ParsedCommit {
  sha: string;
  shortSha: string;
  message: string;
  firstLine: string;
  category: string;
  scope: string | null;
  author: string;
  authorUrl: string | null;
  date: string;
  url: string;
}

function parseCommit(commit: Commit): ParsedCommit {
  const message = commit.commit.message;
  const firstLine = message.split("\n")[0].trim();
  let category = "other";
  let scope: string | null = null;

  for (const [cat, pattern] of Object.entries(CONVENTIONAL_PATTERNS)) {
    if (pattern.test(firstLine)) {
      category = cat;
      const scopeMatch = firstLine.match(/^\w+\(([^)]+)\)/);
      if (scopeMatch) {
        scope = scopeMatch[1];
      }
      break;
    }
  }

  // Fallback heuristics for non-conventional commits
  if (category === "other") {
    const lower = firstLine.toLowerCase();
    if (lower.startsWith("fix") || lower.includes("bugfix")) category = "fix";
    else if (lower.startsWith("add") || lower.includes("feature"))
      category = "feature";
    else if (lower.startsWith("update") || lower.startsWith("improve"))
      category = "refactor";
    else if (lower.startsWith("remove") || lower.startsWith("delete"))
      category = "chore";
    else if (lower.includes("test")) category = "test";
    else if (lower.includes("doc") || lower.includes("readme"))
      category = "docs";
  }

  return {
    sha: commit.sha,
    shortSha: commit.sha.substring(0, 7),
    message,
    firstLine,
    category,
    scope,
    author: commit.author?.login || commit.commit.author.name,
    authorUrl: commit.author?.html_url || null,
    date: commit.commit.author.date,
    url: commit.html_url,
  };
}

function generateMarkdown(
  owner: string,
  repo: string,
  from: string,
  to: string,
  parsed: ParsedCommit[],
  totalCommits: number
): string {
  const lines: string[] = [];
  lines.push(`# Release Notes: ${from} to ${to}`);
  lines.push("");
  lines.push(`**Repository:** ${owner}/${repo}`);
  lines.push(`**Total commits:** ${totalCommits}`);

  const uniqueAuthors = new Set(parsed.map((c) => c.author));
  lines.push(`**Contributors:** ${uniqueAuthors.size}`);
  lines.push("");

  // Group by category
  const grouped: Record<string, ParsedCommit[]> = {};
  for (const commit of parsed) {
    if (!grouped[commit.category]) {
      grouped[commit.category] = [];
    }
    grouped[commit.category].push(commit);
  }

  // Output in priority order
  const categoryOrder = [
    "breaking",
    "feature",
    "fix",
    "perf",
    "refactor",
    "docs",
    "test",
    "build",
    "ci",
    "style",
    "chore",
    "revert",
    "other",
  ];

  for (const cat of categoryOrder) {
    const commits = grouped[cat];
    if (!commits || commits.length === 0) continue;

    lines.push(`## ${CATEGORY_LABELS[cat] || cat}`);
    lines.push("");

    for (const c of commits) {
      const scopeStr = c.scope ? `**${c.scope}:** ` : "";
      lines.push(
        `- ${scopeStr}${c.firstLine} ([\`${c.shortSha}\`](${c.url})) — @${c.author}`
      );
    }
    lines.push("");
  }

  // Contributors
  lines.push("## Contributors");
  lines.push("");
  const authorCommits: Record<string, number> = {};
  for (const c of parsed) {
    authorCommits[c.author] = (authorCommits[c.author] || 0) + 1;
  }
  const sortedAuthors = Object.entries(authorCommits).sort(
    ([, a], [, b]) => b - a
  );
  for (const [author, count] of sortedAuthors) {
    lines.push(`- @${author} (${count} commit${count > 1 ? "s" : ""})`);
  }

  return lines.join("\n");
}

export async function generateReleaseNotes(input: Input): Promise<string> {
  const { owner, repo, from, to, token } = input;
  const url = `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;

  const res = await githubFetch(url, token);

  if (res.status === 404) {
    return `Could not compare ${from}...${to} in ${owner}/${repo}. Verify both references exist.`;
  }
  if (res.status === 403) {
    return `Rate limit exceeded. Provide a GitHub token to increase your limit.`;
  }
  if (res.status !== 200) {
    return `GitHub API returned status ${res.status}. Try again later.`;
  }

  const compare = res.data as CompareResponse;
  const commits = compare.commits || [];

  if (commits.length === 0) {
    return `No commits found between ${from} and ${to}.`;
  }

  const parsed = commits.map(parseCommit);

  const markdown = generateMarkdown(
    owner,
    repo,
    from,
    to,
    parsed,
    compare.total_commits
  );

  // Also produce structured data
  const grouped: Record<string, number> = {};
  for (const c of parsed) {
    grouped[c.category] = (grouped[c.category] || 0) + 1;
  }

  const result = {
    markdown,
    structured: {
      from,
      to,
      totalCommits: compare.total_commits,
      categorySummary: grouped,
      commits: parsed.map((c) => ({
        sha: c.shortSha,
        category: c.category,
        scope: c.scope,
        message: c.firstLine,
        author: c.author,
        date: c.date,
      })),
    },
  };

  return JSON.stringify(result, null, 2);
}

export const releaseNotesTool = {
  name: "github_release_notes",
  description:
    "Generate release notes from commits between two tags, branches, or commit SHAs. Automatically categorizes commits using conventional commit patterns and produces both Markdown and structured output.",
  inputSchema: InputSchema,
  handler: generateReleaseNotes,
};
