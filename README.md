# Twitter List RSS Converter

Convert your Twitter/X lists into RSS feeds with automatic updates and adaptive scheduling.

## Features

- 🔄 **Adaptive Scheduling**: Automatically adjusts fetch frequency based on activity
- 📱 **Full Tweet Support**: Includes text, media, links, hashtags, and engagement metrics
- 🗄️ **SQLite Storage**: Persistent storage for tweets and configuration
- 🌐 **REST API**: Status monitoring and manual refresh endpoints
- ⚡ **Rate Limit Friendly**: Designed to work within Twitter's free tier limits
- 🚀 **Railway Ready**: Optimized for Railway deployment

## Quick Start

### 1. Get Twitter API Credentials

1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Create a new app (or use existing)
3. Generate a Bearer Token
4. Note down your Bearer Token

### 2. Find Your Twitter List ID

Navigate to your Twitter list in a web browser. The URL will look like:
```
https://twitter.com/i/lists/1234567890123456789
```
The number at the end (`1234567890123456789`) is your List ID.

### 3. Deploy to Railway

1. Fork this repository
2. Connect your GitHub account to [Railway](https://railway.app)
3. Create a new project from your forked repo
4. Add the following environment variables in Railway:

```bash
TWITTER_BEARER_TOKEN=your_bearer_token_here
TWITTER_LIST_ID=your_list_id_here
RSS_TITLE=My Twitter List Feed
RSS_DESCRIPTION=RSS feed from my Twitter list
RSS_SITE_URL=https://your-app.up.railway.app
RSS_FEED_URL=https://your-app.up.railway.app/rss
```

5. Deploy!

### 4. Access Your RSS Feed

Your RSS feed will be available at:
```
https://your-app.up.railway.app/rss
```

## Local Development

1. Clone the repository:
```bash
git clone <your-repo-url>
cd twitter-list-rss
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your credentials and configuration

5. Start the development server:
```bash
npm run dev
```

## API Endpoints

### GET /rss
Returns the RSS feed in XML format.

### GET /status
Returns application status including:
- Scheduler information
- Database stats
- List information
- Last update times

### POST /refresh
Manually triggers a tweet fetch and RSS update.

### GET /health
Health check endpoint for monitoring.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TWITTER_BEARER_TOKEN` | Yes | - | Your Twitter API Bearer Token |
| `TWITTER_LIST_ID` | Yes | - | The ID of the Twitter list to convert |
| `RSS_TITLE` | No | "Twitter List RSS Feed" | Title of the RSS feed |
| `RSS_DESCRIPTION` | No | Auto-generated | Description of the RSS feed |
| `RSS_SITE_URL` | No | - | Base URL of your application |
| `RSS_FEED_URL` | No | - | Full URL to the RSS feed |
| `PORT` | No | 3000 | Port for the application |
| `MIN_UPDATE_INTERVAL` | No | 60 | Minimum update interval in minutes |
| `MAX_UPDATE_INTERVAL` | No | 480 | Maximum update interval in minutes |

### Adaptive Scheduling

The application automatically adjusts how often it checks for new tweets:

- **High Activity** (10+ new tweets): Checks more frequently (minimum interval)
- **Moderate Activity** (5-9 new tweets): Slightly reduces check frequency
- **Low Activity** (1-4 new tweets): Maintains current frequency
- **No Activity**: Gradually increases interval between checks (up to maximum)

This ensures efficient use of Twitter API rate limits while keeping the feed updated.

## Twitter API Rate Limits

The free tier of Twitter API v2 includes:
- 1,500 tweet reads per month
- 50 requests per day for list endpoints

This application is designed to work within these limits through adaptive scheduling.

## Troubleshooting

### Common Issues

1. **"List not found" error**: 
   - Verify your List ID is correct
   - Ensure the list is public or your API token has access

2. **"Rate limit exceeded"**:
   - The app will automatically back off and retry
   - Consider increasing `MIN_UPDATE_INTERVAL`

3. **"Unauthorized" error**:
   - Verify your Bearer Token is correct
   - Ensure your Twitter app has the necessary permissions

### Monitoring

Check the `/status` endpoint to monitor:
- Last fetch time
- Current update interval
- Number of tweets in database
- Scheduler status

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Twitter API   │    │   Application    │    │   RSS Feed      │
│                 │◄──►│                  │◄──►│                 │
│   List Tweets   │    │  Adaptive Cron   │    │   XML Output    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   SQLite DB     │
                       │                 │
                       │ Tweet Storage   │
                       └─────────────────┘
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

If you encounter any issues:
1. Check the troubleshooting section
2. Review the `/status` endpoint output
3. Check Railway logs for error details
4. Open an issue in the repository