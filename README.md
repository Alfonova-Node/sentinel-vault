# Sentinel Vault 🔐

**A privacy-preserving KYC vault for AI agents, built on the [Terminal 3](https://terminal3.io) Autonomous Data Kit (ADK).**

Sensitive customer records — identity documents, balances, income — are sealed inside a TEE-backed contract. AI agents never see a single raw value: they ask **yes/no risk questions** ("over 18?", "KYC verified?", "income ≥ £3,000/month?") and the enclave answers with booleans only. Every delegated call is billed to the *agent's own credit balance* and written to an audit log.

Built for the **Terminal 3 Build+Scale Agent Micro Grant** (DoraHacks).

## Why this matters

AI agents increasingly act *for* people — booking, applying, verifying — but they shouldn't need copies of our documents to do it. Sentinel Vault flips the model:

| Traditional agent flow | Sentinel Vault flow |
|---|---|
| Agent receives full KYC documents | Customer stores records in their own TEE vault |
| Agent sees name, ID number, balance | Agent sees `true` / `false` — nothing else |
| Trust = "hope the agent is honest" | Trust = enforced by the enclave + delegation grants |

## Architecture

```
Customer (session auth)                Agent (API key)
      │                                     │
      │ store(record)                       │ check(rules) ── billed to agent balance
      ▼                                     ▼
┌─────────────────────────────────────────────────┐
│  T3N node (TEE enclave)                         │
│  contract: z:<tid>:vault  (WASM, Rust)          │
│  map: z:<tid>:vault  — private, contract-only   │
│  key: hex(customer DID) → sealed record         │
└─────────────────────────────────────────────────┘
```

- **Contract** (`src/`): Rust → `wasm32-wasip2` component. `store` (self-call only), `check` (customer or granted agent), `forget`.
- **Delegation**: the customer grants the agent exactly one function — `check`. Attempting `store` as the agent returns HTTP 403 *before the contract even runs*.
- **Billing**: each `check` is charged to the agent's credit balance, giving verifiable per-DID credit consumption.

## Rules the vault answers

| Rule | Example | True when |
|---|---|---|
| `min_age` | `18` | customer is at least this old |
| `residency_in` | `["GB","IE"]` | address country in list |
| `nationality_in` | `["GB"]` | nationality in list |
| `kyc_verified` | `true` | KYC status is `verified` |
| `id_not_expired` | `true` | ID valid today or later |
| `min_balance_cents` | `100000` | balance ≥ this (minor units) |
| `min_monthly_income_cents` | `300000` | income ≥ this |
| `account_open_min_months` | `12` | account tenure ≥ this |
| `employed` | `true` | employed or self-employed |

## Quickstart

Prerequisites: Node 20+, Rust with `wasm32-wasip2`, an admitted T3N testnet tenant (see [T3 docs](https://docs.terminal3.io)).

```bash
# 1. build the contract
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
# → target/wasm32-wasip2/release/sentinel_vault.wasm

# 2. node project
cd scripts && npm init -y && npm i @terminal3/t3n-sdk

# 3. create org + agent, fund the agent
node setup.mjs

# 4. register contract + vault map
node quickstart.mjs --register

# 5. customer stores a record, grants the agent `check`
node quickstart.mjs --store --grant

# 6. agent asks — API key only, no session
node quickstart.mjs --check
# → {"answers":{"min_age":true,"kyc_verified":true,...}}

# 7. prove the boundary: agent tries to store → 403
node quickstart.mjs --try-store
```

OTP-based email login is automated end-to-end (`scripts/get_otp.py` polls IMAP), so the whole flow — claim, tenant admission, org/agent creation, contract deployment, delegated execution — runs headlessly.

## Repository layout

```
sentinel-vault/
├── src/            # contract: lib.rs (WASM entry) + logic.rs (validation & rules)
├── wit/            # host interfaces (tenant-base world, vendored from Trinity testnet-v1.0.12)
├── tests/          # native unit tests (`cargo test`)
├── examples/       # fictional customer.json + rules.json
└── scripts/        # Node/Python automation: setup, register, store, grant, check
```

## Live results (testnet)

- Tenant DID: admitted via email-OTP self-service
- Contract registered at `z:<tid>:vault` v0.1.0
- Delegated `check` answered 6/6 rules correctly; `store` as agent → 403
- All agent calls billed to the agent's own balance

## License

Apache-2.0
