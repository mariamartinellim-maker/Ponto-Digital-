# Segurança e LGPD

## Autenticação

- Senhas armazenadas com **scrypt** + salt aleatório (nunca em texto). Política: mínimo de 10 caracteres com letras e números.
- Sessão em cookie `HttpOnly`, `SameSite=Lax`, `Secure` (em produção), assinado com **HMAC-SHA256** (`SESSION_SECRET`), validade de 12h.
- **Versão de sessão** por usuário: trocar senha, mudar perfil ou desativar o usuário invalida imediatamente as sessões abertas em todos os aparelhos.
- **Limite de tentativas**: 5 logins por e-mail/IP a cada 15 min; mensagens genéricas (não revelam se o e-mail existe) e tempo de resposta equalizado.
- **Recuperação de senha**: token aleatório de 256 bits, guardado apenas como hash SHA-256, válido por 30 min e **uso único**.
- Usuários são criados pelo administrador (sem cadastro público).

## Controle de acesso e isolamento de dados

- `src/proxy.ts` barra quem não tem sessão; a autorização definitiva é refeita **no servidor** em cada página, ação e rota (`requireUser` / `authorize`).
- Perfis e permissões em `src/lib/permissions.ts` (matriz visível em *Equipe e permissões*).
- Toda consulta filtra por `org_id`. No Supabase, o mesmo isolamento é garantido também pelo banco com **Row Level Security** (`supabase/migrations`), testado em `supabase/tests/rls-test.sql`:
  - usuário só enxerga a própria organização; chaves estrangeiras compostas impedem ligar dados de organizações diferentes;
  - privilégios por coluna (o acesso amplo padrão do Supabase é revogado; `anon` não acessa nada);
  - atendente vê apenas conversas próprias ou sem responsável e não exclui clientes nem oportunidades;
  - auditoria: cada um registra só as próprias ações (sem escolher data/hora), só administradores leem, ninguém altera ou apaga — nem o servidor;
  - consentimento: o status do cliente muda apenas pelo histórico, registrado em nome de quem está logado; histórico permanente;
  - o banco recusa destinatário de campanha sem opt-in; aprovação de modelos e envio real só pelo servidor;
  - a organização nunca fica sem administrador; a primeira organização é criada por função de uso único (ver `docs/SUPABASE.md`).

## Proteção de credenciais

- Nenhum segredo no código. Variáveis em `.env.local` (ignorado pelo Git; gerado com valores aleatórios por `npm run setup`) ou no painel da hospedagem.
- A tela de configuração do WhatsApp mostra apenas **se** cada segredo está definido, nunca o valor.
- A chave `SUPABASE_SERVICE_ROLE_KEY` deve existir somente no servidor.

## Aplicação web

- Cabeçalhos: Content-Security-Policy, HSTS (produção), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Server Actions do Next.js com verificação de origem (proteção contra CSRF) e validação de entradas com **zod**.
- Webhook: assinatura HMAC obrigatória, limite de tamanho (1 MB), limite de requisições, idempotência.
- O PWA não guarda dados de clientes no aparelho (service worker só armazena a interface e a página offline).

## LGPD

| Requisito | Como o CRM atende |
| --- | --- |
| Base legal / consentimento para marketing | Status de consentimento por cliente (opt-in, opt-out, sem consentimento) com **histórico** de quem registrou, quando, origem e observação. Campanhas só alcançam opt-in. |
| Direito de oposição (descadastro) | "SAIR", "PARAR", "STOP" descadastram automaticamente; botão de descadastro manual; descadastrados nunca recebem campanhas. |
| Importação | Consentimento vindo de planilha só é aceito se o usuário confirmar que possui comprovação. |
| Acesso e portabilidade | Exportação de todos os dados do titular em JSON (cliente → *Exportar dados*). |
| Eliminação | Anonimização do cadastro e exclusão das conversas (perfil Administrador). |
| Prestação de contas | Auditoria de logins, alterações, importações, exportações, campanhas, consentimentos e usuários. |
| Minimização | Webhooks guardam só o necessário (resumo); conteúdo fica apenas na conversa do cliente. |

### Recomendações para a operação

- Publicar uma **política de privacidade** e indicar o encarregado (DPO) da agência.
- Registrar a forma de coleta do consentimento (formulário, mensagem etc.) no campo de observação.
- Definir prazo de retenção para conversas e clientes inativos.
- Ativar 2FA no Supabase, na hospedagem, no Business Manager da Meta e no GitHub.
- Backups automáticos do banco (Supabase oferece) e revisão periódica dos acessos da equipe.
