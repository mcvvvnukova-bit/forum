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

## Media pilot status

The first synthetic participant joined and received moderator ownership. Jibri
joined the conference and launched ffmpeg, but the desktop participant's direct
UDP ICE path failed (`requestsSent` increased, `responsesReceived` remained zero;
RTP bytes/frames remained zero). This run does not prove a usable recording.
The desktop path is being isolated using a loopback-only TURN tunnel. No public
TURN endpoint or new public recording API has been exposed.

The initial resource measurement retained at least 2,977,361,920 bytes
MemAvailable and observed a maximum 54.13% CPU busy; 22,190 swap-out pages
occurred. Because that run lacked actual media, these figures do not establish
successful recording capacity. A successful media run must replace this result
before the conditional automatic recording phase is accepted.

Mac-origin public HTTP checks experienced timeouts before any cutover; running
the same checks on the VPS passed. Do not classify those timeouts as a recording
deployment regression.
