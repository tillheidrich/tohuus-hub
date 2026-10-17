/**
 * "Gut zu wissen": GET /api/facts?lang=de|en → { version, retrieved, help, facts: [{ id, topic, title, text, tohuus,
 * sources: [{ title, publisher, url, retrieved, note? }] }] }. Public and the same for everyone (no household data);
 * without ?lang the household language is used when there is a household, else German.
 */
import { Router } from 'express';
import { lang } from '../db.js';
import { facts, type FactLang } from '../lib/facts.js';
import { config } from '../config.js';
import RATGEBER from '../data/ratgeber.json';

export const r = Router();

r.get('/facts', (req, res) => {
  let l: FactLang = 'de';
  if (req.query.lang === 'en' || req.query.lang === 'de') l = req.query.lang;
  else {
    try {
      l = lang() === 'en' ? 'en' : 'de';
    } catch {
      /* no household (cloud, signed out) */
    }
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(facts(l));
});

/**
 * Ratgeber cards (14 Oct 2026): the website's guide posts for the apps – GET /api/ratgeber?area=zuhause,kopf →
 * { posts: [{ slug, title, teaser, area, date, url }] }. Public, German posts (server/data/ratgeber.json, built by
 * scripts/ratgeber-cards.mjs). The article itself opens on the website.
 */
r.get('/ratgeber', (req, res) => {
  const areas = String(req.query.area ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const base = config.siteUrl.replace(/\/$/, '');
  const posts = (RATGEBER.posts as { slug: string; title: string; teaser: string; area: string; date: string }[])
    .filter((p) => !areas.length || areas.includes(p.area))
    .map((p) => ({ ...p, url: `${base}/ratgeber/${p.slug}.html` }));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ posts });
});
