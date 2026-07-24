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


## Correção desta versão (20260724-2)
- Adicionado versionamento nos arquivos CSS e JavaScript para evitar cache antigo do GitHub Pages.
- Corrigido o erro `WMS.useImportedData is not a function`.
- Adicionado CSS crítico para o modal não aparecer sem formatação durante o carregamento.
- Depois de publicar, use `Ctrl + F5` uma vez.


## Janela central de importação (20260724-3)
- O botão **Importar Excel** agora abre uma janela central nativa do navegador.
- O restante do dashboard fica escurecido.
- `Esc`, botão fechar e clique fora fecham a janela quando nenhuma importação está em andamento.
- A janela exibe fonte atual, última atualização, arquivo escolhido, progresso e resultado.


## Correção das ruas (20260724-4)
A planilha enviada utiliza o padrão:

`BRFRS1-ZONA-RUA-MÓDULO-NÍVEL-POSIÇÃO`

Exemplo: `BRFRS1-A-23-05-3-018`

Agora o sistema interpreta:
- Zona: `A`
- Rua: `23`
- Módulo: `05`
- Nível: `3`
- Posição: `018`

Também prioriza a coluna `Pathway ID` para identificar a rua.
