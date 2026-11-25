// node supabase/testar-candidatos.mjs — confere o leitor da lista do portal (gera-candidatos.mjs)
import { lerLista, paraSql } from './gera-candidatos.mjs'
const amostra = [
  '6456\tAL2026104383\tADRIA AYALA XAVIER DE SOUZA\t4º ANO 02 MAT 2026\tMATUTINO\t2026',
  '4615\tAL2026103445\tADRIAN COELHO GARCIA\t8º ANO 01 VESP 2026\tVESPERTINO',
  '2419;AL2026102750;ADRIANO MACARIO ALVARES;6º ANO 01 VESP 2026',
  "1;AL1;JOAO D'ARC DOS SANTOS;7º ANO VESP 2026",
  '2;AL2;MARIA DA SILVA;6º ETAPA / 7º ANO - EJAI NOTURNO',
  '3;AL3;MARIA DA SILVA;6º ETAPA / 7º ANO - EJAI NOTURNO',
  'Idade x série: Correto'].join('\n')
const l = lerLista(amostra), ok = (c, t) => { if (!c) { console.error('FALHOU:', t); process.exit(1) } }
ok(l.length === 5, 'linhas válidas, sem duplicada e sem lixo: ' + l.length)
ok(l[0].nome === 'Adria Ayala Xavier de Souza' && l[0].origem === '4º ano 02', 'nome bonito e turma 4º ano 02')
ok(l[1].origem === '8º ano 01' && l[2].origem === '6º ano 01', 'turmas do 8º e do 6º ano')
ok(l[3].origem === '7º ano' && l[3].nome.includes("D'arc"), '7º ano sem número de turma; apóstrofo')
ok(l[4].origem === '6ª etapa / 7º ano - EJAI', 'EJAI')
ok(paraSql(l).includes("'Joao D''arc Dos Santos'") === false && paraSql(l).includes("D''arc"), 'SQL escapa apóstrofo')
console.log('ok: leitor da lista do portal')
