# Support Build issues as sprint containers without changing target versions

Some Redmine projects contain independently released modules identified by Category, with each release represented by a Build issue rather than a project target version. Add an opt-in Build sprint source using symmetric “relates to” relationships instead of repurposing target versions or changing issue hierarchy; version-based planning remains the default.

Membership is intentionally nonexclusive: removing an issue from one sprint removes only that sprint's relates link. Closed Build links are retained as history and do not prevent backlog eligibility. Categories narrow sprint selection and, optionally, backlog visibility, but do not constrain the category of a sprint member. Target versions and unrelated relation types must never be modified in Build mode.

Redmine cannot atomically update relations and issue fields. Verify and report observed partial state and reload rather than attempting an unsafe compensating rollback. Backlog membership requires inspecting all visible open Builds in the selected project; candidate issue pages are filtered against that membership index, and the exact backlog total remains unknown until the candidate stream is exhausted.
