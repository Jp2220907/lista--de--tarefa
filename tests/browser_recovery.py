"""Teste de navegador com SDK oficial e serviço HTTP fictício. Sem contas reais.
Execute com Python que tenha Playwright instalado: python tests/browser_recovery.py
"""
import json
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from cloud import CloudError, SharedTasks
from fake_supabase import SupabaseFixture, api_for
from server import make_server


def run():
    with tempfile.TemporaryDirectory() as folder:
        remote = SupabaseFixture()
        db = Path(folder) / 'tasks.sqlite3'
        store = SharedTasks(db, api_for(remote.url))
        store.account.login({'email': 'ana@example.test', 'password': 'senha-fixture-123'})
        original_session = store.account.path.read_bytes()
        server = make_server(0, db, api_for(remote.url))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
                errors = []
                desktop = browser.new_page()
                desktop.on('pageerror', lambda error: errors.append(str(error)))
                desktop.goto(f'http://127.0.0.1:{server.server_port}')
                desktop.get_by_role('button', name='Minha conta', exact=True).click()
                desktop.get_by_label('E-mail', exact=True).fill('ana@example.test')
                expect(desktop.get_by_label('Senha', exact=True)).to_have_value('')
                desktop.get_by_role('button', name='Esqueci minha senha', exact=True).click()
                expect(desktop.locator('#account-message')).to_contain_text('Se houver uma conta')
                assert remote.recoveries[-1]['redirect'] == 'https://lista-de-tarefa-omega.vercel.app/'
                assert store.account.path.read_bytes() == original_session

                context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
                def route(handler):
                    request = handler.request
                    url = urlsplit(request.url)
                    if url.hostname == 'lista.test':
                        name = url.path.lstrip('/') or 'index.html'
                        if name == 'cloud-config.json':
                            return handler.fulfill(json={'url': 'https://fixture.supabase.co', 'publishableKey': 'sb_publishable_fixture'})
                        file = ROOT / 'static' / name
                        if file.is_file() and file.resolve().is_relative_to(ROOT / 'static'):
                            mime = 'text/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'image/png' if name.endswith('.png') else 'text/html'
                            return handler.fulfill(body=file.read_bytes(), content_type=mime)
                        return handler.fulfill(status=404)
                    if url.hostname == 'fixture.supabase.co':
                        cors = {'Access-Control-Allow-Origin': 'https://lista.test', 'Content-Type': 'application/json'}
                        if request.method == 'OPTIONS':
                            return handler.fulfill(status=204, headers={**cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS'})
                        req = urllib.request.Request(remote.url + url.path + ('?' + url.query if url.query else ''), method=request.method,
                            data=request.post_data_buffer, headers={key: value for key, value in request.headers.items() if key in ('apikey', 'authorization', 'content-type', 'prefer')})
                        try:
                            with urllib.request.urlopen(req, timeout=15) as response: status = response.status; body = response.read()
                        except urllib.error.HTTPError as error: status = error.code; body = error.read()
                        return handler.fulfill(status=status, body=body, headers=cors)
                    return handler.abort()
                context.route('**/*', route)
                page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto('https://lista.test/')
                page.get_by_label('E-mail', exact=True).fill('bia@example.test')
                page.get_by_label('Senha', exact=True).fill('senha-fixture-123')
                page.get_by_role('button', name='Entrar', exact=True).click()
                expect(page.locator('#account-mode')).to_contain_text('bia@example.test')
                saved_browser_session = page.evaluate('localStorage.getItem("minha-lista-supabase")')
                page.get_by_role('button', name='Minha conta', exact=True).click()
                page.get_by_label('E-mail', exact=True).fill('ana@example.test')
                page.get_by_role('button', name='Esqueci minha senha', exact=True).click()
                expect(page.locator('#account-message')).to_contain_text('Se houver uma conta')
                assert remote.recoveries[-1]['redirect'] == 'https://lista.test/'
                recovery = remote.recoveries[-1]['session']
                assert page.evaluate('localStorage.getItem("minha-lista-supabase")') == saved_browser_session

                def recovery_link(session):
                    return 'https://lista.test/#' + urlencode({'type': 'recovery', 'access_token': session['access_token'], 'refresh_token': session['refresh_token']})
                reset = context.new_page(); reset.on('pageerror', lambda error: errors.append(str(error)))
                reset.goto(recovery_link(recovery))
                expect(reset.locator('#recovery-status')).to_contain_text('Link validado')
                assert reset.url == 'https://lista.test/recuperar-senha.html'
                expect(reset.locator('#recovery-user')).to_contain_text('ana@example.test')
                assert reset.evaluate('localStorage.getItem("minha-lista-recovery")') is None
                reset.get_by_label('Nova senha', exact=True).fill('senha-nova-123')
                reset.get_by_label('Confirme a nova senha', exact=True).fill('senha-diferente-123')
                reset.get_by_role('button', name='Salvar nova senha', exact=True).click()
                expect(reset.locator('#recovery-error')).to_contain_text('não coincidem')
                assert remote.passwords['ana@example.test'] == 'senha-fixture-123'
                reset.get_by_label('Nova senha', exact=True).fill('senha-fixture-123')
                reset.get_by_label('Confirme a nova senha', exact=True).fill('senha-fixture-123')
                reset.get_by_role('button', name='Salvar nova senha', exact=True).click()
                expect(reset.locator('#recovery-error')).to_contain_text('diferente da anterior')
                reset.get_by_label('Nova senha', exact=True).fill('senha-nova-123')
                reset.get_by_label('Confirme a nova senha', exact=True).fill('senha-nova-123')
                reset.get_by_role('button', name='Salvar nova senha', exact=True).click()
                expect(reset.locator('#recovery-status')).to_contain_text('Senha atualizada!')
                expect(reset.locator('#recovery-form')).not_to_be_visible()
                assert remote.passwords['ana@example.test'] == 'senha-nova-123'
                assert reset.evaluate('localStorage.getItem("minha-lista-supabase")') == saved_browser_session
                assert store.account.path.read_bytes() == original_session
                page.reload(); expect(page.locator('#account-mode')).to_contain_text('bia@example.test')
                api = api_for(remote.url)
                try:
                    api.call('POST', '/auth/v1/token?grant_type=password', {'email': 'ana@example.test', 'password': 'senha-fixture-123'})
                    raise AssertionError('A senha antiga ainda foi aceita')
                except CloudError: pass
                assert api.call('POST', '/auth/v1/token?grant_type=password', {'email': 'ana@example.test', 'password': 'senha-nova-123'}).get('access_token')
                reset.get_by_role('link', name='Voltar ao login', exact=True).click()
                expect(reset.locator('#account-dialog')).to_be_visible()
                assert reset.url == 'https://lista.test/'
                invalid = context.new_page(); invalid.goto('https://lista.test/recuperar-senha.html')
                expect(invalid.locator('#recovery-error')).to_contain_text('Abra o link')
                expect(invalid.locator('#recovery-form')).not_to_be_visible()
                expired = context.new_page(); expired.goto(recovery_link(recovery))
                expect(expired.locator('#recovery-error')).to_be_visible()
                expect(expired.locator('#recovery-form')).not_to_be_visible()
                assert not expired.url.split('#')[1:]  # Não deixa credenciais na URL.
                assert not errors, errors
                print('PASS: recuperação no desktop sem senha atual; link público; SDK oficial; root redireciona; URL limpa; erro/mismatch e senha anterior; senha nova válida; sessões do app/MCP preservadas; link inválido/reutilizado; layout móvel.')
                browser.close()
        finally:
            server.shutdown(); server.server_close(); thread.join(); remote.close()


if __name__ == '__main__':
    run()
