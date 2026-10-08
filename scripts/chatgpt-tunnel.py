#!/usr/bin/env python3
"""Local operator helper for the private ChatGPT tunnel; never accepts a key argument."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ORIGIN = 'https://autotask-mcp.raritysolutions.com'
TENANT = '581437a9-8e26-4857-bc56-1d5a04e7f752'
ALIAS = 'rarity-autotask-chatgpt'
STATE = Path.home() / '.config' / ALIAS
KEY = STATE / 'runtime-key'
CLI = Path.home() / '.local/bin/tunnel-client'


def private_directory():
    if STATE.is_symlink():
        raise ValueError('The private state directory must not be a symlink.')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.chmod(0o700)


def save_key():
    if not sys.stdin.isatty():
        raise ValueError('Run save-key in your own interactive terminal.')
    private_directory()
    value = getpass.getpass('OpenAI tunnel runtime API key (hidden): ').strip()
    if not value.startswith('sk-') or any(c.isspace() for c in value):
        raise ValueError('Expected an OpenAI runtime API key without whitespace.')
    # Atomic replacement, refusing symlinks and avoiding world-readable temporary files.
    if KEY.is_symlink():
        raise ValueError('The key file must not be a symlink.')
    import tempfile
    fd, name = tempfile.mkstemp(prefix='.runtime-key-', dir=STATE)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(value + '\n')
        os.replace(name, KEY)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print('Runtime key saved locally with owner-only access; its value was not printed.')


def check_key():
    if KEY.is_symlink() or not KEY.is_file():
        raise ValueError('First run save-key in your terminal.')
    info = KEY.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError('Runtime key must be owned by you and readable only by you (mode 600).')
    if not KEY.read_text().strip():
        raise ValueError('Runtime key is empty.')


def check_local():
    def get(path):
        result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', ORIGIN + path], check=True, capture_output=True, text=True)
        return json.loads(result.stdout)
    if get('/health/ready').get('status') != 'ready':
        raise ValueError('MCP server is not ready.')
    metadata = get('/.well-known/oauth-protected-resource/mcp')
    if metadata.get('resource') != ORIGIN + '/mcp' or metadata.get('authorization_servers') != [f'https://login.microsoftonline.com/{TENANT}/v2.0']:
        raise ValueError('MCP resource or Entra issuer differs from the reviewed configuration.')
    # A tunnel must forward each user's OAuth token, never substitute a shared API token.
    response = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '15', '-o', os.devnull, '-w', '%{http_code}', '-X', 'POST', '-H', 'Content-Type: application/json', '--data', '{}', ORIGIN + '/mcp'], check=True, capture_output=True, text=True)
    if response.stdout != '401':
        raise ValueError('MCP endpoint did not reject an unauthenticated request with HTTP 401.')
    print('Local HTTPS readiness, Entra discovery and unauthenticated-request rejection passed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'save-key', 'connect', 'status', 'stop'])
    parser.add_argument('tunnel_id', nargs='?')
    args = parser.parse_args()
    if args.action == 'save-key':
        save_key()
        return
    if args.action == 'check':
        check_local()
        return
    if not CLI.is_file():
        raise ValueError('Install the official tunnel-client in ~/.local/bin first; see docs/CHATGPT-CONNECTION.md.')
    if args.action == 'connect':
        if not args.tunnel_id or not re.fullmatch(r'tunnel_[A-Za-z0-9]+', args.tunnel_id):
            raise ValueError('Supply the actual tunnel_id from OpenAI Platform.')
        check_key()
        check_local()
        subprocess.run([str(CLI), 'runtimes', 'connect', '--alias', ALIAS, '--profile', ALIAS, '--tunnel-id', args.tunnel_id, '--mcp-server-url', ORIGIN + '/mcp', '--runtime-api-key', 'file:' + str(KEY), '--json'], check=True)
        subprocess.run([str(CLI), 'runtimes', 'status', ALIAS, '--json'], check=True)
    else:
        subprocess.run([str(CLI), 'runtimes', args.action, ALIAS, '--json'], check=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        # Do not emit response bodies or subprocess command details containing credentials.
        print(str(exc) if isinstance(exc, ValueError) else 'Local operation failed; inspect tunnel status or the prerequisite configuration.', file=sys.stderr)
        sys.exit(1)
