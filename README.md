# BRFRS1 Occupancy Center — Google Sheets + Importação Manual de Excel

## Fontes de dados
1. Google Sheets via Apps Script: atualização automática.
2. Excel manual: botão **Importar Excel** no Heat Map e no Mapa 3D.

## Configuração
Abra `config.js` e cole a URL do Apps Script terminada em `/exec`.

## Importação manual
- Aceita `.xlsx`, `.xls`, `.xlsm` e `.csv`.
- Procura automaticamente a aba que contém a coluna de localização.
- Reconhece cabeçalhos como `Location ID`, `Location`, `Endereço`, `Status`, `Qty`, `Quantity` e equivalentes.
- Consolida os dados no navegador.
- Salva somente o JSON consolidado no IndexedDB do navegador.
- O arquivo original não é enviado ao GitHub.
- Para voltar à fonte automática, abra **Importar Excel** e clique em **Voltar ao Google Sheets**.

## Publicação
Substitua os arquivos do repositório e execute:

```cmd
git add .
git commit -m "Adiciona importação manual de Excel"
git push origin main
```

Depois abra o GitHub Pages e pressione `Ctrl + F5`.
