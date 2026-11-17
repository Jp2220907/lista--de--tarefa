"""Supabase autenticado. Sessão local compartilhada pelo HTTP e MCP; nunca cai
silenciosamente no SQLite quando há falha na nuvem. Sem chaves administrativas.
"""
import json
import os
import sqlite3
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

from store import TaskStore

FIELDS = 'id,text,notes,completed,due_at,created_at'
CONFIG = Path(__file__).resolve().parent / 'static' / 'cloud-config.json'
_GUARD = threading.RLock()


class CloudError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class SupabaseHTTP:
    def __init__(self, config=None):
        config = config or json.loads(CONFIG.read_text(encoding='utf-8'))
        self.url = config['url'].rstrip('/')
        self.key = config['publishableKey']
        self.app_url = config.get('appUrl', 'https://lista-de-tarefa-omega.vercel.app/').rstrip('/') + '/'
        app = urllib.parse.urlsplit(self.app_url)
        if app.scheme != 'https' or not app.hostname or app.username or app.query or app.fragment:
            raise ValueError('Endereço público do aplicativo inválido.')
        parsed = urllib.parse.urlsplit(self.url)
        if (parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.supabase.co')
                or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.port):
            raise ValueError('URL pública do Supabase inválida.')
        if not self.key.startswith('sb_publishable_'):
            raise ValueError('Use somente a chave publicável do projeto.')
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, method, path, data=None, token=None):
        headers = {'apikey': self.key, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request(self.url + path, method=method, headers=headers,
                    data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None)
        try:
            with self.opener.open(request, timeout=15) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read())
            except (ValueError, OSError):
                detail = {}
            code = detail.get('error_code') or detail.get('code')
            messages = {
                'invalid_credentials': 'E-mail ou senha incorretos.',
                'email_not_confirmed': 'Confirme seu e-mail antes de entrar.',
                'user_already_exists': 'Verifique seu e-mail ou entre com sua conta existente.',
                'weak_password': 'Escolha uma senha mais forte.',
                'over_email_send_rate_limit': 'O envio de e-mails atingiu o limite. Aguarde antes de tentar novamente.',
                'signup_disabled': 'O cadastro está desativado neste projeto.',
                'refresh_token_not_found': 'Sua sessão expirou. Entre novamente.',
                'refresh_token_already_used': 'Sua sessão expirou. Entre novamente.',
            }
            status = 401 if error.code == 401 else 409 if error.code == 409 else 400 if error.code in (400, 422) else 503
            raise CloudError(messages.get(code, 'O Supabase não concluiu a operação. Verifique o login, a conexão e a configuração do projeto.'), status) from None
        except (OSError, ValueError):
            raise CloudError('Não foi possível conectar ao Supabase. Suas tarefas locais foram preservadas.') from None


