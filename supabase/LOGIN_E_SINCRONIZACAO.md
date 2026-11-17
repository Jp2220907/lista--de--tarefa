# Login e sincronização: versão preparada para validação real

O código está implementado. Os testes desta entrega usam um serviço HTTP de
teste e o SDK oficial do navegador. O acesso ao projeto Supabase foi bloqueado
pela rede do ambiente de desenvolvimento. Cadastro, envio de e-mail, políticas
RLS e propagação com o projeto real ainda precisam ser conferidos no Windows.

## O que foi implementado

- Cadastro, confirmação por e-mail e login por senha com Supabase Auth.
- Botão Minha conta, saída da conta e identificação da fonte da lista.
- Modo local SQLite preservado, disponível sem login.
- No notebook, sessão compartilhada pelo servidor HTTP e MCP. Cada chamada do
  Hermes escolhe a fonte ativa, inclusive depois de entrar ou sair da conta.
- Ao entrar na conta, a lista passa a mostrar o Supabase. O SQLite não é apagado.
- Importação por confirmação explícita para a conta exibida. IDs existentes na
  nuvem são preservados, sem sobrescrever dados. Repetir a importação não duplica.
  Se uma operação falhar no meio, alguns registros podem já ter sido enviados;
  os originais permanecem intactos e é possível conferir e repetir a operação.
- Renovação de sessão no notebook serializada entre processos; não rebaixa para
  modo local ao falhar ou expirar. Trocar de fonte é explícito ao sair da conta.
- Sessões desktop ficam ao lado do banco em `tasks.supabase-session.json`, nunca
  são servidas por HTTP ou incluídas nos pacotes. Não anexar esse arquivo a chats.
  O Windows usa as permissões herdadas da pasta pessoal: não compartilhe a pasta
  de dados ou o perfil do usuário com outras pessoas.
- Navegador hospedado usa @supabase/supabase-js 2.119.0, distribuído no pacote;
  os tokens ficam no armazenamento desse navegador. Use um perfil pessoal.
- Shell PWA com manifest e ícones, e cache SOMENTE dos arquivos públicos.
  Não há armazenamento offline de tarefas, fila de escritas ou alertas. A página
  pode abrir sem conexão depois do primeiro uso, mas a nuvem precisa de internet.

## Antes do primeiro cadastro

A tabela e as políticas já foram criadas e confirmadas pelo usuário. NÃO executar
novamente `01_criar_tarefas.sql`. Não usar a chave secreta compartilhada: revogá-la
em API Keys caso isso ainda não tenha sido feito.

No Supabase, conferir Authentication > URL Configuration:

- Durante o teste no notebook: Site URL = `http://127.0.0.1:8765/`.
- Adicionar essa mesma URL em Redirect URLs.
- Para hospedagem, adicionar o endereço HTTPS real com `/` ao final; tornar esse
  endereço a Site URL de produção. Manter o loopback só enquanto necessário.
- Não usar curingas amplos. Se a porta local for diferente, cadastrar a URL exata.
- Manter Email habilitado, cadastro habilitado e Confirm email ativado.

`static/cloud-config.json` contém somente o endereço e a chave publicável já
fornecidos pelo usuário. Não colocar secret/service_role ou senha nesse arquivo.
O SQL só concede escrita às colunas autorizadas e usa o usuário autenticado como
proprietário. Não alterar permissões para permitir user_id/updated_at no cliente.

## Atualização Windows e primeiro teste

1. Usar `SINCRONIZAR_COM_HERMES.txt` para aplicar a atualização na pasta conectada.
2. Conferir que os testes passaram e as tarefas originais permanecem no modo local.
3. Abrir Entrar para sincronizar > Criar conta com o e-mail escolhido pelo usuário.
   O usuário digita sua senha diretamente no aplicativo, nunca na conversa.
4. Abrir o e-mail de confirmação. Após confirmar, voltar à lista e entrar com senha.
   Esta é uma conta do aplicativo, separada do login ChatGPT do Hermes.
5. É esperado que a nuvem esteja vazia no primeiro login. Os originais locais
   continuam no SQLite; o cabeçalho indica claramente a conta e a fonte.
6. Só então escolher Enviar tarefas locais para minha conta e confirmar o destino.
7. Conferir a lista na página e via listar_tarefas do Hermes: origem deve ser cloud.
8. Criar e editar APENAS tarefa fictícia pelo MCP e conferir a página.
9. Sair da conta: devem reaparecer os originais locais. Entrar novamente deve
   recuperar os registros da nuvem. A cópia local não acompanha edições remotas;
   ela é a lista original independente, não um cache da nuvem.

Nesta versão, sair da conta local apaga a sessão do notebook e muda a fonte para
SQLite. Isso também altera a fonte usada pelo Hermes. O modo cloud não funciona
sem conexão: em caso de falha, a lista já exibida permanece, e o erro é informado.

