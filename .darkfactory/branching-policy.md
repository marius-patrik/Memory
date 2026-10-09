# Branching policy

`dev` is the integration branch and `main` is the release branch. Both branches require the `Validate` check, reject force pushes and deletion, and accept changes only through current, green pull requests. Feature work targets `dev`; only release pull requests target `main`.

DarkFactory management remains enabled. The external Codex Review gate is not part of this repository's required checks.
