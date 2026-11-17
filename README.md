# Minha lista — local e Supabase

A lista mantém o modo local SQLite e acrescenta cadastro/login, importação
confirmada e tarefas na nuvem. O notebook compartilha a mesma sessão entre
página e MCP; o site hospedado usa Supabase diretamente pelo SDK oficial.

**Situação:** versão online publicada na Vercel; login, recuperação de senha,
sincronização no iPhone e isolamento entre contas foram validados pelo usuário.
Esta atualização acrescenta calendário mensal e integração Web Push. Os envios
exigem a ativação descrita em [Ativar notificações](supabase/ATIVAR_NOTIFICACOES.md).
Nenhum aviso real foi enviado pelos testes automatizados.

Consulte [Login e sincronização](supabase/LOGIN_E_SINCRONIZACAO.md) e siga
`SINCRONIZAR_COM_HERMES.txt` para atualizar a instalação conectada.

## Abrir no Windows

Requer Python 3.10+. Abra `INICIAR_WINDOWS.bat`, ou execute `python abrir_app.py`.
Não precisa de Hermes ou login para usar as tarefas locais. Para a integração
MCP e os testes, use a .venv existente ou crie uma e instale requirements.txt.

## Testar

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

São 24 testes; o serviço remoto dos testes é um fixture local. Eles não comprovam
as políticas nem o envio de e-mail do Supabase real. Para reconstruir o SDK
empacotado, use `npm ci` e `npm run build:client`; isso não é necessário para
usar os arquivos já distribuídos.

## Dados e sessões

O banco local padrão fica em `.data/tasks.sqlite3`. TASKS_DB_PATH permite outro
caminho. A sessão da nuvem fica ao lado desse banco, em um arquivo separado
terminado em `.supabase-session.json`; não compartilhe esse arquivo ou a pasta
de dados. O servidor serve apenas arquivos públicos e atende só no loopback.

No modo nuvem, tanto página quanto MCP usam a conta ativa. Ao sair, voltam ao
SQLite original. Esse banco não é um cache de tarefas remotas. Não há fila de
escritas offline: falhas são informadas e os dados exibidos são preservados.

## MCP

As quatro ferramentas continuam disponíveis: listar_tarefas, adicionar_tarefa,
concluir_tarefa e editar_tarefa. listar_tarefas informa também origem local/cloud.
Os caminhos absolutos da conexão lista_tarefas devem continuar apontando para a
mesma pasta Windows. Ao atualizar, reinicie servidor e recarregue o MCP.

## Publicação e funcionalidades futuras

Para importar o repositório na Vercel, siga `PUBLICAR_NA_VERCEL.md`. O vercel.json
configura a publicação somente de static, usando o SDK já empacotado.

O site em https://lista-de-tarefa-omega.vercel.app/ também pode ser instalado pela
Tela de Início do iPhone, como já foi validado pelo usuário.
O service worker guarda só o shell público; não guarda tarefas ou respostas Auth.

Continuam pendentes: ativação e validação real dos avisos, offline completo,
Apple/Lembretes e Obsidian. O próprio Hermes depende do notebook ligado.
As tarefas antigas e as configurações do Hermes devem ser preservadas em cada
atualização; o atualizador oferece previsão e backup antes de aplicar.


## Esqueci minha senha

O botão fica no formulário de conta e precisa somente do e-mail. O link abre
uma tela própria para definir e confirmar a nova senha (mínimo de 8 caracteres).
A recuperação usa uma sessão temporária em memória, separada do login da lista.
Os links usam a raiz HTTPS já permitida no Supabase. Detalhes e roteiro de teste
estão em `supabase/LOGIN_E_SINCRONIZACAO.md`.

O fluxo foi verificado com SDK oficial e serviço simulado; o usuário também
validou a troca de senha no projeto publicado. Para repetir o teste de navegador em
Linux com Chromium e Playwright instalados: `python tests/browser_recovery.py`.

## Calendário e avisos

O calendário mensal mostra tarefas com data no fuso do aparelho. Selecione um
dia para ver a agenda, editar uma tarefa ou adicionar outra naquele dia. Os
filtros Todas/Hoje/Pendentes/Concluídas removem a seleção de data da lista.

O botão **Avisos** permite ativar ou desativar notificações por conta e aparelho,
com consentimento explícito. Após configurar o Supabase, o serviço verifica a
cada minuto os avisos dez minutos antes e no horário da tarefa. A entrega depende
da conexão e do sistema operacional. O texto não expõe o título ou as anotações.
Ao sair ou trocar de conta, o vínculo de notificações do aparelho é desativado.
O agendamento no Supabase funciona com o notebook desligado; isso não hospeda o Hermes.

Além dos 24 testes Python, execute `npm ci` e `npm run test:notifications` para os
oito testes de SQL, isolamento de inscrições, filas, criptografia e worker.
Com Playwright/Chromium instalados, `python tests/browser_calendar.py` verifica
datas, filtros, edição e tamanhos de tela; `python tests/browser_notifications.py`
verifica consentimento e troca de conta com PushManager simulado.
