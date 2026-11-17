# Ativar os avisos no Supabase

O calendário funciona sem configuração adicional. Os avisos exigem este serviço
no Supabase: o site na Vercel sozinho não executa tarefas agendadas. O código
está preparado; nenhum envio real foi ativado nesta entrega.

## Preparar o projeto

No SQL Editor do **mesmo projeto que contém suas tarefas**, execute na ordem:

1. `supabase/02_notificacoes.sql` — inscrições por conta e controle de envios.
2. `supabase/03_agendamento_notificacoes.sql` — extensões e configuração do cron.

Não é necessário repetir `01_criar_tarefas.sql`. Esses arquivos preservam as
tarefas existentes. Se alguma extensão não estiver disponível no projeto,
resolva o erro antes de continuar; não desative o RLS.

## Gerar as chaves no seu computador

Na pasta atualizada do repositório, com Node.js instalado:

```sh
npm ci
npm run notifications:keys
```

Isso cria `.notifications-local/.env` e
`.notifications-local/ATIVAR_AGENDAMENTO.sql`. São arquivos privados, ignorados
pelo Git. Guarde-os com segurança; não envie no chat ou em um ZIP. O gerador
recusa sobrescrever chaves existentes. Não use a chave administrativa no site.

## Publicar a função e ativar o agendamento

Faça o login da CLI na sua própria conta Supabase e execute, na raiz do projeto:

```sh
npx supabase login
npx supabase secrets set --env-file .notifications-local/.env --project-ref lwshxdiwypkwdabpsqzc
npx supabase functions deploy task-reminders --project-ref lwshxdiwypkwdabpsqzc --no-verify-jwt
```

O Supabase fornece as variáveis internas do projeto à função. A consulta de
configuração é pública e retorna apenas a chave pública; o envio exige a chave
privada de agendamento. Não inclua chaves privadas na Vercel ou no navegador.

Abra **localmente** o arquivo gerado `ATIVAR_AGENDAMENTO.sql` e execute seu
conteúdo no SQL Editor. Ele guarda a autorização no Vault e ativa o job
`minha-lista-task-reminders`, a cada minuto. Não publique esse arquivo.

Se preferir executar com o Hermes, entregue este guia e os arquivos de código;
as chaves devem continuar no computador e ser lidas diretamente pelos comandos,
sem serem exibidas na conversa.

## Ativar no iPhone e testar

1. Abra o app **online instalado na Tela de Início**, entre na conta e toque em
   **Avisos → Verificar serviço → Ativar neste aparelho**. Permita os avisos.
   Requer iOS 16.4 ou posterior; no Safari sem instalação será orientada a instalação.
2. Crie uma tarefa fictícia para daqui a pelo menos 12 minutos. Feche o app.
3. Confira o aviso cerca de dez minutos antes e no horário. Ao tocar, deve abrir
   a tarefa na conta correta. O texto na tela bloqueada é discreto, sem título
   ou anotações da tarefa.
4. Teste concluir e mudar o horário de outra tarefa futura. Novos envios devem
   respeitar o estado e a data atuais. Uma mensagem já em trânsito pode chegar.
5. Sair da conta ou desativar os avisos deve cancelar a inscrição do aparelho.
   Em cada aparelho, a ativação é individual. Outra conta deve ativar novamente.

O botão da versão local no notebook orienta abrir a versão online para ativar.
O Hermes pode continuar criando tarefas na nuvem; o cron enviará os avisos mesmo
com o notebook desligado. Isso não mantém o próprio Hermes ligado na nuvem.

## Limites e verificação

O cron verifica a cada minuto, não no segundo exato. Internet, modo Foco, ajustes
do iPhone e o serviço de push podem atrasar ou impedir a entrega. A janela de
recuperação de avisos é de cinco minutos e o push expira em cinco minutos;
não há promessa de entrega exata ou recuperação de avisos antigos. Tarefas
criadas ou inscrições ativadas depois do horário do pré-aviso não o recebem
retroativamente. São até três tentativas por aviso; inscrições expiradas são
removidas. O serviço depende de o projeto Supabase estar ativo e das cotas dele.

Os testes automatizados exercitam o SQL em PostgreSQL via PGlite, a criptografia
Web Push e os controles de consentimento no navegador. As extensões cron/Vault/net
usam contratos simulados nesses testes. Eles não substituem o teste real de
envio no projeto e no iPhone após esta ativação.

Para pausar os envios, execute no SQL Editor:

```sql
select cron.unschedule(jobid)
from cron.job where jobname = 'minha-lista-task-reminders';
```

Não rotacione as chaves VAPID sem planejar a reinscrição dos aparelhos.
