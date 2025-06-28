
const sqlite3 = require('sqlite3');
const Database = require('./database');

// Mock the Database class to prevent its original constructor from running and creating file-based DBs
jest.mock('./database', () => {
    const originalModule = jest.requireActual('./database');
    return jest.fn().mockImplementation(() => {
        const instance = new originalModule();
        // Replace the init method with a mock to prevent file IO
        instance.init = jest.fn();
        return instance;
    });
});

describe('Database', () => {
  let dbInstance;
  let db; // Holds the raw sqlite3 database connection

  beforeEach((done) => {
    dbInstance = new Database();
    // Create a new in-memory database for each test to ensure isolation
    db = new sqlite3.Database(':memory:', (err) => {
      if (err) return done(err);
      // Assign the ready, in-memory db to our service instance
      dbInstance.db = db;
      // Use serialize to ensure table creation commands run in order and complete
      db.serialize(() => {
        // Manually run the table creation queries from database.js
        db.run(`
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
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, done); // Call done() in the callback of the LAST command to signal completion
      });
    });
  });

  afterEach((done) => {
    db.close(done);
  });

  it('should save and retrieve tweets', async () => {
    const tweets = [
      { id: '1', text: 'Tweet 1', author_id: '101', author_username: 'user1', author_name: 'User One', created_at: '2025-01-01T00:00:00Z' },
      { id: '2', text: 'Tweet 2', author_id: '102', author_username: 'user2', author_name: 'User Two', created_at: '2025-01-01T01:00:00Z' },
    ];
    await dbInstance.saveTweets(tweets);
    const retrievedTweets = await dbInstance.getTweets(2);
    expect(retrievedTweets).toHaveLength(2);
    expect(retrievedTweets[0].id).toBe('2');
  });

  it('should save and retrieve config', async () => {
    await dbInstance.setConfig('test_key', 'test_value');
    const value = await dbInstance.getConfig('test_key');
    expect(value).toBe('test_value');
  });

  it('should get the latest tweet ID', async () => {
    const tweets = [
      { id: '1', created_at: '2025-06-26T10:00:00Z', text: 'Older', author_id: '1', author_name: 'a', author_username: 'a' },
      { id: '2', created_at: '2025-06-26T11:00:00Z', text: 'Newer', author_id: '2', author_name: 'b', author_username: 'b' },
    ];
    await dbInstance.saveTweets(tweets);
    const latestId = await dbInstance.getLatestTweetId();
    expect(latestId).toBe('2');
  });

  it('should return null for latest tweet ID if no tweets exist', async () => {
    const latestId = await dbInstance.getLatestTweetId();
    expect(latestId).toBeNull();
  });
});
