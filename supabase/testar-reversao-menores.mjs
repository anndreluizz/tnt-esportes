// cd supabase && node testar-reversao-menores.mjs
// Prova a migration de menores (20261119000000): antes -> depois -> DESFAZER (o texto do próprio arquivo) -> de novo.
// Confere dados mostrados, definição, permissões (ACL), dono e colunas da view atletas_publico em cada fase.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
const CR = String.fromCharCode(13), dir = new URL('migrations/', import.meta.url)
const ler = f => readFileSync(new URL(f, dir), 'utf8').split(CR).join('')
const ARQ = '20261119000000_menores_nome_publico.sql'

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`)
// todas as migrations ANTES da dos menores (e as que não dependem dela)
for (const f of readdirSync(dir).sort().filter(f => !f.includes('_storage') && f < ARQ)) await db.exec(ler(f))

// dados de exemplo: um campeonato (início 06/03/2027) com atletas de idades e nomes variados, todos aprovados
await db.exec(`alter table atletas disable trigger atleta_antes_gravar`)
const [{ id: C }] = (await db.query(`insert into campeonatos (nome, modalidade, idade_min, inicio) values ('Copa Teste 2027', 'Futsal', 10, '2027-03-06') returning id`)).rows
const [{ id: E }] = (await db.query(`insert into equipes (campeonato_id, nome, bairro, pote) values ($1, 'Equipe Teste', 'Centro', 1) returning id`, [C])).rows
const exemplos = [
  ['Maria Clara Souza Lima', '2010-05-01'], ['Cacau', '2011-02-02'], ['Ágatha Évora', '2010-09-09'], ['Ana de Souza', '2012-01-01'],
  ['Ana-Maria Silva', '2011-07-07'], ['  joao   pedro  ', '2010-03-03'], ['Carlos Eduardo Pereira', '1995-03-03'],
  ['Menor que faz 18 depois do início', '2009-03-07'], ['Maior que fez 18 no dia do início', '2009-03-06']]
let n = 1
for (const [nome, nasc] of exemplos) await db.query(`insert into atletas (equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento) values ($1, $2, $3, $4, 'Centro', true, true, true)`, [E, nome, n++, nasc])
await db.query(`insert into atletas (equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento) values ($1, 'Menor Nao Aprovado', 50, '2010-01-01', 'Centro', true, false, true)`, [E])

const foto = async () => {
  const meta = (await db.query(`select pg_get_viewdef('atletas_publico'::regclass) def, relacl::text acl, relowner::regrole::text dono, reloptions::text opcoes from pg_class where oid = 'atletas_publico'::regclass`)).rows[0]
  const cols = (await db.query(`select string_agg(attname || ':' || format_type(atttypid, atttypmod), ', ' order by attnum) c from pg_attribute where attrelid = 'atletas_publico'::regclass and attnum > 0 and not attisdropped`)).rows[0].c
  const privs = (await db.query(`select grantee, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_name = 'atletas_publico' and grantee in ('anon', 'authenticated') group by grantee order by grantee`)).rows.map(r => `${r.grantee}=${r.p}`).join(' ')
  await db.exec('set role anon')
  const linhas = (await db.query(`select numero, nome from atletas_publico order by numero`)).rows
  await db.exec('reset role')
  return { ...meta, cols, privs, linhas }
}
let falhas = 0
const ok = (c, m) => { console.log((c ? '  ok      ' : '  FALHOU  ') + m); if (!c) falhas++ }

const antes = await foto()
console.log('\n1) ANTES (como está hoje em produção) — o que o visitante vê:')
antes.linhas.forEach(l => console.log(`     camisa ${String(l.numero).padStart(2)}  ${l.nome}`))

await db.exec(ler(ARQ))
const depois = await foto()
console.log('\n2) DEPOIS da migration — o que o visitante vê:')
depois.linhas.forEach(l => console.log(`     camisa ${String(l.numero).padStart(2)}  ${l.nome}`))

console.log('\n3) Conferências:')
const nome = k => depois.linhas.find(l => l.numero === k)?.nome
ok(nome(1) === 'Maria L.', 'composto: "Maria Clara Souza Lima" -> "Maria L."')
ok(nome(2) === 'Cacau', 'nome único fica como está')
ok(nome(3) === 'Ágatha É.', 'acento: inicial maiúscula')
ok(nome(4) === 'Ana S.', 'partícula: "Ana de Souza" -> "Ana S." (usa o último sobrenome)')
ok(nome(5) === 'Ana-Maria S.', 'nome com hífen: primeiro "nome" é "Ana-Maria"')
ok(nome(6) === 'joao P.', 'espaços extras são ignorados')
ok(nome(7) === 'Carlos Eduardo Pereira', 'maior de 18 anos: nome completo')
ok(nome(8) === 'Menor I.', 'fronteira: faz 18 um dia DEPOIS do início do campeonato -> ainda é menor, abreviado')
ok(nome(9) === 'Maior que fez 18 no dia do início', 'fronteira: faz 18 NO DIA do início -> já é maior, nome completo')
ok(depois.linhas.length === antes.linhas.length && !depois.linhas.some(l => l.numero === 50), 'a mesma quantidade de atletas aparece; o menor não aprovado continua fora')
ok(depois.linhas.map(l => l.numero).join() === antes.linhas.map(l => l.numero).join(), 'cada atleta continua identificado pela mesma camisa (número único por equipe)')
ok(depois.cols === antes.cols && depois.cols === 'id:uuid, equipe_id:uuid, nome:text, numero:smallint', `colunas e tipos iguais: ${depois.cols}`)
ok(depois.privs === antes.privs && depois.privs === 'anon=SELECT authenticated=SELECT', `permissões iguais antes e depois: ${depois.privs}`)
ok(depois.acl === antes.acl && depois.dono === antes.dono && depois.opcoes === antes.opcoes, `dono, ACL e opções preservados (dono: ${depois.dono})`)
await db.exec('set role anon')
let negado = false; try { await db.query(`select nascimento from atletas`) } catch (e) { negado = /permission denied/.test(e.message) }
await db.exec('reset role')
ok(negado, 'visitante continua sem acesso à tabela atletas (nascimento, documentos, contatos)')

// DESFAZER: executa o texto do próprio arquivo (as linhas "--   ..." depois de "COMO DESFAZER")
const texto = ler(ARQ), pos = texto.indexOf('-- COMO DESFAZER')
const rollback = texto.slice(pos).split('\n').slice(1).filter(l => l.startsWith('--')).map(l => l.replace(/^--\s*/, '')).join('\n')
console.log('\n4) DESFAZER — executando o roteiro exatamente como está no arquivo:\n     ' + rollback.replace(/\n/g, '\n     '))
await db.exec(rollback)
const revertido = await foto()
ok(JSON.stringify(revertido.linhas) === JSON.stringify(antes.linhas), 'depois de desfazer, o visitante vê EXATAMENTE o mesmo que antes (nomes completos)')
ok(revertido.cols === antes.cols && revertido.privs === antes.privs && revertido.acl === antes.acl && revertido.dono === antes.dono, 'depois de desfazer: colunas, permissões, ACL e dono idênticos aos de antes')
ok(revertido.def === antes.def, 'depois de desfazer: a definição da view é idêntica à original')

await db.exec(ler(ARQ))
const reaplicado = await foto()
ok(JSON.stringify(reaplicado.linhas) === JSON.stringify(depois.linhas) && reaplicado.acl === depois.acl, 'reaplicar a migration depois de desfazer funciona e dá o mesmo resultado')
console.log('\n5) Dados reais da tabela atletas depois de tudo (nenhum registro foi alterado):')
const t = (await db.query(`select count(*)::int n, count(*) filter (where nome like 'Maria Clara%') maria from atletas`)).rows[0]
ok(t.n === exemplos.length + 1 && t.maria === 1, `tabela atletas intacta: ${t.n} registros, nomes completos preservados`)
console.log(falhas ? `\n${falhas} verificações falharam` : '\nok: migration, permissões e reversão verificadas')
process.exit(falhas ? 1 : 0)
