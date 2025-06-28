#!/usr/bin/env node

/**
 * Performance monitoring script for Twitter List RSS
 * Usage: node scripts/monitor.js
 */

const http = require('http');

class PerformanceMonitor {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.metrics = {
      responseTime: [],
      memoryUsage: [],
      timestamp: Date.now()
    };
  }

  async makeRequest(endpoint) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const url = `${this.baseUrl}${endpoint}`;
      
      http.get(url, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
        });
        
        res.on('end', () => {
          const responseTime = Date.now() - startTime;
          resolve({
            statusCode: res.statusCode,
            responseTime,
            data: endpoint === '/status' ? JSON.parse(data) : data
          });
        });
      }).on('error', reject);
    });
  }

  async runHealthCheck() {
    try {
      const health = await this.makeRequest('/health');
      const status = await this.makeRequest('/status');
      
      console.log('=== Performance Health Check ===');
      console.log(`Health endpoint: ${health.responseTime}ms`);
      console.log(`Status endpoint: ${status.responseTime}ms`);
      
      if (status.data) {
        console.log(`\nApplication Status:`);
        console.log(`- Total tweets: ${status.data.database?.totalTweets || 'N/A'}`);
        console.log(`- RSS Generation Time: ${status.data.performance?.rssGenerationTime || 'N/A'}ms`);
        console.log(`- Last Fetch Time: ${status.data.performance?.lastFetchTime || 'N/A'}ms`);
        console.log(`- Total Requests: ${status.data.performance?.totalRequests || 'N/A'}`);
        console.log(`- Cache Age: ${status.data.cache?.cacheAge || 'N/A'}ms`);
        console.log(`- Current Interval: ${status.data.scheduler?.currentInterval || 'N/A'} minutes`);
      }
      
      return true;
    } catch (error) {
      console.error('Health check failed:', error.message);
      return false;
    }
  }

  async runLoadTest(requests = 10) {
    console.log(`\n=== Running Load Test (${requests} requests) ===`);
    
    const promises = [];
    for (let i = 0; i < requests; i++) {
      promises.push(this.makeRequest('/rss'));
    }
    
    const startTime = Date.now();
    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;
    
    const responseTimes = results.map(r => r.responseTime);
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const maxResponseTime = Math.max(...responseTimes);
    const minResponseTime = Math.min(...responseTimes);
    
    console.log(`Total time: ${totalTime}ms`);
    console.log(`Average response time: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`Min response time: ${minResponseTime}ms`);
    console.log(`Max response time: ${maxResponseTime}ms`);
    console.log(`Requests per second: ${(requests / (totalTime / 1000)).toFixed(2)}`);
    
    return {
      totalTime,
      avgResponseTime,
      maxResponseTime,
      minResponseTime,
      requestsPerSecond: requests / (totalTime / 1000)
    };
  }

  async runContinuousMonitoring(intervalSeconds = 30, durationMinutes = 5) {
    console.log(`\n=== Starting Continuous Monitoring ===`);
    console.log(`Interval: ${intervalSeconds}s, Duration: ${durationMinutes}m`);
    
    const endTime = Date.now() + (durationMinutes * 60 * 1000);
    const metrics = [];
    
    while (Date.now() < endTime) {
      try {
        const status = await this.makeRequest('/status');
        const rss = await this.makeRequest('/rss');
        
        const metric = {
          timestamp: new Date().toISOString(),
          statusResponseTime: status.responseTime,
          rssResponseTime: rss.responseTime,
          memoryUsage: process.memoryUsage(),
          ...(status.data?.performance || {})
        };
        
        metrics.push(metric);
        console.log(`${metric.timestamp}: Status(${metric.statusResponseTime}ms) RSS(${metric.rssResponseTime}ms)`);
        
        await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
      } catch (error) {
        console.error('Monitoring error:', error.message);
      }
    }
    
    return metrics;
  }
}

// CLI interface
if (require.main === module) {
  const monitor = new PerformanceMonitor();
  const command = process.argv[2];
  
  switch (command) {
    case 'health':
      monitor.runHealthCheck();
      break;
    case 'load':
      const requests = parseInt(process.argv[3]) || 10;
      monitor.runLoadTest(requests);
      break;
    case 'monitor':
      const interval = parseInt(process.argv[3]) || 30;
      const duration = parseInt(process.argv[4]) || 5;
      monitor.runContinuousMonitoring(interval, duration);
      break;
    default:
      console.log('Usage:');
      console.log('  node scripts/monitor.js health           - Run health check');
      console.log('  node scripts/monitor.js load [requests]  - Run load test');
      console.log('  node scripts/monitor.js monitor [interval] [duration] - Continuous monitoring');
  }
}

module.exports = PerformanceMonitor;
