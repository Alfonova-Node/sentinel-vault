// T3 claim via email-OTP login — TANPA Google.
// Flow: handshake → authenticate(email-OTP, kode diambil IMAP) → submitUserInput(becomeDevTenant)
import { T3nClient, createEmailOtpAuthInput, loadWasmComponent, fetchTrustedManifest } from "@terminal3/t3n-sdk";
import { execFileSync } from "child_process";

const BASE = process.env.T3N_BASE || "https://cn-api.sg.testnet.t3n.terminal3.io";
const EMAIL = process.env.T3N_EMAIL || process.env.T3N_EMAIL || "";

const PROFILE = {
  first_name: process.env.T3N_FIRST || "Lo",
  last_name: process.env.T3N_LAST || "Vakoting",
  email_address: EMAIL,
  role: process.env.T3N_ROLE || "Developer",
  country_of_residence: process.env.T3N_COUNTRY || "ID",
};
const CAMPAIGN = process.env.T3N_CAMPAIGN || "";
if (CAMPAIGN) PROFILE.campaign_code = CAMPAIGN;

function getOtpFromImap() {
  // poll IMAP via python (env IMAP_HOST/IMAP_USER/IMAP_PASS dari environment)
  const out = execFileSync("python3", ["./get_otp.py", "150"], {
    timeout: 170_000,
    encoding: "utf8",
    env: { ...process.env },
  });
  const code = out.trim().split("\n").pop().trim();
  if (!/^\d{6}$/.test(code)) throw new Error("OTP tidak valid: " + code);
  console.log("[+] OTP diterima:", code);
  return code;
}

async function main() {
  console.log("[*] load WASM...");
  const wasmComponent = await loadWasmComponent();
  console.log("[*] fetch trust manifest...");
  const trustAnchor = await fetchTrustedManifest("sandbox", { baseUrl: BASE });

  const client = new T3nClient({ baseUrl: BASE, wasmComponent, trustAnchor });
  console.log("[*] handshake...");
  await client.handshake();
  console.log("[+] handshake ok");

  console.log("[*] authenticate via email-OTP (OTP dikirim ke " + EMAIL + ")...");
  const did = await client.authenticate(
    createEmailOtpAuthInput({ email: EMAIL, getOtpCode: getOtpFromImap })
  );
  console.log("[+] AUTH OK — DID:", did);

  console.log("[*] submitUserInput (becomeDevTenant=true)...");
  const sub = await client.submitUserInput({ profile: PROFILE, becomeDevTenant: true });
  console.log("[+] RESULT:", JSON.stringify(sub).slice(0, 1000));
  console.log("[+] DID final:", client.getDid());
}

main().catch((e) => {
  console.error("[!] ERROR:", e?.name, (e?.message ?? String(e)).slice(0, 400));
  if (e?.detail) console.error("[!] detail:", JSON.stringify(e.detail).slice(0, 400));
  process.exit(1);
});
