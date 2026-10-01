"""Small draw.io JSON-RPC client. Uses curl, which works on this host."""
import json
import subprocess
import sys
from pathlib import Path

HEADERS = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}

def rpc(payload):
    cmd = ['curl', '-sS', '-i', '--max-time', '60', 'https://mcp.draw.io/mcp']
    for key, value in HEADERS.items():
        cmd += ['-H', f'{key}: {value}']
    cmd += ['--data-binary', '@-']
    res = subprocess.run(cmd, input=json.dumps(payload), text=True, capture_output=True, check=True)
    head, body = res.stdout.split('\n\n', 1)
    status = int(head.splitlines()[0].split()[1])
    if status not in (200, 202, 204):
        raise RuntimeError(f'HTTP {status}: {body[:400]}')
    for line in head.splitlines()[1:]:
        key, _, value = line.partition(':')
        if key.lower() == 'mcp-session-id':
            HEADERS['Mcp-Session-Id'] = value.strip()
    if not body.strip():
        return None
    if body.lstrip().startswith('{'):
        result = json.loads(body)
    else:
        result = next(json.loads(line[6:]) for line in body.splitlines() if line.startswith('data: '))
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result

def call(name, args):
    HEADERS.pop('Mcp-Session-Id', None)
    HEADERS.pop('MCP-Protocol-Version', None)
    init = rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
        'protocolVersion': '2025-03-26', 'capabilities': {},
        'clientInfo': {'name': 'codex-drawio-diagram', 'version': '1.0'}}})
    HEADERS['MCP-Protocol-Version'] = init['result']['protocolVersion']
    rpc({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
    return rpc({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                'params': {'name': name, 'arguments': args}})['result']

if __name__ == '__main__':
    name, args_file, output = sys.argv[1:]
    result = call(name, json.loads(Path(args_file).read_text()))
    Path(output).write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({'saved': output, 'isError': result.get('isError', False),
                      'contentTypes': [c['type'] for c in result.get('content', [])]}, ensure_ascii=False))
