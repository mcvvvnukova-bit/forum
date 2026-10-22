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

## Conditional next phase

After a successful media/resource pilot, enable automatic recording of one
conference at a time and process finalized files using Polza's
`ai-sage/gigaam-v3`. Publish the transcript and protocol to
**https://outline.mvpspace.ru**, under Kuzmina's dedicated identity in that
workspace. This is a different Outline instance from docs.astforum.ru.
