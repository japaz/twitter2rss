const RSS = require('rss');

class RSSService {
  constructor(config) {
    this.config = config;
  }

  generateFeed(tweets, listInfo = null) {
    const feedOptions = {
      title: this.config.title || 'Twitter List RSS Feed',
      description: this.config.description || 
        (listInfo ? `RSS feed for Twitter list: ${listInfo.name}` : 'RSS feed generated from Twitter list'),
      feed_url: this.config.feedUrl,
      site_url: this.config.siteUrl,
      generator: 'Twitter List RSS Converter',
      language: 'en',
      ttl: 60 // Cache for 60 minutes
    };

    const feed = new RSS(feedOptions);

    tweets.forEach(tweet => {
      const tweetUrl = `https://twitter.com/${tweet.author_username}/status/${tweet.id}`;
      
      // Extract URLs from entities
      const urls = tweet.entities.urls || [];
      let content = this.formatTweetContent(tweet, urls);
      
      // Add media information if present
      if (tweet.entities.media && tweet.entities.media.length > 0) {
        content += this.formatMediaContent(tweet.entities.media);
      }

      // Add metrics information
      content += this.formatMetrics(tweet.public_metrics);

      feed.item({
        title: this.generateTweetTitle(tweet),
        description: content,
        url: tweetUrl,
        guid: tweet.id,
        author: `${tweet.author_name} (@${tweet.author_username})`,
        date: new Date(tweet.created_at),
        categories: this.extractHashtags(tweet.entities)
      });
    });

    return feed.xml();
  }

  generateTweetTitle(tweet) {
    // Create a title from the first 50 characters of the tweet
    let title = tweet.text.replace(/\n/g, ' ').substring(0, 50);
    if (tweet.text.length > 50) {
      title += '...';
    }
    return `${tweet.author_name}: ${title}`;
  }

  formatTweetContent(tweet, urls) {
    let content = `<p><strong>${tweet.author_name} (@${tweet.author_username})</strong></p>`;
    
    // Format tweet text with clickable links
    let tweetText = tweet.text;
    
    // Batch replace URLs for better performance
    if (urls && urls.length > 0) {
      const urlReplacements = urls.map(urlEntity => ({
        original: urlEntity.url,
        replacement: `<a href="${urlEntity.expanded_url || urlEntity.url}" target="_blank">${urlEntity.display_url || urlEntity.url}</a>`
      }));
      
      urlReplacements.forEach(({ original, replacement }) => {
        tweetText = tweetText.replace(original, replacement);
      });
    }

    // Convert hashtags and mentions more efficiently
    tweetText = tweetText
      .replace(/#(\w+)/g, '<a href="https://twitter.com/hashtag/$1" target="_blank">#$1</a>')
      .replace(/@(\w+)/g, '<a href="https://twitter.com/$1" target="_blank">@$1</a>')
      .replace(/\n/g, '<br>');

    content += `<p>${tweetText}</p>`;

    return content;
  }

  formatMediaContent(media) {
    let mediaContent = '<div style="margin-top: 10px;">';
    
    media.forEach(item => {
      if (item.type === 'photo') {
        mediaContent += `<p><img src="${item.url}" alt="Tweet image" style="max-width: 100%; height: auto;"></p>`;
      } else if (item.type === 'video' || item.type === 'animated_gif') {
        mediaContent += `<p><a href="${item.url}" target="_blank">[${item.type.toUpperCase()}]</a></p>`;
      }
    });
    
    mediaContent += '</div>';
    return mediaContent;
  }

  formatMetrics(metrics) {
    if (!metrics || Object.keys(metrics).length === 0) {
      return '';
    }

    const metricsHtml = `
      <div style="margin-top: 15px; padding: 10px; background-color: #f5f5f5; border-radius: 5px; font-size: 0.9em;">
        <strong>Engagement:</strong> 
        ${metrics.like_count || 0} likes, 
        ${metrics.retweet_count || 0} retweets, 
        ${metrics.reply_count || 0} replies, 
        ${metrics.quote_count || 0} quotes
      </div>
    `;

    return metricsHtml;
  }

  extractHashtags(entities) {
    if (!entities.hashtags || entities.hashtags.length === 0) {
      return [];
    }
    
    return entities.hashtags.map(hashtag => hashtag.tag);
  }
}

module.exports = RSSService;