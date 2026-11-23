"""Servidor de uso pessoal no notebook. Atende apenas no loopback."""
import argparse
import json
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from cloud import CloudError, SharedTasks

STATIC = Path(__file__).resolve().parent / 'static'
FILES = {'/': ('index.html', 'text/html; charset=utf-8'),
         '/index.html': ('index.html', 'text/html; charset=utf-8'),
         '/sw.js': ('sw.js', 'text/javascript; charset=utf-8'),
         '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
         '/assistant.js': ('assistant.js', 'text/javascript; charset=utf-8'),
         '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
         '/calendar.js': ('calendar.js', 'text/javascript; charset=utf-8'),
         '/notifications.js': ('notifications.js', 'text/javascript; charset=utf-8'),
         '/push-state.js': ('push-state.js', 'text/javascript; charset=utf-8'),
         '/connection.js': ('connection.js', 'text/javascript; charset=utf-8'),
         '/account-ui.js': ('account-ui.js', 'text/javascript; charset=utf-8'),
         '/recuperar-senha.html': ('recuperar-senha.html', 'text/html; charset=utf-8'),
         '/recovery.js': ('recovery.js', 'text/javascript; charset=utf-8'),
         '/vendor/supabase.js': ('vendor/supabase.js', 'text/javascript; charset=utf-8'),
         '/cloud-config.json': ('cloud-config.json', 'application/json; charset=utf-8'),
         '/manifest.webmanifest': ('manifest.webmanifest', 'application/manifest+json'),
         '/icons/assistant-robot.png': ('icons/assistant-robot.png', 'image/png'),
         '/icons/icon-192.png': ('icons/icon-192.png', 'image/png'),
         '/icons/icon-512.png': ('icons/icon-512.png', 'image/png')}


def make_server(port=8765, db_path=None, cloud_api=None):
    store = SharedTasks(db_path, cloud_api)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body, content_type='application/json; charset=utf-8'):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(body)

        def _local_request(self):
            port = self.server.server_port
            host = self.headers.get('Host', '')
            origin = self.headers.get('Origin')
            if host not in {f'127.0.0.1:{port}', f'localhost:{port}'} or (origin and origin != f'http://{host}'):
                self._send(403, {'error': 'Esta versão aceita apenas acesso local pela própria página.'})
                return False
            return True

        def _body(self):
            if self.headers.get_content_type() != 'application/json':
                raise ValueError('Envie os dados como JSON.')
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise ValueError('Tamanho da requisição inválido.') from None
            if not 0 < length <= 65536:
                raise ValueError('Requisição vazia ou grande demais.')
            try:
                data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                raise ValueError('JSON inválido.') from None
            if not isinstance(data, dict):
                raise ValueError('Envie um objeto JSON.')
            return data

        def _account_status(self):
            return {**store.account.status(), 'local_count': len(store.local.list_tasks()), 'desktop': True}

        def _context(self):
            status = store.account.status()
            expected = self.headers.get('X-Task-Context')
            if expected != status['context'] and (status['mode'] == 'cloud' or expected is not None):
                raise CloudError('A conta mudou. Atualize a página antes de continuar.', 409)
            return status['context']

        def _get(self, path):
            if path == '/api/account':
                self._send(200, self._account_status())
            elif path == '/api/tasks':
                selected = store.selected(self._context())
                self._send(200, {'tasks': selected.list_tasks()})
            elif path in FILES:
                filename, mime = FILES[path]
                self._send(200, (STATIC / filename).read_bytes(), mime)
            else:
                self._send(404, {'error': 'Página não encontrada.'})

        def _change(self, path):
            if self.command == 'POST' and path == '/api/account/recover':
                self._send(200, store.account.recover_password(self._body()))
            elif self.command == 'POST' and path == '/api/account/signup':
                self._send(200, store.account.signup(self._body(), 'http://' + self.headers['Host'] + '/'))
            elif self.command == 'POST' and path == '/api/account/login':
                store.account.login(self._body())
                self._send(200, self._account_status())
            elif self.command == 'POST' and path == '/api/account/logout':
                self._context()
                self._body()
                store.account.logout()
                self._send(200, self._account_status())
            elif self.command == 'POST' and path == '/api/account/import':
                context = self._context()
                self._body()
                self._send(200, store.import_local(context))
            elif self.command == 'POST' and path == '/api/tasks':
                selected = store.selected(self._context())
                data = self._body()
                if 'text' not in data or set(data) - {'text', 'notes', 'due_at'}:
                    raise ValueError('Informe texto e, opcionalmente, anotações e data.')
                self._send(201, {'task': selected.add_task(**data)})
            elif self.command == 'PATCH' and path.startswith('/api/tasks/'):
                selected = store.selected(self._context())
                self._send(200, {'task': selected.update_task(path[len('/api/tasks/'):], self._body())})
            else:
                self._send(404, {'error': 'Operação não encontrada.'})

        def _dispatch(self):
            if not self._local_request():
                return
            try:
                path = urlsplit(self.path).path
                if self.command == 'GET':
                    self._get(path)
                else:
                    self._change(path)
            except CloudError as error:
                self._send(error.status, {'error': str(error)})
            except ValueError as error:
                self._send(400, {'error': str(error)})
            except KeyError:
                self._send(404, {'error': 'Tarefa não encontrada.'})
            except (sqlite3.Error, OSError):
                self._send(503, {'error': 'Não foi possível acessar os dados. Tente novamente.'})

        do_GET = _dispatch
        do_POST = _dispatch
        do_PATCH = _dispatch

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    try:
        server = make_server(args.port)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Não foi possível iniciar o servidor: {error}\n')
    print(f'Lista de tarefas: http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
