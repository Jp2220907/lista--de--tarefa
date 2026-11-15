# Publicar a página na Vercel a partir do GitHub

O repositório contém tanto o aplicativo Windows/MCP quanto a página para o
iPhone. A configuração vercel.json publica SOMENTE a pasta static.
O Python, banco e sessão local não são parte do site público.

## Importar o repositório

Depois do envio autorizado ao GitHub:

1. Na Vercel, escolher Add New > Project e importar Jp2220907/lista--de--tarefa.
2. Selecionar main como branch de produção e manter a raiz do repositório.
3. Framework Preset: Other. Output Directory: static. O vercel.json já define
   isso, desativa instalação/build e aplica os cabeçalhos do site.
4. O SDK do Supabase já está empacotado. Não é necessário executar npm ou instalar
   dependências para publicar a página preparada.
5. Não cadastrar senha do banco, service_role, chave secreta do Supabase ou tokens
   do Hermes como variáveis. A configuração estática usa só a chave publicável.
6. Conferir e iniciar Deploy. Salvar o endereço HTTPS de produção fornecido.

Esses passos ainda não foram executados por este roteiro. A página de login será
pública; as tarefas são consultadas com a sessão individual e políticas do banco.

## Configurar o Supabase

Em Authentication > URL Configuration, configurar Site URL com o endereço HTTPS
de produção, com / ao final. Incluir esse mesmo endereço em Redirect URLs.
Preservar http://127.0.0.1:8765/ se ainda for utilizado para testes no notebook.
Não desativar confirmação de e-mail nem RLS para solucionar problemas de acesso.

## Validar no iPhone

1. Abrir a URL de produção no Safari e entrar com a conta já confirmada.
2. Criar uma tarefa fictícia no celular e conferir sua chegada na página do notebook
   e por listar_tarefas do Hermes (origem cloud).
3. Editar/concluir no notebook e verificar no celular. O aplicativo consulta
   alterações enquanto está visível; ao voltar para ele, deve consultar novamente.
4. Conferir isolamento com uma segunda conta no Supabase real.
5. No Safari, Compartilhar > Adicionar à Tela de Início.

A lista na nuvem pode ser usada com o notebook desligado. O Hermes instalado
somente no notebook depende desse equipamento ligado. O chat dentro do aplicativo
ainda não se conecta ao Hermes. Offline de tarefas e notificações não estão prontos.
