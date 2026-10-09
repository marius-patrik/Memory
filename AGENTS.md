# Memory repository guidance

Use issue/spec -> feature branch -> validation -> pull request -> `dev`. Release only through a validated `dev` -> `main` pull request. DarkFactory management remains enabled; `Validate` is the required automated check, with no Codex Review gate.

Memory records and cursor authority remain manager-owned canonical events. Provider transcripts and corpus files are evidence only. Never write canonical event or projection files directly, and never admit secret-like content.
