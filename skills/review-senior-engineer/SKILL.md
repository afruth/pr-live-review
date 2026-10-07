---
name: review-senior-engineer
description: Review the current branch's changes the way a strict senior engineer would, prioritizing logic correctness, query efficiency (N+1, unbounded queries, bulk ops), type safety (no unnecessary casts or any), API consolidation, schema-defined validation, forward-compatible allowlists, and atomic single-query opportunities. Use when the user asks to "review as a senior engineer", invokes /review-senior-engineer, or wants a pre-review pass on a branch or PR before a human review.
---

# Review as a senior engineer

Simulate a code review by a senior engineer whose reviews prioritize **correctness over
speed**. The reviewer traces every code path, counts query roundtrips, distrusts casts, and
blocks PRs with pointed questions rather than vague praise. The goal of this skill is to
catch what that reviewer would catch *before* they see the PR.

## Step 1 - Scope the diff

Find exactly what changed, then review only that (plus the surrounding code needed to judge it):

- If an argument is a PR number (e.g. `/review-senior-engineer 919`): `gh pr diff <number>`.
- If an argument is a base ref: diff `git merge-base <base> HEAD`..HEAD.
- Otherwise (default): find the PR base for the current branch with
  `gh pr view --json baseRefName -q .baseRefName` (branches are often stacked, so the base
  is not always the default branch). Fall back to the default branch if there is no PR.
  Then review `git diff $(git merge-base <base> HEAD)..HEAD`.

Read the changed files in full, and open the helpers, models and API schemas they touch.
The reviewer reads every line and traces call chains across files; a diff-only skim misses
what they find. Before you ask whether something is handled elsewhere, open that place and check.

## Step 2 - Review through the reviewer's lens (priority order)

Go through these in order. The first four are where the reviewer requests changes most often.

1. **Logic correctness - "does this actually do what you think it does?"**
   Walk every branch and ask what happens when the data is not shaped as expected. Look for
   logic that contradicts the stated intent, off-by-one or rounding fragility, and conditions
   that fire when they should not (e.g. a fallback `?? item.status` that makes a note-only
   edit behave like a real status change). Frame open intent questions as "Is this intentional?".

2. **Query efficiency - "why N queries when 1 will do?"**
   N+1 in loops, redundant or duplicate queries, in-memory filtering that belongs in SQL,
   unbounded queries with no LIMIT, selecting all columns when a few are needed, missing
   joins, multiplicative complexity that should be a Set lookup. Push for batch operations
   (bulk inserts, grouped updates) and `Promise.all` for independent queries.

3. **Type safety - "why do we need to cast?"** (the most frequent comment)
   Every `as` cast and every `any`/`unknown` is suspect: it means a type is wrong upstream.
   Fix the source type, use `Record<Key, Value>` and unions to make illegal states
   unrepresentable, narrow with `in` checks instead of casting at the consumer.

4. **Atomic / single-call opportunities**
   Read-then-write that should be one conditional `UPDATE ... WHERE ... RETURNING` (faster
   *and* concurrency-safe, no lock needed). Two endpoints that differ only by a parameter
   that should be one parameterized endpoint. Validation duplicated at every consumer that
   should live at the source.

5. **Forward compatibility**
   Prefer allowlists over denylists so a new status or stage does not silently slip through.
   Co-locate valid sets with their type or model definition (export the constant from the
   model, do not hardcode a copy, especially across a service and UI boundary).

6. **Silent failures**
   Every side effect needs a visible failure path. Swallowed errors, fire-and-forget calls
   that should be awaited or alerted, scheduled jobs with no documented trigger or
   pagination, partial writes with no rollback. Ask "what happens when this breaks?"

7. **DB & transactions**
   No network requests inside transactions. Paired record operations wrapped in one
   transaction. Bind parameters for raw SQL. DB constraints for correctness (invalid states),
   not transient business rules. Correct distinct counts when paginating over joins.

8. **Repo placement rules**
   Apply the repository's own rules from its `CLAUDE.md`, `AGENTS.md` and contributing docs:
   where request validation lives (for example in the API schema, not inline in handlers),
   where helpers and route handlers go, import restrictions, and banned patterns.

## Step 3 - Report findings

Match the reviewer's style:

- **Confidence-filtered.** Only report what matters. The reviewer does NOT comment on
  formatting, whitespace, naming, import order, or test and assertion style; linters own
  those. If you have nothing substantive, say the PR looks clean rather than padding with nits.
- **Questions over directives, for intent.** "Is this intentional?" / "Why isn't this X?"
  forces the author to confirm the design or find the bug. Use a question only when the code
  cannot answer it; if it can, read the code and state the problem.
- **Severity tiers:** blocking (logic bug, N+1, unsafe cast, missing failure-case test,
  duplicated endpoint or logic) vs. `nit:` prefix for genuinely minor items.
- For each finding give: `file:line`, the concern, and a concrete fix or the
  single-query or typed-union alternative.
- Note missing **failure-case** test coverage: happy-path-only tests are a changes-requested trigger.

End with the verdict the reviewer would land on: **Approve**, **Approve with nits**, or
**Changes requested**, and the one or two things that drove it.

## Examples of the comments this reviewer leaves

- Unbounded scan: no limit or paging, and all columns selected. → Add a LIMIT and an
  explicit column list.
- Filtering in application code: rows are fetched and then filtered in a loop. → Move the
  predicate into the WHERE clause or a JOIN, and add a database integration test for it.
- Read-then-write: a read, a check in code, then a write. → One conditional
  `UPDATE ... WHERE id = $1 AND x = $2 RETURNING *`; 404 when no row matches.
- Casts in many files: a sign that an upstream type is wrong. → Fix the upstream type, not
  each call site.
- Data-model invariants: two entities linked directly to each other. → Link both to their
  shared owning entity (for example with a composite foreign key), so illegal cross links
  cannot exist.
- Forward compatibility: a filter on the negative set of statuses. → Filter on the positive
  set, and export that set from the model.
