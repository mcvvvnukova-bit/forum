# Recording on vks.mvpspace.ru

Work package: [PROJ-182](https://roadmap.astforum.ru/work_packages/220).

The recording extension lives alongside `/opt/jitsi-meet`, in `/opt/jitsi-recording`.
`recording.override.yaml` extends the matching vendor Jibri service without
changing the application's existing limits or recreating JVB. The official
stable-11248 image uses PulseAudio and needs no host audio loopback module.

## Installation

Copy this directory to `/opt/jitsi-recording` and run, as root:

```sh
python3 /opt/jitsi-recording/install.py --apply
docker compose --project-directory /opt/jitsi-meet ps
```

The installer checks Jicofo's in-container statistics before changing files and
again before cutover. Active calls or an unmeasurable count abort the operation.
Original `.env` and any existing recording override are retained in a private
timestamped directory under `/root/jitsi-recording-backups`.

Pilot settings: 1280×720, 15 fps, CRF 28, `veryfast`, 2 GiB RAM, 2.5 CPUs.
`/dev/shm` must be at least 2 GiB for the vendor startup check; this is not a
separate 2 GiB physical allocation. Actual shared-memory use counts toward the
container's memory limit. The HTTP control API is not published to the host.

Recordings live under `/var/lib/jitsi-meet/storage/jibri/recordings`.
The finalizer atomically marks a closed recording with `.recording-complete`;
it does not run speech recognition synchronously or delay Jibri's availability.
Media and credentials must never be added to Git.

## Verification

```sh
docker exec jitsi-meet-jibri-1 curl -fsS http://127.0.0.1:2222/jibri/api/v1.0/health
docker exec jitsi-meet-jicofo-1 wget -qO- http://127.0.0.1:8888/stats
python3 /opt/jitsi-admin/check_http.py
python3 /opt/jitsi-admin/verify_signaling.py
```

Health and brewery availability establish service readiness, not media success.
Use the loopback-only synthetic client in `scripts/deployment/jitsi-recording`
for a real conference, then inspect the resulting MP4 with ffprobe and check
that audio is non-silent. Keep moderator settings in a mode-0600 file outside
Git. `qa_server.py` serves that file only on `127.0.0.1`; never expose this test
server publicly. A temporary loopback TURN tunnel can isolate the synthetic
client from a blocked desktop UDP path. It is not part of the production stack.

## Rollback

Verify zero real calls first. Stop only `jibri`, restore the original `.env`
and previous `recording.override.yaml` from the selected backup (remove the
new override only when it did not exist in that backup), validate Compose,
then recreate only Prosody/Jicofo/web. Retain recording files and backups.
Never remove volumes. Do not stop unrelated applications on the shared VPS.

## Automatic recording and processing

The host controller polls Jicofo's existing **private** debug endpoints every
five seconds. It uses the stable `meeting_id`, excludes Jibri and its own brief
control participant, signs a room-scoped JWT, joins through local BOSH, requests
file recording, and disconnects. It exposes no HTTP listener and requires no
Prosody plugin. Existing Jitsi recording indicators remain visible.

The postprocessor scans only atomic finalizer markers newer than its initial
activation. Original MP4s remain on the VPS. Each 120-second audio segment is
sent to Polza GigaAM-v3; completed text is cached before the next segment.
A text model (`google/gemini-2.5-flash` by default) produces a Russian JSON
summary. Cited evidence must exist in the referenced segment; task owners and
deadlines must be literal parts of that evidence. These checks cannot prove the
correctness of a paraphrase, so every page marks AI results for human review.
No speaker identification is claimed.

`bootstrap_outline.py` backs up the target database, provisions **Кузьмина**,
checks `auth.info`, creates the private collection **Встречи ВКС** with public
sharing disabled, and grants the existing workspace owner access. A scoped API
key is stored only in `/opt/jitsi-recording/secrets/outline.private.json` (0600).
The destination is **https://outline.mvpspace.ru**.

Private configuration files (parent directory 0700, files 0600):

- `polza.private.json`: `baseUrl` and `apiKey`.
- `outline.private.json`: identity, target URL, API key and collection ID, created by bootstrap.
- `pipeline.private.json`: activation `notBefore` timestamp and optional `summaryModel`.

Install the supplied systemd units, create private `state/` and `work/`, then:

```sh
python3 /opt/jitsi-recording/bootstrap_outline.py
systemctl daemon-reload
systemctl enable --now vks-recording-controller vks-recording-pipeline
systemctl status vks-recording-controller vks-recording-pipeline
journalctl -u vks-recording-controller -u vks-recording-pipeline --since today
```

The first processing attempt creates one deterministic UUIDv4-shaped document.
Upload tickets and successful attachment IDs are persisted before proceeding;
retries reuse the page and completed attachments. If the summary model is
unavailable, video and transcript are still published with an explicit pending
status. The same page is updated when access recovers. Existing completed audio
segments are not retranscribed. Retry delays grow to 30 minutes for processing
errors; pending summaries retry every five minutes. A finalized QA recording
can be retried immediately with `pipeline.py --recording <recording-uuid>`.

## Operational limits

- **One simultaneous recording.** Overlapping rooms wait while a recorder is
  busy; a late start cannot recover earlier speech. Coverage states are retained
  in `state/controller.json`.
- New recording starts are refused below 5 GiB free disk or 512 MiB available RAM.
  No retention or deletion of original recordings is automatic. Monitor free
  space and the job states; recordings are also stored as Outline attachments.
- A short pilot with one synthetic participant does not establish capacity for
  arbitrarily long meetings, many participants or peak load from other apps.
- The pilot's desktop media used a private SSH/TURN path because direct desktop
  UDP was unavailable. Production JVB networking was unchanged; this pilot does
  not certify every external participant network.
- Finalization follows Jibri's normal empty-meeting timeout (observed about one
  minute after the last human left). ASR and model processing begin afterward.
- The services log event type, recording ID, destination page URL and error type,
  without audio, transcript, JWTs or API keys. Pending/error jobs are persisted
  locally; no unsolicited email or chat notifications are sent.

To stop automatic behavior while retaining evidence:

```sh
systemctl disable --now vks-recording-controller vks-recording-pipeline
```

Stop those services before the Jibri rollback described above. Keep `state/`,
`work/`, recordings and database backups to preserve recovery and avoid duplicate
publication.
