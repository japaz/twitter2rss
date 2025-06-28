require('dotenv').config();
const express = require('express');
const cors = require('cors');

const Database = require('./database');
const TwitterService = require('./twitterService');
const RSSService = require('./rssService');
const AdaptiveScheduler = require('./scheduler');

class TwitterListRSS {
  constructor() {
    this.app = express();
    this.database = new Database();
    this.twitterService = null;
    this.rssService = null;
    this.scheduler = null;
    this.cachedRSSFeed = null;
    this.listInfo = null;
    this.isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
    this.lastCacheUpdate = null;
    this.cacheTimeout = parseInt(process.env.RSS_CACHE_TTL) || 300; // 5 minutes default
    
    this.setupRoutes();
    this.initializeServices();
  }

  async initializeServices() {
    try {
      // Validate required environment variables
      this.validateConfig();
      
      // Initialize Twitter service
      this.twitterService = new TwitterService(process.env.TWITTER_BEARER_TOKEN);
      
      // Verify Twitter API credentials
      const isValid = await this.twitterService.verifyCredentials();
      if (!isValid) {
        throw new Error('Invalid Twitter API credentials');
      }

      // Get list information
      this.listInfo = await this.twitterService.getListInfo(process.env.TWITTER_LIST_ID);
      if (this.listInfo) {
        console.log(`Connected to list: ${this.listInfo.name} (${this.listInfo.member_count} members)`);
      }

      // Initialize RSS service
      this.rssService = new RSSService({
        title: process.env.RSS_TITLE || 'Twitter List RSS Feed',
        description: process.env.RSS_DESCRIPTION || 'RSS feed generated from Twitter list',
        feedUrl: process.env.RSS_FEED_URL,
        siteUrl: process.env.RSS_SITE_URL
      });

      // Only initialize scheduler for non-serverless environments
      if (!this.isServerless) {
        const minInterval = parseInt(process.env.MIN_UPDATE_INTERVAL) || 60;
        const maxInterval = parseInt(process.env.MAX_UPDATE_INTERVAL) || 480;
        
        this.scheduler = new AdaptiveScheduler(
          this.database,
          this.twitterService,
          minInterval,
          maxInterval
        );

        // Start the scheduler
        this.scheduler.start(this.fetchAndUpdateFeed.bind(this));
      }

      // Generate initial RSS feed
      await this.generateRSSFeed();

      console.log(`Services initialized successfully (${this.isServerless ? 'serverless' : 'server'} mode)`);

    } catch (error) {
      console.error('Failed to initialize services:', error.message);
      if (!this.isServerless) {
        process.exit(1);
      }
    }
  }

