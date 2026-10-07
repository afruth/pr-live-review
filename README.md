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

## How the review works

The reviewer gets the diff, the full changed file, call sites from the language server and the repository rules (`CLAUDE.md`, `AGENTS.md`). Before it writes a finding that depends on code outside the diff, it can read files, search with `git grep` and list files with `git ls-files`. It reads only files inside the repository. It can do up to 7 rounds of look-ups for each file. A `⌕N` badge on a file shows how many look-ups it made.

Each round sends the full prompt again, so a file with many rounds costs more tokens than one model call.

## Keys

| Key | Action |
| - | - |
| `j` / `k` | Move the cursor down or up. |
| `v` | Mark a range of lines. |
| `l` / `h` | Go to the next or previous comment in the file. |
| `c` | Write a comment on the cursor line or the range. |
| `e` | Edit the selected comment. |
| `g` | Edit the selected comment, then post it to GitHub. |
| `i` / `d` | Ignore an AI finding, or delete your comment. |
| `a` | Put the selected lines into the prompt, so you can ask Claude about them. |
| `s` | Send your comments to Claude. |
| `n` / `p` / `b` | Next file, previous file, file list. |
| `r` / `x` | Refresh the review, close the pane. |

In the comment box, Enter saves or posts. Esc cancels the draft (press it twice if the cursor is in the text field), and so does `x`.

## Requirements

- Claude Code 2.1.291 or later.
- `git` and an authenticated GitHub CLI (`gh`) on the PATH.

## Optional review instructions

If a skill with the name `review-senior-engineer` exists in `<repo>/.claude/skills/`, `$CLAUDE_CONFIG_DIR/skills/` or `~/.claude/skills/`, the mod adds its `SKILL.md` to the review prompt.

## Update

Run `claude plugin update`, then `/reload-plugins`.
