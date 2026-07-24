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


## Ocupação volumétrica e filtros (20260724-5)

O cálculo principal agora é:

`SUM(Volume occupied) ÷ SUM(Volume limit(cm3)) × 100`

Regras:
- Somente zonas A, B, HV e HS.
- A zona HS já está preparada e aparece como "sem dados" enquanto não existir na base.
- O seletor permite "Visão geral · Todas as zonas" ou uma zona específica.
- Na visão geral, as ruas são identificadas por zona para evitar misturar ruas com o mesmo número.
- O Heat Map possui botão de tela cheia.


## Layout moderno e análise por rua (20260724-6)

Novidades:
- Sidebar moderna.
- Cards e filtros redesenhados.
- Janela exclusiva **Análise por rua**.
- Filtros por zona, rua e pesquisa de posição.
- Visualização em grade e tabela.
- Resumo da rua com ocupação, volumes e quantidade de posições.
- Mantém tela cheia, importação de Excel, visão geral e filtros por zona.

Observação:
O JSON atual é consolidado por rua e nível. A janela distribui visualmente as posições com base no total de cada nível. Para mostrar o valor exato de cada endereço individual, será necessária uma versão da API que também envie as linhas brutas das posições.


## Correção do volume (20260724-7)

Após validar a planilha real, foi identificado que:
- `Volume limit(cm3)` está em cm³.
- `Volume occupied` está em m³/CBM.

O sistema agora converte:

`Volume occupied × 1.000.000`

antes de calcular:

`Ocupação = Volume occupied em cm³ ÷ Volume limit(cm3) × 100`

Também:
- salva todas as posições individuais do Excel;
- a análise por rua mostra os endereços reais;
- corrige a identificação da fonte atual;
- corrige os textos do ranking.
