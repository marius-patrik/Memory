# Memory plugin

The Memory plugin converts canonical session events into typed, provenance-backed memory records. It also runs idle dream distillation, prepares explicitly admitted historical corpus entries as reviewable candidates, and migrates the operational Dream v1.3 cursor.

The plugin never writes memory projections or event files itself. Every accepted candidate crosses the manager's canonical memory mutation API, so replay, projection, supersession, and startup-context rules remain centralized. Provider-native transcripts and historical files are evidence inputs only; processing them does not make them state authority.

Dream cycles read only canonical session events. Corpus processing is opt-in, rejects links and path escapes, bounds input size, and skips secret-like material. The v1.3 migration copies the validated cursor into plugin operational state with source provenance and leaves the source file unchanged. Earlier cursor formats are rejected.