  validateConfig() {
    const required = ['TWITTER_BEARER_TOKEN', 'TWITTER_LIST_ID'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  setupRoutes() {
    this.app.use(cors());
    this.app.use(express.json());

    // RSS feed endpoint
    this.app.get('/rss', async (req, res) => {
      try {
        // Check if cache is still valid
        const now = Date.now();
        const cacheAge = this.lastCacheUpdate ? (now - this.lastCacheUpdate) / 1000 : Infinity;
        
        if (!this.cachedRSSFeed || cacheAge > this.cacheTimeout) {
          // In serverless, always fetch fresh data
          if (this.isServerless) {
            await this.fetchAndUpdateFeed();
          }
          await this.generateRSSFeed();
        }
        
        res.set('Content-Type', 'application/rss+xml');
        res.send(this.cachedRSSFeed);
      } catch (error) {
        console.error('Error serving RSS feed:', error);
        res.status(500).json({ error: 'Failed to generate RSS feed' });
      }
    });

    // Status endpoint
    this.app.get('/status', async (req, res) => {
      try {
        const schedulerStatus = this.scheduler ? await this.scheduler.getStatus() : {
          isRunning: false,
          mode: 'serverless',
          currentInterval: 'on-demand'
        };
        const tweetCount = await this.getTweetCount();
        
        res.json({
          status: 'running',
          mode: this.isServerless ? 'serverless' : 'server',
          listInfo: this.listInfo,
          scheduler: schedulerStatus,
          database: {
            totalTweets: tweetCount
          },
          cache: {
            lastUpdate: this.lastCacheUpdate ? new Date(this.lastCacheUpdate).toISOString() : null,
            ttl: this.cacheTimeout
          },
          lastUpdated: await this.database.getConfig('last_rss_update')
        });
      } catch (error) {
        console.error('Error getting status:', error);
        res.status(500).json({ error: 'Failed to get status' });
      }
    });

    // Manual refresh endpoint
    this.app.post('/refresh', async (req, res) => {
      try {
        console.log('Manual refresh requested');
        const result = await this.fetchAndUpdateFeed();
        res.json({
          success: true,
          message: `Fetched ${result.newTweets} new tweets`,
          result
        });
      } catch (error) {
        console.error('Manual refresh failed:', error);
        res.status(500).json({ 
          error: 'Refresh failed', 
          message: error.message 
        });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        mode: this.isServerless ? 'serverless' : 'server'
      });
    });

    // Root endpoint with basic info
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Twitter List RSS Converter',
        version: '1.0.0',
        mode: this.isServerless ? 'serverless' : 'server',
        endpoints: {
          rss: '/rss',
          status: '/status',
          refresh: 'POST /refresh',
          health: '/health'
        }
      });
    });
  }

  async fetchAndUpdateFeed() {
    try {
      console.log('Fetching tweets from Twitter...');
      
      // Get the latest tweet ID from database
      const sinceId = await this.database.getLatestTweetId();
      
      // Fetch new tweets
      const tweets = await this.twitterService.getListTweets(
        process.env.TWITTER_LIST_ID,
        sinceId
      );

      let newTweetsCount = 0;

      if (tweets.length > 0) {
        // Save new tweets to database
        await this.database.saveTweets(tweets);
        newTweetsCount = tweets.length;
        
        // Clear cache to force regeneration
        this.cachedRSSFeed = null;
        this.lastCacheUpdate = null;
        
        console.log(`Successfully processed ${newTweetsCount} new tweets`);
      } else {
        console.log('No new tweets found');
      }

      return {
        success: true,
        newTweets: newTweetsCount,
        totalTweets: await this.getTweetCount(),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error in fetchAndUpdateFeed:', error.message);
      throw error;
    }
  }

  async generateRSSFeed() {
    try {
      // Get latest tweets from database
      const maxTweets = parseInt(process.env.MAX_TWEETS_PER_FEED) || 50;
      const tweets = await this.database.getTweets(maxTweets);
      
      if (tweets.length === 0) {
        this.cachedRSSFeed = this.rssService.generateFeed([], this.listInfo);
      } else {
        this.cachedRSSFeed = this.rssService.generateFeed(tweets, this.listInfo);
      }
      
      // Update cache timestamp
      this.lastCacheUpdate = Date.now();
      
      // Store update timestamp in database
      await this.database.setConfig('last_rss_update', new Date().toISOString());
      
      console.log(`RSS feed generated with ${tweets.length} tweets (cached for ${this.cacheTimeout}s)`);
    } catch (error) {
      console.error('Error generating RSS feed:', error);
      throw error;
    }
  }

  async getTweetCount() {
    return new Promise((resolve, reject) => {
      this.database.db.get('SELECT COUNT(*) as count FROM tweets', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
  }

  // For serverless compatibility, return the app instance
  getApp() {
    return this.app;
  }

  // For traditional server deployment
  start() {
    const port = process.env.PORT || 3000;
    
    this.app.listen(port, () => {
      console.log(`Twitter List RSS server running on port ${port}`);
      console.log(`RSS feed available at: http://localhost:${port}/rss`);
      console.log(`Status page available at: http://localhost:${port}/status`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('Shutting down gracefully...');
      if (this.scheduler) {
        this.scheduler.stop();
      }
      if (this.database) {
        this.database.close();
      }
      process.exit(0);
    });
  }
}

// Export for both serverless and traditional deployment
const twitterRSS = new TwitterListRSS();

// For serverless (Vercel)
module.exports = twitterRSS.getApp();

// For traditional server deployment
if (require.main === module) {
  twitterRSS.start();
}
