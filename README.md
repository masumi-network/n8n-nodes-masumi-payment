# n8n-nodes-masumi-payment

This is an n8n community node that provides Cardano blockchain paywall functionality for monetizing n8n workflows. Supports both direct blockchain payments and sokosumi marketplace integration with dual-mode operation.

## Installation

To install this community node in n8n:

### Option 1: n8n Community Nodes (Recommended)
1. Go to Settings → Community Nodes in your n8n instance
2. Click "Install" and enter: `n8n-nodes-masumi-payment`
3. Click "Install" and restart n8n

### Option 2: Manual Installation
```bash
# In your n8n installation directory
npm install n8n-nodes-masumi-payment

# Restart n8n
```

## Prerequisites

1. **Masumi Payment Service**: You need a running Masumi payment service instance
2. **API Credentials**: Obtain API key and agent identifier from your Masumi service
3. **Cardano Wallet**: Set up seller verification key for receiving payments

## Configuration

### Credentials Setup

1. In n8n, go to Credentials → Add Credential
2. Select "Masumi Paywall API"
3. Configure the following:

| Field | Description | Example |
|-------|-------------|---------|
| Payment Service URL | Base URL of your Masumi service | `https://your-service.railway.app/api/v1` |
| API Key | Your Masumi service API key | `your-secret-api-key` |
| Agent Identifier | Your registered agent ID | `your-agent-id` |
| Seller Verification Key | Cardano wallet verification key | `your-seller-vkey` |
| Network | Cardano network to use | `Preprod` (testnet) or `Mainnet` |

### Node Parameters

| Parameter | Description | Default | Options |
|-----------|-------------|---------|---------|
| Payment Mode | Node operation type | Payment Creation & Polling | Payment Creation & Polling, Full Payment Flow (Testing) |
| Input Data | Data to be processed for payment (will be hashed) | - | Any text/JSON string |
| Timeout (minutes) | Maximum time to wait for payment confirmation | 10 | 1-60 |
| Poll Interval (seconds) | Time between payment status checks | 10 | 5-120 |

## Usage

### Payment Mode: createAndPoll (Default - Sokosumi Compatible)

**What it does:**
1. Creates payment request on Masumi service
2. Waits for external payment (someone else pays)
3. Polls every 10 seconds for FundsLocked state
4. Returns success when payment confirmed or timeout

**Use cases:**
- Sokosumi marketplace integration
- Manual payment workflows  
- API-driven payments where another system handles funding

**Setup:**
1. **Add the Node**: Drag "Masumi Paywall" from node palette
2. **Configure Credentials**: Select Masumi Paywall API credentials
3. **Set Payment Mode**: Keep "Payment Creation & Polling" (default)
4. **Input Data**: Enter data to be processed (will be hashed for payment)
5. **Connect Workflow**: Node waits for external payment before continuing

### Payment Mode: fullFlowWithPurchase (Testing Only)

**What it does:**
1. Creates payment request
2. Automatically creates purchase to attempt fund locking
3. Polls for payment confirmation with 2-minute timeout
4. Usually times out since no real ADA is sent

**Use cases:**
- Testing the full API flow
- Development validation
- Understanding blockchain timing

### Sokosumi Integration Architecture

For sokosumi agents, use **createAndPoll mode** in these workflows:

#### Workflow 1: /start_job endpoint
- **Webhook** (POST /start_job) → **Masumi Paywall** (createAndPoll) → **Respond to Webhook**
- Returns payment data for sokosumi to handle blockchain payment

#### Workflow 2: Background payment polling  
- **Cron Trigger** (every 30s) → **Masumi Paywall** (createAndPoll) → **Main workflow when FundsLocked**
- Detects when sokosumi has made the blockchain payment

#### Workflow 3: /status endpoint
- **Webhook** (GET /status) → **Function** (read job status) → **Respond to Webhook**

#### Workflow 4: /input_schema endpoint
- **Webhook** (GET /input_schema) → **Function** (return schema) → **Respond to Webhook**

### Input Format

The node processes any input data you provide in the **Input Data** field. This can be:
- Plain text: `"process this document"`
- JSON: `{"task": "analysis", "priority": "high"}`
- Numbers, URLs, or any string data

The input is automatically hashed (SHA256) to create a unique payment identifier.

### Output Format

#### createAndPoll Mode (Default)
On successful payment:

```json
{
  "success": true,
  "paymentMode": "createAndPoll",
  "isPaymentConfirmed": true,
  "paymentStatus": "FundsLocked",
  "blockchainIdentifier": "very_long_blockchain_id...",
  "inputHash": "sha256_hash_of_input",
  "identifier": "14_char_hex_id",
  "originalInput": "user_input_data",
  "paymentData": { /* full masumi payment response */ },
  "message": "payment confirmed",
  "timestamp": "2025-07-26T01:00:00.000Z"
}
```

