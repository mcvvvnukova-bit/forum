#!/usr/bin/env bash
set -euo pipefail

target_user="${TARGET_USER:-testing-user}"
sudoers_file="/etc/sudoers.d/99-codex-${target_user}"
mode="${1:---enable}"

if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" "$@"
fi

case "$mode" in
  --enable)
    tmp_file="$(mktemp)"
    cat > "$tmp_file" <<EOF
# Temporary maintenance access for Codex over the existing SSH key.
# Remove with: sudo /home/${target_user}/manage_codex_sudo.sh --disable
${target_user} ALL=(ALL) NOPASSWD:ALL
EOF
    chown root:root "$tmp_file"
    chmod 0440 "$tmp_file"
    visudo -cf "$tmp_file" >/dev/null
    install -o root -g root -m 0440 "$tmp_file" "$sudoers_file"
    rm -f "$tmp_file"
    visudo -cf /etc/sudoers >/dev/null
    printf 'Enabled passwordless sudo for %s via %s\n' "$target_user" "$sudoers_file"
    ;;
  --disable)
    rm -f "$sudoers_file"
    visudo -cf /etc/sudoers >/dev/null
    printf 'Disabled passwordless sudo for %s\n' "$target_user"
    ;;
  *)
    printf 'Usage: %s [--enable|--disable]\n' "$0" >&2
    exit 2
    ;;
esac
