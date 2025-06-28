const { TwitterApi } = require('twitter-api-v2');

// Simple logger for Twitter service operations
const twitterLogger = {
  info: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${timestamp}] [INFO] [TWITTER] ${message}${metaStr}`);
  },
  error: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    console.error(`[${timestamp}] [ERROR] [TWITTER] ${message}${metaStr}`);
  },
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
      const timestamp = new Date().toISOString();
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      console.log(`[${timestamp}] [DEBUG] [TWITTER] ${message}${metaStr}`);
    }
  },
  warn: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    console.warn(`[${timestamp}] [WARN] [TWITTER] ${message}${metaStr}`);
  }
};

class TwitterService {
  constructor(bearerToken) {
    twitterLogger.info('Initializing Twitter service');
    this.client = new TwitterApi(bearerToken, { appContext: 'read-only' });
    this.readOnlyClient = this.client.readOnly;
    twitterLogger.info('Twitter service initialized');
  }

  async getListTweets(listId, sinceId = null) {
    const startTime = Date.now();
    twitterLogger.info('Fetching tweets from list', { 
      listId, 
      sinceId: sinceId || 'none (initial fetch)' 
    });
    
    try {
      const options = {
        max_results: 100, // Maximum allowed for free tier
        'tweet.fields': [
          'created_at',
          'public_metrics',
          'entities',
          'referenced_tweets',
          'author_id'
        ].join(','),
        'user.fields': [
          'username',
          'name',
          'verified',
          'profile_image_url'
        ].join(','),
        expansions: 'author_id,referenced_tweets.id'
      };

      if (sinceId) {
        options.since_id = sinceId;
      }

      twitterLogger.debug('API request options', { options });
      
      const response = await this.readOnlyClient.v2.listTweets(listId, options);
      
      if (!response.data || response.data.length === 0) {
        twitterLogger.info('No new tweets found in API response');
        return [];
      }

      // Create a map of users for easy lookup
      const usersMap = {};
      if (response.includes?.users) {
        response.includes.users.forEach(user => {
          usersMap[user.id] = user;
        });
        twitterLogger.debug('User information processed', { 
          userCount: response.includes.users.length 
        });
      }

      // Process tweets and add author information
      const tweets = response.data.map(tweet => {
        const author = usersMap[tweet.author_id] || {};
        return {
          id: tweet.id,
          text: tweet.text,
          author_id: tweet.author_id,
          author_username: author.username || 'unknown',
          author_name: author.name || 'Unknown User',
          author_verified: author.verified || false,
          author_profile_image: author.profile_image_url || '',
          created_at: tweet.created_at,
          public_metrics: tweet.public_metrics || {},
          entities: tweet.entities || {},
          referenced_tweets: tweet.referenced_tweets || []
        };
      });

      const duration = Date.now() - startTime;
      twitterLogger.info('Tweet fetch completed successfully', {
        listId,
        fetchedCount: tweets.length,
        duration_ms: duration,
        hasUsers: !!response.includes?.users
      });

      return tweets;

    } catch (error) {
      const duration = Date.now() - startTime;
      twitterLogger.error('Tweet fetch failed', {
        listId,
        sinceId,
        error: error.message,
        code: error.code,
        duration_ms: duration
      });
      
      // Handle specific API errors
      if (error.code === 429) {
        twitterLogger.warn('Rate limit exceeded, will retry later');
        throw new Error('Rate limit exceeded. Will retry later.');
      } else if (error.code === 404) {
        twitterLogger.error('List not found - check list ID and permissions');
        throw new Error('List not found. Please check the list ID.');
      } else if (error.code === 401) {
        twitterLogger.error('Authentication failed - check API credentials');
        throw new Error('Unauthorized. Please check your Twitter API credentials.');
      }
      
      throw error;
    }
  }

  async verifyCredentials() {
    twitterLogger.info('Verifying Twitter API credentials');
    
    try {
      const response = await this.readOnlyClient.v2.me();
      twitterLogger.info('Twitter API credentials verified successfully', {
        userId: response.data?.id,
        username: response.data?.username
      });
      return true;
    } catch (error) {
      twitterLogger.error('Failed to verify Twitter API credentials', {
        error: error.message,
        code: error.code
      });
      return false;
    }
  }

  async getListInfo(listId) {
    twitterLogger.info('Fetching list information', { listId });
    
    try {
      const response = await this.readOnlyClient.v2.list(listId, {
        'list.fields': 'name,description,member_count,follower_count'
      });
      
      twitterLogger.info('List information retrieved successfully', {
        listId,
        name: response.data?.name,
        memberCount: response.data?.member_count,
        followerCount: response.data?.follower_count
      });
      
      return response.data;
    } catch (error) {
      twitterLogger.error('Failed to fetch list information', {
        listId,
        error: error.message,
        code: error.code
      });
      return null;
    }
  }
}

module.exports = TwitterService;