#### fullFlowWithPurchase Mode (Testing)
On successful test:

```json
{
  "success": true,
  "paymentMode": "fullFlowWithPurchase", 
  "isPaymentConfirmed": true,
  "paymentStatus": "FundsLocked",
  "blockchainIdentifier": "very_long_blockchain_id...",
  "identifier": "14_char_hex_id",
  "inputHash": "sha256_hash_of_input",
  "originalInput": "user_input_data",
  "paymentData": { /* payment response */ },
  "purchaseData": { /* purchase response */ },
  "message": "payment confirmed",
  "timestamp": "2025-07-26T01:00:00.000Z"
}
```

On timeout or failure:

```json
{
  "success": false,
  "paymentMode": "createAndPoll",
  "isPaymentConfirmed": false,
  "paymentStatus": "timeout",
  "message": "payment polling timeout after 10 minutes",
  "timestamp": "2025-07-26T01:00:00.000Z"
}
```

## Payment Flow

### createAndPoll Mode (Default)
1. **Input Processing**: Takes input data and generates SHA256 hash + 14-char identifier
2. **Payment Creation**: Creates payment request on Masumi service 
3. **Wait for External Payment**: Node waits for external payment (no purchase created)
4. **Status Polling**: Checks every 10 seconds for FundsLocked state
5. **Result Return**: Returns success when payment confirmed or timeout after configured minutes

### fullFlowWithPurchase Mode (Testing)
1. **Input Processing**: Same hash and identifier generation
2. **Payment Creation**: Creates payment request on Masumi service
3. **Purchase Creation**: Automatically creates purchase to attempt fund locking
4. **Status Polling**: Polls for confirmation with 2-minute timeout  
5. **Result Return**: Usually times out since no real ADA is sent

## Payment States

**Success States:**
- `FundsLocked` - Payment received, funds locked, workflow can continue
- `ResultSubmitted` - Result delivered to buyer
- `Withdrawn` - Funds withdrawn by seller

**Error States:**
- `FundsOrDatumInvalid` - Invalid payment/data
- `RefundRequested` - Customer requested refund  
- `Disputed` - Payment disputed
- `RefundWithdrawn` - Customer withdrew refund
- `DisputedWithdrawn` - Dispute resolved, funds withdrawn

**Polling States:**
- `null/pending` - Payment being processed, continue polling

## Error Handling

The node handles common error scenarios:

- **API Failures**: Network issues, invalid credentials, service downtime
- **Payment Timeouts**: User doesn't complete payment within window
- **Blockchain Issues**: Transaction failures, network congestion
- **Configuration Errors**: Invalid URLs, missing credentials

Errors are returned in a structured format with descriptive messages.

## Development

### Local Development

```bash
# Clone and install dependencies
git clone <repository>
cd n8n-nodes-masumi-payment
npm install

# Build TypeScript
npm run build

# Lint code
npm run lint

# Link for local testing
npm link
```

### Testing

#### Standalone Function Testing
The node uses three clean functions that can be tested independently:

```bash
# Test payment creation
bun run nodes/MasumiPaywall/create-payment.ts

# Test payment status checking  
bun run nodes/MasumiPaywall/check-payment-status.ts --blockchain-identifier <id>

# Test purchase creation
bun run nodes/MasumiPaywall/create-purchase.ts --blockchain-identifier <id> --pay-by-time <time> --submit-result-time <time> --unlock-time <time> --external-dispute-unlock-time <time> --input-hash <hash> --identifier <id>
```

#### Node Testing
1. Ensure your Masumi service is running
2. Configure valid API credentials in n8n
3. Use **fullFlowWithPurchase** mode for testing (no real ADA required)
4. Use **createAndPoll** mode for production (requires external payment)

## Architecture

The node uses three simplified functions instead of complex inline logic:

1. **create-payment.ts** - Creates payment requests via Masumi API
2. **create-purchase.ts** - Creates purchases to lock funds (testing mode)  
3. **check-payment-status.ts** - Polls payment status until FundsLocked or timeout

Each function can be called both from the n8n node and standalone for testing, following the "braindead simple" approach for reliability.

## Support

- **Issues**: Report bugs on GitHub Issues
- **Documentation**: Full docs available in repository
- **Community**: Join n8n Community for discussions

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions welcome! Please read contributing guidelines and submit pull requests.

---

Built with ❤️ for the n8n community