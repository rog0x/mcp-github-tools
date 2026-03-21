[![MCP Server](https://glama.ai/mcp/servers/rog0x/mcp-github-tools/badges/score.svg)](https://glama.ai/mcp/servers/rog0x/mcp-github-tools)

# mcp-github-tools

An MCP (Model Context Protocol) server that provides GitHub analytics and management tools for AI agents. Analyze repositories, summarize pull requests, triage issues, generate release notes, and track contributor activity — all through a standardized tool interface.

## Tools

### github_repo_analyzer

Analyze a GitHub repository and get a comprehensive overview including stars, forks, open issues, language breakdown, top contributors, and weekly commit activity trends.

### github_pr_summarizer

Summarize a pull request with diff stats, categorized file changes, review status (approvals, change requests, pending reviewers), and recent comment excerpts.

### github_issue_triage

Analyze open issues in a repository. Automatically categorizes issues by labels and keywords (bug, feature, docs, security, etc.), suggests priorities based on engagement and age, identifies potential duplicates using text similarity, and flags stale issues.

### github_release_notes

Generate release notes from commits between two references (tags, branches, or SHAs). Categorizes commits using conventional commit patterns and produces both Markdown and structured JSON output.

### github_contributor_stats

Get contributor statistics within a configurable time window: commits, PRs opened/merged, code reviews, and identification of first-time contributors.

## Requirements

- Node.js 18 or later
- No authentication required for public repositories
- Optional GitHub personal access token for higher rate limits (5,000 requests/hour vs 60)

## Installation

```bash
git clone https://github.com/rog0x/mcp-github-tools.git
cd mcp-github-tools
npm install
npm run build
```

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration file:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "github-tools": {
      "command": "node",
      "args": ["D:/products/mcp-servers/mcp-github-tools/dist/index.js"]
    }
  }
}
```

### Claude Code

Add the server using the CLI:

```bash
claude mcp add github-tools node D:/products/mcp-servers/mcp-github-tools/dist/index.js
```

Or add it to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "github-tools": {
      "command": "node",
      "args": ["D:/products/mcp-servers/mcp-github-tools/dist/index.js"]
    }
  }
}
```

## Usage Examples

Once connected, the tools are available to the AI agent automatically. Here are example prompts:

- "Analyze the repository facebook/react"
- "Summarize PR #1234 in vercel/next.js"
- "Triage open issues in microsoft/vscode"
- "Generate release notes for rust-lang/rust from 1.75.0 to 1.76.0"
- "Show contributor stats for the last 30 days in nodejs/node"

## GitHub Token

All tools accept an optional `token` parameter for authenticated requests. Without a token, the GitHub API allows 60 requests per hour. With a token, the limit increases to 5,000 requests per hour.

You can create a personal access token at [github.com/settings/tokens](https://github.com/settings/tokens). No special scopes are required for public repository access.

## License

MIT
