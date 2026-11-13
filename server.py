"""Servidor local do protótipo. Execute com Python 3.10 ou mais recente."""

import argparse
import json
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from store import TaskStore

STATIC = Path(__file__).resolve().parent / "static"
FILES = {"/": ("index.html", "text/html; charset=utf-8"),
         "/styles.css": ("styles.css", "text/css; charset=utf-8"),
         "/app.js": ("app.js", "text/javascript; charset=utf-8")}


def make_server(port=8765, db_path=None):
    store = TaskStore(db_path)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body, content_type="application/json; charset=utf-8"):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(body)

        def _local_request(self):
            port = self.server.server_port
            hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            if host not in hosts or (origin and origin != f"http://{host}"):
                self._send(403, {"error": "Esta versão aceita apenas acesso local pela própria página."})
                return False
            return True

        def _body(self):
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Envie os dados como JSON.")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ValueError("Tamanho da requisição inválido.") from None
            if not 0 < length <= 8192:
                raise ValueError("Requisição vazia ou grande demais.")
            try:
                data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                raise ValueError("JSON inválido.") from None
            if not isinstance(data, dict):
                raise ValueError("Envie um objeto JSON.")
            return data

        def do_GET(self):
            if not self._local_request():
                return
            path = urlsplit(self.path).path
            if path == "/api/tasks":
                try:
                    self._send(200, {"tasks": store.list_tasks()})
                except sqlite3.Error:
                    self._send(503, {"error": "Não foi possível ler as tarefas. Tente novamente."})
            elif path in FILES:
                filename, content_type = FILES[path]
                self._send(200, (STATIC / filename).read_bytes(), content_type)
            else:
                self._send(404, {"error": "Página não encontrada."})

        def _change(self):
            if not self._local_request():
                return
            path = urlsplit(self.path).path
            try:
                if self.command == "POST" and path == "/api/tasks":
                    data = self._body()
                    if set(data) != {"text"}:
                        raise ValueError("Informe somente o texto da tarefa.")
                    self._send(201, {"task": store.add_task(data["text"])})
                elif self.command == "PATCH" and path.startswith("/api/tasks/"):
                    data = self._body()
                    if set(data) != {"completed"}:
                        raise ValueError("Informe somente o estado de conclusão.")
                    self._send(200, {"task": store.set_completed(path[len('/api/tasks/'):], data["completed"])})
                else:
                    self._send(404, {"error": "Operação não encontrada."})
            except ValueError as error:
                self._send(400, {"error": str(error)})
            except KeyError:
                self._send(404, {"error": "Tarefa não encontrada."})
            except sqlite3.Error:
                self._send(503, {"error": "Não foi possível salvar. Tente novamente."})

        do_POST = _change
        do_PATCH = _change

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    try:
        server = make_server(args.port)
    except OSError as error:
        parser.exit(1, f"Não foi possível iniciar o servidor: {error}\n")
    print(f"Lista de tarefas: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
