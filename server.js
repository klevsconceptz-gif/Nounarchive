import 'dotenv/config';
import express from 'express';
import { openStorage } from './storage.js';
import { installAdmin } from './admin.js';
import { sources } from './aggregator.js';
import {refreshArchive,REFRESH_MS} from './news-sync.js';
const app = express();
const storage = openStorage();
storage.initialize();
let archive = storage.loadArchive();
let syncing = false;
async function sync() {
 if (syncing) return; syncing = true;
 try {
 const refreshed=await refreshArchive(archive);
 storage.saveArchive(refreshed);
 archive=refreshed;
 } finally { syncing = false; }
}
app.disable('x-powered-by');
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });
app.use(express.json({limit: '100kb'}));
const admin = await installAdmin(app, storage);
app.get('/api/archive', (req, res) => res.set('Cache-Control', 'no-store').json({ ...archive, items: [...archive.items, ...admin.published()], sources: [...sources, { id: 'nounarchive', name: 'Nounarchive', url: '/' }], syncing, refreshMinutes: 60 }));
app.get('/api/health', (req, res) => res.json({ ok: storage.health(), database: 'sqlite' }));
app.use(express.static('public'));
app.use((err, req, res, next) => { console.error(err.message); if (!res.headersSent) res.status(err.status || 500).json({error: err.status === 413 ? 'Request too large.' : 'Unable to complete this request.'}); });
app.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('Nounarchive listening on port ' + (process.env.PORT || 3000)));
if (process.env.DISABLE_SYNC !== '1') { sync().catch(console.error); setInterval(() => sync().catch(console.error), REFRESH_MS); }
