"""Private state and bounded HTTP helpers; never log request bodies or secrets."""
import http.client
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import uuid


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False)
    temporary.chmod(0o600)
    temporary.replace(path)


def read(path, default=None):
    path = Path(path)
    return json.loads(path.read_text()) if path.exists() else default


class ApiError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__('Remote API HTTP ' + str(status))


def request_json(url, key, payload=None, timeout=180):
    headers = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    request = urllib.request.Request(url, headers=headers,
        data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode())
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read(8 * 1024**2))
    except urllib.error.HTTPError as error:
        raise ApiError(error.code) from None


def multipart(url, fields, path, content_type, key=None, timeout=240):
    """Stream files with a fixed length instead of holding meeting video in RAM."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username:
        raise ValueError('Upload requires an authenticated HTTPS origin')
    boundary = 'vks' + uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        if any(c in name for c in '\r\n"'):
            raise ValueError('Invalid multipart field')
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    filename = Path(path).name.replace('"', '_').replace('\r', '_').replace('\n', '_')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode())
    prefix = b''.join(parts)
    suffix = f'\r\n--{boundary}--\r\n'.encode()
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=timeout)
    try:
        connection.putrequest('POST', urllib.parse.urlunsplit(('', '', parsed.path, parsed.query, '')))
        connection.putheader('Content-Type', 'multipart/form-data; boundary=' + boundary)
        connection.putheader('Content-Length', str(len(prefix) + Path(path).stat().st_size + len(suffix)))
        if key:
            connection.putheader('Authorization', 'Bearer ' + key)
        connection.endheaders()
        connection.send(prefix)
        with Path(path).open('rb') as stream:
            while chunk := stream.read(1024**2):
                connection.send(chunk)
        connection.send(suffix)
        response = connection.getresponse()
        body = response.read(8 * 1024**2)
        if response.status >= 300:
            raise ApiError(response.status)
        return json.loads(body) if body else {}
    finally:
        connection.close()
