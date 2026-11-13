# Lista de tarefas — protótipo local com Hermes

Aplicativo local para adicionar, listar, concluir e reabrir tarefas. A página e
as ferramentas MCP do Hermes compartilham o mesmo banco SQLite. Nesta fase não
há sincronização entre dispositivos, Supabase, Apple, Obsidian nem login de IA
embutido no aplicativo.

## Preparar e abrir no Windows

Use uma pasta nova para este protótipo, separada da sua lista de tarefas anterior.
Ele não importa nem apaga as tarefas antigas guardadas no navegador.

Requer Python 3.10 ou mais recente. No PowerShell, dentro da pasta do projeto:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py --port 8765
```

Abra `http://127.0.0.1:8765` no navegador. O servidor atende apenas neste
computador. Mantenha o terminal aberto enquanto usa a página.

No Linux/macOS, substitua `.\.venv\Scripts\python.exe` por
`.venv/bin/python` nos comandos.

## Conectar ao Hermes

Na configuração existente do Hermes, adicione a entrada `lista_tarefas` à seção
`mcp_servers`. Preserve as outras configurações e conexões; não substitua o
arquivo inteiro. Troque os caminhos de exemplo pelos caminhos absolutos da sua
cópia do projeto:

```yaml
mcp_servers:
  lista_tarefas:
    command: 'C:/Users/SEU_USUARIO/Downloads/Lista de tarefas prototipo/.venv/Scripts/python.exe'
    args:
      - 'C:/Users/SEU_USUARIO/Downloads/Lista de tarefas prototipo/hermes_mcp.py'
```

Reinicie o Hermes após salvar. O próprio Hermes inicia o processo MCP; não é
necessário executar `hermes_mcp.py` manualmente nem abrir uma porta para ele.
O servidor web só precisa estar aberto quando você quiser visualizar a página.

As ferramentas disponíveis são:

- `listar_tarefas`: retorna as tarefas e seus identificadores.
- `adicionar_tarefa`: recebe `texto` e cria uma tarefa.
- `concluir_tarefa`: recebe `tarefa_id`; `concluida` é `true` por padrão.
  Use `false` para reabrir uma tarefa.

Faça um teste com uma tarefa fictícia: “Use a lista de tarefas para adicionar
Testar integração com Hermes. Depois liste as tarefas.” A página consulta
alterações a cada três segundos. Em seguida, peça para concluir e reabrir a
mesma tarefa e verifique os estados na página.

O provedor de IA e o login ChatGPT/Codex, se usados, são configurados no Hermes
separadamente. Este projeto não solicita sua senha nem guarda credenciais de IA.

## Dados locais

O banco padrão fica em `.data/tasks.sqlite3`, dentro do projeto, independentemente
da pasta de onde os comandos forem executados. Para escolher outro local,
configure `TASKS_DB_PATH` com o mesmo caminho absoluto tanto no servidor web
quanto no processo MCP. Caminhos diferentes criam listas separadas.

## Verificação

Dentro da pasta do projeto:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Os testes MCP usam o cliente oficial do SDK, iniciam subprocessos reais e
verificam descoberta de ferramentas, criação, listagem, conclusão, reabertura,
persistência após reiniciar o processo e rejeição de entradas inválidas. Usam
bancos temporários, sem tocar nas suas tarefas.

Esse teste de protocolo não substitui o teste no seu Windows com sua instalação
do Hermes e sua conta ChatGPT. Não houve instalação no seu computador,
publicação na Hostinger nem validação desse login por este projeto.
