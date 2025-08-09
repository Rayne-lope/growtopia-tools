/**
 * Fetch TLN Daily Quest from a Discord channel and write public/dq.json
 * Env needed (set di GitHub Actions Secrets):
 *  - DISCORD_BOT_TOKEN
 *  - DISCORD_CHANNEL_ID
 *
 * Node 18+ (punya global fetch)
 */

const fs = require("fs");
const path = require("path");

// ===== Env checks =====
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!TOKEN || !CHANNEL_ID) {
  console.error("Missing DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID");
  process.exit(1);
}

// ===== Small helpers =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT_PATH = path.join(process.cwd(), "public", "dq.json");

/**
 * Join semua teks yang relevan dari sebuah message:
 * - content biasa
 * - embed: title, description, fields (name/value), footer.text
 */
function readMessageText(m) {
  const parts = [];
  if (m.content) parts.push(m.content);

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

/**
 * Coba “deteksi” satu postingan Daily Quest dari TLN:
 * - Cari teks yang mengandung “Today’s Daily Quest” atau “Daily Quest”
 * - Kembalikan objek { text, message }
 */
function findDQMessage(messages) {
  for (const m of messages) {
    const text = readMessageText(m);
    const lower = text.toLowerCase();
    if (
      lower.includes("today's daily quest") ||
      lower.includes("daily quest")
    ) {
      return { text, message: m };
    }
  }
  return null;
}

/**
 * Parse teks TLN ke struktur sederhana:
 * - date (jika ada)
 * - estimated price (jika ada)
 * - role day (jika ada)
 * - items: [{ name, qty, price_wl }]
 *
 * Catatan: format TLN bisa berubah; regex dibuat fleksibel untuk pola umum.
 */
function parseTLN(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const result = {
    date: null,
    estimatedFinalPrice: null,
    roleDay: null,
    items: [],
    raw: text,
  };

  // Date: contoh “09 August 2025”
  const dateLine = lines.find((l) => /\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/.test(l));
  if (dateLine) {
    const m = dateLine.match(/\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/);
    if (m) result.date = m[0];
  }

  // Estimated Final Price: “Estimated Final Price: 18-20”
  {
    const priceLine = lines.find((l) => /Estimated Final Price/i.test(l));
    if (priceLine) {
      const m = priceLine.match(
        /Estimated Final Price:\s*([0-9]+(?:-[0-9]+)?)/i
      );
      if (m) result.estimatedFinalPrice = m[1];
    }
  }

  // Role Day: “Role Day: Chef”
  {
    const roleLine = lines.find((l) => /Role Day/i.test(l));
    if (roleLine) {
      const m = roleLine.match(/Role Day:\s*([A-Za-z]+)/i);
      if (m) result.roleDay = m[1];
    }
  }

  // Items (pola paling umum):
  // "200 Shallot Mustache for 13 World Locks"
  // "23 Steam Collector Seed for 7 World Locks"
  // Juga kadang baris memuat “World Locks” di bawahnya → kita scan semua baris.
  for (const l of lines) {
    const m = l.match(/^\s*(\d+)\s+(.+?)\s+for\s+(\d+)\s+World Locks?/i);
    if (m) {
      const qty = parseInt(m[1], 10);
      const name = m[2].trim();
      const price_wl = parseInt(m[3], 10);
      if (qty > 0 && name) {
        result.items.push({ name, qty, price_wl });
      }
    }
  }

  // Fallback (kalau format beda): coba cari pola “N itemName – price WL”
  if (result.items.length === 0) {
    for (const l of lines) {
      const m = l.match(/^\s*(\d+)\s+(.+?)\s*[-–]\s*(\d+)\s*WL/i);
      if (m) {
        const qty = parseInt(m[1], 10);
        const name = m[2].trim();
        const price_wl = parseInt(m[3], 10);
        if (qty > 0 && name) {
          result.items.push({ name, qty, price_wl });
        }
      }
    }
  }

  return result;
}

/**
 * Fetch last N messages dari channel (cukup 50 biasanya).
 */
async function fetchLastMessages(channelId, limit = 50) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * Write JSON ke public/dq.json
 */
function writeOutput(data) {
  const out = {
    ...data,
    fetchedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_PATH}`);
}

(async () => {
  try {
    console.log("Fetching messages from Discord...");
    const messages = await fetchLastMessages(CHANNEL_ID, 50);

    // Cari postingan DQ
    const got = findDQMessage(messages);
    if (!got) {
      console.warn("No Daily Quest message found in the last 50 messages.");
      // Tetap tulis file minimal biar UI bisa handle
      writeOutput({
        date: null,
        items: [],
        roleDay: null,
        estimatedFinalPrice: null,
        raw: "",
      });
      process.exit(0);
    }

    console.log("Parsing Daily Quest text...");
    // Optional debug:
    console.log(
      "Sample text:",
      got.text.slice(0, 180).replace(/\n/g, " ⏎ "),
      "..."
    );

    const parsed = parseTLN(got.text);
    parsed.sourceMessageId = got.message.id;

    // Sanity log
    console.log(`Found ${parsed.items.length} item(s).`);
    parsed.items.forEach((it, i) => {
      console.log(`  #${i + 1}: ${it.qty} x ${it.name} @ ${it.price_wl} WL`);
    });

    writeOutput(parsed);
    await sleep(300); // kecil2an aja
    console.log("Done.");
  } catch (err) {
    console.error("ERROR:", err.message || err);
    process.exit(1);
  }
})();