@contextmanager
def session_lock(path):
    """Serializa renovação e gravação de tokens entre threads e processos Windows/Linux."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with _GUARD, open(path, 'a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'0'); lock.flush()
        deadline = time.monotonic() + 25
        while True:
            try:
                if os.name == 'nt':
                    import msvcrt
                    lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise CloudError('A conta está sendo atualizada. Tente novamente em instantes.')
                time.sleep(.05)
        try:
            yield
        finally:
            if os.name == 'nt':
                import msvcrt
                lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


class Account:
    def __init__(self, db_path, api=None):
        self.api = api or SupabaseHTTP()
        db_path = Path(db_path)
        self.path = db_path.with_name(db_path.stem + '.supabase-session.json')
        self.lock = self.path.with_suffix('.lock')

    def _read(self):
        if not self.path.exists():
            return None
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
            if not data.get('user', {}).get('id') or not data.get('context'):
                raise ValueError()
            if data.get('project_url') != self.api.url:
                raise ValueError()
            if not data.get('access_token') or not data.get('refresh_token') or type(data.get('expires_at')) not in (float, int):
                raise ValueError()
            return data
        except (ValueError, OSError, AttributeError):
            raise CloudError('Não foi possível ler a sessão da nuvem. Entre novamente ou saia da conta; o banco local está preservado.', 401) from None

    def _save(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=self.path.parent, prefix='.session-', suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(data, stream)
                stream.flush(); os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def status(self):
        with session_lock(self.lock):
            try:
                data = self._read()
            except CloudError:
                return {'mode': 'cloud', 'email': '', 'user_id': None, 'context': 'invalid', 'session_error': True}
        return {'mode': 'cloud' if data else 'local', 'email': data['user'].get('email', '') if data else '',
                'user_id': data['user']['id'] if data else None, 'context': data['context'] if data else 'local'}

    @staticmethod
    def credentials(data):
        if set(data) != {'email', 'password'}:
            raise ValueError('Informe e-mail e senha.')
        email, password = data['email'], data['password']
        if not isinstance(email, str) or '@' not in email or len(email) > 320:
            raise ValueError('Informe um e-mail válido.')
        if not isinstance(password, str) or not 6 <= len(password) <= 1024:
            raise ValueError('Informe uma senha com pelo menos seis caracteres.')
        return {'email': email.strip(), 'password': password}

    def signup(self, data, redirect):
        result = self.api.call('POST', '/auth/v1/signup?redirect_to=' + urllib.parse.quote(redirect, safe=''), self.credentials(data))
        # Cadastro não troca a conta ativa nem importa tarefas automaticamente.
        return {'message': 'Verifique sua caixa de entrada e confirme o e-mail. Depois volte à lista e entre com sua senha.'}

    def recover_password(self, data):
        if set(data) != {'email'}:
            raise ValueError('Informe somente seu e-mail para recuperar a senha.')
        email = data['email']
        if not isinstance(email, str) or '@' not in email or len(email) > 320:
            raise ValueError('Informe um e-mail válido.')
        # Não lê nem substitui a sessão compartilhada pelo aplicativo e MCP.
        self.api.call('POST', '/auth/v1/recover?redirect_to=' + urllib.parse.quote(self.api.app_url, safe=''), {'email': email.strip()})
        return {'message': 'Se houver uma conta com esse e-mail, você receberá um link para criar uma nova senha. Confira também a pasta de spam.'}

    def login(self, data):
        credentials = self.credentials(data)
        with session_lock(self.lock):
            result = self.api.call('POST', '/auth/v1/token?grant_type=password', credentials)
            token = result.get('access_token')
            if not token or not result.get('refresh_token'):
                raise CloudError('O login não foi concluído. Confirme seu e-mail e tente novamente.', 401)
            user = self.api.call('GET', '/auth/v1/user', token=token)
            self._save({'access_token': token, 'refresh_token': result['refresh_token'],
                        'project_url': self.api.url,
                        'expires_at': time.time() + result.get('expires_in', 3600),
                        'user': {'id': user['id'], 'email': user.get('email', credentials['email'])}, 'context': str(uuid4())})
        return self.status()

    def logout(self):
        # Apaga a sessão local mesmo sem internet. O banco de tarefas não é alterado.
        with session_lock(self.lock):
            try:
                data = self._read()
            except CloudError:
                data = None
            self.path.unlink(missing_ok=True)
        if data:
            try:
                self.api.call('POST', '/auth/v1/logout?scope=local', token=data['access_token'])
            except CloudError:
                pass
        return self.status()

    def token(self, context):
        with session_lock(self.lock):
            data = self._read()
            if not data or data['context'] != context:
                raise CloudError('A conta mudou. Atualize a página antes de continuar.', 409)
            if data['expires_at'] <= time.time() + 60:
                result = self.api.call('POST', '/auth/v1/token?grant_type=refresh_token', {'refresh_token': data['refresh_token']})
                if not result.get('access_token') or not result.get('refresh_token'):
                    raise CloudError('Sua sessão expirou. Entre novamente.', 401)
                user = self.api.call('GET', '/auth/v1/user', token=result['access_token'])
                if user['id'] != data['user']['id']:
                    raise CloudError('A sessão retornou outra conta. Entre novamente.', 401)
                data.update(access_token=result['access_token'], refresh_token=result['refresh_token'],
                            expires_at=time.time() + result.get('expires_in', 3600))
                self._save(data)
            return data['access_token']


class CloudTasks:
    def __init__(self, account, context):
        self.account, self.context = account, context

    def call(self, method, query='', data=None):
        token = self.account.token(self.context)
        return self.account.api.call(method, '/rest/v1/tasks?' + query, data, token)

    def list_tasks(self):
        tasks, offset = [], 0
        while True:
            page = self.call('GET', f'select={FIELDS}&order=created_at.asc,id.asc&limit=1000&offset={offset}')
            if not isinstance(page, list):
                raise CloudError('O Supabase retornou uma lista inválida.')
            tasks.extend(page)
            if len(page) < 1000:
                return tasks
            offset += len(page)

    def add_task(self, text, notes='', due_at=None):
        fields = TaskStore._validate({'text': text, 'notes': notes, 'due_at': due_at})
        result = self.call('POST', 'select=' + FIELDS, fields)
        if not result:
            raise CloudError('Não foi possível confirmar o salvamento da tarefa.')
        return result[0]

    def update_task(self, task_id, changes):
        try:
            task_id = str(UUID(task_id))
        except (ValueError, TypeError, AttributeError):
            raise ValueError('Identificador de tarefa inválido.') from None
        result = self.call('PATCH', f'id=eq.{task_id}&select={FIELDS}', TaskStore._validate(changes))
        if not result:
            raise KeyError(task_id)
        return result[0]

    def set_completed(self, task_id, completed):
        return self.update_task(task_id, {'completed': completed})


class SharedTasks:
    """Escolhe a mesma fonte para cada chamada HTTP e MCP, inclusive após login."""
    def __init__(self, db_path=None, api=None):
        self.local = TaskStore(db_path)
        self.account = Account(self.local.path, api)

    def selected(self, expected=None):
        status = self.account.status()
        if expected is not None and expected != status['context']:
            raise CloudError('A conta mudou. Atualize a página antes de continuar.', 409)
        return CloudTasks(self.account, status['context']) if status['mode'] == 'cloud' else self.local

    def list_tasks(self):
        return self.selected().list_tasks()

    def add_task(self, text, notes='', due_at=None):
        return self.selected().add_task(text, notes, due_at)

    def update_task(self, task_id, changes):
        return self.selected().update_task(task_id, changes)

    def set_completed(self, task_id, completed):
        return self.selected().set_completed(task_id, completed)

    def import_local(self, context):
        remote = self.selected(context)
        if not isinstance(remote, CloudTasks):
            raise ValueError('Entre na conta antes de importar tarefas.')
        known = {task['id']: task for task in remote.list_tasks()}
        created = skipped = 0
        # Importação repetível e não destrutiva: registros existentes nunca são sobrescritos.
        for task in self.local.list_tasks():
            if task['id'] in known:
                skipped += 1
                continue
            try:
                UUID(task['id'])
            except ValueError:
                raise CloudError('Uma tarefa local tem identificador incompatível. Nenhum dado local foi apagado.', 400) from None
            try:
                result = remote.call('POST', 'select=' + FIELDS, {key: task[key] for key in FIELDS.split(',')})
            except CloudError as error:
                if error.status == 409:
                    raise CloudError('A importação encontrou um conflito de identificador. As tarefas locais foram preservadas; tente novamente após conferir a conta.', 409) from None
                raise
            if not result:
                raise CloudError('Não foi possível confirmar uma tarefa importada. Os dados locais foram preservados.')
            known[task['id']] = result[0]
            created += 1
        return {'created': created, 'skipped': skipped}
