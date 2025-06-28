const { TwitterApi } = require('twitter-api-v2');

class TwitterService {
  constructor(bearerToken) {
    this.client = new TwitterApi(bearerToken, { appContext: 'read-only' });
    this.readOnlyClient = this.client.readOnly;
  }

  async getListTweets(listId, sinceId = null) {
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

      console.log(`Fetching tweets for list ${listId}${sinceId ? ` since ${sinceId}` : ''}`);
      
      const response = await this.readOnlyClient.v2.listTweets(listId, options);
      
      if (!response.data || response.data.length === 0) {
        console.log('No new tweets found');
        return [];
      }

      // Create a map of users for easy lookup
      const usersMap = {};
      if (response.includes?.users) {
        response.includes.users.forEach(user => {
          usersMap[user.id] = user;
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

      console.log(`Fetched ${tweets.length} tweets`);
      return tweets;

    } catch (error) {
      console.error('Error fetching tweets:', error);
      
      // Handle specific API errors
      if (error.code === 429) {
        throw new Error('Rate limit exceeded. Will retry later.');
      } else if (error.code === 404) {
        throw new Error('List not found. Please check the list ID.');
      } else if (error.code === 401) {
        throw new Error('Unauthorized. Please check your Twitter API credentials.');
      }
      
      throw error;
    }
  }

  async verifyCredentials() {
    try {
      const response = await this.readOnlyClient.v2.me();
      console.log('Twitter API credentials verified successfully');
      return true;
    } catch (error) {
      console.error('Failed to verify Twitter API credentials:', error.message);
      return false;
    }
  }

  async getListInfo(listId) {
    try {
      const response = await this.readOnlyClient.v2.list(listId, {
        'list.fields': 'name,description,member_count,follower_count'
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching list info:', error);
      return null;
    }
  }
}

module.exports = TwitterService;