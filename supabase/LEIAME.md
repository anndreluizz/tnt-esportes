# Banco de dados do TNT Esportes (Supabase)

## Testar no computador
```
cd supabase
npm install
npm test
```
Roda o banco num Postgres de verdade (PGlite) e tenta o uso certo e o indevido com cada perfil.

## Colocar no ar
1. Crie um projeto em https://supabase.com, região **São Paulo (sa-east-1)**.
2. No painel, abra **SQL Editor** e rode, nesta ordem:
   - `migrations/20261106000000_inicial.sql`
   - `migrations/20261106000100_storage.sql`
3. Crie a primeira conta da Secretaria em **Authentication → Users → Add user**. Depois, no SQL Editor:
   ```sql
   insert into perfis (id, nome, papel)
   select id, 'Ana Souza', 'secretaria' from auth.users where email = 'email-da-secretaria@exemplo.com';
   ```
4. Árbitros entram do mesmo jeito, com `papel = 'arbitro'`. As equipes não precisam disso: o representante cria a conta e informa o código da equipe (função `vincular_equipe`).

## Quem pode o quê
| Perfil | Pode |
|---|---|
| Público (sem login) | Ver campeonatos, jogos, eventos, classificação, atletas aprovados (só nome e número), histórico dos jogos e o sorteio. Conferir uma súmula pelo código. |
| Equipe | Ver o próprio elenco e inscrever atletas (entram "em análise"). |
| Árbitro | Registrar e desfazer eventos e confirmar a súmula dos jogos em que está escalado. |
| Secretaria | Todo o resto. Mudanças de resultado (reabrir, W.O., adiar) só com motivo, e ficam no histórico. |

As regras ficam no banco, não no app: mesmo alguém mexendo no navegador não consegue burlá-las.
