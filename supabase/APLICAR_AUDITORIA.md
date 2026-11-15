# Aplicar a migration da auditoria em produção (roteiro)

Migration: `migrations/20261120000000_auditoria.sql`. **Ainda não foi aplicada em produção.** Este roteiro só vale depois da autorização da Secretaria.
Ensaio local completo (aplicar, usar, desfazer, aplicar de novo): `npm run test:auditoria` (inclui `testar-reversao-auditoria.mjs`).

## O que muda (e o que não muda)
- Cria a tabela `auditoria` (vazia), 11 gatilhos, 3 funções novas e a coluna opcional `historico.usuario_id`. Troca o texto de `registrar()` (passa a gravar também o id do usuário) e marca 5 funções com `application_name = tnt_ja_registrado`.
- **Não** altera nenhum dado existente (campeonatos, equipes, atletas, jogos, perfis, histórico), nenhuma política existente, nenhum bucket, nenhuma view pública, nem o site.
- Depois de aplicada, cada criação, edição ou exclusão em campeonatos, equipes, atletas, perfis e a troca de árbitro gera 1 registro (sem dado pessoal). Antes disso, nada é registrado do passado.
- Duração: menos de 1 segundo. Escolha um momento sem súmula em andamento.

## 1. Pré-checagem (só leitura, no editor SQL de produção)
Todas devem dar o resultado indicado. Qualquer divergência: **pare e me avise** (não aplique).
```sql
select to_regclass('public.auditoria') is null as auditoria_nao_existe;                                       -- true
select count(*) = 0 as sem_coluna from information_schema.columns where table_name = 'historico' and column_name = 'usuario_id';   -- true
select count(*) = 0 as sem_funcoes_novas from pg_proc where proname in ('auditar', 'auditoria_colunas', 'auditoria_imutavel');     -- true
select proname, oid::regprocedure::text from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('inscrever_pelo_link', 'aplicar_sorteio', 'cancelar_sorteio', 'vincular_equipe', 'liberar_acesso') order by 1;     -- 5 linhas (uma por função)
select prosrc from pg_proc where proname = 'registrar' and pronamespace = 'public'::regnamespace;               -- igual ao registrar() de supabase/migrations/20261106000000_inicial.sql (sem usuario_id)
select count(*) as gatilhos_existentes from pg_trigger where not tgisinternal and tgname in ('atleta_antes_gravar', 'evento_antes_gravar', 'evento_desfeito');  -- 3
select (select count(*) from campeonatos) c, (select count(*) from equipes) e, (select count(*) from atletas) a, (select count(*) from jogos) j, (select count(*) from perfis) p, (select count(*) from historico) h;  -- anote: serve para conferir depois
```
Se uma das 5 funções faltar, o gatilho registraria em duplicidade aquela operação: não aplique até entender o motivo.

## 1b. Teste da marca no Supabase hospedado (dentro de transação, sempre com ROLLBACK)
Nada permanece. Deve rodar sem erro e terminar mostrando o valor aplicado; se der `permission denied`, **pare**.
```sql
begin;
alter function public.vincular_equipe(text, text) set application_name = 'tnt_ja_registrado';
select proconfig::text from pg_proc where proname = 'vincular_equipe' and pronamespace = 'public'::regnamespace;   -- {search_path=public,application_name=tnt_ja_registrado}
rollback;
```
Depois, conferir por leitura que `vincular_equipe` voltou a ter só `{search_path=public}`.

## 2. Backup (antes de qualquer alteração)
Pasta nova fora do repositório, ao lado dos anteriores: `C:\servidor\backups\tnt-esportes\<data>_f\`.
1. `banco.json`: todas as tabelas (mesmo método do backup E), e anotar as contagens da pré-checagem.
2. `storage-config.json`: buckets, políticas e lista de arquivos do `marcas` (não muda nesta etapa; serve de referência).
3. `catalogo.json`: o que a reversão precisa para voltar **exatamente** ao que está hoje (leitura):
```sql
select jsonb_build_object(
  'funcoes', (select jsonb_agg(jsonb_build_object('nome', p.oid::regprocedure::text, 'definicao', pg_get_functiondef(p.oid), 'config', p.proconfig)) from pg_proc p where p.pronamespace = 'public'::regnamespace),
  'gatilhos', (select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t where not t.tgisinternal and t.tgrelid::regclass::text in ('campeonatos', 'equipes', 'atletas', 'perfis', 'jogos', 'historico', 'eventos')),
  'politicas_historico', (select jsonb_agg(to_jsonb(p)) from pg_policies p where p.tablename = 'historico'),
  'colunas_historico', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_name = 'historico')) as catalogo;
