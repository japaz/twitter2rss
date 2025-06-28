#!/usr/bin/env node

require('dotenv').config();
const path = require('path');
const TwitterService = require(path.join(__dirname, '..', 'src', 'twitterService'));

async function testRateLimits() {
  console.log('🧪 Testing Twitter Rate Limit Implementation\n');
  
  // Setup credentials
  const twitterCredentials = {
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET
  };
  
  const twitterService = new TwitterService(twitterCredentials);
  
  console.log('📊 Testing credential verification...');
  try {
    const isValid = await twitterService.verifyCredentials();
    console.log('✅ Credentials verified:', isValid);
    
    // Show rate limit status after verification
    const rateLimitStatus = twitterService.getRateLimitStatus();
    console.log('\n📈 Rate Limit Status after verification:');
    console.log(JSON.stringify(rateLimitStatus, null, 2));
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  }
  
  console.log('\n📝 Testing list access with rate limit handling...');
  try {
    const listInfo = await twitterService.getListInfo(process.env.TWITTER_LIST_ID);
    if (listInfo) {
      console.log('✅ List accessed successfully:', listInfo.name);
    } else {
      console.log('⚠️  List access returned null (might be rate limited)');
    }
    
    // Show rate limit status after list access
    const rateLimitStatus = twitterService.getRateLimitStatus();
    console.log('\n📈 Rate Limit Status after list access:');
    console.log(JSON.stringify(rateLimitStatus, null, 2));
    
  } catch (error) {
    console.error('❌ List access failed:', error.message);
    if (error.code === 429) {
      console.log('ℹ️  This is expected with free tier limits');
    }
  }
  
  console.log('\n✅ Rate limit test completed');
}

testRateLimits().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
