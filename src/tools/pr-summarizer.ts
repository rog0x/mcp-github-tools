import { z } from "zod";

const InputSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  pull_number: z.number().describe("Pull request number"),
  token: z
    .string()
    .optional()
    .describe("GitHub personal access token (optional, raises rate limit)"),
});

type Input = z.infer<typeof InputSchema>;

interface PullRequest {
  title: string;
  number: number;
  state: string;
  html_url: string;
  body: string | null;
  user: { login: string };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  draft: boolean;
  mergeable_state: string;
  labels: { name: string; color: string }[];
  requested_reviewers: { login: string }[];
}

interface PullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface Review {
  user: { login: string };
  state: string;
  submitted_at: string;
  body: string;
}

interface Comment {
  user: { login: string };
  body: string;
  created_at: string;
  html_url: string;
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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

function categorizeFiles(
  files: PullFile[]
): Record<string, { count: number; files: string[] }> {
  const categories: Record<string, { count: number; files: string[] }> = {};

  for (const file of files) {
    let category = "other";
    const name = file.filename.toLowerCase();

    if (name.endsWith(".test.ts") || name.endsWith(".test.js") || name.endsWith(".spec.ts") || name.endsWith(".spec.js") || name.includes("__tests__")) {
      category = "tests";
    } else if (name.endsWith(".ts") || name.endsWith(".js") || name.endsWith(".tsx") || name.endsWith(".jsx")) {
      category = "source";
    } else if (name.endsWith(".css") || name.endsWith(".scss") || name.endsWith(".less")) {
      category = "styles";
    } else if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".rst")) {
      category = "documentation";
    } else if (name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".toml")) {
      category = "configuration";
    } else if (name.endsWith(".py") || name.endsWith(".go") || name.endsWith(".rs") || name.endsWith(".java")) {
      category = "source";
    }

    if (!categories[category]) {
      categories[category] = { count: 0, files: [] };
    }
    categories[category].count++;
    categories[category].files.push(file.filename);
  }

  return categories;
}

export async function summarizePR(input: Input): Promise<string> {
  const { owner, repo, pull_number, token } = input;
  const base = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`;

  const [prRes, filesRes, reviewsRes, commentsRes] = await Promise.all([
    githubFetch(base, token),
    githubFetch(`${base}/files?per_page=100`, token),
    githubFetch(`${base}/reviews?per_page=50`, token),
    githubFetch(`${base}/comments?per_page=50`, token),
  ]);

  if (prRes.status === 404) {
    return `Pull request #${pull_number} not found in ${owner}/${repo}.`;
  }
  if (prRes.status === 403) {
    return `Rate limit exceeded. Provide a GitHub token to increase your limit.`;
  }
  if (prRes.status !== 200) {
    return `GitHub API returned status ${prRes.status}. Try again later.`;
  }

  const pr = prRes.data as PullRequest;
  const files = (filesRes.data as PullFile[]) || [];
  const reviews = (reviewsRes.data as Review[]) || [];
  const comments = (commentsRes.data as Comment[]) || [];

  // Determine review status
  const reviewStates: Record<string, string> = {};
  for (const review of reviews) {
    if (review.state !== "COMMENTED") {
      reviewStates[review.user.login] = review.state;
    }
  }

  const approvals = Object.entries(reviewStates)
    .filter(([, state]) => state === "APPROVED")
    .map(([user]) => user);
  const changesRequested = Object.entries(reviewStates)
    .filter(([, state]) => state === "CHANGES_REQUESTED")
    .map(([user]) => user);
  const pendingReviewers = pr.requested_reviewers.map((r) => r.login);

  // File categories
  const fileCategories = categorizeFiles(files);

  // Largest changes
  const largestChanges = [...files]
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 10)
    .map((f) => ({
      file: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    }));

  // Comment summary
  const commentSummary = comments.slice(0, 15).map((c) => ({
    author: c.user.login,
    excerpt: truncate(c.body, 120),
    date: new Date(c.created_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  const summary = {
    pullRequest: {
      title: pr.title,
      number: pr.number,
      state: pr.merged_at ? "merged" : pr.state,
      url: pr.html_url,
      author: pr.user.login,
      branch: `${pr.head.ref} -> ${pr.base.ref}`,
      draft: pr.draft,
      labels: pr.labels.map((l) => l.name),
      created: pr.created_at,
      updated: pr.updated_at,
      mergedAt: pr.merged_at,
    },
    description: pr.body ? truncate(pr.body, 500) : "No description provided",
    diffStats: {
      commits: pr.commits,
      filesChanged: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      netLines: pr.additions - pr.deletions,
    },
    fileCategories,
    largestChanges,
    reviewStatus: {
      approved: approvals,
      changesRequested,
      pendingReviewers,
      totalReviews: reviews.length,
    },
    comments: {
      count: comments.length,
      recent: commentSummary,
    },
  };

  return JSON.stringify(summary, null, 2);
}

export const prSummarizerTool = {
  name: "github_pr_summarizer",
  description:
    "Summarize a GitHub pull request: files changed, diff stats, review status, and comments. Provides categorized file breakdown and identifies largest changes.",
  inputSchema: InputSchema,
  handler: summarizePR,
};
