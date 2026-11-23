// T3 setup: org → agent (apiKey!) → fund → balance
// Idempotent: state di .state/setup_state.json
import { T3nClient, createEmailOtpAuthInput, loadWasmComponent, fetchTrustedManifest, toBaseUnits, formatTokens } from "@terminal3/t3n-sdk";
import { execFileSync } from "child_process";
import fs from "fs";

const BASE = process.env.T3N_BASE || "https://cn-api.sg.testnet.t3n.terminal3.io";
const EMAIL = process.env.T3N_EMAIL || process.env.T3N_EMAIL || "";
const STATE_FILE = process.env.STATE_FILE || ".state/setup_state.json";

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};

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
  const client = new T3nClient({ baseUrl: BASE, wasmComponent, trustAnchor });
  await client.handshake();
  console.log("[+] handshake ok");
  await client.authenticate(createEmailOtpAuthInput({ email: EMAIL, getOtpCode: getOtpFromImap }));
  console.log("[+] auth ok — DID:", client.getDid().value);

  // 1. org
  if (!state.orgDid) {
    const org = await client.createOrganisation("Alfonodes Agents");
    state.orgDid = org.value;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log("[+] org dibuat:", state.orgDid);
  } else {
    console.log("[i] org sudah ada:", state.orgDid);
  }

  // 2. agent (apiKey tampil SEKALI — langsung simpan)
  if (!state.agentDid) {
    const agent = await client.createAgent(state.orgDid, "Sentinel Agent");
    state.agentDid = agent.agentDid.value;
    state.agentApiKey = agent.apiKey;
    state.agentKeyId = agent.keyId;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    fs.writeFileSync(process.env.AGENT_ENV_FILE || ".state/t3_agent.env", `T3N_AGENT_DID=${state.agentDid}\nT3N_AGENT_API_KEY=${state.agentApiKey}\nT3N_AGENT_KEY_ID=${state.agentKeyId}\nT3N_ORG_DID=${state.orgDid}\n`);
    fs.chmodSync(process.env.AGENT_ENV_FILE || ".state/t3_agent.env", 0o600);
    console.log("[+] agent dibuat:", state.agentDid, "| apiKey: (disimpan ke .state/t3_agent.env)");
  } else {
    console.log("[i] agent sudah ada:", state.agentDid);
  }

  // 3. fund agent 50 credits dari balance tenant
  if (!state.funded) {
    await client.fundAgent(state.agentDid, toBaseUnits(50));
    state.funded = true;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log("[+] agent funded 50 credits");
  } else {
    console.log("[i] agent sudah funded");
  }

  // 4. balance tenant
  const bal = await client.getBalance();
  console.log("[+] balance tenant:", JSON.stringify(bal).slice(0, 200));
  console.log("[+] available:", formatTokens(bal.available));
}

main().catch((e) => {
  console.error("[!] ERROR:", e?.name, (e?.message ?? String(e)).slice(0, 400));
  if (e?.detail) console.error("[!] detail:", JSON.stringify(e.detail).slice(0, 300));
  process.exit(1);
});
