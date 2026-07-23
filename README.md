# BRFRS1 — Projeto completo recriado

## Arquivos principais
- `index.html`: abre o Heat Map.
- `heatmap.html`: painel gerencial leve.
- `3d.html`: visualização 3D separada.
- `data.json`: base local para o dashboard funcionar imediatamente.
- `config.js`: conexão opcional com o Google Sheets via Apps Script.
- `Code.gs`: código do Apps Script.

## Publicação no GitHub
Copie todo o conteúdo desta pasta para:

`C:\Users\SPXBR40986\Desktop\OCUPA-O-BRFRS1`

Depois execute dentro da pasta:

```cmd
git init
git branch -M main
git remote remove origin
git remote add origin https://github.com/jacksoncolares-hub/OCUPA-O-BRFRS1.git
git add .
git commit -m "Recria dashboard BRFRS1 completo"
git push -u origin main --force
```

Se `git remote remove origin` informar que o remote não existe, ignore e continue.

## Google Sheets
Publique o `Code.gs` como Web App e cole a URL terminada em `/exec` no arquivo `config.js`.
