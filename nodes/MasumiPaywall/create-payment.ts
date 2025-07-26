import { createHash, randomBytes } from 'crypto';

export interface MasumiConfig {
  paymentServiceUrl: string;
  apiKey: string;
  agentIdentifier: string;
  network: string;
  sellerVkey: string;
}

export interface PaymentData {
  identifierFromPurchaser: string;
  inputData: any;
  inputHash: string;
}

export interface PaymentResponse {
  status: string;
  data: {
    id: string;
    blockchainIdentifier: string;
    payByTime: string;
    submitResultTime: string;
    unlockTime: string;
    externalDisputeUnlockTime: string;
    inputHash: string;
    onChainState: string | null;
    NextAction: {
      requestedAction: string;
      resultHash: string | null;
      errorType: string | null;
      errorNote: string | null;
    };
    RequestedFunds: Array<{ amount: string; unit: string }>;
    PaymentSource: {
      network: string;
      smartContractAddress: string;
      policyId: string;
      paymentType: string;
    };
    SmartContractWallet: {
      walletVkey: string;
      walletAddress: string;
    };
    metadata: string;
  };
}

/**
 * Simple function to create a payment request via Masumi API
 * Based on the Python quickstart template and sokosumi SDK
 */
export async function createPayment(config: MasumiConfig, paymentData: PaymentData): Promise<PaymentResponse> {
  const { paymentServiceUrl, apiKey, agentIdentifier, network } = config;
  const { identifierFromPurchaser, inputData, inputHash } = paymentData;

  // generate timestamps like the python implementation
  const now = new Date();
  const payByTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
  const submitResultTime = new Date(now.getTime() + 20 * 60 * 1000); // 20 minutes from now

  const requestBody = {
    agentIdentifier: agentIdentifier,
    network: network,
    inputHash: inputHash,
    payByTime: payByTime.toISOString(),
    metadata: `payment request for: ${JSON.stringify(inputData).substring(0, 100)}`,
    paymentType: 'Web3CardanoV1',
    submitResultTime: submitResultTime.toISOString(),
    identifierFromPurchaser: identifierFromPurchaser
  };

  console.log('creating payment request:', {
    url: `${paymentServiceUrl}/payment/`,
    body: requestBody
  });

  try {
    const response = await fetch(`${paymentServiceUrl}/payment/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': apiKey,
        'accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`payment creation failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    console.log('payment created successfully:', result);
    
    return result as PaymentResponse;
  } catch (error) {
    console.error('error creating payment:', error);
    throw error;
  }
}

/**
 * Helper function to generate input hash from data
 */
export function generateInputHash(inputData: any): string {
  return createHash('sha256').update(JSON.stringify(inputData)).digest('hex');
}

/**
 * Helper function to generate purchaser identifier
 */
export function generateIdentifier(): string {
  return randomBytes(7).toString('hex');
}

/**
 * Helper function to prepare payment data
 */
export function preparePaymentData(inputData: any, identifierFromPurchaser?: string): PaymentData {
  const inputHash = generateInputHash(inputData);
  const identifier = identifierFromPurchaser || generateIdentifier();
  
  return {
    identifierFromPurchaser: identifier,
    inputData,
    inputHash
  };
}

// standalone execution for testing - similar to cardano-toolbox pattern
async function main() {
  // import dotenv dynamically for standalone usage
  const dotenv = await import('dotenv');
  dotenv.config();
  
  const args = process.argv.slice(2);
  const parsed: any = {};
  
  // parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--') && i + 1 < args.length) {
      const key = arg.substring(2);
      const value = args[i + 1];
      parsed[key] = value;
      i++; // skip next argument
    }
  }
  
  console.log('💰 Masumi Payment Creator');
  console.log('='.repeat(50));
  
  // get config from env or args
  const config: MasumiConfig = {
    paymentServiceUrl: parsed['payment-service-url'] || process.env.MASUMI_PAYMENT_SERVICE_URL!,
    apiKey: parsed['api-key'] || process.env.MASUMI_API_KEY!,
    agentIdentifier: parsed['agent-identifier'] || process.env.MASUMI_AGENT_IDENTIFIER!,
    network: parsed['network'] || process.env.MASUMI_NETWORK || 'Preprod',
    sellerVkey: parsed['seller-vkey'] || process.env.MASUMI_SELLER_VKEY!
  };
  
  // validate required config
  const required = ['paymentServiceUrl', 'apiKey', 'agentIdentifier', 'sellerVkey'];
  for (const key of required) {
    if (!config[key as keyof MasumiConfig]) {
      console.error(`❌ Error: Missing required parameter: ${key}`);
      console.error('💡 Usage:');
      console.error('  ts-node create-payment.ts [options]');
      console.error('  Options:');
      console.error('    --payment-service-url <url>');
      console.error('    --api-key <key>');
      console.error('    --agent-identifier <id>');
      console.error('    --seller-vkey <vkey>');
      console.error('    --network <network>');
      console.error('    --input-data <json>');
      console.error('    --identifier <id>');
      console.error('\n  Or set environment variables: MASUMI_PAYMENT_SERVICE_URL, MASUMI_API_KEY, etc.');
      process.exit(1);
    }
  }
  
  // prepare payment data
  const inputDataStr = parsed['input-data'] || '{"text": "test payment from create-payment.ts"}';
  let inputData: any;
  try {
    inputData = JSON.parse(inputDataStr);
  } catch (error) {
    console.error('❌ Error: Invalid JSON in --input-data');
    process.exit(1);
  }
  
  const paymentData = preparePaymentData(inputData, parsed['identifier']);
  
  console.log(`📝 Input data: ${JSON.stringify(inputData)}`);
  console.log(`🔗 Input hash: ${paymentData.inputHash}`);
  console.log(`🆔 Identifier: ${paymentData.identifierFromPurchaser}`);
  console.log('');
  
  try {
    const result = await createPayment(config, paymentData);
    console.log('📋 Payment Details:');
    console.log(`   Blockchain ID: ${result.data?.blockchainIdentifier?.substring(0, 50)}...`);
    console.log(`   Pay by time: ${new Date(result.data?.payByTime)}`);
    console.log(`   Submit result time: ${new Date(result.data?.submitResultTime)}`);
    console.log('\n' + '='.repeat(50));
    console.log('✅ Payment creation completed!');
  } catch (error) {
    console.error('\n' + '='.repeat(50));
    console.error('❌ Payment creation failed:', error);
    process.exit(1);
  }
}

// run standalone test if executed directly
if (require.main === module) {
  main();
}