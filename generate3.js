#!/usr/bin/env node
/**
 * generate3.js — TikTok Deeplink Grabber + One-shot Uploader (GUI-scheduled)
 * Mode default: sekali jalan lalu exit (NO_DAEMON=1 dari GUI).
 * Jika NO_DAEMON tidak diset, bisa switch ke daemon (tidak direkomendasikan bila GUI jadi scheduler).
 */

// ======================= CONFIG =======================
const API_URL = process.env.API_URL || "https://klika.caridisini.site/apitiktokdirect.php";
const JSON_FILE_NAMES = ["tiktok"];
const EXTRA_HEADERS = { /* 'Authorization': 'Bearer ...' */ };
// ======================================================

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT  = path.resolve('link_tiktok.txt');
const OUTPUT = path.resolve('hasil_tiktok.txt');
const DL_REGEX = /snssdk\d+:\/\/ec\/pdp\?[^"'<>\\\s]+/i;

const NO_DAEMON = !!String(process.env.NO_DAEMON || '').trim(); // dikirim GUI
function nowID(){ return new Date().toLocaleString('id-ID'); }

// --- Sniff network ---
async function sniffDeeplinkRAW(page, targetUrl, timeout = 35000) {
  let found = null;
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');

  const scan = (s) => { if (!s || found) return; const m = s.match(DL_REGEX); if (m && m[0]) found = m[0]; };
  client.on('Network.requestWillBeSent', (e) => { try { scan(e.request?.url||''); scan(e.request?.postData||''); } catch {} });
  const onResp = (e) => { try { const loc = e.response?.headers?.location || (e.responseHeaders && e.responseHeaders.location); if (typeof loc==='string') scan(loc); } catch {} };
  client.on('Network.responseReceived', onResp);
  client.on('Network.responseReceivedExtraInfo', onResp);

  try { await page.goto(targetUrl, { waitUntil:'domcontentloaded', timeout: Math.max(20000,timeout) }); } catch {}
  try { await page.waitForNetworkIdle({ idleTime:1200, timeout: Math.min(12000,timeout) }); } catch {}

  const until = Date.now() + Math.max(10000, timeout - 15000);
  while (!found && Date.now() < until) { await page.waitForTimeout(700); }

  await client.detach().catch(()=>{});
  return found;
}

async function processOne(browser, url, timeout = 35000) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    try { Object.defineProperty(navigator, 'languages', { get: () => ['id-ID','en-US'] }); } catch {}
  });

  let raw = await sniffDeeplinkRAW(page, url, timeout);
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
  return raw;
}

// --- Sulap top-level ---
function sulapTopLevelParam(str, key) {
  if (!str || !key) return str;
  const re = new RegExp('([?&]' + key + '=)([^&#]+)', 'i');
  return str.replace(re, (full, prefix, val) => {
    if (!val) return full;
    const lower = val.toLowerCase();
    if (lower.startsWith('%257b')) return prefix + val;
    if (lower.startsWith('%7b'))  return prefix + encodeURIComponent(val);
    if (val[0] === '{') {
      const once = encodeURIComponent(val);
      return prefix + encodeURIComponent(once);
    }
    return prefix + val;
  });
}

// --- POST JSON ---
async function doPostJson(url, body, headers = {}, retries = 2) {
  let _fetch = (typeof fetch === 'function') ? fetch : null;
  if (!_fetch) { _fetch = (await import('node-fetch')).default; }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await _fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      return { ok:true, status:res.status, text };
    } catch (err) {
      if (attempt === retries) return { ok:false, error: err.message || String(err) };
      await new Promise(r => setTimeout(r, 1000 * (attempt+1)));
    }
  }
}

// --- MAIN ---
(async () => {
  if (!fs.existsSync(INPUT)) { console.error('❌ Tidak menemukan', INPUT); process.exit(1); }
  const list = fs.readFileSync(INPUT, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!list.length) { console.error('❌ link_tiktok.txt kosong'); process.exit(1); }

  const isValidApi = /^https?:\/\//i.test(API_URL);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=412,915',
      '--lang=id-ID,id;q=0.9,en-US;q=0.8'
    ],
    defaultViewport: null
  });

  let pending = [];
  let ok = 0;

  for (let i = 0; i < list.length; i++) {
    const short = list[i];
    process.stdout.write(`[${i+1}/${list.length}] ${short} … `);

    let raw = await processOne(browser, short, 35000);
    if (!raw) {
      process.stdout.write('retry … ');
      await new Promise(r => setTimeout(r, 1200));
      raw = await processOne(browser, short, 20000);
    }

    if (raw) {
      let final = sulapTopLevelParam(raw, 'trackParams');
      // final = sulapTopLevelParam(final, 'requestParams'); // opsional
      fs.appendFileSync(OUTPUT, final + '\n', 'utf8');
      pending.push(final);
      ok++;
      console.log('OK');
    } else {
      console.log('MISS');
    }
  }

  await browser.close().catch(()=>{});
  console.log(`\n✅ ${nowID()} — Selesai proses awal. ${ok}/${list.length} tertangkap. Output → ${OUTPUT}`);

  if (isValidApi && pending.length) {
    const unique = Array.from(new Set(pending));
    const payload = {
      urls: [
        { json_file: JSON_FILE_NAMES, entries: unique.map(u => ({ url: u })) }
      ]
    };
    console.log(`🔼 ${nowID()} — Upload ${unique.length} url ...`);
    const resp = await doPostJson(API_URL, payload, EXTRA_HEADERS, 2);
    if (resp.ok) {
      console.log(`✅ Upload OK (${resp.status}) — ${resp.text?.slice(0,200) || ''}`);
      console.log('Data update completed.');
    } else {
      console.warn(`❌ Upload gagal — ${resp.error}`);
    }
  }

  if (NO_DAEMON) {
    console.log('ℹ️ Mode batch (NO_DAEMON=1) — proses selesai & keluar.');
    process.exit(0);
  } else {
    console.log('ℹ️ Mode daemon dimatikan di GUI. (Aktifkan NO_DAEMON=1 untuk batch via GUI).');
  }
})().catch(e => {
  console.error('FATAL:', e?.stack || e?.message || String(e));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason?.stack || reason?.message || String(reason));
});
