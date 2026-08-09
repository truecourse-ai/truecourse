> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Claude Code skills

> Conversational analysis from within Claude Code.

TrueCourse includes [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) for conversational analysis from within Claude Code.

The first `truecourse analyze` (or `truecourse add`) in a fresh repo asks whether to install skills into `.claude/skills/truecourse/`. Re-runs skip the prompt if skills are already present. Pass `--install-skills` / `--no-skills` to bypass the prompt explicitly.

| Skill                 | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `/truecourse-analyze` | Runs analysis or diff check, summarizes results      |
| `/truecourse-list`    | Shows full violation details                         |
| `/truecourse-fix`     | Lists fixable violations, applies changes            |
| `/truecourse-hooks`   | Installs, configures, or removes the pre-commit hook |

The skills read the same plain-JSON store and plain-text CLI output as everything else, so an agent can drive the whole analyze → list → fix loop without any special integration.

## Next steps

<CardGroup cols={2}>
  <Card title="CLI reference" icon="terminal" href="/reference/cli">
    The commands the skills drive under the hood.
  </Card>

  <Card title="Git hooks" icon="code-branch" href="/analyze/git-hooks">
    What /truecourse-hooks installs and configures.
  </Card>
</CardGroup>
