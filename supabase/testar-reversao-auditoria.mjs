// cd supabase && node testar-reversao-auditoria.mjs
// Ensaio da migration da auditoria (20261120000000) ANTES de ir para produção, 100% local (PGlite):
//   antes -> migration -> uso -> DESFAZER (as linhas "--   " do próprio arquivo) -> igual ao antes -> migration de novo.
// Prova também que a migration inteira, dentro de uma transação, não deixa nada pela metade se der erro no meio.
import { readFileSync } from 'node:fs'
import { criaBanco, como, dono, q as qq, uid } from './volume.mjs'

const ARQ = '20261120000000_auditoria.sql'
const migration = readFileSync(new URL('migrations/' + ARQ, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const desfazer = migration.slice(migration.indexOf('-- COMO DESFAZER')).split('\n').filter(l => l.startsWith('--   ')).map(l => l.slice(5)).join('\n')

let total = 0, falhas = 0
const ok = (cond, msg) => { total++; console.log((cond ? '  ok      ' : '  FALHOU  ') + msg); if (!cond) falhas++ }
const db = await criaBanco(ARQ), q = (s, p) => qq(db, s, p)
ok(/begin;/.test(desfazer) && /commit;/.test(desfazer) && /drop table if exists auditoria/.test(desfazer), `o bloco "COMO DESFAZER" do arquivo foi extraído (${desfazer.split('\n').length} linhas, em transação)`)

// ---- dados de antes da migration (como a produção: já existem campeonato, equipe, atletas, histórico) ----
const SEC = uid(1, 1), ARB = uid(1, 2), NOVO = uid(1, 9)
await db.exec(`insert into auth.users values ('${SEC}', 'sec@teste.local'), ('${ARB}', 'arb@teste.local'), ('${NOVO}', 'novo@teste.local')`)
await db.exec(`insert into perfis (id, nome, papel) values ('${SEC}', 'Ana Souza', 'secretaria'), ('${ARB}', 'João Paulo', 'arbitro')`)
const C = uid(2, 1), E = uid(3, 1), A = uid(4, 1)
await db.exec(`insert into campeonatos (id, nome, modalidade, idade_min, inicio) values ('${C}', 'Copa Antes Da Auditoria', 'Futsal', 15, '2027-05-01');
  insert into equipes (id, campeonato_id, nome, bairro) values ('${E}', '${C}', 'Time Antigo', 'Centro');
  insert into atletas (id, equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento) values ('${A}', '${E}', 'Atleta Antigo', 5, '1995-05-05', 'Centro', true, false, true);
  insert into historico (campeonato_id, quem, o_que, motivo) values ('${C}', 'Ana Souza (secretaria)', 'Registro antigo do histórico', 'antes da auditoria')`)

const fotografia = async () => (await q(`select jsonb_build_object(
  'tabelas', (select jsonb_agg(x order by x) from (select c.relname || '[' || c.relkind::text || ']' x from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S')) t),
  'colunas', (select jsonb_agg(x order by x) from (select table_name || '.' || column_name || ':' || data_type x from information_schema.columns where table_schema = 'public') t),
  'funcoes', (select jsonb_agg(x order by x) from (select p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)) || coalesce(p.proconfig::text, '') x from pg_proc p where p.pronamespace = 'public'::regnamespace) t),
  'gatilhos', (select jsonb_agg(x order by x) from (select tgrelid::regclass::text || '.' || tgname::text x from pg_trigger where not tgisinternal) t),
  'politicas', (select jsonb_agg(x order by x) from (select tablename || '.' || policyname || '.' || cmd x from pg_policies where schemaname = 'public') t),
  'privilegios', (select jsonb_agg(x order by x) from (select c.relname || '/' || r.rolname || '=' || a.privilege_type x from pg_class c, aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee where c.relnamespace = 'public'::regnamespace and r.rolname in ('anon', 'authenticated')) t)) j`))[0].j
const dados = async () => (await q(`select md5(string_agg(x, '|' order by x)) s from (
  select 'c' || (to_jsonb(t))::text x from campeonatos t union all select 'e' || (to_jsonb(t))::text from equipes t union all select 'a' || (to_jsonb(t))::text from atletas t
  union all select 'j' || (to_jsonb(t))::text from jogos t union all select 'p' || (to_jsonb(t))::text from perfis t union all select 'h' || ((to_jsonb(t)) - 'usuario_id')::text from historico t) z`))[0].s
const semUsuarioId = f => ({ ...f, colunas: f.colunas.filter(c => !c.startsWith('historico.usuario_id:')) })
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n1) ANTES da migration')
const F0 = await fotografia(), D0 = await dados()
ok(!F0.tabelas.includes('auditoria[r]') && !F0.colunas.some(c => c.startsWith('historico.usuario_id')), 'não existe tabela auditoria nem a coluna historico.usuario_id')

console.log('\n2) Migration inteira dentro de UMA transação com erro no meio (simula falha em produção)')
try { await db.exec('begin;\n' + migration + '\nselect 1 / 0;\ncommit;') } catch { await db.exec('rollback') }
ok(igual(await fotografia(), F0) && await dados() === D0, 'com erro no meio, NADA fica aplicado: esquema, gatilhos, funções e dados idênticos ao antes')

console.log('\n3) Migration em uma transação, sem erro (como será aplicada)')
await db.exec('begin;\n' + migration + '\ncommit;')
const F1 = await fotografia()
ok(F1.tabelas.includes('auditoria[r]') && F1.gatilhos.some(g => g.startsWith('campeonatos.auditoria_depois')) && !igual(F1, F0), 'tabela auditoria, gatilhos e funções criados')
ok(await dados() === D0, 'nenhum dado de campeonatos, equipes, atletas, jogos, perfis nem do histórico mudou (a migration não preenche o passado)')
ok((await q(`select count(*)::int c from auditoria`))[0].c === 0, 'a auditoria começa vazia: a migration não gera registros')
ok((await q(`select count(*)::int c from historico where usuario_id is not null`))[0].c === 0 && (await q(`select count(*)::int c from historico`))[0].c === 1, 'o histórico existente continua com 1 registro, com usuario_id vazio')

console.log('\n4) Uso depois da migration (como a Secretaria)')
await como(db, SEC)
await q(`update campeonatos set local = 'Quadra Nova' where id = $1`, [C])
await q(`update atletas set aprovado = true where id = $1`, [A])
await q(`select liberar_acesso('novo@teste.local', 'Novo Arbitro', 'arbitro')`)
await dono(db)
const aud = await q(`select tabela, operacao, usuario_nome, origem from auditoria order by id`)
ok(aud.length === 2 && aud[0].tabela === 'campeonatos' && aud[1].tabela === 'atletas' && aud.every(a => a.usuario_nome === 'Ana Souza' && a.origem === 'app'), 'duas alterações viraram dois registros (o liberar_acesso não duplica: já está no histórico)')
ok((await q(`select usuario_id from historico where o_que like 'Árbitro liberado%'`))[0].usuario_id === SEC, 'o histórico novo guarda também o id do usuário')
const D1 = await dados(), F1b = await fotografia()

console.log('\n5) DESFAZER (as linhas do próprio arquivo)')
await db.exec(desfazer)
const F2 = await fotografia()
ok(igual(semUsuarioId(F2), F0), 'esquema, funções (inclusive registrar, com o mesmo texto de antes), gatilhos, políticas e privilégios iguais aos de ANTES (só a coluna opcional historico.usuario_id fica)')
for (const k of ['tabelas', 'funcoes', 'gatilhos', 'politicas', 'privilegios']) ok(igual(F2[k], F0[k]), `   ${k}: idênticos ao antes`)
ok(await dados() === D1, 'os dados e o histórico continuam como estavam (desfazer só remove a auditoria)')
await como(db, SEC)
try { await db.query(`select count(*) from auditoria`); ok(false, 'a tabela auditoria não deveria existir') } catch (e) { ok(/does not exist/.test(e.message), 'a tabela auditoria some (a tela mostraria "ainda não foi ativada")') }
await q(`update campeonatos set local = 'Quadra Depois do Desfazer' where id = $1`, [C])
await q(`select liberar_acesso('arb@teste.local', 'Joao', 'arbitro')`).catch(() => {})
await dono(db)
ok((await q(`select local from campeonatos where id = $1`, [C]))[0].local === 'Quadra Depois do Desfazer', 'o sistema continua gravando normalmente depois de desfazer')
ok((await q(`select count(*)::int c from historico`))[0].c >= 2, 'e o histórico continua sendo gravado pelo registrar() de antes')

console.log('\n6) Aplicar de novo depois de desfazer')
await db.exec('begin;\n' + migration + '\ncommit;')
ok(igual((({ colunas, ...r }) => r)(await fotografia()), (({ colunas, ...r }) => r)(F1b)), 'aplicar outra vez deixa o esquema igual ao da primeira aplicação')

console.log(falhas ? `\n${falhas} de ${total} verificações falharam` : `\nok: ${total} verificações do ensaio de aplicação e reversão`)
process.exit(falhas ? 1 : 0)