```
4. Confirmar que os arquivos foram gravados (tamanho maior que zero) **antes** do passo 3.

## 3. Aplicação
- No editor SQL de produção, colar `begin;` + o conteúdo **inteiro** do arquivo da migration + `commit;` e executar **tudo de uma vez** (não selecionar trechos). Se qualquer comando falhar, nada fica aplicado (ensaiado: um erro no meio deixa o banco idêntico ao antes).
- Quem cola: a Secretaria ou eu, a seu critério (o texto é grande; colar da área de transferência é mais seguro do que digitar).

## 4. Verificação depois (leitura)
```sql
select to_regclass('public.auditoria') is not null as existe, (select relrowsecurity from pg_class where relname = 'auditoria') as rls;     -- true, true
select r.rolname, a.privilege_type from pg_class c, aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee where c.relname = 'auditoria' and r.rolname in ('anon', 'authenticated');  -- só authenticated / SELECT
select count(*) from pg_trigger where not tgisinternal and tgname in ('auditoria_depois', 'auditoria_antes_excluir', 'auditoria_sem_alterar', 'auditoria_sem_truncar');   -- 11
select p.proname, p.proconfig::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('inscrever_pelo_link', 'aplicar_sorteio', 'cancelar_sorteio', 'vincular_equipe', 'liberar_acesso');   -- todas com search_path=public e application_name=tnt_ja_registrado
select count(*) from auditoria;                                                                                -- 0
select (select count(*) from campeonatos) c, (select count(*) from equipes) e, (select count(*) from atletas) a, (select count(*) from jogos) j, (select count(*) from perfis) p, (select count(*) from historico) h;   -- iguais às da pré-checagem
```
Pela API e pelo site (sem alterar nada):
- visitante: `GET /rest/v1/auditoria` com a chave pública deve ser **negado** (permission denied), e o portal público continua igual;
- Secretaria: a aba **Auditoria** deixa de dizer "ainda não foi ativada" e mostra "Nenhum registro encontrado";
- árbitro e representante: sem a aba; consulta direta devolve 0 linhas;
- Central, portal, súmula e inscrição pelo link abrem como antes.

Prova de ponta a ponta (opcional, decisão da Secretaria): a primeira alteração real já aparece sozinha. Quem quiser confirmar na hora pode fazer uma edição reversível (por exemplo, mudar o "Local" do campeonato e voltar). Isso grava 2 registros que **não podem ser apagados** depois (a auditoria é inalterável), então só se a Secretaria concordar.

## 5. Reversão
Quando: qualquer erro na verificação, ou a Secretaria desistir. Não mexe em nenhum dado.
1. **Guardar os registros** (se já houver): `select to_jsonb(a) from auditoria a order by id` e salvar o resultado fora do banco (a tabela some).
2. Executar o bloco "COMO DESFAZER" do fim do arquivo da migration (as linhas que começam com `--   `, sem esse prefixo). Está em transação e foi ensaiado: o esquema, as funções (inclusive o texto original de `registrar()`), os gatilhos, as políticas e os privilégios voltam **idênticos** aos de antes; só a coluna opcional `historico.usuario_id` fica (vazia de efeito).
3. Conferir: `to_regclass('public.auditoria')` nulo; a aba Auditoria volta a dizer "ainda não foi ativada"; contagens iguais às da pré-checagem; uma gravação normal na Central funciona.
4. Se a reversão também falhar: restaurar as funções a partir de `catalogo.json` (campo `definicao`) e me chamar; o `banco.json` do backup tem todos os dados.

## 6. Riscos conhecidos
- O gatilho roda a cada gravação nas 5 tabelas. Se ele falhar, a gravação do usuário falha junto (por desenho, para nada ficar sem registro). Mitigação: ensaio local com 72 verificações, texto do resumo nunca nulo, e a reversão acima.
- `ALTER FUNCTION ... SET application_name` e a leitura de `auth.uid()` foram ensaiados no Postgres local (PGlite), **não** no Supabase hospedado. Um erro de permissão aparece na aplicação e desfaz tudo (transação).
- Quem tem acesso de administrador ao banco ainda pode desligar gatilhos; o que fica garantido é que ninguém pelo app, nem a Secretaria, escreve, altera ou apaga a auditoria.
- Um `create or replace` futuro em uma das 5 funções apaga a marca `application_name=tnt_ja_registrado`: o teste `testar-auditoria.mjs` acusa.
- Retenção indeterminada (decisão da Secretaria): a tabela só cresce; o volume esperado é pequeno.
- O histórico já guardava o nome do atleta na mensagem "Atleta inscrito pelo link" (só a Secretaria lê). A auditoria nova não guarda nome.

## 7. Histórico da primeira tentativa (15/11/2026)
A primeira versão da migration usava `ALTER FUNCTION ... SET tnt.ja_registrado = 'on'`. Em produção falhou com `42501 permission denied to set parameter "tnt.ja_registrado"` (o Supabase hospedado não deixa definir parâmetro personalizado) e **tudo foi desfeito** pela transação (conferido: sem tabela, coluna, gatilhos nem funções novas; `registrar()` com o mesmo MD5; contagens iguais). O marcador passou a ser `application_name = 'tnt_ja_registrado'`, parâmetro padrão que qualquer papel pode definir. Antes de reaplicar: teste em produção só dentro de `begin; ... rollback;` (passo 1b).
- Limite do marcador: quem abre uma conexão direta ao banco (senha do banco, não o app) poderia definir esse `application_name` e escapar da auditoria; já era o caso de quem tem acesso de administrador (ver "Riscos conhecidos").
