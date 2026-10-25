# PROJ-182: honour manual recording stops

Work package: https://roadmap.astforum.ru/work_packages/220

## Design

The owner's request to fix the diagnosed controller authorizes this bounded
change: a successful manual Stop pauses automatic recording for that meeting
ID, including across controller restarts. A successful manual Start resumes
automatic recovery. A new meeting ID starts with the existing automatic policy.
Recorder failures retain the 45-second grace and 10-second retry delay.

Jicofo's confirmed `jibri-recording-status` publication identifies the human
terminator for `off`, and the initiator for `on`. Consume these existing private
container events; do not treat an accepted but unauthorized/rejected request as
a successful stop. Ignore failures, other recording modes and controller actors.
Persist the manual choice before advancing the log checkpoint; replay is
idempotent. If reading or parsing control events fails, refuse automatic starts.
Do not store raw logs, participant identities, tokens or transcript content.

Alternatives: removing recovery would also lose recovery after real failures;
a new Prosody extension would require a broader signaling deployment. Existing
Jicofo publications provide the required confirmed signal without changing calls.

## Implementation plan

**Goal:** manual Stop remains stopped until a successful manual Start.
**Architecture:** parse confirmed Jicofo status publications and persist a
per-meeting `manualPaused` flag plus an independent log checkpoint.
**Tech stack:** existing Python standard library, Docker CLI and systemd.
**Spec:** Design section above; existing branch `codex/PROJ-182-vks-recording`.

### Global constraints

- Preserve recordings, credentials, pipeline and all current resource gates.
- Restart only the controller; do not interrupt the active conference.
- Commit with PROJ-182, push, update PR 51, verify OpenProject association.

### Review focus

- Human stop must survive a late recorder departure and controller restart.
- Controller starts, failures and rejected requests must not resume a pause.
- A subsequent successful manual start must re-enable failure recovery.
- Replayed/late events and another meeting with the same room name stay isolated.
- Log failures must not cause automatic starts or skip unpersisted choices.

### Task 1: preserve confirmed manual choices

Files: `deployment/jitsi-recording/controller.py`,
`tests/integration/test_jitsi_recording_controls.py`, existing controller tests,
and the recording README/verification notes.

- [ ] Add a tick regression: confirmed manual Stop must persist a pause and
  never create a new recording, even after time advances and state is reloaded.
- [ ] Run the regression and confirm the existing controller starts again.
- [ ] Add the publication parser and checkpointed reader; gate both initial
  eligibility and the final pre-start check on the persisted manual choice.
- [ ] Verify explicit resume, real failure recovery, event replay/order, meeting
  isolation, malformed events, log-read failure and state-before-cursor writes.
- [ ] Run all Python integration tests and the repository layout check.
- [ ] Review, commit, push, update PR and verify its OpenProject association.
- [ ] Back up and atomically replace the server controller, restart that service,
  and verify manual-stop suppression past the original retry interval.
