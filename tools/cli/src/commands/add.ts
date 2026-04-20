import * as p from "@clack/prompts";
import {
  ensureRepoTruecourseDir,
  resolveRepoDir,
} from "@truecourse/server/config/paths";
import { getProjectByPath, registerProject } from "@truecourse/server/config/registry";
import { promptInstallSkills } from "./helpers.js";

export interface AddOptions {
  /** Force-install or force-skip the Claude Code skills prompt. */
  installSkills?: boolean;
}

export async function runAdd(options: AddOptions = {}): Promise<void> {
  const repoPath = resolveRepoDir(process.cwd()) ?? process.cwd();

  p.intro("Adding repository to TrueCourse");
  p.log.step(repoPath);

  ensureRepoTruecourseDir(repoPath);
  const existing = getProjectByPath(repoPath);
  const entry = registerProject(repoPath);

  if (existing) {
    p.log.info(`Repository "${entry.name}" is already registered.`);
  } else {
    p.log.success(`Repository "${entry.name}" added.`);
  }

  await promptInstallSkills(repoPath, { install: options.installSkills });

  p.outro("Run `truecourse analyze` to generate analysis data.");
}
