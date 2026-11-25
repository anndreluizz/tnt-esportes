// cd supabase && node testar-turmas.mjs
// Testa as tabelas esc_* (campeonato por turma) num Postgres de verdade (PGlite), com Secretaria e publico.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language plpgsql as $$ declare partes text[]; begin partes := string_to_array(name, '/'); return partes[1:array_length(partes, 1) - 1]; end $$;
  grant usage on schema storage to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated`)
for (const f of readdirSync(new URL('migrations', import.meta.url)).sort().filter(f => !f.includes('_storage_limpeza')))
  await db.exec(readFileSync(new URL('migrations/' + f, import.meta.url), 'utf8'))

let falhas = 0, total = 0
const ok = (c, m) => { total++; if (!c) { falhas++; console.error('  FALHOU:', m) } }
const como = (uid) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`)
const q = async (s, p) => (await db.query(s, p)).rows
const erro = async (s, p, trecho, m) => { try { await db.query(s, p); ok(false, m + ' (deveria dar erro)') } catch (e) { ok(e.message.includes(trecho), `${m}: "${e.message}"`) } }

const SEC = randomUUID(), OUTRO = randomUUID()
await db.exec('reset role')
await db.query('insert into auth.users values ($1), ($2)', [SEC, OUTRO])
await db.query(`insert into perfis (id, nome, papel) values ($1, 'Ana Souza', 'secretaria')`, [SEC])

await como(SEC)
const [{ id: C }] = await q(`insert into esc_campeonatos (nome, inicio, fim, local) values ('Interclasse 2026', '2026-12-07', '2026-12-09', 'Quadra da escola') returning id`)
const [{ id: FUT }] = await q(`insert into esc_modalidades (campeonato_id, nome) values ($1, 'Futsal') returning id`, [C])
const [{ id: QUE }] = await q(`insert into esc_modalidades (campeonato_id, nome, jogadores_por_time, tempo_min) values ($1, 'Queimada', 6, 15) returning id`, [C])
const turma = async n => (await q(`insert into esc_turmas (campeonato_id, nome) values ($1, $2) returning id`, [C, n]))[0].id
const T1 = await turma('1º ano 1'), T2 = await turma('1º ano 2'), T3 = await turma('2º ano 2')
const time = async (t, mod, g, n) => (await q(`insert into esc_times (campeonato_id, turma_id, modalidade_id, genero, nome) values ($1,$2,$3,$4,$5) returning id`, [C, t, mod, g, n]))[0].id

console.log('Cadastro')
const a = await time(T1, FUT, 'masculino', 'Time A'), b = await time(T1, FUT, 'masculino', 'Time B')
await time(T1, FUT, 'feminino', 'Time A'); await time(T1, QUE, 'masculino', 'Time A')   // mesmo turma, outra modalidade/genero: livre
await time(T1, FUT, 'masculino', 'Time C'); await time(T1, FUT, 'masculino', 'Time D')
ok((await q(`select count(*)::int n from esc_times where turma_id=$1 and modalidade_id=$2 and genero='masculino'`, [T1, FUT]))[0].n === 4, 'turma pode ter mais de 2 times')
await time(T2, FUT, 'masculino', 'Time A')   // turma com 1 time: aceita
ok((await q(`select count(*)::int n from esc_times where turma_id = $1`, [T3]))[0].n === 0, 'turma com 0 times é aceita')
await erro(`insert into esc_turmas (campeonato_id, nome) values ($1, '1º ano 1')`, [C], 'duplicate', 'nome de turma repetido no campeonato')
await erro(`insert into esc_campeonatos (nome, inicio, fim) values ('Campeonato X', '2026-12-09', '2026-12-07')`, [], 'check', 'fim antes do início')
const [{ id: C2 }] = await q(`insert into esc_campeonatos (nome, inicio, fim) values ('Outro evento', '2026-12-07', '2026-12-09') returning id`)
await erro(`insert into esc_times (campeonato_id, turma_id, modalidade_id, genero, nome) values ($1,$2,$3,'masculino','Time Z')`, [C2, T1, FUT], 'campeonatos diferentes', 'time com turma de outro campeonato')