## iPhone e hospedagem

O ZIP Site-minha-lista contém SOMENTE os arquivos de static, sem Python, SQLite,
.env, credenciais de sessão ou testes. Hospedar seu conteúdo na RAIZ de um site
estático com HTTPS. Endereço gratuito do serviço pode ser usado; domínio próprio
é opcional. Ainda não houve publicação; o usuário deve escolher/autorizar o serviço.

Não publicar server.py ou a pasta de dados e não expor a porta local à internet.
O navegador no iPhone acessa diretamente Supabase com o SDK e a conta do usuário.
O notebook usa o mesmo projeto Supabase por meio do servidor de loopback, que
mantém o MCP conectado à mesma fonte.

O arquivo _headers fornece CSP, no-referrer e nosniff em serviços que suportam
esse formato (por exemplo Netlify e Cloudflare Pages). Em outra hospedagem,
configurar os cabeçalhos equivalentes; não se pressupõe suporte automático.
O SDK está pré-compilado, portanto a publicação estática não exige Node/build.

Depois de publicar e cadastrar os redirects, abrir no Safari do iPhone, entrar
com a mesma conta e usar Compartilhar > Adicionar à Tela de Início.
No Windows, o navegador pode oferecer instalar a versão HTTPS como aplicativo.
A instalação nos aparelhos ainda precisa de validação real; não foi testada no
Safari/iPhone neste ambiente.

## Verificações para considerar sincronização validada

- Confirmar novo e-mail e entrar no projeto real.
- Criar uma tarefa em um dispositivo e vê-la no outro.
- Concluir/editar no segundo e conferir no primeiro e pelo MCP do notebook.
- Criar uma segunda conta de teste e confirmar que não vê as tarefas da primeira,
  incluindo tentativa de editar um ID da primeira conta (não basta comparar UI).
- Verificar sair/entrar, perda de rede, retomada e importação repetida sem duplicar.
- Não chamar o isolamento de validado antes de testar contra o RLS real.

## Desenvolvimento e dependências

Servidor e MCP usam Python padrão + mcp==1.30.0, como antes. O cliente móvel usa
SDK oficial empacotado em static/vendor/supabase.js. Para regenerar a dependência,
na raiz: `npm ci` e `npm run build:client` (package-lock.json fixa as versões).
Node é necessário apenas para esse build, não para rodar a versão distribuída.

Os testes de Python incluem HTTP local, cliente MCP real com subprocesso,
renovação de token, mudança de conta, importação repetível e perda de conexão,
contra fixture local. Não criam contas no projeto real. Os testes do navegador
incluíram desktop e viewport móvel, SDK oficial, duas páginas e sessão persistida.

## Recuperação de senha

Na tela Minha conta/Entrar há o botão **Esqueci minha senha**. Basta preencher o
campo de e-mail; não é necessário preencher a senha atual. A resposta não confirma
se o endereço tem cadastro. Limites de envio e erros de conexão são informados.

O link usa a URL raiz HTTPS já cadastrada neste projeto. Ao receber um link com
`type=recovery`, a página inicial encaminha para `recuperar-senha.html` antes de
carregar a conta normal. A tela valida os tokens com o SDK oficial, remove o
fragmento da barra de endereço e mantém uma sessão exclusiva em memória.
Não substitui a conta aberta na lista nem a sessão compartilhada com o MCP.
O pedido de recuperação feito pelo servidor local também aponta para o endereço
público (`appUrl` de cloud-config.json), para poder abrir o e-mail no celular.

O formulário exige duas senhas iguais com pelo menos oito caracteres. Após o
Supabase confirmar a alteração, descarta a sessão temporária e oferece voltar ao
login. Não há senha nova ou token gravado pelo servidor dessa tela. A rotação e
invalidação de outras sessões seguem as regras do Supabase; esta função não faz
logout global nem promete preservar tokens que o provedor revogar.

Para testar no site publicado:

1. Abrir Minha conta/Entrar, preencher o e-mail e escolher Esqueci minha senha.
2. Abrir o e-mail mais recente e seguir o link. Não compartilhar esse link,
   o fragmento da URL, senhas ou tokens em chats.
3. Definir e confirmar uma senha nova. Se o link expirou/já foi utilizado,
   solicitar outro; após recarregar a tela sem o link, ela também pede um novo.
4. Voltar ao login e confirmar que a senha nova funciona e a anterior é recusada.
5. Conferir que as tarefas e a conta proprietária continuam corretas.

Não há alteração de SQL. É usado o endereço raiz que já consta em Site URL e
Redirect URLs. Em outra hospedagem, ajustar appUrl para sua URL pública.
Limites de envio do Supabase podem exigir aguardar antes de pedir outro e-mail.
A validação com e-mail real continua a cargo do teste do usuário; testes locais
usam um serviço fictício e não enviam e-mail.
