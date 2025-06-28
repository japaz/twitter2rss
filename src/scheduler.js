const cron = require('node-cron');

class AdaptiveScheduler {
  constructor(database, twitterService, minInterval = 60, maxInterval = 480) {
    this.database = database;
    this.twitterService = twitterService;
    this.minInterval = minInterval; // minutes
    this.maxInterval = maxInterval; // minutes
    this.currentInterval = minInterval;
    this.task = null;
    this.isRunning = false;
    this.consecutiveEmptyFetches = 0;
    this.lastFetchTime = null;
  }

  start(fetchFunction) {
    console.log(`Starting adaptive scheduler with initial interval: ${this.currentInterval} minutes`);
    
    // Run immediately on start
    this.runFetch(fetchFunction);
    
    // Schedule recurring task
    this.scheduleNext(fetchFunction);
  }

  async runFetch(fetchFunction) {
    if (this.isRunning) {
      console.log('Fetch already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    this.lastFetchTime = new Date();

    try {
      console.log(`Running scheduled fetch at ${this.lastFetchTime.toISOString()}`);
      const result = await fetchFunction();
      
      // Adapt interval based on results
      this.adaptInterval(result);
      
      // Store metrics
      await this.database.setConfig('last_fetch_time', this.lastFetchTime.toISOString());
      await this.database.setConfig('current_interval', this.currentInterval.toString());
      await this.database.setConfig('consecutive_empty_fetches', this.consecutiveEmptyFetches.toString());
      
    } catch (error) {
      console.error('Scheduled fetch failed:', error.message);
      
      // On error, slightly increase interval to avoid hitting rate limits
      this.currentInterval = Math.min(this.currentInterval * 1.2, this.maxInterval);
      
    } finally {
      this.isRunning = false;
      
      // Schedule next run
      this.scheduleNext(fetchFunction);
    }
  }

  adaptInterval(result) {
    const newTweetsCount = result.newTweets || 0;
    
    if (newTweetsCount > 0) {
      // Found new tweets - reset empty fetch counter and potentially decrease interval
      this.consecutiveEmptyFetches = 0;
      
      if (newTweetsCount >= 10) {
        // Lots of activity - check more frequently
        this.currentInterval = Math.max(this.currentInterval * 0.8, this.minInterval);
      } else if (newTweetsCount >= 5) {
        // Moderate activity - slight decrease
        this.currentInterval = Math.max(this.currentInterval * 0.9, this.minInterval);
      }
      // else: keep current interval for low activity (1-4 tweets)
      
    } else {
      // No new tweets - increase interval
      this.consecutiveEmptyFetches++;
      
      if (this.consecutiveEmptyFetches >= 3) {
        // Multiple empty fetches - significantly increase interval
        this.currentInterval = Math.min(this.currentInterval * 1.5, this.maxInterval);
      } else if (this.consecutiveEmptyFetches >= 1) {
        // First or second empty fetch - slightly increase interval
        this.currentInterval = Math.min(this.currentInterval * 1.2, this.maxInterval);
      }
    }

    console.log(`Adaptive scheduling: ${newTweetsCount} new tweets, ${this.consecutiveEmptyFetches} consecutive empty fetches, next interval: ${this.currentInterval} minutes`);
  }

  scheduleNext(fetchFunction) {
    // Clear existing task
    if (this.task) {
      this.task.stop();
    }

    // Convert minutes to cron expression
    const cronExpression = `*/${Math.round(this.currentInterval)} * * * *`;
    
    console.log(`Scheduling next fetch with cron expression: ${cronExpression}`);
    
    this.task = cron.schedule(cronExpression, () => {
      this.runFetch(fetchFunction);
    }, {
      scheduled: true,
      timezone: "UTC"
    });
  }

  async getStatus() {
    const lastFetchTime = await this.database.getConfig('last_fetch_time');
    const storedInterval = await this.database.getConfig('current_interval');
    const storedEmptyFetches = await this.database.getConfig('consecutive_empty_fetches');

    return {
      isRunning: this.isRunning,
      currentInterval: this.currentInterval,
      lastFetchTime: lastFetchTime ? new Date(lastFetchTime) : null,
      consecutiveEmptyFetches: parseInt(storedEmptyFetches) || 0,
      nextFetchEstimate: this.lastFetchTime ? 
        new Date(this.lastFetchTime.getTime() + (this.currentInterval * 60 * 1000)) : 
        new Date()
    };
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log('Scheduler stopped');
    }
  }

  // Method to manually trigger a fetch (useful for testing)
  async triggerManualFetch(fetchFunction) {
    console.log('Manual fetch triggered');
    await this.runFetch(fetchFunction);
  }
}

module.exports = AdaptiveScheduler;