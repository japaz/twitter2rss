#!/usr/bin/env node

require('dotenv').config();
const path = require('path');
const TwitterService = require(path.join(__dirname, '..', 'src', 'twitterService'));

async function basicVerification() {
  console.log('🔍 Twitter List RSS - Basic Credential Verification\n');
  
  // Check environment variables
  console.log('📋 Checking environment variables...');
  
  // Always require list ID
  if (!process.env.TWITTER_LIST_ID) {
    console.error('❌ Missing required environment variable: TWITTER_LIST_ID');
    process.exit(1);
  }
  
  // Check for authentication credentials
  const hasBearerToken = !!process.env.TWITTER_BEARER_TOKEN;
  const hasOAuthCredentials = !!(
    process.env.TWITTER_API_KEY && 
    process.env.TWITTER_API_SECRET && 
    process.env.TWITTER_ACCESS_TOKEN && 
    process.env.TWITTER_ACCESS_SECRET
  );
  
  if (!hasBearerToken && !hasOAuthCredentials) {
    console.error('❌ Missing Twitter API credentials.');
    process.exit(1);
  }
  
  console.log('✅ Required environment variables present');
  
  // Determine authentication method
  let authMethod, twitterCredentials;
  if (hasOAuthCredentials) {
    authMethod = 'OAuth 1.0a (can access private lists)';
    twitterCredentials = {
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET
    };
    
    console.log('🔐 Using OAuth 1.0a authentication (private lists supported)');
  } else {
    authMethod = 'Bearer Token (public lists only)';
    twitterCredentials = process.env.TWITTER_BEARER_TOKEN;
    console.log('🔑 Using Bearer Token authentication (public lists only)');
  }
  
  console.log('🔑 Testing Twitter API credentials (basic check only)...');
  
  try {
    const twitterService = new TwitterService(twitterCredentials);
    const isValid = await twitterService.verifyCredentials();
    
    if (!isValid) {
      console.error('❌ Twitter API credential verification failed');
      process.exit(1);
    }
    
    console.log('✅ Twitter API credentials verified successfully');
    console.log('\n⚠️  IMPORTANT: Essential (Free) Tier Limitations:');
    console.log('   • List access: 1 request per 15 minutes');
    console.log('   • Tweet fetching: Very limited on free tier');
    console.log('   • Your app will work, but updates will be infrequent');
    console.log('   • Consider upgrading to Basic ($100/month) for better limits');
    
    console.log('\n📝 Your setup is ready! Here\'s what to expect:');
    console.log('   • RSS feed will update slowly due to rate limits');
    console.log('   • First few requests may fail due to rate limiting');
    console.log('   • The app will automatically retry with proper delays');
    console.log('   • Check your RSS feed at: http://localhost:3000/rss');
    
    console.log('\n🚀 To start your RSS server:');
    console.log('   npm start');
    
    console.log('\n💡 Pro tip: The free tier is best for:');
    console.log('   • Testing and development');
    console.log('   • Low-traffic RSS feeds');
    console.log('   • Personal use with infrequent updates');
    
  } catch (error) {
    console.error('❌ Setup verification failed:', error.message);
    process.exit(1);
  }
}

// Run the basic verification
basicVerification().catch(error => {
  console.error('❌ Unexpected error during verification:', error);
  process.exit(1);
});
