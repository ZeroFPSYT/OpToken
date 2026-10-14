---
name: weekly
description: Set up, update or remove the OpToken weekly routine from the user's OpToken settings: a cloud session that opens by itself one or two days before the weekly usage limit resets and spends the unused part on small, safe tasks of the chosen project. Use from the OpToken settings menu, or when the user asks for the weekly routine.
---

# OpToken weekly routine (setup)

Works for any user and any project: every time and date comes from this user's own limits, the project and days from their OpToken settings.

1. Call `optoken` with `settings_get`. If `weekly` is false: call `list_triggers`, delete the routines named `OpToken weekly`, tell the user in one line and stop. If `project` or `days` is missing, ask for it (one multiple-choice question each) and save it with `settings_set`.
2. Call the `effort` tool with `status`. Take the `seven_day resets at` timestamp. If there is none, tell the user the weekly limit is not reported in this session and stop.
3. For each chosen day (`both` = 2 and 1 days before), compute the run as reset time minus 48 h / 24 h, in UTC. Write it as a weekly cron (`m h * * dow`), moving the minute 1 to 15 minutes earlier when it falls on :00 or :30. Before the reset there must be at least 6 hours, so a run cut by the 5-hour window can still resume.
4. Call `list_triggers` and look for routines named `OpToken weekly`. Update them with `update_trigger` instead of creating duplicates; delete the ones that no longer fit the chosen days.
5. Create each run with `create_trigger`: name `OpToken weekly (2 days before)` / `(1 day before)`, `create_new_session_on_fire: true`, `initiation: human_request`, and as `prompt` the text under **Routine prompt** below, with `<owner/repo>` replaced by the chosen project.
6. Tell the user in one line the project, days and times in their local time zone if known (otherwise UTC), and that the routine only takes S/M tasks and leaves a summary to review.

This only works in cloud sessions (claude.ai/code), and the project needs a GitHub repository. In a local session, say so and stop.

## Routine prompt

```
OpToken weekly routine. You run unattended, with nobody to review until later. Goal: use the part of the weekly usage limit that would otherwise be wasted, on small, safe work of this project.

0. Project: GitHub repository <owner/repo>. If it is not in the working directory, attach it with the `add_repo` tool (access push), clone it as that tool says and work inside the clone. If it cannot be attached, stop with a note.
1. Call the optoken `effort` tool with `status`. Stop with a one-line note (step 6) if the weekly pace is at or ahead of the time elapsed (not "atrasado"), or the 5-hour window is at 80% or more. If that tool does not exist (OpToken is not installed here), skip these checks and stop after one task.
2. Read the project's own instructions (CLAUDE.md or similar) and follow them: language, branch, commit and push rules.
3. Find pending work in the project, in this order: a "next steps" or roadmap section the instructions point to; files such as ROADMAP.md, TODO.md, TASKS.md; open issues of the repository. Size each candidate S / M / L.
4. Take only S or M tasks that need no decision from the user and do not change the project's structure, public interfaces, dependencies or data, and delete nothing. If there is none, stop with a note. Prefer finishing one task over starting several.
5. Work with the OpToken rules (plan at high, execute at the lowest effort that works). Run the project's checks (tests, types, lint) before each commit. Commit and push as the project's instructions say; never open pull requests unless they say so. Before each new task check `effort` status again: stop at 80% of the 5-hour window or when the weekly pace reaches zero.
6. Close: leave a short summary for the user (what you did, what you skipped and why, the cost against your estimate), in the project's notes file if its instructions name one and committed, and as your final message.
```
