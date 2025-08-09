// scripts/fetch_dq.js
import fs from "fs/promises";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL = process.env.DISCORD_CHANNEL_ID;

if (!TOKEN || !CHANNEL) {
  console.error("Missing DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID");
  process.exit(1);
}

const API = "https://discord.com/api/v10";

async function fetchMessages() {
  const res = await fetch(`${API}/channels/${CHANNEL}/messages?limit=5`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  return res.json();
}

// pola teks (boleh kamu tweak kalau format TLN berubah)
const reDQLine = /(\d+)\s+(.+?)\s+for\s+(\d+)\s+World Locks/gi;
const reFinal = /Estimated Final Price:\s*([0-9]+)\s*[-–]\s*([0-9]+)/i;
const reRole = /Role Day:\s*([A-Za-z ]+)/i;
const rePred = /Price Prediction:\s*([A-Za-z]+)/i;
const reTurn = /Turnout:\s*([A-Za-z]+)/i;
const reDate = /Today's Date:\s*([\d]{2}\s\w+\s[\d]{4})/i;

function parseDQ(msg) {
  const texts = [];
  if (msg.content) texts.push(msg.content);
  for (const e of msg.embeds || []) {
    if (e.title) texts.push(e.title);
    if (e.description) texts.push(e.description);
    if (e.fields)
      for (const f of e.fields) {
        if (f.name) texts.push(f.name);
        if (f.value) texts.push(f.value);
      }
  }
  const blob = texts.join("\n");

  const items = [];
  let m;
  while ((m = reDQLine.exec(blob)) !== null) {
    items.push({ qty: +m[1], name: m[2].trim(), price: +m[3] });
  }
  if (!items.length) return null;

  const fp = blob.match(reFinal);
  const role = blob.match(reRole);
  const pred = blob.match(rePred);
  const turn = blob.match(reTurn);
  const dat = blob.match(reDate);

  return {
    sourceMessageId: msg.id,
    updatedAt: new Date().toISOString(),
    dateText: dat?.[1] || null,
    items,
    finalPrice: fp ? { min: +fp[1], max: +fp[2] } : null,
    roleDay: role?.[1]?.trim() || null,
    prediction: pred?.[1]?.trim() || null,
    turnout: turn?.[1]?.trim() || null,
  };
}

async function main() {
  const messages = await fetchMessages();
  let parsed = null;
  for (const msg of messages) {
    parsed = parseDQ(msg);
    if (parsed) break;
  }
  await fs.mkdir("public", { recursive: true });
  await fs.writeFile("public/dq.json", JSON.stringify(parsed || {}, null, 2));
  console.log("Saved public/dq.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
