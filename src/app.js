require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Enhanced logging utility
class Logger {
  static formatTimestamp() {
    return new Date().toISOString();
  }

  static formatMessage(level, service, message, metadata = {}) {
    const timestamp = this.formatTimestamp();
    const metaStr = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${service}] ${message}${metaStr}`;
  }

  static info(service, message, metadata = {}) {
    console.log(this.formatMessage('info', service, message, metadata));
  }

  static warn(service, message, metadata = {}) {
    console.warn(this.formatMessage('warn', service, message, metadata));
  }

  static error(service, message, metadata = {}) {
    console.error(this.formatMessage('error', service, message, metadata));
  }

  static debug(service, message, metadata = {}) {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
      console.log(this.formatMessage('debug', service, message, metadata));
    }
  }

  static performance(service, operation, duration, metadata = {}) {
    const perfData = { operation, duration_ms: duration, ...metadata };
    this.info(service, `Performance: ${operation} completed`, perfData);
  }
}

const Database = require('./database');
const TwitterService = require('./twitterService');
const RSSService = require('./rssService');
const AdaptiveScheduler = require('./scheduler');

class TwitterListRSS {
  constructor() {
    Logger.info('APP', 'Initializing Twitter List RSS application');
    
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
    
    Logger.info('APP', 'Deployment mode detected', { 
      mode: this.isServerless ? 'serverless' : 'server',
      cacheTimeout: this.cacheTimeout 
    });
    
    this.setupRoutes();
    this.initializeServices();
  }

  async initializeServices() {
    const startTime = Date.now();
    Logger.info('APP', 'Starting service initialization');
    
    try {
      // Validate required environment variables
      Logger.debug('APP', 'Validating configuration');
      this.validateConfig();
      Logger.info('APP', 'Configuration validation successful');
      
      // Initialize Twitter service
      Logger.info('TWITTER', 'Initializing Twitter service');
      
      // Determine authentication method based on available credentials
      let twitterCredentials;
      if (process.env.TWITTER_ACCESS_TOKEN && process.env.TWITTER_ACCESS_SECRET && 
          process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET) {
        // User Context authentication (for private lists)
        Logger.info('TWITTER', 'Using User Context authentication for private list access');
        twitterCredentials = {
          appKey: process.env.TWITTER_API_KEY,
          appSecret: process.env.TWITTER_API_SECRET,
          accessToken: process.env.TWITTER_ACCESS_TOKEN,
          accessSecret: process.env.TWITTER_ACCESS_SECRET
        };
      } else if (process.env.TWITTER_BEARER_TOKEN) {
        // Bearer Token authentication (for public lists only)
        Logger.info('TWITTER', 'Using Bearer Token authentication for public list access');
        twitterCredentials = process.env.TWITTER_BEARER_TOKEN;
      } else {
        throw new Error('No valid Twitter API credentials found. Need either Bearer Token or OAuth 1.0a credentials.');
      }
      
      this.twitterService = new TwitterService(twitterCredentials);
      
      // Verify Twitter API credentials
      Logger.info('TWITTER', 'Verifying API credentials');
      const isValid = await this.twitterService.verifyCredentials();
      if (!isValid) {
        throw new Error('Invalid Twitter API credentials');
      }
      Logger.info('TWITTER', 'API credentials verified successfully');

      // Get list information
      Logger.info('TWITTER', 'Fetching list information', { listId: process.env.TWITTER_LIST_ID });
      this.listInfo = await this.twitterService.getListInfo(process.env.TWITTER_LIST_ID);
      if (this.listInfo) {
        Logger.info('TWITTER', 'List information retrieved', {
          name: this.listInfo.name,
          memberCount: this.listInfo.member_count,
          followerCount: this.listInfo.follower_count || 'N/A'
        });
      } else {
        Logger.warn('TWITTER', 'Could not retrieve list information');
      }

      // Initialize RSS service
      Logger.info('RSS', 'Initializing RSS service');
      this.rssService = new RSSService({
        title: process.env.RSS_TITLE || 'Twitter List RSS Feed',
        description: process.env.RSS_DESCRIPTION || 'RSS feed generated from Twitter list',
        feedUrl: process.env.RSS_FEED_URL,
        siteUrl: process.env.RSS_SITE_URL
      });
      Logger.info('RSS', 'RSS service initialized');

      // Only initialize scheduler for non-serverless environments
      if (!this.isServerless) {
        const minInterval = parseInt(process.env.MIN_UPDATE_INTERVAL) || 60;
        const maxInterval = parseInt(process.env.MAX_UPDATE_INTERVAL) || 480;
        
        Logger.info('SCHEDULER', 'Initializing adaptive scheduler', {
          minInterval,
          maxInterval
        });
        
        this.scheduler = new AdaptiveScheduler(
          this.database,
          this.twitterService,
          minInterval,
          maxInterval
        );

        // Start the scheduler
        Logger.info('SCHEDULER', 'Starting scheduler');
        this.scheduler.start(this.fetchAndUpdateFeed.bind(this));
      } else {
        Logger.info('APP', 'Skipping scheduler initialization (serverless mode)');
      }

      // Generate initial RSS feed
      Logger.info('RSS', 'Generating initial RSS feed');
      await this.generateRSSFeed();

      const duration = Date.now() - startTime;
      Logger.performance('APP', 'Service initialization', duration, {
        mode: this.isServerless ? 'serverless' : 'server',
        schedulerEnabled: !this.isServerless
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error('APP', 'Service initialization failed', {
        error: error.message,
        stack: error.stack,
        duration_ms: duration
      });
      
      if (!this.isServerless) {
        process.exit(1);
      }
      throw error;
    }
  }

  validateConfig() {
    // Always require TWITTER_LIST_ID
    if (!process.env.TWITTER_LIST_ID) {
      throw new Error('Missing required environment variable: TWITTER_LIST_ID');
    }
    
    // Check for either Bearer Token OR OAuth 1.0a credentials
    const hasBearerToken = !!process.env.TWITTER_BEARER_TOKEN;
    const hasOAuthCredentials = !!(
      process.env.TWITTER_API_KEY && 
      process.env.TWITTER_API_SECRET && 
      process.env.TWITTER_ACCESS_TOKEN && 
      process.env.TWITTER_ACCESS_SECRET
    );
    
    if (!hasBearerToken && !hasOAuthCredentials) {
      throw new Error(`Missing Twitter API credentials. You need either:
1. TWITTER_BEARER_TOKEN (for public lists), OR
2. All OAuth 1.0a credentials for private lists:
   - TWITTER_API_KEY
   - TWITTER_API_SECRET  
   - TWITTER_ACCESS_TOKEN
   - TWITTER_ACCESS_SECRET`);
    }
    
    Logger.info('APP', 'Authentication method determined', {
      method: hasBearerToken ? (hasOAuthCredentials ? 'OAuth (preferred for private lists)' : 'Bearer Token (public lists only)') : 'OAuth (private lists)',
      canAccessPrivateLists: hasOAuthCredentials
    });
  }

  setupRoutes() {
    this.app.use(cors());
    this.app.use(express.json());

    // Request logging middleware
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      const requestId = Math.random().toString(36).substr(2, 9);
      req.requestId = requestId;
      
      Logger.info('HTTP', 'Request received', {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress
      });

      // Override res.end to log response
      const originalEnd = res.end;
      res.end = function(...args) {
        const duration = Date.now() - startTime;
        Logger.performance('HTTP', 'Request completed', duration, {
          requestId,
          method: req.method,
          url: req.url,
          statusCode: res.statusCode
        });
        originalEnd.apply(this, args);
      };

      next();
    });

    // RSS feed endpoint
    this.app.get('/rss', async (req, res) => {
      const startTime = Date.now();
      Logger.info('RSS', 'RSS feed requested', { requestId: req.requestId });
      
      try {
        // Check if cache is still valid
        const now = Date.now();
        const cacheAge = this.lastCacheUpdate ? (now - this.lastCacheUpdate) / 1000 : Infinity;
        
        Logger.debug('RSS', 'Cache status check', {
          requestId: req.requestId,
          cacheAge: Math.round(cacheAge),
          cacheTimeout: this.cacheTimeout,
          isExpired: cacheAge > this.cacheTimeout
        });
        
        if (!this.cachedRSSFeed || cacheAge > this.cacheTimeout) {
          Logger.info('RSS', 'Cache miss or expired, generating fresh feed', { requestId: req.requestId });
          
          // In serverless, always fetch fresh data
          if (this.isServerless) {
            Logger.info('RSS', 'Serverless mode: fetching fresh data', { requestId: req.requestId });
            await this.fetchAndUpdateFeed();
          }
          await this.generateRSSFeed();
        } else {
          Logger.info('RSS', 'Serving cached RSS feed', { 
            requestId: req.requestId,
            cacheAge: Math.round(cacheAge)
          });
        }
        
        res.set('Content-Type', 'application/rss+xml');
        res.send(this.cachedRSSFeed);
        
        const duration = Date.now() - startTime;
        Logger.performance('RSS', 'RSS feed served', duration, {
          requestId: req.requestId,
          feedLength: this.cachedRSSFeed?.length || 0
        });
        
      } catch (error) {
        const duration = Date.now() - startTime;
        Logger.error('RSS', 'Failed to serve RSS feed', {
          requestId: req.requestId,
          error: error.message,
          stack: error.stack,
          duration_ms: duration
        });
        res.status(500).json({ error: 'Failed to generate RSS feed' });
      }
    });

    // Status endpoint
    this.app.get('/status', async (req, res) => {
      Logger.info('STATUS', 'Status request received', { requestId: req.requestId });
      
      try {
        const schedulerStatus = this.scheduler ? await this.scheduler.getStatus() : {
          isRunning: false,
          mode: 'serverless',
          currentInterval: 'on-demand'
        };
        const tweetCount = await this.getTweetCount();
        
        const statusData = {
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
        };
        
        Logger.debug('STATUS', 'Status data compiled', {
          requestId: req.requestId,
          tweetCount,
          cacheStatus: statusData.cache
        });
        
        res.json(statusData);
      } catch (error) {
        Logger.error('STATUS', 'Failed to get status', {
          requestId: req.requestId,
          error: error.message,
          stack: error.stack
        });
        res.status(500).json({ error: 'Failed to get status' });
      }
    });

    // Manual refresh endpoint
    this.app.post('/refresh', async (req, res) => {
      Logger.info('REFRESH', 'Manual refresh requested', { requestId: req.requestId });
      
      try {
        const result = await this.fetchAndUpdateFeed();
        
        Logger.info('REFRESH', 'Manual refresh completed', {
          requestId: req.requestId,
          newTweets: result.newTweets,
          totalTweets: result.totalTweets
        });
        
        res.json({
          success: true,
          message: `Fetched ${result.newTweets} new tweets`,
          result
        });
      } catch (error) {
        Logger.error('REFRESH', 'Manual refresh failed', {
          requestId: req.requestId,
          error: error.message,
          stack: error.stack
        });
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
    const startTime = Date.now();
    Logger.info('FETCH', 'Starting tweet fetch operation');
    
    try {
      // Get the latest tweet ID from database
      const sinceId = await this.database.getLatestTweetId();
      Logger.debug('FETCH', 'Retrieved latest tweet ID from database', { sinceId });
      
      // Fetch new tweets
      Logger.info('TWITTER', 'Fetching tweets from Twitter API', {
        listId: process.env.TWITTER_LIST_ID,
        sinceId: sinceId || 'none (initial fetch)'
      });
      
      const tweets = await this.twitterService.getListTweets(
        process.env.TWITTER_LIST_ID,
        sinceId
      );

      let newTweetsCount = 0;

      if (tweets.length > 0) {
        Logger.info('FETCH', 'New tweets found, saving to database', { count: tweets.length });
        
        // Save new tweets to database
        await this.database.saveTweets(tweets);
        newTweetsCount = tweets.length;
        
        // Clear cache to force regeneration
        this.cachedRSSFeed = null;
        this.lastCacheUpdate = null;
        
        Logger.info('FETCH', 'Tweets saved successfully, cache invalidated', { newTweetsCount });
      } else {
        Logger.info('FETCH', 'No new tweets found');
      }

      const totalTweets = await this.getTweetCount();
      const duration = Date.now() - startTime;
      
      const result = {
        success: true,
        newTweets: newTweetsCount,
        totalTweets,
        timestamp: new Date().toISOString()
      };

      Logger.performance('FETCH', 'Tweet fetch operation completed', duration, {
        newTweets: newTweetsCount,
        totalTweets,
        hadUpdates: newTweetsCount > 0
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error('FETCH', 'Tweet fetch operation failed', {
        error: error.message,
        stack: error.stack,
        duration_ms: duration
      });
      throw error;
    }
  }

  async generateRSSFeed() {
    const startTime = Date.now();
    Logger.info('RSS', 'Starting RSS feed generation');
    
    try {
      // Get latest tweets from database
      const maxTweets = parseInt(process.env.MAX_TWEETS_PER_FEED) || 50;
      Logger.debug('RSS', 'Fetching tweets for RSS feed', { maxTweets });
      
      const tweets = await this.database.getTweets(maxTweets);
      Logger.info('RSS', 'Tweets retrieved from database', { count: tweets.length });
      
      if (tweets.length === 0) {
        Logger.warn('RSS', 'No tweets found in database, generating empty feed');
        this.cachedRSSFeed = this.rssService.generateFeed([], this.listInfo);
      } else {
        Logger.debug('RSS', 'Generating RSS feed with tweets');
        this.cachedRSSFeed = this.rssService.generateFeed(tweets, this.listInfo);
      }
      
      // Update cache timestamp
      this.lastCacheUpdate = Date.now();
      
      // Store update timestamp in database
      await this.database.setConfig('last_rss_update', new Date().toISOString());
      
      const duration = Date.now() - startTime;
      Logger.performance('RSS', 'RSS feed generation completed', duration, {
        tweetCount: tweets.length,
        feedSize: this.cachedRSSFeed.length,
        cacheTimeout: this.cacheTimeout
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error('RSS', 'RSS feed generation failed', {
        error: error.message,
        stack: error.stack,
        duration_ms: duration
      });
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
      Logger.info('TwitterListRSS', `Twitter List RSS server running on port ${port}`);
      Logger.info('TwitterListRSS', `RSS feed available at: http://localhost:${port}/rss`);
      Logger.info('TwitterListRSS', `Status page available at: http://localhost:${port}/status`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      Logger.info('TwitterListRSS', 'Shutting down gracefully...');
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
