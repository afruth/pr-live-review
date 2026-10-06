# pr-live-review

A Claude Code mod that opens a live PR review pane in the terminal. The pane shows the diff of the checked-out PR against its base branch, a summary and findings for each file, and line comments. You can send a comment to Claude or post it to the PR on GitHub.

## Install

Type this command at the prompt of a terminal Claude Code session:

```
/plugin install pr-live-review --marketplace afruth/pr-live-review
```

Answer `y` to add the marketplace. Then select a scope (the user scope is the default).

## Use

1. Check out the branch of an open PR.
2. Type `/pr-live-review` (optional argument: a repository path).

## Requirements

- Claude Code 2.1.291 or later.
- `git` and an authenticated GitHub CLI (`gh`) on the PATH.

## Optional review instructions

If a skill with the name `review-senior-engineer` exists in `<repo>/.claude/skills/`, `$CLAUDE_CONFIG_DIR/skills/` or `~/.claude/skills/`, the mod adds its `SKILL.md` to the review prompt.

## Update

Run `claude plugin update`, then `/reload-plugins`.
