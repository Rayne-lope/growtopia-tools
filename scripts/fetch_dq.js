// public/scripts/fetch_dq.js
// Node 18+ (GitHub Actions). Tidak butuh gateway intents; kita pakai REST.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ====== Env & setup ======
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error("Missing DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_PATH = path.resolve(__dirname, "..", "dq.json");

// ====== Helpers ======
function readMessageText(m) {
  const parts = [];
  if (m.content) parts.push(m.content);

  // Gabung info embed agar message forward/preview tetap kebaca
  if (Array.isArray(m.embeds)) {
    for (const e of m.embeds) {
      if (e.title) parts.push(e.title);
      if (e.description) parts.push(e.description);
      if (Array.isArray(e.fields)) {
        for (const f of e.fields) {
          if (f.name) parts.push(f.name);
          if (f.value) parts.push(f.value);
        }
      }
      if (e.footer && e.footer.text) parts.push(e.footer.text);
    }
  }
  return parts.join("\n").trim();
}

async function fetchChannelMessages(limit = 100) {
  const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Discord API error ${res.status}: ${txt}`);
  }
  return res.json(); // array messages (baru → lama)
}

// ====== Parsing ======
function parseDQ(text) {
  // Normalisasi en dash/hyphen
  const t = text.replace(/\u2013|\u2014/g, "-");

  // Date (contoh: "Today's Date: 09 August 2025")
  const dateMatch = t.match(/Today'?s Date:\s*([^\n]+)/i);
  const date = dateMatch ? dateMatch[1].trim() : null;

  // Role Day (contoh: "Role Day:\s*Chef")
  const roleMatch = t.match(/Role Day:\s*([A-Za-z]+)/i);
  const roleDay = roleMatch ? roleMatch[1].trim() : null;

  // Estimated Final Price (contoh: "Estimated Final Price:\s*18-20")
  const priceMatch = t.match(
    /Estimated\s*Final\s*Price:\s*([0-9]+)\s*-\s*([0-9]+)/i
  );
  let estimatedFinalPrice = null;
  if (priceMatch) {
    const lo = Number(priceMatch[1]);
    const hi = Number(priceMatch[2]);
    estimatedFinalPrice = { low: lo, high: hi };
  }

  // Items (contoh baris: "200 Shallot Mustache for 13 World Locks")
  // juga memungkinkan banyak item:
  // "23 Steam Collector Seed for 7 World Locks"
  const items = [];
  const lineRE = /^\s*(\d+)\s+(.+?)\s+for\s+(\d+)\s+World\s+Locks?/i;
  t.split(/\r?\n/).forEach((line) => {
    const m = line.match(lineRE);
    if (m) {
      items.push({
        amount: Number(m[1]),
        name: m[2].trim(),
        priceWL: Number(m[3]),
      });
    }
  });

  return { date, roleDay, estimatedFinalPrice, items };
}

// ====== Main ======
(async () => {
  try {
    const messages = await fetchChannelMessages(100);

    // Ambil pesan terbaru yang ada kata "Daily Quest"
    let target = null;
    for (const m of messages) {
      const txt = readMessageText(m);
      if (!txt) continue;
      // toleran: "Daily Quest", "Daily Quest announcement", dsb.
      if (/Daily\s+Quest/i.test(txt)) {
        target = { txt, m };
        break;
      }
    }

    let out = {
      date: null,
      items: [],
      roleDay: null,
      estimatedFinalPrice: null,
      raw: "",
      fetchedAt: new Date().toISOString(),
    };

    if (target) {
      const parsed = parseDQ(target.txt);
      out = {
        ...out,
        ...parsed,
        raw: target.txt.slice(0, 1000), // simpan sebagian buat debug
      };
    } else {
      // Tidak ketemu pesan — simpan potongan raw pertama untuk bantu debug
      const sample = messages
        .map(readMessageText)
        .filter(Boolean)
        .slice(0, 1)
        .join("\n---\n");
      out.raw = `No DQ message found.\nSample:\n${sample}`.slice(0, 1000);
    }

    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
    console.log("Saved:", OUT_PATH);
    console.log(out);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
