const { createHash, randomBytes } = require('crypto');
const https = require('https');
const http = require('http');
require('dotenv').config();

// configuration from .env file
const credentials = {
    paymentServiceUrl: process.env.MASUMI_PAYMENT_SERVICE_URL || 'https://masumi-payment-service.up.railway.app/api/v1',
    apiKey: process.env.MASUMI_API_KEY,
    agentIdentifier: process.env.MASUMI_AGENT_IDENTIFIER,
    sellerVkey: process.env.MASUMI_SELLER_VKEY,
    network: process.env.MASUMI_NETWORK || 'Preprod'
};

// mock n8n context for standalone testing
const mockContext = {
    helpers: {
        httpRequest: async (options) => {
            return new Promise((resolve, reject) => {
                const url = new URL(options.url);
                const isHttps = url.protocol === 'https:';
                const client = isHttps ? https : http;
                
                const requestOptions = {
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + (url.search || ''),
                    method: options.method,
                    headers: options.headers,
                };

                const req = client.request(requestOptions, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try {
                            if (options.json) {
                                resolve(JSON.parse(data));
                            } else {
                                resolve(data);
                            }
                        } catch (err) {
                            reject(new Error(`Failed to parse JSON: ${err.message}`));
                        }
                    });
                });

                req.on('error', reject);

                if (options.body && options.method !== 'GET') {
                    req.write(JSON.stringify(options.body));
                }

                req.end();
            });
        }
    },
    getNode: () => ({ name: 'Test Node' })
};

// helper functions (copied from node)
function generateInputHash(inputData) {
    const inputString = inputData.input_string || 'hello world';
    return createHash('sha256').update(inputString, 'utf8').digest('hex');
}

function generateIdentifier() {
    return randomBytes(7).toString('hex');
}

function preparePaymentRequest(inputData, inputHash, identifier, credentials) {
    const now = new Date();
    const payByTime = new Date(now.getTime() + 5 * 60 * 1000);
    const payByTimeIso = payByTime.toISOString();
    const submitResultTime = new Date(now.getTime() + 20 * 60 * 1000);
    const submitResultTimeIso = submitResultTime.toISOString();

    return {
        agentIdentifier: credentials.agentIdentifier,
        network: credentials.network,
        inputHash: inputHash,
        payByTime: payByTimeIso,
        metadata: `Paywall request for input: ${JSON.stringify(inputData).substring(0, 100)}`,
        paymentType: 'Web3CardanoV1',
        submitResultTime: submitResultTimeIso,
        identifierFromPurchaser: identifier,
    };
}

async function createPaymentRequest(paymentRequest, credentials) {
    const options = {
        method: 'POST',
        url: `${credentials.paymentServiceUrl}/payment/`,
        headers: {
            'Content-Type': 'application/json',
            'token': credentials.apiKey,
            'accept': 'application/json',
        },
        body: paymentRequest,
        json: true,
    };

    const response = await mockContext.helpers.httpRequest(options);
    return response;
}

function preparePurchaseRequest(paymentResponse, inputData, identifier, credentials) {
    const paymentData = paymentResponse.data;
    
    const payByTimeMillis = String(paymentData.payByTime);
    const submitResultTimeMillis = String(paymentData.submitResultTime);
    const unlockTimeMillis = String(paymentData.unlockTime);
    const externalDisputeUnlockTimeMillis = String(paymentData.externalDisputeUnlockTime);

    return {
        identifierFromPurchaser: identifier,
        network: credentials.network,
        sellerVkey: credentials.sellerVkey,
        paymentType: 'Web3CardanoV1',
        blockchainIdentifier: paymentData.blockchainIdentifier,
        payByTime: payByTimeMillis,
        submitResultTime: submitResultTimeMillis,
        unlockTime: unlockTimeMillis,
        externalDisputeUnlockTime: externalDisputeUnlockTimeMillis,
        agentIdentifier: credentials.agentIdentifier,
        inputHash: paymentData.inputHash,
    };
}

async function createPurchase(purchaseRequest, credentials) {
    const options = {
        method: 'POST',
        url: `${credentials.paymentServiceUrl}/purchase/`,
        headers: {
            'Content-Type': 'application/json',
            'token': credentials.apiKey,
            'accept': 'application/json',
        },
        body: purchaseRequest,
        json: true,
    };

    const response = await mockContext.helpers.httpRequest(options);
    return response;
}

async function checkPaymentStatus(credentials) {
    const options = {
        method: 'GET',
        url: `${credentials.paymentServiceUrl}/payment/`,
        headers: {
            'accept': 'application/json',
            'token': credentials.apiKey,
        },
        qs: {
            limit: '10',
            network: credentials.network,
            includeHistory: 'false',
        },
        json: true,
    };

    // manually add query parameters to URL
    const url = new URL(options.url);
    url.searchParams.append('limit', '10');
    url.searchParams.append('network', credentials.network);
    url.searchParams.append('includeHistory', 'false');
    options.url = url.toString();

    const response = await mockContext.helpers.httpRequest(options);
    return response;
}

