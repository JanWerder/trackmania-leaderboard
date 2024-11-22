import { Database } from 'bun:sqlite';

export async function initializeDatabase() {
    const db = new Database('trackmania_wrapped.db');
    
    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');
    
    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS maps (
            uid TEXT PRIMARY KEY,
            day INTEGER NOT NULL,
            month INTEGER NOT NULL,
            year INTEGER NOT NULL,
            bronze_time INTEGER NOT NULL,
            silver_time INTEGER NOT NULL,
            gold_time INTEGER NOT NULL,
            author_time INTEGER NOT NULL,
            thumbnail_url TEXT
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            map_uid TEXT NOT NULL,
            user_id TEXT NOT NULL,
            time INTEGER NOT NULL,
            medal TEXT NOT NULL,
            position INTEGER NOT NULL,
            FOREIGN KEY(map_uid) REFERENCES maps(uid),
            UNIQUE(map_uid, user_id)
        )
    `);
    
    return db;
} 