// T3 quickstart: register contract → store → grant agent → agent check (apiKey, billed ke agent)
// Flags: --register --store --grant --check --try-store --log
// State: .state/setup_state.json (orgDid, agentDid) + .state/contract_state.json
import { T3nClient, TenantClient, createEmailOtpAuthInput, loadWasmComponent, fetchTrustedManifest, getContractVersion, fanOutGrant, invoke, formatTokens } from "@terminal3/t3n-sdk";
import { execFileSync } from "child_process";
import { readFile } from "fs/promises";
import fs from "fs";

const BASE = process.env.T3N_BASE || "https://cn-api.sg.testnet.t3n.terminal3.io";
const EMAIL = process.env.T3N_EMAIL || process.env.T3N_EMAIL || "";
const WASM_PATH = "process.env.WASM_PATH || "../target/wasm32-wasip2/release/sentinel_vault.wasm"";
const CONTRACT_TAIL = "vault";
const CONTRACT_VERSION = process.env.CONTRACT_VERSION || "0.1.0";
const STATE_FILE = process.env.STATE_FILE || ".state/setup_state.json";
const CONTRACT_STATE = process.env.CONTRACT_STATE || ".state/contract_state.json";

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const cstate = fs.existsSync(CONTRACT_STATE) ? JSON.parse(fs.readFileSync(CONTRACT_STATE, "utf8")) : {};
const agentDid = state.agentDid;
const agentApiKey = process.env.T3N_AGENT_API_KEY || state.agentApiKey;
if (!agentDid || !agentApiKey) { console.error("[!] setup.mjs harus jalan dulu (org+agent)"); process.exit(1); }

function getOtpFromImap() {
  const out = execFileSync("python3", [process.env.OTP_POLLER || new URL("./get_otp.py", import.meta.url).pathname, "150"], { timeout: 170_000, encoding: "utf8" });
  const code = out.trim().split("\n").pop().trim();
  if (!/^\d{6}$/.test(code)) throw new Error("OTP tidak valid: " + code);
  console.log("[+] OTP diterima:", code);
  return code;
}

async function main() {
  const wasmComponent = await loadWasmComponent();
  const trustAnchor = await fetchTrustedManifest("sandbox", { baseUrl: BASE });
  const t3n = new T3nClient({ baseUrl: BASE, wasmComponent, trustAnchor });
  await t3n.handshake();
  await t3n.authenticate(createEmailOtpAuthInput({ email: EMAIL, getOtpCode: getOtpFromImap }));
  const tenantDid = t3n.getDid().value;
  const tenant = new TenantClient({ t3n, baseUrl: BASE, tenantDid });
  const tenantId = tenantDid.slice("did:t3n:".length);
  const contractName = `z:${tenantId}:${CONTRACT_TAIL}`;
  console.log("[+] auth ok — tenant:", tenantDid);

  const flags = (f) => process.argv.includes(f);

  // --- register contract + vault map ---
  if (flags("--register")) {
    let contractId = cstate.contractId;
    if (contractId === undefined) {
      const result = await tenant.contracts.register({
        tail: CONTRACT_TAIL,
        version: CONTRACT_VERSION,
        wasm: await readFile(WASM_PATH),
      });
      contractId = result.contract_id;
      cstate.contractId = contractId;
      fs.writeFileSync(CONTRACT_STATE, JSON.stringify(cstate, null, 2));
      console.log(`[+] registered ${contractName} → contract id ${contractId}`);
    } else {
      console.log(`[i] contract id ${contractId} sudah terdaftar`);
    }
    const acl = { writers: { only: [contractId] }, readers: { only: [contractId] } };
    try {
      await tenant.maps.create({ tail: "vault", visibility: "private", ...acl });
      console.log(`[+] map z:${tenantId}:vault dibuat untuk contract id ${contractId}`);
    } catch (err) {
      if (!/already.?exists/i.test(String(err.message))) throw err;
      await t3n.maps.update("vault", acl);
      console.log(`[i] map sudah ada — ACL diarahkan ke contract id ${contractId}`);
    }
  }

  const contractVersion = await getContractVersion(BASE, contractName);
  console.log("[i] contract version terdaftar:", contractVersion);

  // --- store (self call, customer) ---
  if (flags("--store")) {
    const customer = JSON.parse(await readFile(process.env.CUSTOMER_JSON || "../examples/customer.json", "utf8"));
    const stored = await t3n.executeAndDecode({
      contract_id: contractName,
      contract_version: contractVersion,
      function_name: "store",
      input: customer,
    });
    console.log("[+] store:", JSON.stringify(stored));
  }

  // --- grant agent check ---
  if (flags("--grant")) {
    await t3n.updateMemberDelegation(
      fanOutGrant(
        { grantee: agentDid, contract_id: contractName, scopes: [], allowed_hosts: [] },
        ["check"],
      ),
    );
    console.log(`[+] granted ${agentDid} → ${contractName}:check`);
  }

  // --- agent check (apiKey, billed ke saldo agent) ---
  if (flags("--check")) {
    const result = await invoke({
      baseUrl: BASE,
      apiKey: agentApiKey,
      request: {
        contract_id: contractName,
        contract_version: contractVersion,
        function_name: "check",
        pii_did: tenantDid,
        input: {
          rules: {
            min_age: 18,
            residency_in: ["GB", "IE"],
            kyc_verified: true,
            id_not_expired: true,
            min_monthly_income_cents: 300000,
            account_open_min_months: 12,
          },
        },
      },
    });
    console.log("[+] check:", JSON.stringify(result));
  }

  // --- boundary: agent coba store (harus 403) ---
  if (flags("--try-store")) {
    try {
      await invoke({
        baseUrl: BASE,
        apiKey: agentApiKey,
        request: { contract_id: contractName, contract_version: contractVersion, function_name: "store", pii_did: tenantDid, input: {} },
      });
      console.log("[!] unexpected: store succeeded");
    } catch (err) {
      console.log("[+] store refused, as expected:", String(err.message).slice(0, 120));
    }
  }

  // --- activity log ---
  if (flags("--log")) {
    const page = await t3n.getActivityLog({ limit: 20, custom: { vault_op: "check" } });
    for (const e of page.entries) console.log("  log:", JSON.stringify(e).slice(0, 200));
  }

  const bal = await t3n.getBalance();
  console.log("[i] balance tenant:", formatTokens(bal.available), "credits");
}

main().catch((e) => {
  console.error("[!] ERROR:", e?.name, (e?.message ?? String(e)).slice(0, 400));
  if (e?.detail) console.error("[!] detail:", JSON.stringify(e.detail).slice(0, 300));
  process.exit(1);
});
