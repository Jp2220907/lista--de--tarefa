# Preparação da sincronização

Projeto informado pelo usuário: `https://lwshxdiwypkwdabpsqzc.supabase.co`.
O endereço terminado em `/rest/v1/` é a API de dados, não a URL base.

## Etapa atual

O usuário já executou `01_criar_tarefas.sql` e confirmou por captura:
`rls_ativa=true`, `rls_forcada=true`, `politicas=3`, `acesso_anonimo=false`.
Não executar novamente a criação inicial nem apagar a tabela existente.

Também foram confirmados no painel: login por e-mail habilitado, cadastro
habilitado, confirmação de e-mail ativada e login anônimo desativado.

Foi solicitado revogar uma chave secreta compartilhada na conversa, mas ainda
não recebemos confirmação. Ela não foi utilizada nem salva neste repositório.
O aplicativo usará apenas a chave pública e o login individual de cada usuário.

O SQL cria a tabela sem importar nem remover tarefas locais. O campo user_id
vem do login: não deve ser enviado no corpo de criação pelo aplicativo.
Chamadas autenticadas podem inserir IDs/datas de criação para a futura
importação do banco local, mas não podem trocar o proprietário de um registro.
Uma conexão usando chave secreta pode ignorar RLS; por isso ela não pertence
ao navegador, ao pacote distribuído nem à integração de uso diário do Hermes.

## Validação ainda necessária

A consulta HTTPS deste ambiente foi bloqueada pela política de rede antes de
chegar ao Supabase. Isso não comprova erro no projeto ou na chave pública.
O resultado da execução do SQL foi confirmado pela captura do usuário. Ainda
precisamos testar acesso com duas contas diferentes para verificar isolamento.

Criar a tabela não ativa sincronização. Ainda faltam login no aplicativo,
transporte autenticado, importação preservando as tarefas, conexão do Hermes
à mesma fonte de dados e hospedagem HTTPS para acesso do iPhone. O aplicativo
local e o MCP atual continuam usando SQLite, sem alterações nesta etapa.
