# Twitter List RSS Converter

Convert your Twitter/X lists into RSS feeds with automatic updates and adaptive scheduling.

## Features

- 🔄 **Adaptive Scheduling**: Automatically adjusts fetch frequency based on activity
- 📱 **Full Tweet Support**: Includes text, media, links, hashtags, and engagement metrics
- 🗄️ **SQLite Storage**: Persistent storage with optimized indexes for performance
- 🌐 **REST API**: Status monitoring, manual refresh, and cleanup endpoints
- ⚡ **Rate Limit Friendly**: Designed to work within Twitter's free tier limits
- 🚀 **Cloud Ready**: Optimized for modern cloud deployment platforms
- 📊 **Performance Monitoring**: Built-in metrics and monitoring tools
- 🧹 **Automatic Cleanup**: Data retention policies to prevent database bloat
- ⚡ **Smart Caching**: Intelligent RSS feed caching with TTL

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

### 3. Deploy to Cloud Platform

Choose one of these free deployment options:

#### Option A: Render (Recommended - Free Tier Available)

1. Fork this repository
2. Sign up at [Render](https://render.com)
3. Create a new "Web Service" from your GitHub repo
4. Set the following in Render:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment Variables**:

```bash
TWITTER_BEARER_TOKEN=your_bearer_token_here
TWITTER_LIST_ID=your_list_id_here
RSS_TITLE=My Twitter List Feed
RSS_DESCRIPTION=RSS feed from my Twitter list
RSS_SITE_URL=https://your-app-name.onrender.com
RSS_FEED_URL=https://your-app-name.onrender.com/rss
```

#### Option B: Fly.io (Free Tier Available)

1. Install [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/)
2. Run `fly auth signup` or `fly auth login`
3. In your project directory: `fly launch`
4. Set environment variables: `fly secrets set TWITTER_BEARER_TOKEN=your_token TWITTER_LIST_ID=your_list_id`

#### Option C: Vercel (Serverless - Free Tier)

1. Fork this repository
2. Sign up at [Vercel](https://vercel.com)
3. Connect your GitHub account and import your forked repository
4. Set environment variables in Vercel dashboard:
   - `TWITTER_BEARER_TOKEN`: Your Twitter API Bearer Token
   - `TWITTER_LIST_ID`: Your Twitter list ID
   - `RSS_TITLE`: Your RSS feed title (optional)
   - `RSS_DESCRIPTION`: Your RSS feed description (optional)
   - `RSS_SITE_URL`: Your Vercel app URL (e.g., `https://your-app.vercel.app`)
   - `RSS_FEED_URL`: Your RSS feed URL (e.g., `https://your-app.vercel.app/rss`)
5. Deploy automatically on push to main branch

**Note:** Vercel runs in serverless mode, so:
- No background scheduler (RSS updates on-demand when accessed)
- Database uses temporary storage (resets on cold starts)
- Best for low-traffic RSS feeds

### 4. Access Your RSS Feed

Your RSS feed will be available at:

- **Render**: `https://your-app-name.onrender.com/rss`
- **Fly.io**: `https://your-app-name.fly.dev/rss`
- **Vercel**: `https://your-app.vercel.app/rss`

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
| `RSS_CACHE_TTL` | No | 300 | RSS cache TTL in seconds |
| `MAX_TWEETS_PER_FEED` | No | 50 | Maximum tweets in RSS feed |
| `RETENTION_DAYS` | No | 30 | Days to keep tweets |
| `DEBUG` | No | false | Enable debug logging |
| `LOG_LEVEL` | No | info | Log level (debug/info/warn/error) |

### Adaptive Scheduling

The application automatically adjusts how often it checks for new tweets:

- **High Activity** (10+ new tweets): Checks more frequently (minimum interval)
- **Moderate Activity** (5-9 new tweets): Slightly reduces check frequency
- **Low Activity** (1-4 new tweets): Maintains current frequency
- **No Activity**: Gradually increases interval between checks (up to maximum)

This ensures efficient use of Twitter API rate limits while keeping the feed updated.

## Logging and Debugging

The application provides comprehensive structured logging for debugging and monitoring:

### Log Format
All logs follow a structured format with timestamps, service identification, and metadata:
```
[2025-06-28T10:30:45.123Z] [INFO] [SERVICE] Message {"key": "value"}
```

### Log Services
- **APP**: Application lifecycle and initialization
- **HTTP**: Request/response logging with performance metrics
- **RSS**: Feed generation and caching operations
- **FETCH**: Tweet fetching operations
- **TWITTER**: Twitter API interactions
- **DATABASE**: Database operations and queries
- **SCHEDULER**: Background task scheduling (server mode only)

### Debug Mode
Enable detailed debug logging by setting:
```bash
DEBUG=true
NODE_ENV=development
```

### Performance Metrics
The application automatically logs performance metrics for:
- HTTP request duration
- RSS feed generation time
- Tweet fetch operations
- Database query performance

### Error Context
All errors include comprehensive context:
- Stack traces
- Request IDs for correlation
- Operation duration
- Relevant metadata

## Deployment Modes

The application supports two deployment modes:

### Server Mode (Render, Fly.io)
- **Background Scheduler**: Automatically fetches tweets at adaptive intervals
- **Persistent Database**: SQLite database persists between restarts
- **Continuous Updates**: RSS feed updates automatically based on Twitter activity
- **Best for**: Regular RSS feed consumption, higher traffic

### Serverless Mode (Vercel)
- **On-Demand Updates**: Fetches fresh tweets only when RSS feed is requested
- **Temporary Database**: Uses `/tmp` storage, resets on cold starts
- **Fresh Data**: Always serves recent tweets (within cache TTL)
- **Best for**: Occasional RSS feed access, lower traffic

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
3. Check your deployment platform's logs for error details
4. Open an issue in the repository