# Jibri pilot on the existing VPS — implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkbox syntax.

**Goal:** Install one bounded Jibri on vks.mvpspace.ru and prove that a real conference produces a playable recording with audio while the shared VPS remains responsive.

**Architecture:** Extend the existing stable-11248 Compose deployment with a separately maintained recording override. Preserve JWT/guest access and the existing service memory limits; do not recreate JVB. Start with manual recording. Successful media and resource checks unlock the separately planned automatic recording and post-processing phase, targeting **https://outline.mvpspace.ru**.

**Tech Stack:** Jitsi stable-11248, matching official Jibri image, Python standard library, Bash, Jitsi lib-jitsi-meet, Codex in-app browser.

## Global constraints

- OpenProject: real display ID PROJ-182, internal work package 220.
- One simultaneously recorded conference, as confirmed by the owner.
- No secrets or meeting media in Git; backup before cutover, verify zero active calls twice.
- Preserve JWT authentication and guest links; never use `docker compose down -v`.
- All browser interaction uses the Codex in-app browser. Test media is synthetic and clearly identified.
- Record at 1280×720, 15 fps, CRF 28; Jibri limit 2 GiB RAM and 2.5 CPUs. These are pilot settings, subject to measurement.
- New Outline is a distinct workspace. Provision/verify Kuzmina there before any publication; do not use the owner's personal account.
- Owner supplied Polza credentials for GigaAM. Use Polza only; default summary model google/gemini-2.5-flash. Keep credentials outside Git and logs.

## Task 1: Reproducible bounded installation

**Files:**
- Create: `deployment/jitsi-recording/install.py`
- Create: `deployment/jitsi-recording/recording.override.yaml`
- Create: `deployment/jitsi-recording/finalize.sh`
- Create: `tests/integration/test_jitsi_recording_install.py`

**Interfaces:** `merge_env(content, updates) -> str`; `prepare(root, assets, recording_root, backup_root, stats) -> dict` preserve unknown settings, back up original files, and refuse an active or unmeasurable conference count.

- [ ] Write installer tests for preserving JWT/unknown settings, deduplicating managed keys, refusing active calls without mutations, and recovering original configuration from backup.
- [ ] Run `python3 -m unittest discover -s tests/integration -p 'test_jitsi_recording_install.py' -v`; verify a meaningful RED result.
- [ ] Implement installer and override using the pinned official image digest `sha256:04c937a3a208bef00e65614fa6c1708e65ba40fd600e18fff74eec7182adcb9d`.
- [ ] Run the same tests; expect all passing.
- [ ] On the VPS run the installer with `--apply`, validating Compose before and after zero-call checks. Recreate only Prosody, Jicofo, web and the new Jibri.
- [ ] Inspect generated recording config, Jibri health and brewery availability; rerun existing signaling/HTTP checks on the VPS.

## Task 2: Conference and resource proof

**Files:**
- Create: `scripts/deployment/jitsi-recording/qa.html`
- Create: `scripts/deployment/jitsi-recording/qa_server.py`
- Create: `scripts/deployment/jitsi-recording/measure.py`

**Interfaces:** A local-only test page connects a synthetic participant to a uniquely named QA conference; its visible controls start/stop recording. Measurement samples host RAM, swap and Docker statistics without printing tokens.

- [ ] Use public lib-jitsi-meet APIs verified from the installed bundle. Serve the test harness on loopback; never publish a moderator token in a public fixture.
- [ ] Join through IAB, publish a synthetic canvas and generated audio, start recording, wait for the actual active state, and record for at least two minutes.
- [ ] Stop cleanly and use ffprobe/ffmpeg to verify both audio/video streams, duration and non-silent audio; save a frame and resource measurements outside Git.
- [ ] Check that existing applications remain healthy, no new OOM/restart occurred, and at least 512 MiB MemAvailable remained throughout. If not, stop Jibri and report the measured limit.
- [ ] Record the tested media dimensions and duration. A two-minute pilot does not establish unlimited call length, participant capacity or peak concurrent application load.

## Task 3: Publish evidence and conditional handoff

**Files:**
- Create: `deployment/jitsi-recording/README.md`
- Create: `deployment/jitsi-recording/VERIFICATION.md`

- [ ] Save the commands, observed results, rollback paths and remaining limits.
- [ ] Run the focused tests, repository layout check and GitNexus detect_changes; commit only this task's files with PROJ-182.
- [ ] Push `codex/PROJ-182-vks-recording`, create/update a PR with `OP#PROJ-182`, attach it to this chat and verify its native OpenProject link.
- [ ] If the pilot passes, continue with automatic recording and the Outline pipeline in this same chat. If provider access is still missing, prepare the independently verifiable parts and state that concrete blocker.

## Review focus

No secret leakage through URLs/logs; no cutover during a real meeting; a valid MP4 is not by itself proof of sound; finalization must not block Jibri availability; do not confuse docs.astforum.ru with outline.mvpspace.ru.

## Task 4: Conditional automatic recording and meeting protocols

After Task 2 passes, use Jicofo's existing private debug endpoints to discover live
rooms and stable meeting IDs. This avoids modifying Prosody or restarting meetings.
A bounded host service joins briefly as a clearly named recording controller,
requests file recording through authenticated BOSH, then disconnects. Poll every
five seconds; verify current meeting ID and humans before any request. One Jibri
means overlapping meetings cannot all be recorded from their beginning. Persist
coverage failures and retry while a room remains live; never claim retrospective
recording. Do not start below 5 GiB free disk or 512 MiB available RAM.

- [ ] Add tests for exclusion of recorder/controller-only rooms, session reuse,
  pending/active recording deduplication, unknown states, safe XML/JWT, and
  grounded summary validation. Observe RED before implementation.
- [ ] Implement controller, local durable state, separate postprocessor, systemd
  services, and a narrow-scope Outline bootstrap under Kuzmina.
- [ ] Finalized files only: convert sequential 120-second mono WAV segments,
  transcribe using Polza ai-sage/gigaam-v3, cache completed segments, summarize
  through google/gemini-2.5-flash. Treat transcripts as untrusted input and reject
  summary evidence not present in cited segments. Mark AI output for review.
- [ ] Verify Outline auth.info as Kuzmina on outline.mvpspace.ru. Create a private
  meeting collection, grant the existing owner access, publish one page per
  recording with native transcript/video attachments and read it again.
- [ ] Test a new synthetic meeting without pressing Start recording. Leave the
  meeting and verify automatic finalization, transcription, summary publication,
  stable page/attachment IDs on retry, and service recovery.
- [ ] Run focused tests, layout, GitNexus change gate, one fresh branch review,
  update PR #51 and verify its OpenProject link. Record operational limits and
  cleanup the isolated QA TURN/tunnels without affecting Jibri.
