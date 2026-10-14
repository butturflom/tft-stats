// Outils communs : lecture du .env, limiteur de requêtes, client Riot, noms français.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { valeurEnv } from './securite.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.TFT_DATA || path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fichier .env à côté des scripts (TFT_ENV : autre fichier, pour les tests)
const envFile = () => process.env.TFT_ENV || path.join(ROOT, '.env');

// Modifie ou ajoute des lignes CLE=valeur dans .env en gardant les commentaires.
export function updateEnv(changes) {
  const file = envFile();
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/) : [];
  const done = new Set();
  const out = lines.map(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(changes, m[1])) { done.add(m[1]); return `${m[1]}=${valeurEnv(changes[m[1]])}`; }
    return l;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of Object.entries(changes)) if (!done.has(k)) out.push(`${k}=${valeurEnv(v)}`);
  fs.writeFileSync(file, out.join('\r\n') + '\r\n');
}

export function loadEnv() {
  const file = envFile();
  if (!fs.existsSync(file)) throw new Error('Fichier .env introuvable à côté du script.');
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return env;
}

// Clé de développement Riot : 20 requêtes par seconde et 100 toutes les 2 minutes.
export class Limiter {
  constructor(limits = [[19, 1000], [98, 120000]]) { this.limits = limits; this.stamps = []; }
  async take() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter(t => now - t < 120000);
      let wait = 0;
      for (const [n, win] of this.limits) {
        const inWin = this.stamps.filter(t => now - t < win);
        if (inWin.length >= n) wait = Math.max(wait, win - (now - inWin[inWin.length - n]) + 50);
      }
      if (!wait) { this.stamps.push(now); return; }
      await sleep(wait);
    }
  }
}

export class Riot {
  constructor(env) {
    this.key = env.RIOT_API_KEY || '';
    if (!/^RGAPI-[0-9a-f-]{36}$/i.test(this.key)) throw new Error('Clé RIOT_API_KEY absente ou mal formée dans .env');
    this.platform = env.RIOT_PLATFORM || 'euw1';
    this.region = env.RIOT_REGION || 'europe';
    this.limiter = new Limiter();
    this.count = 0;
  }
  async get(host, p, tries = 0) {
    await this.limiter.take();
    this.count++;
    let res;
    try {
      res = await fetch(`https://${host}.api.riotgames.com${p}`, { headers: { 'X-Riot-Token': this.key } });
    } catch (e) {
      if (tries < 3) { await sleep(2000 * (tries + 1)); return this.get(host, p, tries + 1); }
      throw new Error('Pas de connexion à Riot : ' + e.message);
    }
    if (res.status === 429 && tries < 10) {
      const ra = Number(res.headers.get('retry-after') || 10);
      process.stdout.write(`\n  Limite Riot atteinte, pause de ${ra} s…\n`);
      await sleep(ra * 1000 + 500);
      return this.get(host, p, tries + 1);
    }
    if (res.status >= 500 && tries < 3) { await sleep(3000 * (tries + 1)); return this.get(host, p, tries + 1); }
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Clé refusée (expirée ou invalide). Régénère-la sur developer.riotgames.com et colle-la dans .env.');
      err.fatal = true;
      throw err;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Erreur Riot ${res.status}`);
    return res.json();
  }
  platformGet(p) { return this.get(this.platform, p); }
  regionGet(p) { return this.get(this.region, p); }
}

// Repli si Data Dragon est injoignable : DA_18_MasterYi_AD -> "Master Yi (AD)", DA_Vi18 -> "Vi"
export const prettyId = id => String(id)
  .replace(/^(TFT\d*|DA)_/, "").replace(/^(Item|Component)_/, "").replace(/^\d+_/, "")
  .replace(/([a-z])\d+(?=_|$)/gi, "$1").replace(/_(AD|AP)$/, " ($1)")
  .replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();

// Noms français des champions, traits et objets, depuis Data Dragon (Riot). Gardés en cache.
export async function loadNames() {
  const cache = path.join(DATA, 'noms.json');
  try {
    const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    const v = versions[0];
    const base = `https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR`;
    const get = f => fetch(`${base}/${f}`).then(r => (r.ok ? r.json() : { data: {} }));
    const [ch, tr, it] = await Promise.all(['tft-champion.json', 'tft-trait.json', 'tft-item.json'].map(get));
    const names = { version: v, units: {}, traits: {}, items: {}, unitImg: {}, traitImg: {}, itemImg: {} };
    const fill = (src, nm, img) => {
      for (const o of Object.values(src.data || {})) {
        if (!o.id || !o.name) continue;
        nm[o.id] = o.name;
        if (o.image && o.image.full) img[o.id] = o.image.full;
      }
    };
    fill(ch, names.units, names.unitImg);
    fill(tr, names.traits, names.traitImg);
    fill(it, names.items, names.itemImg);
    fs.writeFileSync(cache, JSON.stringify(names));
    return names;
  } catch {
    if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
    return { units: {}, traits: {}, items: {} };
  }
}

// ---- Augments : noms et descriptions officiels en français (Data Dragon, tft-augments.json) ----
// Descriptions nettoyées : balises HTML et marqueurs %i:…% retirés, <placeholder> remplacé par « … ».
const descOf = texte => String(texte || '')
  .replace(/<placeholder>/gi, '…')
  .replace(/@[A-Za-z0-9_.*]+@/g, '?')
  .replace(/%i:[^%]+%/g, '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .replace(/ ([,.;])/g, '$1')
  .trim();
export async function loadAugments() {
  const cache = path.join(DATA, 'augments-fr.json');
  let old = null;
  try { old = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch {}
  try {
    const v = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
    if (old && old.version === v && Object.keys(old.list || {}).length && Date.now() - (old.recupere || 0) < 24 * 3600e3) return old;
    const dd = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/tft-augments.json`)).json();
    const all = Object.values(dd.data || {}).filter(a => a.id && a.name);
    const current = all.some(a => /^DA_/.test(a.id)) ? all.filter(a => /^DA_/.test(a.id)) : all;
    const list = {};
    for (const a of current) list[a.id] = { nom: a.name, img: a.image?.full || null, desc: descOf(a.description) };
    const out = { version: v, recupere: Date.now(), list };
    fs.writeFileSync(cache, JSON.stringify(out));
    return out;
  } catch {
    return old || { version: null, list: {} };
  }
}
