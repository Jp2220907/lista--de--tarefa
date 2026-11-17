# Minha lista — local e Supabase

A lista mantém o modo local SQLite e acrescenta cadastro/login, importação
confirmada e tarefas na nuvem. O notebook compartilha a mesma sessão entre
página e MCP; o site hospedado usa Supabase diretamente pelo SDK oficial.

**Situação desta entrega:** código e testes locais prontos; a versão de nuvem
precisa ser aplicada no notebook e validada no Supabase real. A rede deste
ambiente bloqueou a conexão ao projeto. Não houve publicação do site.

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

Site-minha-lista.zip contém só os arquivos estáticos, preparados para HTTPS e
instalação pela Tela de Início do iPhone. Hospedagem/publicação ainda não foram
feitas e a instalação PWA ainda não foi validada em aparelho real.
O service worker guarda só o shell público; não guarda tarefas ou respostas Auth.

Continuam pendentes: validação real de cadastro, duas contas e dois dispositivos,
calendário visual, notificações, offline completo, Apple/Lembretes e Obsidian.
As tarefas antigas e as configurações do Hermes devem ser preservadas em cada
atualização; o atualizador oferece previsão e backup antes de aplicar.


## Esqueci minha senha

O botão fica no formulário de conta e precisa somente do e-mail. O link abre
uma tela própria para definir e confirmar a nova senha (mínimo de 8 caracteres).
A recuperação usa uma sessão temporária em memória, separada do login da lista.
Os links usam a raiz HTTPS já permitida no Supabase. Detalhes e roteiro de teste
estão em `supabase/LOGIN_E_SINCRONIZACAO.md`.

O fluxo foi verificado com SDK oficial e serviço simulado; envio do e-mail real
precisa ser testado no projeto publicado. Para repetir o teste de navegador em
Linux com Chromium e Playwright instalados: `python tests/browser_recovery.py`.
