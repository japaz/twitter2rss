const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = null;
    this.init();
  }

  init() {
    // Create database file in a persistent directory
    // For serverless, try to use /tmp directory as fallback
    const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const dbPath = isServerless 
      ? '/tmp/tweets.db' 
      : path.join(__dirname, '..', 'data', 'tweets.db');
    
    // Ensure data directory exists (only for non-serverless)
    if (!isServerless) {
      const fs = require('fs');
      const dataDir = path.dirname(dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    }

    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log(`Connected to SQLite database at ${dbPath}`);
        this.createTables();
      }
    });
  }

  createTables() {
    const createTweetsTable = `
      CREATE TABLE IF NOT EXISTS tweets (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_username TEXT NOT NULL,
        author_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        public_metrics TEXT,
        entities TEXT,
        referenced_tweets TEXT,
        fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createConfigTable = `
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for better performance
    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_tweets_fetched_at ON tweets(fetched_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_tweets_author_id ON tweets(author_id)',
      'CREATE INDEX IF NOT EXISTS idx_config_key ON config(key)'
    ];

    this.db.run(createTweetsTable);
    this.db.run(createConfigTable);
    
    // Create indexes
    createIndexes.forEach(indexQuery => {
      this.db.run(indexQuery);
    });
  }

  async saveTweets(tweets) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO tweets 
        (id, text, author_id, author_username, author_name, created_at, public_metrics, entities, referenced_tweets)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      tweets.forEach(tweet => {
        stmt.run([
          tweet.id,
          tweet.text,
          tweet.author_id,
          tweet.author_username,
          tweet.author_name,
          tweet.created_at,
          JSON.stringify(tweet.public_metrics || {}),
          JSON.stringify(tweet.entities || {}),
          JSON.stringify(tweet.referenced_tweets || [])
        ]);
      });

      stmt.finalize((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getTweets(limit = 50) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM tweets ORDER BY created_at DESC LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const tweets = rows.map(row => ({
              ...row,
              public_metrics: JSON.parse(row.public_metrics || '{}'),
              entities: JSON.parse(row.entities || '{}'),
              referenced_tweets: JSON.parse(row.referenced_tweets || '[]')
            }));
            resolve(tweets);
          }
        }
      );
    });
  }

  async getConfig(key) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT value FROM config WHERE key = ?`,
        [key],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.value : null);
        }
      );
    });
  }

  async setConfig(key, value) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [key, value],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getLatestTweetId() {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT id FROM tweets ORDER BY created_at DESC LIMIT 1`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.id : null);
        }
      );
    });
  }

  async cleanupOldTweets(retentionDays = 30) {
    return new Promise((resolve, reject) => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      this.db.run(
        'DELETE FROM tweets WHERE created_at < ?',
        [cutoffDate.toISOString()],
        function(err) {
          if (err) {
            reject(err);
          } else {
            console.log(`Cleaned up ${this.changes} old tweets`);
            resolve(this.changes);
          }
        }
      );
    });
  }

  async getTweetCount() {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT COUNT(*) as count FROM tweets', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
  }

  async getOldestTweetDate() {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT created_at FROM tweets ORDER BY created_at ASC LIMIT 1',
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.created_at : null);
        }
      );
    });
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = Database;