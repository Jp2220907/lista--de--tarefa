"""UI com SDK oficial e PushManager simulado; envio em iPhone real é outro teste."""
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
from fake_supabase import SupabaseFixture


def run():
    remote=SupabaseFixture();remote.push_ready=True
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            context=browser.new_context(viewport={'width':390,'height':900},service_workers='block')
            context.add_init_script('''
                let permission='default',subscription=null,counter=0;
                window.pushFixture={requests:0,unsubscribed:0,setPermission(value){permission=value;}};
                Object.defineProperty(window,'Notification',{value:{get permission(){return permission;},requestPermission(){window.pushFixture.requests++;permission='granted';return Promise.resolve(permission);}}});
                Object.defineProperty(window,'PushManager',{value:function(){}});
                const registration={installing:null,waiting:null,update:async()=>{},active:{postMessage(message,ports){if(message.type==='CHECK_PUSH_READY')ports[0].postMessage({pushReady:true});}},pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{
                    const endpoint='https://web.push.apple.com/fixture-'+(++counter);
                    subscription={endpoint,toJSON(){return {endpoint,keys:{p256dh:'A'.repeat(87),auth:'A'.repeat(22)}};},unsubscribe:async()=>{window.pushFixture.unsubscribed++;subscription=null;return true;}};
                    return subscription;
                }}};
                Object.defineProperty(navigator,'serviceWorker',{value:{ready:Promise.resolve(registration),register:async()=>registration,getRegistration:async()=>registration,addEventListener(){}}});
            ''')
            def route(handler):
                request=handler.request;url=urlsplit(request.url)
                if url.hostname=='lista.test':
                    name=url.path.lstrip('/') or 'index.html'
                    if name=='cloud-config.json':return handler.fulfill(json={'url':'https://fixture.supabase.co','publishableKey':'sb_publishable_fixture'})
                    file=ROOT/'static'/name
                    if file.is_file() and file.resolve().is_relative_to(ROOT/'static'):
                        mime='text/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'image/png' if name.endswith('.png') else 'text/html'
                        return handler.fulfill(body=file.read_bytes(),content_type=mime)
                    return handler.fulfill(status=404)
                if url.hostname=='fixture.supabase.co':
                    cors={'Access-Control-Allow-Origin':'https://lista.test','Content-Type':'application/json'}
                    if request.method=='OPTIONS':return handler.fulfill(status=204,headers={**cors,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'})
                    req=urllib.request.Request(remote.url+url.path+('?' +url.query if url.query else ''),method=request.method,data=request.post_data_buffer,headers={key:value for key,value in request.headers.items() if key in ('apikey','authorization','content-type','prefer','accept')})
                    try:
                        with urllib.request.urlopen(req,timeout=15) as response:status=response.status;body=response.read()
                    except urllib.error.HTTPError as error:status=error.code;body=error.read()
                    return handler.fulfill(status=status,body=body,headers=cors)
                return handler.abort()
            context.route('**/*',route)
            page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto('https://lista.test/')
            page.get_by_label('E-mail',exact=True).fill('ana@example.test')
            page.get_by_label('Senha',exact=True).fill('senha-fixture-123')
            page.get_by_role('button',name='Entrar',exact=True).click()
            expect(page.locator('#account-mode')).to_contain_text('ana@example.test')
            page.get_by_role('button',name='Avisos',exact=True).click()
            expect(page.get_by_role('button',name='Ativar neste aparelho',exact=True)).to_be_enabled()
            assert page.evaluate('pushFixture.requests')==0
            page.get_by_role('button',name='Ativar neste aparelho',exact=True).click()
            expect(page.locator('#notification-status')).to_contain_text('Ativadas neste aparelho')
            assert page.evaluate('pushFixture.requests')==1
            assert len(remote.push_rows)==1
            state=page.evaluate('MinhaListaPushState.read()')
            assert state['enabled'] and state['user_id']==remote.users['ana@example.test']['id']
            page.get_by_role('button',name='Desativar neste aparelho',exact=True).click()
            expect(page.locator('#notification-status')).to_contain_text('desativados')
            assert not page.evaluate('MinhaListaPushState.read()')['enabled'] and len(remote.push_rows)==0
            page.get_by_role('button',name='Ativar neste aparelho',exact=True).click()
            expect(page.locator('#notification-status')).to_contain_text('Ativadas neste aparelho')
            assert page.evaluate('pushFixture.requests')==1
            page.get_by_role('button',name='Fechar',exact=True).click()
            page.get_by_role('button',name='Minha conta',exact=True).click()
            page.get_by_role('button',name='Sair desta conta',exact=True).click()
            expect(page.locator('#account-mode')).to_contain_text('Entre na conta')
            assert not page.evaluate('MinhaListaPushState.read()')['enabled'] and len(remote.push_rows)==0
            page.get_by_role('button',name='Entrar para sincronizar',exact=True).click()
            page.get_by_label('E-mail',exact=True).fill('bia@example.test');page.get_by_label('Senha',exact=True).fill('senha-fixture-123')
            page.get_by_role('button',name='Entrar',exact=True).click()
            expect(page.locator('#account-mode')).to_contain_text('bia@example.test')
            remote.push_ready=False
            page.get_by_role('button',name='Avisos',exact=True).click()
            expect(page.locator('#notification-status')).to_contain_text('agendamento no Supabase ainda precisa')
            expect(page.get_by_role('button',name='Ativar neste aparelho',exact=True)).to_be_disabled()
            remote.push_ready=True
            page.evaluate("pushFixture.setPermission('denied')")
            page.get_by_role('button',name='Verificar serviço',exact=True).click()
            expect(page.locator('#notification-status')).to_contain_text('bloqueadas')
            assert len(remote.push_rows)==0 and not errors,errors
            browser.close()
            print('PASS: consentimento só após clique, registro da conta correta, desativação, troca/saída da conta, serviço não configurado e permissão negada. PushManager simulado; sem envio real.')
    finally:remote.close()

if __name__=='__main__':run()
