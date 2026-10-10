# Coordinated work

The Work panel connects project issues to plans managed by Bob. Open it beside a
thread from the panel chooser or **Open Work panel** in the command palette.
Mobile has a Work entry in the thread header for inspecting and controlling plans.

Select project issues to create a draft plan, then start it. To queue execution,
load the current issue scope, choose an environment-local execution profile, and
supply the base commit and acceptance criteria. Bob controls readiness and
concurrency; its dispatch worker admits work in the target T3 environment.

If a request cannot be confirmed, retry the retained request. Its identifiers
must stay the same. Pause stops future admission; existing execution continues.
Open an execution thread to inspect its progress and linked pull requests.

Execution success is one milestone. Production work stays open until deployment
and health evidence prove it reached its target. Validation, release, and deployment
controls depend on the coordinator's capabilities and are not enabled by this slice.
