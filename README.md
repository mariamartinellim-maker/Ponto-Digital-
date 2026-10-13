# Ponto Digital Gestão

Sistema de gestão de entradas, saídas e vendas com login, SQLite, edição, exclusão, filtros e exportação CSV. Cada usuário vê somente seus próprios lançamentos.

## Executar no computador

1. Instale Python 3.10 ou superior.
2. Abra um terminal na pasta do projeto.
3. Execute `python -m pip install -r requirements.txt`.
4. Defina uma chave secreta forte: `SECRET_KEY` (variável de ambiente). Em Windows PowerShell: `$env:SECRET_KEY = 'uma-chave-aleatoria-longa-e-secreta'`. Em Linux/macOS: `export SECRET_KEY='uma-chave-aleatoria-longa-e-secreta'`.
5. Execute `python app.py`.
6. Abra http://127.0.0.1:5000 e clique em **Cadastre-se**.

Os dados ficam no arquivo `gestao.db`, criado automaticamente. Não apague esse arquivo. Faça backups regulares.

## Para uso online

Publique em servidor com HTTPS e volume **persistente** para o SQLite, ou migre para PostgreSQL gerenciado. Configure `SECRET_KEY` forte, `COOKIE_SECURE=1` e `DATABASE_PATH` apontando para o volume persistente. Execute com `gunicorn app:app` em ambiente Linux. Não use o servidor de desenvolvimento Flask em produção.

**Atenção:** esta é uma primeira versão funcional, ainda não publicada nem hospedada. Não há recuperação de senha por e-mail, cadastro independente de clientes, nem backups automáticos. O cadastro de usuários está aberto: se quiser contas somente por convite, será necessário restringi-lo antes de publicar. Para operação comercial, recomenda-se configurar backups, monitoramento e recuperação de senha.
