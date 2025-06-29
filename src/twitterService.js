const { TwitterApi } = require('twitter-api-v2');
const RateLimitManager = require('./rateLimitManager');

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
  constructor(credentials) {
    twitterLogger.info('Initializing Twitter service');
    
    this.rateLimitManager = new RateLimitManager();
    
    // Support both Bearer Token (App-Only) and User Context authentication
    if (typeof credentials === 'string') {
      // Bearer Token only (App-Only auth) - for public lists
      twitterLogger.info('Using Bearer Token authentication (App-Only)');
      this.client = new TwitterApi(credentials, { appContext: 'read-only' });
      this.authType = 'app-only';
    } else if (credentials && credentials.appKey && credentials.appSecret) {
      // User Context authentication - for private lists
      twitterLogger.info('Using User Context authentication');
      this.client = new TwitterApi({
        appKey: credentials.appKey,
        appSecret: credentials.appSecret,
        accessToken: credentials.accessToken,
        accessSecret: credentials.accessSecret,
      });
      this.authType = 'user-context';
    } else {
      throw new Error('Invalid credentials provided. Need either Bearer Token or full OAuth 1.0a credentials.');
    }
    
    this.readOnlyClient = this.client.readOnly;
    twitterLogger.info('Twitter service initialized', { authType: this.authType });
  }

  async getListTweets(listId, sinceId = null) {
    const startTime = Date.now();
    const endpoint = '/2/lists/:id/tweets';
    
    twitterLogger.info('Fetching tweets from list', { 
      listId, 
      sinceId: sinceId || 'none (initial fetch)' 
    });
    
    try {
      const response = await this.makeRequestWithRetry(endpoint, async () => {
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
        
        return await this.readOnlyClient.v2.listTweets(listId, options);
      });
      
      // Check if we have any tweets in the response
      if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
        twitterLogger.info('No new tweets found in API response', {
          listId,
          hasData: !!response.data,
          dataType: response.data ? typeof response.data : 'undefined',
          dataLength: response.data ? response.data.length : 'N/A'
        });
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

  /**
   * Wrapper method to handle rate limiting and retries using Twitter's official recommendations
   * Based on: https://docs.x.com/x-api/fundamentals/rate-limits
   * Conservative retry strategy for free tier usage
   */
  async makeRequestWithRetry(endpoint, requestFunction, maxRetries = 2) {
    let attempt = 0;
    let lastError;

    while (attempt <= maxRetries) {
      try {
        // Check rate limits before making request using Twitter's headers
        await this.rateLimitManager.waitForRateLimit(endpoint);
        
        twitterLogger.debug('Making API request', { 
          endpoint, 
          attempt: attempt + 1, 
          maxRetries: maxRetries + 1 
        });

        // Make the actual request
        const response = await requestFunction();
        
        // Extract Twitter's official rate limit headers from the response
        // The twitter-api-v2 library exposes rate limit info differently
        let rateLimitHeaders = {};
        
        // Check various possible locations for rate limit info
        if (response.rateLimit) {
          // twitter-api-v2 exposes rate limit directly
          rateLimitHeaders = {
            'x-rate-limit-limit': response.rateLimit.limit,
            'x-rate-limit-remaining': response.rateLimit.remaining,
            'x-rate-limit-reset': response.rateLimit.reset
          };
          twitterLogger.debug('Found rate limit info in response.rateLimit', rateLimitHeaders);
        } else if (response._rateLimit) {
          // Alternative location
          rateLimitHeaders = {
            'x-rate-limit-limit': response._rateLimit.limit,
            'x-rate-limit-remaining': response._rateLimit.remaining,
            'x-rate-limit-reset': response._rateLimit.reset
          };
          twitterLogger.debug('Found rate limit info in response._rateLimit', rateLimitHeaders);
        } else if (response.headers) {
          // Direct header access
          rateLimitHeaders = {
            'x-rate-limit-limit': response.headers['x-rate-limit-limit'],
            'x-rate-limit-remaining': response.headers['x-rate-limit-remaining'],
            'x-rate-limit-reset': response.headers['x-rate-limit-reset']
          };
          twitterLogger.debug('Found rate limit info in response.headers', rateLimitHeaders);
        } else {
          // Log the response structure for debugging
          twitterLogger.debug('No rate limit info found, response keys:', {
            responseKeys: Object.keys(response),
            hasData: !!response.data,
            hasIncludes: !!response.includes
          });
        }
        
        // Update rate limit manager with Twitter's official headers
        if (rateLimitHeaders['x-rate-limit-limit']) {
          this.rateLimitManager.updateFromHeaders(endpoint, rateLimitHeaders);
          twitterLogger.debug('Updated rate limit info from Twitter headers', {
            endpoint,
            limit: rateLimitHeaders['x-rate-limit-limit'],
            remaining: rateLimitHeaders['x-rate-limit-remaining'],
            reset: new Date(parseInt(rateLimitHeaders['x-rate-limit-reset']) * 1000).toISOString()
          });
        }
        
        // Record the successful request
        this.rateLimitManager.recordRequest(endpoint);
        
        return response;
        
      } catch (error) {
        lastError = error;
        
        if (error.code === 429) {
          // Rate limit exceeded - use Twitter's recommended retry mechanism
          twitterLogger.warn('Rate limit exceeded, implementing Twitter-recommended retry', {
            endpoint,
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            errorMessage: error.message
          });
          
          if (attempt < maxRetries) {
            // Use Twitter's official retry mechanism
            await this.rateLimitManager.handleRetryDelay(endpoint, attempt, error);
          }
        } else {
          // Non-rate-limit error, don't retry
          twitterLogger.error('Non-rate-limit error, not retrying', {
            endpoint,
            attempt: attempt + 1,
            errorCode: error.code,
            errorMessage: error.message
          });
          break;
        }
        
        attempt++;
      }
    }
    
    // Log final failure
    twitterLogger.error('Request failed after all retries', {
      endpoint,
      totalAttempts: attempt,
      maxRetries: maxRetries + 1,
      finalError: lastError.message,
      finalErrorCode: lastError.code
    });
    
    throw lastError;
  }

  async verifyCredentials() {
    twitterLogger.info('Verifying Twitter API credentials', { authType: this.authType });
    
    try {
      if (this.authType === 'user-context') {
        // For User Context, we can use /me endpoint
        const endpoint = '/2/users/me';
        
        const response = await this.makeRequestWithRetry(endpoint, async () => {
          twitterLogger.debug('Testing User Context authentication with /2/users/me endpoint');
          return await this.readOnlyClient.v2.me({
            'user.fields': 'id,username,name,verified,public_metrics'
          });
        });
        
        twitterLogger.info('User Context authentication verified successfully', {
          userId: response.data?.id,
          username: response.data?.username,
          name: response.data?.name,
          verified: response.data?.verified
        });
        
        return true;
      } else {
        // For App-Only (Bearer Token), use public user endpoint
        const endpoint = '/2/users/:id';
        
        const response = await this.makeRequestWithRetry(endpoint, async () => {
          twitterLogger.debug('Testing Bearer Token with public API access');
          return await this.readOnlyClient.v2.user('783214', {
            'user.fields': 'id,username,name,verified,public_metrics'
          });
        });
        
        twitterLogger.info('Bearer Token authentication verified successfully', {
          testUser: response.data?.username,
          apiAccess: 'confirmed'
        });
        
        return true;
      }
    } catch (error) {
      twitterLogger.error('Failed to verify Twitter API credentials', {
        error: error.message,
        code: error.code,
        authType: this.authType,
        data: error.data || 'No additional error data'
      });
      
      // Provide more specific error messages
      if (error.code === 403) {
        if (this.authType === 'app-only') {
          twitterLogger.error('Bearer Token access forbidden - possible causes:', {
            causes: [
              'Bearer token is invalid or expired',
              'App does not have required permissions',
              'App is suspended or restricted',
              'Wrong API access level (need Essential or higher)',
              'Trying to access private content with Bearer Token (use User Context instead)'
            ]
          });
        } else {
          twitterLogger.error('User Context access forbidden - possible causes:', {
            causes: [
              'OAuth tokens are invalid or expired',
              'User has revoked app access',
              'App does not have required permissions',
              'App is suspended or restricted'
            ]
          });
        }
      } else if (error.code === 401) {
        twitterLogger.error('Authentication failed - credentials are likely invalid');
      } else if (error.code === 429) {
        twitterLogger.error('Rate limit exceeded during credential verification');
      }
      
      return false;
    }
  }

  async getListInfo(listId) {
    const endpoint = '/2/lists/:id';
    twitterLogger.info('Fetching list information', { listId });
    
    try {
      const response = await this.makeRequestWithRetry(endpoint, async () => {
        return await this.readOnlyClient.v2.list(listId, {
          'list.fields': 'name,description,member_count,follower_count'
        });
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

  /**
   * Get current rate limit status for debugging
   */
  getRateLimitStatus(endpoint = null) {
    if (endpoint) {
      return this.rateLimitManager.getRateLimitStatus(endpoint);
    }
    
    // Return status for all tracked endpoints
    const allStatus = {};
    const endpoints = ['/2/users/me', '/2/lists/:id', '/2/lists/:id/tweets'];
    
    endpoints.forEach(ep => {
      allStatus[ep] = this.rateLimitManager.getRateLimitStatus(ep);
    });
    
    return allStatus;
  }
}

module.exports = TwitterService;