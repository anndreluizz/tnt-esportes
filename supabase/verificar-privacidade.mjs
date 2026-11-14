// node supabase/verificar-privacidade.mjs
// Testa o portal público PELA API, como um visitante sem login (só a chave pública, a mesma do site).
// Só faz leituras. Não imprime dados pessoais: mostra apenas "apareceu" ou "não apareceu".
import { readFileSync } from 'node:fs'
const cfg = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8')
const URL_ = /SUPABASE_URL\s*=\s*['"]([^'"]+)/.exec(cfg)[1], KEY = /SUPABASE_KEY\s*=\s*['"]([^'"]+)/.exec(cfg)[1]
const get = async (caminho) => {
  const r = await fetch(URL_ + '/rest/v1/' + caminho, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
  let corpo = null; try { corpo = await r.json() } catch {}
  return { status: r.status, corpo }
}
let falhas = 0
const ok = (cond, msg) => { console.log((cond ? '  ok      ' : '  FALHOU  ') + msg); if (!cond) falhas++ }
const negado = r => r.status === 401 || r.status === 403   // sem permissão (o PostgREST responde 401 ou 403)

console.log('Dados sensíveis NÃO podem aparecer para o público:')
let r = await get('campeonatos?select=responsavel_telefone&limit=5')
ok(negado(r) || !(r.corpo || []).some(x => x.responsavel_telefone), 'telefone do responsável do campeonato (tabela campeonatos)')
r = await get('jogos?select=observacoes,assinaturas&limit=5')
ok(negado(r), 'observações e assinaturas das súmulas (tabela jogos)')
r = await get('campeonatos?select=*&limit=1')
ok(negado(r), 'tabela campeonatos inteira')
r = await get('jogos?select=*&limit=1')
ok(negado(r), 'tabela jogos inteira')
r = await get('atletas?select=nascimento&limit=1')
ok(negado(r), 'data de nascimento dos atletas')
r = await get('equipes?select=codigo,link_token&limit=1')
ok(negado(r), 'código e link de acesso das equipes')

console.log('O portal público continua funcionando:')
r = await get('campeonatos_publico?select=*&limit=5')
ok(r.status === 200 && Array.isArray(r.corpo), 'campeonatos_publico responde')
ok(r.status === 200 && !(r.corpo || []).some(x => 'responsavel_telefone' in x), 'campeonatos_publico não tem o telefone')
r = await get('jogos_publico?select=*&limit=5')
ok(r.status === 200 && Array.isArray(r.corpo), 'jogos_publico responde')
ok(r.status === 200 && !(r.corpo || []).some(x => 'observacoes' in x || 'assinaturas' in x), 'jogos_publico não tem observações nem assinaturas')
for (const v of ['classificacao', 'placar', 'equipes_publico', 'atletas_publico', 'sorteios_publico']) {
  r = await get(v + '?select=*&limit=1'); ok(r.status === 200, v + ' responde')
}
r = await fetch(URL_ + '/rest/v1/rpc/conferir_sumula', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: 'abcdef12' }) })
ok(r.status === 200, 'conferência pública de súmula (conferir_sumula) responde')

console.log(falhas ? `\n${falhas} verificações falharam` : '\nok: o público só vê o que foi autorizado')
process.exit(falhas ? 1 : 0)
