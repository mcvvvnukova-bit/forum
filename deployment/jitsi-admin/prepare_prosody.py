"""Adapt two pinned upstream modules without changing token verification.

The upstream wait module regards every token as a host. Invited participants and
unverified token strings on the guest realm must instead wait for a moderator.
"""
import hashlib
from pathlib import Path
import subprocess

CUSTOM = Path('/var/lib/jitsi-meet/prosody/prosody-plugins-custom')
HASHES = {
    'mod_muc_wait_for_host.lua': 'a8886b1b7e6122f23f3168b380035241853b7bb667d0fbc10dba49656d92cd95',
    'mod_token_verification.lua': '6ae438357c6fc0c410885eb92b81f7c8b6db0c4fa792de3a555b5c90895f2369',
}


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError('Pinned module contract changed; stop before cutover')
    return source.replace(old, new)


def main():
    CUSTOM.mkdir(parents=True, exist_ok=True)
    (CUSTOM / 'mod_forum_persistent_lobby.lua').write_text("""-- XMPP_MODULES is shared with the guest realm; load this dependency only once.
if module.host == 'meet.jitsi' then
    module:depends('persistent_lobby');
end
""")
    for filename, expected in HASHES.items():
        raw = subprocess.check_output(['docker', 'compose', 'exec', '-T', 'prosody', 'cat', '/prosody-plugins/' + filename], cwd='/opt/jitsi-meet')
        if hashlib.sha256(raw).hexdigest() != expected:
            raise RuntimeError('Unreviewed upstream version: ' + filename)
        source = raw.decode()
        if filename == 'mod_muc_wait_for_host.lua':
            source = replace_once(source, "local disable_auto_owners =", """-- PROJ-213: only verified organizer claims release the persistent lobby.
local function is_host(session)
    if not session or not session.auth_token
        or session.jitsi_meet_auth_issuer ~= 'vks-jitsi-admin' then return false; end
    local user = session.jitsi_meet_context_user or {};
    return user.moderator == true or user.moderator == 'true'
        or user.affiliation == 'owner';
end

local disable_auto_owners =""")
            source = replace_once(source,
                '(session.auth_token or (session.username and jid.host(occupant.bare_jid) == muc_domain_base))',
                'is_host(session)')
            source = replace_once(source, """if jid.host(o.bare_jid) == muc_domain_base
            -- or this is anonymous that upgraded by passing token which we validated
            or prosody.full_sessions[o.jid].auth_token then""", "if is_host(prosody.full_sessions[o.jid]) then")
            source = replace_once(source, """if session.auth_token
        or (session.username and jid.host(occupant.bare_jid) == muc_domain_base) then""", 'if is_host(session) then')
            source += """
-- Run after token_affiliation (-3.5) and before the lobby gate (-4).
-- A participant token must not acquire membership that bypasses the host wait.
module:hook('muc-occupant-pre-join', function(event)
    local room, occupant, session = event.room, event.occupant, event.origin;
    if room:get_members_only() and not room.has_host
        and not is_admin(occupant.bare_jid) and not is_host(session) then
        room:set_affiliation(true, occupant.bare_jid, 'none');
    end
end, -3.75);
"""
            source = '-- Adapted from pinned Jitsi stable-11248 by prepare_prosody.py.\n' + source
        else:
            # Upstream logs a complete bearer token on a room mismatch, and its
            # shared secret at debug level. Preserve useful errors without secrets.
            source = source.replace('tostring(session.auth_token)', '"[redacted]"')
            source = source.replace('tostring(token_util.appSecret)', '"[redacted]"')
        (CUSTOM / filename).write_text(source)
    print('Prepared pinned moderator gate and redacted token logs')


if __name__ == '__main__':
    main()
