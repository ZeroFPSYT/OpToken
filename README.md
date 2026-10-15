```
 ██████╗ ██████╗ ████████╗ ██████╗ ██╗  ██╗███████╗███╗   ██╗
██╔═══██╗██╔══██╗╚══██╔══╝██╔═══██╗██║ ██╔╝██╔════╝████╗  ██║
██║   ██║██████╔╝   ██║   ██║   ██║█████╔╝ █████╗  ██╔██╗ ██║
██║   ██║██╔═══╝    ██║   ██║   ██║██╔═██╗ ██╔══╝  ██║╚██╗██║
╚██████╔╝██║        ██║   ╚██████╔╝██║  ██╗███████╗██║ ╚████║
 ╚═════╝ ╚═╝        ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝
   Same results. Fewer tokens.
                                              BY ZEROFPSYT
```

**OpToken** is a Claude Code plugin that makes Claude manage its own budget: it picks the right reasoning effort for each step, plans before it acts, and plans its work around your usage limits, so you get the same results (or better) while spending fewer tokens.

## Install

```
/plugin install optoken --marketplace ZeroFPSYT/OpToken
```

Answer `y` to add the marketplace and pick the user scope. Then type `OpToken` in any session to open the settings.

**On the web (claude.ai/code):** the `/plugin` command is not available there. Add these two lines to your cloud environment's setup script (environment menu → Edit → Setup script) and open a new session:

```
claude plugin marketplace add ZeroFPSYT/OpToken
claude plugin install optoken@optoken
```

Requires Claude Code with plugin hooks (2.1.296 or later): terminal, desktop app or claude.ai/code. It does not run in the regular Claude chat.

## How it works

Always on, with no settings — saving tokens is the whole point:

- **Right effort, not lowest effort.** Claude chats at low effort, plans at high, and executes at the lowest effort that gets it right the first time. On hard work one expensive attempt beats many cheap failed ones, so it raises the effort when a task needs it.
- **Plan first, enforced.** Before each task Claude opens a plan with the `plan` tool: size (S / M / L), estimated cost as a share of your 5-hour window, the effort it will use and what it will delegate. Without an open plan, edits and commits are refused, so the rule can't be forgotten in a long session.
- **Real cost, measured.** Closing a plan compares the real cost with the estimate; `/optoken` lists the last tasks (estimated → real) so estimates get better.
- **Effort goes back down.** After several steps at high effort inside a plan, Claude is reminded to lower it once the thinking is done.
- **Check before spending.** A hypothesis is confirmed with the smallest test first; long suites run once at the end.
- **Trial-and-error alarm.** The same command failing, three different commands failing in a row, or the same file edited three times in a row makes Claude stop, re-diagnose at high effort and explain the new approach.
- **Smart delegation.** Subagents only for broad searches, parallel work or a fresh review, each on the cheapest model that fits.
- **Live status.** Usage, weekly pace, effort and context in the status line; `/optoken` shows the details.

### Your usage limits

- **While you work with Claude,** it only warns you when the margin gets short. You decide.
- **When you tell Claude to keep working without you** ("keep going, I'm off to bed"), it picks work it can finish before 95% of the 5-hour window — large tasks with a wide margin, small ones with little. When there is nothing left to do without you (three turns in a row without changes), it pauses its routines instead of waking up for nothing. At 95% it saves its state and, if your settings allow, schedules itself to resume 10 minutes after the window resets.

## Settings

Type `OpToken` and send it. Claude asks, one question at a time:

1. **Resume after the limit** when working alone: ask each time, always or never.
2. **Use the weekly limit about to expire:** a cloud session opens by itself before your weekly reset and does small, safe tasks.
3. **Which project** that session works on.
4. **When:** 2 days before the reset, 1 day before, or both.

Nothing runs on its own unless you turn it on here.

## License

MIT © ZeroFPSYT
