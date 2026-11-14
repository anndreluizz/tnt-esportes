// cd supabase && node testar-reversao-historico.mjs
// Prova a migration do histórico público (20261119000100): antes -> depois -> DESFAZER (texto do próprio arquivo) -> de novo.
// Mostra o que o público vê antes e depois, o que a Secretaria continua vendo, e prova que a tabela "historico" não muda.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
const CR = String.fromCharCode(13), dir = new URL('migrations/', import.meta.url)
const ler = f => readFileSync(new URL(f, dir), 'utf8').split(CR).join('')
const ARQ = '20261119000100_historico_publico.sql'

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant select, references, trigger, truncate on tables to anon, authenticated;`)   // como o Supabase em objetos novos
for (const f of readdirSync(dir).sort().filter(f => !f.includes('_storage') && f < ARQ)) await db.exec(ler(f))

// dados de exemplo: um jogo e um registro de cada tipo, com autor, motivo interno e nome de atleta onde isso existe de verdade
const SEC = '11111111-1111-1111-1111-111111111111'
await db.query(`insert into auth.users (id) values ($1)`, [SEC])
await db.query(`insert into perfis (id, nome, papel) values ($1, 'Ana Souza', 'secretaria')`, [SEC])
const [{ id: C }] = (await db.query(`insert into campeonatos (nome, modalidade, idade_min, inicio) values ('Copa Teste 2027', 'Futsal', 10, '2027-03-06') returning id`)).rows
const [{ id: E1 }] = (await db.query(`insert into equipes (campeonato_id, nome, bairro, pote) values ($1, 'Time A', 'Centro', 1) returning id`, [C])).rows
const [{ id: E2 }] = (await db.query(`insert into equipes (campeonato_id, nome, bairro, pote) values ($1, 'Time B', 'Centro', 1) returning id`, [C])).rows
const [{ id: J }] = (await db.query(`insert into jogos (campeonato_id, fase, rodada, grupo, mandante_id, visitante_id, data, hora) values ($1, 'grupos', 1, 'A', $2, $3, '2027-03-06', '18h00') returning id`, [C, E1, E2])).rows
const reg = (o, m, jogo = J) => db.query(`insert into historico (campeonato_id, jogo_id, quem, o_que, motivo) values ($1, $2, 'Ana Souza (secretaria)', $3, $4)`, [C, jogo, o, m])
await reg('Súmula confirmada: Time A 2 × 1 Time B', null)
await reg('Correção confirmada: Time A 2 × 2 Time B', null)
await reg('Jogo adiado de 06/03 18h00 para 07/03 19h00', 'chuva forte na quadra (motivo interno)')
await reg('Jogo alterado de 06/03 18h00 para 06/03 19h00 · Quadra B', 'pedido do árbitro (motivo interno)')
await reg('W.O.: Time B não compareceu · Time A 3 × 0 Time B', 'time faltou sem avisar (motivo interno)')
await reg('Súmula reaberta para correção: Time A 2 × 1 Time B', 'gol anulado (motivo interno)')
await reg("Evento desfeito: gol de Fulano Silva Sauro (12')", null)
await reg('Suspensão de 1 jogo(s): Fulano Silva Sauro', 'agressão (motivo interno)', null)

const fotografar = async () => {
  const meta = (await db.query(`select pg_get_viewdef('historico_publico'::regclass) def, relacl::text acl, relowner::regrole::text dono, reloptions::text opcoes from pg_class where oid = 'historico_publico'::regclass`)).rows[0]
  const cols = (await db.query(`select string_agg(attname || ':' || format_type(atttypid, atttypmod), ', ' order by attnum) c from pg_attribute where attrelid = 'historico_publico'::regclass and attnum > 0 and not attisdropped`)).rows[0].c
  const privs = (await db.query(`select grantee, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_name = 'historico_publico' and grantee in ('anon', 'authenticated') group by grantee order by grantee`)).rows.map(r => `${r.grantee}=${r.p}`).join(' ')
  await db.exec('set role anon')
  const linhas = (await db.query(`select * from historico_publico order by em, o_que`)).rows
  await db.exec('reset role')
  const tabela = (await db.query(`select count(*)::int n, md5(string_agg(h::text, '|' order by h.id)) soma from historico h`)).rows[0]
  return { ...meta, cols, privs, linhas, tabela }
}
let falhas = 0
const ok = (c, m) => { console.log((c ? '  ok      ' : '  FALHOU  ') + m); if (!c) falhas++ }
const mostrar = l => Object.entries(l).filter(([k]) => k !== 'em' && k !== 'jogo_id').map(([k, v]) => `${k}="${v}"`).join('  ')

const antes = await fotografar()
console.log(`\n1) ANTES — o que o PÚBLICO vê hoje (${antes.linhas.length} de ${antes.tabela.n} registros):`)
antes.linhas.forEach(l => console.log('     ' + mostrar(l)))
console.log('   colunas: ' + antes.cols)

await db.exec(ler(ARQ))
const depois = await fotografar()
console.log(`\n2) DEPOIS da migration — o que o PÚBLICO vê (${depois.linhas.length} de ${depois.tabela.n} registros):`)
depois.linhas.forEach(l => console.log('     ' + mostrar(l)))
console.log('   colunas: ' + depois.cols)

console.log('\n3) A SECRETARIA depois da migration (lê a tabela historico):')
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${SEC}', false); set role authenticated`)
const sec = (await db.query(`select quem, o_que, motivo from historico order by id`)).rows
await db.exec('reset role')
sec.forEach(l => console.log(`     quem="${l.quem}"  o_que="${l.o_que}"  motivo=${l.motivo === null ? '—' : '"' + l.motivo + '"'}`))

