"""Install a bounded recording extension without replacing the existing stack."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess


def merge_env(content, updates):
    seen = set()
    result = []
    for line in content.splitlines():
        key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else None
        if key in updates:
            if key not in seen:
                result.append(key + "=" + updates[key])
                seen.add(key)
        else:
            result.append(line)
    result.extend(key + "=" + value for key, value in updates.items() if key not in seen)
    return "\n".join(result) + "\n"


def assert_idle(stats):
    if stats.get("conferences") != 0 or stats.get("participants") != 0:
        raise RuntimeError("Active or unknown conference count prevents configuration changes")


def write_env(path, content):
    temporary = path.with_name(path.name + ".proj182.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)
    temporary.chmod(0o600)
    temporary.replace(path)


def prepare(root, assets, recording_root, backup_root, stats):
    assert_idle(stats)
    original = (root / ".env").read_text()
    current = dict(line.split("=", 1) for line in original.splitlines() if "=" in line and not line.startswith("#"))
    for key in ["JWT_APP_SECRET", "CONFIG"]:
        if not current.get(key):
            raise RuntimeError("Required existing configuration is missing: " + key)
    # Validate source assets before making the first change.
    override = (assets / "recording.override.yaml").read_text().replace("@RECORDING_ROOT@", str(recording_root))
    finalize = (assets / "finalize.sh").read_bytes()
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = backup_root / stamp
    backup.mkdir(mode=0o700)
    for name in [".env", "recording.override.yaml"]:
        if (root / name).exists():
            shutil.copyfile(root / name, backup / name)
            (backup / name).chmod(0o600)
    compose_files = current.get("COMPOSE_FILE", "docker-compose.yml:compose.override.yaml").split(":")
    if "recording.override.yaml" not in compose_files:
        compose_files.append("recording.override.yaml")
    updates = {
        "COMPOSE_FILE": ":".join(compose_files),
        "ENABLE_RECORDING": "1",
        "JIBRI_INSTANCE_ID": "vks-recorder-1",
        "JIBRI_RECORDING_RESOLUTION": "1280x720",
        "JIBRI_RECORDING_FRAMERATE": "15",
        "JIBRI_RECORDING_CONSTANT_RATE_FACTOR": "28",
        "JIBRI_RECORDING_VIDEO_ENCODE_PRESET_RECORDING": "veryfast",
        "JIBRI_RECORDING_DIR": "/storage/recordings",
        "JIBRI_FINALIZE_RECORDING_SCRIPT_PATH": "/usr/local/bin/finalize-recording",
    }
    recording_root.mkdir(parents=True, exist_ok=True, mode=0o755)
    (recording_root / "finalize.sh").write_bytes(finalize)
    (recording_root / "finalize.sh").chmod(0o755)
    (root / "recording.override.yaml").write_text(override)
    write_env(root / ".env", merge_env(original, updates))
    return {"backup": str(backup), "recordingRoot": str(recording_root), "resolution": "1280x720", "fps": 15}


def command(root, *args):
    return subprocess.run(args, cwd=root, check=True, text=True, capture_output=True)


def stats(root):
    raw = command(root, "docker", "compose", "exec", "-T", "jicofo", "wget", "-qO-", "http://127.0.0.1:8888/stats").stdout
    return json.loads(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/opt/jitsi-meet"))
    parser.add_argument("--recording-root", type=Path, default=Path("/opt/jitsi-recording"))
    parser.add_argument("--backup-root", type=Path, default=Path("/root/jitsi-recording-backups"))
    parser.add_argument("--apply", action="store_true")
    options = parser.parse_args()
    if shutil.disk_usage(options.root).free < 5 * 1024**3:
        raise RuntimeError("At least 5 GiB free disk space is required before installing recording")
    report = prepare(options.root, Path(__file__).parent, options.recording_root, options.backup_root, stats(options.root))
    try:
        command(options.root, "docker", "compose", "config", "--quiet")
        assert_idle(stats(options.root))
    except Exception:
        backup = Path(report["backup"])
        shutil.copyfile(backup / ".env", options.root / ".env")
        if (backup / "recording.override.yaml").exists():
            shutil.copyfile(backup / "recording.override.yaml", options.root / "recording.override.yaml")
        else:
            (options.root / "recording.override.yaml").unlink()
        raise
    if options.apply:
        command(options.root, "docker", "compose", "up", "-d", "--no-deps", "prosody", "jicofo", "web", "jibri")
    report["applied"] = options.apply
    report["jvbRecreated"] = False
    print(json.dumps(report))


if __name__ == "__main__":
    main()
