# PROJ-182 — Jibri pilot verification

Target: `vks.mvpspace.ru`, existing Beget VPS. Destination for the following
protocol phase: `https://outline.mvpspace.ru`.

## Verified so far

- Official stable-11248 Jibri image pinned to digest
  `sha256:04c937a3a208bef00e65614fa6c1708e65ba40fd600e18fff74eec7182adcb9d`.
- Cutover checked zero conferences/participants twice; JVB was not recreated.
- Private pre-change backup:
  `/root/jitsi-recording-backups/20261022T213856218447Z`.
- Jibri health: `IDLE`, `HEALTHY`; Jicofo detector: one available recorder.
- Existing public deployment checks pass on the VPS (5 tests).
- Existing signaling verification passes (11 checks), including invalid JWTs,
  guest waiting, moderator ownership, room scope and existing Cal.diy guest access.
- Installer tests preserve JWT and unknown configuration, refuse active or
  unknown call counts before writing, and retain a private original backup.
- Synthetic Russian speech is recognized successfully by Polza GigaAM-v3.

## Successful media/resource pilot

- Real MP4: 128.000 s, H264 1280x720 at 15 fps plus AAC, 2,443,275 bytes.
- Audio mean -17.8 dB, peak -3.0 dB; recorder frame visually contains the
  synthetic participant, clock and moving test graphic.
- Three-minute measurement: MemAvailable minimum 2,649,247,744 bytes (2.47 GiB),
  CPU busy maximum 59.65%, swap-out 15,976 pages (62.4 MiB).
- All initial/final container OOM flags, restart counts and start times match;
  every container with a healthcheck remained healthy. Jibri remained at restart
  count zero and returned IDLE/HEALTHY after finalization.
- Resource evidence: /opt/jitsi-recording/evidence/pilot-resources-media.json.
- Jibri recording session: 4175a114-7b4c-406a-8c45-a71a940604f8.

The first direct desktop UDP attempt failed ICE and sent no RTP; its small
MP4 and resource sample were deliberately rejected. Successful testing used a
loopback-only TURN/SSH tunnel. The private JVB bridge path and production JVB
configuration were unchanged. This does not certify every external user network.

## Automatic recording and Outline

A new synthetic meeting joined at 22:12:29 UTC. Without pressing Start recording,
the controller requested recording at 22:12:35; the client displayed recording
ON at 22:12:39. The last human left at 22:14:42, and Jibri finalized at 22:15:39.
Stable meeting ID: 29498235-529c-4f0a-84a9-fefa311379b3.
Recording session: c70fc22b-40db-4b23-9bcd-6d9d9a40c715.

Target Outline auth.info verifies Kuzmina (80d309bb-a84c-44ec-b57f-0749e4873793,
kuzmina@astforum.ru). The new collection is private with public sharing disabled;
the existing workspace owner has access. Database backup and a baseline document
fingerprint were saved before provisioning. Credentials remain outside Git.

The manual pilot's full transcript and native video/text attachments have been
published and read back under Kuzmina. Polza GigaAM-v3 succeeds. At this checkpoint
Polza returns HTTP 403 for google/gemini-2.5-flash because the provided API key does
not allow that model. The page clearly marks summary as pending, and the worker
will update the same page after the key gains text-model access. Do not claim a
completed live AI summary until that succeeds.

Mac-origin public HTTP checks experienced timeouts before any cutover; the same
checks on the VPS passed. Do not classify those as deployment regressions.

## Saved attachment integrity and recovery review

Authenticated downloads of both pilot pages' MP4/TXT attachments have SHA256
values identical to their originals (2,443,275 and 2,563,466 byte videos).
Each page has exactly two native attachments, authored by Kuzmina. Both systemd
services have zero automatic restarts; their steady host memory was about
27 MiB for the controller and 17 MiB for the processor.

The final independent branch review found one important controller recovery
issue: a persisted started/observed flag could suppress retries after Jibri
failed. A regression test reproduced failed startup and recorder loss, then
passed after reconciling against current room membership with a 45-second grace
period and a 10-second recovery delay. Eight scoped tests now pass. No additional
critical or minor findings were reported.

Outline's initial 100 MiB file limit was too small for ordinary meeting videos.
The live upload limit is raised to 1 GiB (matching Nginx allowance 1100 MiB),
with private copies of the original env/server config before cutover. This is a
finite per-attachment limit; larger files remain on the VPS and the job retains
an explicit retry/error state. No original recording is deleted.