console.log('\n4) Conferências:')
const textoPublico = JSON.stringify(depois.linhas)
ok(depois.cols === 'jogo_id:uuid, o_que:text, em:timestamp with time zone', `a view pública só tem: ${depois.cols}`)
ok(!textoPublico.includes('interno') && !textoPublico.includes('Ana Souza') && !/quem|motivo/.test(Object.keys(depois.linhas[0]).join()), 'nenhum motivo interno, nenhum autor (quem) e nenhuma coluna de motivo/autor chega ao público')
ok(!textoPublico.includes('Fulano') && !textoPublico.includes('Sauro'), 'nenhum nome de atleta chega ao público')
ok(depois.linhas.length === 5 && ['Súmula confirmada', 'Correção confirmada', 'Jogo adiado', 'Jogo alterado', 'W.O.'].every(t => depois.linhas.some(l => l.o_que.startsWith(t))), 'o público vê os 5 tipos esportivos: confirmada, correção confirmada, adiado, alterado e W.O.')
ok(!depois.linhas.some(l => /^(Súmula reaberta|Evento desfeito|Suspensão)/.test(l.o_que)), 'reabertura administrativa, evento desfeito e suspensão não aparecem')
ok(depois.tabela.n === antes.tabela.n && depois.tabela.soma === antes.tabela.soma, `a tabela historico NÃO mudou: ${depois.tabela.n} registros, mesma soma de verificação (${depois.tabela.soma.slice(0, 10)}…)`)
ok(sec.length === depois.tabela.n && sec.every(l => l.quem === 'Ana Souza (secretaria)') && sec.filter(l => l.motivo).length === 5, 'a Secretaria continua lendo TODOS os registros, com autor e motivo')
ok(depois.privs === 'anon=SELECT authenticated=SELECT', `permissões da nova view: ${depois.privs} (só leitura; sem TRUNCATE, REFERENCES, TRIGGER, INSERT, UPDATE, DELETE)`)
ok(depois.dono === antes.dono, `dono preservado: ${depois.dono}`)
await db.exec('set role anon')
let negado = false; try { await db.query(`select motivo from historico`) } catch (e) { negado = /permission denied/.test(e.message) }
let escreve = false; try { await db.query(`insert into historico_publico (jogo_id, o_que) values (null, 'x')`); escreve = true } catch { escreve = false }
await db.exec('reset role')
ok(negado, 'visitante continua sem acesso à tabela historico')
ok(!escreve, 'visitante não consegue escrever na view')

// DESFAZER: executa o texto do próprio arquivo (as linhas "--   ..." depois de "COMO DESFAZER")
const texto = ler(ARQ), pos = texto.indexOf('-- COMO DESFAZER')
const rollback = texto.slice(pos).split('\n').slice(1).filter(l => l.startsWith('--')).map(l => l.replace(/^--\s*/, '')).join('\n')
console.log('\n5) DESFAZER — executando o roteiro exatamente como está no arquivo:\n     ' + rollback.replace(/\n/g, '\n     '))
await db.exec(rollback)
const revertido = await fotografar()
ok(JSON.stringify(revertido.linhas) === JSON.stringify(antes.linhas), 'depois de desfazer, o público vê EXATAMENTE o mesmo que antes (inclusive quem e motivo)')
ok(revertido.cols === antes.cols && revertido.privs === antes.privs && revertido.acl === antes.acl && revertido.dono === antes.dono, 'depois de desfazer: colunas, permissões, ACL e dono idênticos aos de antes')
ok(revertido.def === antes.def, 'depois de desfazer: a definição da view é idêntica à original')
ok(revertido.tabela.soma === antes.tabela.soma && revertido.tabela.n === antes.tabela.n, 'a tabela historico continua intacta depois de desfazer')
await db.exec(ler(ARQ))
const reaplicado = await fotografar()
ok(JSON.stringify(reaplicado.linhas) === JSON.stringify(depois.linhas) && reaplicado.acl === depois.acl && reaplicado.def === depois.def, 'reaplicar a migration depois de desfazer funciona e dá o mesmo resultado')
console.log(falhas ? `\n${falhas} verificações falharam` : '\nok: migration, permissões, não-alteração dos dados e reversão verificadas')
process.exit(falhas ? 1 : 0)
