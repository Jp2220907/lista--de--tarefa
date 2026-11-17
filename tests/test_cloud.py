import asyncio
import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from cloud import CloudError, SharedTasks
from fake_supabase import SupabaseFixture, api_for
from server import make_server

ROOT = Path(__file__).resolve().parents[1]


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.remote = SupabaseFixture(); self.addCleanup(self.remote.close)
        self.db = Path(self.temp.name) / 'tasks.sqlite3'
        self.store = SharedTasks(self.db, api_for(self.remote.url))
        self.credentials = {'email': 'ana@example.test', 'password': 'senha-fixture-123'}
        self.local = self.store.local.add_task('Tarefa local preservada', 'nota original')

    def test_same_source_for_two_instances_and_explicit_return_to_local(self):
        other = SharedTasks(self.db, api_for(self.remote.url))
        self.store.account.login(self.credentials)
        task = self.store.add_task('Na nuvem', 'nota', '2026-12-01T10:00:00-03:00')
        self.assertEqual(other.list_tasks(), [task])
        other.set_completed(task['id'], True)
        self.assertTrue(self.store.list_tasks()[0]['completed'])
        self.assertEqual(self.store.local.list_tasks(), [self.local])
        status = self.store.account.status()
        self.assertFalse({'access_token', 'refresh_token', 'password'} & status.keys())
        self.remote.fail = True
        with self.assertRaises(CloudError): self.store.list_tasks()
        self.assertEqual(self.store.account.status()['mode'], 'cloud')

        # Trocar a URL do projeto não pode reenviar tokens da conta anterior.
        changed_api = api_for(self.remote.url)
        changed_api.url = 'https://outro-projeto.supabase.co'
        changed_store = SharedTasks(self.db, changed_api)
        with patch.object(changed_api, 'call', side_effect=AssertionError('Não deve enviar o token')):
            with self.assertRaises(CloudError):
                changed_store.list_tasks()
        self.store.account.logout()
        self.assertEqual(other.list_tasks(), [self.local])

    def test_import_is_explicit_idempotent_and_never_overwrites_cloud(self):
        status = self.store.account.login(self.credentials)
        self.assertEqual(self.store.list_tasks(), [])
        result = self.store.import_local(status['context'])
        self.assertEqual(result, {'created': 1, 'skipped': 0})
        self.assertEqual(self.store.list_tasks(), [self.local])
        self.store.update_task(self.local['id'], {'text': 'Editada na nuvem'})
        self.assertEqual(self.store.import_local(status['context']), {'created': 0, 'skipped': 1})
        self.assertEqual(self.store.list_tasks()[0]['text'], 'Editada na nuvem')
        self.assertEqual(self.store.local.list_tasks(), [self.local])
        self.store.account.login({**self.credentials, 'email': 'bia@example.test'})
        with self.assertRaises(CloudError): self.store.import_local(status['context'])
        self.assertEqual(self.store.list_tasks(), [])

    def test_refresh_is_serialized_across_instances(self):
        self.store.account.login(self.credentials)
        data = json.loads(self.store.account.path.read_text()); data['expires_at'] = time.time() - 10
        self.store.account.path.write_text(json.dumps(data))
        instances = [SharedTasks(self.db, api_for(self.remote.url)) for _ in range(4)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(lambda instance: instance.list_tasks(), instances)), [[], [], [], []])
        self.assertEqual(self.remote.refresh_count, 1)

    def test_confirmation_failed_login_and_signup_do_not_switch_active_account(self):
        status = self.store.account.login(self.credentials)
        with self.assertRaises(CloudError): self.store.account.login({**self.credentials, 'password': 'errada123'})
        self.assertEqual(self.store.account.status(), status)

        result = self.store.account.signup({**self.credentials, 'email': 'nova@example.test'}, 'http://127.0.0.1:8765/')
        self.assertIn('confirme', result['message'])
        with self.assertRaisesRegex(CloudError, 'Confirme'):
            self.store.account.login({**self.credentials, 'email': 'nova@example.test'})
        self.assertEqual(self.store.account.status(), status)

    def test_recovery_request_preserves_active_session_and_is_generic(self):
        self.store.account.login(self.credentials)
        saved_session = self.store.account.path.read_bytes()
        result = self.store.account.recover_password({'email': self.credentials['email']})
        unknown = self.store.account.recover_password({'email': 'nao-existe@example.test'})
        self.assertEqual(result, unknown)
        self.assertIn('Se houver uma conta', result['message'])
        self.assertEqual(len(self.remote.recoveries), 1)
        self.assertEqual(self.remote.recoveries[0]['redirect'], 'https://lista-de-tarefa-omega.vercel.app/')
        self.assertEqual(self.store.account.path.read_bytes(), saved_session)
        self.assertEqual(self.store.local.list_tasks(), [self.local])

    def test_recovery_rejects_extra_fields_invalid_email_and_reports_network_failure(self):
        for data in ({}, {'email': ''}, {'email': None}, {'email': 'sem-arroba'}, self.credentials):
            with self.assertRaises(ValueError): self.store.account.recover_password(data)
        self.remote.fail = True
        with self.assertRaises(CloudError): self.store.account.recover_password({'email': 'ana@example.test'})
        self.assertEqual(self.store.account.status()['mode'], 'local')
        self.assertEqual(self.remote.recoveries, [])

    def test_recovery_http_endpoint_requires_local_origin_and_only_email(self):
        server = make_server(0, self.db, api_for(self.remote.url))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for origin, body, expected in ((None, {'email': 'ana@example.test'}, 200),
                                          (None, {'email': 'ana@example.test', 'password': 'nao-enviar'}, 400),
                                          ('https://outro.example', {'email': 'ana@example.test'}, 403)):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
                headers = {'Content-Type': 'application/json'}
                if origin: headers['Origin'] = origin
                connection.request('POST', '/api/account/recover', json.dumps(body), headers)
                response = connection.getresponse()
                self.assertEqual(response.status, expected)
                payload = response.read().decode()
                self.assertNotIn('access_token', payload)
                connection.close()
            self.assertEqual(len(self.remote.recoveries), 1)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_corrupt_session_and_expired_credentials_never_fall_back_to_local(self):
        self.store.account.login(self.credentials)
        self.store.account.path.write_text('corrompido')
        with self.assertRaises(CloudError): self.store.list_tasks()
        self.store.account.logout()
        self.assertEqual(self.store.list_tasks(), [self.local])
        self.store.account.login(self.credentials)
        data = json.loads(self.store.account.path.read_text()); data['expires_at'] = 0
        self.store.account.path.write_text(json.dumps(data)); self.remote.refreshes.clear()
        with self.assertRaises(CloudError): self.store.list_tasks()
        self.assertEqual(self.store.account.status()['mode'], 'cloud')

    def test_http_context_rejects_stale_page_and_never_returns_tokens(self):
        server = make_server(0, self.db, api_for(self.remote.url))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(method, path, body=None, context=None):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
            headers = {'Content-Type': 'application/json'}
            if context: headers['X-Task-Context'] = context
            connection.request(method, path, None if body is None else json.dumps(body), headers)
            response = connection.getresponse(); result = (response.status, json.loads(response.read())); connection.close()
            return result
        try:
            status, data = request('POST', '/api/account/login', self.credentials)
            self.assertEqual(status, 200)
            self.assertNotIn('access_token', json.dumps(data))
            context = data['context']
            self.assertEqual(request('POST', '/api/tasks', {'text': 'Não salvar'}, 'local')[0], 409)
            status, data = request('POST', '/api/tasks', {'text': 'Salvar na nuvem'}, context)
            self.assertEqual(status, 201)
            self.assertEqual(self.store.list_tasks()[0]['id'], data['task']['id'])
            self.assertEqual(request('GET', '/.data/tasks.supabase-session.json')[0], 404)
            self.assertEqual(request('POST', '/api/account/login', self.credentials, context)[0], 200)
            self.assertEqual(request('PATCH', '/api/tasks/' + data['task']['id'], {'completed': True}, context)[0], 409)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_real_mcp_subprocess_reads_shared_cloud_session(self):
        self.store.account.login(self.credentials)
        task = self.store.add_task('Criada pelo aplicativo')
        # Injeta somente o endereço do serviço de teste; nenhuma conta real é usada.
        code = '''
import runpy,sys
from unittest.mock import patch
sys.path.insert(0,sys.argv[1]+'/tests')
sys.path.insert(0,sys.argv[1])
from fake_supabase import api_for
api=api_for(sys.argv[2])
with patch('cloud.SupabaseHTTP',return_value=api):
    runpy.run_path(sys.argv[1]+'/hermes_mcp.py',run_name='__main__')
'''
        async def flow():
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
            params = StdioServerParameters(command=sys.executable, args=['-c', code, str(ROOT), self.remote.url], env={**os.environ, 'TASKS_DB_PATH': str(self.db)})
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    result = await client.call_tool('listar_tarefas', {})
                    self.assertFalse(result.isError)
                    self.assertEqual(json.loads(result.content[0].text), {'tarefas': [task], 'origem': 'cloud'})
                    result = await client.call_tool('editar_tarefa', {'tarefa_id': task['id'], 'notas': 'Alterada pelo MCP'})
                    self.assertFalse(result.isError)
        asyncio.run(flow())
        self.assertEqual(self.store.list_tasks()[0]['notes'], 'Alterada pelo MCP')