async function checkPurchaseStatus(credentials) {
    const options = {
        method: 'GET',
        url: `${credentials.paymentServiceUrl}/purchase/`,
        headers: {
            'accept': 'application/json',
            'token': credentials.apiKey,
        },
        qs: {
            limit: '10',
            network: credentials.network,
            includeHistory: 'false',
        },
        json: true,
    };

    // manually add query parameters to URL
    const url = new URL(options.url);
    url.searchParams.append('limit', '10');
    url.searchParams.append('network', credentials.network);
    url.searchParams.append('includeHistory', 'false');
    options.url = url.toString();

    const response = await mockContext.helpers.httpRequest(options);
    return response;
}

function evaluatePaymentStatus(statusResponse, blockchainIdentifier) {
    let ourPayment = null;
    
    // check both Payments (from /payment/) and Purchases (from /purchase/)
    if (statusResponse.data) {
        if (statusResponse.data.Payments) {
            ourPayment = statusResponse.data.Payments.find(
                payment => payment.blockchainIdentifier === blockchainIdentifier
            );
        } else if (statusResponse.data.Purchases) {
            ourPayment = statusResponse.data.Purchases.find(
                purchase => purchase.blockchainIdentifier === blockchainIdentifier
            );
        }
    }

    let isPaymentConfirmed = false;
    let paymentStatus = 'not_found';
    let shouldContinuePolling = true;
    let isError = false;

    if (ourPayment) {
        const onChainState = ourPayment.onChainState;
        paymentStatus = onChainState || 'pending';

        if (onChainState === 'FundsLocked') {
            isPaymentConfirmed = true;
            shouldContinuePolling = false;
        } else if (onChainState === 'ResultSubmitted' || onChainState === 'Withdrawn') {
            isPaymentConfirmed = true;
            shouldContinuePolling = false;
        } else if (onChainState && ['FundsOrDatumInvalid', 'RefundRequested', 'Disputed', 'RefundWithdrawn', 'DisputedWithdrawn'].includes(onChainState)) {
            isPaymentConfirmed = false;
            shouldContinuePolling = false;
            isError = true;
        } else {
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

async function pollPaymentStatus(credentials, blockchainIdentifier, timeout, pollInterval, hasPurchase = false) {
    const startTime = Date.now();
    const timeoutMs = timeout * 60 * 1000;
    const intervalMs = pollInterval * 1000;

    await new Promise(resolve => setTimeout(resolve, 2000));

    while (Date.now() - startTime < timeoutMs) {
        try {
            // if we made a purchase, check purchase status; otherwise check payment status
            const statusResponse = hasPurchase ? 
                await checkPurchaseStatus(credentials) : 
                await checkPaymentStatus(credentials);
            const evaluation = evaluatePaymentStatus(statusResponse, blockchainIdentifier);

            console.log(`Polling ${hasPurchase ? 'purchase' : 'payment'} status: ${evaluation.paymentStatus} (${evaluation.isPaymentConfirmed ? 'confirmed' : 'pending'})`);

            if (evaluation.isError) {
                throw new Error(`Payment failed with status: ${evaluation.paymentStatus}`);
            }

            if (evaluation.isPaymentConfirmed) {
                return {
                    isPaymentConfirmed: true,
                    paymentStatus: evaluation.paymentStatus,
                };
            }

            if (!evaluation.shouldContinuePolling) {
                throw new Error(`Unexpected payment status: ${evaluation.paymentStatus}`);
            }

            await new Promise(resolve => setTimeout(resolve, intervalMs));
        } catch (error) {
            if (error.message.includes('Payment failed') || error.message.includes('Unexpected')) {
                throw error;
            }
            console.error('Error polling payment status:', error.message);
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }

    try {
        const statusResponse = hasPurchase ? 
            await checkPurchaseStatus(credentials) : 
            await checkPaymentStatus(credentials);
        const evaluation = evaluatePaymentStatus(statusResponse, blockchainIdentifier);
        return {
            isPaymentConfirmed: evaluation.isPaymentConfirmed,
            paymentStatus: `timeout_${evaluation.paymentStatus}`,
        };
    } catch (error) {
        throw new Error(`Payment timeout exceeded and status check failed: ${error.message}`);
    }
}

// main test function
async function testDualMode(operationMode, skipPurchase = false) {
    console.log(`\n=== Testing ${operationMode} mode${skipPurchase ? ' (skipPurchase=true)' : ''} ===`);
    
    try {
        const inputData = { input_string: 'test payment data' };
        const timeout = 2; // 2 minutes for testing
        const pollInterval = 10; // 10 seconds
        
        // 1. generate input hash and identifier
        const inputHash = generateInputHash(inputData);
        const identifier = generateIdentifier();
        
        console.log(`Input hash: ${inputHash}`);
        console.log(`Identifier: ${identifier}`);

        // 2. prepare and create payment request
        const paymentRequest = preparePaymentRequest(inputData, inputHash, identifier, credentials);
        console.log('Creating payment request...');
        const paymentResponse = await createPaymentRequest(paymentRequest, credentials);
        console.log(`Payment created with blockchain ID: ${paymentResponse.data.blockchainIdentifier}`);

        // if createPaymentOnly mode, return payment data immediately
        if (operationMode === 'createPaymentOnly') {
            const result = {
                success: true,
                operationMode: 'createPaymentOnly',
                inputHash,
                identifier,
                paymentData: {
                    blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
                    payByTime: paymentResponse.data.payByTime,
                    submitResultTime: paymentResponse.data.submitResultTime,
                    unlockTime: paymentResponse.data.unlockTime,
                    externalDisputeUnlockTime: paymentResponse.data.externalDisputeUnlockTime,
                    agentIdentifier: credentials.agentIdentifier,
                    sellerVkey: credentials.sellerVkey,
                    network: credentials.network,
                    amounts: [{ unit: 'lovelace', amount: 1000000 }]
                },
                timestamp: new Date().toISOString(),
            };
            
            console.log('Payment-only mode result:');
            console.log(JSON.stringify(result, null, 2));
            return result;
        }

        // for fullFlow mode, continue with purchase and polling
        let purchaseData = null;
        
        if (!skipPurchase) {
            console.log('Creating purchase request...');
            const purchaseRequest = preparePurchaseRequest(paymentResponse, inputData, identifier, credentials);
            purchaseData = await createPurchase(purchaseRequest, credentials);
            console.log('Purchase created successfully');
        } else {
            console.log('Skipping purchase creation (skipPurchase=true)');
        }

        // 4. poll for payment status
        console.log('Starting payment status polling...');
        const finalResult = await pollPaymentStatus(
            credentials,
            paymentResponse.data.blockchainIdentifier,
            timeout,
            pollInterval,
            !skipPurchase  // if we didn't skip purchase, we made a purchase, so check purchase status
        );

        const result = {
            success: true,
            operationMode: 'fullFlow',
            isPaymentConfirmed: finalResult.isPaymentConfirmed,
            paymentStatus: finalResult.paymentStatus,
            blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
            identifier,
            inputHash,
            originalInput: inputData,
            paymentData: paymentResponse.data,
            purchaseData,
            skipPurchase,
            timestamp: new Date().toISOString(),
        };

        console.log('Full flow result:');
        console.log(JSON.stringify(result, null, 2));
        return result;

    } catch (error) {
        console.error(`Test failed: ${error.message}`);
        return {
            success: false,
            error: error.message,
            operationMode,
            skipPurchase
        };
    }
}

// run tests
async function runTests() {
    // validate credentials
    if (!credentials.apiKey || !credentials.agentIdentifier || !credentials.sellerVkey) {
        console.error('Missing required credentials. Please check your .env file.');
        console.error('Required: MASUMI_API_KEY, MASUMI_AGENT_IDENTIFIER, MASUMI_SELLER_VKEY');
        process.exit(1);
    }

    console.log('Starting dual-mode tests...');
    console.log(`Service URL: ${credentials.paymentServiceUrl}`);
    console.log(`Network: ${credentials.network}`);
    console.log(`Agent ID: ${credentials.agentIdentifier}`);

    const results = [];

    // test 1: createPaymentOnly mode (sokosumi mode)
    const result1 = await testDualMode('createPaymentOnly');
    results.push(result1);

    // test 2: fullFlow mode with skipPurchase (testing mode)
    const result2 = await testDualMode('fullFlow', true);
    results.push(result2);

    // test 3: fullFlow mode normal (actual purchase mode)
    const result3 = await testDualMode('fullFlow', false);
    results.push(result3);

    console.log('\n=== TEST RESULTS SUMMARY ===');
    results.forEach((result, index) => {
        const testName = index === 0 ? 'Create Payment Only' : 
                        index === 1 ? 'Full Flow (Skip Purchase)' : 
                        'Full Flow (With Purchase)';
        
        console.log(`\n${index + 1}. ${testName}:`);
        console.log(`   Success: ${result.success}`);
        
        if (result.success) {
            console.log(`   Operation Mode: ${result.operationMode}`);
            if (result.operationMode === 'createPaymentOnly') {
                console.log(`   Input Hash: ${result.inputHash}`);
                console.log(`   Identifier: ${result.identifier}`);
                console.log(`   Blockchain ID: ${result.paymentData.blockchainIdentifier}`);
            } else {
                console.log(`   Payment Status: ${result.paymentStatus}`);
                console.log(`   Payment Confirmed: ${result.isPaymentConfirmed}`);
                console.log(`   Skip Purchase: ${result.skipPurchase}`);
                console.log(`   Blockchain ID: ${result.blockchainIdentifier}`);
            }
        } else {
            console.log(`   Error: ${result.error}`);
        }
    });

    console.log('\n=== All tests completed ===');
}

// run if called directly
if (require.main === module) {
    runTests().catch(console.error);
}