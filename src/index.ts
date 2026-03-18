#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { repoAnalyzerTool, analyzeRepo } from "./tools/repo-analyzer.js";
import { prSummarizerTool, summarizePR } from "./tools/pr-summarizer.js";
import { issueTriageTool, triageIssues } from "./tools/issue-triage.js";
import { releaseNotesTool, generateReleaseNotes } from "./tools/release-notes.js";
import { contributorStatsTool, getContributorStats } from "./tools/contributor-stats.js";

const server = new McpServer({
  name: "mcp-github-tools",
  version: "1.0.0",
});

// Register: Repo Analyzer
server.tool(
  repoAnalyzerTool.name,
  repoAnalyzerTool.description,
  repoAnalyzerTool.inputSchema.shape,
  async (params) => {
    const text = await analyzeRepo(params);
    return { content: [{ type: "text", text }] };
  }
);

// Register: PR Summarizer
server.tool(
  prSummarizerTool.name,
  prSummarizerTool.description,
  prSummarizerTool.inputSchema.shape,
  async (params) => {
    const text = await summarizePR(params);
    return { content: [{ type: "text", text }] };
  }
);

// Register: Issue Triage
server.tool(
  issueTriageTool.name,
  issueTriageTool.description,
  issueTriageTool.inputSchema.shape,
  async (params) => {
    const text = await triageIssues(params);
    return { content: [{ type: "text", text }] };
  }
);

// Register: Release Notes
server.tool(
  releaseNotesTool.name,
  releaseNotesTool.description,
  releaseNotesTool.inputSchema.shape,
  async (params) => {
    const text = await generateReleaseNotes(params);
    return { content: [{ type: "text", text }] };
  }
);

// Register: Contributor Stats
server.tool(
  contributorStatsTool.name,
  contributorStatsTool.description,
  contributorStatsTool.inputSchema.shape,
  async (params) => {
    const text = await getContributorStats(params);
    return { content: [{ type: "text", text }] };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-github-tools server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
