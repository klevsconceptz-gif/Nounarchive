import { DatabaseSync, backup } from 'node:sqlite';

class Database extends DatabaseSync {
 #depth = 0;
 pragma(sql) { this.exec('PRAGMA ' + sql); }
 transaction(fn) {
  return (...args) => {
   const name = 'transaction_' + this.#depth++;
   this.exec('SAVEPOINT ' + name);
   try {
    const result = fn(...args);
    this.exec('RELEASE SAVEPOINT ' + name);
    return result;
   } catch (error) {
    this.exec('ROLLBACK TO SAVEPOINT ' + name);
    this.exec('RELEASE SAVEPOINT ' + name);
    throw error;
   } finally { this.#depth--; }
  };
 }
 backup(path) { return backup(this, path); }
}
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function legacy(path, fallback) {
 try { return JSON.parse(readFileSync(path, 'utf8')); }
 catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function openStorage(filename = process.env.DATABASE_PATH || 'data/nounarchive.sqlite') {
 if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
 const db = new Database(filename);
 if (filename !== ':memory:') chmodSync(filename, 0o600);
 db.pragma('journal_mode = WAL');
 db.pragma('busy_timeout = 5000');
 db.pragma('foreign_keys = ON');
 db.exec(`
 CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, source TEXT NOT NULL, published_at TEXT, data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE INDEX IF NOT EXISTS articles_source_date ON articles(source, published_at DESC);
 CREATE TABLE IF NOT EXISTS archive_metadata (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('draft','published')), published_at TEXT, updated_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
 CREATE INDEX IF NOT EXISTS posts_status_date ON posts(status, published_at DESC);
 INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
 `);
 const insertArticle = db.prepare('INSERT INTO articles(id,source,published_at,data) VALUES(?,?,?,?)');
 const insertPost = db.prepare('INSERT INTO posts(id,status,published_at,updated_at,data) VALUES(?,?,?,?,?)');
 const saveArchive = db.transaction(archive => {
 const {items, ...meta} = archive;
 db.prepare('DELETE FROM articles').run();
 for (const item of items) insertArticle.run(item.id,item.source,item.publishedAt || null,JSON.stringify(item));
 db.prepare('INSERT INTO archive_metadata(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(meta));
 });
 const savePosts = db.transaction(posts => {
 db.prepare('DELETE FROM posts').run();
 for (const post of posts) insertPost.run(post.id,post.status,post.publishedAt || null,post.updatedAt,JSON.stringify(post));
 });
 return {
 initialize({archivePath='data/archive.json',seedPath='data/seed.json',postsPath='data/posts.json'}={}) {
 // Import only once; later changes to legacy files cannot overwrite the database.
 db.transaction(()=>{
 if (db.prepare('SELECT version FROM schema_migrations WHERE version=2').get()) return;
 if (!db.prepare('SELECT id FROM archive_metadata WHERE id=1').get()) {
 const archive=legacy(archivePath,null) || legacy(seedPath,{items:[],status:{}}); saveArchive(archive);
 }
 if (!db.prepare('SELECT id FROM posts LIMIT 1').get()) savePosts(legacy(postsPath,[]));
 db.prepare('INSERT INTO schema_migrations(version) VALUES(2)').run();
 })();
 },
 loadArchive() {const row=db.prepare('SELECT data FROM archive_metadata WHERE id=1').get();return {...(row?JSON.parse(row.data):{status:{}}),items:db.prepare('SELECT data FROM articles ORDER BY published_at DESC').all().map(r=>JSON.parse(r.data))};},
 saveArchive,
 loadPosts() {return db.prepare('SELECT data FROM posts ORDER BY updated_at DESC, id').all().map(r=>JSON.parse(r.data));},
 savePosts,
 health() {return db.prepare('SELECT 1 AS ok').get().ok === 1;},
 stats() {return {articles:db.prepare('SELECT COUNT(*) AS count FROM articles').get().count,posts:db.prepare('SELECT COUNT(*) AS count FROM posts').get().count,schemaVersion:db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version};},
 backup(path) { return db.backup(path); },
 close() {db.close();}
 };
}
