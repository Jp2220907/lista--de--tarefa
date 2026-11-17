"""Serviço HTTP local de teste; não valida as políticas do Supabase real."""
import json
import base64
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from cloud import SupabaseHTTP


def api_for(url):
    api = SupabaseHTTP({'url': 'https://fixture.supabase.co', 'publishableKey': 'sb_publishable_fixture'})
    api.url = url  # Somente este fixture usa HTTP em loopback.
    return api


class SupabaseFixture:
    def __init__(self):
        self.users = {name: {'id': str(uuid4()), 'email': name, 'confirmed': True} for name in ('ana@example.test', 'bia@example.test')}
        self.tokens = {}
        self.passwords = {email: 'senha-fixture-123' for email in self.users}
        self.recoveries = []
        self.refreshes = {}
        self.rows = {}
        self.fail = False
        self.refresh_count = 0
        self.guard = threading.Lock()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status, data):
                encoded = json.dumps(data).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers(); self.wfile.write(encoded)

            def dispatch(self):
                with owner.guard:
                    if owner.fail:
                        return self.reply(503, {'code': 'unavailable'})
                    parsed = urlsplit(self.path); query = parse_qs(parsed.query)
                    body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or '{}')
                    if self.headers.get('apikey') != 'sb_publishable_fixture':
                        return self.reply(401, {'code': 'bad_key'})
                    def session(user):
                        def encoded(value):
                            return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
                        token = '.'.join([encoded({'alg': 'HS256', 'typ': 'JWT'}), encoded({'sub': user['id'], 'exp': int(time.time()) + 3600, 'nonce': str(uuid4())}), encoded('assinatura-ficticia')])
                        refresh = str(uuid4())
                        owner.tokens[token] = user
                        owner.refreshes[refresh] = user
                        return {'access_token': token, 'refresh_token': refresh, 'expires_in': 3600, 'user': user}
                    if parsed.path == '/auth/v1/signup':
                        owner.users.setdefault(body['email'], {'id': str(uuid4()), 'email': body['email'], 'confirmed': False})
                        owner.passwords.setdefault(body['email'], body['password'])
                        return self.reply(200, {'user': owner.users[body['email']]})
                    if parsed.path == '/auth/v1/recover':
                        user = owner.users.get(body.get('email'))
                        if user:
                            owner.recoveries.append({'session': session(user), 'redirect': query.get('redirect_to', [''])[0]})
                        return self.reply(200, {})
                    if parsed.path == '/auth/v1/token':
                        if query.get('grant_type') == ['refresh_token']:
                            user = owner.refreshes.pop(body.get('refresh_token'), None)
                            if not user: return self.reply(400, {'error_code': 'refresh_token_not_found'})
                            owner.refresh_count += 1
                            return self.reply(200, session(user))
                        user = owner.users.get(body.get('email'))
                        if not user or body.get('password') != owner.passwords.get(body.get('email')):
                            return self.reply(400, {'error_code': 'invalid_credentials'})
                        if not user['confirmed']:
                            return self.reply(400, {'error_code': 'email_not_confirmed'})
                        return self.reply(200, session(user))
                    token = self.headers.get('Authorization', '').removeprefix('Bearer ')
                    user = owner.tokens.get(token)
                    if not user:
                        return self.reply(401, {'error_code': 'invalid_credentials'})
                    if parsed.path == '/auth/v1/user':
                        if self.command == 'PUT':
                            password = body.get('password')
                            if not isinstance(password, str) or len(password) < 8:
                                return self.reply(422, {'error_code': 'weak_password'})
                            if password == owner.passwords[user['email']]:
                                return self.reply(422, {'error_code': 'same_password'})
                            owner.passwords[user['email']] = password
                        return self.reply(200, user)
                    if parsed.path == '/auth/v1/logout':
                        owner.tokens.pop(token, None)
                        return self.reply(204, None)
                    if parsed.path != '/rest/v1/tasks':
                        return self.reply(404, {'code': 'not_found'})
                    allowed = {'id', 'text', 'notes', 'completed', 'due_at', 'created_at'} if self.command == 'POST' else {'text', 'notes', 'completed', 'due_at'}
                    if self.command != 'GET' and set(body) - allowed:
                        return self.reply(403, {'code': 'forbidden_column'})
                    if self.command == 'POST':
                        key = body.get('id', str(uuid4()))
                        if key in owner.rows:
                            return self.reply(409, {'code': '23505'})
                        row = {'id': key, 'text': body['text'], 'notes': '', 'completed': False, 'due_at': None,
                               'created_at': datetime.now(timezone.utc).isoformat(), **body, 'user_id': user['id']}
                        owner.rows[key] = row
                        result = [row]
                    else:
                        result = [row for row in owner.rows.values() if row['user_id'] == user['id']]
                        if 'id' in query:
                            key = query['id'][0].removeprefix('eq.')
                            result = [row for row in result if row['id'] == key]
                        if self.command == 'PATCH':
                            for row in result: row.update(body)
                        offset = int(query.get('offset', ['0'])[0]); limit = int(query.get('limit', ['1000'])[0])
                        result = sorted(result, key=lambda row: (row['created_at'], row['id']))[offset:offset+limit]
                    keys = query.get('select', ['id,text,notes,completed,due_at,created_at'])[0].split(',')
                    return self.reply(200, [{key: row[key] for key in keys} for row in result])

            do_GET = dispatch
            do_POST = dispatch
            do_PATCH = dispatch
            do_PUT = dispatch

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
