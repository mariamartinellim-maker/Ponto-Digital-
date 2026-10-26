# Atualizações do CRM só de madrugada (03:00, horário de Cuiabá)

As mudanças no CRM **não entram mais no ar na hora do commit**. Elas ficam guardadas na branch e
uma rotina na nuvem do GitHub (`.github/workflows/publicar-crm-madrugada.yml`) publica tudo de uma
vez às **03:00 em Cuiabá** (07:00 UTC). Nada roda no computador do escritório.

## O que a rotina faz, toda madrugada

1. Confere se é madrugada (00h–05h59 em Cuiabá). Fora disso, não publica.
2. Confere se há commit novo desde a última publicação (tag `crm-publicado`). Sem novidade, para.
3. Testa a versão nova: lint, tipos, testes automáticos e build (em modo demonstração, sem tocar
   no banco real). **Se algo falhar, não publica** e o GitHub manda e-mail.
4. Confere a saúde do CRM (`/api/health`), o que também acorda o plano gratuito.
5. Manda o Render publicar (deploy hook) e espera a versão nova entrar no ar.
6. Confere de novo a saúde e o endereço do webhook do WhatsApp (403 sem token = no ar).
7. Marca o commit publicado na tag `crm-publicado`.

O GitHub pode atrasar rotinas agendadas em alguns minutos; a publicação continua sendo de madrugada.

## Por que não se perdem dados nem mensagens

- **Dados:** publicar troca só o programa. O banco (Supabase) não é apagado nem alterado; a
  rotina não roda migrações. Migração de banco continua manual, com backup antes
  (`docs/BACKUP_SUPABASE.md`).
- **Troca sem desligar:** o Render sobe a versão nova ao lado da antiga e só passa o tráfego
  quando a nova responde em `/login` (health check). Se a nova falhar, a antiga continua no ar.
- **Mensagens do WhatsApp:** o webhook só responde "200 OK" depois de gravar a mensagem no
  Supabase; se der erro responde 500. A Meta reenvia toda notificação que não recebeu 200,
  repetindo por até 7 dias (documentação de webhooks da WhatsApp Cloud API). O registro é
  idempotente: um reenvio não duplica a mensagem.
- **Plano gratuito:** o serviço dorme após 15 minutos sem acesso e leva cerca de 1 minuto para
  acordar. A primeira notificação pode dar tempo esgotado, mas a Meta reenvia e ela entra.

## Configuração (uma vez só)

1. **Render → serviço `ponto-digital-crm` → Settings → Build & Deploy → Auto-Deploy: Off.**
   (Este arquivo `render.yaml` também já diz `autoDeployTrigger: off`.)
2. **Render → mesma tela → Deploy Hook → copiar o endereço.**
3. **GitHub → Settings → Secrets and variables → Actions → New repository secret:**
   nome `RENDER_DEPLOY_HOOK_URL`, valor = endereço copiado. (Quem cola é o dono da conta.)
4. Opcional: segredo `RENDER_API_KEY` (Render → Account Settings → API Keys) para a rotina
   acompanhar o status real da publicação em vez de esperar 10 minutos.
5. Opcional: variáveis `CRM_BRANCH` (padrão `claude/project-thread-iwgiqh`, a branch de teste
   atual; troque para `main` quando o teste for aprovado) e `CRM_URL`.

Rotinas agendadas do GitHub só rodam a partir da branch principal (`main`), por isso este
arquivo precisa estar na `main` para valer.

## Emergência (publicar agora)

GitHub → Actions → "Publicar CRM de madrugada" → Run workflow → marcar
"Publicar AGORA, mesmo fora da madrugada". Use só para correção urgente.

## Se algo der errado

- A rotina falhou nos testes: nada foi publicado, o CRM segue na versão anterior.
- Falhou depois de publicar: Render → serviço → Events → escolher a versão anterior →
  **Rollback**. Os dados não são afetados.

## Atualização de dependências (não automática)

Atualizar bibliotecas (npm) **não** é automático: pode quebrar o CRM. Quando for preciso, a
atualização é feita numa branch, testada e entra no ar pela mesma rotina das 03:00.
