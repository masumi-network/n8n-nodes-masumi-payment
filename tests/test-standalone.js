#!/usr/bin/env node

/**
 * Standalone test script for Masumi Paywall payment logic
 * Tests the core payment functions without n8n dependencies
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').trim();
                if (key && value) {
                    process.env[key] = value;
                }
            }
        }
    }
}

// Load environment variables
loadEnv();

// Configuration from environment variables
const CONFIG = {
    paymentServiceUrl: process.env.MASUMI_PAYMENT_SERVICE_URL,
    apiKey: process.env.MASUMI_API_KEY,
    agentIdentifier: process.env.MASUMI_AGENT_IDENTIFIER,
    sellerVkey: process.env.MASUMI_SELLER_VKEY,
    network: process.env.MASUMI_NETWORK || 'Preprod',
    timeout: parseInt(process.env.MASUMI_TIMEOUT_MINUTES) || 2,
    pollInterval: parseInt(process.env.MASUMI_POLL_INTERVAL_SECONDS) || 5
};

// Validate required environment variables
function validateConfig() {
    const required = ['paymentServiceUrl', 'apiKey', 'agentIdentifier', 'sellerVkey'];
    const missing = required.filter(key => !CONFIG[key]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => console.error(`   - MASUMI_${key.toUpperCase().replace(/([A-Z])/g, '_$1')}`));
        console.error('\n📝 Please create .env file with required credentials');
        process.exit(1);
    }
}

// Core payment functions (ported from TypeScript)
function generateInputHash(inputData) {
    const inputString = inputData.input_string || 'hello world';
    return crypto.createHash('sha256').update(inputString, 'utf8').digest('hex');
}

function generateIdentifier() {
    return crypto.randomBytes(7).toString('hex');
}

function preparePaymentRequest(inputData, inputHash, identifier) {
    const now = new Date();
    const payByTime = new Date(now.getTime() + 5 * 60 * 1000);
    const submitResultTime = new Date(now.getTime() + 20 * 60 * 1000);
    
    return {
        agentIdentifier: CONFIG.agentIdentifier,
        network: CONFIG.network,
        inputHash: inputHash,
        payByTime: payByTime.toISOString(),
        metadata: `Paywall request for input: ${JSON.stringify(inputData).substring(0, 100)}`,
        paymentType: 'Web3CardanoV1',
        submitResultTime: submitResultTime.toISOString(),
        identifierFromPurchaser: identifier,
    };
}

function preparePurchaseRequest(paymentResponse, inputData, identifier) {
    const paymentData = paymentResponse.data;
    return {
        identifierFromPurchaser: identifier,
        network: CONFIG.network,
        sellerVkey: CONFIG.sellerVkey,
        paymentType: 'Web3CardanoV1',
        blockchainIdentifier: paymentData.blockchainIdentifier,
        payByTime: String(paymentData.payByTime),
        submitResultTime: String(paymentData.submitResultTime),
        unlockTime: String(paymentData.unlockTime),
        externalDisputeUnlockTime: String(paymentData.externalDisputeUnlockTime),
        agentIdentifier: CONFIG.agentIdentifier,
        inputHash: paymentData.inputHash,
    };
}

// HTTP request helper
function httpRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.url);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const requestOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };
        
        if (postData) {
            requestOptions.headers['Content-Length'] = Buffer.byteLength(postData);
        }
        
        const req = client.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response);
                } catch (e) {
                    resolve(data);
                }
            });
        });
        
        req.on('error', reject);
        
        if (postData) {
            req.write(postData);
        }
        
        req.end();
    });
}

async function createPaymentRequest(paymentRequest) {
    console.log('📤 Creating payment request...');
    console.log('Payload:', JSON.stringify(paymentRequest, null, 2));
    
    const response = await httpRequest({
        method: 'POST',
        url: `${CONFIG.paymentServiceUrl}/payment/`,
        headers: {
            'Content-Type': 'application/json',
            'token': CONFIG.apiKey,
            'accept': 'application/json',
        }
    }, JSON.stringify(paymentRequest));
    
    console.log('📥 Payment response:', JSON.stringify(response, null, 2));
    return response;
}

async function createPurchase(purchaseRequest) {
    console.log('📤 Creating purchase request...');
    console.log('Payload:', JSON.stringify(purchaseRequest, null, 2));
    
    const response = await httpRequest({
        method: 'POST', 
        url: `${CONFIG.paymentServiceUrl}/purchase/`,
        headers: {
            'Content-Type': 'application/json',
            'token': CONFIG.apiKey,
            'accept': 'application/json',
        }
    }, JSON.stringify(purchaseRequest));
    
    console.log('📥 Purchase response:', JSON.stringify(response, null, 2));
    return response;
}

async function checkPaymentStatus(inputHash, identifier) {
    const url = `${CONFIG.paymentServiceUrl}/payment/?inputHash=${inputHash}&identifierFromPurchaser=${identifier}&network=${CONFIG.network}`;
    
    const response = await httpRequest({
        method: 'GET',
        url: url,
        headers: {
            'token': CONFIG.apiKey,
            'accept': 'application/json',
        }
    });
    
    return response;
}

function evaluatePaymentStatus(statusResponse, blockchainIdentifier) {
    // find our payment in the response
    let ourPayment = null;
    if (statusResponse.data && statusResponse.data.Payments) {
        ourPayment = statusResponse.data.Payments.find(
            payment => payment.blockchainIdentifier === blockchainIdentifier
        );
    }

    let isPaymentConfirmed = false;
    let paymentStatus = 'not_found';
    let shouldContinuePolling = true;
    let isError = false;

    if (ourPayment) {
        const onChainState = ourPayment.onChainState;
        paymentStatus = onChainState || 'pending';

        // SUCCESS states - stop polling
        if (onChainState === 'FundsLocked') {
            isPaymentConfirmed = true;
            shouldContinuePolling = false;
        } else if (onChainState === 'ResultSubmitted' || onChainState === 'Withdrawn') {
            isPaymentConfirmed = true;
            shouldContinuePolling = false;
        }
        // ERROR states - stop polling with error
        else if (onChainState && ['FundsOrDatumInvalid', 'RefundRequested', 'Disputed', 'RefundWithdrawn', 'DisputedWithdrawn'].includes(onChainState)) {
            isPaymentConfirmed = false;
            shouldContinuePolling = false;
            isError = true;
        }
        // CONTINUE POLLING states - any other state or no state
        else {
            shouldContinuePolling = true;
        }
    }

    return {
        isPaymentConfirmed,
        paymentStatus,
        shouldContinuePolling,
        isError,
        ourPayment,
    };
}

async function pollPaymentStatus(inputHash, identifier, blockchainIdentifier, timeoutMinutes = 10, pollIntervalSeconds = 5) {
    console.log(`🔄 Polling payment status (timeout: ${timeoutMinutes}min, interval: ${pollIntervalSeconds}s)...`);
    
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const pollIntervalMs = pollIntervalSeconds * 1000;
    const startTime = Date.now();
    
    // Initial delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    while (Date.now() - startTime < timeoutMs) {
        try {
            console.log('🔍 Checking payment status...');
            const statusResponse = await checkPaymentStatus(inputHash, identifier);
            console.log('📊 Status response:', JSON.stringify(statusResponse, null, 2));
            
            const evaluation = evaluatePaymentStatus(statusResponse, blockchainIdentifier);
            
            // handle error states
            if (evaluation.isError) {
                console.log(`❌ Payment failed with status: ${evaluation.paymentStatus}`);
                return {
                    success: false,
                    paymentStatus: evaluation.paymentStatus,
                    error: `Payment failed with status: ${evaluation.paymentStatus}`,
                    statusResponse
                };
            }
            
            // handle success states
            if (evaluation.isPaymentConfirmed) {
                console.log(`✅ Payment confirmed! Status: ${evaluation.paymentStatus}`);
                return {
                    success: true,
                    paymentStatus: evaluation.paymentStatus,
                    statusResponse
                };
            }
            
            // continue polling if shouldContinuePolling is true
            if (!evaluation.shouldContinuePolling) {
                console.log(`⚠️ Unexpected payment status: ${evaluation.paymentStatus}`);
                return {
                    success: false,
                    paymentStatus: evaluation.paymentStatus,
                    error: `Unexpected payment status: ${evaluation.paymentStatus}`,
                    statusResponse
                };
            }
            
            console.log(`⏳ Payment pending (${evaluation.paymentStatus}), waiting ${pollIntervalSeconds}s...`);
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            
        } catch (error) {
            console.error('❌ Error checking payment status:', error.message);
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }
    }
    
    console.log('⏰ Payment timeout reached');
    return {
        success: false,
        paymentStatus: 'Timeout',
        error: 'Payment timeout reached'
    };
}

// Main test function
async function testMasumiPaywall() {
    console.log('🚀 Starting Masumi Paywall Test');
    console.log('Configuration:', JSON.stringify(CONFIG, null, 2));
    console.log('=' * 50);
    
    try {
        // Test input data
        const inputData = { input_string: 'test payment data' };
        
        // Step 1: Generate hash and identifier
        console.log('1️⃣ Generating input hash and identifier...');
        const inputHash = generateInputHash(inputData);
        const identifier = generateIdentifier();
        console.log(`Hash: ${inputHash}`);
        console.log(`Identifier: ${identifier}`);
        
        // Step 2: Prepare and create payment request
        console.log('\n2️⃣ Creating payment request...');
        const paymentRequest = preparePaymentRequest(inputData, inputHash, identifier);
        const paymentResponse = await createPaymentRequest(paymentRequest);
        
        if (!paymentResponse.data) {
            throw new Error('Invalid payment response: ' + JSON.stringify(paymentResponse));
        }
        
        // Step 3: Prepare and create purchase request
        console.log('\n3️⃣ Creating purchase request...');
        const purchaseRequest = preparePurchaseRequest(paymentResponse, inputData, identifier);
        const purchaseResponse = await createPurchase(purchaseRequest);
        
        // Step 4: Poll for payment status
        console.log('\n4️⃣ Polling for payment confirmation...');
        const blockchainIdentifier = paymentResponse.data.blockchainIdentifier;
        console.log(`Using blockchainIdentifier: ${blockchainIdentifier}`);
        const result = await pollPaymentStatus(inputHash, identifier, blockchainIdentifier, CONFIG.timeout, CONFIG.pollInterval);
        
        console.log('\n🎯 Final Result:');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('🎉 Test PASSED! Payment flow completed successfully.');
        } else {
            console.log('⚠️ Test INCOMPLETE: Payment not confirmed within timeout.');
        }
        
    } catch (error) {
        console.error('💥 Test FAILED:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Command line interface
if (require.main === module) {
    console.log('Masumi Paywall Standalone Test');
    console.log('==============================\n');
    
    // Validate configuration
    validateConfig();
    
    testMasumiPaywall();
}

module.exports = {
    generateInputHash,
    generateIdentifier, 
    preparePaymentRequest,
    preparePurchaseRequest,
    createPaymentRequest,
    createPurchase,
    checkPaymentStatus,
    evaluatePaymentStatus,
    pollPaymentStatus,
    testMasumiPaywall
};