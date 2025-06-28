// Simple test to verify Vercel compatibility
const request = require('supertest');
const app = require('../api/index');

// Mock environment variables for testing
process.env.TWITTER_BEARER_TOKEN = 'test_token';
process.env.TWITTER_LIST_ID = '123456789';
process.env.VERCEL = '1'; // Force serverless mode

describe('Vercel Serverless Functions', () => {
  test('Health endpoint should work', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
    
    expect(response.body.status).toBe('healthy');
    expect(response.body.mode).toBe('serverless');
  });

  test('Root endpoint should show serverless mode', async () => {
    const response = await request(app)
      .get('/')
      .expect(200);
    
    expect(response.body.mode).toBe('serverless');
    expect(response.body.name).toBe('Twitter List RSS Converter');
  });
});
