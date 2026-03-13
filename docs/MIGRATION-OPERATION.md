# Operação do script de migração Redis → Postgres

Processo sensível e pontual. Siga o checklist antes de executar em produção.

---

## Garantias do script

| Requisito | Implementação |
|-----------|----------------|
| **Idempotência** | Bulk insert com `ON CONFLICT (id) DO NOTHING`. Reexecução não duplica dados. |
| **Redis não bloqueante** | Uso de `SCAN` + cursor; **não usa `KEYS`**. |
| **Limites de conexão** | Pool Postgres com `PG_POOL_MAX`; delay entre lotes com `MIGRATION_BATCH_DELAY_MS`. |
| **Retry por lote** | Até `MIGRATION_MAX_RETRIES` com backoff exponencial. Lote que falha é registrado e o script segue. |
| **Logs estruturados** | Uma linha JSON por evento (stdout/stderr). |
| **Rastreabilidade** | Eventos: `read`, `inserted`, `skipped`, `failed` por lote e totais ao final. |

---

## Variáveis de ambiente

| Variável | Descrição | Default |
|----------|-----------|---------|
| `REDIS_HOST` | Host do Redis | `localhost` |
| `REDIS_PORT` | Porta do Redis | `6379` |
| `REDIS_KEY_PREFIX` | Prefixo das chaves para SCAN (ex: `token:`) | `token:` |
| `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` | Conexão Postgres | localhost, 5432, postgres, postgres, token_migration |
| `PG_POOL_MAX` | Máximo de conexões no pool Postgres | `5` |
| `MIGRATION_BATCH_SIZE` | Tamanho do lote (SCAN + bulk insert) | `100` |
| `MIGRATION_BATCH_DELAY_MS` | Delay em ms entre lotes (throughput) | `50` |
| `MIGRATION_MAX_RETRIES` | Tentativas por lote em caso de falha | `3` |
| `MIGRATION_RETRY_DELAY_MS` | Delay base para retry (backoff exponencial) | `1000` |
| **`MIGRATION_DRY_RUN`** | `true`: não escreve no Postgres | `false` |

---

## Checklist antes de rodar

- [ ] Redis e Postgres acessíveis (ex.: `docker compose up -d` e healthchecks ok).
- [ ] Variáveis de ambiente conferidas (conexões e, se quiser, batch size e delay).
- [ ] Execução em **dry-run** feita e logs conferidos:
  ```bash
  MIGRATION_DRY_RUN=true npm run migration
  ```
- [ ] Backup ou snapshot do Postgres (se produção), se aplicável.
- [ ] Janela de execução combinada (processo pontual e sensível).
- [ ] Espaço em disco e limites de conexão do ambiente suportam o volume esperado.

---

## Instruções de execução

### 1. Ambiente local (Docker) com dados de exemplo

```bash
# Subir Redis e Postgres
docker compose up -d

# Popular Redis com tokens de exemplo
npm run seed

# Validar sem escrever (dry-run)
MIGRATION_DRY_RUN=true npm run migration

# Executar migração de fato
npm run migration
```

### 2. Execução controlada (produção ou homologação)

- Definir envs (arquivo `.env` ou export no shell).
- Rodar **dry-run** primeiro:
  ```bash
  npm run migration:dry-run
  # ou com log em arquivo:
  MIGRATION_DRY_RUN=true npm run migration 2>&1 | tee migration-dry-run.log
  ```
- Analisar `migration-dry-run.log`: totais lidos e mensagens de erro.
- Rodar a migração real, salvando logs:
  ```bash
  npm run migration 2>&1 | tee migration-$(date +%Y%m%d-%H%M%S).log
  ```
- Ao final, o script imprime o resumo no stderr (lidos, inseridos, já existentes, falhas).

### 3. Reexecução (idempotente)

- Pode rodar de novo sem duplicar: tokens já presentes serão contados como "skipped".
- Útil para reprocessar após correção ou para pegar keys adicionadas depois.

---

## Dry-run

- Com `MIGRATION_DRY_RUN=true`:
  - O script **não** cria tabela nem escreve no Postgres.
  - Continua usando **SCAN** no Redis e processando em lotes.
  - Loga cada lote como `batch_dry_run` com total lido e total acumulado.
- Use para validar conectividade, prefixo, volume e logs sem alterar dados.

---

## Logs estruturados (exemplos)

```json
{"ts":"...","level":"info","event":"migration_start","dryRun":false,"keyPrefix":"token:","batchSize":100}
{"ts":"...","level":"info","event":"batch_complete","batch":1,"read":100,"inserted":100,"skipped":0,"totalRead":100,"totalMigrated":100,"totalSkipped":0}
{"ts":"...","level":"info","event":"migration_end","totalRead":500,"totalMigrated":500,"totalSkipped":0,"totalFailed":0,"totalBatches":5,"failedBatches":0}
```

Em caso de falha de lote:

```json
{"ts":"...","level":"error","event":"batch_failed","batch":3,"read":100,"error":"...","failedTokenIds":["tok_201",...]}
```

---

## Resumo de execução

Ao terminar, o script imprime no stderr:

- **Lidos (Redis):** total de tokens lidos via SCAN.
- **Inseridos (PG):** registros novos inseridos.
- **Já existentes:** registros ignorados por conflito de id (idempotência).
- **Falhas (lotes):** tokens de lotes que falharam após todos os retries.
- **Lotes processados:** quantidade de lotes.
- **IDs com falha:** amostra dos ids que ficaram em lotes com falha (para rastreabilidade).
