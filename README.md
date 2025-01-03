# Enterprise Manager

Monitor and manage enterprise systems through a modern web interface.

## Architecture

```
tier1-core.exe (Guardian)
└── tier2-core.exe (Monitor)
    └── main-process.exe (Executor)
```

- **Tier-1**: Core stability layer, manually managed
- **Tier-2**: Process monitor, restartable via UI
- **Main**: Task executor with resilience patterns

## Build & Install

Prerequisites: Go 1.21+, Windows

```bash
# Build all components
go build -o bin/tier1-core.exe ./cmd/tier1-core
go build -o bin/tier2-core.exe ./cmd/tier2-core
go build -o bin/main-process.exe ./cmd/main-process
```

Install in order: tier1-core (manual) → tier2-core → main-process

## Configuration

```bash
# Optional environment variables
API_ENDPOINT=http://localhost:3000/api/tasks
SYSTEMS_ENDPOINT=http://localhost:3000/api/systems
POLL_INTERVAL_SECONDS=30
MAX_RETRIES=3
RETRY_INTERVAL_SECONDS=5
SYSTEM_ID=auto-generated-if-not-set
```

## Security Notes

- Tier-1 requires admin privileges
- API endpoints should use HTTPS in production
- Add authentication as needed
