"""Calendário no Chromium real com tarefas locais; sem contas ou serviços externos."""
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import make_server
from store import TaskStore


def run():
    with tempfile.TemporaryDirectory() as folder:
        db = Path(folder)/'tasks.sqlite3'; store = TaskStore(db)
        store.add_task('Compromisso na virada do dia', due_at='2028-03-01T02:00:00Z')
        store.add_task('Compromisso de março', due_at='2028-03-01T12:00:00Z')
        store.add_task('Tarefa sem data')
        server = make_server(0,db); thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1440,'height':1100},timezone_id='America/Bahia')
                errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.add_init_script("""const NativeDate=Date;window.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:['2028-02-28T12:00:00-03:00']));} static now(){return new NativeDate('2028-02-28T12:00:00-03:00').getTime();} };""")
                page.goto(f'http://127.0.0.1:{server.server_port}')
                expect(page.locator('#calendar-month')).to_have_text('Fevereiro de 2028')
                leap=page.locator('[data-date="2028-02-29"]')
                expect(leap.locator('.calendar-day-count')).to_have_text('1')
                leap.click()
                expect(page.locator('#calendar-agenda time')).to_have_text('23:00')
                expect(page.get_by_role('checkbox',name='Compromisso na virada do dia',exact=True)).to_be_visible()
                expect(page.get_by_role('checkbox',name='Tarefa sem data',exact=True)).not_to_be_visible()
                page.get_by_role('button',name='Editar compromisso: Compromisso na virada do dia',exact=True).click()
                expect(page.locator('#edit-due')).to_have_value('2028-02-29T23:00')
                page.get_by_role('button',name='Cancelar',exact=True).click()
                page.get_by_role('button',name='+ Nova tarefa neste dia',exact=True).click()
                expect(page.locator('#new-due')).to_have_value('2028-02-29T09:00')
                page.get_by_label('Nova tarefa',exact=True).fill('Criada a partir do calendário')
                page.get_by_role('button',name='Adicionar',exact=True).click()
                expect(leap.locator('.calendar-day-count')).to_have_text('2')
                page.get_by_role('button',name='Próximo mês',exact=True).click()
                expect(page.locator('#calendar-month')).to_have_text('Março de 2028')
                page.locator('[data-date="2028-03-01"]').click()
                expect(page.locator('#calendar-agenda time')).to_have_text('09:00')
                page.locator('[data-date="2028-03-01"]').press('ArrowLeft')
                expect(page.locator('#calendar-month')).to_have_text('Fevereiro de 2028')
                expect(page.locator('[data-date="2028-02-29"]')).to_be_focused()
                page.get_by_role('button',name='Mostrar todas as datas',exact=True).click()
                expect(page.get_by_role('checkbox',name='Tarefa sem data',exact=True)).to_be_visible()
                page.get_by_role('button',name='Ir para hoje',exact=True).click()
                expect(page.locator('[data-date="2028-02-28"]')).to_have_attribute('aria-current','date')
                expect(page.locator('#calendar-no-tasks')).to_be_visible()
                page.get_by_role('button',name='Todas',exact=True).click()
                expect(page.get_by_role('checkbox',name='Tarefa sem data',exact=True)).to_be_visible()
                for width in (320,390,768,1440):
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Overflow em {width}'
                page.get_by_role('button',name='Avisos',exact=True).click()
                expect(page.locator('#notification-status')).to_contain_text('versão online')
                expect(page.get_by_role('button',name='Ativar neste aparelho',exact=True)).to_be_disabled()
                assert not errors,errors
                browser.close()
                print('PASS: mês bissexto, fuso local, seleção/filtro, criação/edição, navegação por teclado, dias vazios, layout 320–1440 e aviso honesto no modo local.')
        finally:
            server.shutdown();server.server_close();thread.join()

if __name__=='__main__':run()