console.log('Partidas')
const partida = async (t, m, g, x, y, pa, pb) => (await q(`insert into esc_partidas (turma_id, modalidade_id, genero, time_a_id, time_b_id, placar_a, placar_b) values ($1,$2,$3,$4,$5,$6,$7) returning id, vencedor_id`, [t, m, g, x, y, pa, pb]))[0]
const fem = (await q(`select id from esc_times where turma_id=$1 and genero='feminino'`, [T1]))[0].id
const que = (await q(`select id from esc_times where turma_id=$1 and modalidade_id=$2`, [T1, QUE]))[0].id
const outraTurma = (await q(`select id from esc_times where turma_id=$1`, [T2]))[0].id
await erro(`insert into esc_partidas (turma_id, modalidade_id, genero, time_a_id, time_b_id) values ($1,$2,'masculino',$3,$4)`, [T1, FUT, a, fem], 'foreign key', 'partida masculino x feminino')
await erro(`insert into esc_partidas (turma_id, modalidade_id, genero, time_a_id, time_b_id) values ($1,$2,'masculino',$3,$4)`, [T1, FUT, a, que], 'foreign key', 'partida entre modalidades diferentes')
await erro(`insert into esc_partidas (turma_id, modalidade_id, genero, time_a_id, time_b_id) values ($1,$2,'masculino',$3,$4)`, [T1, FUT, a, outraTurma], 'foreign key', 'partida entre turmas diferentes')
await erro(`insert into esc_partidas (turma_id, modalidade_id, genero, time_a_id, time_b_id) values ($1,$2,'masculino',$3,$3)`, [T1, FUT, a], 'check', 'time contra ele mesmo')
const p = await partida(T1, FUT, 'masculino', a, b, null, null)
ok(p.vencedor_id === null, 'partida sem placar: sem vencedor')
ok((await q(`select count(*)::int n from esc_campeoes_turma($1)`, [C]))[0].n === 0, 'sem resultado: sem campeão')
await erro(`insert into esc_partidas (turma_id, modalidade_id, genero, time_a_id, time_b_id) values ($1,$2,'masculino',$3,$4)`, [T1, FUT, b, a], 'duplicate', 'mesmo confronto invertido')
ok((await q(`update esc_partidas set placar_a = 2, placar_b = 2 where id = $1 returning vencedor_id`, [p.id]))[0].vencedor_id === null, 'empate sem penaltis: ainda sem vencedor')
ok((await q(`update esc_partidas set penaltis_a = 4, penaltis_b = 3 where id = $1 returning vencedor_id`, [p.id]))[0].vencedor_id === a, 'empate decidido nos penaltis: vence A')
await erro(`update esc_partidas set penaltis_a = 3, penaltis_b = 3 where id = $1`, [p.id], 'check', 'penaltis empatados')
await erro(`update esc_partidas set placar_a = 1, placar_b = 2 where id = $1`, [p.id], 'check', 'penaltis com placar sem empate')
ok((await q(`update esc_partidas set penaltis_a = null, penaltis_b = null, placar_a = 1, placar_b = 3 where id = $1 returning vencedor_id`, [p.id]))[0].vencedor_id === b, 'vencedor = time B')
await erro(`update esc_partidas set placar_a = null where id = $1`, [p.id], 'check', 'placar pela metade')
await erro(`update esc_partidas set colete_a = 'verde' where id = $1`, [p.id], 'check', 'colete so azul ou vermelho')
await erro(`insert into esc_partidas (turma_id, modalidade_id, genero, time_a_id, time_b_id) values ($1,$2,'masculino',$3,$4)`, [T1, FUT, b, a], 'duplicate', 'mesmo confronto invertido na mesma fase')

console.log('Campeão da turma')
const camp = await q(`select * from esc_campeoes_turma($1)`, [C])
ok(camp.length === 1 && camp[0].campeao_id === b && camp[0].turma_id === T1 && camp[0].genero === 'masculino', 'campeão = vencedor da final')
ok((await q(`select count(*)::int n from esc_titulo_turma($1)`, [C]))[0].n === 1, 'título da turma (regra pendente) devolve os campeões por gênero')

