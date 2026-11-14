// Gerador determinístico de volume para os testes locais (PGlite). Não usa rede, nem Supabase, nem chave nenhuma.
//   16 equipes, 300 atletas (15 menores), 120 jogos de pontos corridos, mais de 1.200 eventos.
// Os dados entram pelos mesmos caminhos do app (atleta pela Secretaria, evento e súmula pelo árbitro), então as regras reais do banco rodam
// durante a carga: atleta sem aprovação, suspensão por cartão, assinatura faltando etc. seriam recusados.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'

export const uid = (tipo, n) => `${tipo.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
export const SEC = uid(1, 1), ARB = uid(1, 2), REP = uid(1, 3)   // Secretaria, árbitro, representante da equipe 1
export const CAMP = uid(2, 1)
const rng = (s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(20261114)
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const migrations = new URL('migrations/', import.meta.url)

// Postgres local com o que o Supabase já traz (schema auth, auth.uid(), papéis anon/authenticated) e um storage mínimo.
// A migration de limpeza de RG fica de fora: precisa de pg_cron, pg_net e Vault, e tem a URL da produção escrita.
export async function criaBanco() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language plpgsql as $$ declare p text[]; begin p := string_to_array(name, '/'); return p[1:array_length(p, 1) - 1]; end $$;
    grant usage on schema storage to anon, authenticated; grant select on storage.buckets to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated`)
  for (const f of readdirSync(migrations).sort().filter(f => !f.includes('_storage_limpeza'))) await db.exec(readFileSync(new URL(f, migrations), 'utf8'))
  return db
}
export const como = (db, uid) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`)
export const dono = db => db.exec('reset role')
export const q = async (db, sql, p) => (await db.query(sql, p)).rows

const NOMES = ['Joao', 'Pedro', 'Lucas', 'Mateus', 'Rafael', 'Gabriel', 'Daniel', 'Carlos', 'Paulo', 'Andre', 'Diego', 'Felipe', 'Bruno', 'Thiago', 'Marcos', 'Igor', 'Caio', 'Davi', 'Samuel', 'Enzo']
const SOBRE = ['Silva', 'Souza', 'Lima', 'Costa', 'Santos', 'Pereira', 'Alves', 'Ribeiro', 'Gomes', 'Barros', 'Rocha', 'Moura', 'Dias', 'Cardoso', 'Nunes', 'Freitas', 'Melo', 'Araujo', 'Cruz', 'Teixeira']
export const ASSIN = { arbitro: 'j/arbitro.png', mandante: 'j/mandante.png', visitante: 'j/visitante.png' }
const TIPOS = ['gol', 'falta', 'amarelo', 'gol', 'falta', 'gol', 'falta', 'amarelo', 'gol', 'falta', 'gol']

// Todos contra todos (método do círculo): 15 rodadas de 8 jogos para 16 equipes.
export function todosContraTodos(ids) {
  const t = [...ids], n = t.length, rodadas = []
  for (let r = 0; r < n - 1; r++) {
    const par = []
    for (let i = 0; i < n / 2; i++) par.push(r % 2 ? [t[n - 1 - i], t[i]] : [t[i], t[n - 1 - i]])
    rodadas.push(par); t.splice(1, 0, t.pop())
  }
  return rodadas
}

// Carga completa: rodadas 1 a 14 jogadas e confirmadas (112 jogos); a rodada 15 (8 jogos) fica agendada para os testes de W.O. e suspensão.
export async function semeia(db) {
  await dono(db)
  await db.exec(`insert into auth.users values ('${SEC}', 'secretaria@teste.local'), ('${ARB}', 'arbitro@teste.local'), ('${REP}', 'equipe1@teste.local')`)
  await db.exec(`insert into perfis (id, nome, papel) values ('${SEC}', 'Secretaria Teste', 'secretaria'), ('${ARB}', 'Arbitro Teste', 'arbitro')`)
  await db.query(`insert into campeonatos (id, nome, modalidade, idade_min, inicio, formato, status) values ($1, 'Copa Volume Pontos Corridos', 'Futsal', 15, '2026-12-01', 'pontos', 'andamento')`, [CAMP])
  const eq = [], at = {}, nomeEq = {}
  for (let i = 1; i <= 16; i++) {
    const id = uid(3, i); eq.push(id); nomeEq[id] = 'Equipe ' + String(i).padStart(2, '0')
    await db.query(`insert into equipes (id, campeonato_id, nome, bairro, grupo, link_token) values ($1, $2, $3, $4, 'A', $5)`, [id, CAMP, nomeEq[id], 'Bairro ' + i, uid(7, i)])
  }
  await db.exec(`insert into perfis (id, nome, papel, equipe_id) values ('${REP}', 'Representante 1', 'equipe', '${eq[0]}')`)
  // atletas: a Secretaria cadastra e aprova (o banco zera a aprovação de quem não é Secretaria). 12 equipes com 19 e 4 com 18 = 300.
  await como(db, SEC)
  const menores = []; let n = 0
  for (let i = 0; i < 16; i++) {
    at[eq[i]] = []
    for (let k = 1; k <= (i < 12 ? 19 : 18); k++, n++) {
      const id = uid(4, n + 1), menor = k === 1 && i < 15, nome = `${NOMES[n % 20]} ${NOMES[(n * 7 + 3) % 20]} ${SOBRE[(n * 3) % 20]} ${SOBRE[(n * 11 + 5) % 20]}`
      const nasc = menor ? `2010-0${1 + n % 9}-1${n % 9}` : `${1985 + Math.floor(rng() * 20)}-0${1 + Math.floor(rng() * 9)}-1${Math.floor(rng() * 9)}`
      await db.query(`insert into atletas (id, equipe_id, nome, numero, nascimento, bairro, autorizacao, aprovado, consentimento, foto_path) values ($1, $2, $3, $4, $5, 'Centro', true, true, true, $6)`,
        [id, eq[i], nome, k, nasc, `${eq[i]}/${id}.jpg`])
      at[eq[i]].push(id); if (menor) menores.push(id)
    }
  }
  await dono(db)
  // jogos: uma rodada por semana, árbitro único
  const rodadas = todosContraTodos(eq), jogos = []; let g = 0
  for (let r = 0; r < rodadas.length; r++) for (const [m, v] of rodadas[r]) {
    const id = uid(5, ++g); jogos.push({ id, n: g, rodada: r + 1, m, v, data: addDays('2026-12-01', 7 * r), hora: g % 2 ? '19h00' : '20h00' })
    await db.query(`insert into jogos (id, campeonato_id, fase, rodada, grupo, mandante_id, visitante_id, data, hora, arbitro_id) values ($1, $2, 'grupos', $3, 'A', $4, $5, $6, $7, $8)`,
      [id, CAMP, r + 1, m, v, addDays('2026-12-01', 7 * r), g % 2 ? '19h00' : '20h00', ARB])
  }
  // súmulas das rodadas 1 a 14, como o árbitro (as regras de evento e de confirmação rodam de verdade)
  await como(db, ARB)
  const amarelos = {}, ponteiro = {}; let eventos = 0; const vermelhos = []
  for (const j of jogos.filter(j => j.rodada <= 14)) {
    const k0 = j.rodada * 100 + (j.n % 7), ne = 10 + (j.n % 3)
    for (let k = 0; k < ne; k++) {
      const tipo = TIPOS[(k + k0) % TIPOS.length], eqp = k % 2 ? j.m : j.v, pool = at[eqp]
      let atleta = null
      if (tipo === 'gol') atleta = pool[Math.floor(rng() * 10)]   // artilheiros concentrados nos 10 primeiros
      else if (tipo === 'amarelo') {                               // no máximo 2 amarelos por atleta (o 3º suspenderia)
        do { ponteiro[eqp] = ((ponteiro[eqp] ?? -1) + 1) % pool.length } while ((amarelos[pool[ponteiro[eqp]]] ?? 0) >= 2)
        atleta = pool[ponteiro[eqp]]; amarelos[atleta] = (amarelos[atleta] ?? 0) + 1
      }
      await db.query(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, $3, $4, $5, $6, $7)`,
        [uid(6, ++eventos), j.id, tipo, eqp, atleta, (k * 4) % 40, 1 + k % 2])
    }
    if (j.rodada === 14 && vermelhos.length < 3 && j.n % 2) {   // 3 vermelhos na rodada 14: suspensos na rodada 15
      const a = at[j.m][15]
      await db.query(`insert into eventos (id, jogo_id, tipo, equipe_id, atleta_id, minuto, tempo) values ($1, $2, 'vermelho', $3, $4, 33, 2)`, [uid(6, ++eventos), j.id, j.m, a])
      vermelhos.push({ atleta: a, equipe: j.m })
    }
    await db.query(`select confirmar_sumula($1, null, null, $2, $3)`, [j.id, j.n % 5 === 0 ? 'OBSERVACAO INTERNA do árbitro' : 'Jogo normal', ASSIN])
    j.encerrado = true
  }
  await dono(db)
  return { eq, at, nomeEq, jogos, menores, vermelhos, eventos, total: { equipes: eq.length, atletas: n, jogos: jogos.length } }
}
