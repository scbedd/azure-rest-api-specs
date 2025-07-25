import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import path from "path";
import fs from "fs/promises";
import { simpleGit } from "simple-git";
import { Octokit } from "@octokit/rest";

// @ts-ignore - Skip TypeScript checking for this import
import { getChangedFilesStatuses } from "@azure-tools/specs-shared/changed-files";
import { PRContext } from "@azure-tools/summarize-impact/src/PRContext.js";
import { evaluateImpact } from "@azure-tools/summarize-impact/src/impact.js";
import { LabelContext } from "@azure-tools/summarize-impact/src/labelling-types.js";

// Constants
const TARGET_OWNER = "Azure";
const TARGET_REPO = "azure-rest-api-specs";
const TARGET_PR = 36207;
const TEMP_DIR_BASE = `/tmp/pr-${TARGET_PR}-test`;

describe("E2E Integration Test", () => {
  let octokit: Octokit;
  let tempDirBefore: string;
  let tempDirAfter: string;
  let prData: any;
  let impactAssessment: any;

  beforeAll(async () => {
    // Initialize Octokit
    octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Set up temp directories
    tempDirBefore = path.join(TEMP_DIR_BASE, "before");
    tempDirAfter = path.join(TEMP_DIR_BASE, "after");

    // Ensure temp directories exist
    await fs.mkdir(tempDirBefore, { recursive: true });
    await fs.mkdir(tempDirAfter, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup temp directories if needed
    // Note: Keeping them for debugging purposes as requested
  });

  it.skipIf(!process.env.GITHUB_TOKEN || !process.env.INTEGRATION_TEST)(
    "re-check-pr",
    async () => {
      // Fetch PR data from GitHub
      const prResponse = await octokit.rest.pulls.get({
        owner: TARGET_OWNER,
        repo: TARGET_REPO,
        pull_number: TARGET_PR,
      });
      prData = prResponse.data;

      console.log(`Fetched PR data for #${TARGET_PR}: ${prData.title}`);
      console.log(`Base: ${prData.base.ref} (${prData.base.sha})`);
      console.log(`Head: ${prData.head.ref} (${prData.head.sha})`);

      // Clone/update repository for "before" state (main branch)
      const gitBefore = simpleGit(tempDirBefore);
      const beforeExists = await fs.access(path.join(tempDirBefore, ".git")).then(() => true).catch(() => false);

      if (!beforeExists) {
        console.log("Cloning repository for 'before' state...");
        await gitBefore.clone(`https://github.com/${TARGET_OWNER}/${TARGET_REPO}.git`, ".", ["--depth=1"]);
      } else {
        console.log("Repository already exists, fetching updates for 'before' state...");
        await gitBefore.fetch();
      }

      await gitBefore.checkout(prData.base.sha);

      // Clone/update repository for "after" state (PR branch)
      const gitAfter = simpleGit(tempDirAfter);
      const afterExists = await fs.access(path.join(tempDirAfter, ".git")).then(() => true).catch(() => false);

      if (!afterExists) {
        console.log("Cloning repository for 'after' state...");
        await gitAfter.clone(`https://github.com/${TARGET_OWNER}/${TARGET_REPO}.git`, ".", ["--depth=1"]);
      } else {
        console.log("Repository already exists, fetching updates for 'after' state...");
        await gitAfter.fetch("origin", prData.head.sha, ["--depth=1"]);
      }

      // Checkout the PR branch
      await gitAfter.checkout(prData.head.sha);

      // Change to after directory and get changed files
      const originalCwd = process.cwd();
      process.chdir(tempDirAfter);

      try {
        const changedFileDetails = await getChangedFilesStatuses({
          cwd: tempDirAfter,
          baseCommitish: prData.base.ref,
        });

        console.log(`Found ${changedFileDetails.total} changed files`);

        const labelContext: LabelContext = {
          present: new Set(),
          toAdd: new Set(),
          toRemove: new Set(),
        };

        const prContext = new PRContext(tempDirAfter, tempDirBefore, labelContext, {
          sha: prData.head.sha,
          sourceBranch: prData.head.ref,
          targetBranch: prData.base.ref,
          repo: TARGET_REPO,
          prNumber: TARGET_PR.toString(),
          owner: TARGET_OWNER,
          fileList: changedFileDetails,
          isDraft: prData.draft,
        });

        // Generate impact assessment locally
        console.log("Evaluating impact assessment...");
        impactAssessment = await evaluateImpact(prContext, labelContext);
        console.log("Impact assessment generated:", JSON.stringify(impactAssessment, null, 2));

        const summarizeChecksModule = await import("../../../../.github/workflows/src/summarize-checks/summarize-checks.js");

        // Create mock GitHub and core objects
        const mockGithub = octokit as any;

        const mockCore = {
          info: vi.fn((message) => console.log(`[INFO] ${message}`)),
          warning: vi.fn((message) => console.log(`[WARNING] ${message}`)),
          error: vi.fn((message) => console.log(`[ERROR] ${message}`)),
          setFailed: vi.fn((message) => console.log(`[FAILED] ${message}`)),
        } as any;

        const mockContext = {
          eventName: "pull_request",
          payload: {
            pull_request: prData,
          },
        } as any;

        // Mock getImpactAssessment to return our local impact assessment
        const getImpactAssessmentSpy = vi.spyOn(summarizeChecksModule, "getImpactAssessment");
        getImpactAssessmentSpy.mockResolvedValue(impactAssessment);

        // Call summarizeChecksImpl with our local impact assessment
        console.log("Calling summarizeChecksImpl...");
        await summarizeChecksModule.summarizeChecksImpl(
          mockGithub,
          mockContext,
          mockCore,
          TARGET_OWNER,
          TARGET_REPO,
          TARGET_PR,
          prData.head.sha,
          "pull_request",
          prData.base.ref
        );

        // Verify that our mock was called
        expect(mockCore.info).toHaveBeenCalled();
        console.log("Integration test completed successfully!");

      } finally {
        // Restore original directory
        process.chdir(originalCwd);
      }
    },
    60000000, // 60 second timeout
  );
});