console.log('Elenco e link do professor')
const links = await q(`select time_id, token from esc_links_times($1)`, [C])
const tokA = links.find(l => l.time_id === a).token, tokB = links.find(l => l.time_id === b).token
await como(null)
await erro(`select token from esc_times`, [], 'permission', 'público não lê o token do time')
await erro(`select * from esc_links_times($1)`, [C], 'permission', 'público não lista os links')
const meu = (await q(`select * from esc_meu_time($1)`, [tokA]))[0]
ok(meu.time_nome === 'Time A' && meu.vagas === 10 && meu.inscricoes_abertas, 'professor vê o time pelo link (5 + 5 reservas)')
ok((await q(`select count(*)::int n from esc_meu_time($1)`, [randomUUID()]))[0].n === 0, 'link inventado não acha time')
let ids = []
for (let i = 1; i <= 10; i++) ids.push(await q(`select esc_inscrever_jogador($1, $2) id`, [tokA, `Aluno ${i}`]).then(r => r[0].id))
await erro(`select esc_inscrever_jogador($1, 'Aluno 11')`, [tokA], 'elenco cheio', '11º jogador (limite titulares + reservas)')
await erro(`select esc_inscrever_jogador($1, 'Intruso')`, [randomUUID()], 'link invalido', 'inscrever com link inventado')
await erro(`select esc_remover_jogador($1, $2)`, [tokB, ids[0]], 'link invalido', 'link do time B não remove jogador do time A')
await q(`select esc_remover_jogador($1, $2)`, [tokA, ids[0]])
ok((await q(`select count(*)::int n from esc_jogadores where time_id = $1`, [a]))[0].n === 9, 'professor remove jogador do próprio time')
await erro(`select esc_inscrever_jogador($1, 'aluno 2')`, [tokA], 'duplicate', 'mesmo nome (maiúsculas diferentes) duas vezes no time')
await erro(`insert into esc_jogadores (time_id, nome) values ($1, 'Direto')`, [a], 'permission', 'público não escreve direto no elenco')
// professor responsável: preenche pelo link; só a Secretaria e o dono do link veem o nome
await q(`select esc_definir_professor($1, '  Maria   da Silva ')`, [tokA])
ok((await q(`select professor from esc_meu_time($1)`, [tokA]))[0].professor === 'Maria da Silva', 'professor preenche o próprio nome (espaços limpos)')
ok((await q(`select professor from esc_meu_time($1)`, [tokB]))[0].professor === null, 'o outro time não é afetado')
await erro(`select esc_definir_professor($1, 'Ze')`, [tokA], 'check', 'nome curto demais')
await erro(`select esc_definir_professor($1, 'Intruso')`, [randomUUID()], 'link invalido', 'preencher com link inventado')
await erro(`select professor from esc_times`, [], 'permission', 'público não lê o nome do professor')
await como(SEC)
ok((await q(`select professor from esc_links_times($1) where time_id = $2`, [C, a]))[0].professor === 'Maria da Silva', 'Secretaria vê o professor de cada time')
await como(null)
await como(SEC)
await q(`update esc_campeonatos set inscricoes_abertas = false where id = $1`, [C])
await como(null)
await erro(`select esc_inscrever_jogador($1, 'Tardio')`, [tokA], 'inscricoes encerradas', 'inscrição encerrada')
await erro(`select esc_remover_jogador($1, $2)`, [tokA, ids[1]], 'inscricoes encerradas', 'remoção após encerrar')

console.log('Juiz (link único)')
await como(SEC)
const tokJ = (await q(`select esc_juiz_link($1) t`, [C]))[0].t
ok((await q(`select esc_juiz_link($1) t`, [C]))[0].t === tokJ, 'o link do juiz é estável')
await como(null)
await erro(`select esc_juiz_link($1)`, [C], 'permission', 'público não pega o link do juiz')
await erro(`select token from esc_juiz`, [], 'permission', 'público não lê a tabela do juiz')
const pj = (await q(`select id from esc_partidas where turma_id = $1 limit 1`, [T1]))[0].id
await erro(`select esc_juiz_placar($1, $2, 1, 0, null, null)`, [randomUUID(), pj], 'link invalido', 'link de juiz inventado')
await q(`select esc_juiz_placar($1, $2, 2, 2, 4, 3)`, [tokJ, pj])
const pr = (await q(`select placar_a, penaltis_a, vencedor_id from esc_partidas where id = $1`, [pj]))[0]
ok(pr.placar_a === 2 && pr.penaltis_a === 4 && pr.vencedor_id, 'juiz lança placar e pênaltis; o vencedor sai do banco')
await erro(`select esc_juiz_placar($1, $2, 2, 1, 4, 3)`, [tokJ, pj], 'check', 'pênaltis sem empate')
await q(`select esc_juiz_placar($1, $2, null, null, null, null)`, [tokJ, pj])
ok((await q(`select placar_a from esc_partidas where id = $1`, [pj]))[0].placar_a === null, 'juiz limpa o resultado')

console.log('Permissões')
await como(null)
ok((await q(`select count(*)::int n from esc_turmas`))[0].n === 3, 'público lê as turmas')
await erro(`insert into esc_turmas (campeonato_id, nome) values ($1, 'Invasora')`, [C], 'permission', 'público não escreve')
await como(OUTRO)
await erro(`insert into esc_turmas (campeonato_id, nome) values ($1, 'Invasora')`, [C], 'row-level security', 'usuário sem papel não escreve')
await erro(`select esc_time_antes_gravar()`, [], 'permission', 'função de gatilho não é chamável')

console.log(falhas ? `\n${falhas} de ${total} verificações falharam` : `\nTudo certo: ${total} verificações`)
process.exit(falhas ? 1 : 0)
