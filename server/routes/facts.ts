/**
 * "Gut zu wissen": GET /api/facts?lang=de|en → { version, retrieved, help, facts: [{ id, topic, title, text, tohuus,
 * sources: [{ title, publisher, url, retrieved, note? }] }] }. Public and the same for everyone (no household data);
 * without ?lang the household language is used when there is a household, else German.
 */
import { Router } from 'express';
import { lang } from '../db.js';
import { facts, type FactLang } from '../lib/facts.js';

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
