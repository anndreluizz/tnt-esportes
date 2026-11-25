// node supabase/gera-candidatos.mjs lista-do-portal.txt > candidatos.sql
// Le a lista de alunos copiada do portal da escola (colunas separadas por tabulacao, ';' ou '|': Nome e Série) e escreve o SQL que carrega
// a lista PRIVADA da turma (tabela esc_candidatos). Cole o SQL no SQL Editor do Supabase. Resumo por turma vai para a tela (stderr).
import { readFileSync } from 'node:fs'

const MINUSCULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e'])
export const nomeBonito = s => s.toLowerCase().split(/\s+/).filter(Boolean).map((p, i) => i && MINUSCULAS.has(p) ? p : p[0].toUpperCase() + p.slice(1)).join(' ')

// '1º ANO 02 MAT 2026' -> '1º ano 02' | '7º ANO VESP 2026' -> '7º ano' | '6º ETAPA / 7º ANO - EJAI NOTURNO' -> '6ª etapa / 7º ano - EJAI'
export function origemDaSerie(t) {
  const e = t.match(/(\d)\s*[ºª°]?\s*ETAPA.*EJAI/i)
  if (e) return e[1] === '6' ? '6ª etapa / 7º ano - EJAI' : e[1] === '8' ? '8ª etapa / 9º ano - EJAI' : null
  const m = t.match(/(\d)\s*[ºª°]\s*ANO(?:\s+(\d{2})\b)?/i)
  return m ? `${m[1]}º ano${m[2] ? ' ' + m[2] : ''}` : null
}

export function lerLista(texto) {
  const out = [], vistos = new Set()
  for (const linha of texto.split(/\r?\n/)) {
    const cel = linha.split(/\t|;|\|/).map(c => c.trim()).filter(Boolean)
    const serie = cel.map(origemDaSerie).find(Boolean)
    const nome = cel.find(c => /^[A-ZÀ-Ý][A-ZÀ-Ý'. -]+$/.test(c) && c.trim().split(/\s+/).length >= 2 && !/\b(ANO|ETAPA|MAT|VESP|NOTURNO)\b/.test(c))
    if (!serie || !nome) continue
    const k = serie + '|' + nome; if (vistos.has(k)) continue
    vistos.add(k); out.push({origem: serie, nome: nomeBonito(nome)})
  }
  return out
}

export const paraSql = lista => `insert into esc_candidatos (campeonato_id, origem, nome)
select (select id from esc_campeonatos order by inicio desc limit 1), v.origem, v.nome from (values
${lista.map(x => `  ('${x.origem.replace(/'/g, "''")}', '${x.nome.replace(/'/g, "''")}')`).join(',\n')}
) v(origem, nome) on conflict do nothing;`

if (process.argv[1]?.endsWith('gera-candidatos.mjs') && process.argv[2]) {
  const lista = lerLista(readFileSync(process.argv[2], 'utf8')), por = {}
  lista.forEach(x => por[x.origem] = (por[x.origem] || 0) + 1)
  console.error(`${lista.length} alunos em ${Object.keys(por).length} turmas:`, por)
  console.log(paraSql(lista))
}
