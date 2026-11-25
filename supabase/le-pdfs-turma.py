# python supabase/le-pdfs-turma.py "<pasta com os PDFs do diario de classe>" > lista-portal.txt
# Le os diarios de classe (um PDF por turma) exportados do portal e escreve "numero;NOME;serie" por linha, para gera-candidatos.mjs.
import re, subprocess, sys, glob, os
pasta = sys.argv[1]
for pdf in sorted(glob.glob(os.path.join(pasta, '*.pdf'))):
    txt = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', pdf, '-'], capture_output=True, text=True, encoding='utf-8').stdout
    serie = re.search(r'Serie/Turma:\s*(.+)', txt)
    serie = serie.group(1).strip() if serie else ''
    serie = re.split(r'\s{3,}', serie)[0]
    vistos = set()
    for linha in txt.splitlines():
        m = re.match(r"^\s*(\d{1,3})\s{1,4}([A-ZÀ-Ý][A-ZÀ-Ý' .-]+?)\s{2,}", linha)
        if m and m.group(2) not in vistos and len(m.group(2).split()) >= 2:
            vistos.add(m.group(2)); print(f'{m.group(1)};{m.group(2).strip()};{serie}')
    if not vistos:   # diario do EJAI: o nome vem numa linha acima de "N Etapa: ..."
        linhas = txt.splitlines()
        for i, linha in enumerate(linhas):
            n = re.match(r'^\s*(\d{1,3})\s+Etapa:', linha)
            if not n: continue
            for j in range(i - 1, max(i - 4, -1), -1):
                m = re.match(r"^\s{6,}([A-ZÀ-Ý][A-ZÀ-Ý' .-]+?)(\s{2,}.*)?$", linhas[j])
                if m and len(m.group(1).split()) >= 2 and not re.search(r'(ANO|ETAPA|EJAI|NOTURNO)', m.group(1)):
                    if m.group(1) not in vistos: vistos.add(m.group(1)); print(f'{n.group(1)};{m.group(1).strip()};{serie}')
                    break
    print(f'# {os.path.basename(pdf)}: {len(vistos)} alunos ({serie})', file=sys.stderr)
