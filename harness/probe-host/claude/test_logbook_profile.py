"""Logbook profile contract; all process/user calls remain mocked by launcher tests."""
import base64
import json
from pathlib import Path
from test_bench_claude_cell import load, CWD, CELL, SESSION


import unittest


class LogbookProfileTests(unittest.TestCase):
    def test_logbook_profile_has_only_fixed_readonly_dependencies_and_no_extra_bound(self):
        launcher = load()
        assert 'logbook' in launcher.PROFILES, 'Logbook needs an isolated fixed profile'
        profile = launcher.PROFILES['logbook']
        assert profile['read_only_binds'] == [
            ('/var/lib/bench-ceilings/tools/node_modules', '/home/logbook/node_modules'),
            ('/var/lib/bench-ceilings/tools/ms-playwright', '/home/logbook/ms-playwright'),
            ('/var/lib/bench-claude/tools/logbook/pilot-sandbox.mjs', '/home/logbook/pilot-sandbox.mjs'),
        ]
        assert profile['hide_git'] is False
        props = launcher.isolation_props(Path('/cells') / CELL, 'bcl-abcdef12', CWD, profile)
        assert 'RuntimeMaxSec=infinity' in props  # only the frozen phase timer terminates this lane
        for prop in ['NoNewPrivileges=yes', 'PrivateNetwork=yes', 'ProtectSystem=strict', 'PrivateDevices=yes', 'ProtectProc=invisible']:
            assert prop in props
        # Nested bwrap needs a mountable /proc (smoke 2026-09-29); every other profile keeps ProtectKernelTunables.
        assert 'ProtectKernelTunables=yes' not in props
        for other in ('default', 'harbor'):
            assert 'ProtectKernelTunables=yes' in launcher.isolation_props(Path('/cells') / CELL, 'bcl-abcdef12', CWD, launcher.PROFILES[other])
        assert launcher.CELL_ENV['CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK'] == '1'
        assert launcher.CELL_SETTINGS == {'switchModelsOnFlag': False}


    def test_logbook_continuation_accepts_only_its_exact_tool_policy(self):
        launcher = load()
        assert hasattr(launcher, 'logbook_args'), 'root-owned Logbook argv policy missing'
        args = launcher.logbook_args(CWD, 'high', SESSION)
        payload = base64.b64encode(json.dumps(args).encode()).decode()
        parsed, session = launcher.validate_resume_args(payload, staged=True, profile_name='logbook', cwd=CWD)
        assert parsed == args and session == SESSION
        assert '--no-session-persistence' not in args
        assert '--append-system-prompt' not in args
        assert args[args.index('--tools') + 1] == ''
        assert args[args.index('--allowedTools') + 1] == 'mcp__isolated__exec'
        mcp = json.loads(args[args.index('--mcp-config') + 1])
        assert list(mcp['mcpServers']) == ['isolated']
        assert mcp['mcpServers']['isolated']['args'] == ['/home/logbook/pilot-sandbox.mjs', '--mcp', '--workspace', CWD, '--node-modules', '/home/logbook/node_modules', '--browsers', '/home/logbook/ms-playwright']
        import unittest
        for extra in [['--append-system-prompt', 'extra'], ['--tools', 'Bash'], ['--mcp-config', '{}']]:
            with unittest.TestCase().assertRaises(SystemExit):
                launcher.validate_resume_args(base64.b64encode(json.dumps(args + extra).encode()).decode(), staged=True, profile_name='logbook', cwd=CWD)


    def test_bwrap_apparmor_grants_only_binary_userns(self):
        profile = Path(__file__).with_name('logbook-bwrap-apparmor')
        assert profile.is_file(), 'bwrap requires its own AppArmor userns grant'
        text = profile.read_text()
        assert 'profile logbook-bwrap /usr/bin/bwrap flags=(unconfined)' in text
        assert 'userns,' in text
        assert 'sysctl' not in text
