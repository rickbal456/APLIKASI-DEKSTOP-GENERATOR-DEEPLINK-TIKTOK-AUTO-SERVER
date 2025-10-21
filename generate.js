#!/usr/bin/env node
/**
 * batch_tiktok_deeplink_v4_raw.js
 * - Baca link dari link_tiktok.txt
 * - Sniff deeplink "snssdk...://ec/pdp?..." via CDP (URL, headers, POST body)
 * - Tulis **apa adanya (RAW)** ke hasil_tiktok.txt (tanpa decode/normalisasi)
 * - Default: hanya tulis baris kalau ketemu; pakai --write-miss untuk menulis "(MISS)"
 *
 * Usage:
 *   node batch_tiktok_deeplink_v4_raw.js --timeout 35000 --clear
 *   node batch_tiktok_deeplink_v4_raw.js --headful --timeout 45000 --write-miss
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT  = path.resolve('link_tiktok.txt');
const OUTPUT = path.resolve('hasil_tiktok.txt');

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = { headful: false, timeout: 35000, clear: false, writeMiss: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--headful') opt.headful = true;
    else if (a === '--timeout') opt.timeout = Math.max(15000, parseInt(args[++i], 10) || 35000);
    else if (a === '--clear') opt.clear = true;
    else if (a === '--write-miss') opt.writeMiss = true;
  }
  return opt;
}

// Ambil string deeplink mentah apa adanya (stop saat kena spasi/quote/< > \ atau whitespace)
const DL_REGEX = /snssdk\d+:\/\/ec\/pdp\?[^"'<>\\\s]+/i;

async function sniffDeeplinkRAW(page, targetUrl, timeout) {
  let found = null;

  const client = await page.target().createCDPSession();
  await client.send('Network.enable');

  const scanString = (s) => {
    if (!s || found) return;
    const m = s.match(DL_REGEX);
    if (m && m[0]) found = m[0]; // simpan RAW apa adanya
  };

  // URL & POST body
  client.on('Network.requestWillBeSent', (e) => {
    try {
      scanString(e.request?.url || '');
      scanString(e.request?.postData || '');
    } catch {}
  });

  // Header Location (kalau ada)
  const onResp = (e) => {
    try {
      const loc = e.response?.headers?.location || (e.responseHeaders && e.responseHeaders.location);
      if (typeof loc === 'string') scanString(loc);
    } catch {}
  };
  client.on('Network.responseReceived', onResp);
  client.on('Network.responseReceivedExtraInfo', onResp);

  // Navigate
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.max(20000, timeout) });
  } catch { /* biarkan */ }

  // Tunggu XHR awal
  try { await page.waitForNetworkIdle({ idleTime: 1200, timeout: Math.min(12000, timeout) }); } catch {}

  // Beri waktu batch/bytecom mengirim payload
  const until = Date.now() + Math.max(10000, timeout - 15000);
  while (!found && Date.now() < until) {
    await page.waitForTimeout(700);
  }

  await client.detach().catch(()=>{});
  return found; // RAW
}

async function processOne(browser, url, timeout) {
  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  );
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    try { Object.defineProperty(navigator, 'languages', { get: () => ['id-ID','en-US'] }); } catch {}
  });

  let raw = await sniffDeeplinkRAW(page, url, timeout);

  // fallback: klik "Open TikTok" kalau ada
  if (!raw) {
    try {
      await page.waitForTimeout(1200);
      const btns = await page.$x("//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), 'open tiktok')]");
      if (btns && btns[0]) {
        await btns[0].click();
        await page.waitForTimeout(2500);
        raw = await sniffDeeplinkRAW(page, page.url(), Math.floor(timeout/2));
      }
    } catch {}
  }

  await page.close().catch(()=>{});
  return raw; // JANGAN decode/ubah apa pun
}

(async () => {
  const { headful, timeout, clear, writeMiss } = parseArgs();

  if (!fs.existsSync(INPUT)) { console.error('❌ Tidak menemukan', INPUT); process.exit(1); }
  const list = fs.readFileSync(INPUT, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!list.length) { console.error('❌ link_tiktok.txt kosong'); process.exit(1); }

  if (clear && fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);

  const browser = await puppeteer.launch({
    headless: headful ? false : 'new',
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=412,915',
      '--lang=id-ID,id;q=0.9,en-US;q=0.8'
    ],
    defaultViewport: null
  });

  let ok = 0;
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    process.stdout.write(`[${i+1}/${list.length}] `);
    let raw = await processOne(browser, u, timeout);

    // retry sekali
    if (!raw) {
      process.stdout.write('retry… ');
      await new Promise(r => setTimeout(r, 1200));
      raw = await processOne(browser, u, Math.floor(timeout/1.5));
    }

    if (raw) {
      fs.appendFileSync(OUTPUT, raw + '\n', 'utf8'); // Tulis RAW persis
      console.log('OK');
      ok++;
    } else {
      console.log('MISS');
      if (writeMiss) fs.appendFileSync(OUTPUT, '(MISS)\n', 'utf8');
    }
  }

  await browser.close().catch(()=>{});
  console.log(`\n✅ Selesai. Tertangkap: ${ok}/${list.length}. Lihat: ${OUTPUT}`);
})();
