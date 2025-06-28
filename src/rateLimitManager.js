/**
 * Rate Limit Manager for Twitter API v2
 * Implements Twitter's official rate limit handling recommendations
 * Based on: https://docs.x.com/x-api/fundamentals/rate-limits
 */

// Simple logger for rate limit operations
const rateLimitLogger = {
  info: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${timestamp}] [INFO] [RATE-LIMIT] ${message}${metaStr}`);
  },
  warn: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    console.warn(`[${timestamp}] [WARN] [RATE-LIMIT] ${message}${metaStr}`);
  },
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
      const timestamp = new Date().toISOString();
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      console.log(`[${timestamp}] [DEBUG] [RATE-LIMIT] ${message}${metaStr}`);
    }
  }
};

class RateLimitManager {
  constructor() {
    this.rateLimits = new Map(); // endpoint -> limit info from headers
    this.lastRequests = new Map(); // endpoint -> last request timestamp
  }

  /**
   * Update rate limit info from Twitter API response headers
   * Uses official Twitter headers: x-rate-limit-limit, x-rate-limit-remaining, x-rate-limit-reset
   */
  updateFromHeaders(endpoint, headers) {
    const limit = parseInt(headers['x-rate-limit-limit']);
    const remaining = parseInt(headers['x-rate-limit-remaining']);
    const reset = parseInt(headers['x-rate-limit-reset']) * 1000; // Convert to milliseconds

    if (!isNaN(limit) && !isNaN(remaining) && !isNaN(reset)) {
      const normalizedEndpoint = this.normalizeEndpoint(endpoint);
      
      this.rateLimits.set(normalizedEndpoint, {
        limit,
        remaining,
        reset,
        lastUpdated: Date.now()
      });

      rateLimitLogger.debug('Rate limit info updated from headers', {
        endpoint: normalizedEndpoint,
        limit,
        remaining,
        resetTime: new Date(reset).toISOString(),
        windowEndsIn: Math.round((reset - Date.now()) / 1000 / 60) + ' minutes'
      });
    }
  }

  /**
   * Check if we can make a request based on Twitter's official headers
   */
  canMakeRequest(endpoint) {
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);
    const rateLimit = this.rateLimits.get(normalizedEndpoint);
    
    if (rateLimit) {
      const now = Date.now();
      
      // Check if reset time has passed (window has reset)
      if (now >= rateLimit.reset) {
        rateLimitLogger.debug('Rate limit window has reset', {
          endpoint: normalizedEndpoint,
          resetWasAt: new Date(rateLimit.reset).toISOString()
        });
        this.rateLimits.delete(normalizedEndpoint);
        return { canRequest: true, waitTime: 0, reason: 'window_reset' };
      }
      
      // Check remaining requests in current window
      if (rateLimit.remaining <= 0) {
        const waitTime = rateLimit.reset - now;
        const waitMinutes = Math.ceil(waitTime / 60000);
        
        rateLimitLogger.warn('Rate limit exceeded, must wait for window reset', {
          endpoint: normalizedEndpoint,
          resetTime: new Date(rateLimit.reset).toISOString(),
          waitTimeMs: waitTime,
          waitMinutes: waitMinutes
        });
        
        return { 
          canRequest: false, 
          waitTime: Math.max(waitTime, 0),
          reason: 'rate_limit_exceeded',
          resetTime: rateLimit.reset,
          remaining: rateLimit.remaining
        };
      }
      
      rateLimitLogger.debug('Request allowed within current window', {
        endpoint: normalizedEndpoint,
        remaining: rateLimit.remaining,
        limit: rateLimit.limit
      });
      
      return { 
        canRequest: true, 
        waitTime: 0, 
        reason: 'within_limits',
        remaining: rateLimit.remaining 
      };
    }
    
    // No rate limit info available - proceed cautiously
    rateLimitLogger.debug('No rate limit info available, proceeding cautiously', {
      endpoint: normalizedEndpoint
    });
    
    return { canRequest: true, waitTime: 0, reason: 'no_limit_info' };
  }

  /**
   * Record that a request was made and update remaining count
   */
  recordRequest(endpoint) {
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);
    const now = Date.now();
    
    this.lastRequests.set(normalizedEndpoint, now);
    
    // Decrease remaining count if we have rate limit info
    const rateLimit = this.rateLimits.get(normalizedEndpoint);
    if (rateLimit && rateLimit.remaining > 0) {
      rateLimit.remaining--;
      
      rateLimitLogger.debug('Request recorded, remaining count updated', {
        endpoint: normalizedEndpoint,
        remainingAfterRequest: rateLimit.remaining,
        resetTime: new Date(rateLimit.reset).toISOString()
      });
    }
  }

  /**
   * Wait for rate limit to reset based on Twitter's x-rate-limit-reset header
   */
  async waitForRateLimit(endpoint) {
    const { canRequest, waitTime, reason, resetTime } = this.canMakeRequest(endpoint);
    
    if (!canRequest && waitTime > 0) {
      const waitMinutes = Math.ceil(waitTime / 60000);
      const resetDate = new Date(resetTime);
      
      rateLimitLogger.warn('Waiting for rate limit window to reset', {
        endpoint: this.normalizeEndpoint(endpoint),
        waitTimeMs: waitTime,
        waitMinutes: waitMinutes,
        resetTime: resetDate.toISOString(),
        reason: reason
      });
      
      // Wait until the exact reset time plus a small buffer (1 second)
      await this.sleep(waitTime + 1000);
      
      rateLimitLogger.info('Rate limit wait completed', {
        endpoint: this.normalizeEndpoint(endpoint),
        actualWaitTime: waitTime + 1000
      });
    }
  }

  /**
   * Implement exponential backoff as recommended by Twitter
   * Used as fallback when reset time is not available
   */
  calculateExponentialBackoff(attempt, baseDelay = 1000, maxDelay = 15 * 60 * 1000) {
    // Exponential backoff: baseDelay * 2^attempt, capped at maxDelay
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    return delay + Math.random() * 1000; // Add jitter to avoid thundering herd
  }

  /**
   * Handle retry logic combining Twitter's recommended approaches
   */
  async handleRetryDelay(endpoint, attempt, error) {
    const { canRequest, waitTime, resetTime } = this.canMakeRequest(endpoint);
    
    if (!canRequest && resetTime) {
      // Use Twitter's official reset time
      await this.waitForRateLimit(endpoint);
    } else {
      // Fallback to exponential backoff
      const backoffDelay = this.calculateExponentialBackoff(attempt);
      
      rateLimitLogger.warn('Using exponential backoff as fallback', {
        endpoint: this.normalizeEndpoint(endpoint),
        attempt: attempt,
        backoffDelay: backoffDelay,
        reason: 'no_reset_time_available'
      });
      
      await this.sleep(backoffDelay);
    }
  }

  /**
   * Normalize endpoint for rate limit tracking
   */
  normalizeEndpoint(endpoint) {
    // Convert specific IDs to generic patterns for consistent tracking
    return endpoint
      .replace(/\/\d+/g, '/:id')
      .replace(/\/users\/[^\/]+\//, '/users/:id/')
      .replace(/\/lists\/[^\/]+\//, '/lists/:id/');
  }

  /**
   * Sleep for specified milliseconds
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current rate limit status for an endpoint
   */
  getRateLimitStatus(endpoint) {
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);
    const rateLimit = this.rateLimits.get(normalizedEndpoint);
    
    if (rateLimit) {
      const now = Date.now();
      const timeUntilReset = Math.max(0, rateLimit.reset - now);
      
      return {
        hasInfo: true,
        limit: rateLimit.limit,
        remaining: rateLimit.remaining,
        reset: rateLimit.reset,
        timeUntilReset: timeUntilReset,
        windowActive: now < rateLimit.reset
      };
    }
    
    return { hasInfo: false };
  }
}

module.exports = RateLimitManager;
